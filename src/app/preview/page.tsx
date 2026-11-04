import type { ReactNode } from "react";
import { SlotFrame, SlotGrid } from "@/components/projects/slot-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SlotView } from "@/domain/plan";
import { gradientForPrompt } from "@/lib/gradient";

// Every state a board slot can show, plus a failed generation.
const SLOT_STATES: { label: string; view: SlotView }[] = [
  { label: "exact", view: { state: "exact", failed: false } },
  { label: "waiting", view: { state: "queued", failed: false } },
  {
    label: "queued (batch)",
    view: { state: "queued", failed: false, inBatch: true },
  },
  { label: "generating", view: { state: "generating", failed: false } },
  { label: "retrying", view: { state: "retrying", failed: false } },
  { label: "to review", view: { state: "to-review", failed: false } },
  { label: "approved", view: { state: "approved", failed: false } },
  { label: "delivered", view: { state: "delivered", failed: false } },
  { label: "failed", view: { state: "queued", failed: true } },
];

const swatches = [
  { name: "canvas", hex: "#f6f1e8", className: "bg-background" },
  { name: "surface", hex: "#fffdf9", className: "bg-card" },
  { name: "surface-soft", hex: "#faf5ec", className: "bg-secondary" },
  { name: "primary", hex: "#c0461f", className: "bg-primary" },
  { name: "line", hex: "#ebe2d2", className: "bg-border" },
  { name: "on-surface", hex: "#241f18", className: "bg-foreground" },
  { name: "on-surface-mid", hex: "#6f6657", className: "bg-on-surface-mid" },
  { name: "on-surface-dim", hex: "#a89e8c", className: "bg-on-surface-dim" },
];

const provenance = [
  {
    layer: "brand",
    hex: "#8a6310",
    text: "text-prov-brand",
    bg: "bg-prov-brand/10",
  },
  {
    layer: "image",
    hex: "#3f5f84",
    text: "text-prov-image",
    bg: "bg-prov-image/10",
  },
  {
    layer: "recipe",
    hex: "#2c6a51",
    text: "text-prov-recipe",
    bg: "bg-prov-recipe/10",
  },
  {
    layer: "local",
    hex: "#c0461f",
    text: "text-prov-local",
    bg: "bg-prov-local/10",
  },
];

const radii = [
  { name: "field", value: "13px", className: "rounded-field" },
  { name: "render", value: "17px", className: "rounded-render" },
  { name: "card", value: "24px", className: "rounded-card" },
  { name: "pill", value: "full", className: "rounded-pill" },
];

const shadows = [
  { name: "shadow-card", className: "shadow-card" },
  { name: "shadow-render", className: "shadow-render" },
  { name: "shadow-button", className: "shadow-button" },
];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-sans text-[0.656rem] font-bold uppercase tracking-[0.18em] text-prov-brand">
      {children}
    </p>
  );
}

function Section({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <Eyebrow>{eyebrow}</Eyebrow>
      {children}
    </section>
  );
}

