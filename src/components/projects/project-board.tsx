import { ImageIcon, PenLine } from "lucide-react";
import Link from "next/link";
import type {
  ModelValue,
  ProviderNote,
} from "@/components/models/model-choice";
import { BeforeAfter } from "@/components/projects/before-after";
import {
  ApproveButton,
  DeliverButton,
  ReferenceUpload,
  SlotOrder,
  SlotSwitch,
} from "@/components/projects/board-actions";
import {
  BoardColours,
  UNVERIFIED_TITLE,
} from "@/components/projects/board-colours";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import {
  type BatchEstimate,
  GenerationPanel,
} from "@/components/projects/generation-panel";
import { GenerationPoller } from "@/components/projects/generation-poller";
import { ListingPanel } from "@/components/projects/listing-panel";
import { ListingResultsPanel } from "@/components/projects/listing-results-panel";
import { MarketBriefPanel } from "@/components/projects/market-brief-panel";
import { PhotoArt } from "@/components/projects/photo-art";
import { ProductChangedBanner } from "@/components/projects/product-changed";
import { ProjectTitle } from "@/components/projects/project-title";
import { SceneArt } from "@/components/projects/scene-art";
import {
  framePosition,
  onIndexes,
  SlotFrame,
  SlotGrid,
  slotPosition,
  unnumbered,
} from "@/components/projects/slot-frame";
import { SlotModel } from "@/components/projects/slot-model";
import { SlotTune } from "@/components/projects/slot-tune";
import { VideoArt } from "@/components/projects/video-art";
import {
  AddVideoButton,
  VideoControls,
} from "@/components/projects/video-controls";
import { ReadyMark } from "@/components/ready-mark";
import type { BrandKit } from "@/domain/brand";
import type { Card } from "@/domain/card";
import {
  exactView,
  renderTextTemplate,
  textLayerColours,
} from "@/domain/exact";
import { waitingFrames } from "@/domain/frame-view";
import { fromMicros } from "@/domain/generation-cost";
import { checkListing, listingDraft } from "@/domain/listing";
import { etsyListingId } from "@/domain/live-listing";
import type { SearchColumns } from "@/domain/market-brief";
import {
  NO_TAKE_ROUTES,
  type Route,
  type TakeRoutes,
} from "@/domain/model-routing";
import {
  addVideoSlot,
  deliveryBlockers,
  type PlanSlot,
  type ProjectPlan,
  replan,
  type SlotView,
  slotCardId,
  slotState,
  type VideoSettings,
  videoSettings,
} from "@/domain/plan";
import { projectProduct } from "@/domain/plan-look";
import {
  buyerSizeLabel,
  colourOf,
  lookVerified,
  type Product,
} from "@/domain/product";
import type { FrameCost, ProjectCost } from "@/domain/project-cost";
import type { JobView } from "@/domain/queue";
import { threeQuarterFor } from "@/domain/scene-reference";
import { VIDEO_MOTIONS } from "@/domain/video";
import { isRenderableUrl } from "@/lib/asset-url";
import { planChangeLines } from "@/lib/plan-changes";
import { plateHref } from "@/lib/plate-href";
import { plural } from "@/lib/plural";
import { projectTypeLabel } from "@/lib/project-types";
import { CATALOG } from "@/lib/recipes";
import { dayLabel, resultsView } from "@/lib/results-view";
import {
  type TunePlace,
  type TuneView,
  takesPlace,
  tuneView,
} from "@/lib/slot-tune";
import { versionMark } from "@/lib/version-mark";
import type { BatchProgress, Budget } from "@/server/generation-repository";
import type { ProductDrift } from "@/server/product-version";
import type { ProjectBoard as Board } from "@/server/project-mapper";

interface BoardSlot {
  slot: PlanSlot;
  cardId: string;
  card?: Card;
  view: SlotView;
  // Its state as if switched on: a slot switched off keeps that caption.
  onView: SlotView;
}

