"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  isEmptyBrief,
  MAX_NOTES,
  MAX_SEARCHES,
  MarketBrief,
  SearchColumns,
} from "@/domain/market-brief";
import { makerAction } from "@/server/guarded";
import { rememberSearchColumns } from "@/server/maker-repository";
import { setBrief } from "@/server/project-repository";

const BriefSave = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  brief: z.unknown(),
  // The mapping a table was read with, kept for its source's next export.
  columns: z
    .object({
      source: z.string().trim().min(1).max(60),
      columns: SearchColumns,
    })
    .optional(),
});

// What is wrong with a brief, said where it is ("Search 3 needs its term").
function briefError(error: z.ZodError): string {
  const issue = error.issues[0];
  const [list, index, field] = issue.path;
  if (issue.code === "custom") {
    return `${issue.message[0].toUpperCase()}${issue.message.slice(1)}.`;
  }
  if (index === undefined && issue.code === "too_big") {
    return `A brief holds at most ${MAX_SEARCHES} searches and ${MAX_NOTES} notes.`;
  }
  const where =
    list === "searches"
      ? `Search ${Number(index) + 1}`
      : list === "notes"
        ? `Note ${Number(index) + 1}`
        : "The brief";
  if (field === "readOn") return `${where} needs its date (YYYY-MM-DD).`;
  if (issue.code === "too_small" && field === "term") {
    return `${where} needs its term.`;
  }
  if (issue.code === "too_small" && field === "note") {
    return `${where} needs a few words.`;
  }
  if (issue.code === "too_small" && field === "source") {
    return `${where} needs its source.`;
  }
  if (issue.code === "too_big" && typeof field === "string") {
    return `${where}: the ${field} is too long.`;
  }
  return `${where} holds a value the brief cannot keep.`;
}

// Save a destination's market brief (an empty one clears it), and the column
// mapping a pasted table was read with, for its source.
export const saveBriefAction = makerAction(
  async (maker, input: unknown): Promise<{ error: string } | undefined> => {
    const parsed = BriefSave.safeParse(input);
    if (!parsed.success) return { error: "The brief could not be read." };
    const { projectId, destinationId, columns } = parsed.data;
    const brief = MarketBrief.safeParse(parsed.data.brief);
    if (!brief.success) return { error: briefError(brief.error) };
    try {
      await setBrief(
        maker,
        projectId,
        destinationId,
        isEmptyBrief(brief.data) ? undefined : brief.data,
      );
      if (columns)
        await rememberSearchColumns(maker, columns.source, columns.columns);
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Could not save the brief.",
      };
    }
    refresh();
  },
);
