import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newId, shortPath, describeElement, closestInteractive } from "../tracing";
import { SPARouter } from "../router";

describe("newId", () => {
  it("returns uuid-shaped strings that are unique", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it("falls back when crypto.randomUUID is unavailable", () => {
    const orig = (crypto as any).randomUUID;
    (crypto as any).randomUUID = undefined;
    try {
      const id = newId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      (crypto as any).randomUUID = orig;
    }
  });
});

describe("shortPath", () => {
  it("strips origin and truncates query", () => {
    expect(shortPath("https://api.example.com/v1/orders?id=123")).toBe("/v1/orders?…");
    expect(shortPath("https://example.com/")).toBe("/");
    expect(shortPath("/already/relative")).toBe("/already/relative");
  });
  it("degrades gracefully for garbage input", () => {
    const s = shortPath("not a url at all but still a string");
    expect(typeof s).toBe("string");
    expect(s.length).toBeLessThanOrEqual(80);
  });
});

describe("describeElement", () => {
  it("prefers aria-label", () => {
    const el = document.createElement("button");
    el.setAttribute("aria-label", "Save changes");
    el.textContent = "Save";
    expect(describeElement(el)).toBe("Save changes");
  });
  it("falls back to text content", () => {
    const el = document.createElement("button");
    el.textContent = "  Click me  ";
    expect(describeElement(el)).toBe("Click me");
  });
  it("falls back to tag + id/class", () => {
    const el = document.createElement("div");
    el.id = "hero";
    el.setAttribute("class", "card primary");
    expect(describeElement(el)).toBe("div#hero.card");
  });
  it("handles null/undefined", () => {
    expect(describeElement(null)).toBe("?");
    expect(describeElement(undefined)).toBe("?");
  });
});

describe("closestInteractive", () => {
  it("returns the element itself when interactive", () => {
    const btn = document.createElement("button");
    expect(closestInteractive(btn)).toBe(btn);
  });
  it("climbs to the nearest interactive ancestor", () => {
    const btn = document.createElement("button");
    const span = document.createElement("span");
    btn.appendChild(span);
    document.body.appendChild(btn);
    expect(closestInteractive(span)).toBe(btn);
    btn.remove();
  });
  it("recognises role=button on a non-button tag", () => {
    const div = document.createElement("div");
    div.setAttribute("role", "button");
    expect(closestInteractive(div)).toBe(div);
  });
  it("opts in via data-monoscope-track", () => {
    const div = document.createElement("div");
    div.setAttribute("data-monoscope-track", "");
    expect(closestInteractive(div)).toBe(div);
  });
  it("returns null when no interactive ancestor exists", () => {
    const span = document.createElement("span");
    document.body.appendChild(span);
    expect(closestInteractive(span)).toBeNull();
    span.remove();
  });
  it("ignores <a> without href (not navigable)", () => {
    const a = document.createElement("a");
    expect(closestInteractive(a)).toBeNull();
  });
});

describe("OpenTelemetryManager web vitals", () => {
  beforeEach(() => sessionStorage.clear());

  it("recordWebVital: caches one histogram per vital with correct unit", async () => {
    const { OpenTelemetryManager } = await import("../tracing");
    const m = new OpenTelemetryManager({ apiKey: "k" } as any, "s", "t");

    // Mock the meter provider to spy on histogram creation/recording without
    // booting a real exporter.
    const histograms: { name: string; unit?: string; records: any[] }[] = [];
    const fakeMeter = {
      createHistogram: (name: string, opts: { unit?: string }) => {
        const h = { name, unit: opts.unit, records: [] as any[] };
        histograms.push(h);
        return { record: (v: number, a: any) => h.records.push({ v, a }) } as any;
      },
    };
    (m as any).meterProvider = { getMeter: () => fakeMeter };

    m.recordWebVital("LCP", 1200, { "web_vital.rating": "good" });
    m.recordWebVital("LCP", 1500, { "web_vital.rating": "good" });
    m.recordWebVital("CLS", 0.1, { "web_vital.rating": "good" });

    expect(histograms).toHaveLength(2);
    expect(histograms.map(h => h.name).sort()).toEqual([
      "browser.web_vital.cls",
      "browser.web_vital.lcp",
    ]);
    const lcp = histograms.find(h => h.name === "browser.web_vital.lcp")!;
    const cls = histograms.find(h => h.name === "browser.web_vital.cls")!;
    expect(lcp.unit).toBe("ms");
    expect(cls.unit).toBe("1");
    expect(lcp.records).toHaveLength(2);
    expect(cls.records).toHaveLength(1);
    expect(lcp.records[0].v).toBe(1200);
  });

  it("constructor swallows MeterProvider init failure (never throws into host)", async () => {
    const { OpenTelemetryManager } = await import("../tracing");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Force createMeterProvider to throw by passing a config that the
    // OTLPMetricExporter constructor will reject — easiest path: monkey-patch
    // the prototype, but cleaner: stub via a subclass.
    class Boom extends OpenTelemetryManager {
      protected createMeterProvider(): any { throw new Error("kaboom"); }
    }
    expect(() => new Boom({ apiKey: "k", debug: true } as any, "s", "t")).not.toThrow();
    spy.mockRestore();
  });

  it("captureWebVitals:false skips MeterProvider entirely", async () => {
    const { OpenTelemetryManager } = await import("../tracing");
    const m = new OpenTelemetryManager({ apiKey: "k", captureWebVitals: false } as any, "s", "t");
    expect((m as any).meterProvider).toBeNull();
    m.recordWebVital("LCP", 1, {}); // must be a no-op, not throw
  });
});

describe("Monoscope session-storage behaviors", () => {
  // enabled:false skips otel.configure/replay.configure/etc. so we can exercise
  // id resolution without booting the full provider/rrweb stack in jsdom.
  const makeConfig = (over: Record<string, unknown> = {}) =>
    ({ apiKey: "test-key", enabled: false, debug: false, ...over } as any);

  beforeEach(() => sessionStorage.clear());

  it("tabId persists across Monoscope instances in the same tab", async () => {
    const { default: Monoscope } = await import("..");
    const a = new Monoscope(makeConfig());
    const b = new Monoscope(makeConfig());
    expect(a.getTabId()).toBe(b.getTabId());
    expect(sessionStorage.getItem("monoscope-tab-id")).toBe(a.getTabId());
  });

  it("sessionId persists across Monoscope instances if within timeout", async () => {
    const { default: Monoscope } = await import("..");
    const a = new Monoscope(makeConfig());
    const b = new Monoscope(makeConfig());
    expect(a.getSessionId()).toBe(b.getSessionId());
  });

  it("sticky sampling: once sampled out, stays out for the tab", async () => {
    const { OpenTelemetryManager } = await import("../tracing");
    const m1 = new OpenTelemetryManager(
      { apiKey: "k", sampleRate: 0 } as any,
      "session-1", "tab-1",
    );
    m1.configure();
    expect(sessionStorage.getItem("monoscope-sampled")).toBe("0");

    // A second manager with sampleRate:1 must still honour the cached decision.
    const m2 = new OpenTelemetryManager(
      { apiKey: "k", sampleRate: 1 } as any,
      "session-1", "tab-1",
    );
    m2.configure();
    expect(sessionStorage.getItem("monoscope-sampled")).toBe("0");
  });

  it("sticky sampling: once sampled in, stays in for the tab", async () => {
    const { OpenTelemetryManager } = await import("../tracing");
    const m1 = new OpenTelemetryManager(
      { apiKey: "k", sampleRate: 1 } as any,
      "session-1", "tab-1",
    );
    m1.configure();
    expect(sessionStorage.getItem("monoscope-sampled")).toBe("1");
    expect(m1.getPageviewId()).toMatch(/^[0-9a-f-]{36}$/);
    await m1.shutdown();
  });

  it("falls back cleanly when sessionStorage throws", async () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("quota"); };
    try {
      const { default: Monoscope } = await import("..");
      const m = new Monoscope(makeConfig());
      expect(m.getTabId()).toMatch(/^[0-9a-f-]{36}$/);
      expect(m.getSessionId()).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      Storage.prototype.getItem = orig;
    }
  });
});

