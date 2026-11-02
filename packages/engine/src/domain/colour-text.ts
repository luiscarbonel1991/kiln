import { colourWordsIn } from "@/domain/colour-words";
import type { ColourOption, Product } from "@/domain/product";

// Where a product's text, written for its default colour, contradicts
// another of its colours (the paid check of 2026-11-01: DP-E shown in gold
// still said "engraved black & white" and "no gold or metallic finish").
// Plain matching on everyday colour words: the name and the material naming
// a colour word of the default's that this colour does not have, and the
// things never shown naming one of this colour's own. The colour's own text,
// where it has it, replaces the product's and is not checked.
export interface ColourTextConflict {
  // The colour words the product's text says that this colour is not.
  says: string[];
  // Which of the product's texts say them.
  fields: ("name" | "material")[];
  // The things never shown that name this colour ("gold or metallic finish").
  forbids: string[];
}

export type ProductText = Pick<
  Product,
  "name" | "material" | "forbidden" | "colours" | "defaultColour"
>;

const wordsOf = (c: ColourOption) =>
  colourWordsIn(`${c.name} ${c.inlayName ?? ""}`);

// null when nothing contradicts, and always for the default colour, which the
// product's text was written for.
export function colourTextConflict(
  product: ProductText,
  key: string,
): ColourTextConflict | null {
  if (key === product.defaultColour) return null;
  const colour = product.colours.find((c) => c.key === key);
  const base = product.colours.find((c) => c.key === product.defaultColour);
  if (!colour || !base) return null;
  const mine = wordsOf(colour);
  const theirs = wordsOf(base);
  const foreign = new Set([...theirs].filter((w) => !mine.has(w)));
  const own = new Set([...mine].filter((w) => !theirs.has(w)));
  const says = new Set<string>();
  const fields: ColourTextConflict["fields"] = [];
  const check = (field: "name" | "material", text: string) => {
    const named = [...colourWordsIn(text)].filter((w) => foreign.has(w));
    if (named.length === 0) return;
    fields.push(field);
    for (const w of named) says.add(w);
  };
  if (!colour.productName) check("name", product.name);
  if (!colour.material) check("material", product.material);
  const forbids = colour.forbidden
    ? []
    : product.forbidden.filter((item) =>
        [...colourWordsIn(item)].some((w) => own.has(w)),
      );
  if (says.size === 0 && forbids.length === 0) return null;
  return { says: [...says], fields, forbids };
}

const andList = (items: string[]) =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

// "its name and material say white".
const saying = (c: ColourTextConflict) =>
  `its ${andList(c.fields)} ${c.fields.length > 1 ? "say" : "says"} ${andList(c.says)}`;

// The conflict in words, for the look pickers, the board and the product
// editor; null when there is none.
export function colourTextWarning(
  product: ProductText,
  key: string,
): string | null {
  const conflict = colourTextConflict(product, key);
  if (!conflict) return null;
  const name = (k: string) =>
    product.colours.find((c) => c.key === k)?.name ?? k;
  const parts = [
    ...(conflict.fields.length > 0 ? [saying(conflict)] : []),
    ...(conflict.forbids.length > 0
      ? [`it must never show ${andList(conflict.forbids.map((f) => `"${f}"`))}`]
      : []),
  ];
  return `The product's text was written for ${name(product.defaultColour)}: ${parts.join(", and ")}. Give ${name(key)} its own text in the product, or its scenes will say both.`;
}

// For a package: each colour in conflict, with the package fields that fix
// it ("give the colour Gold/Black its own productName, material, forbidden").
export function colourTextNotes(product: ProductText): string[] {
  return product.colours.flatMap((c) => {
    const conflict = colourTextConflict(product, c.key);
    if (!conflict) return [];
    const said = [
      ...(conflict.fields.length > 0 ? [saying(conflict)] : []),
      ...(conflict.forbids.length > 0
        ? [
            `its forbidden list has ${andList(conflict.forbids.map((f) => `"${f}"`))}`,
          ]
        : []),
    ];
    const fields = [
      ...(conflict.fields.includes("name") ? ["productName"] : []),
      ...(conflict.fields.includes("material") ? ["material"] : []),
      ...(conflict.forbids.length > 0 ? ["forbidden"] : []),
    ];
    const base =
      product.colours.find((x) => x.key === product.defaultColour)?.name ??
      product.defaultColour;
    return [
      `${said.join(" and ")}, written for ${base}; give the colour ${c.name} its own ${andList(fields)}, or its scenes will say both`,
    ];
  });
}
