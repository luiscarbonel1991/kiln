import { z } from "zod";
import { colourTextWarning } from "@/domain/colour-text";
import type { FrameView } from "@/domain/frame-view";
import {
  type PlanSlot,
  type ProjectPlan,
  parseSlotCardId,
  type SlotRef,
  withSlotPlace,
  withSlotTuning,
} from "@/domain/plan";
import { slotLook, slotView } from "@/domain/plan-look";
import type { Product } from "@/domain/product";
import { lookLabel, productStyles } from "@/domain/product-look";
import {
  CameraStop,
  DistanceStop,
  effectiveKnobs,
  KNOBS,
  type KnobChoice,
  KnobKey,
  knobStops,
  knobSummary,
  LightStop,
  PropsStop,
  REASONS,
  ReasonKey,
  reasonMove,
  SettingStop,
  ShadowStop,
} from "@/domain/scene-knobs";
import { kilnPick, threeQuarterFor } from "@/domain/scene-reference";
import { fetchAsset } from "@/providers/asset-bytes";
import { noteApproval, noteReason } from "@/server/lessons";
import type { MakerRef } from "@/server/maker-repository";
import { framedProjects, projectFrames } from "@/server/project-frames";
import {
  loadProjectBoard,
  setSlotApproval,
  setSlotOff,
  setVideoChoice,
} from "@/server/project-repository";
import { relookSlot, retuneSlot } from "@/server/slot-tuning";
import { makeStillsVideo } from "@/server/stills-video";
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

async function framesOf(maker: MakerRef, project: string) {
  const frames = await projectFrames(maker, project);
  if (!frames) {
    throw new ToolRefusal("No project of yours with frames has that id.");
  }
  return frames;
}

export async function frameOf(
  maker: MakerRef,
  project: string,
  frame: string,
): Promise<FrameView> {
  const found = (await framesOf(maker, project)).frames.find(
    (f) => f.frame === frame,
  );
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
  run: async (_input, { maker }) => ({
    data: { projects: await framedProjects(maker) },
  }),
});

export const getFrames = defineTool({
  name: "get_frames",
  title: "Get a project's frames",
  description:
    "Each frame of a project as the board shows it: its state (queued, generating, to-review, approved, exact, ...), the take an approval approves (output), the approved one, whether it failed and why, Kiln's check of a scene's take (its text and letterforms against the reference: passed, failed with what, or unchecked with why; scale is the size the scene asked for, never measured; seen is what a text model saw when it looked at the take for anything impossible, when the maker has that look on: it can miss a flaw or flag a fine take, so look yourself), and, after a fallback, the model it ran on. Exact frames are drawn from the product at delivery and cost nothing.",
  input: z.object({ project: ProjectId }),
  hints: { readOnly: true },
  run: async ({ project }, { maker }) => {
    const { project: summary, frames } = await framesOf(maker, project);
    return { data: { project: summary, frames } };
  },
});

