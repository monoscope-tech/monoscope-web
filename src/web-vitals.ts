import type { Metric } from "web-vitals";

type EmitFn = (name: string, attrs: Record<string, string | number>) => void;

export class WebVitalsCollector {
  private emit: EmitFn;
  private _enabled = true;
  private _active = false;

  constructor(emit: EmitFn) {
    this.emit = emit;
  }

  async start() {
    if (typeof window === "undefined" || this._active) return;
    this._active = true;
    try {
      const { onCLS, onINP, onLCP, onFCP, onTTFB } = await import("web-vitals");
      const report = (m: Metric) => {
        if (!this._enabled) return;
        // CLS is unitless; the others are milliseconds.
        const unit = m.name === "CLS" ? "" : "ms";
        const value = m.name === "CLS" ? m.value.toFixed(3) : Math.round(m.value);
        this.emit(`web-vital.${m.name}`, {
          "vital.name": m.name,
          "vital.value": m.value,
          "vital.rating": m.rating,
          "vital.id": m.id,
          "vital.navigationType": m.navigationType,
          "monoscope.kind": "web_vital",
          "monoscope.display.label": `${m.name} · ${value}${unit} (${m.rating})`,
        });
      };
      [onCLS, onINP, onLCP, onFCP, onTTFB].forEach(fn => fn(report));
    } catch (e) {
      console.warn("Monoscope: web-vitals collection failed to initialize", e);
    }
  }

  setEnabled(enabled: boolean) { this._enabled = enabled; }
}
