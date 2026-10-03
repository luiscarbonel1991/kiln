import { describe, expect, it } from "vitest";
import { Product } from "@/domain/product";
import { productToRow, rowToProduct } from "@/server/product-mapper";

// A generic, fictional product (an engraved cutting board) — no maker's catalog.
const board = Product.parse({
  id: "pkg:CB-01",
  sku: "CB-01",
  name: "Engraved family cutting board",
  family: "Kitchen",
  dimensions: { w: 16, h: 10, d: 0.75, unit: "in" },
  shape: "rounded rectangle board",
  material: "solid hardwood",
  treatment: "engraved",
  colours: [
    { key: "maple", name: "Maple", face: "#E8D2A6" },
    { key: "walnut", name: "Walnut", face: "#5B3A29" },
  ],
  defaultColour: "maple",
  typography: { family: "Fraunces", weight: 600, case: "title" },
  wording: [
    { label: "Family name", maxChars: 14, example: "The Riveras" },
    { label: "Year", maxChars: 4, required: false, example: "2026" },
  ],
  source: { kind: "catalog", adapterId: "pkg", ref: "CB-01" },
});

describe("product mapper", () => {
  it("splits the spec from sku, name and source; the package id is not stored", () => {
    const row = productToRow(board);
    expect(row.sku).toBe("CB-01");
    expect(row.name).toBe("Engraved family cutting board");
    expect(row.source).toEqual(board.source);
    expect(row.spec).not.toHaveProperty("id");
    expect(row.spec).not.toHaveProperty("source");
    expect(row.spec).not.toHaveProperty("sku");
  });

  it("round-trips with the row id as the product id", () => {
    const back = rowToProduct({ id: "cuid-1", ...productToRow(board) });
    expect(back).toEqual({ ...board, id: "cuid-1" });
  });

  it("returns null for a row that no longer parses", () => {
    const row = { id: "cuid-2", ...productToRow(board), spec: { family: 1 } };
    expect(rowToProduct(row)).toBeNull();
  });

  it("accepts a product typed in by the maker (source: form)", () => {
    const typed = { ...board, source: { kind: "form" as const } };
    expect(
      rowToProduct({ id: "cuid-3", ...productToRow(typed) })?.source,
    ).toEqual({ kind: "form" });
  });
});
