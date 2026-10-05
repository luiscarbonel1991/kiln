import { afterEach, describe, expect, it, vi } from "vitest";

const edit = vi.fn();
const storeAsset = vi.fn();

vi.mock("@/providers/openai/client", () => ({
  hasOpenAIKey: () => true,
  getOpenAI: () => ({ images: { edit } }),
}));
vi.mock("@/providers/asset-bytes", () => ({
  fetchAsset: async () => ({
    bytes: Buffer.from("png"),
    base64: "",
    mime: "image/png",
  }),
  storeAsset,
}));

const { openaiImageProvider } = await import("@/providers/openai/image");

const input = {
  masterAssetUrl: "https://stub.local/plate.png",
  prompt: "a scene",
  imageInputs: [],
  negative: "text overlay",
  model: {
    provider: "openai" as const,
    model: "gpt-image-2",
    aspect: "4:5",
    guidance: 7.5,
    strength: 0.65,
  },
};

afterEach(() => vi.clearAllMocks());

describe("openai editBytes (the queue's edit)", () => {
  it("returns bytes and mapped usage, stores nothing, and leaves retries to the queue", async () => {
    edit.mockResolvedValue({
      data: [{ b64_json: Buffer.from("image").toString("base64") }],
      usage: {
        input_tokens: 1300,
        input_tokens_details: { image_tokens: 1100, text_tokens: 200 },
        output_tokens: 4000,
      },
    });
    const result = await openaiImageProvider.editBytes?.(input, {
      timeoutMs: 180_000,
    });
    expect(Buffer.from(result?.bytes ?? []).toString()).toBe("image");
    expect(result?.usage).toEqual({
      inputTextTokens: 200,
      inputImageTokens: 1100,
      outputTokens: 4000,
    });
    expect(edit.mock.calls[0][0]).toMatchObject({
      model: "gpt-image-2",
      size: "1024x1536",
      quality: "medium",
      prompt: "a scene\nAvoid: text overlay",
    });
    expect(edit.mock.calls[0][1]).toEqual({ timeout: 180_000, maxRetries: 0 });
    expect(storeAsset).not.toHaveBeenCalled();
  });

  it("an answer without an image still returns its usage (it was paid)", async () => {
    edit.mockResolvedValue({
      data: [],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    const result = await openaiImageProvider.editBytes?.(input, {
      timeoutMs: 1000,
    });
    expect(result?.bytes).toBeNull();
    expect(result?.usage?.outputTokens).toBe(20);
  });

  it("beforeCall runs right before the paid request; if it throws, none is made", async () => {
    const order: string[] = [];
    edit.mockImplementation(async () => {
      order.push("edit");
      return { data: [{ b64_json: "aW1n" }] };
    });
    await openaiImageProvider.editBytes?.(input, {
      timeoutMs: 1000,
      beforeCall: async () => {
        order.push("mark");
      },
    });
    expect(order).toEqual(["mark", "edit"]);

    edit.mockClear();
    await expect(
      openaiImageProvider.editBytes?.(input, {
        timeoutMs: 1000,
        beforeCall: async () => {
          throw new Error("lease lost");
        },
      }),
    ).rejects.toThrow("lease lost");
    expect(edit).not.toHaveBeenCalled();
  });
});

describe("openai edit (the studio's direct call)", () => {
  it("marks the call right before the request and makes exactly one", async () => {
    const order: string[] = [];
    storeAsset.mockResolvedValue("https://stub.local/out.png");
    edit.mockImplementation(async () => {
      order.push("edit");
      return { data: [{ b64_json: "aW1n" }] };
    });
    await openaiImageProvider.edit(input, {
      beforeCall: async () => {
        order.push("mark");
      },
    });
    expect(order).toEqual(["mark", "edit"]);
    expect(edit.mock.calls[0][1]).toEqual({ maxRetries: 0 });
  });
});
