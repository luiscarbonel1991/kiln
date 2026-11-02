import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { fromMicros, toMicros } from "@/domain/generation-cost";
import type { GenerationRequest } from "@/domain/generation-request";
import { modelLabel } from "@/domain/model-defaults";
import { editLimits, formFromProduct } from "@/lib/product-form";
import { cleanReview, ReviewForm, reviewFields } from "@/lib/product-review";
import { providerMode } from "@/providers/mode";
import { designView } from "@/server/designs";
import {
  enqueueProjectCards,
  estimateProjectCards,
} from "@/server/generation-queue";
import { budget, QueueRefusal } from "@/server/generation-repository";
import { listingTarget, writeProjectListing } from "@/server/listing-write";
import { getCurrentMaker } from "@/server/maker-repository";
import { getProduct } from "@/server/product-repository";
import { waitingProjectFrames } from "@/server/project-frames";
import {
  createQuote,
  QUOTE_ACTIONS,
  QUOTE_MINUTES,
  type QuoteAction,
} from "@/server/spend-quotes";
import { reviewProduct, textRoute } from "@/server/text-calls";
import {
  defineTool,
  type ToolContext,
  ToolRefusal,
} from "@/server/tools/registry";
import { takeQuote } from "@/server/tools/spend";

// The paid tools (ROADMAP "Agents", stage 1): `quote` prices a task and
// stores it; generate, draw, write_listing and review_product take only the
// quote's id, run what was quoted once, and only for a token the maker lets
// spend. Each task runs on its role's route (Settings → Models): frames and
// drawings on their card's model and the final route, the listing text on
// deep, the review on fast. The cap rules every attempt, as on the board.

const usd = (micros: number) =>
  Math.round(fromMicros(micros) * 10_000) / 10_000;

const GenerateQuote = z.object({
  project: z.string(),
  frames: z.array(z.string()).min(1),
  test: z.boolean().optional(),
});
const DrawQuote = z.object({
  project: z.string(),
  cards: z.array(z.string()).min(1),
});
const ListingQuote = z.object({ project: z.string(), destination: z.string() });
const ReviewQuote = z.object({ product: z.string() });

const ESTIMATE_ROSE = "The estimate rose since the quote: quote again.";

// A paid tool run from the chat: its spend counts for that conversation.
const spentIn = (ctx: ToolContext) =>
  ctx.sessionId ? { sessionId: ctx.sessionId } : {};

function requestModel(request: GenerationRequest): string {
  const detail =
    request.kind === "video"
      ? (request.model.resolution ?? null)
      : (request.model.quality ??
        (request.model.provider === "openai" ? "medium" : null));
  return [modelLabel(request.model), detail].filter(Boolean).join(" ");
}

// A refusal of the queue's in an agent's words; anything else it threw while
// building the requests, as a refusal too (no reference yet, not a frame).
function asRefusal(error: unknown): Error {
  if (error instanceof QueueRefusal) {
    return error.reason === "estimate-changed"
      ? new ToolRefusal(ESTIMATE_ROSE)
      : error;
  }
  return new ToolRefusal((error as Error).message ?? String(error));
}

interface Priced {
  input: Record<string, unknown>;
  typicalMicros: number;
  maxMicros: number;
  lines: Record<string, unknown>[];
}

async function priceGenerate(
  project: string,
  frames?: string[],
  test?: boolean,
): Promise<Priced> {
  const state = await waitingProjectFrames(project);
  if (!state) {
    throw new ToolRefusal("No project of yours with frames has that id.");
  }
  if (!state.reference) {
    throw new ToolRefusal(
      "This project has no reference image yet, and its scenes are made from one: the maker adds the product's photo on the board (Kiln could not draw one from the product for free).",
    );
  }
  const asked = frames ?? state.waiting;
  if (asked.length === 0) {
    throw new ToolRefusal(
      "Nothing waits to be generated: every scene has a take, is in the queue, or waits for the scene it re-frames. Name frames to take again.",
    );
  }
  const { cards } = await estimateProjectCards(project, [...new Set(asked)], {
    test,
  }).catch((error) => {
    throw asRefusal(error);
  });
  return {
    input: {
      project,
      frames: cards.map((c) => c.cardId),
      ...(test ? { test: true } : {}),
    },
    typicalMicros: cards.reduce((t, c) => t + c.typicalMicros, 0),
    maxMicros: cards.reduce((t, c) => t + c.maxMicros, 0),
    lines: cards.map((c) => ({
      frame: c.cardId,
      model: requestModel(c.request),
      fallbacks: c.next.map(modelLabel),
      typicalUsd: usd(c.typicalMicros),
      atMostUsd: usd(c.maxMicros),
    })),
  };
}

