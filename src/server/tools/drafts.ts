import { z } from "zod";
import { DraftSettings, WhenMade, WhoMade } from "@/domain/etsy-draft";
import {
  createDraftFromProject,
  DraftRefusal,
  draftDetail,
  listDrafts,
  previewDraft,
  updateDraft,
} from "@/server/etsy-drafts";
import { defineTool, ToolRefusal } from "@/server/tools/registry";

// The maker's Etsy drafts as tools (ROADMAP Phase 11). Reading is free and
// open to every agent; making or changing a draft runs only after the
// maker's click in Kiln's chat (an MCP agent is not offered them). Nothing
// publishes: the maker publishes a draft in Etsy's editor.

async function asTool<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DraftRefusal) throw new ToolRefusal(error.message);
    throw error;
  }
}

const Listing = z
  .number()
  .int()
  .positive()
  .describe("The Etsy listing id of the draft.");

export const listDraftsTool = defineTool({
  name: "list_drafts",
  title: "List the shop's Etsy drafts",
  description:
    "Every draft listing of the maker's connected Etsy shop, newest change first: its id, title, price, quantity, photo count, and the project Kiln made it from. draftsAllowed says whether the maker allowed Kiln to write drafts. Free; read from Etsy's API.",
  input: z.object({}),
  hints: { readOnly: true, openWorld: true },
  run: () =>
    asTool(async () => {
      const listed = await listDrafts();
      return {
        data: {
          shop: listed.shopName,
          draftsAllowed: listed.draftsAllowed,
          complete: listed.complete,
          drafts: listed.drafts.map((d) => ({
            listing: d.listingId,
            title: d.title,
            price: d.price,
            currency: d.currency,
            quantity: d.quantity,
            photos: d.photos,
            updatedAt: d.updatedAt,
            ...(d.madeBy
              ? {
                  project: d.madeBy.projectId,
                  projectName: d.madeBy.projectName,
                }
              : {}),
          })),
        },
      };
    }),
});

export const getDraftTool = defineTool({
  name: "get_draft",
  title: "Read an Etsy draft",
  description:
    "One listing of the maker's shop as Etsy has it now: title, description, tags, materials, category, price, quantity, photos, whether Kiln may change it (a draft; a live listing never) and why not, whether it has variations (its prices then stay Etsy's), and the last writes Kiln sent to it. Free.",
  input: z.object({ listing: Listing }),
  hints: { readOnly: true, openWorld: true },
  run: ({ listing }) =>
    asTool(async () => {
      const d = await draftDetail(listing);
      return {
        data: {
          listing: d.listingId,
          state: d.state,
          editable: d.editable,
          ...(d.why ? { why: d.why } : {}),
          title: d.title,
          description: d.description,
          tags: d.tags,
          materials: d.materials,
          category: d.category?.join(" › "),
          price: d.price,
          currency: d.currency,
          quantity: d.quantity,
          variations: d.variations,
          photos: d.images.length,
          writes: d.log.slice(0, 5).map((w) => ({
            action: w.action,
            status: w.status,
            by: w.by,
            at: w.at,
          })),
        },
      };
    }),
});

export const makeDraftTool = defineTool({
  name: "make_draft",
  title: "Make an Etsy draft from a project",
  description:
    "Send a project's listing to the maker's Etsy shop as a draft: its listing text, its approved photos in order and the product's price. The maker clicks to allow it. The category, quantity and who/when made default to what the product's last draft used, else what the shop's live listings use most; name them when the maker said. It never publishes: the maker publishes in Etsy. Refused while the listing has errors, the product has no price or a photo is not approved. Free.",
  input: z.object({
    project: z.string().min(1).describe("The project's Kiln id."),
    destination: z.string().min(1).describe('The sale destination ("etsy").'),
    category: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Etsy's category (taxonomy) id."),
    quantity: z.number().int().min(1).max(999).optional(),
    whoMade: WhoMade.optional(),
    whenMade: WhenMade.optional(),
  }),
  hints: { openWorld: true, makerClick: true },
  run: ({ project, destination, category, quantity, whoMade, whenMade }) =>
    asTool(async () => {
      const chosen = {
        ...(category ? { taxonomyId: category } : {}),
        ...(quantity ? { quantity } : {}),
        ...(whoMade ? { whoMade } : {}),
        ...(whenMade ? { whenMade } : {}),
      };
      const preview = await previewDraft(project, destination, chosen);
      if (!preview.fields) {
        throw new ToolRefusal(preview.blockers.join(" "));
      }
      const made = await createDraftFromProject({
        projectId: project,
        destinationId: destination,
        settings: DraftSettings.parse(preview.settings),
        requestKey: preview.requestKey,
        by: "Chat",
      });
      return {
        data: {
          listing: made.listingId,
          photos: made.photos,
          missingPhotos: made.missingPhotos,
          readBack: made.readBack,
          notSent: preview.notSent,
          editorUrl: made.editorUrl,
        },
      };
    }),
});

const Words = z.array(z.string().trim().min(1).max(60)).max(40);

export const editDraftTool = defineTool({
  name: "edit_draft",
  title: "Change an Etsy draft",
  description:
    "Change a draft of the maker's Etsy shop: title, description, tags (the whole list), materials (the whole list), category, price or quantity; the fields not given stay. The maker clicks to allow it. Kiln checks it is still a draft right before sending (a live listing is never changed) and refuses a price on a draft with variations. Only what differs is sent; the answer says what changed and anything Etsy read back differently. Free.",
  input: z.object({
    listing: Listing,
    title: z.string().trim().min(1).max(140).optional(),
    description: z.string().trim().min(1).max(20_000).optional(),
    tags: Words.optional(),
    materials: Words.optional(),
    category: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Etsy's category (taxonomy) id."),
    price: z.number().positive().max(50_000).optional(),
    quantity: z.number().int().min(0).max(999).optional(),
  }),
  hints: { openWorld: true, makerClick: true },
  run: ({ listing, category, ...change }) =>
    asTool(async () => {
      const result = await updateDraft(
        listing,
        { ...change, ...(category ? { taxonomyId: category } : {}) },
        "Chat",
      );
      if (result.changes.length === 0) {
        throw new ToolRefusal("Nothing differs from the draft on Etsy.");
      }
      return {
        data: {
          listing,
          changed: result.changes.map((c) => c.field),
          readBack: result.readBack,
        },
      };
    }),
});
