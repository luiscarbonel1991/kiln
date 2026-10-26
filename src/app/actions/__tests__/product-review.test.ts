import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/domain/product";
import type { ProductReview, ReviewField } from "@/providers/text-prompts";

const reviewProduct = vi.fn(
  async (
    _fields: ReviewField[],
    _model: { provider: string; model: string },
  ): Promise<{ review?: ProductReview; degraded?: unknown }> => ({
    review: {
      suggestions: [
        { field: "wording.0.label", value: "Name", why: "Ask for a name." },
        { field: "price", value: "24", why: "Price it." },
      ],
      checks: [{ field: "size", why: "Is it 2.5 in?" }],
    },
  }),
);
const getProduct = vi.fn(async (_id: string): Promise<Product | null> => null);

vi.mock("@/server/text-calls", () => ({
  reviewProduct,
  draftProduct: vi.fn(),
}));
vi.mock("@/server/product-repository", () => ({ getProduct }));
vi.mock("@/server/maker-repository", () => ({
  getMakerModels: async () => ({
    text: { provider: "openai", model: "gpt-6.1-sol" },
  }),
}));

const { reviewProductAction } = await import("@/app/actions/products");

const form = {
  name: "Engraved name keychain",
  whatItIs: "keychain",
  width: 2.3,
  height: 1.25,
  unit: "in",
  material: "birch",
  treatment: "engraved",
  colours: [{ name: "Natural", hex: "#D9B98C" }],
  wording: [{ label: "Sofia", example: "", maxChars: null }],
  useContexts: [],
};

afterEach(() => vi.clearAllMocks());

describe("reviewProductAction", () => {
  it("reviews the form on the maker's text model and keeps what it can take", async () => {
    const result = await reviewProductAction({ form });
    expect(result).toEqual({
      review: {
        suggestions: [
          { field: "wording.0.label", value: "Name", why: "Ask for a name." },
        ],
        checks: [{ field: "size", why: "Is it 2.5 in?" }],
        model: "GPT-6.1 Sol",
      },
    });
    const [fields, model] = reviewProduct.mock.calls[0];
    expect(model).toEqual({ provider: "openai", model: "gpt-6.1-sol" });
    expect(fields.find((f) => f.field === "wording.0.label")?.value).toBe(
      "Sofia",
    );
  });

  it("asks the model the degraded notice offers", async () => {
    await reviewProductAction({
      form,
      model: { provider: "google", model: "gemini-3.8-flash" },
    });
    expect(reviewProduct.mock.calls[0][1]).toEqual({
      provider: "google",
      model: "gemini-3.8-flash",
    });
  });

  it("uses a saved product's own limits when editing", async () => {
    getProduct.mockResolvedValueOnce({
      name: "x".repeat(120),
      family: "Key rings",
      shape: "keychain",
      material: "birch",
      colours: [{ key: "n", name: "Natural", face: "#D9B98C", inStock: true }],
      wording: [],
      description: undefined,
    } as unknown as Product);
    await reviewProductAction({ form, productId: "p1" });
    expect(getProduct).toHaveBeenCalledWith("p1");
    const [fields] = reviewProduct.mock.calls[0];
    expect(fields.find((f) => f.field === "name")?.maxChars).toBe(120);
  });

  it("says why when the model could not answer", async () => {
    const degraded = { provider: "openai", message: "rate limited" };
    reviewProduct.mockResolvedValueOnce({ degraded });
    expect(await reviewProductAction({ form })).toEqual({ degraded });
  });

  it("needs a name or what it is, and a form", async () => {
    expect(
      await reviewProductAction({ form: { ...form, name: "", whatItIs: " " } }),
    ).toEqual({ error: "Name the product or say what it is first." });
    expect(await reviewProductAction({ form: "nope" })).toEqual({
      error: "Nothing to review yet.",
    });
    expect(reviewProduct).not.toHaveBeenCalled();
  });
});