// A design's drawings: each card's line art, on the card's own model, from
// the design's image.
async function priceDraw(project: string, cards?: string[]): Promise<Priced> {
  const design = await designView(project);
  if (!design) throw new ToolRefusal("No design of yours has that id.");
  const byCard = new Map(design.drawings.map((d) => [d.card, d]));
  for (const card of cards ?? []) {
    const drawing = byCard.get(card);
    if (!drawing) {
      throw new ToolRefusal(
        `"${card}" is not a drawing of this design: get_design names them.`,
      );
    }
    if (drawing.state === "drawing") {
      throw new ToolRefusal(`${drawing.label} is being drawn already.`);
    }
  }
  const asked =
    cards ??
    design.drawings
      .filter((d) => d.state === "to-draw" || d.state === "failed")
      .map((d) => d.card);
  if (asked.length === 0) {
    throw new ToolRefusal(
      "Every drawing has its line art or is being drawn: name cards to draw again.",
    );
  }
  const { cards: priced } = await estimateProjectCards(project, [
    ...new Set(asked),
  ]).catch((error) => {
    throw asRefusal(error);
  });
  return {
    input: { project, cards: priced.map((c) => c.cardId) },
    typicalMicros: priced.reduce((t, c) => t + c.typicalMicros, 0),
    maxMicros: priced.reduce((t, c) => t + c.maxMicros, 0),
    lines: priced.map((c) => ({
      card: c.cardId,
      drawing: byCard.get(c.cardId)?.label,
      model: requestModel(c.request),
      fallbacks: c.next.map(modelLabel),
      typicalUsd: usd(c.typicalMicros),
      atMostUsd: usd(c.maxMicros),
    })),
  };
}

async function priceText(
  kind: "listingCopy" | "productReview",
  task: string,
  input: Record<string, unknown>,
): Promise<Priced> {
  const route = await textRoute(kind);
  if (route.max === null || route.typical === null) {
    throw new ToolRefusal(
      `No pinned price for the ${task}'s model: pick a priced one in Settings → Models.`,
    );
  }
  return {
    input,
    typicalMicros: toMicros(route.typical),
    maxMicros: toMicros(route.max),
    lines: [
      {
        task,
        model: route.labels[0],
        fallbacks: route.labels.slice(1),
        typicalUsd: route.typical,
        atMostUsd: route.max,
      },
    ],
  };
}

const QuoteInput = z.object({
  action: z
    .enum(QUOTE_ACTIONS)
    .describe(
      "generate: new takes of a project's scenes (project, and frames or every scene waiting); draw: a design's line art (project, and cards or every drawing without one); write_listing: a destination's listing text (project, destination); review_product: an AI review of a product's fields (product).",
    ),
  project: z
    .string()
    .min(1)
    .optional()
    .describe("generate, draw, write_listing: the project's Kiln id."),
  frames: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .optional()
    .describe(
      'generate: the frames to take ("etsy.hero"); every scene waiting on the board when left out.',
    ),
  cards: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .optional()
    .describe(
      "draw: the design's drawings to draw (get_design's card ids); every drawing without line art when left out.",
    ),
  destination: z
    .string()
    .min(1)
    .optional()
    .describe('write_listing: the destination ("etsy").'),
  product: z
    .string()
    .min(1)
    .optional()
    .describe("review_product: the product's Kiln id."),
  test: z
    .boolean()
    .optional()
    .describe(
      "generate: test takes, each scene at its GPT Image model's low quality, a cheap check of the direction; a test take is never approved.",
    ),
});

