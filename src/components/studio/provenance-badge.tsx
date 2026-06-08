import type { FieldSource } from "@/domain/field";
import { cn } from "@/lib/utils";

// Single source of truth for provenance colors, keyed by Field.source.
// brand=amber, image=slate, recipe=pine, local=terracotta. Exported so other
// pieces (e.g. the card lock icon) can reuse the same text color.
export const PROV_TOKENS: Record<FieldSource, { text: string; bg: string }> = {
  brand: { text: "text-prov-brand", bg: "bg-prov-brand/10" },
  image: { text: "text-prov-image", bg: "bg-prov-image/10" },
  recipe: { text: "text-prov-recipe", bg: "bg-prov-recipe/10" },
  local: { text: "text-prov-local", bg: "bg-prov-local/10" },
};

// Reusable provenance badge — used by Analysis, Planning, and the generation cards.
export function ProvenanceBadge({
  source,
  className,
}: {
  source: FieldSource;
  className?: string;
}) {
  const prov = PROV_TOKENS[source];
  return (
    <span
      className={cn(
        "rounded-badge px-[7px] py-0.5 font-mono text-[0.59375rem]",
        prov.text,
        prov.bg,
        className,
      )}
    >
      {source}
    </span>
  );
}
