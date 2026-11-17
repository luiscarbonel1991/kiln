import type { Lesson as LessonRow } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  agreedStop,
  familyKey,
  type LessonMove,
  LessonMove as LessonMoveSchema,
  LessonSource,
  LessonStatus,
  LessonTopic,
  sceneLessonKey,
  sceneLessonText,
} from "@/domain/lesson";
import {
  changedFrames,
  compareReads,
  comparisonLine,
  latestAfter,
} from "@/domain/listing-results";
import type { SlotRef } from "@/domain/plan";
import {
  effectiveKnobs,
  type KnobChoice,
  KnobKey,
  knobSummary,
  type ReasonKey,
} from "@/domain/scene-knobs";
import { db } from "@/lib/db";
import { CATALOG } from "@/lib/recipes";
import { appendChatEvent } from "@/server/chat/chat-repository";
import type { MakerRef } from "@/server/maker-repository";
import { loadProjectBoard } from "@/server/project-repository";

// The maker's lessons. Kiln records what the maker does on the board that says
// something of their taste (a reason given for a take, a take approved with a
// knob they set) and proposes a lesson when two of their choices agree on a
// frame's knob for a product family, or when a listing's after-read shows a
// change worth a sentence. An agent may propose one too. A lesson counts only
// once the maker keeps it: then every agent reads it, and a scene lesson starts
// that frame's knob in new projects of the family. Nothing here is paid, and
// none of it fails the action that taught it.

export interface LessonView {
  id: string;
  family: string | null;
  topic: LessonTopic;
  text: string;
  source: LessonSource;
  status: LessonStatus;
  move: LessonMove | null;
  evidence: number;
  createdAt: string;
  decidedAt: string | null;
}

