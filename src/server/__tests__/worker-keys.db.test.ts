import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SeenCall } from "@/server/__tests__/fixtures/studio-keys";

// The worker, with its real repository and key wiring, runs each queued job
// on the keys of whoever queued it, picked when the job runs (against the
// throwaway Postgres: see project-repository.db.test.ts). Its jobs are in a
// mode of this file's own, so no other worker claims them; the image
// provider is a fake that records the key it was handed, so nothing can pay.
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)(
  "the worker runs each job on its starter's keys (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const fx = await import("@/server/__tests__/fixtures/studio-keys");
    const { projectGenerationState } = await import(
      "@/server/generation-repository"
    );
    type Studio = Awaited<ReturnType<typeof fx.openStudio>>;

    const MODE = `worker-keys-${randomUUID().slice(0, 8)}`;
    const MOCK_MODE = `worker-keys-mock-${randomUUID().slice(0, 8)}`;
    const LEFT =
      "Not run: the person who queued it is no longer on the team, so nothing was spent.";

    const SECRETS = {
      aTeam: "sk-fixture-worker-a-team-000a1",
      aBob: "sk-fixture-worker-a-bob-0000a2",
      bTeam: "sk-fixture-worker-b-team-000b1",
      bBob: "sk-fixture-worker-b-bob-0000b2",
    };
    const ids: Record<string, string> = {};
    const studios: Studio[] = [];
    let a: Studio;
    let b: Studio;
    let projectA = "";
    let projectB = "";

    const open = async (label: string) => {
      const studio = await fx.openStudio(label);
      studios.push(studio);
      return studio;
    };

    beforeAll(async () => {
      a = await open("worker-a");
      b = await open("worker-b");
      ids.aTeam = await fx.writeKey(a, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: SECRETS.aTeam,
      });
      ids.aBob = await fx.writeKey(a, {
        provider: "openai",
        name: "Bob's key",
        secret: SECRETS.aBob,
        people: [a.bob],
      });
      ids.bTeam = await fx.writeKey(b, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: SECRETS.bTeam,
      });
      ids.bBob = await fx.writeKey(b, {
        provider: "openai",
        name: "Bob's key",
        secret: SECRETS.bBob,
        people: [b.bob],
      });
      projectA = await fx.bareProject(a);
      projectB = await fx.bareProject(b);
    });

    afterAll(async () => {
      for (const studio of studios) await fx.closeStudio(studio);
    });

    const run = async (
      options: Omit<Parameters<typeof fx.keysWorker>[0], "mode" | "seen"> & {
        mode?: string;
      } = {},
    ) => {
      const seen: SeenCall[] = [];
      const worker = await fx.keysWorker({ mode: MODE, seen, ...options });
      worker.wake();
      await worker.idle();
      worker.stop();
      return seen;
    };
    const keyOf = (seen: SeenCall[], card: string) =>
      seen.filter((s) => s.card === card).map((s) => s.key);
    const row = (id: string) =>
      db.generationJob.findUniqueOrThrow({ where: { id } });

    it("Bob's job runs on Bob's key, Carla's and a token's on the team's, each studio on its own", async () => {
      const queue = (
        studio: Studio,
        projectId: string,
        cardId: string,
        memberId: string | null,
      ) => fx.queueJob(studio, { mode: MODE, projectId, cardId, memberId });
      const jobs = [
        await queue(a, projectA, "a.bob-1", a.bob.memberId),
        await queue(a, projectA, "a.carla-1", a.carla.memberId),
        await queue(a, projectA, "a.token-1", null),
        await queue(b, projectB, "b.bob-1", b.bob.memberId),
      ];
      const seen = await run();
      expect(keyOf(seen, "a.bob-1")).toEqual([SECRETS.aBob]);
      expect(keyOf(seen, "a.carla-1")).toEqual([SECRETS.aTeam]);
      expect(keyOf(seen, "a.token-1")).toEqual([SECRETS.aTeam]);
      expect(keyOf(seen, "b.bob-1")).toEqual([SECRETS.bBob]);
      for (const id of jobs) expect((await row(id)).status).toBe("done");
      // Studio B's keys reach none of studio A's jobs.
      const aSaw = seen.filter((s) => s.card.startsWith("a."));
      expect(JSON.stringify(aSaw)).not.toMatch(/worker-b/);
    });

    it("the key is picked when the job runs: Bob's job queued before his key was taken away runs on the team's", async () => {
      const studio = await open("worker-away");
      await fx.writeKey(studio, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: "sk-fixture-worker-away-team-01",
      });
      const bobs = await fx.writeKey(studio, {
        provider: "openai",
        name: "Bob's key",
        secret: "sk-fixture-worker-away-bob-002",
        people: [studio.bob],
      });
      const projectId = await fx.bareProject(studio);
      const id = await fx.queueJob(studio, {
        mode: MODE,
        projectId,
        cardId: "away.bob",
        memberId: studio.bob.memberId,
      });
      // Taken away after it was queued, before it runs.
      await db.providerKeyAccess.deleteMany({
        where: { makerId: studio.makerId, keyId: bobs },
      });
      const seen = await run();
      expect(keyOf(seen, "away.bob")).toEqual([
        "sk-fixture-worker-away-team-01",
      ]);
      expect((await row(id)).status).toBe("done");
    });

    it("a job whose starter left the team (a direct delete, as Better Auth's leave does) ends unstarted, at no cost", async () => {
      const studio = await open("worker-left");
      await fx.writeKey(studio, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: "sk-fixture-worker-left-team-01",
      });
      const projectId = await fx.bareProject(studio);
      const id = await fx.queueJob(studio, {
        mode: MODE,
        projectId,
        cardId: "left.bob",
        memberId: studio.bob.memberId,
      });
      await db.member.delete({ where: { id: studio.bob.memberId } });
      const seen = await run();
      expect(keyOf(seen, "left.bob")).toEqual([]);
      const job = await row(id);
      expect(job).toMatchObject({
        status: "failed",
        error: LEFT,
        callStartedAt: null,
        actualMicros: null,
      });
      expect(job.finishedAt).not.toBeNull();
    });

    // Each live call records the key it ran on; the id is never sent to a
    // reader.
    it("each live call records the key it ran on: Bob's his, Carla's and a token's the team's", async () => {
      const queue = (cardId: string, memberId: string | null) =>
        fx.queueJob(a, { mode: MODE, projectId: projectA, cardId, memberId });
      const bob = await queue("a.bob-2", a.bob.memberId);
      const carla = await queue("a.carla-2", a.carla.memberId);
      const token = await queue("a.token-2", null);
      await run();
      expect((await row(bob)).providerKeyId).toBe(ids.aBob);
      expect((await row(carla)).providerKeyId).toBe(ids.aTeam);
      expect((await row(token)).providerKeyId).toBe(ids.aTeam);
    });

    it("a mock job and a job refused before its call record no key", async () => {
      const mock = await fx.queueJob(a, {
        mode: MOCK_MODE,
        projectId: projectA,
        cardId: "a.mock-bob",
        memberId: a.bob.memberId,
      });
      await run({ mode: MOCK_MODE, workerMode: "mock" });
      expect(await row(mock)).toMatchObject({
        status: "done",
        providerKeyId: null,
      });
      // Studio A has no Google key for Carla: refused before the call.
      const refused = await fx.queueJob(a, {
        mode: MODE,
        projectId: projectA,
        cardId: "a.carla-google",
        memberId: a.carla.memberId,
        provider: "google",
      });
      const seen = await run();
      expect(keyOf(seen, "a.carla-google")).toEqual([]);
      expect(await row(refused)).toMatchObject({
        status: "failed",
        error:
          "Not run: the person who queued it has no Google key they can use now, so nothing was spent.",
        callStartedAt: null,
        providerKeyId: null,
      });
    });

    it("a move along a route records the key of the provider it left, and none when none was in reach", async () => {
      const flash = { provider: "google", model: "gemini-3.1-flash-image" };
      const image = { provider: "openai", model: "gpt-image-2" };
      // Bob's OpenAI call answered with an error: it moves to Google.
      const moved = await fx.queueJob(a, {
        mode: MODE,
        projectId: projectA,
        cardId: "a.bob-moves",
        memberId: a.bob.memberId,
        route: { next: [flash], switched: [] },
      });
      // Carla has no Google key: her job moves to OpenAI before any call.
      const keyless = await fx.queueJob(a, {
        mode: MODE,
        projectId: projectA,
        cardId: "a.carla-moves",
        memberId: a.carla.memberId,
        provider: "google",
        route: { next: [image], switched: [] },
      });
      await run({
        fail: (card) =>
          card === "a.bob-moves"
            ? Object.assign(new Error("OpenAI is busy"), { status: 503 })
            : undefined,
      });
      const switchedOf = async (id: string) =>
        ((await row(id)).route as { switched: Record<string, unknown>[] })
          .switched;
      const [left] = await switchedOf(moved);
      expect(left).toMatchObject({
        from: { provider: "openai" },
        keyId: ids.aBob,
      });
      const [none] = await switchedOf(keyless);
      expect(none).toMatchObject({
        from: { provider: "google" },
        reason: "Google has no API key",
      });
      expect(none).toHaveProperty("keyId", null);
      expect(await row(keyless)).toMatchObject({
        status: "done",
        providerKeyId: ids.aTeam,
      });
    });

    it("the state a reader polls carries no key id", async () => {
      for (const reader of [a.as(a.ana), a.as(a.bob), a.as(a.carla), a.as()]) {
        const text = JSON.stringify(
          await projectGenerationState(reader.id, projectA),
        );
        expect(text).toContain("a.bob-2");
        for (const id of Object.values(ids)) expect(text).not.toContain(id);
        expect(text).not.toMatch(/providerKeyId|keyId/);
      }
    });
  },
);
