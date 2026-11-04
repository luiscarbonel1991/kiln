import { z } from "zod";
import { fetchAsset } from "@/providers/asset-bytes";
import { rasterize } from "@/providers/plates/svg";
import {
  type DrawingView,
  designView,
  listDesigns,
  makeProductHref,
} from "@/server/designs";
import { setCardVector } from "@/server/project-repository";
import { defineTool, ToolRefusal } from "@/server/tools/registry";
import { traceToVector, VectorDetail, VectorMode } from "@/server/vectorize";

// A design's tools (the SVG specialist's): read the maker's designs, look at a
// drawing or its vector, and trace a drawing into an SVG (free, on the server).
// Drawing the line art is paid: quote "draw", then draw. A vector is art for
// the maker's product, made into one in their product form (makeProduct); Kiln
// makes no production files.

const DesignRef = z
  .object({
    project: z.string().min(1).describe("The design's Kiln id (list_designs)."),
  })
  .strict();

const DrawingRef = DesignRef.extend({
  card: z
    .string()
    .min(1)
    .describe('The drawing\'s card id (get_design: "recipe-line-art-0").'),
}).strict();

async function drawingOf(project: string, card: string): Promise<DrawingView> {
  const design = await designView(project);
  if (!design) throw new ToolRefusal("No design of yours has that id.");
  const drawing = design.drawings.find((d) => d.card === card);
  if (!drawing) {
    throw new ToolRefusal(
      `"${card}" is not a drawing of this design: get_design names them.`,
    );
  }
  return drawing;
}

export const listDesignsTool = defineTool({
  name: "list_designs",
  title: "List the maker's designs",
  description:
    "The maker's design projects (an image drawn as line art, then traced into SVG), newest first, with how many drawings each has drawn and traced. Designs have no frames: get_design reads one.",
  input: z.object({}).strict(),
  hints: { readOnly: true },
  run: async () => ({ data: { designs: await listDesigns() } }),
});

export const getDesign = defineTool({
  name: "get_design",
  title: "Read a design",
  description:
    "A design's image and each drawing: its state (to-draw, drawing, drawn, vectorized, failed), its line art and its vector, and the link where the maker makes a vector into a product.",
  input: DesignRef,
  hints: { readOnly: true },
  run: async ({ project }) => {
    const design = await designView(project);
    if (!design) throw new ToolRefusal("No design of yours has that id.");
    const waiting = design.drawings.filter(
      (d) => d.state === "to-draw" || d.state === "failed",
    ).length;
    const drawn = design.drawings.filter((d) => d.state === "drawn").length;
    return {
      data: {
        ...design,
        next:
          waiting > 0
            ? `${waiting === 1 ? "1 drawing has" : `${waiting} drawings have`} no line art: quote "draw", then draw.`
            : drawn > 0
              ? "Look at a drawing with view_design, then vectorize it."
              : "Each drawn drawing has its vector: view_design shows it.",
      },
    };
  },
});

export const viewDesign = defineTool({
  name: "view_design",
  title: "Look at a drawing or its vector",
  description:
    'A drawing as an image: its line art ("line-art"), or its traced SVG rendered on white ("vector"), to judge the trace before the maker uses it.',
  input: DrawingRef.extend({
    show: z.enum(["line-art", "vector"]).default("line-art"),
  }).strict(),
  hints: { readOnly: true, showsImages: true },
  run: async ({ project, card, show }) => {
    const drawing = await drawingOf(project, card);
    const url = show === "vector" ? drawing.vector : drawing.lineArt;
    if (!url) {
      throw new ToolRefusal(
        show === "vector"
          ? `${drawing.label} has no vector yet: vectorize it.`
          : `${drawing.label} has no line art yet (${drawing.state}).`,
      );
    }
    const data = {
      card,
      label: drawing.label,
      state: drawing.state,
      show,
      url,
    };
    const asset = await fetchAsset(url);
    if (show === "line-art") {
      return { data, images: [{ data: asset.base64, mimeType: asset.mime }] };
    }
    const png = rasterize(asset.bytes.toString("utf8"), 1024, "#ffffff");
    return {
      data,
      images: [
        { data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
      ],
    };
  },
});

export const vectorizeTool = defineTool({
  name: "vectorize",
  title: "Trace a drawing into an SVG",
  description:
    'Trace a drawing\'s line art into an SVG on the server, free, and keep it as the drawing\'s vector, as the studio\'s Outline and Centerline do. mode: "outline" traces filled shapes, "centerline" one path per drawn stroke. detail: "fine" keeps small marks, "balanced" is the studio\'s trace, "clean" drops specks and smooths curves (the clean-up). Tracing again replaces the vector.',
  input: DrawingRef.extend({
    mode: VectorMode.default("outline"),
    detail: VectorDetail.default("balanced"),
  }).strict(),
  hints: {},
  run: async ({ project, card, mode, detail }) => {
    const drawing = await drawingOf(project, card);
    if (!drawing.lineArt) {
      throw new ToolRefusal(
        drawing.state === "drawing"
          ? `${drawing.label} is being drawn: vectorize it once it lands.`
          : `${drawing.label} has no line art yet: quote "draw", then draw.`,
      );
    }
    const traced = await traceToVector(drawing.lineArt, mode, detail);
    if ("error" in traced) throw new ToolRefusal(traced.error);
    if (!(await setCardVector(project, card, drawing.lineArt, traced.url))) {
      throw new ToolRefusal(
        `${drawing.label} changed while it was traced: read get_design again.`,
      );
    }
    return {
      data: {
        card,
        label: drawing.label,
        vector: traced.url,
        mode,
        detail,
        shapes: traced.shapes,
        bytes: traced.bytes,
        makeProduct: makeProductHref(traced.url),
        next: 'Look at it with view_design (show "vector"); "clean" traces fewer, smoother shapes.',
      },
    };
  },
});
