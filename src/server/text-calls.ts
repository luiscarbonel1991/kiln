import type { BrandProfile } from "@/domain/brand";
import type { DestinationText } from "@/domain/destination";
import {
  TEXT_CALL_BUDGETS,
  type TextCallKind,
  textEstimate,
} from "@/domain/generation-cost";
import type { ListingText } from "@/domain/listing";
import {
  assertModel,
  catalogFor,
  modelLabel,
  type ProviderId,
} from "@/domain/model-defaults";
import type { Product } from "@/domain/product";
import { describeProviderError, errorMessage } from "@/domain/queue";
import type { Recipe } from "@/domain/recipe";
import { SEED_BRAND } from "@/domain/seed";
import {
  type BaseUnderstanding,
  neutralUnderstanding,
} from "@/domain/understanding";
import type { VariantDirection } from "@/domain/variant-direction";
import { fallbackVariants } from "@/providers/mock/art-director";
import { getArtDirector, getVisionProvider } from "@/providers/registry";
import type {
  ListingCopy,
  ProductDraft,
  ProductReview,
  ReviewField,
} from "@/providers/text-prompts";
import { textCall, withDirectSpend } from "@/server/direct-spend";

// Vision and the art director on the maker's text model, under the monthly cap
// like every paid call. When a call fails the flow is never blocked and never
// silently switched: the answer says it degraded (the neutral understanding,
// the recipe's own directions), why, and which other provider the maker may
// ask instead, with its price.

export interface TextModel {
  provider: ProviderId;
  model: string;
}

export interface Degraded {
  provider: ProviderId;
  model: string;
  label: string;
  message: string;
  // The other provider's text model, to offer (never run on its own); null
  // when switching would not help (the month's cap).
  alternative: (TextModel & { label: string; usd: number | null }) | null;
}

function degraded(
  model: TextModel,
  kind: TextCallKind,
  error: unknown,
): Degraded {
  const cap = (error as { reason?: unknown } | null)?.reason === "cap";
  const other = catalogFor("text").find((m) => m.provider !== model.provider);
  return {
    ...model,
    label: modelLabel(model),
    message: describeProviderError(model.provider, error),
    alternative:
      cap || !other
        ? null
        : {
            provider: other.provider,
            model: other.id,
            label: other.label,
            usd: textEstimate(
              { provider: other.provider, model: other.id },
              TEXT_CALL_BUDGETS[kind],
            ),
          },
  };
}

export async function readProduct(
  assetUrl: string,
  model: TextModel,
): Promise<{ understanding: BaseUnderstanding; degraded?: Degraded }> {
  try {
    assertModel(model, "text");
    const result = await withDirectSpend(
      textCall<BaseUnderstanding>(model, "vision"),
      (beforeCall) =>
        getVisionProvider(model.provider).analyze(
          { assetUrl },
          { model: model.model, beforeCall },
        ),
    );
    return { understanding: result.value };
  } catch (error) {
    console.warn("[kiln] vision degraded:", errorMessage(error));
    return {
      understanding: neutralUnderstanding(SEED_BRAND.palette),
      degraded: degraded(model, "vision", error),
    };
  }
}

export async function directScenes(
  input: {
    understanding: BaseUnderstanding;
    recipe: Recipe;
    brand: BrandProfile;
    n: number;
  },
  model: TextModel,
): Promise<{ variants: VariantDirection[]; degraded?: Degraded }> {
  try {
    assertModel(model, "text");
    const result = await withDirectSpend(
      textCall<VariantDirection[]>(model, "artDirection"),
      (beforeCall) =>
        getArtDirector(model.provider).proposeDirections(input, {
          model: model.model,
          beforeCall,
        }),
    );
    return { variants: result.value };
  } catch (error) {
    console.warn("[kiln] art direction degraded:", errorMessage(error));
    return {
      variants: fallbackVariants(input.recipe, input.understanding, input.n),
      degraded: degraded(model, "artDirection", error),
    };
  }
}

// The product form's "Fill from the photo": a draft the maker reviews, never
// saved on its own. Hex colours the model got wrong are dropped. On failure the
// form stays as it was and the answer says why.
export async function draftProduct(
  assetUrl: string,
  model: TextModel,
): Promise<{ draft?: ProductDraft; degraded?: Degraded }> {
  try {
    assertModel(model, "text");
    const result = await withDirectSpend(
      textCall<ProductDraft>(model, "productDraft"),
      (beforeCall) =>
        getVisionProvider(model.provider).draftProduct(
          { assetUrl },
          { model: model.model, beforeCall },
        ),
    );
    const draft = result.value;
    return {
      draft: {
        ...draft,
        colours: draft.colours
          .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex))
          .slice(0, 4),
        wording: draft.wording.slice(0, 3),
      },
    };
  } catch (error) {
    console.warn("[kiln] product draft degraded:", errorMessage(error));
    return { degraded: degraded(model, "productDraft", error) };
  }
}

// A listing's prose written by the maker's text model (the board's "Write it
// with the text model"), under the cap. Tags come back trimmed, blanks
// dropped; nothing is cut to fit — the board checks the answer against the
// channel's rules and shows what to fix. On failure the listing stays as it
// was and the answer says why.
export async function writeListing(
  input: {
    channel: string;
    product: Product;
    rules: DestinationText;
    draft: ListingText;
  },
  model: TextModel,
  // The project the listing is for: the call's cost counts there.
  projectId?: string,
): Promise<{ copy?: ListingCopy; degraded?: Degraded }> {
  try {
    assertModel(model, "text");
    const result = await withDirectSpend(
      { ...textCall<ListingCopy>(model, "listingCopy"), projectId },
      (beforeCall) =>
        getArtDirector(model.provider).writeListing(input, {
          model: model.model,
          beforeCall,
        }),
    );
    const clean = (list: string[]) => list.map((x) => x.trim()).filter(Boolean);
    return {
      copy: {
        title: result.value.title.trim(),
        description: result.value.description.trim(),
        tags: clean(result.value.tags),
        materials: clean(result.value.materials),
      },
    };
  } catch (error) {
    console.warn("[kiln] listing copy degraded:", errorMessage(error));
    return { degraded: degraded(model, "listingCopy", error) };
  }
}

// The product form's "Review with AI": suggestions and checks on the form as
// typed, under the cap. Nothing is applied here (cleanReview keeps what the
// form can take, the maker accepts each). On failure the form stays as it was
// and the answer says why.
export async function reviewProduct(
  fields: ReviewField[],
  model: TextModel,
): Promise<{ review?: ProductReview; degraded?: Degraded }> {
  try {
    assertModel(model, "text");
    const result = await withDirectSpend(
      textCall<ProductReview>(model, "productReview"),
      (beforeCall) =>
        getArtDirector(model.provider).reviewProduct(
          { fields },
          { model: model.model, beforeCall },
        ),
    );
    return { review: result.value };
  } catch (error) {
    console.warn("[kiln] product review degraded:", errorMessage(error));
    return { degraded: degraded(model, "productReview", error) };
  }
}
