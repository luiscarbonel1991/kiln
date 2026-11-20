// The words Kiln's code never carries (CONTRIBUTING.md, "What Kiln leaves
// out"): a maker's name, signs and their formats, acrylic or laser work. Maker
// #1's name is encoded so the guard itself does not carry it. To sign in, up or
// out is an account's verb, not the product: those pass.
export const MAKER = Buffer.from("ZGx1bmE=", "base64").toString();

export const LEAK = new RegExp(
  `${MAKER}|\\bsigns\\b|\\bsign\\b(?![ -](?:in|up|out)\\b)|acrylic|laser|hanger|plaque|house.?numbers?|no.?soliciting`,
  "i",
);
