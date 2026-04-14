import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// rrweb ships a CJS-in-ESM file that vitest/jsdom can't load. We never
// exercise rrweb in unit tests; stub the full surface the SDK touches.
vi.mock("rrweb", () => ({
  record: () => () => undefined,
  EventType: { FullSnapshot: 2 },
}));
vi.mock("@rrweb/rrweb-plugin-console-record", () => ({
  getRecordConsolePlugin: () => ({}),
}));
