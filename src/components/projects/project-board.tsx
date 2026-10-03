import { ImageIcon, PenLine } from "lucide-react";
import Link from "next/link";
import {
  ApproveButton,
  ReferenceUpload,
} from "@/components/projects/board-actions";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import {
  SlotFrame,
  SlotGrid,
  slotPosition,
} from "@/components/projects/slot-frame";
import type { Card } from "@/domain/card";
import { exactView, renderTextTemplate } from "@/domain/exact";
import { estimateScenes } from "@/domain/generation-cost";
import { defaultImageModel } from "@/domain/model-defaults";
import {
  type PlanSlot,
  type ProjectPlan,
  type SlotView,
  slotCardId,
  slotState,
} from "@/domain/plan";
import { dimensionsLabel, type Product } from "@/domain/product";
import { isRenderableUrl } from "@/lib/asset-url";
import { gradientForPrompt } from "@/lib/gradient";
import { projectTypeLabel } from "@/lib/project-types";
import { CATALOG } from "@/lib/recipes";
import type { ProjectBoard as Board } from "@/server/project-mapper";

interface BoardSlot {
  slot: PlanSlot;
  cardId: string;
  card?: Card;
  view: SlotView;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

// The storyboard (ROADMAP "Experience design"): one row per destination, one
// frame per slot, the deliverable visible from minute one. Exact frames are
// drawn from the spec; scene frames show their card's candidate. The side panel
// carries the reference image, each destination's checklist and the cost of
// what is left. A server component: only approvals and the reference upload
// are client islands.
export function ProjectBoard({
  projectId,
  board,
  product,
}: {
  projectId: string;
  board: Board & { plan: ProjectPlan };
  product: Product;
}) {
  const cards = new Map(board.cards.map((c) => [c.id, c]));
  const rows = board.plan.destinations.map((d) => ({
    plan: d,
    destination: CATALOG.destinations.find((x) => x.id === d.destinationId),
    slots: d.slots.map((slot): BoardSlot => {
      const cardId = slotCardId(d.destinationId, slot.key);
      const card = cards.get(cardId);
      return { slot, cardId, card, view: slotState(slot, card) };
    }),
  }));
  const pending = rows
    .flatMap((r) => r.slots)
    .filter((s) => s.view.state === "queued")
    .map((s) => s.slot);
  const model = defaultImageModel();
  const estimate = estimateScenes(pending, model);

  return (
    <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-8 px-6 py-8 sm:px-8 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        <div>
          <p className="font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
            {projectTypeLabel(board.type)}
          </p>
          <h1
            className="mt-2 font-serif text-[1.875rem] font-semibold leading-tight text-foreground"
            style={{ fontVariationSettings: "'opsz' 144" }}
          >
            {board.name}
          </h1>
          <p className="mt-1 font-sans text-sm text-on-surface-mid">
            {product.name} · {dimensionsLabel(product.dimensions)} ·{" "}
            {product.material}
          </p>
        </div>

        {rows.map(({ plan, destination, slots }) =>
          destination ? (
            <section key={plan.destinationId} className="flex flex-col gap-3">
              <h2 className="flex items-baseline gap-3">
                <span className="font-serif text-xl italic text-foreground">
                  {destination.name}
                </span>
                <span className="font-mono text-[0.625rem] text-on-surface-dim">
                  {destination.kind} · {slots.length} frames ·{" "}
                  {destination.formats.map((f) => f.aspect).join(" / ")}
                </span>
              </h2>
              <SlotGrid>
                {slots.map(({ slot, cardId, card, view }, i) => (
                  <SlotFrame
                    key={slot.key}
                    position={slotPosition(destination, i)}
                    label={slot.label}
                    purpose={slot.purpose}
                    aspect={slot.aspect}
                    view={view}
                    actions={
                      <SlotActions
                        projectId={projectId}
                        destinationId={plan.destinationId}
                        slot={slot}
                        cardId={cardId}
                        view={view}
                        hasReference={board.master !== null}
                      />
                    }
                  >
                    {slot.exact ? (
                      <ExactSlotArt
                        view={exactView(slot.exact, product, slot.textTemplate)}
                        aspect={slot.aspect}
                      />
                    ) : (
                      <SceneContent
                        seed={cardId}
                        output={card?.outputs[0]}
                        text={
                          slot.textTemplate
                            ? renderTextTemplate(slot.textTemplate, product)
                            : undefined
                        }
                      />
                    )}
                  </SlotFrame>
                ))}
              </SlotGrid>
            </section>
          ) : (
            <p
              key={plan.destinationId}
              className="font-mono text-[0.7rem] text-on-surface-dim"
            >
              Destination "{plan.destinationId}" is no longer in the catalog.
            </p>
          ),
        )}
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
                Every scene edits this image, so the product stays true.
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
        </div>

        {rows.map(({ plan, destination, slots }) => {
          if (!destination) return null;
          const count = (state: SlotView["state"]) =>
            slots.filter((s) => s.view.state === state).length;
          const scenes = slots.filter((s) => s.slot.fill === "scene").length;
          const done = count("exact") + count("approved") + count("delivered");
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
                  {done} / {slots.length} ready
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-pill bg-surface-soft">
                <div
                  className="h-full rounded-pill bg-prov-recipe"
                  style={{ width: `${(done / slots.length) * 100}%` }}
                />
              </div>
              <ul className="flex flex-col gap-1 pt-1 font-mono text-[0.65rem] text-on-surface-mid">
                <li>{count("exact")} exact, from the spec</li>
                <li>
                  {count("approved")} of {scenes} scenes approved
                </li>
                <li>{count("to-review")} to review</li>
                <li>{count("queued") + count("generating")} waiting</li>
              </ul>
            </div>
          );
        })}

        <div className="flex flex-col gap-1.5 rounded-card bg-card p-5 shadow-card">
          <h2 className="font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim">
            Cost
          </h2>
          <p className="font-sans text-sm text-foreground">
            {pending.length === 0
              ? "No scene is waiting."
              : estimate
                ? `≈ ${money(estimate.typical)}–${money(estimate.max)} to generate the ${pending.length} waiting scenes once`
                : `${pending.length} scenes waiting; no pinned price for ${model.model}`}
          </p>
          <p className="font-sans text-[0.72rem] leading-snug text-on-surface-mid">
            Scenes are generated one at a time from the editor, only when you
            press Generate.
          </p>
        </div>
      </aside>
    </main>
  );
}

