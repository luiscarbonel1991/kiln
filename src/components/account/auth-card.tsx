import Link from "next/link";
import type { ReactNode } from "react";
import { BenchScene } from "@/components/account/bench-scene";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// The frame of the account pages. Beside the form (above it on a phone) a
// scene drawn in code: a piece sketched, made, then framed and checked. One
// figure for every screen size, so the drawing's filters exist once.
export function AuthCard({
  eyebrow,
  title,
  lead,
  children,
}: {
  // A line above the title: who invited them, what this page is.
  eyebrow?: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:grid-rows-1">
      <figure className="bench relative m-4 mb-0 h-44 overflow-hidden rounded-card shadow-card lg:mr-0 lg:mb-4 lg:h-auto">
        <BenchScene />
        <figcaption className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-[#efe7d8] via-[#efe7d8]/85 to-transparent p-8 pt-16 text-foreground lg:block">
          <p
            className="max-w-sm font-serif text-3xl leading-tight"
            style={{ fontVariationSettings: "'opsz' 144" }}
          >
            From a sketch <em className="italic">to the listing photo.</em>
          </p>
          <p className="mt-3 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-on-surface-mid">
            Drawn in code · nothing here is generated
          </p>
        </figcaption>
      </figure>
      <div className="flex flex-col items-center justify-start px-4 pt-8 pb-12 lg:justify-center lg:py-12">
        <Link
          href="/"
          className="font-serif text-3xl italic leading-none text-foreground"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          kiln<span className="text-primary">.</span>
        </Link>
        <Card className="mt-8 w-full max-w-sm gap-6 rounded-card py-7 shadow-card ring-border-soft">
          <CardHeader className="gap-2 px-7">
            {eyebrow ? (
              <p
                className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-primary"
                data-testid="auth-eyebrow"
              >
                {eyebrow}
              </p>
            ) : null}
            <CardTitle
              className="font-serif text-2xl leading-tight"
              style={{ fontVariationSettings: "'opsz' 96" }}
            >
              <h1>{title}</h1>
            </CardTitle>
            <CardDescription className="leading-relaxed">
              {lead}
            </CardDescription>
          </CardHeader>
          {children ? (
            <CardContent className="px-7">{children}</CardContent>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
