"use client";

import type { ModelConfig } from "@/domain/model-config";
import {
  IMAGE_MODEL_CATALOG,
  VIDEO_MODEL_CATALOG,
} from "@/domain/model-defaults";

// Per-card model picker — lists the exact models (grouped by provider) so the
// maker switches by MODEL, not just provider. Picking one applies provider +
// model together; a card carrying an unknown id (env override) stays displayable.
// `kind` selects the catalog: image (Gemini/GPT Image) or video (Veo/Sora).
export function ModelPicker({
  model,
  onEdit,
  kind = "image",
}: {
  model: ModelConfig;
  onEdit: (patch: Partial<ModelConfig>) => void;
  kind?: "image" | "video";
}) {
  const catalog = kind === "video" ? VIDEO_MODEL_CATALOG : IMAGE_MODEL_CATALOG;
  const known = catalog.some((m) => m.id === model.model);
  const group = (provider: "google" | "openai") =>
    catalog.filter((m) => m.provider === provider);
  return (
    <label className="flex items-center justify-between gap-2 border-border-soft border-b py-1 font-mono text-[0.6875rem]">
      <span className="text-on-surface-dim">model</span>
      <select
        value={model.model}
        onChange={(e) => {
          const choice = catalog.find((m) => m.id === e.target.value);
          if (choice) onEdit({ provider: choice.provider, model: choice.id });
        }}
        className="min-w-0 flex-1 bg-transparent text-right font-medium text-foreground outline-none focus:text-primary"
      >
        <optgroup label="Google">
          {group("google").map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="OpenAI">
          {group("openai").map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
        {known ? null : <option value={model.model}>{model.model}</option>}
      </select>
    </label>
  );
}