function SceneContent({
  seed,
  output,
  text,
}: {
  seed: string;
  output?: string;
  text?: string;
}) {
  return (
    <div
      className="relative h-full w-full"
      style={
        isRenderableUrl(output)
          ? undefined
          : { backgroundImage: gradientForPrompt(seed) }
      }
    >
      {isRenderableUrl(output) ? (
        // biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio
        <img src={output} alt="" className="h-full w-full object-cover" />
      ) : null}
      {text ? (
        <span
          className="absolute inset-x-3 top-3 rounded-field bg-card/85 px-2.5 py-1.5 font-serif text-[0.95rem] italic leading-tight text-foreground"
          title="Text layer drawn by a template, never by the image model"
        >
          {text}
        </span>
      ) : null}
    </div>
  );
}

function SlotActions({
  projectId,
  destinationId,
  slot,
  cardId,
  view,
  hasReference,
}: {
  projectId: string;
  destinationId: string;
  slot: PlanSlot;
  cardId: string;
  view: SlotView;
  hasReference: boolean;
}) {
  if (slot.fill === "exact") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {view.state === "to-review" || view.state === "approved" ? (
        <ApproveButton
          projectId={projectId}
          destinationId={destinationId}
          slotKey={slot.key}
          approved={view.state === "approved"}
        />
      ) : null}
      {hasReference ? (
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
      )}
    </div>
  );
}
