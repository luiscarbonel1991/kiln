import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/domain/product";
import type { ProductReview, ReviewField } from "@/providers/text-prompts";

const reviewProduct = vi.fn(
  async (
    _fields: ReviewField[],
    _model?: { provider: string; model: string },
  ): Promise<{
    review?: ProductReview;
    label?: string;
    degraded?: unknown;
    ranOn?: unknown;
  }> => ({
    label: "GPT-6 Luna",
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
  it("reviews the form on the fast route, names the model that answered and keeps what it can take", async () => {
    const result = await reviewProductAction({ form });
    expect(result).toEqual({
      review: {
        suggestions: [
          { field: "wording.0.label", value: "Name", why: "Ask for a name." },
        ],
        checks: [{ field: "size", why: "Is it 2.5 in?" }],
        model: "GPT-6 Luna",
      },
    });
    const [fields, model] = reviewProduct.mock.calls[0];
    // No model named: the route decides (text-calls).
    expect(model).toBeUndefined();
    expect(fields.find((f) => f.field === "wording.0.label")?.value).toBe(
      "Sofia",
    );
  });

  it("says when the review moved down the route", async () => {
    const ranOn = {
      label: "Gemini 3.8 Flash",
      from: "GPT-6 Luna",
      reason: "OpenAI answered 503",
    };
    reviewProduct.mockResolvedValueOnce({
      label: "Gemini 3.8 Flash",
      ranOn,
      review: { suggestions: [], checks: [] },
    });
    const result = await reviewProductAction({ form });
    expect(result.ranOn).toEqual(ranOn);
    expect(result.review?.model).toBe("Gemini 3.8 Flash");
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
