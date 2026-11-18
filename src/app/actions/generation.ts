"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  enqueueProjectCards,
  fitsProjectCards,
} from "@/server/generation-queue";
import { cancelBatch, QueueRefusal } from "@/server/generation-repository";
import { makerAction } from "@/server/guarded";

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
  // Test takes: each scene at its model's low quality, never approved.
  test: z.boolean().optional(),
});

export const enqueueGenerationAction = makerAction(
  async (
    maker,
    input: unknown,
  ): Promise<{ queued: number } | { error: string }> => {
    const parsed = Enqueue.parse(input);
    try {
      const result = await enqueueProjectCards(maker, parsed);
      refresh();
      return { queued: result.queued };
    } catch (error) {
      if (error instanceof QueueRefusal) return { error: error.message };
      throw error;
    }
  },
);

const Fit = z.object({
  projectId: z.string().min(1),
  cardIds: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .transform((ids) => [...new Set(ids)]),
});

// Whether these cards would fit this month's limit, for a member, who never
// reads the amounts: the server prices them from the saved project, so the
// answer is only ever about work the maker could queue.
export const monthFitAction = makerAction(
  async (
    maker,
    input: unknown,
  ): Promise<{ fits: boolean } | { error: string }> => {
    const parsed = Fit.parse(input);
    try {
      return { fits: await fitsProjectCards(maker, parsed) };
    } catch (error) {
      if (error instanceof QueueRefusal) return { error: error.message };
      throw error;
    }
  },
);

const Cancel = z.object({ batchId: z.string().min(1) });

export const cancelBatchAction = makerAction(
  async (maker, input: unknown): Promise<void> => {
    const { batchId } = Cancel.parse(input);
    await cancelBatch(maker.id, batchId);
    refresh();
  },
);
