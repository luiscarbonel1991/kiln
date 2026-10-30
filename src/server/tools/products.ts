import { z } from "zod";
import { importPackage, importSummary } from "@/server/product-import";
import { listProducts } from "@/server/product-repository";
import { defineTool, ToolRefusal } from "@/server/tools/registry";

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

export const importProductsTool = defineTool({
  name: "import_products",
  title: "Import products",
  description:
    "Import a product package (JSON; `kiln schema` prints its JSON Schema), as New project's Import a catalog does: each product created or updated by its sku. Answers what was imported, updated, unchanged and set aside, with the reason for each set aside. Images inline (data:) are stored; other addresses must be in Kiln's allowlist.",
  input: z.object({
    package: z
      .record(z.string(), z.unknown())
      .describe("The product package itself: { version, products: [...] }."),
  }),
  hints: { idempotent: true },
  run: async ({ package: pkg }) => {
    const result = await importPackage(pkg);
    if ("error" in result) throw new ToolRefusal(result.error);
    return { data: { ...importSummary(result) } };
  },
});
