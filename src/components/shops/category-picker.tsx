"use client";

import { Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

export interface CategoryChoice {
  id: number;
  path: string[];
}

const MAX_SHOWN = 12;

// Etsy's category for a draft: a search over the seller taxonomy, each match
// shown with its path down from the top.
export function CategoryPicker({
  categories,
  value,
  onChange,
  disabled = false,
}: {
  categories: CategoryChoice[];
  value: number | undefined;
  onChange: (id: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const chosen = categories.find((c) => c.id === value);
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return categories
      .filter((c) => {
        const text = c.path.join(" ").toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .sort((a, b) => b.path.length - a.path.length)
      .slice(0, MAX_SHOWN);
  }, [categories, query]);
  return (
    <div className="flex flex-col gap-2">
      <p
        className="font-sans text-[0.8rem] text-foreground"
        data-testid="draft-category"
      >
        {chosen ? (
          chosen.path.join(" › ")
        ) : (
          <span className="text-fail">No category chosen yet.</span>
        )}
      </p>
      {disabled ? null : (
        <>
          <label htmlFor={id} className="sr-only">
            Search Etsy&apos;s categories
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-on-surface-dim" />
            <Input
              id={id}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Etsy's categories: coasters, wall décor…"
              className="pl-8"
              data-testid="draft-category-search"
            />
          </div>
          {matches.length > 0 ? (
            <ul className="flex flex-col overflow-hidden rounded-render border border-border-soft bg-card">
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    data-testid={`draft-category-${c.id}`}
                    type="button"
                    className="w-full px-3 py-2 text-left font-sans text-[0.8rem] text-foreground transition-colors hover:bg-surface-soft"
                    onClick={() => {
                      onChange(c.id);
                      setQuery("");
                    }}
                  >
                    <span className="text-on-surface-mid">
                      {c.path.slice(0, -1).join(" › ")}
                      {c.path.length > 1 ? " › " : ""}
                    </span>
                    <span className="font-semibold">{c.path.at(-1)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim() ? (
            <p className="font-sans text-[0.75rem] text-on-surface-mid">
              No category matches “{query.trim()}”.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
