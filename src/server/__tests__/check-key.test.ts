import { describe, expect, it, vi } from "vitest";
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
vi.mock("@/lib/db", () => ({ db: {}, hasDatabase: () => false }));

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
});
