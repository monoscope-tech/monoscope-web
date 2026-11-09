import { expect, it } from "vitest";

// Regression for "TypeError: ae.observe is not a function": zone.js rebuilt IntersectionObserver
// from enumerable members only, so a browser whose `observe` is non-enumerable lost it.
it("leaves the host page's IntersectionObserver unpatched", async () => {
  class IO { constructor(_cb: unknown) {} }
  Object.defineProperty(IO.prototype, "observe", { value() {}, enumerable: false });
  (globalThis as any).IntersectionObserver = IO;
  await import("../tracing");
  expect(typeof (globalThis as any).Zone).toBe("function");
  expect(typeof new (globalThis as any).IntersectionObserver(() => {}).observe).toBe("function");
});
