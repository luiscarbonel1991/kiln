// "How it works" — the flow from one master to a full set, in three moves, with
// the breadth of outputs shown explicitly in the last step. Kept global on purpose
// (line-art design SVGs are one output among several). Static, no entrance anim.

const STEPS: {
  n: string;
  title: string;
  body: string;
  outputs?: string[];
}[] = [
  {
    n: "01",
    title: "Anchor",
    body: "Upload a photo or generate one from a prompt. Your master image is the single source of truth for everything that follows.",
  },
  {
    n: "02",
    title: "Lock its DNA",
    body: "Kiln reads the subject, materials, palette, and light — and locks them by default, so nothing drifts across variations.",
  },
  {
    n: "03",
    title: "Fire the set",
    body: "Pick a recipe and get a complete, on-brand set in one pass — then refine, vectorize, or animate any card.",
    outputs: [
      "Listing heroes",
      "Lifestyle scenes",
      "Paid-ad creatives",
      "Social posts",
      "Line-art SVG designs",
    ],
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-[1120px] px-6 pb-16 sm:px-8">
      <div className="mb-9 border-border-soft border-t pt-10">
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-on-surface-dim">
          How it works
        </p>
        <h2 className="mt-2 font-serif text-2xl text-foreground italic">
          One image in, a full set out — in three moves.
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-9 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.n}>
            <div className="font-mono text-[0.8125rem] text-primary tracking-[0.1em]">
              {step.n}
            </div>
            <h3 className="mt-2.5 font-serif text-[1.125rem] text-foreground">
              {step.title}
            </h3>
            <p className="mt-1.5 max-w-[320px] font-sans text-[0.84375rem] leading-relaxed text-on-surface-mid">
              {step.body}
            </p>
            {step.outputs ? (
              <ul className="mt-3.5 flex flex-wrap gap-1.5">
                {step.outputs.map((out) => (
                  <li
                    key={out}
                    className="rounded-pill border border-border bg-secondary px-2.5 py-1 font-mono text-[0.625rem] text-on-surface-mid"
                  >
                    {out}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
