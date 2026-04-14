import { Span, SpanStatusCode } from "@opentelemetry/api";
import { addBreadcrumb, getBreadcrumbs } from "./breadcrumbs";

function safeStringify(val: unknown): string {
  try { return JSON.stringify(val); } catch { return `[unserializable: ${typeof val}]`; }
}

type EmitFn = (name: string, attrs: Record<string, string | number>, configure?: (span: Span) => void) => void;

export class ErrorTracker {
  private emit: EmitFn;
  private errorCount = 0;
  private _active = false;
  private prevOnError: OnErrorEventHandler = null;
  private onUnhandledRejection: ((e: PromiseRejectionEvent) => void) | null = null;
  private origConsoleError: (typeof console)["error"] | null = null;
  private _processing = false;

  constructor(emit: EmitFn) {
    this.emit = emit;
  }

  private createErrorSpan(spanName: string, errorType: string, attrs: Record<string, string | number>) {
    this.errorCount++;
    const crumbs = getBreadcrumbs();
    const name = String(attrs["error.name"] || errorType);
    const msg = String(attrs["error.message"] || "").replace(/\s+/g, " ").slice(0, 80);
    this.emit(spanName, {
      "error.type": errorType,
      "error.count": this.errorCount,
      "monoscope.kind": "error",
      "monoscope.display.label": msg ? `${name} · ${msg}` : name,
      ...attrs,
    }, (s) => {
      s.setStatus({ code: SpanStatusCode.ERROR });
      if (crumbs.length > 0) s.setAttribute("breadcrumbs", safeStringify(crumbs));
    });
  }

  start() {
    if (typeof window === "undefined" || this._active) return;
    this._active = true;

    this.prevOnError = window.onerror;
    window.onerror = (
      event: Event | string, source?: string, lineno?: number, colno?: number, error?: Error,
    ) => {
      const attrs: Record<string, string | number> = {
        "error.message": typeof event === "string" ? event : event.type,
      };
      if (source) attrs["error.source"] = source;
      if (lineno !== undefined) attrs["error.lineno"] = lineno;
      if (colno !== undefined) attrs["error.colno"] = colno;
      if (error?.stack) attrs["error.stack"] = error.stack;
      if (error?.name) attrs["error.name"] = error.name;
      this.createErrorSpan("exception", "uncaught_exception", attrs);
      if (typeof this.prevOnError === "function") {
        return this.prevOnError.call(window, event, source, lineno, colno, error);
      }
    };

    this.onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const attrs: Record<string, string | number> = {};
      if (reason instanceof Error) {
        attrs["error.message"] = reason.message;
        attrs["error.name"] = reason.name;
        if (reason.stack) attrs["error.stack"] = reason.stack;
      } else {
        attrs["error.message"] = String(reason);
      }
      this.createErrorSpan("unhandled_rejection", "unhandled_rejection", attrs);
    };

    this.origConsoleError = console.error;
    console.error = (...args: any[]) => {
      this.origConsoleError?.apply(console, args);
      if (this._processing) return;
      this._processing = true;
      try {
        const message = args.map((a) =>
          a instanceof Error ? a.message : typeof a === "string" ? a : safeStringify(a),
        ).join(" ");
        const attrs: Record<string, string | number> = { "error.message": message };
        const errorArg = args.find((a) => a instanceof Error);
        if (errorArg) {
          attrs["error.name"] = errorArg.name;
          if (errorArg.stack) attrs["error.stack"] = errorArg.stack;
        }
        addBreadcrumb({ type: "console.error", message });
        this.createErrorSpan("console.error", "console_error", attrs);
      } finally {
        this._processing = false;
      }
    };

    window.addEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  stop() {
    if (typeof window === "undefined" || !this._active) return;
    this._active = false;
    window.onerror = this.prevOnError;
    this.prevOnError = null;
    if (this.onUnhandledRejection) {
      window.removeEventListener("unhandledrejection", this.onUnhandledRejection);
    }
    if (this.origConsoleError) {
      console.error = this.origConsoleError;
      this.origConsoleError = null;
    }
  }

  getErrorCount() { return this.errorCount; }
}
