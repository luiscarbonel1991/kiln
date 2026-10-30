import { z } from "zod";
import type { FrameView } from "@/domain/frame-view";
import { parseSlotCardId, type SlotRef, withSlotTuning } from "@/domain/plan";
import {
  effectiveKnobs,
  KNOBS,
  REASONS,
  ReasonKey,
  reasonMove,
} from "@/domain/scene-knobs";
import { kilnPick, threeQuarterFor } from "@/domain/scene-reference";
import { fetchAsset } from "@/providers/asset-bytes";
import { framedProjects, projectFrames } from "@/server/project-frames";
import { loadProjectBoard, setSlotApproval } from "@/server/project-repository";
import { retuneSlot } from "@/server/slot-tuning";
import { defineTool, ToolRefusal } from "@/server/tools/registry";

// The board as tools: the projects, their frames, a look at a take, and the
// decision on it. Nothing is approved unseen: approve and reject name the
// take the agent looked at, and a newer one refuses.

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
const Take = z
  .string()
  .min(1)
  .max(2048)
  .describe(
    "The take you looked at: its output, as view_frame or get_frames gives it.",
  );

const refOf = (frame: string): SlotRef => {
  const ref = parseSlotCardId(frame);
  if (!ref) throw new ToolRefusal(`"${frame}" is not a frame.`);
  return ref;
};

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

export const approveFrame = defineTool({
  name: "approve_frame",
  title: "Approve a frame's take",
  description:
    "Approve the take a frame shows, as the board's Approve does: name the take you looked at (view_frame), and a newer take that landed since refuses, so nothing is approved unseen. An exact frame, the maker's photo and a shared frame take no approval. Approved takes are what deliver exports.",
  input: FrameRef.extend({ take: Take }),
  hints: { idempotent: true },
  run: async ({ project, frame, take }) => {
    await frameOf(project, frame);
    await setSlotApproval(project, refOf(frame), true, take);
    return { data: { frame: await frameOf(project, frame) } };
  },
});

export const unapproveFrame = defineTool({
  name: "unapprove_frame",
  title: "Withdraw a frame's approval",
  description:
    "Withdraw a frame's approval, as the board's Undo does: the take stays, waiting for a decision again.",
  input: FrameRef,
  hints: { idempotent: true },
  run: async ({ project, frame }) => {
    await frameOf(project, frame);
    await setSlotApproval(project, refOf(frame), false);
    return { data: { frame: await frameOf(project, frame) } };
  },
});

export const rejectFrame = defineTool({
  name: "reject_frame",
  title: "Reject a frame's take, with a reason",
  description:
    "Say what is off about a scene's take, as the board's reason chips do: each reason moves one of the scene's knobs (top: the camera looks more from above; small: closer; busy: fewer props; dark: studio light; harsh: softer shadows), and an approval of that take is withdrawn. Nothing is generated: the next take reads the change once you quote and generate it.",
  input: FrameRef.extend({
    take: Take,
    reason: ReasonKey.describe(
      "What is off: top (can't see its top), small (product too small), busy (too busy), dark (too dark), harsh (shadows too strong).",
    ),
  }),
  hints: {},
  run: async ({ project, frame, take, reason }) => {
    const view = await frameOf(project, frame);
    if (view.fill !== "scene") {
      throw new ToolRefusal(
        `${frame} is not a scene (${view.fill}): only a scene's take moves with a reason.`,
      );
    }
    if (view.output !== take) {
      throw new ToolRefusal(
        view.output
          ? `A newer take landed since: ${view.output}. Look at it with view_frame first.`
          : `${frame} has no take now (${view.state}).`,
      );
    }
    const ref = refOf(frame);
    const loaded = await loadProjectBoard(project);
    const slot = loaded?.board.plan?.destinations
      .find((d) => d.destinationId === ref.destinationId)
      ?.slots.find((s) => s.key === ref.slotKey);
    if (!slot?.knobs) {
      throw new ToolRefusal(
        `${frame} was planned before knobs: tune it in the editor instead.`,
      );
    }
    const above = threeQuarterFor(
      loaded?.board.plan?.references,
      loaded?.board.master?.assetUrl,
    );
    const move = reasonMove(
      reason,
      effectiveKnobs(slot.knobs, slot.tuned, kilnPick(slot.knobs, above)),
    );
    if (!move) {
      throw new ToolRefusal(
        `"${REASONS[reason].label}" moves nothing on ${frame}: the scene has no ${REASONS[reason].knob} knob, or it is as far as it goes.`,
      );
    }
    const unapproved = view.approvedOutput === take;
    if (unapproved) await setSlotApproval(project, ref, false);
    await retuneSlot(project, ref, (plan) => withSlotTuning(plan, ref, move));
    const stops = KNOBS[move.knob].stops as Record<string, { label: string }>;
    return {
      data: {
        frame,
        reason: REASONS[reason].label,
        moved: {
          knob: KNOBS[move.knob].label,
          to:
            move.stop === null
              ? "default"
              : (stops[move.stop]?.label ?? move.stop),
        },
        unapproved,
        next: `The next take of ${frame} reads the change: quote it, then generate.`,
      },
    };
  },
});
