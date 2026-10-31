import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_BRAND, SEED_RECIPE } from "@/domain/seed";
import { MOCK_UNDERSTANDING } from "@/providers/mock/vision";

const parse = vi.fn();

vi.mock("@/providers/openai/client", () => ({
  hasOpenAIKey: () => true,
  getOpenAI: () => ({ responses: { parse } }),
}));
vi.mock("@/providers/asset-bytes", () => ({
  fetchAsset: async () => ({
    bytes: Buffer.from("png"),
    base64: "cG5n",
    mime: "image/png",
  }),
}));

const { openaiVisionProvider } = await import("@/providers/openai/vision");
const { openaiArtDirector } = await import("@/providers/openai/art-director");

const answer = {
  subject: "acrylic house number plaque",
  productType: "house number plaque",
  useContext: "mounted beside a front door",
  sceneProps: "",
  materials: "gloss black acrylic with raised white numerals",
  lighting: "soft daylight",
  composition: "centered, eye-level",
  mood: "clean, modern",
  palette: ["#111111", "#ffffff"],
};

afterEach(() => vi.clearAllMocks());

describe("OpenAI vision", () => {
  it("one request, never retried, bounded, reasoning low; usage for the measured cost", async () => {
    const order: string[] = [];
    parse.mockImplementation(async () => {
      order.push("call");
      return {
        output_parsed: answer,
        usage: { input_tokens: 1500, output_tokens: 400 },
      };
    });
    const result = await openaiVisionProvider.analyze(
      { assetUrl: "https://store/plaque.png" },
      {
        model: "gpt-6.1-sol",
        beforeCall: async () => {
          order.push("mark");
        },
      },
    );
    expect(order).toEqual(["mark", "call"]);
    expect(result.value).toMatchObject({ ...answer, avoid: "" });
    expect(result.usage).toEqual({
      inputTextTokens: 1500,
      inputImageTokens: 0,
      outputTokens: 400,
    });
    const [body, options] = parse.mock.calls[0];
    expect(options).toEqual({ maxRetries: 0, timeout: 60_000 });
    expect(body).toMatchObject({
      model: "gpt-6.1-sol",
      max_output_tokens: 3000,
      reasoning: { effort: "low" },
    });
    expect(body.text.format.type).toBe("json_schema");
    expect(body.input[0].content[1]).toEqual({
      type: "input_image",
      image_url: "data:image/png;base64,cG5n",
      detail: "high",
    });
  });

  it("sends the route's effort: that reasoning, more output and more time", async () => {
    parse.mockResolvedValue({
      output_parsed: answer,
      usage: { input_tokens: 1500, output_tokens: 400 },
    });
    await openaiVisionProvider.analyze(
      { assetUrl: "https://store/plaque.png" },
      { model: "gpt-6-astra", effort: "max" },
    );
    const [body, options] = parse.mock.calls[0];
    expect(options).toEqual({ maxRetries: 0, timeout: 300_000 });
    expect(body).toMatchObject({
      model: "gpt-6-astra",
      max_output_tokens: 48_000,
      reasoning: { effort: "max" },
    });
  });

  it("an answer it could not finish throws after the call (it was paid)", async () => {
    parse.mockResolvedValue({
      output_parsed: null,
      incomplete_details: { reason: "max_output_tokens" },
      usage: { input_tokens: 1500, output_tokens: 3000 },
    });
    await expect(
      openaiVisionProvider.analyze(
        { assetUrl: "https://store/plaque.png" },
        { model: "gpt-6.1-sol" },
      ),
    ).rejects.toThrow("gpt-6.1-sol returned no answer (max_output_tokens)");
  });
});

describe("OpenAI art director", () => {
  it("pins each direction to its slot and fills a short answer from the recipe", async () => {
    parse.mockResolvedValue({
      output_parsed: {
        variants: [
          {
            direction: "x",
            scene: "beside a front door",
            composition: "eye level",
            lighting: "daylight",
          },
        ],
      },
      usage: { input_tokens: 900, output_tokens: 800 },
    });
    const result = await openaiArtDirector.proposeDirections(
      {
        understanding: MOCK_UNDERSTANDING,
        recipe: SEED_RECIPE,
        brand: SEED_BRAND,
        n: 3,
      },
      { model: "gpt-6-luna" },
    );
    expect(result.value.map((v) => v.direction)).toEqual(
      SEED_RECIPE.directions.slice(0, 3).map((d) => d.label),
    );
    expect(result.value[0].scene).toBe("beside a front door");
    expect(parse.mock.calls[0][0]).toMatchObject({
      model: "gpt-6-luna",
      max_output_tokens: 6000,
    });
  });
});

describe("OpenAI product draft", () => {
  it("drafts the product form from the photo, bounded by its own budget", async () => {
    const draft = {
      name: "Engraved walnut cutting board",
      whatItIs: "cutting board",
      material: "solid walnut",
      treatment: "engraved",
      colours: [{ name: "Walnut", hex: "#5B3A29" }],
      wording: [{ label: "Family name", example: "The Johnsons" }],
      useContext: "a kitchen counter",
    };
    parse.mockResolvedValue({
      output_parsed: draft,
      usage: { input_tokens: 1400, output_tokens: 300 },
    });
    const result = await openaiVisionProvider.draftProduct(
      { assetUrl: "https://store/board.png" },
      { model: "gpt-6.1-sol" },
    );
    expect(result.value).toEqual(draft);
    const [body, options] = parse.mock.calls[0];
    expect(options).toEqual({ maxRetries: 0, timeout: 60_000 });
    expect(body).toMatchObject({ max_output_tokens: 2000 });
    expect(body.text.format.name).toBe("product_draft");
  });
});
