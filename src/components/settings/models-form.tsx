"use client";

import { Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { saveMakerModelsAction } from "@/app/actions/settings";
import {
  ModelChoice,
  type ModelValue,
  type ProviderNote,
} from "@/components/models/model-choice";
import { Button } from "@/components/ui/button";
import type { MakerModels, ModelKind } from "@/domain/model-defaults";

const ROWS: { kind: ModelKind; label: string; what: string }[] = [
  {
    kind: "image",
    label: "Images",
    what: "What new scene cards start on (photos and slides).",
  },
  {
    kind: "video",
    label: "Video",
    what: "What a listing video starts on; it animates an approved scene.",
  },
  {
    kind: "text",
    label: "Text",
    what: "Reads a product photo and directs the scenes in the studio.",
  },
];

// Settings → Models: the maker's default model per kind. A card or slot can
// still pick its own; changing a default never changes a card already made.
export function ModelsForm({
  initial,
  notes,
}: {
  initial: MakerModels;
  notes: ProviderNote[];
}) {
  const [models, setModels] = useState<MakerModels>(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);
  const dirty = JSON.stringify(models) !== JSON.stringify(initial);
  const save = () =>
    startTransition(async () => {
      const result = await saveMakerModelsAction(models);
      setMessage(
        result.error ? { ok: false, error: result.error } : { ok: true },
      );
    });
  return (
    <div className="flex flex-col gap-4">
      {ROWS.map((row) => (
        <div
          key={row.kind}
          className="grid grid-cols-1 gap-2 border-b border-border-soft pb-4 sm:grid-cols-[150px_1fr] sm:gap-5"
        >
          <div>
            <div className="font-sans text-sm font-semibold text-foreground">
              {row.label}
            </div>
            <div className="font-sans text-[0.75rem] leading-snug text-on-surface-mid">
              {row.what}
            </div>
          </div>
          <ModelChoice
            kind={row.kind}
            value={models[row.kind] as ModelValue}
            notes={notes}
            disabled={pending}
            onChange={(next) => {
              setMessage(null);
              setModels((m) => ({ ...m, [row.kind]: next }));
            }}
          />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={pending || !dirty} onClick={save}>
          {pending ? <Loader2 className="animate-spin" /> : <Check />}
          Save defaults
        </Button>
        {message?.ok ? (
          <span className="font-mono text-[0.65rem] text-prov-recipe">
            Saved. New cards start on these.
          </span>
        ) : message ? (
          <span className="font-mono text-[0.65rem] text-prov-local">
            {message.error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
