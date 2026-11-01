"use client";

import { Loader2, Undo2 } from "lucide-react";
import { type MouseEvent, useEffect, useState, useTransition } from "react";
import { checkSampleAction, correctSampleAction } from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { colourDifference, SAME_COLOUR } from "@/lib/material-check";

type Named = { name: string; hex: string };

// A colour's material photo checked against its swatch, in the product form:
// tap something white or grey to correct the light, then say which is the
// truth. "The photo is right" takes the photo's colour as the swatch; "The
// swatch is right" tints the photo to the swatch, the grain kept. Nothing
// changes on its own, and nothing is saved until Save. Undo puts the photo
// and the swatch back as they were when the check opened.
export function MaterialCheck({
  colour,
  photoColour,
  onClose,
  onPhoto,
  onHex,
}: {
  // The row as it is now: its name, swatch and photo.
  colour: { name: string; hex: string; swatchUrl: string };
  // The photo's colour when already read (right after an upload).
  photoColour: Named | null;
  onClose: () => void;
  onPhoto: (url: string) => void;
  onHex: (hex: string) => void;
}) {
  const [start] = useState(() => ({
    url: colour.swatchUrl,
    hex: colour.hex,
    read: photoColour,
  }));
  const [read, setRead] = useState<Named | null>(photoColour);
  const [lightFixed, setLightFixed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  // Opened from a saved photo: its colour is read once.
  useEffect(() => {
    if (start.read) return;
    startPending(async () => {
      const result = await checkSampleAction({ url: start.url });
      if ("error" in result) setError(result.error);
      else setRead(result.colour);
    });
  }, [start]);

  const correct = (
    how: { white: { x: number; y: number } } | { swatch: string },
  ) =>
    startPending(async () => {
      setError(null);
      const result = await correctSampleAction({
        url: colour.swatchUrl,
        ...how,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onPhoto(result.url);
      setRead(result.colour);
      if ("white" in how) setLightFixed(true);
    });

  function tap(e: MouseEvent<HTMLButtonElement>) {
    // A keyboard press has no point to read.
    if (e.detail === 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const at = (v: number) => Math.min(1, Math.max(0, v));
    correct({
      white: {
        x: at((e.clientX - box.left) / box.width),
        y: at((e.clientY - box.top) / box.height),
      },
    });
  }

  function undo() {
    setError(null);
    onPhoto(start.url);
    onHex(start.hex);
    setRead(start.read);
    setLightFixed(false);
    if (!start.read) {
      startPending(async () => {
        const result = await checkSampleAction({ url: start.url });
        if (!("error" in result)) setRead(result.colour);
      });
    }
  }

  const same =
    read !== null && colourDifference(read.hex, colour.hex) < SAME_COLOUR;
  const changed =
    colour.swatchUrl !== start.url ||
    colour.hex.toUpperCase() !== start.hex.toUpperCase();

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      busy={pending}
      testId="material-check"
      title={`Check the material photo · ${colour.name || "this colour"}`}
    >
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          data-testid="material-check-photo"
          aria-label="Tap something white or grey in the photo to correct its light"
          disabled={pending}
          onClick={tap}
          className="relative inline-block max-w-full cursor-crosshair overflow-hidden rounded-render shadow-render disabled:cursor-wait"
        >
          {/* biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio */}
          <img
            src={colour.swatchUrl}
            alt={`${colour.name || "This colour"} material`}
            className="block max-h-[40dvh] w-auto max-w-full"
          />
          {pending ? (
            <span className="absolute inset-0 flex items-center justify-center bg-card/50">
              <Loader2 className="size-5 animate-spin text-on-surface-mid" />
            </span>
          ) : null}
        </button>
        <p className="font-sans text-[0.75rem] leading-snug text-on-surface-mid">
          {lightFixed
            ? "Light corrected from the spot you tapped. Tap again to try another spot."
            : "Tap something white or grey (a sheet of paper beside the sample) to correct the light. Optional."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Side label="Swatch" hex={colour.hex} name={null} />
        <Side
          label="The photo reads"
          hex={read?.hex ?? null}
          name={read?.name ?? null}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="font-sans text-[0.75rem] text-prov-local"
          data-testid="material-check-error"
        >
          {error}
        </p>
      ) : null}

      {read === null ? null : same ? (
        <p
          className="font-sans text-sm text-foreground"
          data-testid="material-check-verdict"
        >
          They match: scenes copy this photo, in this colour.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p
            className="font-sans text-sm text-foreground"
            data-testid="material-check-verdict"
          >
            They differ. Scenes copy the photo, so say which is true.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              data-testid="material-check-photo-right"
              disabled={pending}
              onClick={() => onHex(read.hex)}
            >
              The photo is right
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="material-check-swatch-right"
              disabled={pending}
              title="Tints the photo to the swatch; its grain stays"
              onClick={() => correct({ swatch: colour.hex })}
            >
              The swatch is right
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border-soft pt-3">
        {changed ? (
          <Button
            size="sm"
            variant="ghost"
            data-testid="material-check-undo"
            disabled={pending}
            onClick={undo}
          >
            <Undo2 /> Undo
          </Button>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          data-testid="material-check-done"
          disabled={pending}
          onClick={onClose}
        >
          Done
        </Button>
      </div>
    </ConfirmDialog>
  );
}

function Side({
  label,
  hex,
  name,
}: {
  label: string;
  hex: string | null;
  name: string | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="size-10 flex-shrink-0 rounded-swatch border border-border bg-secondary"
        style={hex ? { background: hex } : undefined}
      />
      <span className="flex min-w-0 flex-col">
        <span className="font-sans text-[0.72rem] text-on-surface-mid">
          {label}
        </span>
        <span className="font-mono text-[0.78rem] text-foreground">
          {hex ?? "reading…"}
          {name ? (
            <span className="font-sans text-on-surface-mid"> · {name}</span>
          ) : null}
        </span>
      </span>
    </div>
  );
}
