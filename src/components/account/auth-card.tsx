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

// The frame of the sign-in and first-run pages. On a wide screen the form
// shares the page with a scene drawn in code: a piece being made, framed and
// checked. On a phone, the form alone.
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
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <figure className="bench relative m-4 mr-0 hidden overflow-hidden rounded-card shadow-card lg:block">
        <BenchScene />
        <figcaption className="absolute inset-x-0 bottom-0 p-8 text-[#fffdf9]">
          <p
            className="max-w-sm font-serif text-3xl leading-tight"
            style={{ fontVariationSettings: "'opsz' 144" }}
          >
            Describe it once.{" "}
            <em className="italic">Kiln photographs and checks it.</em>
          </p>
          <p className="mt-3 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-[#fffdf9]/75">
            Drawn in code · nothing here is generated
          </p>
        </figcaption>
      </figure>
      <div className="flex flex-col items-center justify-center px-4 py-12">
        <Link
          href="/"
          className="font-serif text-3xl italic leading-none text-foreground"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          kiln<span className="text-primary">.</span>
        </Link>
        <Card className="mt-8 w-full max-w-sm gap-6 rounded-card py-7 shadow-card ring-border-soft">
          <CardHeader className="gap-2 px-7">
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