export const viewFrame = defineTool({
  name: "view_frame",
  title: "Look at a frame's take",
  description:
    "The take a frame shows now, as an image to look at before approving or rejecting it, with the output to pass back to approve_frame or reject_frame, and Kiln's check of it. Kiln never measures scale: compare the product with check.scale in the image.",
  input: FrameRef,
  hints: { readOnly: true, showsImages: true },
  run: async ({ project, frame }, { maker }) => {
    const view = await frameOf(maker, project, frame);
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
      ...(view.check !== undefined ? { check: view.check } : {}),
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
  run: async ({ project, frame, take }, { maker }) => {
    await frameOf(maker, project, frame);
    await setSlotApproval(maker, project, refOf(frame), true, take);
    await noteApproval(maker, project, refOf(frame));
    return { data: { frame: await frameOf(maker, project, frame) } };
  },
});

export const unapproveFrame = defineTool({
  name: "unapprove_frame",
  title: "Withdraw a frame's approval",
  description:
    "Withdraw a frame's approval, as the board's Undo does: the take stays, waiting for a decision again.",
  input: FrameRef,
  hints: { idempotent: true },
  run: async ({ project, frame }, { maker }) => {
    await frameOf(maker, project, frame);
    await setSlotApproval(maker, project, refOf(frame), false);
    return { data: { frame: await frameOf(maker, project, frame) } };
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
  run: async ({ project, frame, take, reason }, { maker }) => {
    const view = await frameOf(maker, project, frame);
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
    const loaded = await loadProjectBoard(maker, project);
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
      effectiveKnobs(
        slot.knobs,
        slot.tuned,
        kilnPick(slot.knobs, above),
        slot.learned,
      ),
    );
    if (!move) {
      throw new ToolRefusal(
        `"${REASONS[reason].label}" moves nothing on ${frame}: the scene has no ${REASONS[reason].knob} knob, or it is as far as it goes.`,
      );
    }
    const unapproved = view.approvedOutput === take;
    if (unapproved) await setSlotApproval(maker, project, ref, false);
    await retuneSlot(maker, project, ref, (plan) =>
      withSlotTuning(plan, ref, move),
    );
    await noteReason(maker, project, ref, reason, move);
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

// A knob's stops for a client: each stop's key and what it does.
const knobHelp = (knob: KnobKey) =>
  `${KNOBS[knob].label}: ${knobStops(knob)
    .map((stop) => {
      const about = (KNOBS[knob].stops as Record<string, { label: string }>)[
        stop
      ];
      return `${stop} (${about.label})`;
    })
    .join(", ")}; "default" returns it to the scene's own.`;

const knob = <S extends z.ZodEnum>(stops: S, key: KnobKey) =>
  stops.or(z.literal("default")).optional().describe(knobHelp(key));

const KnobsInput = z
  .object({
    setting: knob(SettingStop, "setting"),
    camera: knob(CameraStop, "camera"),
    distance: knob(DistanceStop, "distance"),
    light: knob(LightStop, "light"),
    shadow: knob(ShadowStop, "shadow"),
    props: knob(PropsStop, "props"),
  })
  .strict();

// A slot's knobs as a tool answers them: each offered knob, its stop and who
// set it, the board's one-line summary, and its look (a product in more than
// one).
function knobsOf(
  slot: PlanSlot,
  plan: ProjectPlan,
  master: string | undefined,
  product: Product | null,
) {
  if (!slot.knobs) return null;
  const knobs = effectiveKnobs(
    slot.knobs,
    slot.tuned,
    kilnPick(
      slot.knobs,
      product
        ? slotView(plan, slot, master, product)
        : threeQuarterFor(plan.references, master),
    ),
    slot.learned,
  );
  const look =
    product && (product.colours.length > 1 || productStyles(product).length > 0)
      ? slotLook(plan, slot, product)
      : null;
  return {
    summary: knobSummary(knobs),
    knobs: Object.fromEntries(
      knobs.offered.map((k) => {
        const stop = knobs.stops[k] as string;
        const about = (KNOBS[k].stops as Record<string, { label: string }>)[
          stop
        ];
        return [
          k,
          {
            stop,
            label: about?.label ?? stop,
            by: knobs.chosen.includes(k)
              ? "maker"
              : knobs.learned.includes(k)
                ? "lesson"
                : knobs.picked.includes(k)
                  ? "kiln"
                  : "default",
          },
        ];
      }),
    ),
    ...(slot.place ? { place: slot.place } : {}),
    ...(product && look
      ? {
          look: {
            colour: look.colour,
            ...(look.style ? { style: look.style } : {}),
            name: lookLabel(product, look),
            ...textWarningOf(product, look.colour),
          },
        }
      : {}),
  };
}

// What in the product's text contradicts a colour, for the agent to pass on.
function textWarningOf(product: Product, colour: string) {
  const warning = colourTextWarning(product, colour);
  return warning ? { textWarning: warning } : {};
}

const refusal = (error: unknown) =>
  error instanceof ToolRefusal
    ? error
    : new ToolRefusal(
        error instanceof Error ? error.message : "Kiln could not change it.",
      );

export const tuneFrame = defineTool({
  name: "tune_frame",
  title: "Tune a scene",
  description:
    "Set a scene's knobs (setting, camera, distance, light, shadow, props), its place, and its colour and style, as the board's Tune does: free, nothing is generated. Each knob takes one of its stops, or \"default\"; a knob the scene does not offer is refused. A place (\"on a walnut desk\") puts the scene there; null returns it to the product's places. A colour or style key (list_products; \"original\" is the product's own drawing) shows the scene in that look, Kiln drawing it from the design file; null returns it to the project's. The answer is the scene's knobs after the change, and its look; a look's textWarning says the product's text contradicts that colour (tell the maker: the product needs that colour's own name, material or things to avoid). The next take reads it once you quote it and generate. A scene in the queue, or whose take is approved, is not tuned.",
  input: FrameRef.extend({
    knobs: KnobsInput.optional(),
    place: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .nullable()
      .optional()
      .describe("Where the scene stands, in a few words; null clears it."),
    colour: z
      .string()
      .min(1)
      .max(64)
      .nullable()
      .optional()
      .describe("A colour key of the product; null for the project's."),
    style: z
      .string()
      .min(1)
      .max(64)
      .nullable()
      .optional()
      .describe(
        'A style key of the product, or "original"; null for the project\'s.',
      ),
  }),
  hints: { idempotent: true },
  run: async (
    { project, frame, knobs = {}, place, colour, style },
    { maker },
  ) => {
    const view = await frameOf(maker, project, frame);
    if (view.fill !== "scene") {
      throw new ToolRefusal(
        `${frame} is not a scene (${view.fill}): only a scene has knobs.`,
      );
    }
    const choices = KnobKey.options.flatMap((k): KnobChoice[] => {
      const stop = knobs[k];
      if (stop === undefined) return [];
      return [
        { knob: k, stop: stop === "default" ? null : stop } as KnobChoice,
      ];
    });
    const relooks = colour !== undefined || style !== undefined;
    if (choices.length === 0 && place === undefined && !relooks) {
      throw new ToolRefusal("Name a knob to set, a place, or a look.");
    }
    const ref = refOf(frame);
    let tuned: Awaited<ReturnType<typeof retuneSlot>> | null = null;
    try {
      if (relooks) {
        tuned = await relookSlot(maker, project, ref, {
          ...(colour !== undefined ? { colour } : {}),
          ...(style !== undefined ? { style } : {}),
        });
      }
      if (choices.length > 0 || place !== undefined) {
        tuned = await retuneSlot(maker, project, ref, (plan) =>
          choices.reduce(
            (p, choice) => withSlotTuning(p, ref, choice),
            place === undefined ? plan : withSlotPlace(plan, ref, place),
          ),
        );
      }
    } catch (error) {
      throw refusal(error);
    }
    if (!tuned) throw new ToolRefusal("Kiln could not change it.");
    const slot = tuned.plan.destinations
      .find((d) => d.destinationId === ref.destinationId)
      ?.slots.find((s) => s.key === ref.slotKey);
    const loaded = await loadProjectBoard(maker, project);
    return {
      data: {
        frame,
        ...(slot
          ? knobsOf(
              slot,
              tuned.plan,
              loaded?.board.master?.assetUrl,
              tuned.product,
            )
          : {}),
        next: `The next take of ${frame} reads this: quote it, then generate.`,
      },
    };
  },
});

export const switchFrame = defineTool({
  name: "switch_frame",
  title: "Switch a frame on or off",
  description:
    "Switch a frame of the plan off (it is not generated or delivered) or back on, as the board's Switch off does: free. An approval survives the round trip. A frame in the queue is not switched.",
  input: FrameRef.extend({
    on: z.boolean().describe("true switches it on, false off."),
  }),
  hints: { idempotent: true },
  run: async ({ project, frame, on }, { maker }) => {
    await frameOf(maker, project, frame);
    try {
      await setSlotOff(maker, project, refOf(frame), !on);
    } catch (error) {
      throw refusal(error);
    }
    return { data: { frame, on } };
  },
});

export const makeStillsVideoTool = defineTool({
  name: "make_stills_video",
  title: "Make the stills video",
  description:
    "Make a video frame's listing video as stills in motion, as the board's \"Stills in motion · free\" does: each approved scene of its destination with a slow zoom, sliding to the next, no audio. Free and local, no model is called. It becomes the video frame's take, to approve like any other. Length and orientation are the frame's (seconds 8, 10 or 12).",
  input: FrameRef.extend({
    seconds: z
      .union([z.literal(8), z.literal(10), z.literal(12)])
      .optional()
      .describe("Its length; left out, the frame's."),
  }),
  hints: { idempotent: false },
  run: async ({ project, frame, seconds }, { maker }) => {
    const view = await frameOf(maker, project, frame);
    if (view.fill !== "video") {
      throw new ToolRefusal(`${frame} is not a video frame (${view.fill}).`);
    }
    const ref = refOf(frame);
    try {
      await setVideoChoice(maker, project, ref, {
        stills: true,
        ...(seconds ? { seconds } : {}),
      });
    } catch (error) {
      throw refusal(error);
    }
    const made = await makeStillsVideo(maker, project, ref);
    if ("error" in made) throw new ToolRefusal(made.error);
    return {
      data: {
        frame,
        take: made.url,
        next: `Check the take, then approve ${frame} with it.`,
      },
    };
  },
});
