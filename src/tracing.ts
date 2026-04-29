import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { UserInteractionInstrumentation } from "@opentelemetry/instrumentation-user-interaction";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { MonoscopeConfig, MonoscopeUser } from "./types";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { context, Histogram, Span, SpanStatusCode, trace } from "@opentelemetry/api";

const MONOSCOPE_TRACER = "monoscope";
const ROUTE_IDLE_MS = 3000;
// Cap how long a single pageview span lives before rotation. Without this, a
// long-running SPA without route changes (or a browser that never fires
// pagehide) leaves the parent span un-ended and BatchSpanProcessor never
// ships it, even though children export fine.
const PAGEVIEW_MAX_MS = 30 * 60 * 1000;
import type { WebVitalName } from "./web-vitals";

export type MonoscopeKind =
  | "page_load" | "navigation" | "interaction" | "network"
  | "resource" | "web_vital" | "error" | "long_task" | "custom";

// Display-label helpers. These derive a human-readable label ("what happened?")
// from raw span attributes so trace viewers don't have to reinvent the wheel.
export function shortPath(url: string): string {
  try {
    const u = new URL(url, typeof location !== "undefined" ? location.href : "http://_");
    return u.pathname + (u.search ? "?…" : "");
  } catch { return url.slice(0, 80); }
}

export function describeElement(el: EventTarget | Element | null | undefined): string {
  const e = el as Element | null;
  if (!e || !e.tagName) return "?";
  const aria = e.getAttribute?.("aria-label");
  if (aria) return aria;
  const text = (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (text) return text;
  const id = e.id ? `#${e.id}` : "";
  const cls = (e.getAttribute?.("class") || "").split(" ").filter(Boolean)[0];
  return `${e.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ""}`;
}

// Climb to the nearest "meaningful" interactive ancestor so a click on an inner
// <span>/<svg>/<i> inside a button is attributed to the button itself, not the
// inner node. Returns null if neither the target nor any ancestor is an
// interactive element — callers can use that to skip span creation entirely.
const INTERACTIVE_SELECTOR =
  "button,a[href],input,select,textarea,summary,label," +
  "[role=button],[role=link],[role=menuitem],[role=tab],[role=switch]," +
  "[role=checkbox],[role=radio],[role=option],[data-monoscope-track]";

export function closestInteractive(el: EventTarget | null | undefined): Element | null {
  const e = el as Element | null;
  if (!e || typeof (e as any).closest !== "function") return null;
  return e.closest(INTERACTIVE_SELECTOR);
}

/**
 * RFC4122 v4 id with a fallback for non-secure contexts (HTTP / file:// /
 * older Safari/Edge) where `crypto.randomUUID` is undefined.
 */
export function newId(): string {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); } catch {
    for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0;
  }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

export class OpenTelemetryManager {
  private config: MonoscopeConfig;
  private sessionId: string;
  private tabId: string;
  private pageviewId: string = "";
  private provider: WebTracerProvider;
  private processor: BatchSpanProcessor | null = null;
  private meterProvider: MeterProvider | null = null;
  private metricReader: PeriodicExportingMetricReader | null = null;
  private vitalHistograms: Partial<Record<WebVitalName, Histogram>> = {};
  private pageviewMaxTimer: ReturnType<typeof setTimeout> | null = null;
  private longTaskObserver: PerformanceObserver | null = null;
  private resourceObserver: PerformanceObserver | null = null;
  private _enabled: boolean = true;
  private _configured: boolean = false;
  private _firstExportLogged: boolean = false;
  private routeSpan: Span | null = null;
  private routeContext: ReturnType<typeof context.active> | null = null;
  private routeIdleTimer: ReturnType<typeof setTimeout> | null = null;
  // Long-lived parent span; every parentless auto-instrumented span is
  // reparented to it. SPA: rotates on route change. MPA: ends on pagehide.
  private pageviewSpan: Span | null = null;
  private pageviewContext: ReturnType<typeof context.active> | null = null;
  private flushOnHideHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private lastInteractionAt = new WeakMap<Element, number>();
  onExportStatus: ((ok: boolean) => void) | null = null;
  onSpanStart: (() => void) | null = null;

