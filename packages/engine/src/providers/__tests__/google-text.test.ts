import { afterEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();

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
}));

const { googleVisionProvider } = await import("@/providers/google/vision");

const usageMetadata = {
  promptTokenCount: 1400,
  promptTokensDetails: [{ modality: "IMAGE", tokenCount: 1100 }],
  candidatesTokenCount: 250,
  thoughtsTokenCount: 120,
};

afterEach(() => vi.clearAllMocks());

describe("Gemini text calls", () => {
  it("drafts a product: one request, its schema, bounded output, thinking low, usage", async () => {
    const draft = {
      name: "Slate coaster",
      whatItIs: "square coaster",
      material: "natural slate",
      treatment: "engraved",
      colours: [{ name: "Charcoal", hex: "#3A3A3A" }],
      wording: [],
      useContext: "a coffee table",
    };
    const order: string[] = [];
    generateContent.mockImplementation(async () => {
      order.push("call");
      return { text: JSON.stringify(draft), usageMetadata };
    });
    const result = await googleVisionProvider.draftProduct(
      { assetUrl: "https://store/slate.png" },
      {
        model: "gemini-3.8-flash",
        beforeCall: async () => {
          order.push("mark");
        },
      },
    );
    expect(order).toEqual(["mark", "call"]);
    expect(result).toEqual({
      value: draft,
      model: "gemini-3.8-flash",
      usage: {
        inputTextTokens: 300,
        inputImageTokens: 1100,
        outputTokens: 370,
      },
    });
    const call = generateContent.mock.calls[0][0];
    expect(call.config).toMatchObject({
      maxOutputTokens: 2000,
      thinkingConfig: { thinkingLevel: "LOW" },
      httpOptions: { timeout: 60_000 },
      automaticContinuation: false,
    });
    expect(call.config.responseSchema.required).toContain("treatment");
  });

  it("thinks at the route's effort, at most at high, with the output and time it buys", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        name: "x",
        whatItIs: "x",
        material: "x",
        treatment: "engraved",
        colours: [],
        wording: [],
        useContext: "x",
      }),
      usageMetadata,
    });
    await googleVisionProvider.draftProduct(
      { assetUrl: "https://store/slate.png" },
      { model: "gemini-4-argon", effort: "xhigh" },
    );
    expect(generateContent.mock.calls[0][0].config).toMatchObject({
      maxOutputTokens: 8_000,
      thinkingConfig: { thinkingLevel: "HIGH" },
      httpOptions: { timeout: 150_000 },
    });
  });

  it("an answer outside the shape throws after the call (never invented)", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({ name: "x", treatment: "laser" }),
      usageMetadata,
    });
    await expect(
      googleVisionProvider.draftProduct(
        { assetUrl: "https://store/x.png" },
        { model: "gemini-3.8-flash" },
      ),
    ).rejects.toThrow();
  });
});
