import { afterEach, describe, expect, it, vi } from "vitest";
import { listingDraft } from "@/domain/listing";
import { SEED_DESTINATIONS } from "@/domain/seed";
import { CUTTING_BOARD } from "../../domain/__tests__/fixtures/cutting-board";

const parse = vi.fn();
const generateContent = vi.fn();

vi.mock("@/providers/openai/client", () => ({
  hasOpenAIKey: () => true,
  getOpenAI: () => ({ responses: { parse } }),
}));
vi.mock("@/providers/google/client", () => ({
  hasGoogleKey: () => true,
  getGenAI: () => ({ models: { generateContent } }),
}));

const { openaiArtDirector } = await import("@/providers/openai/art-director");
const { googleArtDirector } = await import("@/providers/google/art-director");

const rules = SEED_DESTINATIONS.find((d) => d.id === "etsy")?.text;
if (!rules) throw new Error("Etsy has no text rules");
const input = {
  channel: "Etsy",
  product: { ...CUTTING_BOARD, price: 48 },
  rules,
  draft: listingDraft(CUTTING_BOARD, rules),
};
const copy = {
  title: "Maple cutting board, engraved family name, 16 x 10 in",
  description: "A board for the family table.\n\nWHAT YOU GET\n· One board.",
  tags: ["cutting board", "family name board"],
  materials: ["maple"],
};

afterEach(() => vi.clearAllMocks());

describe("writing a listing's prose (no image)", () => {
  it("OpenAI: one text request, marked first, never retried, its schema and budget", async () => {
    const order: string[] = [];
    parse.mockImplementation(async () => {
      order.push("call");
      return {
        output_parsed: copy,
        usage: { input_tokens: 1800, output_tokens: 700 },
      };
    });
    const result = await openaiArtDirector.writeListing(input, {
      model: "gpt-6.1-sol",
      beforeCall: async () => {
        order.push("mark");
      },
    });
    expect(order).toEqual(["mark", "call"]);
    expect(result.value).toEqual(copy);
    const [body, options] = parse.mock.calls[0];
    expect(options).toEqual({ maxRetries: 0, timeout: 60_000 });
    expect(body).toMatchObject({
      model: "gpt-6.1-sol",
      max_output_tokens: 3000,
    });
    expect(body.input[0].content).toHaveLength(1);
    expect(body.input[0].content[0].type).toBe("input_text");
    const prompt: string = body.input[0].content[0].text;
    expect(prompt).toContain("exactly 13 tags, each at most 20 characters");
    expect(prompt).toContain("invent no feature");
    expect(prompt).toContain('"Cherry (out of stock)"');
  });

  it("Gemini: one text request with its schema, bounded, thinking low", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify(copy),
      usageMetadata: { promptTokenCount: 1800, candidatesTokenCount: 700 },
    });
    const result = await googleArtDirector.writeListing(input, {
      model: "gemini-3.8-flash",
    });
    expect(result.value).toEqual(copy);
    const [call] = generateContent.mock.calls[0];
    expect(call.contents).toHaveLength(1);
    expect(call.contents[0]).toHaveProperty("text");
    expect(call.config).toMatchObject({
      responseMimeType: "application/json",
      maxOutputTokens: 3000,
    });
    expect(call.config.responseSchema.required).toEqual([
      "title",
      "description",
      "tags",
      "materials",
    ]);
  });
});
