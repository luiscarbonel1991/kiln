import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/provider-keys", async () => {
  const { withProviderKeys } = await import("@/providers/keys");
  return {
    withMakerKeys: (makerId: string, work: () => Promise<unknown>) =>
      withProviderKeys({ openai: `sk-of-${makerId}` }, work),
  };
});

const { providerKey } = await import("@/providers/keys");
const { makerAction, makerPage, sessionRoute } = await import(
  "@/server/guarded"
);

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
});
