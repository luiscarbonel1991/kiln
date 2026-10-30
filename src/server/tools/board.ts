import { z } from "zod";
import type { FrameView } from "@/domain/frame-view";
import { fetchAsset } from "@/providers/asset-bytes";
import { framedProjects, projectFrames } from "@/server/project-frames";
import { defineTool, ToolRefusal } from "@/server/tools/registry";

// The board as tools: the projects, their frames, and a look at a take.

const ProjectId = z
  .string()
  .min(1)
  .describe("The project's Kiln id, as list_projects gives it.");
const FrameName = z
  .string()
  .regex(/^[^.]+\.[^.].*$/, 'A frame is its destination and slot: "etsy.hero".')
  .describe(
    'The frame: its destination and slot, as get_frames names it ("etsy.hero").',
  );

export const FrameRef = z.object({ project: ProjectId, frame: FrameName });

async function framesOf(project: string) {
  const frames = await projectFrames(project);
  if (!frames) {
    throw new ToolRefusal("No project of yours with frames has that id.");
  }
  return frames;
}

export async function frameOf(
  project: string,
  frame: string,
): Promise<FrameView> {
  const found = (await framesOf(project)).frames.find((f) => f.frame === frame);
  if (!found) {
    throw new ToolRefusal(
      `This project has no frame "${frame}": get_frames lists them.`,
    );
  }
  return found;
}

export const listProjects = defineTool({
  name: "list_projects",
  title: "List projects",
  description:
    "The maker's projects that have frames (started from New project), newest first: id, name, type and phase.",
  input: z.object({}),
  hints: { readOnly: true },
  run: async () => ({ data: { projects: await framedProjects() } }),
});

export const getFrames = defineTool({
  name: "get_frames",
  title: "Get a project's frames",
  description:
    "Each frame of a project as the board shows it: its state (queued, generating, to-review, approved, exact, ...), the take an approval approves (output), the approved one, whether it failed and why, and, after a fallback, the model it ran on. Exact frames are drawn from the product at delivery and cost nothing.",
  input: z.object({ project: ProjectId }),
  hints: { readOnly: true },
  run: async ({ project }) => {
    const { project: summary, frames } = await framesOf(project);
    return { data: { project: summary, frames } };
  },
});

export const viewFrame = defineTool({
  name: "view_frame",
  title: "Look at a frame's take",
  description:
    "The take a frame shows now, as an image to look at before approving or rejecting it, with the output to pass back to approve_frame or reject_frame.",
  input: FrameRef,
  hints: { readOnly: true },
  run: async ({ project, frame }) => {
    const view = await frameOf(project, frame);
    if (!view.output) {
      throw new ToolRefusal(
        view.fill === "exact"
          ? `${frame} is exact: Kiln draws it from the product at delivery, so it has no take to look at.`
          : `${frame} has no take to look at yet (${view.state}${view.failed ? ", its last take failed" : ""}).`,
      );
    }
    const data = {
      frame,
      label: view.label,
      state: view.state,
      output: view.output,
      approvedOutput: view.approvedOutput,
      ...(view.ranOn ? { ranOn: view.ranOn } : {}),
    };
    const asset = await fetchAsset(view.output);
    if (!asset.mime.startsWith("image/")) {
      return {
        data: {
          ...data,
          note: `A ${asset.mime} take: open its output to watch it.`,
        },
      };
    }
    return { data, images: [{ data: asset.base64, mimeType: asset.mime }] };
  },
});
