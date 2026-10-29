"use client";

import {
  catalogFor,
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_VIDEO_RESOLUTION,
  type ImageQuality,
  type ModelKind,
  modelEntry,
  modelLabel,
  PROVIDER_LABELS,
  type ProviderId,
  type VideoResolution,
} from "@/domain/model-defaults";
import { priceHint } from "@/lib/model-prices";
import { cn } from "@/lib/utils";

export interface ModelValue {
  provider: ProviderId;
  model: string;
  quality?: ImageQuality;
  resolution?: VideoResolution;
}

// What the picker needs to know of each provider's health (free to read).
export interface ProviderNote {
  provider: ProviderId;
  keyPresent: boolean;
  lastError: { message: string } | null;
}

const SELECT =
  "min-w-0 rounded-field border border-border bg-card px-2 py-1 font-sans text-[0.75rem] text-foreground disabled:opacity-50";

function groupNote(note: ProviderNote | undefined): string {
  if (!note) return "";
  if (!note.keyPresent) return " — no API key";
  if (note.lastError) return " — last call failed";
  return "";
}

// One model choice: the catalog's models of both providers, grouped by
// provider with each one's price, and what prices it — the quality of an
// OpenAI image, the resolution of a video. A model Kiln no longer offers (Sora)
// shows as its label until another is picked; nothing is ever switched on its
// own. Used by Settings → Models, the board's slots and the card editor.
export function ModelChoice({
  kind,
  value,
  onChange,
  notes = [],
  disabled = false,
  className,
}: {
  kind: ModelKind;
  value: ModelValue;
  onChange: (next: ModelValue) => void;
  notes?: ProviderNote[];
  disabled?: boolean;
  className?: string;
}) {
  const catalog = catalogFor(kind);
  const entry = modelEntry(value);
  const offered = catalog.some(
    (m) => m.provider === value.provider && m.id === value.model,
  );
  const key = `${value.provider}/${value.model}`;
  const pick = (next: string) => {
    const choice = catalog.find((m) => `${m.provider}/${m.id}` === next);
    if (!choice) return;
    // What prices the new model is carried over when it applies, else
    // cleared (a Gemini image has no quality).
    onChange({
      provider: choice.provider,
      model: choice.id,
      quality: choice.qualities
        ? (value.quality ?? DEFAULT_IMAGE_QUALITY)
        : undefined,
      resolution: choice.seconds
        ? value.resolution && choice.seconds[value.resolution]
          ? value.resolution
          : DEFAULT_VIDEO_RESOLUTION
        : undefined,
    });
  };
  const providers: ProviderId[] = ["openai", "google"];
  return (
    <div
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
    >
      <select
        aria-label={`${kind} model`}
        data-testid={`model-${kind}`}
        className={cn(SELECT, "w-0 min-w-0 flex-1 basis-0")}
        value={key}
        disabled={disabled}
        onChange={(e) => pick(e.target.value)}
      >
        {providers.map((provider) => {
          const models = catalog.filter((m) => m.provider === provider);
          if (models.length === 0) return null;
          const note = notes.find((n) => n.provider === provider);
          return (
            <optgroup
              key={provider}
              label={`${PROVIDER_LABELS[provider]}${groupNote(note)}`}
            >
              {models.map((m) => {
                const price = priceHint(
                  {
                    provider: m.provider,
                    model: m.id,
                    quality: value.quality,
                    resolution: value.resolution,
                  },
                  kind,
                );
                return (
                  <option key={m.id} value={`${m.provider}/${m.id}`}>
                    {[m.label, price, m.retires ? `retires ${m.retires}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </option>
                );
              })}
            </optgroup>
          );
        })}
        {offered ? null : (
          <option value={key} disabled>
            {modelLabel(value)}
          </option>
        )}
      </select>
      {entry?.qualities && offered ? (
        <select
          aria-label="Quality"
          data-testid={`model-${kind}-quality`}
          className={SELECT}
          value={value.quality ?? DEFAULT_IMAGE_QUALITY}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...value, quality: e.target.value as ImageQuality })
          }
        >
          {entry.qualities.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      ) : null}
      {entry?.seconds && offered ? (
        <select
          aria-label="Resolution"
          data-testid={`model-${kind}-resolution`}
          className={SELECT}
          value={value.resolution ?? DEFAULT_VIDEO_RESOLUTION}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              resolution: e.target.value as VideoResolution,
            })
          }
        >
          {(Object.keys(entry.seconds) as VideoResolution[]).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
