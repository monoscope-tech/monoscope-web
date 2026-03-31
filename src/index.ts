import { MonoscopeReplay } from "./replay";
import { OpenTelemetryManager } from "./tracing";
import { ErrorTracker } from "./errors";
import { WebVitalsCollector } from "./web-vitals";
import { SPARouter } from "./router";
import { MonoscopeConfig, MonoscopeUser } from "./types";
import { addBreadcrumb, clearBreadcrumbs } from "./breadcrumbs";
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

  constructor(config: MonoscopeConfig) {
    if (!config.projectId) throw new Error("MonoscopeConfig must include projectId");

    const isLocalhost = isBrowser && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
    if (config.debug === undefined && isLocalhost) config = { ...config, debug: true };
    if (!config.serviceName) config = { ...config, serviceName: isBrowser ? location.hostname : "unknown" };

    this.config = config;
    this._enabled = config.enabled !== false;
    this.tabId = crypto.randomUUID();
    this.sessionId = isBrowser ? this.resolveSessionId() : crypto.randomUUID();
    this.lastActivityTime = Date.now();
    if (isBrowser) this.persistActivity();

    this.replay = new MonoscopeReplay(config, this.sessionId, this.tabId);
    this.otel = new OpenTelemetryManager(config, this.sessionId, this.tabId);
    const emit = (...args: Parameters<OpenTelemetryManager["emitSpan"]>) => this.otel.emitSpan(...args);
    this.errors = new ErrorTracker(emit);
    this.vitals = new WebVitalsCollector(emit);
    this.router = new SPARouter(emit);

    if (this._enabled) {
      this.otel.configure();
      this.replay.configure();
      this.errors.start();
      this.vitals.start().catch((e) => {
        if (this.config.debug) console.warn("Monoscope: web-vitals init failed", e);
      });
      this.router.start();
    }

    if (this._enabled && this.config.debug) this.logInitBanner();
    if (isBrowser) this.setupActivityTracking();
  }

  private logInitBanner() {
    const c = this.config;
    const endpoint = c.exporterEndpoint || "https://otelcol.apitoolkit.io/v1/traces";
    const samplePct = Math.round((c.sampleRate ?? 1) * 100);
    const replayPct = Math.round((c.replaySampleRate ?? 1) * 100);
    console.groupCollapsed(
      "%c[Monoscope] ✓ Initialized",
      "color: #22c55e; font-weight: bold",
    );
    console.log(`  Project:   ${c.projectId}`);
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

      const newId = crypto.randomUUID();
      sessionStorage.setItem("monoscope-session-id", newId);
      return newId;
    } catch (e) {
      if (this.config.debug) console.warn("Monoscope: sessionStorage unavailable, using ephemeral session", e);
      return crypto.randomUUID();
    }
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
    this.sessionId = crypto.randomUUID();
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
