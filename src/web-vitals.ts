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
        this.emit(`web-vital.${m.name}`, {
          "vital.name": m.name,
          "vital.value": m.value,
          "vital.rating": m.rating,
          "vital.id": m.id,
          "vital.navigationType": m.navigationType,
        });
      };
      [onCLS, onINP, onLCP, onFCP, onTTFB].forEach(fn => fn(report));
    } catch (e) {
      console.warn("Monoscope: web-vitals collection failed to initialize", e);
    }
  }

  setEnabled(enabled: boolean) { this._enabled = enabled; }
}
