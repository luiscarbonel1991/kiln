"use client";

import { Flame } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { ChatGenerate } from "@/components/studio/chat-generate";
import { RecentWorkspaces } from "@/components/studio/recent-workspaces";
import { UploadDropzone } from "@/components/studio/upload-dropzone";
import { cn } from "@/lib/utils";

type UploadMode = "upload" | "generate";

const MODES: { id: UploadMode; label: string }[] = [
  { id: "upload", label: "Upload a photo" },
  { id: "generate", label: "Generate from prompt" },
];

// The four-layer provenance cascade, rendered in its real colors — Kiln's whole
// premise in one line: the anchor's DNA flows brand -> image -> recipe -> local.
const CASCADE: { label: string; token: string }[] = [
  { label: "brand", token: "--prov-brand" },
  { label: "image", token: "--prov-image" },
  { label: "recipe", token: "--prov-recipe" },
  { label: "local", token: "--prov-local" },
];

// Natural, calming gradients for the fanned ghost frames — sage / eucalyptus /
// moss earth tones over the cream base. Each is distinct (no two alike) and leans
// green for a tranquil feel while staying in Kiln's warm studio palette.
const GHOST_GRAD = {
  clay: "radial-gradient(120% 120% at 28% 22%, #d6bf9f 0%, transparent 56%), radial-gradient(100% 100% at 68% 58%, #bd9b73 0%, transparent 52%), linear-gradient(140deg, #e6dcc7 0%, #efe6d6 96%)",
  sage: "radial-gradient(120% 120% at 30% 24%, #aebf9c 0%, transparent 55%), radial-gradient(100% 100% at 72% 60%, #889e78 0%, transparent 50%), linear-gradient(145deg, #d8d4bd 0%, #ece9d8 96%)",
  eucalyptus:
    "radial-gradient(120% 120% at 26% 30%, #9db6a9 0%, transparent 56%), radial-gradient(100% 100% at 70% 56%, #6f8c84 0%, transparent 50%), linear-gradient(140deg, #ccd6cd 0%, #eae8db 96%)",
  moss: "radial-gradient(120% 120% at 32% 28%, #a8ac7d 0%, transparent 55%), radial-gradient(100% 100% at 70% 62%, #86894f 0%, transparent 50%), linear-gradient(150deg, #dcd6bc 0%, #ece9d6 96%)",
} as const;

// Ghost output frames fanned behind the anchor — a preview of the listing set one
// master becomes. They drift with the cursor (depth) while the anchor stays put.
// One warm clay note + three green/natural tones keep them varied and calming.
const STAGE_FRAMES: {
  label: string;
  grad: string;
  pos: string;
  rot: number;
  depth: number;
  w: number;
  h: number;
  delay: number;
}[] = [
  {
    label: "hero",
    grad: GHOST_GRAD.clay,
    pos: "left-[1%] top-[5%]",
    rot: -8,
    depth: 22,
    w: 130,
    h: 130,
    delay: 440,
  }, // prettier-ignore
  {
    label: "in-use",
    grad: GHOST_GRAD.sage,
    pos: "right-[-3%] top-[14%]",
    rot: 7,
    depth: 14,
    w: 116,
    h: 146,
    delay: 560,
  }, // prettier-ignore
  {
    label: "lifestyle",
    grad: GHOST_GRAD.eucalyptus,
    pos: "left-[-4%] bottom-[7%]",
    rot: -6,
    depth: 18,
    w: 124,
    h: 152,
    delay: 640,
  }, // prettier-ignore
  {
    label: "gift",
    grad: GHOST_GRAD.moss,
    pos: "right-[5%] bottom-[-3%]",
    rot: 10,
    depth: 11,
    w: 110,
    h: 110,
    delay: 700,
  }, // prettier-ignore
];

