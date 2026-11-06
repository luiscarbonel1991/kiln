// How Kiln is priced, before there are plans: per outcome, never per
// generation, with every paid call priced before it runs.

const LEDGER: { item: string; cost: string; paid?: boolean }[] = [
  { item: "The spec, exact frames, every size", cost: "free" },
  { item: "SVG tracing", cost: "free" },
  { item: "Listing text drafts", cost: "free" },
  {
    item: "Line art, scenes and video",
    cost: "image models · priced first",
    paid: true,
  },
  { item: "A monthly cap on what models spend", cost: "you set it" },
  { item: "Plans", cost: "to be announced" },
];

export function SitePricing() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="grid scroll-mt-24 grid-cols-1 gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] lg:gap-16"
    >
      <div className="flex flex-col gap-3">
        <p className="font-mono text-[0.68rem] text-primary">Pricing</p>
        <h2
          id="pricing-title"
          className="font-serif text-[2.1rem] font-semibold leading-[1.08] text-foreground sm:text-[2.6rem]"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          Priced per listing kit, never per generation.
        </h2>
        <p className="max-w-[440px] font-sans text-[0.9375rem] leading-relaxed text-on-surface-mid">
          What Kiln draws from your spec costs nothing. Only image models cost
          money, and each call shows its price before it runs.
        </p>
      </div>
      <ul className="flex flex-col self-end">
        {LEDGER.map((row) => (
          <li
            key={row.item}
            className="flex items-baseline gap-3 border-b border-border-soft py-3.5 first:border-t"
          >
            <span className="font-sans text-[0.9375rem] text-foreground">
              {row.item}
            </span>
            <span
              className="min-w-6 flex-1 -translate-y-1 border-b border-dotted border-on-surface-dim/50"
              aria-hidden
            />
            <span
              className={`shrink-0 text-right font-mono text-[0.72rem] ${
                row.paid ? "text-prov-brand" : "text-on-surface-mid"
              }`}
            >
              {row.cost}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
