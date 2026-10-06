"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  PackageCheck,
  Star,
  Undo2,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import {
  addReferenceAction,
  moveSlotAction,
  setSlotApprovalAction,
  setSlotOffAction,
} from "@/app/actions/board";
import { deliverAction } from "@/app/actions/deliver";
import { Button } from "@/components/ui/button";
import { downloadAsset } from "@/lib/download";

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

// Take a slot out of the deliverable (no generation, not counted) or put it
// back. A scene in the queue refuses until its job is done.
export function SlotSwitch({
  projectId,
  destinationId,
  slotKey,
  off,
}: {
  projectId: string;
  destinationId: string;
  slotKey: string;
  off: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Button
        variant="ghost"
        size="xs"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setSlotOffAction({
              projectId,
              destinationId,
              slotKey,
              off: !off,
            });
            setError(result?.error ?? null);
          })
        }
      >
        {pending ? (
          <Loader2 className="animate-spin" />
        ) : off ? (
          <Eye />
        ) : (
          <EyeOff />
        )}
        {off ? "Switch on" : "Switch off"}
      </Button>
      {error ? (
        <span className="font-mono text-[0.6rem] text-prov-local">{error}</span>
      ) : null}
    </span>
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

// Export a destination's deliverable as a zip (every slot switched on, in
// order, at its pixel target) and download it. Ready only when every slot is
// exact or approved; otherwise it says what is missing.
export function DeliverButton({
  projectId,
  destinationId,
  destinationName,
  blocker,
  delivered,
}: {
  projectId: string;
  destinationId: string;
  destinationName: string;
  blocker: string | null;
  delivered: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 pt-2">
      <Button
        variant={delivered ? "secondary" : "default"}
        size="sm"
        disabled={pending || blocker !== null}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await deliverAction({ projectId, destinationId });
            if ("error" in result) {
              setFailed(true);
              setMessage(result.error);
              return;
            }
            try {
              await downloadAsset(result.url, result.filename);
              setFailed(false);
              setMessage(`${result.count} files in ${result.filename}`);
            } catch {
              setFailed(true);
              setMessage("The zip is ready but the download failed.");
            }
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <PackageCheck />}
        {pending
          ? "Exporting…"
          : delivered
            ? `Export ${destinationName} again (.zip)`
            : `Export ${destinationName} (.zip)`}
      </Button>
      {blocker || message ? (
        <p
          className={`font-mono text-[0.6rem] leading-snug ${failed ? "text-prov-local" : "text-on-surface-mid"}`}
        >
          {message ?? blocker}
        </p>
      ) : null}
    </div>
  );
}

// The photo order: make a slot the first (the listing's thumbnail: often the
// in-use shot, not the studio hero), or move it one place.
export function SlotOrder({
  projectId,
  destinationId,
  slotKey,
  place,
  last,
  firstLabel,
}: {
  projectId: string;
  destinationId: string;
  slotKey: string;
  place: number;
  last: number;
  firstLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const move = (to: "first" | "earlier" | "later") =>
    startTransition(() =>
      moveSlotAction({ projectId, destinationId, slotKey, move: to }),
    );
  return (
    <span className="inline-flex items-center gap-0.5">
      {place > 0 ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={pending}
          onClick={() => move("first")}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Star />}
          {firstLabel}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="xs"
        aria-label="Move earlier"
        title="Move earlier"
        disabled={pending || place === 0}
        onClick={() => move("earlier")}
      >
        <ArrowLeft />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        aria-label="Move later"
        title="Move later"
        disabled={pending || place >= last}
        onClick={() => move("later")}
      >
        <ArrowRight />
      </Button>
    </span>
  );
}
