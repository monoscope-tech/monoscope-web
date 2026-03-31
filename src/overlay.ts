const DISMISS_KEY = "monoscope-overlay-dismissed";

export class DevOverlay {
  private el: HTMLDivElement | null = null;
  private eventCount = 0;
  private statusDot: HTMLSpanElement | null = null;
  private countEl: HTMLSpanElement | null = null;
  private connEl: HTMLSpanElement | null = null;

  constructor() {
    if (typeof document === "undefined") return;
    try { if (sessionStorage.getItem(DISMISS_KEY)) return; } catch {}
    this.mount();
  }

  private mount() {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed", bottom: "12px", right: "12px", zIndex: "2147483647",
      background: "#1a1a2e", color: "#e0e0e0", fontFamily: "system-ui, sans-serif",
      fontSize: "12px", padding: "6px 10px", borderRadius: "6px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", gap: "6px",
      cursor: "default", userSelect: "none",
    });

    this.statusDot = document.createElement("span");
    Object.assign(this.statusDot.style, {
      width: "7px", height: "7px", borderRadius: "50%", background: "#22c55e", display: "inline-block",
    });

    this.countEl = document.createElement("span");
    this.countEl.textContent = "0";
    this.countEl.style.opacity = "0.7";

    this.connEl = document.createElement("span");
    this.connEl.style.opacity = "0.7";

    const close = document.createElement("span");
    close.textContent = "\u00d7";
    Object.assign(close.style, { cursor: "pointer", marginLeft: "4px", opacity: "0.6", fontSize: "14px" });
    close.onclick = () => this.dismiss();

    el.append(this.statusDot, " Monoscope ", this.countEl, " ", this.connEl, close);
    this.el = el;
    (document.body || document.documentElement).appendChild(el);
  }

  incrementEvents() {
    this.eventCount++;
    if (this.countEl) this.countEl.textContent = String(this.eventCount);
  }

  setConnectionStatus(ok: boolean) {
    if (this.connEl) this.connEl.textContent = ok ? "Connected" : "Connection failed";
    if (this.statusDot) this.statusDot.style.background = ok ? "#22c55e" : "#ef4444";
  }

  private dismiss() {
    this.el?.remove();
    this.el = null;
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
  }
}
