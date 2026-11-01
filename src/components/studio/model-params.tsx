"use client";

import type { ModelConfig } from "@/domain/model-config";

const ASPECTS = ["1:1", "4:5", "5:4", "3:2", "2:3", "16:9", "9:16"].map(
  (a) => ({ value: a, label: a }),
);
// A video renders vertical or landscape only, and takes no guidance or
// strength (Gemini Omni Flash).
const VIDEO_ASPECTS = [
  { value: "9:16", label: "Vertical 9:16" },
  { value: "16:9", label: "Landscape 16:9" },
];

// What a card may set: its aspects (with the one shown), and whether it takes
// guidance and strength.
export function paramChoices(aspect: string, video: boolean) {
  return video
    ? {
        aspects: VIDEO_ASPECTS,
        aspect: aspect === "16:9" ? "16:9" : "9:16",
        tuning: false,
      }
    : { aspects: ASPECTS, aspect, tuning: true };
}

const rowClass =
  "flex items-center justify-between gap-2 border-border-soft border-b py-1";
const fieldClass =
  "min-w-0 bg-transparent text-right font-medium text-foreground outline-none focus:text-primary";

// Editable model parameters (aspect, guidance, strength; a video only its
// aspect). The model itself is chosen via ModelChoice (image and video cards).
// Persisted via the card's model; applied on the next Generate/Re-roll.
export function ModelParams({
  model,
  onEdit,
  testId,
  video = false,
}: {
  model: ModelConfig;
  onEdit: (patch: Partial<ModelConfig>) => void;
  testId: string;
  video?: boolean;
}) {
  const { aspects, aspect, tuning } = paramChoices(model.aspect, video);
  return (
    <div className="font-mono text-[0.6875rem]">
      <div className={rowClass}>
        <span className="text-on-surface-dim">aspect</span>
        <select
          value={aspect}
          onChange={(e) => onEdit({ aspect: e.target.value })}
          aria-label="Aspect ratio"
          data-testid={`${testId}-aspect`}
          className={fieldClass}
        >
          {aspects.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      {tuning ? (
        <>
          <div className={rowClass}>
            <span className="text-on-surface-dim">guidance</span>
            <input
              type="number"
              step="0.5"
              min="0"
              max="20"
              value={model.guidance}
              onChange={(e) => onEdit({ guidance: Number(e.target.value) })}
              aria-label="Guidance"
              data-testid={`${testId}-guidance`}
              className={`${fieldClass} w-16`}
            />
          </div>
          <div className={rowClass}>
            <span className="text-on-surface-dim">strength</span>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={model.strength}
              onChange={(e) => onEdit({ strength: Number(e.target.value) })}
              aria-label="Strength"
              data-testid={`${testId}-strength`}
              className={`${fieldClass} w-16`}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
