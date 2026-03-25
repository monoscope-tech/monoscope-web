import { addBreadcrumb } from "./breadcrumbs";

type EmitFn = (name: string, attrs: Record<string, string | number>) => void;

export class SPARouter {
  private emit: EmitFn;
  private currentUrl = "";
  private _active = false;
  private origPushState: typeof history.pushState | null = null;
  private origReplaceState: typeof history.replaceState | null = null;
  private popstateHandler: (() => void) | null = null;

  constructor(emit: EmitFn) {
    this.emit = emit;
  }

  start() {
    if (typeof window === "undefined" || this._active) return;
    this._active = true;
    this.currentUrl = location.href;

    this.origPushState = history.pushState.bind(history);
    this.origReplaceState = history.replaceState.bind(history);

    const onNav = (method: string) => {
      try {
        const from = this.currentUrl;
        const to = location.href;
        if (from === to) return;
        this.currentUrl = to;
        addBreadcrumb({ type: "navigation", message: `${from} → ${to}`, data: { method } });
        this.emit("navigation", {
          "navigation.from": from,
          "navigation.to": to,
          "navigation.method": method,
          "page.title": document.title,
        });
      } catch (e) {
        try { console.warn("Monoscope: error in navigation tracking", e); } catch { /* must never throw */ }
      }
    };

    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      this.origPushState!(...args);
      onNav("pushState");
    };

    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      this.origReplaceState!(...args);
      onNav("replaceState");
    };

    this.popstateHandler = () => onNav("popstate");
    window.addEventListener("popstate", this.popstateHandler);
  }

  stop() {
    if (typeof window === "undefined" || !this._active) return;
    this._active = false;
    if (this.origPushState) history.pushState = this.origPushState;
    if (this.origReplaceState) history.replaceState = this.origReplaceState;
    if (this.popstateHandler) window.removeEventListener("popstate", this.popstateHandler);
    this.origPushState = null;
    this.origReplaceState = null;
    this.popstateHandler = null;
  }
}