export default function Preview() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 py-20 sm:px-10">
      <header className="flex flex-col gap-4 border-b border-border pb-10">
        <Eyebrow>Kiln · theme preview</Eyebrow>
        <h1
          className="font-serif text-6xl italic leading-[0.95] text-foreground"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          Elevate your
          <br />
          product narrative
        </h1>
        <p className="max-w-xl font-sans text-sm leading-relaxed text-on-surface-mid">
          A visual smoke test for the DESIGN.md system — cream canvas, paper
          grain, warm shadows, the four-layer provenance cascade, and shadcn
          primitives themed with our tokens (never zinc).
        </p>
      </header>

      <Section eyebrow="Typography">
        <div className="flex flex-col gap-7 rounded-card bg-card p-8 shadow-card">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[0.594rem] uppercase tracking-wider text-on-surface-dim">
              Fraunces · display · italic · opsz 144
            </span>
            <p
              className="font-serif text-4xl italic leading-tight text-foreground"
              style={{ fontVariationSettings: "'opsz' 144" }}
            >
              Reading the image
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[0.594rem] uppercase tracking-wider text-on-surface-dim">
              Fraunces · headline
            </span>
            <p className="font-serif text-2xl font-semibold leading-tight text-foreground">
              Plan the production
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[0.594rem] uppercase tracking-wider text-on-surface-dim">
              Hanken Grotesk · body
            </span>
            <p className="max-w-2xl font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid">
              Studio reads a master asset, carries its context through analysis
              and planning, and produces on-brand image and video variants. The
              anchor is always the master asset.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[0.594rem] uppercase tracking-wider text-on-surface-dim">
              JetBrains Mono · model param
            </span>
            <p className="font-mono text-[0.719rem] text-on-surface-mid">
              model=gemini-2.5-flash-image · seed=4821 · guidance=7.5
            </p>
          </div>
        </div>
      </Section>

      <Section eyebrow="Surfaces & text">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {swatches.map((s) => (
            <div key={s.name} className="flex flex-col gap-2">
              <div
                className={`h-20 rounded-render border border-border ${s.className}`}
              />
              <div className="flex flex-col">
                <span className="font-sans text-[0.75rem] font-semibold text-foreground">
                  {s.name}
                </span>
                <span className="font-mono text-[0.65rem] text-on-surface-dim">
                  {s.hex}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Provenance cascade">
        <div className="flex flex-wrap items-center gap-3">
          {provenance.map((p, i) => (
            <div key={p.layer} className="flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-pill px-3 py-1.5 font-mono text-[0.7rem] ${p.bg} ${p.text}`}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: p.hex }}
                />
                {p.layer}
              </span>
              {i < provenance.length - 1 ? (
                <span className="text-on-surface-dim">→</span>
              ) : null}
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Radii">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {radii.map((r) => (
            <div key={r.name} className="flex flex-col items-center gap-2">
              <div
                className={`flex h-20 w-full items-center justify-center border border-border bg-card ${r.className}`}
              >
                <span className="font-mono text-[0.7rem] text-on-surface-mid">
                  {r.value}
                </span>
              </div>
              <span className="font-sans text-[0.72rem] text-on-surface-mid">
                rounded-{r.name}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Elevation">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {shadows.map((s) => (
            <div
              key={s.name}
              className={`flex h-24 items-center justify-center rounded-card bg-card ${s.className}`}
            >
              <span className="font-mono text-[0.7rem] text-on-surface-mid">
                {s.name}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Themed shadcn primitives">
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-center gap-3">
            <Button data-testid="preview-button-default">
              Generate variants
            </Button>
            <Button variant="secondary" data-testid="preview-button-secondary">
              Secondary
            </Button>
            <Button variant="outline" data-testid="preview-button-outline">
              Outline
            </Button>
            <Button variant="ghost" data-testid="preview-button-ghost">
              Ghost
            </Button>
            <Button
              variant="destructive"
              data-testid="preview-button-destructive"
            >
              Destructive
            </Button>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle>Etsy hero</CardTitle>
                <CardDescription>Recipe · 3 variants queued</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge>brand</Badge>
                  <Badge variant="secondary">image</Badge>
                  <Badge variant="outline">recipe</Badge>
                </div>
                <Input placeholder="Describe the scene" />
              </CardContent>
            </Card>
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle>Provenance badges</CardTitle>
                <CardDescription>Custom prov-* token chips</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {provenance.map((p) => (
                  <span
                    key={p.layer}
                    className={`rounded-badge px-2 py-1 font-mono text-[0.65rem] ${p.bg} ${p.text}`}
                  >
                    {p.layer}
                  </span>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </Section>

      <Section eyebrow="Slot states · project board">
        <SlotGrid>
          {SLOT_STATES.map(({ label, view }) => (
            <SlotFrame
              key={label}
              position={label}
              label="Marketplace hero"
              purpose="Win the click: clean background, no props."
              aspect="1:1"
              view={view}
            >
              <div
                className="h-full w-full"
                style={{ backgroundImage: gradientForPrompt(label) }}
              />
            </SlotFrame>
          ))}
        </SlotGrid>
      </Section>
    </main>
  );
}
