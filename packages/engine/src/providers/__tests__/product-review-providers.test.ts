import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewField } from "@/providers/text-prompts";

const parse = vi.fn();
const generateContent = vi.fn();

vi.mock("@/providers/openai/client", () => ({
  hasOpenAIKey: () => true,
  getOpenAI: () => ({ responses: { parse } }),
}));
vi.mock("@/providers/google/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasGoogleKey: () => true,
  getGenAI: () => ({ models: { generateContent } }),
}));

const { openaiArtDirector } = await import("@/providers/openai/art-director");
const { googleArtDirector } = await import("@/providers/google/art-director");

const fields: ReviewField[] = [
  { field: "name", value: "Engraved name keychain", maxChars: 80 },
  { field: "wording.0.label", value: "Sofia", maxChars: 40 },
  { field: "wording.0.example", value: "", maxChars: 60 },
];
const review = {
  suggestions: [
    {
      field: "wording.0.label",
      value: "Name",
      why: "The buyer is asked for a name; Sofia is the example.",
    },
  ],
  checks: [],
};

afterEach(() => vi.clearAllMocks());

describe("reviewing a product form (no image)", () => {
  it("OpenAI: one text request, marked first, never retried, its schema and budget", async () => {
    const order: string[] = [];
    parse.mockImplementation(async () => {
      order.push("call");
      return {
        output_parsed: review,
        usage: { input_tokens: 1400, output_tokens: 300 },
      };
    });
    const result = await openaiArtDirector.reviewProduct(
      { fields },
      {
        model: "gpt-6.1-sol",
        beforeCall: async () => {
          order.push("mark");
        },
      },
    );
    expect(order).toEqual(["mark", "call"]);
    expect(result.value).toEqual(review);
    expect(result.usage).toEqual({
      inputTextTokens: 1400,
      inputImageTokens: 0,
      outputTokens: 300,
    });
    const [body, options] = parse.mock.calls[0];
    expect(options).toEqual({ maxRetries: 0, timeout: 60_000 });
    expect(body).toMatchObject({
      model: "gpt-6.1-sol",
      max_output_tokens: 2000,
      reasoning: { effort: "low" },
    });
    expect(body.text.format.name).toBe("review");
    expect(body.input[0].content).toHaveLength(1);
    const prompt: string = body.input[0].content[0].text;
    expect(prompt).toContain('"field": "wording.0.label"');
    expect(prompt).toContain("Never suggest a size or a price");
  });

  it("Gemini: one text request with its schema, bounded, thinking low", async () => {
    const order: string[] = [];
    generateContent.mockImplementation(async () => {
      order.push("call");
      return {
        text: JSON.stringify(review),
        usageMetadata: { promptTokenCount: 1400, candidatesTokenCount: 300 },
      };
    });
    const result = await googleArtDirector.reviewProduct(
      { fields },
      {
        model: "gemini-3.8-flash",
        beforeCall: async () => {
          order.push("mark");
        },
      },
    );
    expect(order).toEqual(["mark", "call"]);
    expect(result.value).toEqual(review);
    const [call] = generateContent.mock.calls[0];
    expect(call.contents).toHaveLength(1);
    expect(call.config).toMatchObject({
      responseMimeType: "application/json",
      maxOutputTokens: 2000,
    });
    expect(call.config.responseSchema.required).toEqual([
      "suggestions",
      "checks",
    ]);
  });

  it("Gemini: an answer out of shape throws, never a stand-in", async () => {
    generateContent.mockResolvedValue({ text: '{"suggestions": "none"}' });
    await expect(
      googleArtDirector.reviewProduct(
        { fields },
        { model: "gemini-3.8-flash" },
      ),
    ).rejects.toThrow();
  });

  it("refuses a model Kiln does not offer, before any request", async () => {
    await expect(
      openaiArtDirector.reviewProduct({ fields }, { model: "gpt-unknown" }),
    ).rejects.toThrow();
    expect(parse).not.toHaveBeenCalled();
  });
});
