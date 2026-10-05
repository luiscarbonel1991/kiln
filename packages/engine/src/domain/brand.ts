import { z } from "zod";
import { Hex } from "@/domain/product";

export const BrandProfile = z.object({
  id: z.string(),
  name: z.string(),
  palette: z.array(z.string()).min(1),
  fonts: z.object({ display: z.string(), body: z.string() }),
  tone: z.array(z.string()),
  visualStyle: z.array(z.string()),
  doList: z.array(z.string()).default([]),
  dontList: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
});
export type BrandProfile = z.infer<typeof BrandProfile>;

// A maker's brand kit for the text layers Kiln draws (the call-to-action card,
// the hook band): the palette (the first colour leads), the shop's handle and
// link. It arrives with the maker's product package (the `maker` block); the
// handle is kept without its "@".
export const BrandKit = z.object({
  palette: z.array(Hex).max(6).default([]),
  handle: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9._-]{1,40}$/, "a shop handle like @northwind")
    .transform((h) => h.replace(/^@/, ""))
    .optional(),
  url: z.string().trim().url().max(200).optional(),
});
export type BrandKit = z.infer<typeof BrandKit>;
