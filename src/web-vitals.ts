import type { Metric } from "web-vitals";

type RecordFn = (
  name: string,
  value: number,
  attrs: Record<string, string | number | boolean>,
) => void;

/**
 * Captures Core Web Vitals (LCP/INP/CLS/FCP/TTFB) and reports them via the
 * OTel metrics pipeline. Vitals are aggregate measurements — they belong on
 * the metrics signal, not as spans/events.
 */
export class WebVitalsCollector {
  private record: RecordFn;
  private _enabled = true;
  private _active = false;

  constructor(record: RecordFn) {
    this.record = record;
  }

  async start() {
    if (typeof window === "undefined" || this._active) return;
    this._active = true;
    try {
      const { onCLS, onINP, onLCP, onFCP, onTTFB } = await import("web-vitals");
      const report = (m: Metric) => {
        if (!this._enabled) return;
        this.record(m.name, m.value, {
          "web_vital.rating": m.rating,
          "web_vital.id": m.id,
          "web_vital.navigation_type": m.navigationType,
        });
      };
      [onCLS, onINP, onLCP, onFCP, onTTFB].forEach(fn => fn(report));
    } catch (e) {
      console.warn("Monoscope: web-vitals collection failed to initialize", e);
    }
  }

  setEnabled(enabled: boolean) { this._enabled = enabled; }
}
