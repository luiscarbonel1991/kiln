"use client";

import { Popover } from "radix-ui";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

// A text field with the maker's own materials as suggestions: it filters as
// they type, keeps whatever they write (a new material is one more row,
// "Use …"), and works from the keyboard. Kiln's look, not the browser's list.
export function MaterialCombobox({
  label,
  value,
  onChange,
  options,
  field,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  // The input class the form uses.
  field: string;
  placeholder?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = value.trim();
  const matches = options
    .filter((o) => o.toLowerCase().includes(typed.toLowerCase()))
    .slice(0, 8);
  const exact = options.some((o) => o.toLowerCase() === typed.toLowerCase());
  const items = [
    ...matches.map((o) => ({ value: o, label: o, created: false })),
    ...(typed && !exact
      ? [{ value: typed, label: `Use “${typed}”`, created: true }]
      : []),
  ];
  const shown = open && items.length > 0;
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover.Root open={shown} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <input
          role="combobox"
          aria-label={label}
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            shown && items[active] ? `${listId}-${active}` : undefined
          }
          data-field="material"
          className={field}
          value={value}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && shown && items[active]) {
              e.preventDefault();
              pick(items[active].value);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (
              e.target instanceof HTMLElement &&
              e.target.getAttribute("aria-controls") === listId
            ) {
              e.preventDefault();
            }
          }}
          className="z-50 w-[var(--radix-popover-trigger-width)] rounded-field bg-card p-1 shadow-card ring-1 ring-border"
        >
          <div id={listId} role="listbox" aria-label="Materials">
            {items.map((item, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the field's arrow keys and Enter choose (aria-activedescendant)
              <div
                key={`${item.created}-${item.value}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                // Keep the focus in the field; the pick is the click, so a
                // plain element.click() picks too.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(item.value)}
                className={cn(
                  "cursor-pointer rounded-[9px] px-2.5 py-1.5 font-sans text-sm",
                  i === active
                    ? "bg-secondary text-foreground"
                    : "text-on-surface-mid",
                  item.created && "font-semibold text-primary",
                )}
              >
                {item.label}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
