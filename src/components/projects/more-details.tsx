"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { Treatment, Unit } from "@/domain/product";
import { counter } from "@/lib/product-checks";
import { cn } from "@/lib/utils";

export interface Details {
  depth: string;
  relief: string;
  hook: string;
  cta: string;
  description: string;
}

export const emptyDetails = (): Details => ({
  depth: "",
  relief: "",
  hook: "",
  cta: "",
  description: "",
});

const RELIEF: Partial<Record<Treatment, string>> = {
  raised: "How far the marks stand out",
  engraved: "How deep the engraving goes",
  inlaid: "How deep the inlay goes",
};

// What a product may also say, folded until the maker wants it (open on its
// own when any of it is set): its thickness, its relief, the listing's hook
// and call to action, and a description.
export function MoreDetails({
  details,
  onChange,
  unit,
  treatment,
  field,
  label,
}: {
  details: Details;
  onChange: (details: Details) => void;
  unit: Unit;
  treatment: Treatment;
  field: string;
  label: string;
}) {
  const set = (patch: Partial<Details>) => onChange({ ...details, ...patch });
  const filled = Object.values(details).some((v) => v.trim() !== "");
  const [open, setOpen] = useState(filled);
  const relief = RELIEF[treatment];
  const count = (value: string, limit: number) => {
    const c = counter(value, limit);
    return c ? (
      <span className="font-mono text-[0.625rem] text-on-surface-dim">{c}</span>
    ) : null;
  };
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 self-start font-sans text-[0.8rem] font-semibold text-on-surface-mid hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            open ? "" : "-rotate-90",
          )}
        />
        More details (optional)
      </button>
      {open ? (
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={label}>Thickness ({unit})</span>
            <input
              data-field="depth"
              className={cn(field, "max-w-[160px]")}
              inputMode="decimal"
              value={details.depth}
              placeholder={unit === "in" ? "0.25" : "6"}
              onChange={(e) => set({ depth: e.target.value })}
            />
          </label>
          {relief ? (
            <label className="flex flex-col gap-1.5">
              <span className={label}>
                {relief} ({unit})
              </span>
              <input
                data-field="relief"
                className={cn(field, "max-w-[160px]")}
                inputMode="decimal"
                value={details.relief}
                placeholder={unit === "in" ? "0.06" : "1.5"}
                onChange={(e) => set({ relief: e.target.value })}
              />
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between gap-2">
              <span className={label}>Hook</span>
              {count(details.hook, 80)}
            </span>
            <input
              data-field="hook"
              className={field}
              value={details.hook}
              placeholder="Your name, on your desk."
              onChange={(e) => set({ hook: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between gap-2">
              <span className={label}>Call to action</span>
              {count(details.cta, 40)}
            </span>
            <input
              data-field="cta"
              className={field}
              value={details.cta}
              placeholder="Order yours"
              onChange={(e) => set({ cta: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="flex items-baseline justify-between gap-2">
              <span className={label}>Description</span>
              {count(details.description, 1000)}
            </span>
            <textarea
              data-field="description"
              className={cn(field, "h-auto min-h-[5rem] py-2")}
              value={details.description}
              placeholder="What it is made of, how it is made, what comes with it."
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
