"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Where the piece is used, the most typical first: the in-use and lifestyle
// scenes take place there, one place each in turn.
export function PlacesOfUse({
  places,
  onChange,
  field,
  notes,
  max = 6,
}: {
  places: string[];
  onChange: (places: string[]) => void;
  field: string;
  // The review's note for a place, if any ("useContexts.1"); one past the
  // last offers a new place.
  notes?: (field: string) => ReactNode;
  max?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {places.map((place, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
          key={i}
          className="flex flex-col gap-1"
        >
          <div className="flex items-center gap-2">
            <input
              aria-label={`Place ${i + 1}`}
              data-field={`useContexts.${i}`}
              className={cn(field)}
              value={place}
              placeholder={i === 0 ? "a kitchen counter" : "a dinner table"}
              onChange={(e) =>
                onChange(places.map((p, j) => (j === i ? e.target.value : p)))
              }
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove place ${i + 1}`}
              onClick={() => onChange(places.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
          {notes?.(`useContexts.${i}`)}
        </div>
      ))}
      {notes?.(`useContexts.${places.length}`)}
      {places.length < max ? (
        <Button
          variant="ghost"
          size="xs"
          className="self-start"
          onClick={() => onChange([...places, ""])}
        >
          <Plus /> {places.length === 0 ? "Add a place" : "Add another place"}
        </Button>
      ) : null}
      <span className="font-sans text-[0.75rem] text-on-surface-mid">
        The in-use and lifestyle scenes take place here, the first most often.
      </span>
    </div>
  );
}
