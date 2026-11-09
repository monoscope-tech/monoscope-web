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
