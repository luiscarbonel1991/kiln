"use client";

import { useState, useTransition } from "react";
import { setCardModelAction } from "@/app/actions/board";
import {
  ModelChoice,
  type ModelValue,
  type ProviderNote,
} from "@/components/models/model-choice";
import type { ModelKind } from "@/domain/model-defaults";

// A slot's own model on the board: the next generation runs on it (a job
// already queued keeps its request). Refusals come back as the reason.
export function SlotModel({
  projectId,
  cardId,
  kind,
  value,
  notes,
  disabled = false,
}: {
  projectId: string;
  cardId: string;
  kind: ModelKind;
  value: ModelValue;
  notes: ProviderNote[];
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5">
      <ModelChoice
        kind={kind}
        value={value}
        notes={notes}
        disabled={disabled || pending}
        onChange={(model) =>
          startTransition(async () => {
            const result = await setCardModelAction({
              projectId,
              cardId,
              model,
            });
            setError(result.error ?? null);
          })
        }
      />
      {error ? (
        <span className="font-mono text-[0.6rem] text-prov-local">{error}</span>
      ) : null}
    </div>
  );
}