// Each destination's slots with their card, latest job and board state.
export function boardRows(
  board: Board & { plan: ProjectPlan },
  jobs: Record<string, JobView>,
) {
  const cards = new Map(board.cards.map((c) => [c.id, c]));
  return board.plan.destinations.map((d) => ({
    plan: d,
    destination: CATALOG.destinations.find((x) => x.id === d.destinationId),
    slots: d.slots.map((slot): BoardSlot => {
      const cardId = slotCardId(d.destinationId, slot.key);
      const card = cards.get(cardId);
      return {
        slot,
        cardId,
        card,
        view: slotState(slot, card, jobs[cardId]),
        onView: slotState({ ...slot, off: false }, card, jobs[cardId]),
      };
    }),
  }));
}

// The scene slots a batch would generate (waitingFrames).
export function waitingCardIds(rows: ReturnType<typeof boardRows>): string[] {
  return waitingFrames(rows.flatMap((r) => r.slots));
}

// Cents, or a tenth of a cent for less than one (a text call is $0.004, not
// "$0.00").
const money = (micros: number) =>
  `$${fromMicros(micros).toFixed(micros > 0 && micros < 10_000 ? 3 : 2)}`;

// "$0.12 · 2 takes": what a frame has cost, its re-rolls included; nothing
// before its first take, nor in mock mode (nothing is paid there).
function frameCostLine(
  frame: FrameCost | undefined,
  mode: "live" | "mock",
): string | undefined {
  if (mode !== "live" || !frame || frame.takes === 0) return undefined;
  return `${money(frame.spentMicros)} · ${plural(frame.takes, "take")}`;
}

