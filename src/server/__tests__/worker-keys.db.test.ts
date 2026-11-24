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
    type Studio = Awaited<ReturnType<typeof fx.openStudio>>;

    const MODE = `worker-keys-${randomUUID().slice(0, 8)}`;
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
  },
);
