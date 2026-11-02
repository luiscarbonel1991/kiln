import { afterAll, describe, expect, it } from "vitest";

// Against a migrated throwaway Postgres (see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("provider health (database)", async () => {
  const { db } = await import("@/lib/db");
  const { providerHealth } = await import("@/server/provider-health");
  const { CAP_REACHED } = await import("@/server/generation-worker");
  const { recordKeyCheck, budget, readUnlisted } = await import(
    "@/server/generation-repository"
  );
  const slug = `health-${Date.now()}`;
  let makerId = "";

  afterAll(async () => {
    if (!makerId) return;
    await db.generationJob.deleteMany({ where: { makerId } });
    await db.maker.delete({ where: { id: makerId } });
  });

  const row = (
    request: object,
    status: "done" | "failed",
    minutesAgo: number,
    error?: string,
  ) =>
    db.generationJob.create({
      data: {
        makerId,
        cardId: "direct",
        mode: "live",
        status,
        attempt: 1,
        maxAttempts: 1,
        estimateMicros: 1,
        request,
        error,
        finishedAt: new Date(Date.now() - minutesAgo * 60_000),
      },
    });

  it("shows a provider's last error until a later call succeeds; Kiln's own refusals are skipped", async () => {
    const maker = await db.maker.create({ data: { slug, name: "Health" } });
    makerId = maker.id;
    const google = {
      kind: "direct",
      provider: "google",
      model: "gemini-3.5-flash",
    };
    const openai = {
      kind: "image",
      model: { provider: "openai", model: "gpt-image-2" },
    };
    await row(google, "done", 60);
    await row(
      google,
      "failed",
      10,
      "Google is at its spend cap — raise it at ai.studio/spend or use OpenAI.",
    );
    await row(openai, "failed", 30, "OpenAI is rate-limiting requests");
    await row(openai, "done", 5);
    await row(openai, "failed", 1, CAP_REACHED);

    const [o, g] = await providerHealth(makerId);
    expect(g).toMatchObject({
      provider: "google",
      label: "Google",
      lastError: {
        message:
          "Google is at its spend cap — raise it at ai.studio/spend or use OpenAI.",
      },
    });
    expect(g.lastOkAt).not.toBeNull();
    // A spend cap may pass; only a rejected key blocks the next call.
    expect(g.keyRejected).toBe(false);
    expect(o).toMatchObject({ provider: "openai", lastError: null });
    expect(typeof o.keyPresent).toBe("boolean");

    // A row stored with Google's raw body (before its words were read out).
    await row(
      google,
      "failed",
      0,
      '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}',
    );
    const [, raw] = await providerHealth(makerId);
    expect(raw.lastError?.message).toBe(
      "Google rejected the API key — check GOOGLE_API_KEY or use OpenAI.",
    );
    expect(raw.keyRejected).toBe(true);

    // The key replaced and checked from Settings: the error clears, and the
    // check costs nothing.
    const before = (await budget(makerId)).spentMicros;
    await new Promise((r) => setTimeout(r, 5));
    await recordKeyCheck({ makerId, provider: "google", error: null });
    const [, checked] = await providerHealth(makerId);
    expect(checked.lastError).toBeNull();
    expect(checked.keyRejected).toBe(false);
    expect((await budget(makerId)).spentMicros).toBe(before);
    // A check the provider refuses shows as its error.
    await new Promise((r) => setTimeout(r, 5));
    await recordKeyCheck({
      makerId,
      provider: "google",
      error:
        "Google rejected the API key (400) — check GOOGLE_API_KEY or use OpenAI.",
    });
    const [, refused] = await providerHealth(makerId);
    expect(refused.lastError?.message).toBe(
      "Google rejected the API key (400) — check GOOGLE_API_KEY or use OpenAI.",
    );
    expect(refused.keyRejected).toBe(true);
  });

  it("a move down a route counts as a failure of the provider it left", async () => {
    const at = new Date().toISOString();
    await db.generationJob.create({
      data: {
        makerId,
        cardId: "q.moved",
        mode: "live",
        status: "done",
        attempt: 1,
        maxAttempts: 3,
        estimateMicros: 1,
        request: {
          kind: "image",
          model: { provider: "google", model: "gemini-3.1-flash-image" },
        },
        route: {
          next: [],
          switched: [
            {
              from: { provider: "openai", model: "gpt-image-2" },
              to: { provider: "google", model: "gemini-3.1-flash-image" },
              reason: "OpenAI answered 503",
              at,
            },
          ],
        },
        finishedAt: new Date(),
      },
    });
    const [o, g] = await providerHealth(makerId);
    expect(o.lastError?.message).toBe("OpenAI answered 503");
    expect(g.lastError).toBeNull();
  });
  it("keeps what a key check found its provider no longer lists; the latest check wins", async () => {
    expect(await readUnlisted(makerId)).toEqual({});
    await new Promise((r) => setTimeout(r, 5));
    await recordKeyCheck({
      makerId,
      provider: "google",
      error: null,
      // A model Kiln has retired since is left out: it is refused anyway.
      unlisted: [
        "gemini-3.1-flash-lite-image",
        "veo-3.1-fast-generate-preview",
      ],
    });
    const found = await readUnlisted(makerId);
    expect(found.google?.models).toEqual(["gemini-3.1-flash-lite-image"]);
    expect(found.openai).toBeUndefined();
    const [, g] = await providerHealth(makerId);
    expect(g.unlisted?.models).toEqual(["gemini-3.1-flash-lite-image"]);
    // A refused check lists nothing, so it leaves the last list in place.
    await new Promise((r) => setTimeout(r, 5));
    await recordKeyCheck({ makerId, provider: "google", error: "rejected" });
    expect((await readUnlisted(makerId)).google?.models).toEqual([
      "gemini-3.1-flash-lite-image",
    ]);
    // A later check that lists every offered model clears it.
    await new Promise((r) => setTimeout(r, 5));
    await recordKeyCheck({
      makerId,
      provider: "google",
      error: null,
      unlisted: [],
    });
    expect(await readUnlisted(makerId)).toEqual({});
  });
});