describe("SPARouter", () => {
  let onNavigation: ReturnType<typeof vi.fn>;
  let router: SPARouter;

  beforeEach(() => {
    // Start every test from a known URL so the first pushState in a test is
    // a real transition (not a same-URL no-op).
    history.replaceState(null, "", "/test-start");
    onNavigation = vi.fn();
    router = new SPARouter(onNavigation);
    router.start();
  });

  afterEach(() => router.stop());

  it("fires on pushState with method, from, and to", () => {
    const before = location.href;
    history.pushState(null, "", "/next");
    expect(onNavigation).toHaveBeenCalledTimes(1);
    const [from, to, method] = onNavigation.mock.calls[0];
    expect(from).toBe(before);
    expect(to).toBe(location.href);
    expect(method).toBe("pushState");
  });

  it("fires on replaceState", () => {
    history.pushState(null, "", "/a");
    onNavigation.mockClear();
    history.replaceState(null, "", "/b");
    expect(onNavigation).toHaveBeenCalledTimes(1);
    expect(onNavigation.mock.calls[0][2]).toBe("replaceState");
  });

  it("does not fire when URL is unchanged", () => {
    history.pushState(null, "", location.pathname);
    expect(onNavigation).not.toHaveBeenCalled();
  });

  it("swallows handler errors so user code never sees a throw from patched history", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    onNavigation.mockImplementation(() => { throw new Error("boom"); });
    expect(() => history.pushState(null, "", "/err")).not.toThrow();
    spy.mockRestore();
  });

  it("stop() restores original history methods", () => {
    const patched = history.pushState;
    router.stop();
    expect(history.pushState).not.toBe(patched);
    history.pushState(null, "", "/after-stop");
    expect(onNavigation).not.toHaveBeenCalled();
  });
});
