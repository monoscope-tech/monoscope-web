import type { Metric } from "web-vitals";

// Single source of truth — `WebVitalName` is derived from this array so a
// runtime guard and the compile-time type can never drift. If web-vitals adds
// a new metric upstream, the guard rejects it until we add it here.
export const WEB_VITAL_NAMES = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];

const isWebVitalName = (s: string): s is WebVitalName =>
  (WEB_VITAL_NAMES as readonly string[]).includes(s);

type RecordFn = (
  name: WebVitalName,
  value: number,
  attrs: Record<string, string | number | boolean>,
) => void;

// Captures Core Web Vitals via the web-vitals library; reports through the
// metrics pipeline.
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
        if (!isWebVitalName(m.name)) return;
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
