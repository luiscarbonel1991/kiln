import Link from "next/link";
import type { ReactNode } from "react";

// The frame of the sign-in and first-run pages: the wordmark, a title, one
// line of what happens, and the form.
export function AuthCard({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link
        href="/"
        className="font-serif text-3xl italic leading-none text-foreground"
        style={{ fontVariationSettings: "'opsz' 144" }}
      >
        kiln<span className="text-primary">.</span>
      </Link>
      <section className="mt-8 w-full max-w-sm rounded-card border border-border-soft bg-card p-7 shadow-card">
        <h1
          className="font-serif text-2xl leading-tight text-foreground"
          style={{ fontVariationSettings: "'opsz' 96" }}
        >
          {title}
        </h1>
        <p className="mt-2 font-sans text-sm leading-relaxed text-on-surface-mid">
          {lead}
        </p>
        <div className="mt-6">{children}</div>
      </section>
    </main>
  );
}

export function AuthField({
  label,
  hint,
  ...input
}: {
  label: string;
  hint?: string;
} & React.ComponentProps<"input">) {
  return (
    <label className="block">
      <span className="font-sans text-[0.8125rem] font-semibold text-foreground">
        {label}
      </span>
      <input
        {...input}
        className="mt-1.5 h-10 w-full rounded-field border border-border bg-background px-3 font-sans text-[0.9375rem] text-foreground outline-none transition-colors placeholder:text-on-surface-mid/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
      />
      {hint ? (
        <span className="mt-1 block font-sans text-xs text-on-surface-mid">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-field border border-fail/30 bg-fail/10 px-3 py-2 font-sans text-[0.8125rem] leading-snug text-foreground"
    >
      {children}
    </p>
  );
}

export const authSubmitClass =
  "inline-flex h-10 w-full items-center justify-center rounded-field bg-primary px-4 font-sans text-[0.9375rem] font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:opacity-60";
