import { describe, expect, it } from "vitest";
import {
  LABEL_SIZE,
  labelWidth,
  sizeSpecLayout,
} from "@/components/projects/size-spec-layout";
import { textWidth } from "@/components/projects/text-fit";

const WIDTH = 400;
const HEIGHTS = { "1:1": 400, "4:5": 500, "9:16": 711 };

const facts = [
  { label: "Shape", value: "rounded rectangle keychain tag", droppable: true },
  {
    label: "Material",
    value: "3 mm birch plywood with a natural, visible wood grain finish",
    droppable: true,
  },
  { label: "Finish", value: "Engraved" },
];

const parts = [
  { label: "Shape", value: "name plate", droppable: true },
  { label: "Material", value: "hardwood", droppable: true },
  {
    label: "plate with a rather long name",
    value: "203.2 x 63.5 mm, 3.6 mm thick",
  },
  {
    label: "base",
    value: "228.6 x 57.15 mm footprint, 7.2 mm thick, black matte",
  },
  { label: "stand", value: "60 x 20 mm footprint, 3 mm thick, walnut" },
  { label: "cap", value: "20 x 20 mm footprint, 3 mm thick, brass tone" },
  { label: "Finish", value: "Engraved" },
];

function inside(layout: ReturnType<typeof sizeSpecLayout>, height: number) {
  for (const row of layout.rows) {
    row.label.forEach((line, i) => {
      expect(layout.labelX + labelWidth(line)).toBeLessThanOrEqual(
        layout.valueX - 4,
      );
      expect(row.y + i * layout.lineHeight).toBeLessThanOrEqual(height - 16);
    });
    row.value.forEach((line, i) => {
      expect(
        layout.valueX + textWidth(line, layout.fontSize),
      ).toBeLessThanOrEqual(WIDTH - 16);
      expect(row.y + i * layout.lineHeight).toBeLessThanOrEqual(height - 16);
    });
  }
  layout.rows.slice(1).forEach((row, i) => {
    const prev = layout.rows[i];
    const lines = Math.max(prev.label.length, prev.value.length);
    expect(row.y).toBeGreaterThan(prev.y + (lines - 1) * layout.lineHeight);
  });
}

describe("sizeSpecLayout", () => {
  for (const [aspect, height] of Object.entries(HEIGHTS)) {
    it(`keeps every fact inside a ${aspect} frame`, () => {
      for (const set of [facts, parts]) {
        const layout = sizeSpecLayout({
          width: WIDTH,
          height,
          product: { width: 2.5, height: 1.25 },
          heightLabel: "31.75 mm",
          facts: set,
          depth: false,
        });
        inside(layout, height);
        expect(layout.rows.map((r) => r.label.join(" "))).toContain("FINISH");
      }
    });
  }

  it("wraps a long material onto two lines rather than cutting it", () => {
    const layout = sizeSpecLayout({
      width: WIDTH,
      height: 400,
      product: { width: 2.5, height: 1.25 },
      heightLabel: "1.25 in",
      facts: [
        { label: "Material", value: "3 mm birch plywood, natural wood grain" },
      ],
      depth: true,
    });
    expect(layout.rows[0].value.join(" ")).toBe(
      "3 mm birch plywood, natural wood grain",
    );
  });

  it("leaves out a visual brief too long to print, never a part or the finish", () => {
    const brief =
      "a rectangular name plate with rounded corners standing upright in a pill-shaped base of the same wood that shows in front of and behind the plate";
    const layout = sizeSpecLayout({
      width: WIDTH,
      height: 400,
      product: { width: 9, height: 2.78 },
      heightLabel: "2.78 in",
      facts: [
        { label: "Shape", value: brief, droppable: true },
        { label: "plate", value: "8 x 2.5 in, 0.14 in thick" },
        { label: "Finish", value: "Engraved" },
      ],
      depth: false,
    });
    expect(layout.rows.map((r) => r.label[0])).toEqual(["PLATE", "FINISH"]);
  });

  it("keeps the drawing and its height measure inside the frame", () => {
    const layout = sizeSpecLayout({
      width: WIDTH,
      height: 400,
      product: { width: 9, height: 2.78 },
      heightLabel: "70.61 mm",
      facts,
      depth: false,
    });
    const { x, w } = layout.box;
    expect(x).toBeGreaterThanOrEqual(16);
    expect(x + w + 26 + "70.61 mm".length * 12 * 0.62).toBeLessThanOrEqual(
      WIDTH - 16,
    );
    expect(LABEL_SIZE).toBe(10);
  });
});
