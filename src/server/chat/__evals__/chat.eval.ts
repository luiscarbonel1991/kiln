import { afterAll, describe, expect, it } from "vitest";
import type { KilnMessage } from "@/server/chat/messages";
import tasks from "./tasks.json";

// The chat agent on a fixed set of tasks (ROADMAP "Agents": an agent is
// measured before it ships): the real text model on a mock run, so images,
// generation and the database are the mock's and nothing but text is paid.
// It prints what the run may cost first, and runs only with KILN_EVAL_YES=1.
// It never approves a call: a task that should spend passes when the agent
// quoted and then asked for the maker's click.

interface Task {
  id: string;
  // The project a task needs: one with scenes waiting, one with a hero to
  // review, or none (the maker's own conversation).
  on: "waiting" | "review" | "maker";
  message: string;
  calls?: string[];
  waits?: string[];
  never?: string[];
  language?: "es" | "en";
}

const SPANISH = /[áéíóúñ¿¡]|\b(el|los|las|del|que|está|están|hay|para|una?)\b/i;

function grade(task: Task, reply: KilnMessage | undefined): string[] {
  if (!reply || reply.role !== "assistant") return ["no reply"];
  const tools = reply.parts
    .filter((p) => p.type.startsWith("tool-"))
    .map((p) => ({
      name: p.type.slice(5),
      state: (p as { state?: string }).state ?? "",
    }));
  const text = reply.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ");
  const failures: string[] = [];
  for (const name of task.calls ?? []) {
    if (!tools.some((t) => t.name === name))
      failures.push(`did not call ${name}`);
  }
  for (const name of task.waits ?? []) {
    if (
      !tools.some((t) => t.name === name && t.state === "approval-requested")
    ) {
      failures.push(`did not ask the maker before ${name}`);
    }
  }
  for (const name of task.never ?? []) {
    if (tools.some((t) => t.name === name && t.state === "output-available")) {
      failures.push(`ran ${name}`);
    }
  }
  if (task.language === "es" && !SPANISH.test(text)) {
    failures.push("did not answer in Spanish");
  }
  if (
    task.language === "en" &&
    SPANISH.test(text) &&
    !/\b(the|is|are)\b/i.test(text)
  ) {
    failures.push("did not answer in English");
  }
  return failures;
}

describe("the chat agent's fixed tasks", async () => {
  const { textRoute } = await import("@/server/text-calls");
  const { MAX_STEPS, runTurn } = await import("@/server/chat/run-turn");
  const route = await textRoute("chatTurn");
  const typical = tasks.length * 3 * (route.typical ?? 0);
  const most = tasks.length * MAX_STEPS * (route.max ?? 0);
  process.stdout.write(
    `[eval] ${tasks.length} tasks on ${route.labels.join(" → ")}: about $${typical.toFixed(2)}, at most $${most.toFixed(2)} of text.\n`,
  );
  if (process.env.KILN_EVAL_YES !== "1") {
    it.skip("runs with KILN_EVAL_YES=1: it calls the real text model", () => {});
    return;
  }

  const { db } = await import("@/lib/db");
  const chats = await import("@/server/chat/chat-repository");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  const maker = await getCurrentMaker();
  // The projects the tasks need, found as the board finds them: scenes
  // waiting to be generated (with the reference), or a hero to review.
  const { projectFrames, waitingProjectFrames } = await import(
    "@/server/project-frames"
  );
  const candidates = await db.project.findMany({
    where: { makerId: maker.id, master: { isNot: null } },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
    take: 40,
  });
  const projects: { waiting?: string; review?: string } = {};
  for (const { id } of candidates) {
    if (!projects.waiting) {
      const w = await waitingProjectFrames(id);
      if (w?.reference && w.waiting.length > 0) projects.waiting = id;
    }
    if (!projects.review) {
      const f = await projectFrames(id);
      if (
        f?.frames.some(
          (x) => x.frame === "etsy.hero" && x.state === "to-review",
        )
      ) {
        projects.review = id;
      }
    }
    if (projects.waiting && projects.review) break;
  }
  // None left waiting (earlier runs generated them): start one, free, as New
  // project does, for a product Kiln already made a reference for.
  if (!projects.waiting) {
    const { startProject } = await import("@/server/start-project");
    const products = await db.projectProduct.findMany({
      where: { projectId: { in: candidates.map((c) => c.id) } },
      select: { productId: true },
      distinct: ["productId"],
    });
    for (const { productId } of products) {
      const started = await startProject({
        productId,
        type: "listing-kit",
        destinationIds: ["etsy"],
      });
      if (!("id" in started)) continue;
      const w = await waitingProjectFrames(started.id);
      if (w?.reference && w.waiting.length > 0) {
        projects.waiting = started.id;
        break;
      }
    }
  }
  const results: { id: string; failures: string[]; costMicros: number }[] = [];

  afterAll(() => {
    const passed = results.filter((r) => r.failures.length === 0).length;
    const spent = results.reduce((t, r) => t + r.costMicros, 0) / 1_000_000;
    for (const r of results) {
      console.log(
        `[eval] ${r.failures.length ? "FAIL" : "pass"} ${r.id}${r.failures.length ? `: ${r.failures.join("; ")}` : ""}`,
      );
    }
    console.log(
      `[eval] ${passed} of ${results.length} passed, $${spent.toFixed(4)} of text.`,
    );
  });

  for (const task of tasks as Task[]) {
    it(task.id, async () => {
      const projectId = task.on === "maker" ? undefined : projects[task.on];
      if (task.on !== "maker" && !projectId) {
        throw new Error(`The mock has no project for "${task.on}".`);
      }
      const { id } = await chats.createChatSession(projectId);
      const response = await runTurn({
        sessionId: id,
        message: {
          id: `eval-${task.id}-${Date.now()}`,
          role: "user",
          parts: [{ type: "text", text: task.message }],
        },
      });
      await response.text();
      for (let i = 0; i < 100 && (await chats.getChat(id))?.running; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const reply = (await chats.getChat(id))?.messages.at(-1);
      const failures = grade(task, reply);
      results.push({
        id: task.id,
        failures,
        costMicros: reply?.metadata?.costMicros ?? 0,
      });
      expect(failures).toEqual([]);
    });
  }
});
