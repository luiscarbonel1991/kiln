import type { DestinationText } from "@/domain/destination";
import {
  checkListing,
  type ListingText,
  listingAttributes,
  listingVariations,
} from "@/domain/listing";
import type { Product } from "@/domain/product";

const money = (n: number) => n.toFixed(2);
const block = (text: string) => ["----", text, "----"];

// The paste sheet: the listing text in the order of the channel's listing
// editor, each field to paste verbatim between ---- lines, what still breaks
// a rule at the top. Kiln never publishes; a human pastes it.
export function listingSheet(input: {
  channel: string;
  product: Product;
  listing: ListingText;
  rules: DestinationText;
}): string {
  const { channel, product, listing, rules } = input;
  const issues = checkListing(listing, product, rules);
  const errors = issues.filter((i) => i.severity === "error");
  const variations = listingVariations(product);
  const tags = listing.tags.value.map((t) => t.trim()).filter(Boolean);
  const fields = listing.personalization.value;
  const lines = [
    `${product.name} (${product.sku}) — ${channel} listing text`,
    `Paste each field into ${channel}'s listing editor, in this order. Text between ---- lines is pasted verbatim. Kiln never publishes; a human does.`,
    "",
    ...(errors.length > 0
      ? [
          "FIX BEFORE PUBLISHING",
          ...errors.map((e) => `- ${e.field}: ${e.message}`),
          "",
        ]
      : []),
    `[1] TITLE (${listing.title.value.length} of ${rules.title.maxChars} characters)`,
    ...block(listing.title.value),
    "",
    "[2] DESCRIPTION",
    ...block(listing.description.value),
    "",
    "[3] PRICE AND VARIATIONS",
    ...(product.price !== undefined && !variations.some((v) => v.pricesVary)
      ? [`Price: ${money(product.price)}`]
      : product.price === undefined
        ? ["Price: none in the product yet (the maker sets it)"]
        : []),
    ...(variations.length === 0 ? ["No variations."] : []),
    ...variations.flatMap((v, i) => [
      `Type ${i + 1} — ${v.name}   Prices vary: ${v.pricesVary ? "on" : "off"}`,
      ...block(
        v.values
          .map(
            (value) =>
              `${value.label}${v.pricesVary ? ` — ${value.price === undefined ? "no price" : money(value.price)}` : ""}${value.inStock ? "" : " (out of stock: quantity 0)"}`,
          )
          .join("\n"),
      ),
    ]),
    "",
    `[4] PERSONALIZATION (${fields.length} ${fields.length === 1 ? "field" : "fields"})`,
    ...(fields.length === 0 ? ["None."] : []),
    ...fields.flatMap((f, i) => [
      `Field ${i + 1} — Title: ${f.title}   Required: ${f.required ? "Yes" : "No"}${f.maxChars ? `   Character limit: ${f.maxChars}` : ""}`,
      ...block(f.instructions),
    ]),
    "",
    `[5] TAGS (${tags.length} of ${rules.tags.count})`,
    ...block(tags.join(", ")),
    "",
    "[6] MATERIALS",
    ...block(listing.materials.value.join(", ")),
    "",
    "[7] ATTRIBUTES",
    listingAttributes(product)
      .map((a) => `${a.label} ${a.value}`)
      .join(" · "),
  ];
  return `${lines.join("\n")}\n`;
}
