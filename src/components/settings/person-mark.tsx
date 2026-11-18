import { cn } from "@/lib/utils";

// A person's mark: their initials on one of the provenance colours, the same
// colour every time for the same name.
const MARKS = [
  "bg-prov-local/15 text-prov-local",
  "bg-prov-image/15 text-prov-image",
  "bg-prov-recipe/15 text-prov-recipe",
  "bg-prov-brand/15 text-prov-brand",
];

export function PersonMark({ name, faded }: { name: string; faded?: boolean }) {
  // An invitation has only an email: its first letter.
  const words = name.includes("@")
    ? [name]
    : name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  const tone =
    MARKS[
      [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % MARKS.length
    ];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full font-serif text-[0.95rem]",
        faded
          ? "border border-dashed border-border bg-transparent text-on-surface-mid"
          : tone,
      )}
      style={{ fontVariationSettings: "'opsz' 40" }}
    >
      {initials}
    </span>
  );
}
