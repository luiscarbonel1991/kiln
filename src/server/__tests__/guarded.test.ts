import { describe, expect, it, vi } from "vitest";

// Who is signed in: one studio, its owner or one of the people who work
// with them.
const who = vi.hoisted(() => ({
  role: "owner" as "owner" | "member",
  member: "m1",
}));
vi.mock("@/server/session", () => ({
  requireMaker: async () => ({
    id: "test",
    slug: "test",
    name: "Test",
    member: { id: who.member, userId: `u-${who.member}`, role: who.role },
  }),
  denyWithoutSession: async () => null,
}));
// The keys each caller's work runs on, by the studio's rule: Bob has a key
// given to him; everyone else, and a token, the studio's team key. Fixture
// keys only.
vi.mock("@/server/provider-keys", async () => {
  const { withProviderKeys } = await import("@/providers/keys");
  return {
    withMakerKeys: (
      maker: { id: string; member?: { id: string } },
      work: () => Promise<unknown>,
    ) =>
      maker.member?.id === "bob"
        ? withProviderKeys({ openai: `sk-bob-of-${maker.id}` }, work, {
            openai: `key-bob-of-${maker.id}`,
          })
        : withProviderKeys({ openai: `sk-of-${maker.id}` }, work, {
            openai: `key-team-of-${maker.id}`,
          }),
  };
});
// A token's caller: the studio, and no person.
vi.mock("@/server/http-api", () => ({
  authorizeToken: async () => ({
    tokenId: "t1",
    maker: { id: "test" },
    tokenName: "Token",
    canSpend: true,
  }),
  apiError: (status: number, message: string) =>
    Response.json({ error: message }, { status }),
}));

const { providerKey, providerKeyId } = await import("@/providers/keys");
const {
  makerAction,
  makerPage,
  OwnerOnly,
  ownerAction,
  sessionRoute,
  tokenRoute,
} = await import("@/server/guarded");

const as = <T>(member: string, work: () => Promise<T>) => {
  who.member = member;
  return work().finally(() => {
    who.member = "m1";
  });
};

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

// Several keys in one studio: each person's work runs on their own reach,
// decided by who the session says they are.
describe("the guarded shapes run on the caller's own keys", () => {
  const seen = makerAction(async () => [
    providerKey("openai"),
    providerKeyId("openai"),
  ]);

  it("an action as Bob sees Bob's key, and an action as Carla the team's, in one studio", async () => {
    who.role = "member";
    try {
      expect(await as("bob", seen)).toEqual([
        "sk-bob-of-test",
        "key-bob-of-test",
      ]);
      expect(await as("carla", seen)).toEqual([
        "sk-of-test",
        "key-team-of-test",
      ]);
    } finally {
      who.role = "owner";
    }
  });

  it("a page as Bob renders with Bob's key", async () => {
    const page = makerPage(async () => providerKey("openai") ?? null);
    expect(await as("bob", page)).toBe("sk-bob-of-test");
  });

  it("a token runs on the studio's team key, never a person's", async () => {
    const route = tokenRoute(async (caller) =>
      Response.json({
        maker: caller.maker.id,
        key: providerKey("openai") ?? null,
        id: providerKeyId("openai") ?? null,
      }),
    );
    const response = await route(new Request("http://kiln.test/api/x"));
    expect(await response.json()).toEqual({
      maker: "test",
      key: "sk-of-test",
      id: "key-team-of-test",
    });
  });

  it("a streamed answer read after the handler returns still reads Bob's key and its id", async () => {
    const route = sessionRoute(async () => {
      let step = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          step++;
          if (step > 2) return controller.close();
          // A later step of the answer, read by whoever sends the response.
          await new Promise((r) => setTimeout(r, 1));
          controller.enqueue(
            new TextEncoder().encode(
              `${providerKey("openai")}|${providerKeyId("openai")};`,
            ),
          );
        },
      });
      return new Response(body);
    });
    const response = await as("bob", () => route());
    expect(await response.text()).toBe(
      "sk-bob-of-test|key-bob-of-test;sk-bob-of-test|key-bob-of-test;",
    );
  });
});
