// The words Kiln's code never carries (CLAUDE.md "Boundaries"): a maker's
// name, signs and their formats, acrylic or laser work. Maker #1's name is
// encoded so the guard itself does not carry it.
export const MAKER = Buffer.from("ZGx1bmE=", "base64").toString();

export const LEAK = new RegExp(
  `${MAKER}|\\bsigns?\\b|acrylic|laser|hanger|plaque|house.?numbers?|no.?soliciting`,
  "i",
);
