import { describe, expect, it, vi } from "vitest";

const who = vi.hoisted(() => ({ role: "owner" as "owner" | "member" }));
vi.mock("@/server/session", () => ({
  requireMaker: async () => ({
    id: "test",
    slug: "test",
    name: "Test",
    member: { id: "m1", userId: "u1", role: who.role },
  }),
  denyWithoutSession: async () => null,
}));
vi.mock("@/server/provider-keys", async () => {
  const { withProviderKeys } = await import("@/providers/keys");
  return {
    withMakerKeys: (makerId: string, work: () => Promise<unknown>) =>
      withProviderKeys({ openai: `sk-of-${makerId}` }, work),
  };
});

const { providerKey } = await import("@/providers/keys");
const { makerAction, makerPage, OwnerOnly, ownerAction, sessionRoute } =
  await import("@/server/guarded");

describe("the guarded shapes run as the maker", () => {
  it("an action and a page see the maker's keys and no one else's", async () => {
    const action = makerAction(async (maker) => [
      maker.id,
      providerKey("openai"),
    ]);
    expect(await action()).toEqual(["test", "sk-of-test"]);
    const page = makerPage(async () => providerKey("openai") ?? null);
    expect(await page()).toBe("sk-of-test");
    expect(providerKey("openai")).toBeUndefined();
  });

  it("a streamed answer keeps the maker's keys while the response reads it", async () => {
    const route = sessionRoute(async () => {
      let step = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          step++;
          if (step > 2) return controller.close();
          controller.enqueue(
            new TextEncoder().encode(`${providerKey("openai")};`),
          );
        },
      });
      return new Response(body, { headers: { "x-kind": "chat" } });
    });
    const response = await route();
    expect(response.headers.get("x-kind")).toBe("chat");
    expect(await response.text()).toBe("sk-of-test;sk-of-test;");
  });

  it("an owner's action runs for the owner and refuses a member", async () => {
    const action = ownerAction(async (maker) => maker.member?.role);
    who.role = "owner";
    expect(await action()).toBe("owner");
    who.role = "member";
    await expect(action()).rejects.toBeInstanceOf(OwnerOnly);
    who.role = "owner";
  });
});