export function UploadPhase({ onViewAll }: { onViewAll?: () => void }) {
  const [mode, setMode] = useState<UploadMode>("upload");
  const stageRef = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  }, []);

  // Cursor parallax: write normalized −1..1 offsets as CSS vars on the stage; the
  // ghost frames + glow consume them at different depths. The anchor never moves.
  const onMove = (e: React.MouseEvent) => {
    const el = stageRef.current;
    if (!el || reduced.current) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty(
      "--mx",
      String(((e.clientX - r.left) / r.width - 0.5) * 2),
    ); // prettier-ignore
    el.style.setProperty(
      "--my",
      String(((e.clientY - r.top) / r.height - 0.5) * 2),
    ); // prettier-ignore
  };
  const onLeave = () => {
    stageRef.current?.style.setProperty("--mx", "0");
    stageRef.current?.style.setProperty("--my", "0");
  };

  return (
    <>
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-12 px-6 py-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
        {/* Editorial masthead */}
        <div>
          <span className="animate-hero-rise inline-flex items-center gap-2 rounded-pill border border-primary/20 bg-primary/[0.06] px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-primary [animation-delay:40ms]">
            <Flame className="size-3" /> Image-first · fired to a set
          </span>

          <h1
            className="animate-hero-rise mt-6 font-serif font-semibold text-[clamp(2.875rem,6vw,4.875rem)] leading-[0.9] tracking-[-0.03em] text-foreground [animation-delay:120ms]"
            style={{ fontVariationSettings: "'opsz' 144" }}
          >
            Fire one image
            <br />
            into a full
            <br />
            on-brand <span className="text-primary italic">set.</span>
          </h1>

          <p className="animate-hero-rise mt-5 max-w-[464px] font-sans text-[0.9375rem] leading-relaxed text-on-surface-mid [animation-delay:220ms]">
            Upload or generate a single master. Kiln reads its DNA — subject,
            palette, light — and carries it, locked, through every variation.
            The anchor never drifts.
          </p>

          <div className="animate-hero-rise mt-8 flex flex-wrap items-center gap-x-2.5 gap-y-2 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-on-surface-dim [animation-delay:320ms]">
            {CASCADE.map((layer, i) => (
              <Fragment key={layer.label}>
                {i > 0 ? (
                  <span className="text-on-surface-dim/45">&rarr;</span>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: `var(${layer.token})` }}
                  />
                  {layer.label}
                </span>
              </Fragment>
            ))}
          </div>
        </div>

        {/* The kiln: anchor in an ember glow, output ghosts fanned behind */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-move only drives a decorative parallax; no interaction is gated behind it */}
        <div
          ref={stageRef}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          className="relative flex min-h-[460px] items-center justify-center"
        >
          {/* ember glow (breathing) — centered behind the anchor */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            <div className="animate-ember relative size-[440px]">
              <div
                className="absolute inset-0 rounded-pill"
                style={{
                  background:
                    "radial-gradient(circle, rgba(192,70,31,0.30) 0%, rgba(138,99,16,0.13) 42%, transparent 72%)",
                  filter: "blur(8px)",
                }}
              />
              <div
                className="absolute inset-0 m-auto size-[230px] rounded-pill"
                style={{
                  background:
                    "radial-gradient(circle, rgba(224,122,63,0.38) 0%, rgba(192,70,31,0.18) 48%, transparent 72%)",
                  filter: "blur(10px)",
                }}
              />
            </div>
          </div>

          {/* fanned output ghosts (hidden on the smallest screens) */}
          {STAGE_FRAMES.map((f, i) => (
            <div
              key={f.label}
              aria-hidden
              className={cn(
                "animate-hero-rise pointer-events-none absolute hidden sm:block",
                f.pos,
              )}
              style={{ animationDelay: `${f.delay}ms` }}
            >
              <div
                style={{
                  transform: `rotate(${f.rot}deg) translate3d(calc(var(--mx,0) * ${f.depth}px), calc(var(--my,0) * ${f.depth}px), 0)`,
                  transition: "transform 0.5s cubic-bezier(0.22,0.61,0.36,1)",
                }}
              >
                <div
                  className="animate-drift relative opacity-[0.72]"
                  style={{ animationDelay: `${i * -2200}ms` }}
                >
                  <div
                    className="rounded-render shadow-render ring-1 ring-border-soft/60"
                    style={{
                      width: f.w,
                      height: f.h,
                      backgroundImage: f.grad,
                    }}
                  />
                  <span className="absolute top-1.5 left-1.5 rounded-badge bg-card/95 px-[6px] py-0.5 font-mono text-[0.5625rem] text-on-surface-mid shadow-render">
                    {f.label}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {/* the anchor — the actual upload / generate entry */}
          <div className="animate-hero-rise relative z-10 w-full max-w-[416px] [animation-delay:360ms]">
            <div className="mx-auto mb-3.5 flex w-fit gap-1 rounded-pill bg-card p-1 shadow-card ring-1 ring-primary/10">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "rounded-pill px-4 py-1.5 font-sans text-[0.78rem] font-semibold transition-colors",
                    mode === m.id
                      ? "bg-primary text-primary-foreground"
                      : "text-on-surface-mid hover:text-foreground",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="rounded-card ring-1 ring-primary/10">
              {mode === "upload" ? <UploadDropzone /> : <ChatGenerate />}
            </div>

            <p className="mt-3 text-center font-mono text-[0.625rem] text-on-surface-dim">
              one anchor in &rarr; a full on-brand set out
            </p>
          </div>
        </div>
      </div>
      <RecentWorkspaces onViewAll={onViewAll} />
    </>
  );
}
