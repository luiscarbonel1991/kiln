import type { Prisma } from "@prisma/client";
import { assertDatabaseUrl, db } from "@/lib/db";
import {
  ChatMetadata,
  EVENT_PREFIX,
  type KilnMessage,
} from "@/server/chat/messages";
import { getCurrentMaker } from "@/server/maker-repository";

// The chat's sessions and messages, scoped to the current maker. A session
// holds a lock while a turn runs; a message is stored as the chat shows it, and
// keeps its place (`seq`) once stored.

export const NEW_TITLE = "New conversation";
export const LOCK_MINUTES = 10;

export interface ChatSessionView {
  id: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  updatedAt: string;
  running: boolean;
}

export interface StoredChat {
  id: string;
  title: string;
  projectId: string | null;
  running: boolean;
  messages: KilnMessage[];
}

const lockFresh = (lockedAt: Date | null, now = new Date()) =>
  lockedAt !== null &&
  now.getTime() - lockedAt.getTime() < LOCK_MINUTES * 60_000;

export async function createChatSession(
  projectId?: string,
): Promise<{ id: string }> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  if (projectId) {
    const project = await db.project.findFirst({
      where: { id: projectId, makerId: maker.id },
      select: { id: true },
    });
    if (!project) throw new Error("That project no longer exists.");
  }
  return db.chatSession.create({
    data: { makerId: maker.id, projectId: projectId ?? null, title: NEW_TITLE },
    select: { id: true },
  });
}

export async function listChatSessions(
  filter: { projectId?: string } = {},
  take = 50,
): Promise<ChatSessionView[]> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const rows = await db.chatSession.findMany({
    where: {
      makerId: maker.id,
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      id: true,
      title: true,
      projectId: true,
      lockedAt: true,
      updatedAt: true,
      project: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    projectId: r.projectId,
    projectName: r.project?.name ?? null,
    updatedAt: r.updatedAt.toISOString(),
    running: lockFresh(r.lockedAt),
  }));
}

function messageOf(row: {
  messageId: string;
  role: string;
  parts: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
}): KilnMessage {
  const metadata = ChatMetadata.safeParse(row.metadata ?? undefined);
  return {
    id: row.messageId,
    role: row.role as KilnMessage["role"],
    parts: row.parts as KilnMessage["parts"],
    ...(metadata.success && row.metadata ? { metadata: metadata.data } : {}),
  };
}

// Whether a conversation is the current maker's, without reading it.
export async function chatOwned(id: string): Promise<boolean> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const session = await db.chatSession.findFirst({
    where: { id, makerId: maker.id },
    select: { id: true },
  });
  return session !== null;
}

export async function getChat(id: string): Promise<StoredChat | null> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const session = await db.chatSession.findFirst({
    where: { id, makerId: maker.id },
    select: {
      id: true,
      title: true,
      projectId: true,
      lockedAt: true,
      messages: {
        orderBy: [{ seq: "asc" }, { createdAt: "asc" }],
        select: { messageId: true, role: true, parts: true, metadata: true },
      },
    },
  });
  if (!session) return null;
  return {
    id: session.id,
    title: session.title,
    projectId: session.projectId,
    running: lockFresh(session.lockedAt),
    messages: session.messages.map(messageOf),
  };
}

// Take the session for one turn: refused while another turn holds it. A lock
// older than LOCK_MINUTES is a turn that died, and is taken over (`stale`).
export async function lockChat(
  id: string,
  now = new Date(),
): Promise<{ locked: boolean; stale: boolean }> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const expired = new Date(now.getTime() - LOCK_MINUTES * 60_000);
  const before = await db.chatSession.findFirst({
    where: { id, makerId: maker.id },
    select: { lockedAt: true },
  });
  if (!before) return { locked: false, stale: false };
  const { count } = await db.chatSession.updateMany({
    where: {
      id,
      makerId: maker.id,
      OR: [{ lockedAt: null }, { lockedAt: { lt: expired } }],
    },
    data: { lockedAt: now },
  });
  return {
    locked: count === 1,
    stale: count === 1 && before.lockedAt !== null,
  };
}

export async function unlockChat(id: string): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.chatSession.updateMany({
    where: { id, makerId: maker.id },
    data: { lockedAt: null },
  });
}

function titleOf(messages: KilnMessage[]): string | null {
  const first = messages.find((m) => m.role === "user");
  const text = first?.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

// Store a turn's messages: each one by its id, a new one after the last
// stored, one already stored in its place. Messages stored apart from the
// turn (Kiln's notices) are left as they are.
export async function saveChatMessages(
  sessionId: string,
  messages: KilnMessage[],
): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.$transaction(async (tx) => {
    const session = await tx.chatSession.findFirst({
      where: { id: sessionId, makerId: maker.id },
      select: { title: true },
    });
    if (!session) throw new Error("That conversation no longer exists.");
    const existing = await tx.chatMessage.findMany({
      where: { sessionId },
      select: { messageId: true, seq: true },
    });
    const known = new Set(existing.map((m) => m.messageId));
    let next = existing.reduce((max, m) => Math.max(max, m.seq), -1) + 1;
    for (const message of messages) {
      const data = {
        role: message.role,
        parts: message.parts as Prisma.InputJsonValue,
        metadata: (message.metadata ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
      };
      if (known.has(message.id)) {
        await tx.chatMessage.update({
          where: { sessionId_messageId: { sessionId, messageId: message.id } },
          data,
        });
      } else {
        await tx.chatMessage.create({
          data: { ...data, sessionId, messageId: message.id, seq: next },
        });
        known.add(message.id);
        next += 1;
      }
    }
    const title = session.title === NEW_TITLE ? titleOf(messages) : null;
    await tx.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date(), ...(title ? { title } : {}) },
    });
  });
}

// A notice from Kiln, stored once by its key: in a conversation, or in a
// project's latest one (a batch that finished). Nothing when the project has
// no chat.
export async function appendChatEvent(
  target: { sessionId: string } | { projectId: string },
  key: string,
  text: string,
): Promise<boolean> {
  assertDatabaseUrl();
  const session =
    "sessionId" in target
      ? { id: target.sessionId }
      : await db.chatSession.findFirst({
          where: { projectId: target.projectId },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });
  if (!session) return false;
  const messageId = `${EVENT_PREFIX}${key}`;
  const last = await db.chatMessage.findFirst({
    where: { sessionId: session.id },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const created = await db.chatMessage.createMany({
    data: [
      {
        sessionId: session.id,
        messageId,
        seq: (last?.seq ?? -1) + 1,
        role: "assistant",
        parts: [{ type: "data-kiln-event", data: { text } }],
      },
    ],
    skipDuplicates: true,
  });
  return created.count === 1;
}
