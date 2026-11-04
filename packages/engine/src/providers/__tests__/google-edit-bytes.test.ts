import { afterEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
const storeAsset = vi.fn(async () => "https://store/x.png");

vi.mock("@/providers/google/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasGoogleKey: () => true,
  getGenAI: () => ({ models: { generateContent } }),
}));
vi.mock("@/providers/asset-bytes", () => ({
  fetchAsset: async () => ({
    bytes: Buffer.from("png"),
    base64: "cG5n",
    mime: "image/png",
  }),
  storeAsset,
}));

const { googleImageProvider } = await import("@/providers/google/image");

const input = {
  masterAssetUrl: "https://stub.local/plate.png",
  prompt: "a scene",
  imageInputs: [],
  negative: "text overlay",
  model: {
    provider: "google" as const,
    model: "gemini-3.1-flash-image",
    aspect: "4:5",
    guidance: 7.5,
    strength: 0.65,
  },
};

const answer = (parts: unknown[], extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { parts } }],
  usageMetadata: {
    promptTokenCount: 1400,
    promptTokensDetails: [
      { modality: "TEXT", tokenCount: 300 },
      { modality: "IMAGE", tokenCount: 1100 },
    ],
    candidatesTokenCount: 1150,
    candidatesTokensDetails: [
      { modality: "IMAGE", tokenCount: 1120 },
      { modality: "TEXT", tokenCount: 30 },
    ],
    thoughtsTokenCount: 50,
  },
  ...extra,
});

afterEach(() => vi.clearAllMocks());

describe("google editBytes (the queue's edit)", () => {
  it("returns bytes and Gemini's usage, stores nothing, bounded by the queue's timeout", async () => {
    generateContent.mockResolvedValue(
      answer([
        { text: "here" },
        { inlineData: { data: Buffer.from("image").toString("base64") } },
      ]),
    );
    const result = await googleImageProvider.editBytes?.(input, {
      timeoutMs: 180_000,
    });
    expect(Buffer.from(result?.bytes ?? []).toString()).toBe("image");
    expect(result?.usage).toEqual({
      inputTextTokens: 300,
      inputImageTokens: 1100,
      outputTokens: 1120,
      outputTextTokens: 80,
    });
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe("gemini-3.1-flash-image");
    expect(call.config.imageConfig).toEqual({ aspectRatio: "3:4" });
    expect(call.config.httpOptions).toEqual({ timeout: 180_000 });
    // A continuation is another billed request; a paid call is one.
    expect(call.config.automaticContinuation).toBe(false);
    expect(call.contents[0]).toEqual({ text: "a scene\nAvoid: text overlay" });
    expect(storeAsset).not.toHaveBeenCalled();
  });

  it("asks for 2K where the model offers it, and never on Flash-Lite", async () => {
    generateContent.mockResolvedValue(
      answer([
        { inlineData: { data: Buffer.from("image").toString("base64") } },
      ]),
    );
    const big = { ...input, model: { ...input.model, size: "2k" as const } };
    await googleImageProvider.editBytes?.(big, { timeoutMs: 180_000 });
    expect(generateContent.mock.calls[0][0].config.imageConfig).toEqual({
      aspectRatio: "3:4",
      imageSize: "2K",
    });
    await googleImageProvider.editBytes?.(
      {
        ...big,
        model: { ...big.model, model: "gemini-3.1-flash-lite-image" },
      },
      { timeoutMs: 180_000 },
    );
    expect(generateContent.mock.calls[1][0].config.imageConfig).toEqual({
      aspectRatio: "3:4",
    });
  });

  it("an answer without an image keeps its usage and says why", async () => {
    generateContent.mockResolvedValue(
      answer([], { promptFeedback: { blockReason: "IMAGE_SAFETY" } }),
    );
    const result = await googleImageProvider.editBytes?.(input, {
      timeoutMs: 1000,
    });
    expect(result?.bytes).toBeNull();
    expect(result?.usage?.inputImageTokens).toBe(1100);
    expect(result?.refusal).toBe("Gemini returned no image: IMAGE_SAFETY");
  });

  it("beforeCall runs right before the paid request; if it throws, none is made", async () => {
    const order: string[] = [];
    generateContent.mockImplementation(async () => {
      order.push("call");
      return answer([{ inlineData: { data: "aW1n" } }]);
    });
    await googleImageProvider.editBytes?.(input, {
      timeoutMs: 1000,
      beforeCall: async () => {
        order.push("mark");
      },
    });
    expect(order).toEqual(["mark", "call"]);
    generateContent.mockClear();
    await expect(
      googleImageProvider.editBytes?.(input, {
        timeoutMs: 1000,
        beforeCall: async () => {
          throw new Error("canceled");
        },
      }),
    ).rejects.toThrow("canceled");
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("refuses a model Kiln does not offer before any call", async () => {
    await expect(
      googleImageProvider.editBytes?.(
        { ...input, model: { ...input.model, model: "gemini-9-image" } },
        { timeoutMs: 1000 },
      ),
    ).rejects.toMatchObject({ name: "ModelRefused" });
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe("google direct edit (studio)", () => {
  it("stores the image and returns the usage, so the spend row records the measured cost", async () => {
    generateContent.mockResolvedValue(
      answer([{ inlineData: { data: "aW1n" } }]),
    );
    const marks: string[] = [];
    const result = await googleImageProvider.edit(input, {
      beforeCall: async () => {
        marks.push("mark");
      },
    });
    expect(marks).toEqual(["mark"]);
    expect(result.provider).toBe("google");
    expect(result.usage?.outputTokens).toBe(1120);
    expect(storeAsset).toHaveBeenCalledOnce();
  });
});
