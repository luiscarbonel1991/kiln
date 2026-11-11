"use client";

import { type CSSProperties, useState } from "react";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { BoardFace } from "@/components/site/board-face";
import { Print } from "@/components/site/print";
import { TakePrint } from "@/components/site/take-print";
import type { ExactView } from "@/domain/exact";
import type { StoryFrame, StoryProduct, StoryScene } from "@/lib/home-story";

// The bench's live part: the sample board lying on the mat with its spec on a
// ticket beside it. Editing the ticket redraws the board and the exact frames
// in the browser, which is the claim itself: what comes from the spec is free
// and immediate. The photos stay as they were made, and say so.

export interface BenchColour {
  key: string;
  name: string;
  face: string;
  inlay: string;
}

// The sample's own limits for its two lines of wording.
const NAME_MAX = 14;
const YEAR_MAX = 4;

function redraw(view: ExactView, face: string, wording: string[]): ExactView {
  return view.kind === "size-spec" || view.kind === "scale"
    ? { ...view, product: { ...view.product, face, wording } }
    : view;
}

export function BenchStage({
  product,
  colours,
  exact,
  scenes,
}: {
  product: StoryProduct;
  colours: BenchColour[];
  exact: StoryFrame[];
  scenes: StoryScene[];
}) {
  const sample = {
    name: product.wording[0]?.example ?? "",
    year: product.wording[1]?.example ?? "",
    colour: colours[0]?.key ?? "",
  };
  const [name, setName] = useState(sample.name);
  const [year, setYear] = useState(sample.year);
  const [colour, setColour] = useState(sample.colour);
  const look = colours.find((c) => c.key === colour) ?? colours[0];
  const face = look?.face ?? "#E8D2A6";
  const shownName = name.trim() || sample.name;
  const wording = [shownName, year.trim()].filter(Boolean);
  const changed =
    shownName !== sample.name ||
    year.trim() !== sample.year ||
    colour !== sample.colour;
  const [w, h] = product.size.replace(/ in$/, "").split(" x ");

  return (
    <div className="bn-stage">
      <div className="bn-object">
        <div className="bn-drawing" style={{ "--face": face } as CSSProperties}>
          <BoardFace
            face={face}
            ink={look?.inlay ?? "#3B2A1E"}
            name={shownName}
            year={year.trim() || undefined}
            className="bn-board"
            label={`The board in ${look?.name ?? "its colour"}, engraved ${wording.join(", ")}`}
          />
          <span className="bn-dim bn-dim-w" aria-hidden>
            <i>{w} in</i>
          </span>
          <span className="bn-dim bn-dim-h" aria-hidden>
            <i>{h} in</i>
          </span>
        </div>

        <form className="bn-ticket" onSubmit={(e) => e.preventDefault()}>
          <p className="bn-ticket-head">
            The spec. <span>Change it: the drawings follow.</span>
          </p>
          <label className="bn-field">
            <span>{product.wording[0]?.label ?? "Name"}</span>
            <input
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="bn-field bn-field-short">
            <span>{product.wording[1]?.label ?? "Year"}</span>
            <input
              value={year}
              maxLength={YEAR_MAX}
              onChange={(e) => setYear(e.target.value)}
              autoComplete="off"
              inputMode="numeric"
            />
          </label>
          <fieldset className="bn-field bn-field-wide">
            <legend>Colour</legend>
            <div className="bn-colours">
              {colours.map((c) => (
                <label key={c.key}>
                  <input
                    type="radio"
                    name="bn-colour"
                    className="sr-only"
                    checked={c.key === colour}
                    onChange={() => setColour(c.key)}
                  />
                  <span
                    className="bn-swatch"
                    style={{ backgroundColor: c.face }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="bn-facts bn-field-wide">
            {product.size} · {product.material} · {product.finish.toLowerCase()}
            {product.price ? ` · $${product.price}` : ""}
          </p>
        </form>
      </div>

      <div className="bn-made">
        <div className="bn-group" data-stale={changed}>
          <p className="bn-note" data-tone="paid" aria-live="polite">
            {changed ? (
              <>
                <b>These photos still show the first spec.</b> New ones need an
                image model: priced before it runs, checked after.
              </>
            ) : (
              <>
                <b>Photographed around the real product.</b> An image model,
                priced first, every take checked.
              </>
            )}
          </p>
          <ul className="bn-photos">
            {scenes.map((s, n) => (
              <li key={s.url}>
                <TakePrint
                  scene={s}
                  tilt={[1.6, -1.2, 0.8][n] ?? 0}
                  eager
                  at={900 + n * 300}
                />
              </li>
            ))}
          </ul>
        </div>
        <div className="bn-group">
          <p className="bn-note" data-tone="free">
            <b>Drawn from the spec.</b> Free, and redrawn as you type.
          </p>
          <ul className="bn-frames">
            {exact.map((f, n) => (
              <li key={f.label}>
                <Print tilt={[-1.5, 1, -0.6][n] ?? 0} title={f.label}>
                  <ExactSlotArt
                    view={redraw(f.view, face, wording)}
                    aspect={f.aspect}
                  />
                </Print>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
