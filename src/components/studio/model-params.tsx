"use client";

import type { ModelConfig } from "@/domain/model-config";

const ASPECTS = ["1:1", "4:5", "5:4", "3:2", "2:3", "16:9", "9:16"];

const rowClass =
  "flex items-center justify-between gap-2 border-border-soft border-b py-1";
const fieldClass =
  "min-w-0 bg-transparent text-right font-medium text-foreground outline-none focus:text-primary";

// Editable model parameters (aspect, guidance, strength). The model itself is
// chosen via ModelChoice (image and video cards). Persisted via the card's
// model; applied on the next Generate/Re-roll.
export function ModelParams({
  model,
  onEdit,
  testId,
}: {
  model: ModelConfig;
  onEdit: (patch: Partial<ModelConfig>) => void;
  testId: string;
}) {
  return (
    <div className="font-mono text-[0.6875rem]">
      <div className={rowClass}>
        <span className="text-on-surface-dim">aspect</span>
        <select
          value={model.aspect}
          onChange={(e) => onEdit({ aspect: e.target.value })}
          aria-label="Aspect ratio"
          data-testid={`${testId}-aspect`}
          className={fieldClass}
        >
          {ASPECTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
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
    </div>
  );
}
