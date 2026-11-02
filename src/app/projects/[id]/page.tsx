import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatPanel } from "@/components/chat/chat-panel";
import type { BatchEstimate } from "@/components/projects/generation-panel";
import { GenerationPoller } from "@/components/projects/generation-poller";
import {
  boardRows,
  ProjectBoard,
  waitingCardIds,
} from "@/components/projects/project-board";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { modelLabel } from "@/domain/model-defaults";
import { type ProjectPlan, parseSlotCardId } from "@/domain/plan";
import { projectCost } from "@/domain/project-cost";
import { cardsWithOwnPrompt } from "@/lib/project-refresh";
import { providerBlock } from "@/lib/provider-block";
import { providerMode } from "@/providers/mode";
import { chatPanelData } from "@/server/chat/chat-view";
import { estimateProjectCards, scenePrompts } from "@/server/generation-queue";
import {
  outputVersions,
  projectGenerationState,
  projectSpend,
  QueueRefusal,
} from "@/server/generation-repository";
import {
  getCurrentMaker,
  getMakerBrand,
  getMakerPreferences,
} from "@/server/maker-repository";
import { productDrift } from "@/server/product-version";
import { loadProjectBoard } from "@/server/project-repository";
import { type ProviderHealth, providerHealth } from "@/server/provider-health";
import { resultsConnector } from "@/server/shop-connector";
import { takeRoutes } from "@/server/take-routes";
import { textWorstCase } from "@/server/text-calls";

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
    const { cards, models, fallbacks } = await estimateProjectCards(
      projectId,
      cardIds,
    );
    const labelOf = (cardId: string) => {
      const ref = parseSlotCardId(cardId);
      return (
        plan.destinations
          .find((d) => d.destinationId === ref?.destinationId)
          ?.slots.find((s) => s.key === ref?.slotKey)?.label ?? cardId
      );
    };
    // A provider that cannot take a paid call now (no key, a rejected key)
    // refuses the batch before the click, with why (DOGFOOD #44).
    const blocked = [
      ...new Set(cards.map((c) => c.request.model.provider)),
    ].flatMap((provider) => {
      const why = providerBlock(health, provider, providerMode());
      return why ? [why] : [];
    });
    if (blocked.length > 0) return { refusal: blocked.join(" ") };
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
      fallbacks,
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
        fallbacks: c.next.map(modelLabel),
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
// unknown id is a 404. `?chat=1` opens the project's chat beside the board
// (full screen on a phone).
// What a design's page says of its drawings (the studio's image cards).
function designLine(
  cards: { type: string; outputs: string[]; vectorUrl?: string }[],
): string {
  const drawings = cards.filter((c) => c.type === "image");
  const drawn = drawings.filter((c) => c.outputs[0]);
  const traced = drawn.filter((c) => c.vectorUrl).length;
  return `A design: ${drawn.length} of ${drawings.length} drawings drawn, ${traced} traced. They live in the studio, and the chat's SVG specialist works on them too.`;
}

export default async function ProjectBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chat?: string }>;
}) {
  const { id } = await params;
  const chatOpen = (await searchParams).chat === "1";
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
  const writeUsd = await textWorstCase("listingCopy");
  const listingPrice = writeUsd === null ? null : `≈ $${writeUsd.toFixed(2)}`;
  const generation = await projectGenerationState(maker.id, board.id);
  const brand = await getMakerBrand();
  const { searchColumns } = await getMakerPreferences();
  const health = await providerHealth(maker.id);
  const plan = board.plan;
  const spend = plan ? await projectSpend(board.id) : null;
  const cost =
    plan && spend ? projectCost(plan, spend.byCard, spend.directMicros) : null;
  const estimate =
    plan && board.master
      ? await batchEstimate(
          board.id,
          waitingCardIds(boardRows({ ...board, plan }, generation.jobs)),
          plan,
          health,
        )
      : null;
  const chat = chatOpen ? await chatPanelData({ projectId: board.id }) : null;
  const content =
    board.plan && product ? (
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
        shop={(await resultsConnector())?.label ?? null}
        cost={cost}
        takeRoutes={await takeRoutes()}
        prompts={board.master ? await scenePrompts(board.id) : {}}
      />
    ) : (
      <main className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
        <h1 className="font-serif text-2xl italic text-foreground">
          {board.name}
        </h1>
        <p className="font-sans text-sm text-on-surface-mid">
          {board.type === "design"
            ? designLine(board.cards)
            : "This project was made in the studio; it has no plan to show."}
        </p>
        <Link
          href={`/projects/${board.id}/editor`}
          className="font-sans text-sm font-semibold text-primary"
        >
          Open it in the editor
        </Link>
        {board.type === "design" && !chatOpen ? (
          <Link
            href={`/projects/${board.id}?chat=1`}
            className="font-sans text-sm font-semibold text-primary"
          >
            Ask the SVG specialist
          </Link>
        ) : null}
        {/* Drawings the chat queued: the page (and the chat's notice) follow the batch. */}
        <GenerationPoller
          projectId={board.id}
          version={generation.version}
          active={generation.batch !== null}
        />
      </main>
    );
  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader
        chatHref={
          chatOpen ? `/projects/${board.id}` : `/projects/${board.id}?chat=1`
        }
      >
        <span className="font-mono text-[0.625rem] text-on-surface-dim">
          project
        </span>
      </ProjectsHeader>
      {chat ? (
        <div className="flex flex-1">
          <div className="min-w-0 flex-1">{content}</div>
          <aside className="fixed inset-0 z-40 lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-[380px] lg:shrink-0 lg:self-start lg:border-l lg:border-border-soft">
            <ChatPanel
              data={chat}
              projectId={board.id}
              title={board.name}
              closeHref={`/projects/${board.id}`}
            />
          </aside>
        </div>
      ) : (
        content
      )}
    </div>
  );
}