function view(row: LessonRow): LessonView {
  const move = LessonMoveSchema.safeParse(row.move);
  return {
    id: row.id,
    family: row.family,
    topic: LessonTopic.catch("general").parse(row.topic),
    text: row.text,
    source: LessonSource.catch("agent").parse(row.source),
    status: LessonStatus.catch("proposed").parse(row.status),
    move: move.success ? move.data : null,
    evidence: Array.isArray(row.evidence) ? row.evidence.length : 0,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

const destinationName = (id: string) =>
  CATALOG.destinations.find((d) => d.id === id)?.name ?? id;

// The lessons of the maker, newest first: by status, for a family (with
// those for every family), on some topics.
export async function listLessons(
  maker: MakerRef,
  filter: {
    status?: LessonStatus[];
    family?: string | null;
    topics?: LessonTopic[] | null;
  } = {},
): Promise<LessonView[]> {
  const rows = await db.lesson.findMany({
    where: {
      makerId: maker.id,
      ...(filter.status ? { status: { in: filter.status } } : {}),
      ...(filter.family !== undefined
        ? {
            OR: [
              { family: null },
              ...(filter.family ? [{ family: familyKey(filter.family) }] : []),
            ],
          }
        : {}),
      ...(filter.topics ? { topic: { in: filter.topics } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return rows.map(view);
}

// The kept lessons an agent follows: for the conversation's family (and
// every family), on its mode's topics.
export async function keptLessons(
  maker: MakerRef,
  family: string | null,
  topics: LessonTopic[] | null,
): Promise<LessonView[]> {
  return listLessons(maker, { status: ["kept"], family, topics });
}

// The knobs the maker's kept scene lessons set for a family: a new project
// of the family starts its frames with them (withLearned).
export async function keptMoves(
  maker: MakerRef,
  family: string,
): Promise<LessonMove[]> {
  const rows = await db.lesson.findMany({
    where: {
      makerId: maker.id,
      status: "kept",
      family: familyKey(family),
      move: { not: Prisma.DbNull },
    },
    select: { move: true },
  });
  return rows.flatMap((r) => {
    const move = LessonMoveSchema.safeParse(r.move);
    return move.success ? [move.data] : [];
  });
}

// The status of the maker's lessons named, by id (a chat shows each one an
// agent proposed as it stands now).
export async function lessonStatuses(
  maker: MakerRef,
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const rows = await db.lesson.findMany({
    where: { id: { in: ids }, makerId: maker.id },
    select: { id: true, status: true },
  });
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

// The maker keeps a lesson, or sets it aside (a kept one too: it stops
// counting). Null when it is not theirs.
export async function decideLesson(
  maker: MakerRef,
  id: string,
  status: "kept" | "dismissed",
): Promise<LessonView | null> {
  const changed = await db.lesson.updateMany({
    where: { id, makerId: maker.id },
    data: { status, decidedAt: new Date() },
  });
  if (changed.count === 0) return null;
  return view(await db.lesson.findUniqueOrThrow({ where: { id } }));
}

// A lesson an agent proposes in words; the maker keeps it or not.
export async function proposeLesson(
  maker: MakerRef,
  input: {
    topic: LessonTopic;
    text: string;
    family?: string | null;
  },
): Promise<LessonView> {
  const row = await db.lesson.create({
    data: {
      makerId: maker.id,
      key: `agent:${crypto.randomUUID()}`,
      family: input.family ? familyKey(input.family) : null,
      topic: input.topic,
      text: input.text,
      source: "agent",
    },
  });
  return view(row);
}

async function announce(projectId: string, lesson: LessonView, key: string) {
  await appendChatEvent(
    { projectId },
    `lesson-${key}`,
    `Kiln proposes a lesson: ${lesson.text} Keep it or not in Settings → Lessons.`,
  );
}

// A frame's scene and the product's family, as the signals record them.
async function sceneOf(maker: MakerRef, projectId: string, ref: SlotRef) {
  const loaded = await loadProjectBoard(maker, projectId);
  const family = loaded?.product?.family?.trim();
  const slot = loaded?.board.plan?.destinations
    .find((d) => d.destinationId === ref.destinationId)
    ?.slots.find((s) => s.key === ref.slotKey);
  if (!family || !slot || slot.fill !== "scene") return null;
  return { family, slot };
}

// Propose (or grow) the lesson the maker's choices on a frame's knob agree
// on, for the family. A lesson the maker decided comes back as a proposal
// only when their choices moved to another stop.
async function proposeFromTaste(input: {
  makerId: string;
  projectId: string;
  family: string;
  ref: SlotRef;
  slotLabel: string;
  knob: KnobKey;
}): Promise<void> {
  const { makerId, projectId, family, ref, slotLabel, knob } = input;
  const signals = await db.tasteSignal.findMany({
    where: {
      makerId,
      family: familyKey(family),
      destinationId: ref.destinationId,
      slotKey: ref.slotKey,
      knob,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const agreed = agreedStop(
    signals.map((s) => ({
      kind: s.kind === "approval" ? ("approval" as const) : ("reason" as const),
      reason: s.reason,
      stop: s.stop,
    })),
  );
  if (!agreed) return;
  const move = { ...ref, knob, stop: agreed.stop };
  const key = sceneLessonKey(family, move);
  const text = sceneLessonText({
    family,
    destination: destinationName(ref.destinationId),
    slot: slotLabel,
    knob,
    agreed,
  });
  const evidence = signals
    .filter((s) => s.stop === agreed.stop)
    .map((s) => ({
      projectId: s.projectId,
      kind: s.kind,
      ...(s.reason ? { reason: s.reason } : {}),
      at: s.createdAt.toISOString(),
    }));
  const existing = await db.lesson.findUnique({
    where: { makerId_key: { makerId, key } },
  });
  const moved =
    existing !== null &&
    LessonMoveSchema.safeParse(existing.move).data?.stop !== agreed.stop;
  const fresh = existing === null || (moved && existing.status !== "proposed");
  const row = await db.lesson.upsert({
    where: { makerId_key: { makerId, key } },
    create: {
      makerId,
      key,
      family: familyKey(family),
      topic: "scenes",
      text,
      move,
      source: "taste",
      evidence,
    },
    update: {
      evidence,
      ...(existing?.status === "proposed" || moved ? { text, move } : {}),
      ...(fresh ? { status: "proposed", decidedAt: null } : {}),
    },
  });
  if (fresh) await announce(projectId, view(row), `${row.id}-${agreed.stop}`);
}

// The maker gave a reason for a take and it moved a knob: one vote for the
// stop it moved to.
export async function noteReason(
  maker: MakerRef,
  projectId: string,
  ref: SlotRef,
  reason: ReasonKey,
  move: KnobChoice,
): Promise<void> {
  try {
    if (move.stop === null || move.stop === "any") return;
    const scene = await sceneOf(maker, projectId, ref);
    if (!scene) return;
    await db.tasteSignal.create({
      data: {
        makerId: maker.id,
        projectId,
        family: familyKey(scene.family),
        ...ref,
        slotLabel: scene.slot.label,
        kind: "reason",
        reason,
        knob: move.knob,
        stop: move.stop,
      },
    });
    await proposeFromTaste({
      makerId: maker.id,
      projectId,
      family: scene.family,
      ref,
      slotLabel: scene.slot.label,
      knob: move.knob,
    });
  } catch (error) {
    console.error("[kiln] could not note a reason's taste", error);
  }
}

// The maker approved a scene's take: one vote for each knob they set on it,
// once per project and stop (approving again after an undo adds nothing).
export async function noteApproval(
  maker: MakerRef,
  projectId: string,
  ref: SlotRef,
): Promise<void> {
  try {
    const scene = await sceneOf(maker, projectId, ref);
    const tuned = KnobKey.options.flatMap((knob) => {
      const stop = scene?.slot.tuned?.[knob];
      return stop && stop !== "any" ? [[knob, stop] as const] : [];
    });
    if (!scene || tuned.length === 0) return;
    for (const [knob, stop] of tuned) {
      const where = {
        makerId: maker.id,
        projectId,
        ...ref,
        kind: "approval",
        knob,
        stop,
      };
      if (await db.tasteSignal.findFirst({ where, select: { id: true } })) {
        continue;
      }
      await db.tasteSignal.create({
        data: {
          ...where,
          family: familyKey(scene.family),
          slotLabel: scene.slot.label,
        },
      });
      await proposeFromTaste({
        makerId: maker.id,
        projectId,
        family: scene.family,
        ref,
        slotLabel: scene.slot.label,
        knob,
      });
    }
  } catch (error) {
    console.error("[kiln] could not note an approval's taste", error);
  }
}

// A delivered listing's after-read against its before, when it has enough
// visits to tell: a sentence on which frames came with which change, for
// the family. One per project and destination; a later read rewrites it.
export async function noteRead(
  maker: MakerRef,
  projectId: string,
  destinationId: string,
): Promise<void> {
  try {
    const loaded = await loadProjectBoard(maker, projectId);
    const family = loaded?.product?.family?.trim();
    const destination = loaded?.board.plan?.destinations.find(
      (d) => d.destinationId === destinationId,
    );
    const before = destination?.results?.reads.before;
    const after = latestAfter(destination?.results);
    if (!loaded || !family || !destination || !before || !after) return;
    const comparison = compareReads(before, after);
    const line = comparisonLine(comparison);
    if (comparison.thin || !line) return;
    const frames = changedFrames(destination).map((f) => {
      const slot = destination.slots.find((s) => s.key === f.key);
      const summary = slot?.knobs
        ? knobSummary(
            effectiveKnobs(slot.knobs, slot.tuned, undefined, slot.learned),
          )
        : "";
      return summary ? `${f.label} (${summary.toLowerCase()})` : f.label;
    });
    if (frames.length === 0) return;
    const days = destination.results?.reads.day30 ? 30 : 14;
    const text = `${family}, ${destinationName(destinationId)}: after the new ${frames.join(", ")}, the first ${days} days showed ${line} (${loaded.board.name}).`;
    const key = `read:${projectId}:${destinationId}`;
    const evidence = [
      {
        projectId,
        destinationId,
        days,
        rows: comparison.rows.map((r) => ({
          metric: r.metric,
          before: r.before,
          after: r.after,
          change: r.change,
        })),
      },
    ];
    const existing = await db.lesson.findUnique({
      where: { makerId_key: { makerId: maker.id, key } },
      select: { id: true },
    });
    const row = await db.lesson.upsert({
      where: { makerId_key: { makerId: maker.id, key } },
      create: {
        makerId: maker.id,
        key,
        family: familyKey(family),
        topic: "scenes",
        text,
        source: "read",
        evidence,
      },
      update: { text, evidence },
    });
    if (!existing) await announce(projectId, view(row), row.id);
  } catch (error) {
    console.error("[kiln] could not note a read's lesson", error);
  }
}
