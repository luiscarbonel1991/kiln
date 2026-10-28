import Link from "next/link";

const LABEL =
  "font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";

// A choice of one among a few, as links (the address keeps it): a soft
// track with the current option raised on it.
export function Segmented({
  label,
  options,
  testId,
}: {
  label: string;
  options: { href: string; label: string; current: boolean; id: string }[];
  testId: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`${LABEL} min-w-[3.6rem]`}>{label}</span>
      <nav
        aria-label={label}
        className="inline-flex items-center gap-0.5 rounded-field bg-surface-soft p-0.5 shadow-[inset_0_0_0_1px_var(--color-border-soft)]"
        data-testid={testId}
      >
        {options.map((o) => (
          <Link
            key={o.id}
            href={o.href}
            scroll={false}
            aria-current={o.current ? "true" : undefined}
            data-testid={`${testId}-${o.id}`}
            className={`inline-flex h-7 items-center rounded-[10px] px-2.5 font-sans text-[0.78rem] font-semibold transition-colors ${
              o.current
                ? "bg-card text-foreground shadow-[0_1px_2px_rgba(60,40,25,0.08),0_4px_10px_-4px_rgba(70,46,28,0.18)]"
                : "text-on-surface-mid hover:text-foreground"
            }`}
          >
            {o.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
