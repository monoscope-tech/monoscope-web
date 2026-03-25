import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { MonoscopeConfig, MonoscopeUser } from "./types";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { context, Span, SpanStatusCode, trace } from "@opentelemetry/api";

const MONOSCOPE_TRACER = "monoscope";

export class OpenTelemetryManager {
  private config: MonoscopeConfig;
  private sessionId: string;
  private tabId: string;
  private provider: WebTracerProvider;
  private longTaskObserver: PerformanceObserver | null = null;
  private resourceObserver: PerformanceObserver | null = null;
  private _enabled: boolean = true;
  private _configured: boolean = false;
  private pageSpan: Span | null = null;
  private pageContext: ReturnType<typeof context.active> | null = null;
  private endPageSpanHandler: (() => void) | null = null;

  constructor(config: MonoscopeConfig, sessionId: string, tabId: string) {
    this.config = config;
    this.sessionId = sessionId;
    this.tabId = tabId;
    this.provider = this.createProvider();
  }

  private createProvider(): WebTracerProvider {
    const { serviceName, resourceAttributes = {}, exporterEndpoint, projectId } = this.config;
    return new WebTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        "at-project-id": projectId,
        ...resourceAttributes,
      }),
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({
        url: exporterEndpoint || "https://otelcol.apitoolkit.io/v1/traces",
        headers: {},
      }))],
    });
  }

  private commonAttrs(): Record<string, string> {
    const attrs: Record<string, string> = {
      "session.id": this.sessionId,
      "tab.id": this.tabId,
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

    const rate = Math.max(0, Math.min(1, this.config.sampleRate ?? 1));
    if (Math.random() >= rate) {
      this._enabled = false;
      if (this.config.debug) console.log("MonoscopeOTel: sampled out");
      return;
    }

    this.provider.register({
      contextManager: new ZoneContextManager(),
      propagator: new W3CTraceContextPropagator(),
    });

    // Default to same-origin only to avoid leaking trace context to third parties
    const headerUrls = this.config.propagateTraceHeaderCorsUrls || [new RegExp(`^${location.origin}`)];
    const ignoreUrls = [
      /^https?:\/\/(?:[^\/]+\.)?apitoolkit\.io\//,
      /^https?:\/\/(?:[^\/]+\.)?monoscope\.tech\//,
    ];

    const addAttrs = (span: any) => this.applyCommonAttrs(span);

    registerInstrumentations({
      tracerProvider: this.provider,
      instrumentations: [
        ...((this.config.instrumentations || []) as any[]),
        new DocumentLoadInstrumentation({
          ignoreNetworkEvents: !this.config.enableNetworkEvents,
          applyCustomAttributesOnSpan: { documentLoad: addAttrs },
        }),
        new XMLHttpRequestInstrumentation({
          propagateTraceHeaderCorsUrls: headerUrls, ignoreUrls, applyCustomAttributesOnSpan: addAttrs,
        }),
        new FetchInstrumentation({
          propagateTraceHeaderCorsUrls: headerUrls, ignoreUrls, applyCustomAttributesOnSpan: addAttrs,
        }),
      ],
    });

    this.startPageSpan();
    this.observeLongTasks();
    this.observeResourceTiming();
  }

  private startPageSpan() {
    const tracer = trace.getTracer(MONOSCOPE_TRACER);
    this.pageSpan = tracer.startSpan("browser.session", { attributes: this.commonAttrs() });
    this.pageContext = trace.setSpan(context.active(), this.pageSpan);

    this.endPageSpanHandler = () => { this.pageSpan?.end(); this.pageSpan = null; };
    window.addEventListener("pagehide", this.endPageSpanHandler);
    window.addEventListener("beforeunload", this.endPageSpanHandler);
  }

  public getPageContext() { return this.pageContext; }

  private withPageContext<T>(fn: () => T): T {
    if (this.pageContext) return context.with(this.pageContext, fn);
    return fn();
  }

  public emitSpan(name: string, attrs: Record<string, string | number | boolean>, configure?: (span: Span) => void) {
    try {
      const tracer = trace.getTracer(MONOSCOPE_TRACER);
      this.withPageContext(() => tracer.startActiveSpan(name, (span: Span) => {
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
            };
            const attr = (entry as any).attribution;
            if (attr?.[0]?.containerSrc) attrs["longtask.script"] = attr[0].containerSrc;
            if (attr?.[0]?.containerName) attrs["longtask.container"] = attr[0].containerName;
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
            this.emitSpan("resource", {
              "resource.name": re.name,
              "resource.duration": re.duration,
              "resource.type": re.initiatorType,
              "resource.transferSize": re.transferSize,
              "resource.encodedBodySize": re.encodedBodySize,
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
    return this.withPageContext(() => tracer.startActiveSpan(name, (span: Span) => {
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

  public updateSessionId(sessionId: string) { this.sessionId = sessionId; }
  public setEnabled(enabled: boolean) { this._enabled = enabled; }

  public async shutdown(): Promise<void> {
    this.longTaskObserver?.disconnect();
    this.resourceObserver?.disconnect();
    if (this.endPageSpanHandler && typeof window !== "undefined") {
      this.endPageSpanHandler();
      window.removeEventListener("pagehide", this.endPageSpanHandler);
      window.removeEventListener("beforeunload", this.endPageSpanHandler);
      this.endPageSpanHandler = null;
    }
    this.pageSpan = null;
    this.pageContext = null;
    this._configured = false;
    await this.provider.shutdown();
  }

  public setUser(newConfig: MonoscopeUser) {
    this.config = { ...this.config, user: { ...this.config.user, ...newConfig } };
  }
}
