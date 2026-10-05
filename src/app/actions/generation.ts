"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { enqueueProjectCards } from "@/server/generation-queue";
import { cancelBatch, QueueRefusal } from "@/server/generation-repository";
import { getCurrentMaker } from "@/server/maker-repository";

// Queue mutations. Server Functions are POST-reachable: Zod is the trust
// boundary; the queue re-derives every request and estimate from the saved
// project, so nothing paid for comes from the client.

const Enqueue = z.object({
  projectId: z.string().min(1),
  // Each card once: a repeated id would otherwise ask for a second paid job.
  cardIds: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .transform((ids) => [...new Set(ids)]),
  // The estimated max the maker approved; the server refuses if its own is
  // higher (the cards changed since the estimate was shown).
  shownMaxMicros: z.number().int().min(0).optional(),
});

export async function enqueueGenerationAction(
  input: unknown,
): Promise<{ queued: number } | { error: string }> {
  const parsed = Enqueue.parse(input);
  try {
    const result = await enqueueProjectCards(parsed);
    refresh();
    return { queued: result.queued };
  } catch (error) {
    if (error instanceof QueueRefusal) return { error: error.message };
    throw error;
  }
}

const Cancel = z.object({ batchId: z.string().min(1) });

export async function cancelBatchAction(input: unknown): Promise<void> {
  const { batchId } = Cancel.parse(input);
  const maker = await getCurrentMaker();
  await cancelBatch(maker.id, batchId);
  refresh();
}
