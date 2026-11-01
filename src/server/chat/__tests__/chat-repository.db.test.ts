import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KilnMessage } from "@/server/chat/messages";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("chat sessions (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/chat/chat-repository");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  let maker: { id: string };
  let project: { id: string };
  const made: string[] = [];
  const session = async (projectId?: string) => {
    const created = await repo.createChatSession(projectId);
    made.push(created.id);
    return created;
  };

  const user = (id: string, text: string): KilnMessage => ({
    id,
    role: "user",
    parts: [{ type: "text", text }],
  });

  beforeAll(async () => {
    maker = await getCurrentMaker();
    project = await db.project.create({
      data: {
        makerId: maker.id,
        name: "Chat test",
        type: "listing-kit",
        phase: "generation",
      },
    });
  });

  afterAll(async () => {
    await db.chatSession.deleteMany({ where: { id: { in: made } } });
    await db.project.delete({ where: { id: project.id } });
  });

  it("stores a turn's messages in order, and titles the session from the first", async () => {
    const { id } = await session(project.id);
    await repo.saveChatMessages(id, [
      user("u1", "How are the frames of this planter doing today?"),
    ]);
    const reply: KilnMessage = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "3 of 5 approved." }],
      metadata: { role: "fast", models: ["GPT-6 Luna"], costMicros: 1_200 },
    };
    await repo.saveChatMessages(id, [
      user("u1", "How are the frames of this planter doing today?"),
      reply,
    ]);
    const chat = await repo.getChat(id);
    expect(chat?.title).toBe("How are the frames of this planter doing today?");
    expect(chat?.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(chat?.messages[1].metadata).toEqual(reply.metadata);
    const listed = await repo.listChatSessions({ projectId: project.id });
    expect(listed[0]).toMatchObject({
      id,
      projectName: "Chat test",
      running: false,
    });
  });

  it("a notice is stored once, after the turn's messages, and a later save leaves it", async () => {
    const { id } = await session(project.id);
    await repo.saveChatMessages(id, [user("u1", "generate")]);
    expect(
      await repo.appendChatEvent(
        { projectId: project.id },
        "b1",
        "5 scenes landed.",
      ),
    ).toBe(true);
    expect(
      await repo.appendChatEvent(
        { projectId: project.id },
        "b1",
        "5 scenes landed.",
      ),
    ).toBe(false);
    await repo.saveChatMessages(id, [
      user("u1", "generate"),
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Queued." }],
      },
    ]);
    const chat = await repo.getChat(id);
    expect(chat?.messages.map((m) => m.id)).toEqual(["u1", "event-b1", "a1"]);
  });

  it("one turn holds the session; a lock left by a dead turn is taken over", async () => {
    const { id } = await session();
    expect(await repo.lockChat(id)).toEqual({ locked: true, stale: false });
    expect(await repo.lockChat(id)).toEqual({ locked: false, stale: false });
    expect((await repo.getChat(id))?.running).toBe(true);
    const later = new Date(Date.now() + (repo.LOCK_MINUTES + 1) * 60_000);
    expect(await repo.lockChat(id, later)).toEqual({
      locked: true,
      stale: true,
    });
    await repo.unlockChat(id);
    expect((await repo.getChat(id))?.running).toBe(false);
  });

  it("knows a conversation of the maker's without reading it", async () => {
    const { id } = await session();
    expect(await repo.chatOwned(id)).toBe(true);
    expect(await repo.chatOwned("no-such-chat")).toBe(false);
  });

  it("refuses a project that is not there", async () => {
    await expect(repo.createChatSession("no-such-project")).rejects.toThrow(
      "That project no longer exists.",
    );
  });
});
