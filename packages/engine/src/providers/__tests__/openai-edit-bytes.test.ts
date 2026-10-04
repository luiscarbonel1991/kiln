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
      prompt: "a scene\nAvoid: text overlay",
    });
    expect(edit.mock.calls[0][1]).toEqual({ timeout: 180_000, maxRetries: 0 });
    expect(storeAsset).not.toHaveBeenCalled();
  });

  it("an empty response is an error (retried by the queue, not here)", async () => {
    edit.mockResolvedValue({ data: [] });
    await expect(
      openaiImageProvider.editBytes?.(input, { timeoutMs: 1000 }),
    ).rejects.toThrow("OpenAI returned no image");
  });
});
