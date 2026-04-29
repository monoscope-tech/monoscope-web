import { MonoscopeReplay } from "./replay";
import { OpenTelemetryManager, newId } from "./tracing";
import { ErrorTracker } from "./errors";
import { WebVitalsCollector } from "./web-vitals";
import { SPARouter } from "./router";
import { MonoscopeConfig, MonoscopeUser } from "./types";
import { addBreadcrumb, clearBreadcrumbs } from "./breadcrumbs";
import { DevOverlay } from "./overlay";
import type { Span } from "@opentelemetry/api";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const LAST_ACTIVITY_KEY = "monoscope-last-activity";

const isBrowser = typeof window !== "undefined";

class Monoscope {
  replay: MonoscopeReplay;
  private config: MonoscopeConfig;
  otel: OpenTelemetryManager;
  sessionId: string;
  tabId: string;
  private lastActivityTime: number;
  private errors: ErrorTracker;
  private vitals: WebVitalsCollector;
  private router: SPARouter;
  private _enabled: boolean;
  private overlay: DevOverlay | null = null;

  constructor(config: MonoscopeConfig) {
    const resolvedKey = config.apiKey || config.projectId;
    if (!resolvedKey) throw new Error("MonoscopeConfig must include apiKey (or projectId)");
    if (config.projectId && !config.apiKey && config.debug) {
      console.warn("[Monoscope] `projectId` is deprecated. Use `apiKey` instead.");
    }
    config = { ...config, apiKey: resolvedKey, projectId: resolvedKey };

    const isLocalhost = isBrowser && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
    if (config.debug === undefined && isLocalhost) config = { ...config, debug: true };
    if (!config.serviceName) config = { ...config, serviceName: isBrowser ? location.hostname : "unknown" };

    this.config = config;
    this._enabled = config.enabled !== false;
    this.tabId = isBrowser ? this.resolveTabId() : newId();
    this.sessionId = isBrowser ? this.resolveSessionId() : newId();
    this.lastActivityTime = Date.now();
    if (isBrowser) this.persistActivity();

    this.replay = new MonoscopeReplay(config, this.sessionId, this.tabId);
    this.otel = new OpenTelemetryManager(config, this.sessionId, this.tabId);
    const emit = (...args: Parameters<OpenTelemetryManager["emitSpan"]>) => this.otel.emitSpan(...args);
    this.errors = new ErrorTracker(emit);
    // Web vitals are aggregate browser measurements — emit on the OTel
    // metrics signal (one histogram per vital), not as spans.
    this.vitals = new WebVitalsCollector((name, value, attrs) =>
      this.otel.recordWebVital(name, value, attrs),
    );
    this.router = new SPARouter((from, to, method) => this.otel.startRouteChange(from, to, method));

    if (this._enabled) {
      this.otel.configure();
      this.replay.configure();
      this.errors.start();
      if (this.config.captureWebVitals !== false) {
        this.vitals.start().catch((e) => {
          if (this.config.debug) console.warn("Monoscope: web-vitals init failed", e);
        });
      }
      this.router.start();
    }

    if (this._enabled && this.config.debug) {
      this.logInitBanner();
      if (isBrowser) {
        this.overlay = new DevOverlay();
        this.otel.onExportStatus = (ok) => this.overlay?.setConnectionStatus(ok);
        this.otel.onSpanStart = () => this.overlay?.incrementEvents();
      }
    }
    if (isBrowser) this.setupActivityTracking();
  }

  private logInitBanner() {
    const c = this.config;
    const endpoint = c.exporterEndpoint || "https://otelcol.monoscope.tech/v1/traces";
    const samplePct = Math.round((c.sampleRate ?? 1) * 100);
    const replayPct = Math.round((c.replaySampleRate ?? 1) * 100);
    console.groupCollapsed(
      "%c[Monoscope] ✓ Initialized",
      "color: #22c55e; font-weight: bold",
    );
    console.log(`  API Key:   ${c.apiKey}`);
    console.log(`  Service:   ${c.serviceName}`);
    console.log(`  Session:   ${this.sessionId}`);
    console.log(`  Tracing:   ✓ (sample rate: ${samplePct}%)`);
    console.log(`  Replay:    ✓ (sample rate: ${replayPct}%)`);
    console.log(`  Errors:    ✓`);
    console.log(`  Endpoint:  ${endpoint}`);
    console.groupEnd();
  }

