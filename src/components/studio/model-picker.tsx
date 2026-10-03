"use client";

import type { ModelConfig } from "@/domain/model-config";
import { generationCatalog } from "@/domain/model-defaults";

// Per-card model picker — lists the exact models the generation policy allows
// (OpenAI only, see model-defaults), grouped by provider, so the maker switches
// by MODEL. Picking one applies provider + model together; a card still carrying
// another id (a Google card made before the policy, an env override) stays
// displayable and moves to the default on its next generation.
// `kind` selects the catalog: image or video.
export function ModelPicker({
  model,
  onEdit,
  kind = "image",
}: {
  model: ModelConfig;
  onEdit: (patch: Partial<ModelConfig>) => void;
  kind?: "image" | "video";
}) {
  const catalog = generationCatalog(kind);
  const known = catalog.some((m) => m.id === model.model);
  const groups = [
    { label: "OpenAI", models: catalog.filter((m) => m.provider === "openai") },
    { label: "Google", models: catalog.filter((m) => m.provider === "google") },
  ].filter((g) => g.models.length > 0);
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
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
        {known ? null : <option value={model.model}>{model.model}</option>}
      </select>
    </label>
  );
}
