"use client";

import { Check, ImagePlus, Loader2, Undo2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { addReferenceAction, setSlotApprovalAction } from "@/app/actions/board";
import { Button } from "@/components/ui/button";

export function ApproveButton({
  projectId,
  destinationId,
  slotKey,
  approved,
}: {
  projectId: string;
  destinationId: string;
  slotKey: string;
  approved: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={approved ? "ghost" : "secondary"}
      size="xs"
      disabled={pending}
      onClick={() =>
        startTransition(() =>
          setSlotApprovalAction({
            projectId,
            destinationId,
            slotKey,
            approved: !approved,
          }),
        )
      }
    >
      {pending ? (
        <Loader2 className="animate-spin" />
      ) : approved ? (
        <Undo2 />
      ) : (
        <Check />
      )}
      {approved ? "Undo approval" : "Approve"}
    </Button>
  );
}

// One upload makes the product's reference the anchor of every scene: a photo
// of the product, or the plate the maker's own renderer produced.
export function ReferenceUpload({ projectId }: { projectId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const form = new FormData();
          form.set("projectId", projectId);
          form.set("file", file);
          setError(null);
          startTransition(async () => {
            try {
              await addReferenceAction(form);
            } catch {
              setError("The upload failed. PNG, JPEG or WebP up to 15 MB.");
            }
          });
        }}
      />
      <Button
        size="sm"
        disabled={pending}
        onClick={() => input.current?.click()}
        className="self-start"
      >
        {pending ? <Loader2 className="animate-spin" /> : <ImagePlus />}
        Add reference image
      </Button>
      {error ? (
        <p className="font-mono text-[0.65rem] text-prov-local">{error}</p>
      ) : null}
    </div>
  );
}
