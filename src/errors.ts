import { Span, SpanStatusCode } from "@opentelemetry/api";
import { addBreadcrumb, getBreadcrumbs } from "./breadcrumbs.js";

function safeStringify(val: unknown): string {
  try { return JSON.stringify(val); } catch { return `[unserializable: ${typeof val}]`; }
}

type EmitFn = (name: string, attrs: Record<string, string | number>, configure?: (span: Span) => void) => void;

const EXTENSION_URL_RE = /(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;

export function isExtensionError(...sources: (string | undefined | null)[]): boolean {
  return sources.some((s) => typeof s === "string" && EXTENSION_URL_RE.test(s));
}

export class ErrorTracker {
  private emit: EmitFn;
  private captureExtensionErrors: boolean;
  private debug: boolean;
  private errorCount = 0;
  private droppedExtensionCount = 0;
  private _active = false;
  private prevOnError: OnErrorEventHandler = null;
  private onUnhandledRejection: ((e: PromiseRejectionEvent) => void) | null = null;
  private origConsoleError: (typeof console)["error"] | null = null;
  private _processing = false;

  constructor(emit: EmitFn, opts: { captureExtensionErrors?: boolean; debug?: boolean } = {}) {
    this.emit = emit;
    this.captureExtensionErrors = !!opts.captureExtensionErrors;
    this.debug = !!opts.debug;
  }

  // Match only on source URL and stack — error.message is user-controlled and
  // a legit error mentioning an extension URL would be silently dropped.
  private shouldDrop(attrs: Record<string, string | number>): boolean {
    if (this.captureExtensionErrors) return false;
    if (!isExtensionError(
      attrs["error.source"] as string | undefined,
      attrs["error.stack"] as string | undefined,
    )) return false;
    this.droppedExtensionCount++;
    if (this.debug && this.origConsoleError) {
      this.origConsoleError.call(console, "[Monoscope] dropped extension error", {
        message: attrs["error.message"], source: attrs["error.source"],
      });
    }
    return true;
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
      if (this.shouldDrop(attrs)) {
        if (typeof this.prevOnError === "function") {
          return this.prevOnError.call(window, event, source, lineno, colno, error);
        }
        return;
      }
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
      if (this.shouldDrop(attrs)) return;
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
        if (this.shouldDrop(attrs)) return;
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
  getDroppedExtensionCount() { return this.droppedExtensionCount; }
}
