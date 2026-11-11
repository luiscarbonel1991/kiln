"use client";

import { useState } from "react";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import { BoardFace } from "@/components/site/board-face";
import { Take } from "@/components/site/take";
import type { ExactView } from "@/domain/exact";
import type { StoryFrame, StoryProduct, StoryScene } from "@/lib/home-story";

// Direction C's bench: the sample's spec as a drawing whose labels are
// fields. Editing one redraws the board and the exact frames in the browser,
// which is the claim itself: what comes from the spec is free and immediate.
// The photos stay as they were made, and say so.

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

export function SpecBench({
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
  const shownName = name.trim() || sample.name;
  const wording = [shownName, year.trim()].filter(Boolean);
  const changed =
    shownName !== sample.name ||
    year.trim() !== sample.year ||
    colour !== sample.colour;

  return (
    <div className="lc-bench">
      <form className="lc-spec" onSubmit={(e) => e.preventDefault()}>
        <div className="lc-drawing">
          <BoardFace
            face={look?.face ?? "#E8D2A6"}
            ink={look?.inlay ?? "#3B2A1E"}
            name={shownName}
            year={year.trim() || undefined}
            className="lc-board"
            label={`The board in ${look?.name ?? "its colour"}, engraved ${wording.join(", ")}`}
          />
          <span className="lc-dim lc-dim-w" aria-hidden>
            <i>{product.size.split(" x ")[0]} in</i>
          </span>
          <span className="lc-dim lc-dim-h" aria-hidden>
            <i>{product.size.split(" x ")[1]}</i>
          </span>
        </div>

        <div className="lc-fields">
          <label className="lc-field">
            <span>{product.wording[0]?.label ?? "Name"}</span>
            <input
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="lc-field lc-field-short">
            <span>{product.wording[1]?.label ?? "Year"}</span>
            <input
              value={year}
              maxLength={YEAR_MAX}
              onChange={(e) => setYear(e.target.value)}
              autoComplete="off"
              inputMode="numeric"
            />
          </label>
          <fieldset className="lc-field lc-field-wide">
            <legend>Colour</legend>
            <div className="lc-colours">
              {colours.map((c) => (
                <label key={c.key}>
                  <input
                    type="radio"
                    name="lc-colour"
                    className="sr-only"
                    checked={c.key === colour}
                    onChange={() => setColour(c.key)}
                  />
                  <span
                    className="lc-swatch"
                    style={{ backgroundColor: c.face }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
          <dl className="lc-facts lc-field-wide">
            <div>
              <dt>Material</dt>
              <dd>{product.material}</dd>
            </div>
            <div>
              <dt>Finish</dt>
              <dd>{product.finish}</dd>
            </div>
            {product.price ? (
              <div>
                <dt>Price</dt>
                <dd>${product.price}</dd>
              </div>
            ) : null}
          </dl>
        </div>
        <p className="lc-try">Try it: change the name or the colour.</p>
      </form>

      <div className="lc-out">
        <div className="lc-row" data-stale={changed}>
          <p className="lc-row-head" data-tone="paid" aria-live="polite">
            {changed ? (
              <>
                <b>These photos still show the first spec.</b> New ones need an
                image model: priced before it runs, checked after.
              </>
            ) : (
              <>
                <b>Photographed around the real product.</b> An image model,
                priced first, each take checked.
              </>
            )}
          </p>
          <ul>
            {scenes.map((s) => (
              <li key={s.url}>
                <div className="lc-tile">
                  <Take scene={s} eager className="lc-fill" />
                </div>
                <span>{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="lc-row">
          <p className="lc-row-head" data-tone="free">
            <b>Redrawn as you type.</b> From the spec, free.
          </p>
          <ul>
            {exact.map((f) => (
              <li key={f.label}>
                <div className="lc-tile">
                  <ExactSlotArt
                    view={redraw(f.view, look?.face ?? "#E8D2A6", wording)}
                    aspect={f.aspect}
                  />
                </div>
                <span>{f.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
