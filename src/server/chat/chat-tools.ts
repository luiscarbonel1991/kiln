import { type ToolApprovalStatus, type ToolSet, tool } from "ai";
import { z } from "zod";
import { type Specialist, SpecialistId } from "@/server/chat/specialists";
import { callAndRecord } from "@/server/tool-calls";
import { TOOLS } from "@/server/tools";
import type { ToolContext, ToolOutput } from "@/server/tools/registry";

// Kiln's tools in the chat: the same list the MCP server serves, each call
// recorded with its session. A refusal reaches the model as the tool's error,
// in words it can act on. The maker clicks before a tool that spends, approves
// a frame or makes the delivery runs (Luis, 2026-10-30: free work alone, paid
// work on the maker's ok, never publishing); a paid tool still runs only its
// stored quote, once.

// Not in the chat: a product package is a file, and a 30-day read is the
// maker's own entry.
export const LEFT_OUT = new Set(["import_products", "save_read"]);

export const NEEDS_CLICK = [
  "generate",
  "draw",
  "write_listing",
  "review_product",
  "approve_frame",
  "deliver",
] as const;

// Each tool that waits for the maker's click; edit_listing only when it
// would replace text the maker wrote.
export const TOOL_APPROVAL: Record<
  string,
  ToolApprovalStatus | ((input: unknown) => ToolApprovalStatus | undefined)
> = {
  ...Object.fromEntries(
    NEEDS_CLICK.map((name) => [name, "user-approval" as const]),
  ),
  edit_listing: (input) =>
    (input as { overwriteMakerText?: unknown } | null)?.overwriteMakerText ===
    true
      ? "user-approval"
      : undefined,
};

export class ToolRefused extends Error {}

type StoredOutput = Record<string, unknown> & {
  images?: { mimeType: string; data?: string }[];
};

// What the model reads of a tool's answer: its data, and a take it asked to
// see as an image. A take shown in an earlier turn is stored without its
// bytes (withoutImageData), so it is named, not sent again.
export function modelOutput(output: StoredOutput) {
  const { images, ...data } = output;
  if (!images?.length) return { type: "json" as const, value: data as never };
  return {
    type: "content" as const,
    value: [
      { type: "text" as const, text: JSON.stringify(data) },
      ...images.map((image) =>
        image.data
          ? {
              type: "file" as const,
              mediaType: image.mimeType,
              data: { type: "data" as const, data: image.data },
            }
          : {
              type: "text" as const,
              text: "(This take was shown in an earlier turn: view_frame shows it again.)",
            },
      ),
    ],
  };
}

function asStored({ data, images }: ToolOutput): StoredOutput {
  return images?.length ? { ...data, images } : data;
}

// The general mode's way to point the maker at a specialist: it changes
// nothing; the chat shows it as a button that switches the chip.
export const suggestSpecialist = tool({
  description:
    "Suggest the specialist that does this task best: the maker sees a button that switches to it. It runs nothing. etsy: a listing's text, tags, the market brief and the shop's numbers. scenes: tuning a project's scenes and their takes. svg: a design's line art and its vectors.",
  inputSchema: z.object({
    specialist: SpecialistId.exclude(["kiln"]),
    why: z.string().trim().min(1).max(200).describe("In a few words."),
  }),
  execute: async ({ specialist, why }) => ({ specialist, why }),
});

// The tools of one mode of the chat: every Kiln tool the chat offers, or the
// specialist's own; the general mode can also suggest a specialist.
export function chatTools(
  ctx: ToolContext,
  specialist: Pick<Specialist, "id" | "tools">,
): ToolSet {
  const offered = TOOLS.filter(
    (t) =>
      !LEFT_OUT.has(t.name) &&
      (specialist.tools === null || specialist.tools.includes(t.name)),
  );
  return {
    ...Object.fromEntries(
      offered.map((t) => [
        t.name,
        tool({
          description: t.description,
          inputSchema: t.input,
          execute: async (input: unknown) => {
            const answer = await callAndRecord(TOOLS, t.name, input, ctx);
            if (!answer.ok) throw new ToolRefused(answer.error);
            return asStored(answer.output);
          },
          toModelOutput: ({ output }) => modelOutput(output as StoredOutput),
        }),
      ]),
    ),
    ...(specialist.id === "kiln"
      ? { suggest_specialist: suggestSpecialist }
      : {}),
  };
}
