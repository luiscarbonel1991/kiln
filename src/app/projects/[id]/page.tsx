import Link from "next/link";
import { notFound } from "next/navigation";
import type { BatchEstimate } from "@/components/projects/generation-panel";
import {
  boardRows,
  ProjectBoard,
  waitingCardIds,
} from "@/components/projects/project-board";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { TEXT_CALL_BUDGETS, textEstimate } from "@/domain/generation-cost";
import { defaultTextModel, modelLabel } from "@/domain/model-defaults";
import { type ProjectPlan, parseSlotCardId } from "@/domain/plan";
import { cardsWithOwnPrompt } from "@/lib/project-refresh";
import { providerMode } from "@/providers/mode";
import { shopConnector } from "@/providers/shop";
import { estimateProjectCards } from "@/server/generation-queue";
import {
  outputVersions,
  projectGenerationState,
  QueueRefusal,
} from "@/server/generation-repository";
import {
  getCurrentMaker,
  getMakerBrand,
  getMakerModels,
  getMakerPreferences,
} from "@/server/maker-repository";
import { productDrift } from "@/server/product-version";
import { loadProjectBoard } from "@/server/project-repository";
import { type ProviderHealth, providerHealth } from "@/server/provider-health";

// The estimate of a batch of every waiting scene, built exactly as the queue
// would build it: each card's model and price, and a line for each provider
// it uses that may not answer. The queue's refusal comes back as its reason;
// null when there is nothing to generate or no reference yet.
async function batchEstimate(
  projectId: string,
  cardIds: string[],
  plan: ProjectPlan,
  health: ProviderHealth[],
): Promise<BatchEstimate | { refusal: string } | null> {
  if (cardIds.length === 0) return null;
  try {
    const { cards, models } = await estimateProjectCards(projectId, cardIds);
    const labelOf = (cardId: string) => {
      const ref = parseSlotCardId(cardId);
      return (
        plan.destinations
          .find((d) => d.destinationId === ref?.destinationId)
          ?.slots.find((s) => s.key === ref?.slotKey)?.label ?? cardId
      );
    };
    const warnings = health.flatMap((h) => {
      const count = cards.filter(
        (c) => c.request.model.provider === h.provider,
      ).length;
      if (count === 0 || (h.keyPresent && !h.lastError)) return [];
      const cardsText = count === 1 ? "1 card uses" : `${count} cards use`;
      return [
        h.lastError
          ? `${cardsText} ${h.label}, whose last call failed: ${h.lastError.message}`
          : `${cardsText} ${h.label}, which has no API key.`,
      ];
    });
    return {
      count: cards.length,
      typicalMicros: cards.reduce((t, c) => t + c.typicalMicros, 0),
      maxMicros: cards.reduce((t, c) => t + c.maxMicros, 0),
      models,
      cards: cards.map((c) => ({
        cardId: c.cardId,
        label: labelOf(c.cardId),
        model: [
          modelLabel(c.request.model),
          c.request.model.quality ??
            (c.request.kind === "image" && c.request.model.provider === "openai"
              ? "medium"
              : null),
        ]
          .filter(Boolean)
          .join(" "),
        typicalMicros: c.typicalMicros,
        maxMicros: c.maxMicros,
      })),
      warnings,
    };
  } catch (error) {
    if (error instanceof QueueRefusal) return { refusal: error.message };
    return null;
  }
}

// The Project board (ROADMAP screen 3): the storyboard of a planned project.
// Dynamic per request (no static params); a project of another maker or an
// unknown id is a 404.
export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = await loadProjectBoard(id);
  if (!loaded) notFound();
  const { board, product, version } = loaded;
  // Whether the product changed since the project was built from it, and the
  // cards whose current output shows an earlier version.
  const drift = product && version ? productDrift(product, version) : null;
  const shown = board.cards.flatMap((c) => c.outputs.slice(0, 1));
  const versions = version?.hash
    ? await outputVersions(board.id, shown)
    : new Map<string, string | null>();
  const earlier = board.cards
    .filter((c) => {
      const output = c.outputs[0];
      return (
        output && versions.has(output) && versions.get(output) !== version?.hash
      );
    })
    .map((c) => c.id);
  const maker = await getCurrentMaker();
  const writeUsd = textEstimate(
    defaultTextModel(await getMakerModels()),
    TEXT_CALL_BUDGETS.listingCopy,
  );
  const listingPrice = writeUsd === null ? null : `≈ $${writeUsd.toFixed(2)}`;
  const generation = await projectGenerationState(maker.id, board.id);
  const brand = await getMakerBrand();
  const { searchColumns } = await getMakerPreferences();
  const health = await providerHealth(maker.id);
  const plan = board.plan;
  const estimate =
    plan && board.master
      ? await batchEstimate(
          board.id,
          waitingCardIds(boardRows({ ...board, plan }, generation.jobs)),
          plan,
          health,
        )
      : null;
  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader>
        <span className="font-mono text-[0.625rem] text-on-surface-dim">
          project
        </span>
      </ProjectsHeader>
      {board.plan && product ? (
        <ProjectBoard
          projectId={board.id}
          board={{ ...board, plan: board.plan }}
          product={product}
          jobs={generation.jobs}
          generation={generation}
          estimate={estimate}
          mode={providerMode()}
          brand={brand}
          notes={health}
          drift={drift}
          earlier={earlier}
          ownPrompts={cardsWithOwnPrompt(board.cards)}
          listingPrice={listingPrice}
          searchSources={searchColumns}
          today={new Date().toLocaleDateString("en-CA")}
          shop={shopConnector()?.label ?? null}
        />
      ) : (
        <main className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
          <h1 className="font-serif text-2xl italic text-foreground">
            {board.name}
          </h1>
          <p className="font-sans text-sm text-on-surface-mid">
            This project was made in the studio; it has no plan to show.
          </p>
          <Link
            href={`/projects/${board.id}/editor`}
            className="font-sans text-sm font-semibold text-primary"
          >
            Open it in the editor
          </Link>
        </main>
      )}
    </div>
  );
}
