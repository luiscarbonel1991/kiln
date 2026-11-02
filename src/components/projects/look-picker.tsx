"use client";

import { cn } from "@/lib/utils";

export interface LookOption {
  // null: the project's look, for a frame that follows it.
  key: string | null;
  label: string;
  // A colour's face, drawn as its chip.
  face?: string;
  // Why it cannot be picked; absent when it can.
  refused?: string;
  // What in the product's text contradicts this colour, said once it is
  // picked; it can still be picked.
  warning?: string;
}

// A colour and a style to show the product in (ROADMAP P2-9): New project
// picks the project's, Tune a frame's. Free: Kiln redraws the design in the
// look, nothing is generated. An option Kiln cannot draw says why, and a
// colour the product's text contradicts says what, once picked.
export function LookPicker({
  colours,
  styles,
  colour,
  style,
  onColour,
  onStyle,
  disabled = false,
  testId,
  label,
}: {
  colours: LookOption[];
  styles: LookOption[];
  colour: string | null;
  style: string | null;
  onColour: (key: string | null) => void;
  onStyle: (key: string | null) => void;
  disabled?: boolean;
  testId: string;
  label: string;
}) {
  const pill = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 font-sans text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border-soft bg-secondary text-foreground hover:border-primary",
    );
  const row = (
    name: string,
    options: LookOption[],
    value: string | null,
    on: (key: string | null) => void,
  ) => (
    <div className="flex flex-col gap-1.5">
      <span className={label}>{name}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.key ?? "project"}
            type="button"
            aria-pressed={value === o.key}
            disabled={disabled || o.refused !== undefined}
            title={o.refused}
            data-testid={`${testId}-${name.toLowerCase()}-${o.key ?? "project"}`}
            onClick={() => on(o.key)}
            className={pill(value === o.key)}
          >
            {o.face ? (
              <span
                className="inline-block size-3 rounded-pill border border-border"
                style={{ background: o.face }}
              />
            ) : null}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
  const warning = colours.find((o) => o.key === colour)?.warning;
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {colours.length > 1 ? row("Colour", colours, colour, onColour) : null}
      {warning ? (
        <output
          data-testid={`${testId}-text-warning`}
          className="block font-sans text-[0.75rem] text-prov-local"
        >
          {warning}
        </output>
      ) : null}
      {styles.length > 1 ? row("Style", styles, style, onStyle) : null}
    </div>
  );
}
