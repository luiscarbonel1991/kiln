import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A labelled on/off switch (role="switch"), small, in the Settings style.
export function Switch({
  checked,
  onChange,
  disabled,
  testId,
  label,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId: string;
  // The accessible name, when the visible text is not enough.
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-2 font-sans text-[0.75rem] text-foreground disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full border border-border transition-colors",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-2.5 rounded-full bg-card shadow-sm transition-all",
            checked ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
      {children}
    </button>
  );
}
