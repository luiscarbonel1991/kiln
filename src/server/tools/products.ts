import { z } from "zod";
import { listProducts } from "@/server/product-repository";
import { defineTool } from "@/server/tools/registry";

// The maker's products as tools.

export const listProductsTool = defineTool({
  name: "list_products",
  title: "List products",
  description:
    "The maker's products, by name: id, sku, name, family, description, its colours and default colour, and its wording lines.",
  input: z.object({}),
  hints: { readOnly: true },
  run: async () => ({
    data: {
      products: (await listProducts()).map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        family: p.family,
        ...(p.description ? { description: p.description } : {}),
        defaultColour: p.defaultColour,
        colours: p.colours.map((c) => ({ key: c.key, name: c.name })),
        wording: p.wording.map((w) => ({
          label: w.label,
          maxChars: w.maxChars,
          required: w.required,
        })),
      })),
    },
  }),
});