  constructor(config: MonoscopeConfig, sessionId: string, tabId: string) {
    this.config = config;
    this.sessionId = sessionId;
    this.tabId = tabId;
    this.provider = this.createProvider();
    // Skip the metrics pipeline entirely when vitals are disabled — otherwise
    // an OTLP exporter and 30s reader run for nothing. Wrap construction:
    // failure must not bubble out of the SDK constructor into host code.
    if (config.captureWebVitals !== false) {
      try { this.meterProvider = this.createMeterProvider(); }
      catch (e) {
        if (config.debug) console.warn("Monoscope: meter provider init failed", e);
        this.meterProvider = null;
      }
    }
  }

  // Build the metrics pipeline for Core Web Vitals (LCP/INP/FCP/TTFB in ms,
  // CLS dimensionless). Names use `browser.web_vital.*`.
  protected createMeterProvider(): MeterProvider {
    const { serviceName, resourceAttributes = {}, exporterEndpoint, metricsExporterEndpoint } = this.config;
    const apiKey = this.config.apiKey || this.config.projectId || "";
    let url: string;
    if (metricsExporterEndpoint) url = metricsExporterEndpoint;
    else if (exporterEndpoint) {
      const replaced = exporterEndpoint.replace(/\/v1\/traces\b/, "/v1/metrics");
      // Custom endpoint that doesn't match /v1/traces — caller must opt in
      // explicitly via metricsExporterEndpoint, otherwise we'd POST metric
      // payloads to a trace endpoint and fail silently.
      if (replaced === exporterEndpoint) {
        if (this.config.debug) console.warn(
          "Monoscope: exporterEndpoint does not contain /v1/traces; set metricsExporterEndpoint explicitly",
        );
      }
      url = replaced;
    } else {
      url = "https://otelcol.monoscope.tech/v1/metrics";
    }

    const exporter = new OTLPMetricExporter({ url, headers: { "x-api-key": apiKey } });
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 30000 });
    this.metricReader = reader;

    return new MeterProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        "x-api-key": apiKey,
        ...resourceAttributes,
      }),
      readers: [reader],
    });
  }

  // Cached histogram per vital; CLS is unit "1", others "ms".
  public recordWebVital(
    name: WebVitalName,
    value: number,
    attrs: Record<string, string | number | boolean>,
  ) {
    if (!this._enabled || !this.meterProvider) return;
    try {
      let hist = this.vitalHistograms[name];
      if (!hist) {
        const meter = this.meterProvider.getMeter(MONOSCOPE_TRACER);
        hist = meter.createHistogram(`browser.web_vital.${name.toLowerCase()}`, {
          description: `Core Web Vital: ${name}`,
          unit: name === "CLS" ? "1" : "ms",
        });
        this.vitalHistograms[name] = hist;
      }
      hist.record(value, { ...this.commonAttrs(), ...attrs });
    } catch (e) {
      if (this.config.debug) console.warn("Monoscope: recordWebVital failed for", name, e);
    }
  }

  private createProvider(): WebTracerProvider {
    const { serviceName, resourceAttributes = {}, exporterEndpoint } = this.config;
    const apiKey = this.config.apiKey || this.config.projectId || "";
    const self = this;

    const realExporter = new OTLPTraceExporter({
      url: exporterEndpoint || "https://otelcol.monoscope.tech/v1/traces",
      headers: { "x-api-key": apiKey },
    });

    // Wrap exporter to capture export results for diagnostics
    const wrappedExporter = Object.create(realExporter, {
      export: {
        value(spans: any, resultCallback: any) {
          return realExporter.export(spans, (result: any) => {
            if (!self._firstExportLogged) {
              self._firstExportLogged = true;
              const ok = result.code === 0;
              if (self.config.debug) {
                console.log(
                  ok ? "%c[Monoscope] ✓ First trace sent successfully" : "%c[Monoscope] ✗ First trace export failed",
                  ok ? "color: #22c55e; font-weight: bold" : "color: #ef4444; font-weight: bold",
                  ok ? "" : result.error || "",
                );
                if (!ok) {
                  const msg = String(result.error || "");
                  if (msg.includes("401") || msg.includes("403")) {
                    console.warn("[Monoscope] Authentication failed. Your apiKey may be invalid.");
                  } else {
                    console.warn("[Monoscope] Could not reach Monoscope endpoint. Check your apiKey and network.");
                  }
                }
              }
              self.onExportStatus?.(ok);
            }
            resultCallback(result);
          });
        },
      },
    });

    const processor = new BatchSpanProcessor(wrappedExporter);
    this.processor = processor;

    // Count every span at start — covers auto-instrumentations, internal
    // emitSpan, and manual APIs uniformly. onEnd would undercount dropped
    // spans; onStart reflects telemetry volume the SDK actually observed.
    const countingProcessor = {
      onStart: () => { try { self.onSpanStart?.(); } catch { /* never throw from processor */ } },
      onEnd: () => {},
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };

    const provider = new WebTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        "x-api-key": apiKey,
        ...resourceAttributes,
      }),
      spanProcessors: [processor, countingProcessor],
    });

    // Reparent parentless spans to the current pageview; spans with an
    // existing parent are untouched. Tracers are cached by provider, so guard
    // with a per-instance flag — re-wrapping would capture the already-wrapped
    // function and recurse infinitely on the next getTracer() call.
    const realGetTracer = provider.getTracer.bind(provider);
    (provider as any).getTracer = (name: string, version?: string, opts?: any) => {
      const tracer = realGetTracer(name, version, opts);
      if ((tracer as any).__monoscopeWrapped) return tracer;
      const realStart = tracer.startSpan.bind(tracer);
      const realStartActive: any = tracer.startActiveSpan.bind(tracer);
      const reparent = (ctx: any): any => {
        const effective = ctx ?? context.active();
        if (trace.getSpan(effective)) return effective;
        return self.pageviewContext ?? effective;
      };
      tracer.startSpan = (n: string, o?: any, ctx?: any) => realStart(n, o, reparent(ctx));
      tracer.startActiveSpan = (n: string, ...args: any[]) => {
        // (name, fn) | (name, opts, fn) | (name, opts, ctx, fn)
        let o: any, ctx: any, fn: any;
        if (args.length === 1) [fn] = args;
        else if (args.length === 2) [o, fn] = args;
        else [o, ctx, fn] = args;
        return realStartActive(n, o, reparent(ctx), fn);
      };
      (tracer as any).__monoscopeWrapped = true;
      return tracer;
    };
    return provider;
  }

  private startPageview() {
    if (this.pageviewSpan) return;
    try {
      const tracer = trace.getTracer(MONOSCOPE_TRACER);
      // pageview is the root — pass active context explicitly so the reparent
      // wrap leaves it alone (no parent → no self-loop).
      const span = tracer.startSpan("pageview", {
        attributes: {
          "monoscope.kind": "pageview",
          "monoscope.display.label": `Pageview · ${shortPath(location.href)}`,
        },
      }, context.active());
      this.applyCommonAttrs(span);
      this.pageviewSpan = span;
      this.pageviewContext = trace.setSpan(context.active(), span);
      // Cap pageview duration so a long-lived SPA without route changes still
      // ships its parent span — BatchSpanProcessor only exports after end().
      this.pageviewMaxTimer = setTimeout(() => this.rollPageview(), PAGEVIEW_MAX_MS);
    } catch (e) {
      if (this.config.debug) console.warn("Monoscope: startPageview failed", e);
    }
  }

  private endPageview() {
    if (this.pageviewMaxTimer) {
      clearTimeout(this.pageviewMaxTimer);
      this.pageviewMaxTimer = null;
    }
    try { this.pageviewSpan?.end(); }
    catch (e) { if (this.config.debug) console.warn("Monoscope: endPageview failed", e); }
    this.pageviewSpan = null;
    this.pageviewContext = null;
  }

  // End the current pageview span and open a fresh one with a new pageview.id.
  // Used by the max-age timer and on visibility return.
  private rollPageview() {
    if (!this._enabled) return;
    this.endPageview();
    this.rotatePageview();
    this.startPageview();
  }

  private commonAttrs(): Record<string, string> {
    const attrs: Record<string, string> = {
      "session.id": this.sessionId,
      "tab.id": this.tabId,
      "pageview.id": this.pageviewId,
      "page.url": location.href,
      "page.title": document.title,
    };
    if (document.referrer) attrs["page.referrer"] = document.referrer;
    return attrs;
  }

  private applyCommonAttrs(span: Span) {
    for (const [k, v] of Object.entries(this.commonAttrs())) span.setAttribute(k, v);
    if (this.config.user) {
      for (const [k, v] of Object.entries(this.config.user)) {
        if (v !== undefined) span.setAttribute(`user.${k}`, v as any);
      }
    }
  }

  public configure(): void {
    if (typeof window === "undefined" || this._configured) return;
    this._configured = true;

    // Sticky per-tab sampling decision so MPA navigations and SPA reloads don't
    // produce half-traced sessions. sessionStorage is tab-scoped.
    const rate = Math.max(0, Math.min(1, this.config.sampleRate ?? 1));
    let sampled: boolean;
    try {
      const cached = sessionStorage.getItem("monoscope-sampled");
      if (cached === "1" || cached === "0") sampled = cached === "1";
      else {
        sampled = Math.random() < rate;
        sessionStorage.setItem("monoscope-sampled", sampled ? "1" : "0");
      }
    } catch { sampled = Math.random() < rate; }
    if (!sampled) {
      this._enabled = false;
      if (this.config.debug) console.log("MonoscopeOTel: sampled out");
      return;
    }

    this.pageviewId = newId();

    this.provider.register({
      contextManager: new ZoneContextManager(),
      propagator: new W3CTraceContextPropagator(),
    });

    // Open the pageview parent before any instrumentation registers, so every
    // span subsequently created inherits it as parent via the getTracer wrap.
    this.startPageview();

    // Default to same-origin only to avoid leaking trace context to third parties
    const headerUrls = this.config.propagateTraceHeaderCorsUrls || [new RegExp(`^${location.origin}`)];
    const ignoreUrls = [
      /^https?:\/\/(?:[^\/]+\.)?apitoolkit\.io\//,
      /^https?:\/\/(?:[^\/]+\.)?monoscope\.tech\//,
    ];

    const addAttrs = (span: any) => this.applyCommonAttrs(span);
    const stamp = (span: any, kind: MonoscopeKind, label?: string) => {
      this.applyCommonAttrs(span);
      span.setAttribute("monoscope.kind", kind);
      if (label) span.setAttribute("monoscope.display.label", label);
    };

    // Default to click/submit only — every keydown/mouseover would flood the
    // backend. Filter aggressively: UserInteractionInstrumentation otherwise
    // creates one span per bubbled handler invocation.
    const INTERACTION_DEDUPE_MS = 250;
    const userInteraction = this.config.enableUserInteraction !== false
      ? [new UserInteractionInstrumentation({
          eventNames: ["click", "submit"] as any,
          shouldPreventSpanCreation: (eventType, element, span) => {
            const target = closestInteractive(element) as Element | null;
            if (!target) return true;
            const now = performance.now();
            const last = this.lastInteractionAt.get(target) ?? 0;
            if (now - last < INTERACTION_DEDUPE_MS) return true;
            this.lastInteractionAt.set(target, now);
            stamp(span, "interaction", `${eventType} · ${describeElement(target)}`);
            span.setAttribute("target.tag_name", target.tagName?.toLowerCase() || "");
            if (target.id) span.setAttribute("target.id", target.id);
            const role = target.getAttribute("role");
            if (role) span.setAttribute("target.role", role);
            return false;
          },
        })]
      : [];

    registerInstrumentations({
      tracerProvider: this.provider,
      instrumentations: [
        ...((this.config.instrumentations || []) as any[]),
        new DocumentLoadInstrumentation({
          ignoreNetworkEvents: !this.config.enableNetworkEvents,
          applyCustomAttributesOnSpan: {
            documentLoad: (span: any) => stamp(span, "page_load", `Page · ${shortPath(location.href)}`),
            resourceFetch: (span: any) => stamp(span, "resource"),
          } as any,
        }),
        new XMLHttpRequestInstrumentation({
          propagateTraceHeaderCorsUrls: headerUrls, ignoreUrls,
          applyCustomAttributesOnSpan: (span, xhr) => {
            const url = (xhr as XMLHttpRequest).responseURL;
            stamp(span, "network", url ? `XHR · ${shortPath(url)}` : undefined);
          },
        }),
        new FetchInstrumentation({
          propagateTraceHeaderCorsUrls: headerUrls, ignoreUrls,
          applyCustomAttributesOnSpan: (span, request) => {
            let url: string | undefined;
            let method = "GET";
            if (typeof request === "string") url = request;
            else if (request && typeof (request as Request).url === "string") {
              url = (request as Request).url;
              method = (request as Request).method || "GET";
            } else if (request && typeof (request as RequestInit).method === "string") {
              method = (request as RequestInit).method!;
            }
            stamp(span, "network", url ? `${method} · ${shortPath(url)}` : undefined);
          },
        }),
        ...userInteraction,
      ],
    });

    if (this.config.captureLongTasks !== false) this.observeLongTasks();
    if (this.config.captureResourceTiming) this.observeResourceTiming();
    this.installFlushOnHide();
  }

  public getPageviewId() { return this.pageviewId; }

  public rotatePageview(): string {
    this.pageviewId = newId();
    return this.pageviewId;
  }

  /**
   * Open a short-lived route.change root span for an SPA navigation. Closes
   * any previous route span, rotates pageview.id, and publishes the span as
   * the active context so async work started in the same Zone (fetch/XHR)
   * inherits it as parent. Auto-closes after ROUTE_IDLE_MS or on next nav.
   */
  public startRouteChange(from: string, to: string, method: string) {
    try {
      this.endRouteChange();
      // SPA: each route is its own trace, so rotate the pageview parent
      // before opening route.change.
      this.rollPageview();
      const tracer = trace.getTracer(MONOSCOPE_TRACER);
      const span = tracer.startSpan("route.change", {
        attributes: {
          "navigation.from": from,
          "navigation.to": to,
          "navigation.method": method,
          "monoscope.kind": "navigation",
          "monoscope.display.label": `Nav · ${shortPath(from)} → ${shortPath(to)}`,
        },
      });
      this.applyCommonAttrs(span);
      this.routeSpan = span;
      this.routeContext = trace.setSpan(context.active(), span);
      this.routeIdleTimer = setTimeout(() => {
        try { this.endRouteChange(); }
        catch (e) { if (this.config.debug) console.warn("Monoscope: route idle close failed", e); }
      }, ROUTE_IDLE_MS);
    } catch (e) {
      if (this.config.debug) console.warn("Monoscope: startRouteChange failed", e);
      this.routeSpan = null;
      this.routeContext = null;
      this.routeIdleTimer = null;
    }
  }

  public endRouteChange() {
    if (this.routeIdleTimer) {
      clearTimeout(this.routeIdleTimer);
      this.routeIdleTimer = null;
    }
    this.routeSpan?.end();
    this.routeSpan = null;
    this.routeContext = null;
  }

  /**
   * Flush pending spans before the JS context is destroyed. Critical for
   * MPAs where every navigation unloads the page, and still valuable for
   * SPAs at tab close. pagehide is preferred over beforeunload (fires for
   * bfcache eviction and mobile backgrounding; beforeunload does not).
   */
  private installFlushOnHide() {
    const debugWarn = (label: string) => (e: unknown) => {
      if (this.config.debug) console.warn(`Monoscope: ${label} failed`, e);
    };
    const flush = () => {
      try {
        this.endRouteChange();
        // End pageview so it flushes with its children.
        this.endPageview();
        this.processor?.forceFlush().catch(debugWarn("trace flush"));
        this.metricReader?.forceFlush().catch(debugWarn("metric flush"));
      } catch (e) {
        if (this.config.debug) console.warn("Monoscope: flush on hide failed", e);
      }
    };
    this.flushOnHideHandler = flush;
    this.visibilityHandler = () => {
      if (document.visibilityState === "hidden") flush();
      // Returning to a previously-hidden tab: open a fresh pageview so the
      // next user activity isn't orphaned.
      else if (this._enabled && !this.pageviewSpan) this.rollPageview();
    };
    window.addEventListener("pagehide", this.flushOnHideHandler);
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private withActiveContext<T>(fn: () => T): T {
    const ctx = this.routeContext ?? this.pageviewContext;
    if (ctx) return context.with(ctx, fn);
    return fn();
  }

  public emitSpan(name: string, attrs: Record<string, string | number | boolean>, configure?: (span: Span) => void) {
    try {
      const tracer = trace.getTracer(MONOSCOPE_TRACER);
      this.withActiveContext(() => tracer.startActiveSpan(name, (span: Span) => {
        this.applyCommonAttrs(span);
        for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
        configure?.(span);
        span.end();
      }));
    } catch (e) {
      if (this.config.debug) console.warn("Monoscope: span emit failed for", name, e);
    }
  }

  private observeLongTasks() {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        if (!this._enabled) return;
        for (const entry of list.getEntries()) {
          try {
            const attrs: Record<string, string | number> = {
              "longtask.duration": entry.duration,
              "longtask.name": entry.name,
              "monoscope.kind": "long_task",
              "monoscope.display.label": `Long task · ${Math.round(entry.duration)}ms`,
            };
            const attr = (entry as any).attribution;
            if (attr?.[0]?.containerSrc) attrs["longtask.script"] = attr[0].containerSrc;
            if (attr?.[0]?.containerName) attrs["longtask.container"] = attr[0].containerName;
            // Long tasks have real duration → spans, not events.
            this.emitSpan("longtask", attrs);
          } catch (e) {
            if (this.config.debug) console.warn("Monoscope: failed to process longtask entry", e);
          }
        }
      });
      this.longTaskObserver.observe({ type: "longtask", buffered: true });
    } catch (e) {
      console.warn("Monoscope: longtask observation not supported", e);
    }
  }

  private observeResourceTiming() {
    if (typeof PerformanceObserver === "undefined") return;
    const threshold = this.config.resourceTimingThresholdMs ?? 200;
    try {
      this.resourceObserver = new PerformanceObserver((list) => {
        if (!this._enabled) return;
        for (const entry of list.getEntries()) {
          if (entry.duration < threshold) continue;
          try {
            const re = entry as PerformanceResourceTiming;
            const base = re.name.split("?")[0].split("/").pop() || re.name;
            this.emitSpan("resource", {
              "resource.name": re.name,
              "resource.duration": re.duration,
              "resource.type": re.initiatorType,
              "resource.transferSize": re.transferSize,
              "resource.encodedBodySize": re.encodedBodySize,
              "monoscope.kind": "resource",
              "monoscope.display.label": `${re.initiatorType} · ${base}`,
            });
          } catch (e) {
            if (this.config.debug) console.warn("Monoscope: failed to process resource entry", e);
          }
        }
      });
      this.resourceObserver.observe({ type: "resource", buffered: false });
    } catch (e) {
      console.warn("Monoscope: resource timing not supported", e);
    }
  }

  public startSpan<T>(name: string, fn: (span: Span) => T): T {
    const tracer = trace.getTracer(MONOSCOPE_TRACER);
    return this.withActiveContext(() => tracer.startActiveSpan(name, (span: Span) => {
      this.applyCommonAttrs(span);
      try {
        const result = fn(span);
        if (result instanceof Promise) {
          return (result as any).then(
            (v: T) => { span.end(); return v; },
            (e: any) => {
              span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
              span.end();
              throw e;
            },
          );
        }
        span.end();
        return result;
      } catch (e) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
        span.end();
        throw e;
      }
    }));
  }

  public recordEvent(name: string, attributes: Record<string, string | number | boolean> = {}) {
    this.emitSpan(name, attributes);
  }

  public async forceFlush(): Promise<void> {
    await Promise.all([
      this.processor?.forceFlush(),
      this.metricReader?.forceFlush(),
    ]);
  }
  public updateSessionId(sessionId: string) { this.sessionId = sessionId; }
  public setEnabled(enabled: boolean) { this._enabled = enabled; }

  public async shutdown(): Promise<void> {
    this.longTaskObserver?.disconnect();
    this.resourceObserver?.disconnect();
    this.endRouteChange();
    this.endPageview();
    if (this.flushOnHideHandler) {
      window.removeEventListener("pagehide", this.flushOnHideHandler);
      this.flushOnHideHandler = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this._configured = false;
    // allSettled — a metric pipeline shutdown failure must not abort trace
    // shutdown (and vice versa).
    await Promise.allSettled([
      this.provider.shutdown(),
      this.meterProvider?.shutdown() ?? Promise.resolve(),
    ]);
    this.meterProvider = null;
  }

  public setUser(newConfig: MonoscopeUser) {
    this.config = { ...this.config, user: { ...this.config.user, ...newConfig } };
  }
}