// The project's photo work so far: what it spent (every take, the rejected
// ones too) and what each approved frame cost on average — the number a
// business prices into the product.
function ProjectCostCard({
  cost,
  mode,
}: {
  cost: ProjectCost | null;
  mode: "live" | "mock";
}) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-card bg-card p-5 shadow-card"
      data-testid="project-cost"
    >
      <span className="font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim">
        Cost
      </span>
      {mode === "mock" || !cost ? (
        <p className="font-mono text-[0.65rem] text-on-surface-mid">
          Mock mode: nothing is paid or counted.
        </p>
      ) : (
        <>
          <p className="font-serif text-2xl italic text-foreground">
            {money(cost.spentMicros)}
          </p>
          <p className="font-mono text-[0.65rem] text-on-surface-mid">
            spent on this project · {plural(cost.takes, "take")}
          </p>
          <p className="font-mono text-[0.65rem] text-foreground">
            {cost.perApprovedMicros === null
              ? "no frame approved yet"
              : `${money(cost.perApprovedMicros)} per approved frame · ${cost.approved} approved`}
          </p>
          {cost.otherMicros > 0 ? (
            <p className="font-sans text-[0.72rem] leading-snug text-on-surface-mid">
              {money(cost.otherMicros)} of it went to the listing text and
              frames no longer in the deliverable.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

// Why a destination cannot be exported yet, in a line; null when it can.
function deliveryBlocker(
  plan: ProjectPlan["destinations"][number],
  slots: BoardSlot[],
): string | null {
  const cards = new Map(slots.map((s) => [s.slot.key, s.card]));
  const { notReady } = deliveryBlockers(plan, (key) => cards.get(key));
  if (notReady.length > 0) {
    return `Approve ${notReady.length === 1 ? "1 scene" : `${notReady.length} scenes`} to export: ${notReady.join(", ")}.`;
  }
  return null;
}

// The storyboard (ROADMAP "Experience design"): one row per destination, one
// frame per slot, the deliverable visible from minute one. Exact frames are
// drawn from the spec; scene frames show their card's candidate and their job's
// progress. The side panel carries the reference image, the generate panel
// (one approval per batch, background queue), and each destination's
// checklist. A server component: approvals, the reference upload, the generate
// panel and the poller are client islands.
export function ProjectBoard({
  projectId,
  board,
  product,
  jobs,
  generation,
  estimate,
  mode,
  brand,
  notes,
  drift,
  earlier,
  ownPrompts,
  listingPrice,
  searchSources,
  today,
  shop,
  cost,
  takeRoutes = NO_TAKE_ROUTES,
}: {
  projectId: string;
  board: Board & { plan: ProjectPlan };
  product: Product;
  jobs: Record<string, JobView>;
  generation: { version: string; batch: BatchProgress | null; budget: Budget };
  estimate: BatchEstimate | { refusal: string } | null;
  mode: "live" | "mock";
  brand: BrandKit | null;
  // Each provider's health (free to read): the pickers mark a provider with
  // no key or a failed last call.
  notes: ProviderNote[];
  // Whether the product changed since the project was built from it.
  drift: ProductDrift | null;
  // Cards whose current output shows an earlier version of the product.
  earlier: string[];
  // Cards that run their own prompt (they do not follow the product).
  ownPrompts: string[];
  // "≈ $0.03": the maker's text model writing a listing; null unpriced.
  listingPrice: string | null;
  // The market brief's column mappings saved per source.
  searchSources: Record<string, SearchColumns>;
  // The server's date (YYYY-MM-DD).
  today: string;
  // The connected shop that reads a listing's numbers, or null (typed).
  shop: string | null;
  // What the project's photo work has cost (live spend only).
  cost: ProjectCost | null;
  // The scenes' and the video's routes, with only the models that may run
  // here: a new take is priced at the dearest one, as the queue reserves it.
  takeRoutes?: TakeRoutes;
}) {
  const rows = boardRows(board, jobs);
  const frameCosts = new Map(
    (cost?.destinations ?? []).flatMap((d) =>
      d.frames.map((f) => [slotCardId(d.destinationId, f.slotKey), f] as const),
    ),
  );
  // Kiln's view of the product from a little above, while the reference is
  // the plate it was drawn beside.
  const above = threeQuarterFor(board.plan.references, board.master?.assetUrl);
  const waiting = waitingCardIds(rows);
  // The product as the project shows it (its colour and style): exact
  // frames draw it, and scenes are made in it. Nothing real backs a look
  // without a material photo or a supplier page.
  const shown = projectProduct(product, board.plan);
  const sceneColour = colourOf(shown, shown.defaultColour);
  const unverified = lookVerified(sceneColour) ? null : sceneColour.name;
  const labelOf = new Map(
    rows.flatMap((r) => r.slots.map((s) => [s.cardId, s.slot.label] as const)),
  );

  return (
    <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-8 px-6 py-8 sm:px-8 lg:flex-row">
      <ReadyMark page="board" />
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        <div>
          <p className="font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
            {projectTypeLabel(board.type)}
          </p>
          <ProjectTitle projectId={projectId} name={board.name} />
          <p className="mt-1 font-sans text-sm text-on-surface-mid">
            {product.name} · {buyerSizeLabel(product)} · {product.material}
            {" · "}
            <Link
              href={`/products/${product.id}?back=${encodeURIComponent(`/projects/${projectId}`)}`}
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              <PenLine className="size-3" /> Edit product
            </Link>
          </p>
        </div>

        {drift?.stale ? (
          <ProductChangedBanner
            projectId={projectId}
            changed={drift.changed}
            ownPrompts={ownPrompts.map((id) => labelOf.get(id) ?? id)}
            planChanges={(() => {
              const next = replan(board.plan, product, CATALOG.shotLists);
              return planChangeLines(next.changes, next.redeliver);
            })()}
          />
        ) : null}

        {rows.map(({ plan, destination, slots }) => {
          if (!destination) {
            return (
              <p
                key={plan.destinationId}
                className="font-mono text-[0.7rem] text-on-surface-dim"
              >
                Destination "{plan.destinationId}" is no longer in the catalog.
              </p>
            );
          }
          // A video is not a photo: it takes no photo number and never moves;
          // a frame posted on its own takes none either.
          const places = onIndexes(
            slots.map((s) => s.slot.off === true || unnumbered(s.slot)),
          );
          const last = places.filter((p) => p !== null).length - 1;
          const approvedScenes = slots
            .filter(
              (s) =>
                s.slot.fill === "scene" && !s.slot.off && s.slot.approvedOutput,
            )
            .map((s) => ({ key: s.slot.key, label: s.slot.label }));
          const canAddVideo =
            board.master !== null &&
            addVideoSlot(board.plan, plan.destinationId, CATALOG.shotLists) !==
              null;
          // The places a scene can stand in: the product's, then the ones
          // this destination's market brief suggests.
          const placeOptions: TunePlace[] = [
            ...product.useContexts
              .map((p) => p.trim())
              .filter(Boolean)
              .map((place) => ({ place, from: "product" as const })),
            ...(plan.brief?.notes ?? [])
              .map((n) => n.place.trim())
              .filter(Boolean)
              .map((place) => ({ place, from: "brief" as const })),
          ];
          const results =
            destination.kind === "sale" ? resultsView(plan, today) : null;
          const budgetLine =
            mode === "mock"
              ? "mock mode, not counted"
              : `${money(generation.budget.spentMicros + generation.budget.reservedMicros)} of ${money(generation.budget.capMicros)} used`;
          return (
            <section key={plan.destinationId} className="flex flex-col gap-3">
              <h2 className="flex items-baseline gap-3">
                <span className="font-serif text-xl italic text-foreground">
                  {destination.name}
                </span>
                <span className="font-mono text-[0.625rem] text-on-surface-dim">
                  {destination.kind} ·{" "}
                  {plural(slots.filter((s) => !s.slot.off).length, "frame")}
                  {slots.some((s) => s.slot.off)
                    ? ` (${slots.filter((s) => s.slot.off).length} off)`
                    : ""}{" "}
                  · {destination.formats.map((f) => f.aspect).join(" / ")}
                </span>
                {plan.listingUrl ? (
                  <a
                    href={plan.listingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`live-listing-${plan.destinationId}`}
                    className="font-sans text-[0.75rem] font-semibold text-primary hover:underline"
                  >
                    Live listing
                    {etsyListingId(plan.listingUrl)
                      ? ` ${etsyListingId(plan.listingUrl)}`
                      : ""}{" "}
                    ↗
                  </a>
                ) : null}
                {canAddVideo ? (
                  <AddVideoButton
                    projectId={projectId}
                    destinationId={plan.destinationId}
                  />
                ) : null}
              </h2>
              <SlotGrid>
                {slots.map(({ slot, cardId, card, view, onView }, i) => {
                  const video =
                    slot.fill === "video"
                      ? videoSettings(
                          plan,
                          slot,
                          destination.video,
                          card?.model,
                        )
                      : null;
                  return (
                    <SlotFrame
                      key={slot.key}
                      testId={`slot-${plan.destinationId}-${slot.key}`}
                      position={framePosition(
                        destination,
                        slot,
                        places[i],
                        slot.off === true,
                      )}
                      label={slot.label}
                      purpose={slot.purpose}
                      aspect={
                        video
                          ? video.orientation === "landscape"
                            ? "16:9"
                            : "9:16"
                          : slot.aspect
                      }
                      view={view}
                      mark={
                        earlier.includes(cardId)
                          ? "earlier version of the product"
                          : versionMark(board.plan, slot)
                      }
                      cost={frameCostLine(frameCosts.get(cardId), mode)}
                      ranOn={jobs[cardId]?.ranOn}
                      actions={
                        <SlotActions
                          projectId={projectId}
                          destinationId={plan.destinationId}
                          slot={slot}
                          cardId={cardId}
                          view={view}
                          onView={onView}
                          tune={tuneView({
                            slot,
                            card,
                            view,
                            job: jobs[cardId],
                            places: placeOptions,
                            above,
                            route: takeRoutes.final,
                          })}
                          hasReference={board.master !== null}
                          unverified={unverified}
                          model={card ? (card.model as ModelValue) : null}
                          notes={notes}
                          video={
                            video && card
                              ? {
                                  settings: video,
                                  scenes: approvedScenes,
                                  rendered: card.outputs.length > 0,
                                  budgetLine,
                                  route: takeRoutes.video,
                                }
                              : null
                          }
                          order={
                            // A video never moves, nor a frame posted on its
                            // own; a slot switched off keeps the order
                            // buttons' room (hidden).
                            video || slot.standalone
                              ? null
                              : {
                                  place: places[i] ?? 1,
                                  last: places[i] === null ? 2 : last,
                                  firstLabel:
                                    destination.kind === "sale"
                                      ? "Make photo 1"
                                      : "Make slide 1",
                                }
                          }
                        />
                      }
                    >
                      {video ? (
                        <VideoArt
                          seed={cardId}
                          output={card?.outputs[0]}
                          startFrame={video.startFrame}
                          caption={
                            video.startFrame
                              ? `${VIDEO_MOTIONS[video.motion].label} · ${video.seconds} s`
                              : "Approve a scene to animate"
                          }
                        />
                      ) : slot.fill === "photo" && slot.photo ? (
                        <PhotoArt
                          url={slot.photo}
                          alt={`${slotPosition(destination, places[i])}, as on the listing`}
                        />
                      ) : slot.before ? (
                        <BeforeAfter
                          before={slot.before}
                          testId={`before-${cardId}`}
                        >
                          <SlotArt
                            slot={slot}
                            cardId={cardId}
                            output={card?.outputs[0]}
                            product={shown}
                            brand={brand}
                          />
                        </BeforeAfter>
                      ) : slot.exact ? (
                        <ExactSlotArt
                          view={exactView(
                            slot.exact,
                            shown,
                            slot.textTemplate,
                            brand,
                          )}
                          aspect={slot.aspect}
                          plate={plateHref(shown)}
                        />
                      ) : (
                        <SceneArt
                          seed={cardId}
                          output={
                            slot.fill === "shared"
                              ? slot.approvedOutput
                              : card?.outputs[0]
                          }
                          text={
                            slot.textTemplate
                              ? renderTextTemplate(slot.textTemplate, shown)
                              : undefined
                          }
                          band={textLayerColours(brand)}
                          aspect={slot.aspect}
                        />
                      )}
                    </SlotFrame>
                  );
                })}
              </SlotGrid>
              {destination.kind === "sale" ? (
                <MarketBriefPanel
                  key={`brief-${JSON.stringify(plan.brief ?? null)}`}
                  projectId={projectId}
                  destinationId={plan.destinationId}
                  destinationName={destination.name}
                  initial={plan.brief}
                  product={product}
                  sources={searchSources}
                  frames={slots
                    .filter(
                      (s) =>
                        s.slot.fill === "scene" &&
                        !s.slot.off &&
                        takesPlace(s.slot),
                    )
                    .map((s) => ({ key: s.slot.key, label: s.slot.label }))}
                  today={today}
                />
              ) : null}
              {destination.text ? (
                <ListingPanel
                  key={JSON.stringify(plan.listing ?? null)}
                  projectId={projectId}
                  destinationId={plan.destinationId}
                  destinationName={destination.name}
                  initial={
                    plan.listing ?? listingDraft(product, destination.text)
                  }
                  saved={plan.listing !== undefined}
                  product={product}
                  rules={destination.text}
                  writePrice={listingPrice}
                  brief={plan.brief}
                />
              ) : null}
              {destination.kind === "sale" ? (
                <ListingResultsPanel
                  key={`results-${JSON.stringify(results)}-${plan.listingUrl ?? ""}`}
                  projectId={projectId}
                  destinationId={plan.destinationId}
                  destinationName={destination.name}
                  listingUrl={plan.listingUrl ?? null}
                  view={results}
                  today={today}
                  shop={shop}
                />
              ) : null}
            </section>
          );
        })}
      </div>

      <aside className="flex w-full flex-shrink-0 flex-col gap-5 lg:w-[300px]">
        <div className="flex flex-col gap-3 rounded-card bg-card p-5 shadow-card">
          <h2 className="font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim">
            Reference image
          </h2>
          {board.master ? (
            <div className="flex items-center gap-3">
              <div className="size-14 flex-shrink-0 overflow-hidden rounded-thumb bg-surface-soft shadow-render">
                {isRenderableUrl(board.master.assetUrl) ? (
                  // biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio
                  <img
                    src={board.master.assetUrl}
                    alt="Product reference"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="m-4 size-6 text-on-surface-dim" />
                )}
              </div>
              <p className="font-sans text-[0.75rem] leading-snug text-on-surface-mid">
                {above
                  ? "Scenes at eye level edit this image, so the product stays true."
                  : "Every scene edits this image, so the product stays true."}
              </p>
            </div>
          ) : (
            <>
              <p className="font-sans text-[0.75rem] leading-snug text-on-surface-mid">
                Scenes need one image of the product to edit: a photo, or the
                plate your own renderer makes. Exact frames are already done.
              </p>
              <ReferenceUpload projectId={projectId} />
            </>
          )}
          {above && isRenderableUrl(above.assetUrl) ? (
            <div
              data-testid="reference-above"
              className="flex items-center gap-3 border-t border-border-soft pt-3"
            >
              <div className="size-14 flex-shrink-0 overflow-hidden rounded-thumb bg-surface-soft shadow-render">
                {/* biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio */}
                <img
                  src={above.assetUrl}
                  alt="The product seen from a little above"
                  className="h-full w-full object-cover"
                />
              </div>
              <p className="font-sans text-[0.75rem] leading-snug text-on-surface-mid">
                <span className="font-semibold text-foreground">
                  Seen from a little above
                </span>
                <br />
                Kiln drew it from the plate, free. Scenes looking down edit it,
                so the part lying flat shows.
              </p>
            </div>
          ) : null}
          <BoardColours product={product} scenes={sceneColour.key} />
        </div>

        {board.master ? (
          <GenerationPanel
            projectId={projectId}
            cardIds={waiting}
            estimate={estimate}
            batch={generation.batch}
            budget={generation.budget}
            mode={mode}
            staleProduct={drift?.stale === true}
          />
        ) : null}

        <ProjectCostCard cost={cost} mode={mode} />

        {rows.map(({ plan, destination, slots }) => {
          if (!destination) return null;
          const count = (state: SlotView["state"]) =>
            slots.filter((s) => s.view.state === state).length;
          const on = slots.filter((s) => !s.slot.off);
          // A video is approved like a scene, so it counts with them; a
          // delivered frame still counts as what it was before delivery.
          const generated = on.filter(
            (s) => s.slot.fill === "scene" || s.slot.fill === "video",
          );
          const scenes = generated.length;
          const approved = generated.filter(
            (s) => s.view.state === "approved" || s.view.state === "delivered",
          ).length;
          const sharedCount = on.filter((s) => s.slot.fill === "shared").length;
          const destinationCost = cost?.destinations.find(
            (d) => d.destinationId === plan.destinationId,
          );
          const exact = on.filter(
            (s) =>
              s.slot.fill === "exact" &&
              (s.view.state === "exact" || s.view.state === "delivered"),
          ).length;
          const done =
            count("exact") +
            count("kept") +
            count("approved") +
            count("delivered");
          // What the listing text still needs, when the destination has text
          // rules (errors only: what the channel would refuse).
          const listingErrors = destination.text
            ? checkListing(
                plan.listing ?? listingDraft(product, destination.text),
                product,
                destination.text,
              ).filter((i) => i.severity === "error").length
            : null;
          const results =
            destination.kind === "sale" ? resultsView(plan, today) : null;
          const approvedEarlier = on.filter(
            (s) => s.slot.approvedOutput && earlier.includes(s.cardId),
          ).length;
          return (
            <div
              key={plan.destinationId}
              className="flex flex-col gap-2 rounded-card bg-card p-5 shadow-card"
            >
              <div className="flex items-baseline justify-between">
                <h2 className="font-serif text-lg italic text-foreground">
                  {destination.name}
                </h2>
                <span className="font-mono text-[0.625rem] text-on-surface-mid">
                  {done} / {on.length} ready
                  {count("off") > 0 ? ` · ${count("off")} off` : ""}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-pill bg-surface-soft">
                <div
                  className="h-full rounded-pill bg-prov-recipe"
                  style={{
                    width: `${on.length > 0 ? (done / on.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <ul className="flex flex-col gap-1 pt-1 font-mono text-[0.65rem] text-on-surface-mid">
                {count("delivered") > 0 ? (
                  <li>{count("delivered")} delivered</li>
                ) : null}
                {count("kept") > 0 ? (
                  <li>
                    {plural(count("kept"), "photo")} of yours, kept as{" "}
                    {count("kept") === 1 ? "it is" : "they are"}
                  </li>
                ) : null}
                <li>{exact} exact, from the spec</li>
                <li>
                  {approved} of {plural(scenes, "scene")} approved
                </li>
                {mode === "live" &&
                destinationCost &&
                destinationCost.takes > 0 ? (
                  <li data-testid={`destination-cost-${plan.destinationId}`}>
                    {money(destinationCost.spentMicros)} spent
                    {destinationCost.perApprovedMicros !== null
                      ? ` · ${money(destinationCost.perApprovedMicros)} per approved frame`
                      : ""}
                  </li>
                ) : null}
                {sharedCount > 0 ? (
                  <li>
                    {plural(sharedCount, "frame")} shared from another
                    destination, free
                  </li>
                ) : null}
                <li>{count("to-review")} to review</li>
                <li>
                  {count("queued") + count("generating") + count("retrying")}{" "}
                  waiting or in progress
                </li>
                {listingErrors !== null ? (
                  <li
                    className={
                      listingErrors > 0 ? "text-prov-local" : "text-prov-recipe"
                    }
                  >
                    Listing text:{" "}
                    {listingErrors > 0 ? `${listingErrors} to fix` : "ready"}
                    {plan.listing ? "" : " (draft, not saved)"}
                  </li>
                ) : null}
                {results?.following ? (
                  <li
                    className={
                      results.reads.some((r) => r.due)
                        ? "text-prov-local"
                        : undefined
                    }
                  >
                    <a
                      href={`#results-${plan.destinationId}`}
                      className="hover:underline"
                    >
                      Results:{" "}
                      {results.reads.some((r) => r.due)
                        ? `${results.reads
                            .filter((r) => r.due)
                            .map((r) => r.label.toLowerCase())
                            .join(", ")} read due`
                        : results.next
                          ? `next read ${dayLabel(results.next.dueOn)}`
                          : "all three read"}
                    </a>
                  </li>
                ) : null}
                {approvedEarlier > 0 ? (
                  <li className="text-prov-brand">
                    {approvedEarlier === 1
                      ? "1 approved scene shows"
                      : `${approvedEarlier} approved scenes show`}{" "}
                    an earlier version of the product
                  </li>
                ) : null}
              </ul>
              <DeliverButton
                projectId={projectId}
                destinationId={plan.destinationId}
                destinationName={destination.name}
                blocker={deliveryBlocker(plan, slots)}
                delivered={
                  on.length > 0 && on.every((s) => s.view.state === "delivered")
                }
              />
            </div>
          );
        })}
      </aside>
      <GenerationPoller
        projectId={projectId}
        version={generation.version}
        active={generation.batch !== null}
      />
    </main>
  );
}

// An exact frame or a scene's candidate, as the frame shows it.
function SlotArt({
  slot,
  cardId,
  output,
  product,
  brand,
}: {
  slot: PlanSlot;
  cardId: string;
  output?: string;
  product: Product;
  brand: BrandKit | null;
}) {
  return slot.exact ? (
    <ExactSlotArt
      view={exactView(slot.exact, product, slot.textTemplate, brand)}
      aspect={slot.aspect}
      plate={plateHref(product)}
    />
  ) : (
    <SceneArt
      seed={cardId}
      output={output}
      text={
        slot.textTemplate
          ? renderTextTemplate(slot.textTemplate, product)
          : undefined
      }
      band={textLayerColours(brand)}
      aspect={slot.aspect}
    />
  );
}

function SlotActions({
  projectId,
  destinationId,
  slot,
  cardId,
  view: actual,
  onView,
  tune,
  hasReference,
  unverified,
  order,
  video,
  model,
  notes,
}: {
  projectId: string;
  destinationId: string;
  slot: PlanSlot;
  cardId: string;
  view: SlotView;
  onView: SlotView;
  // The scene's knobs (a slot planned with them), else null.
  tune: TuneView | null;
  hasReference: boolean;
  // The colour scenes show, when nothing real backs its look; else null.
  unverified: string | null;
  order: { place: number; last: number; firstLabel: string } | null;
  video: {
    settings: VideoSettings;
    scenes: { key: string; label: string }[];
    rendered: boolean;
    budgetLine: string;
    route: Route | null;
  } | null;
  model: ModelValue | null;
  notes: ProviderNote[];
}) {
  // A slot switched off keeps the caption it has when on, its other actions
  // hidden in place: the switch stays under the cursor and the frames below
  // never move (switching three off in a row must not hit a fourth).
  const off = actual.state === "off";
  const view = off ? onView : actual;
  const keep = (node: React.ReactNode) =>
    off && node ? (
      // contents: the hidden actions lay out exactly as when shown
      // (visibility is inherited, the wrapper draws no box).
      <span className="invisible contents" aria-hidden="true">
        {node}
      </span>
    ) : (
      node
    );
  const toggle = (
    <SlotSwitch
      projectId={projectId}
      destinationId={destinationId}
      slotKey={slot.key}
      off={off}
    />
  );
  const ordering = keep(
    order ? (
      <SlotOrder
        projectId={projectId}
        destinationId={destinationId}
        slotKey={slot.key}
        {...order}
      />
    ) : null,
  );
  if (slot.fill === "video") {
    return (
      <div className="flex flex-col gap-2">
        {keep(
          view.state === "to-review" || view.state === "approved" ? (
            <ApproveButton
              projectId={projectId}
              destinationId={destinationId}
              slotKey={slot.key}
              approved={view.state === "approved"}
            />
          ) : null,
        )}
        {keep(
          video && model ? (
            <VideoControls
              projectId={projectId}
              destinationId={destinationId}
              slotKey={slot.key}
              cardId={cardId}
              model={model}
              notes={notes}
              settings={video.settings}
              scenes={video.scenes}
              busy={view.inBatch === true || view.state === "generating"}
              rendered={video.rendered}
              budgetLine={video.budgetLine}
              route={video.route}
            />
          ) : (
            <span className="font-mono text-[0.6rem] text-on-surface-dim">
              needs a reference image
            </span>
          ),
        )}
        {view.inBatch && !off ? null : toggle}
      </div>
    );
  }
  // A shared frame follows its scene: nothing to make or approve here.
  if (
    slot.fill === "exact" ||
    slot.fill === "photo" ||
    slot.fill === "shared"
  ) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {toggle}
        {ordering}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {keep(
        tune ? (
          <SlotTune
            projectId={projectId}
            destinationId={destinationId}
            slotKey={slot.key}
            cardId={cardId}
            tune={tune}
          />
        ) : null,
      )}
      {ordering}
      {keep(
        view.state === "to-review" || view.state === "approved" ? (
          <ApproveButton
            projectId={projectId}
            destinationId={destinationId}
            slotKey={slot.key}
            approved={view.state === "approved"}
          />
        ) : null,
      )}
      {keep(
        hasReference ? (
          <Link
            href={`/projects/${projectId}/editor?card=${encodeURIComponent(cardId)}`}
            className="inline-flex items-center gap-1 font-sans text-[0.72rem] font-semibold text-primary hover:underline"
          >
            <PenLine className="size-3" /> Open in editor
          </Link>
        ) : (
          <span className="font-mono text-[0.6rem] text-on-surface-dim">
            needs a reference image
          </span>
        ),
      )}
      {view.inBatch && !off ? null : toggle}
      {keep(
        hasReference && model ? (
          <SlotModel
            projectId={projectId}
            cardId={cardId}
            kind="image"
            value={model}
            notes={notes}
            disabled={
              view.inBatch === true ||
              view.state === "generating" ||
              view.state === "retrying"
            }
          />
        ) : null,
      )}
      {keep(
        unverified ? (
          <span
            title={UNVERIFIED_TITLE}
            data-testid="unverified-look"
            className="font-mono text-[0.6rem] text-prov-local"
          >
            unverified look · {unverified}
          </span>
        ) : null,
      )}
      {keep(
        slot.key === "scale" ? (
          // Plans from before M4 kept an AI scale scene; its size cue can lie
          // (new plans draw the scale exactly).
          <span className="font-mono text-[0.6rem] text-prov-brand">
            AI scale · unverified
          </span>
        ) : null,
      )}
    </div>
  );
}
