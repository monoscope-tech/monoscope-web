import type { Metric } from "web-vitals";

// Single source of truth — `WebVitalName` is derived from this array so a
// runtime guard and the compile-time type can never drift. If web-vitals adds
// a new metric upstream, the guard rejects it until we add it here.
export const WEB_VITAL_NAMES = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];

// Histogram bucket edges per vital. Google's good/poor thresholds are edges, so a P75 is
// rated from its bucket alone; OTel's defaults (0, 5, 10 … 10000) put every CLS score in
// one bucket and straddle the LCP/FCP/TTFB thresholds.
export const WEB_VITAL_BUCKETS: Record<WebVitalName, number[]> = {
  LCP: [500, 1000, 1500, 2000, 2500, 3000, 4000, 6000, 10000, 20000],
  INP: [50, 100, 200, 300, 400, 500, 1000, 2000],
  CLS: [0.01, 0.05, 0.1, 0.15, 0.2, 0.25, 0.4, 0.6, 1],
  FCP: [500, 1000, 1800, 2400, 3000, 4000, 6000, 10000],
  TTFB: [100, 200, 400, 600, 800, 1200, 1800, 3000, 6000],
};

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
