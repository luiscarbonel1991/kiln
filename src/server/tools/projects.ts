import { z } from "zod";
import { heroSettingsOf } from "@/domain/hero-setting";
import { slotCardId } from "@/domain/plan";
import { projectLook } from "@/domain/plan-look";
import { Look, lookLabel } from "@/domain/product-look";
import { ProjectType } from "@/domain/project";
import { CATALOG } from "@/lib/recipes";
import { deliverDestination } from "@/server/deliver/deliver-destination";
import { getProduct } from "@/server/product-repository";
import { projectFrames, waitingProjectFrames } from "@/server/project-frames";
import { startingPlan, startProject } from "@/server/start-project";
import { defineTool, ToolRefusal } from "@/server/tools/registry";

// Projects as tools: the plan a project would start with, starting one, and
// delivering a destination. Starting costs nothing (no model is called).

const DESTINATIONS = CATALOG.destinations
  .map((d) => `${d.id} (${d.name})`)
  .join(", ");

const NewProject = z.object({
  product: z.string().min(1).describe("The product's Kiln id (list_products)."),
  type: ProjectType.exclude(["design"]).describe(
    "listing-kit: a sale listing's photos, video and text; content: posts; launch: a sale listing and its posts.",
  ),
  destinations: z
    .array(z.string().min(1))
    .min(1)
    .max(12)
    .describe(`Where it goes: ${DESTINATIONS}.`),
  off: z
    .array(z.string().min(1))
    .max(60)
    .default([])
    .describe('Frames to leave out ("etsy.gift"), as plan_project lists them.'),
  look: Look.optional().describe(
    "The colour and style the project shows, by key (list_products; style \"original\" is the product's own drawing). Left out, the product's default, which never changes for the project.",
  ),
});

async function productOf(id: string) {
  const product = await getProduct(id);
  if (!product) throw new ToolRefusal("No product of yours has that id.");
  return product;
}

export const planProjectTool = defineTool({
  name: "plan_project",
  title: "Plan a project",
  description:
    "The frames a project would start with, without starting it: the look it shows (its colour and style), each destination's slots, what fills each (scene: a paid take; exact: drawn from the product, free; video; shared: repeats an approved scene) and the hero's setting. Nothing is saved.",
  input: NewProject,
  hints: { readOnly: true },
  run: async ({ product, type, destinations, off, look }) => {
    const found = await productOf(product);
    const { plan } = await startingPlan(found, {
      type,
      destinationIds: destinations,
      offSlots: off,
      heroSettings: {},
      look,
    }).catch((error) => {
      throw new ToolRefusal((error as Error).message);
    });
    const slots = plan.destinations.flatMap((d) => d.slots);
    const heroes = new Map(
      heroSettingsOf(plan).map((h) => [h.destinationId, h.setting]),
    );
    return {
      data: {
        product: { id: found.id, name: found.name },
        type,
        look: lookLabel(found, projectLook(plan, found)),
        destinations: plan.destinations.map((d) => ({
          destination: d.destinationId,
          ...(heroes.has(d.destinationId)
            ? { heroSetting: heroes.get(d.destinationId) }
            : {}),
          frames: d.slots.map((s) => ({
            frame: slotCardId(d.destinationId, s.key),
            label: s.label,
            fill: s.fill,
            ...(s.off ? { off: true } : {}),
          })),
        })),
        scenes: slots.filter((s) => s.fill === "scene" && !s.off).length,
        exact: slots.filter((s) => s.fill === "exact" && !s.off).length,
      },
    };
  },
});

export const createProjectTool = defineTool({
  name: "create_project",
  title: "Start a project",
  description:
    "Start a project as New project does: its plan, the product's reference and a draft for every scene. No model is called and nothing is paid; quote generate next to take its scenes.",
  input: NewProject,
  hints: {},
  run: async ({ product, type, destinations, off, look }) => {
    const started = await startProject({
      productId: product,
      type,
      destinationIds: destinations,
      offSlots: off,
      ...(look ? { look } : {}),
    });
    if ("error" in started) throw new ToolRefusal(started.error);
    const frames = await projectFrames(started.id);
    const state = await waitingProjectFrames(started.id);
    return {
      data: {
        project: started.id,
        name: frames?.project.name ?? null,
        reference: state?.reference ?? false,
        frames: frames?.frames ?? [],
        next: state?.reference
          ? "quote generate for this project to take its scenes."
          : "Kiln could not draw a reference from the product for free: the maker adds the product's photo on the board, then quote generate.",
      },
    };
  },
});

export const deliverTool = defineTool({
  name: "deliver",
  title: "Deliver a destination",
  description:
    "Export one destination of a project as the board's Deliver does: a zip of its approved frames, exact frames drawn from the product, the listing text and a README, stored and answered as a link. The frames it exported are stamped delivered. Publishing stays the maker's.",
  input: z.object({
    project: z.string().min(1).describe("The project's Kiln id."),
    destination: z.string().min(1).describe('The destination ("etsy").'),
  }),
  hints: { idempotent: true },
  run: async ({ project, destination }) => {
    const result = await deliverDestination(project, destination);
    if ("error" in result) throw new ToolRefusal(result.error);
    return { data: { project, destination, ...result } };
  },
});
