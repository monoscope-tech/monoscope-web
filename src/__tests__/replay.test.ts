import { afterEach, describe, expect, it, vi } from "vitest";
import { MonoscopeReplay } from "../replay";

describe("MonoscopeReplay", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Regression: a user passed to the constructor reached spans but never the replay
  // payload, so every replay of a logged-in user was stored as an anonymous session.
  it("sends the constructor's user and tenant with replay events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const replay = new MonoscopeReplay({ apiKey: "k", user: { email: "a@b.c", name: "A" }, tenant: { id: "t1" } }, "sid", "tab");
    (replay as any).events.push({ type: 3, data: {}, timestamp: 1 });
    await replay.save();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.user).toEqual({ email: "a@b.c", name: "A" });
    expect(body.tenant).toEqual({ id: "t1" });
    replay.stop();
  });
});
