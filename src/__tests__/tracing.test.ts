import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newId, shortPath, describeElement } from "../tracing";
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