function needs<T>(value: T | undefined, action: QuoteAction, field: string): T {
  if (value === undefined) {
    throw new ToolRefusal(`A quote for ${action} needs ${field}.`);
  }
  return value;
}

async function priceOf(input: z.output<typeof QuoteInput>): Promise<Priced> {
  const { action } = input;
  if (action === "generate") {
    return priceGenerate(
      needs(input.project, action, "project"),
      input.frames,
      input.test,
    );
  }
  if (action === "draw") {
    return priceDraw(needs(input.project, action, "project"), input.cards);
  }
  if (action === "write_listing") {
    const project = needs(input.project, action, "project");
    const destination = needs(input.destination, action, "destination");
    if (!(await listingTarget(project, destination))) {
      throw new ToolRefusal(
        "That destination of that project takes no listing text.",
      );
    }
    return priceText("listingCopy", "listing text", { project, destination });
  }
  const product = needs(input.product, action, "product");
  if (!(await getProduct(product))) {
    throw new ToolRefusal("No product of yours has that id.");
  }
  return priceText("productReview", "product review", { product });
}

export const quote = defineTool({
  name: "quote",
  title: "Quote a paid task",
  description: `Price a paid task before it runs, for free: the models it runs on (and may fall back to), what it typically costs and the most it can cost, and what is left of the month's cap. Answers a quote id that generate, draw, write_listing or review_product take; it runs exactly what was quoted, once, within ${QUOTE_MINUTES} minutes, and only for a token the maker lets spend (canSpend says whether this one may).`,
  input: QuoteInput,
  // It stores the quote and nothing the maker sees: free, and safe to ask.
  hints: { readOnly: true },
  run: async (input, ctx) => {
    const { action } = input;
    const priced = await priceOf(input);
    const mock = providerMode() === "mock";
    const maker = await getCurrentMaker();
    const month = mock ? null : await budget(maker.id);
    const left = month
      ? Math.max(month.capMicros - month.spentMicros - month.reservedMicros, 0)
      : null;
    const made = await createQuote({
      action,
      input: priced.input as Prisma.InputJsonValue,
      typicalMicros: priced.typicalMicros,
      maxMicros: priced.maxMicros,
      tokenId: ctx.tokenId,
    });
    return {
      data: {
        quote: made.id,
        action,
        ...priced.input,
        typicalUsd: usd(priced.typicalMicros),
        atMostUsd: usd(priced.maxMicros),
        lines: priced.lines,
        capLeftUsd: left === null ? null : usd(left),
        fitsCap: left === null || priced.maxMicros <= left,
        expiresAt: made.expiresAt.toISOString(),
        canSpend: ctx.canSpend,
        ...(mock ? { note: "A mock run: nothing is paid." } : {}),
      },
    };
  },
});

const QuoteId = z
  .object({
    quote: z.string().min(1).describe("The id the quote tool answered."),
  })
  .strict();

export const generate = defineTool({
  name: "generate",
  title: "Generate the quoted frames",
  description:
    "Queue the takes a generate quote priced, as the board's Generate does: one batch, within the month's cap, refused if the estimate rose since the quote. Takes land over the next minutes: read get_frames until each frame is to-review, then look with view_frame.",
  input: QuoteId,
  hints: {},
  run: async ({ quote: id }, ctx) => {
    const quoted = await takeQuote(ctx, id, "generate");
    const { project, frames, test } = GenerateQuote.parse(quoted.input);
    const queued = await enqueueProjectCards({
      projectId: project,
      cardIds: frames,
      shownMaxMicros: quoted.maxMicros,
      ...(test ? { test } : {}),
      ...spentIn(ctx),
    }).catch((error) => {
      throw asRefusal(error);
    });
    return {
      data: {
        quote: quoted.id,
        project,
        batch: queued.batchId,
        queued: queued.queued,
        skipped: queued.skipped,
        next: "Read get_frames until each frame is to-review, then view_frame.",
      },
    };
  },
});

