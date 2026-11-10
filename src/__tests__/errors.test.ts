import { describe, expect, it, vi } from "vitest";
import { ErrorTracker } from "../errors";

describe("ErrorTracker unhandled rejections", () => {
  // Regression: a rejected plain object was filed as "unhandled_rejection: [object Object]".
  it.each([
    [{ message: "boom" }, "boom"],
    [{ code: 42 }, '{"code":42}'],
    ["plain", "plain"],
    [undefined, "undefined"],
  ])("describes a %o rejection", (reason, expected) => {
    const emit = vi.fn();
    const tracker = new ErrorTracker(emit, {});
    tracker.start();
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason, promise: Promise.resolve() }));
    tracker.stop();
    expect(emit.mock.calls[0][1]["error.message"]).toBe(expected);
  });
});

describe("ErrorTracker console.error", () => {
  const capture = (...args: unknown[]) => {
    const emit = vi.fn();
    const tracker = new ErrorTracker(emit, {});
    const silenced = vi.spyOn(console, "error").mockImplementation(() => {});
    tracker.start();
    console.error(...args);
    tracker.stop();
    silenced.mockRestore();
    return emit.mock.calls;
  };

  // Regression: htmx logs every dropped request ("htmx: htmx:error: Failed to fetch") and each
  // aborted fetch, and every one was filed as a runtime exception.
  it.each([
    ["htmx: htmx:error: Failed to fetch", new TypeError("Failed to fetch")],
    ["Failed to fetch new data:", new TypeError("Load failed")],
    ["htmx: htmx:error: signal is aborted without reason", new DOMException("signal is aborted without reason", "AbortError")],
  ])("keeps a transport failure out of issues: %s", (...args) => expect(capture(...args)).toEqual([]));

  it("files a real error as handled", () => {
    const [[name, attrs]] = capture("render failed:", new TypeError("x is undefined"));
    expect([name, attrs["exception.escaped"], attrs["error.message"]]).toEqual(["console.error", false, "render failed: x is undefined"]);
  });

  it("files an unhandled rejection as escaped", () => {
    const emit = vi.fn();
    const tracker = new ErrorTracker(emit, {});
    tracker.start();
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("boom"), promise: Promise.resolve() }));
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new DOMException("aborted", "AbortError"), promise: Promise.resolve() }));
    tracker.stop();
    expect(emit.mock.calls.map(([, a]) => [a["error.message"], a["exception.escaped"]])).toEqual([["boom", true]]);
  });
});
