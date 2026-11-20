"use client";

import { Film, Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import {
  addVideoAction,
  makeStillsVideoAction,
  setVideoChoiceAction,
} from "@/app/actions/board";
import { enqueueGenerationAction } from "@/app/actions/generation";
import type {
  ModelValue,
  ProviderNote,
} from "@/components/models/model-choice";
import { monthFitLine, useMonthFit } from "@/components/projects/month-fit";
import { SlotModel } from "@/components/projects/slot-model";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { canAfford, toMicros } from "@/domain/generation-cost";
import { modelLabel } from "@/domain/model-defaults";
import { type Route, videoTakeEstimate } from "@/domain/model-routing";
import type { VideoSettings } from "@/domain/plan";
import {
  VIDEO_MOTIONS,
  type VideoChoice,
  type VideoMotion,
  type VideoOrientation,
  type VideoSeconds,
} from "@/domain/video";
import { cn } from "@/lib/utils";

const money = (usd: number) => `$${usd.toFixed(2)}`;

const SELECT =
  "w-full rounded-field border border-border bg-card px-2 py-1 font-sans text-[0.72rem] text-foreground disabled:opacity-50";

// A video slot's choices and its Generate: the model and its resolution, the
// start frame among the approved scenes, the motion, the length the model and
// the destination accept, the orientation. Generating opens one confirmation
// with the model, its pinned price and the month's limit (its amounts for the
// owner, whether it fits for a member), then queues this
// card alone (the queue re-derives the request and refuses if its price is
// higher than the one shown).
export function VideoControls({
  projectId,
  destinationId,
  slotKey,
  cardId,
  model,
  notes,
  settings,
  scenes,
  busy,
  rendered,
  month,
  route = null,
  blocked = null,
}: {
  projectId: string;
  destinationId: string;
  slotKey: string;
  cardId: string;
  model: ModelValue;
  notes: ProviderNote[];
  settings: VideoSettings;
  scenes: { key: string; label: string }[];
  busy: boolean;
  rendered: boolean;
  // The owner's line of this month's amounts (or mock mode's), or, for a
  // member, whom to ask: they read only whether the video fits.
  month:
    | {
        line: string;
        studio?: {
          spentMicros: number;
          reservedMicros: number;
          capMicros: number;
        };
      }
    | { ask: string };
  // The video route's models that may run here: the price is the dearest.
  route?: Route | null;
  // Why the model's provider cannot take a paid call now (providerBlock).
  blocked?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usd = videoTakeEstimate(model, settings.seconds, route);
  const ask = "ask" in month ? month.ask : null;
  // The owner reads the amounts, so the video's fit is worked out here, as
  // the Generate panel does; the queue checks again when it is sent.
  const overCap =
    "studio" in month &&
    month.studio !== undefined &&
    usd !== null &&
    !canAfford({ ...month.studio, requestMicros: toMicros(usd) });
  const fit = useMonthFit({
    projectId,
    cardIds: [cardId],
    enabled: confirming && ask !== null && usd !== null,
  });
  const choose = (choice: VideoChoice) =>
    startTransition(() =>
      setVideoChoiceAction({ projectId, destinationId, slotKey, choice }),
    );
  const generate = () =>
    startTransition(async () => {
      setError(null);
      const result = await enqueueGenerationAction({
        projectId,
        cardIds: [cardId],
        ...(usd === null ? {} : { shownMaxMicros: toMicros(usd) }),
      });
      if ("error" in result) setError(result.error);
      setConfirming(false);
    });
  // Stills in motion: Kiln makes it now, free, from the approved scenes.
  const makeStills = () =>
    startTransition(async () => {
      setError(null);
      const result = await makeStillsVideoAction({
        projectId,
        destinationId,
        slotKey,
      });
      if (result?.error) setError(result.error);
    });
  const frameLabel =
    scenes.find((s) => s.key === settings.from)?.label ?? "an approved scene";
  const pill = (active: boolean) =>
    `rounded-pill border px-2.5 py-0.5 font-sans text-[0.68rem] transition-colors disabled:opacity-50 ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border-soft bg-secondary text-foreground hover:border-primary"
    }`;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <fieldset className="flex flex-wrap gap-1">
        <legend className="sr-only">Who makes the video</legend>
        <button
          type="button"
          aria-pressed={!settings.stills}
          data-testid={`video-${destinationId}-${slotKey}-by-model`}
          disabled={pending || busy}
          onClick={() => choose({ stills: false })}
          className={pill(!settings.stills)}
        >
          A model
        </button>
        <button
          type="button"
          aria-pressed={settings.stills}
          data-testid={`video-${destinationId}-${slotKey}-stills`}
          disabled={pending || busy}
          onClick={() => choose({ stills: true })}
          className={pill(settings.stills)}
        >
          Stills in motion · free
        </button>
      </fieldset>
      {settings.stills ? null : (
        <SlotModel
          projectId={projectId}
          cardId={cardId}
          kind="video"
          value={model}
          notes={notes}
          disabled={pending || busy}
        />
      )}
      <label className="flex flex-col gap-0.5 font-mono text-[0.58rem] text-on-surface-dim">
        Starts from
        <select
          data-testid={`video-${destinationId}-${slotKey}-starts-from`}
          className={SELECT}
          value={settings.from ?? ""}
          disabled={pending || busy || scenes.length === 0}
          onChange={(e) => choose({ from: e.target.value })}
        >
          {scenes.length === 0 ? (
            <option value="">Approve a scene first</option>
          ) : null}
          {scenes.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div
        className={
          settings.stills ? "grid gap-1.5" : "grid grid-cols-2 gap-1.5"
        }
      >
        <select
          hidden={settings.stills}
          aria-label="Motion"
          data-testid={`video-${destinationId}-${slotKey}-motion`}
          className={SELECT}
          value={settings.motion}
          disabled={pending || busy}
          onChange={(e) => choose({ motion: e.target.value as VideoMotion })}
        >
          {Object.entries(VIDEO_MOTIONS).map(([key, m]) => (
            <option key={key} value={key}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Length"
          data-testid={`video-${destinationId}-${slotKey}-length`}
          className={SELECT}
          value={settings.seconds}
          disabled={pending || busy}
          onChange={(e) =>
            choose({ seconds: Number(e.target.value) as VideoSeconds })
          }
        >
          {settings.allowed.map((s) => (
            <option key={s} value={s}>
              {s} s
            </option>
          ))}
        </select>
      </div>
      <select
        aria-label="Orientation"
        data-testid={`video-${destinationId}-${slotKey}-orientation`}
        className={SELECT}
        value={settings.orientation}
        disabled={pending || busy}
        onChange={(e) =>
          choose({ orientation: e.target.value as VideoOrientation })
        }
      >
        <option value="portrait">Vertical 9:16</option>
        <option value="landscape">Landscape 16:9</option>
      </select>
      {settings.stills ? (
        <>
          <Button
            variant="secondary"
            size="xs"
            data-testid={`video-${destinationId}-${slotKey}-make-stills`}
            disabled={pending || busy || !settings.startFrame}
            onClick={makeStills}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Film />}
            {rendered ? "Make it again · free" : "Make the video · free"}
          </Button>
          <span className="font-sans text-[0.68rem] leading-snug text-on-surface-mid">
            Kiln shows each approved scene with a slow zoom and slides to the
            next, starting from {frameLabel}: no model, no audio, nothing paid.
          </span>
        </>
      ) : null}
      <Button
        hidden={settings.stills}
        variant="secondary"
        size="xs"
        data-testid={`video-${destinationId}-${slotKey}-generate`}
        disabled={
          pending ||
          busy ||
          !settings.startFrame ||
          usd === null ||
          blocked !== null
        }
        title={blocked ?? undefined}
        onClick={() => setConfirming(true)}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Film />}
        {rendered ? "Re-roll video" : "Generate video"}
        {usd === null ? "" : ` · ${money(usd)}`}
      </Button>
      {blocked && !settings.stills ? (
        <span
          data-testid={`video-${destinationId}-${slotKey}-blocked`}
          className="font-sans text-[0.68rem] leading-snug text-fail"
        >
          {blocked}
        </span>
      ) : null}
      {error ? (
        <span className="font-mono text-[0.6rem] text-fail">{error}</span>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        busy={pending}
        testId="video-confirm"
        title="Generate the video?"
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-sans text-sm">
          <dt className="text-on-surface-mid">Starts from</dt>
          <dd className="text-foreground">{frameLabel} (approved)</dd>
          <dt className="text-on-surface-mid">Motion</dt>
          <dd className="text-foreground">
            {VIDEO_MOTIONS[settings.motion].label}, {settings.seconds} s,{" "}
            {settings.orientation === "landscape"
              ? "landscape 16:9"
              : "vertical 9:16"}
          </dd>
          <dt className="text-on-surface-mid">Model</dt>
          <dd className="text-foreground">
            {modelLabel(model)}
            {model.resolution ? `, ${model.resolution}` : ""}
          </dd>
          <dt className="text-on-surface-mid">Estimated</dt>
          <dd className="text-foreground">
            {usd === null ? "no pinned price" : money(usd)} (priced by the
            second; Kiln records what the clip used)
          </dd>
          <dt className="text-on-surface-mid">This month</dt>
          <dd
            data-testid="video-confirm-month"
            className={cn(
              // A member's answer may take two lines at 390 px: the row keeps
              // them from "checking" on, so the dialog does not move.
              ask !== null && "min-h-[2lh] sm:min-h-0",
              ask !== null && fit !== "fits" && fit !== "checking"
                ? "text-fail"
                : "text-foreground",
            )}
          >
            {"line" in month ? month.line : monthFitLine(fit, month.ask)}
          </dd>
        </dl>
        <p className="font-sans text-[0.8rem] leading-snug text-on-surface-mid">
          Kiln animates the approved scene in the background; the product stays
          exactly as photographed. A render that fails is never paid twice.
        </p>
        {overCap ? (
          <p
            className="font-mono text-[0.7rem] text-fail"
            data-testid="video-confirm-over-cap"
          >
            This video would go over the monthly cap.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            data-testid="video-confirm-cancel"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            data-testid="video-confirm-generate"
            disabled={pending || overCap || (ask !== null && fit !== "fits")}
            onClick={generate}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Film />}
            Generate · {usd === null ? "" : money(usd)}
          </Button>
        </div>
      </ConfirmDialog>
    </div>
  );
}

// For a project made before video: add the destination's video slot.
export function AddVideoButton({
  projectId,
  destinationId,
}: {
  projectId: string;
  destinationId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        size="xs"
        data-testid={`video-${destinationId}-add`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await addVideoAction({ projectId, destinationId });
            setError(result.error ?? null);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Plus />}
        Add video
      </Button>
      {error ? (
        <span className="font-mono text-[0.6rem] text-fail">{error}</span>
      ) : null}
    </span>
  );
}
