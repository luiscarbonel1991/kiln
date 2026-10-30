import { db } from "@/lib/db";
import { appendChatEvent } from "@/server/chat/chat-repository";

// A batch that ended says so in its project's latest conversation (ROADMAP
// "Agents", stage 2): once, by the batch's id, and never at the cost of the
// job that ended it. The agent reads it with the maker's next message; it
// does not start a turn on its own (Luis, 2026-10-30: free work alone, paid
// work on the maker's ok).

// How a batch's jobs ended, once its last one did.
export interface BatchEnd {
  projectId: string | null;
  // A design's batch draws line art, which waits in the studio.
  design?: boolean;
  count: number;
  done: number;
  failed: number;
  canceled: number;
}

// Mark a batch finished when none of its jobs is still queued or running:
// once (null when it was already, or a job of it is still active). Each
// caller checks after its own job's write committed, so the last job to end
// always sees the others ended.
export async function finishBatch(batchId: string): Promise<BatchEnd | null> {
  const marked = await db.$queryRaw<
    { projectId: string | null; count: number; type: string | null }[]
  >`
    UPDATE "GenerationBatch" AS b SET "finishedAt" = now()
    WHERE b."id" = ${batchId} AND b."finishedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "GenerationJob" AS j
        WHERE j."batchId" = b."id" AND j."status" IN ('queued', 'running'))
    RETURNING b."projectId", b."count",
      (SELECT p."type" FROM "Project" AS p WHERE p."id" = b."projectId") AS "type"`;
  if (marked.length === 0) return null;
  const ended = await db.generationJob.groupBy({
    by: ["status"],
    where: { batchId },
    _count: { _all: true },
  });
  const n = (status: string) =>
    ended.find((e) => e.status === status)?._count._all ?? 0;
  return {
    projectId: marked[0].projectId,
    design: marked[0].type === "design",
    count: marked[0].count,
    done: n("done"),
    failed: n("failed"),
    canceled: n("canceled"),
  };
}

export function batchWords(ended: BatchEnd): string {
  const { count, done, failed, canceled, design } = ended;
  const tail = [
    failed ? `${failed} failed` : null,
    canceled ? `${canceled} canceled` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const [one, many, where] = design
    ? ["drawing", "drawings", "in the studio, to vectorize"]
    : ["frame", "frames", "for review on the board"];
  if (done === count) {
    return count === 1
      ? `The ${one} of the last batch landed: it waits ${where}.`
      : `All ${count} ${many} of the last batch landed: they wait ${where}.`;
  }
  return `${done} of ${count} ${many} of the last batch landed${tail ? `, ${tail}` : ""}.`;
}

export async function noteBatchEnd(batchId: string | null): Promise<void> {
  if (!batchId) return;
  try {
    const ended = await finishBatch(batchId);
    if (!ended?.projectId) return;
    await appendChatEvent(
      { projectId: ended.projectId },
      `batch-${batchId}`,
      batchWords(ended),
    );
  } catch (error) {
    console.error("[kiln] could not note a batch's end", error);
  }
}
