import type { BrandProfile } from "@/domain/brand";
import {
  TEXT_CALL_BUDGETS,
  type TextCallKind,
  textEstimate,
} from "@/domain/generation-cost";
import {
  assertModel,
  catalogFor,
  modelLabel,
  type ProviderId,
} from "@/domain/model-defaults";
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
import type { ProductDraft } from "@/providers/text-prompts";
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
