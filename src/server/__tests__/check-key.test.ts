import { describe, expect, it, onTestFinished, vi } from "vitest";
import { catalogFor } from "@/domain/model-defaults";

// Checking a key compares the models the provider lists with the catalog.
const listed = vi.hoisted(() => ({ models: [] as string[] }));
vi.mock("@/providers/key-check", () => ({
  checkProviderKey: async () => ({
    ok: true,
    called: true,
    models: listed.models,
  }),
}));
const store = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/db", () => ({ db: {}, hasDatabase: () => store.on }));
const recordKeyCheck = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/server/generation-repository", async (original) => ({
  ...(await original<typeof import("@/server/generation-repository")>()),
  recordKeyCheck,
}));

const { checkKey } = await import("@/server/provider-health");

const offered = (provider: "openai" | "google") =>
  (["image", "video", "text"] as const)
    .flatMap((kind) => catalogFor(kind))
    .filter((m) => m.provider === provider)
    .map((m) => m.id);

describe("checkKey", () => {
  it("names the offered models the provider no longer lists", async () => {
    listed.models = offered("google").filter(
      (id) => id !== "gemini-omni-1.1-flash",
    );
    expect(await checkKey({ id: "test" }, "google")).toMatchObject({
      ok: true,
      unlisted: ["gemini-omni-1.1-flash"],
    });
    listed.models = offered("google");
    expect(await checkKey({ id: "test" }, "google")).toMatchObject({
      unlisted: [],
    });
  });

  // The check is recorded in the name of the person who ran it,
  // or no one's.
  it("records the check with the person who ran it, or none", async () => {
    store.on = true;
    onTestFinished(() => {
      store.on = false;
    });
    listed.models = offered("google");
    await checkKey(
      {
        id: "test",
        member: { id: "m1", userId: "u1", role: "owner" as const },
      },
      "google",
    );
    expect(recordKeyCheck).toHaveBeenLastCalledWith(
      expect.objectContaining({ makerId: "test", memberId: "m1" }),
    );
    await checkKey({ id: "test" }, "google");
    expect(recordKeyCheck).toHaveBeenLastCalledWith(
      expect.objectContaining({ makerId: "test", memberId: null }),
    );
  });
});