  private resolveSessionId(): string {
    try {
      const storedId = sessionStorage.getItem("monoscope-session-id");
      const lastActivity = sessionStorage.getItem(LAST_ACTIVITY_KEY);

      if (storedId && lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity, 10);
        if (elapsed < SESSION_TIMEOUT_MS) return storedId;
      }

      const id = newId();
      sessionStorage.setItem("monoscope-session-id", id);
      return id;
    } catch (e) {
      if (this.config.debug) console.warn("Monoscope: sessionStorage unavailable, using ephemeral session", e);
      return newId();
    }
  }

  // sessionStorage is tab-scoped, so a persisted id naturally identifies a
  // single tab across MPA navigations and SPA reloads.
  private resolveTabId(): string {
    try {
      const existing = sessionStorage.getItem("monoscope-tab-id");
      if (existing) return existing;
      const id = newId();
      sessionStorage.setItem("monoscope-tab-id", id);
      return id;
    } catch { return newId(); }
  }

  private persistActivity() {
    try {
      sessionStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
    } catch (e) {
      if (this.config.debug) console.warn("Monoscope: failed to persist activity", e);
    }
  }

  private rotateSession() {
    this.replay.save().catch((e) => {
      if (this.config.debug) console.warn("Monoscope: failed to save replay on session rotation", e);
    });
    clearBreadcrumbs();
    this.sessionId = newId();
    try { sessionStorage.setItem("monoscope-session-id", this.sessionId); } catch (e) {
      if (this.config.debug) console.warn("Monoscope: failed to persist session ID", e);
    }
    this.replay.updateSessionId(this.sessionId);
    this.otel.updateSessionId(this.sessionId);
    if (this.config.debug) console.log("Monoscope: session rotated due to inactivity");
  }

  private checkAndRefreshSession() {
    const now = Date.now();
    if (now - this.lastActivityTime >= SESSION_TIMEOUT_MS) {
      this.rotateSession();
    }
    this.lastActivityTime = now;
    this.persistActivity();
  }

  private setupActivityTracking() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.checkAndRefreshSession();
      }
    });

    let lastTracked = Date.now();
    const trackActivity = () => {
      const now = Date.now();
      if (now - lastTracked > 5000) {
        lastTracked = now;
        this.lastActivityTime = now;
        this.persistActivity();
      }
    };

    document.addEventListener("click", (e) => {
      trackActivity();
      const el = e.target as HTMLElement;
      if (!el) return;
      const tag = el.tagName?.toLowerCase() || "";
      const text = (el.textContent || "").trim().slice(0, 50);
      const cls = el.getAttribute("class") || "";
      const selector = el.id ? `#${el.id}` : cls ? `.${cls.split(" ")[0]}` : tag;
      addBreadcrumb({ type: "click", message: `${tag} "${text}"`, data: { selector } });
    }, { capture: true, passive: true });
    document.addEventListener("keydown", trackActivity, { capture: true, passive: true });
  }

  getSessionId() { return this.sessionId; }
  getTabId() { return this.tabId; }

  setUser(u: MonoscopeUser) {
    if (this.config.debug) {
      const known = new Set(["email", "full_name", "name", "id", "roles"]);
      const extra = Object.keys(u).filter(k => !known.has(k));
      if (extra.length) console.warn(`Monoscope: unknown user attributes will be sent to collectors: ${extra.join(", ")}`);
    }
    this.otel.setUser(u);
    this.replay.setUser(u);
  }

  startSpan<T>(name: string, fn: (span: Span) => T): T {
    return this.otel.startSpan(name, fn);
  }

  recordEvent(name: string, attributes?: Record<string, string | number | boolean>) {
    this.otel.recordEvent(name, attributes);
  }

  async test(): Promise<{ success: boolean; message: string }> {
    try {
      this.otel.emitSpan("monoscope.test", { "test.timestamp": Date.now() });
      await this.otel.forceFlush();
      const msg = "Test span sent successfully.";
      if (this.config.debug) console.log(`[Monoscope] ${msg}`);
      return { success: true, message: msg };
    } catch (e) {
      const msg = `Test failed: ${e}`;
      if (this.config.debug) console.error(`[Monoscope] ${msg}`);
      return { success: false, message: msg };
    }
  }

  disable() {
    this._enabled = false;
    this.replay.setEnabled(false);
    this.otel.setEnabled(false);
    this.vitals.setEnabled(false);
    this.errors.stop();
    this.router.stop();
  }

  enable() {
    this._enabled = true;
    this.otel.setEnabled(true);
    this.otel.configure();
    this.replay.setEnabled(true);
    this.replay.configure();
    this.vitals.setEnabled(true);
    this.vitals.start().catch(() => {});
    this.errors.start();
    this.router.start();
  }

  isEnabled() { return this._enabled; }

  async destroy() {
    this.errors.stop();
    this.router.stop();
    this.replay.stop();
    this.vitals.setEnabled(false);
    try { await this.otel.shutdown(); } catch (e) {
      console.warn("Monoscope: provider shutdown failed, some trace data may be lost", e);
    }
    this._enabled = false;
  }
}

export default Monoscope;