export const draw = defineTool({
  name: "draw",
  title: "Draw the quoted line art",
  description:
    "Queue the drawings a draw quote priced, as the studio's Generate does for a design's line art: one batch, within the month's cap, refused if the estimate rose since the quote. Drawings land over the next minutes: read get_design until each is drawn, look with view_design, then vectorize.",
  input: QuoteId,
  hints: {},
  run: async ({ quote: id }, ctx) => {
    const quoted = await takeQuote(ctx, id, "draw");
    const { project, cards } = DrawQuote.parse(quoted.input);
    const queued = await enqueueProjectCards({
      projectId: project,
      cardIds: cards,
      shownMaxMicros: quoted.maxMicros,
      ...spentIn(ctx),
    }).catch((error) => {
      throw asRefusal(error);
    });
    return {
      data: {
        quote: quoted.id,
        project,
        batch: queued.batchId,
        queued: queued.queued,
        skipped: queued.skipped,
        next: "Read get_design until each drawing is drawn, then view_design and vectorize.",
      },
    };
  },
});

// A text task re-priced before it runs: refused if it would cost more now.
async function stillPriced(
  kind: "listingCopy" | "productReview",
  maxMicros: number,
): Promise<void> {
  const now = (await textRoute(kind)).max;
  if (now === null || toMicros(now) > maxMicros) {
    throw new ToolRefusal(ESTIMATE_ROSE);
  }
}

export const writeListingTool = defineTool({
  name: "write_listing",
  title: "Write the quoted listing text",
  description:
    "Write a destination's listing text with the text model, as the board's Write does: only the fields the maker has not written are replaced, and the result is saved and checked. Takes a write_listing quote.",
  input: QuoteId,
  hints: {},
  run: async ({ quote: id }, ctx) => {
    const quoted = await takeQuote(ctx, id, "write_listing");
    const { project, destination } = ListingQuote.parse(quoted.input);
    await stillPriced("listingCopy", quoted.maxMicros);
    const result = await writeProjectListing(
      project,
      destination,
      undefined,
      ctx.sessionId,
    );
    if ("error" in result) throw new ToolRefusal(result.error);
    if ("degraded" in result) {
      throw new ToolRefusal(
        result.degraded
          ? `${result.degraded.label} could not write it: ${result.degraded.message}`
          : "The text model could not write it.",
      );
    }
    return {
      data: {
        quote: quoted.id,
        project,
        destination,
        listing: result.listing,
        ...(result.ranOn ? { ranOn: result.ranOn } : {}),
      },
    };
  },
});

export const reviewProductTool = defineTool({
  name: "review_product",
  title: "Review a product, as quoted",
  description:
    "Review a product's fields with the text model, as the form's Review with AI does: suggestions a field can take (field, value, why) and checks to look at. Nothing is saved. Takes a review_product quote.",
  input: QuoteId,
  hints: {},
  run: async ({ quote: id }, ctx) => {
    const quoted = await takeQuote(ctx, id, "review_product");
    const { product: productId } = ReviewQuote.parse(quoted.input);
    await stillPriced("productReview", quoted.maxMicros);
    const product = await getProduct(productId);
    if (!product) throw new ToolRefusal("That product no longer exists.");
    const form = ReviewForm.safeParse(formFromProduct(product));
    if (!form.success) {
      throw new ToolRefusal(
        "This product's fields cannot be reviewed as saved.",
      );
    }
    const fields = reviewFields(form.data, editLimits(product));
    const result = await reviewProduct(fields, undefined, spentIn(ctx));
    if (!result.review) {
      throw new ToolRefusal(
        result.degraded
          ? `${result.degraded.label} could not review it: ${result.degraded.message}`
          : "The text model could not review it.",
      );
    }
    return {
      data: {
        quote: quoted.id,
        product: productId,
        model: result.label ?? "",
        ...cleanReview(result.review, fields),
        ...(result.ranOn ? { ranOn: result.ranOn } : {}),
      },
    };
  },
});
