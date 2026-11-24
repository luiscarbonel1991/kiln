import { randomUUID } from "node:crypto";
import type { ProviderId } from "@/domain/model-defaults";
import type { WorkerDeps } from "@/server/generation-worker";
import type { MakerRef } from "@/server/maker-repository";

// A studio for the key database tests: an organization, its maker, an owner
// (Ana Ruiz) and two members (Bob Ruiz, Carla Ruiz), the rows team.db.test.ts
// makes in its beforeAll. Keys are written in the new shape, sealed with
// secret-box under the test's KILN_SECRET_KEY; nothing here can reach a
// provider. The database is imported lazily: a file that imports this
// fixture still loads without one.

export interface Person {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: "owner" | "member";
}

export interface Studio {
  label: string;
  makerId: string;
  organizationId: string;
  ana: Person;
  bob: Person;
  carla: Person;
  // The maker as a session hands it down (with the person), or as a token
  // does (no person).
  as(person?: Person): MakerRef;
}

const people = ["Ana Ruiz", "Bob Ruiz", "Carla Ruiz"] as const;

export async function openStudio(label: string): Promise<Studio> {
  const { db } = await import("@/lib/db");
  const stamp = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  await db.organization.create({
    data: {
      id: organizationId,
      name: `Keys ${label}`,
      slug: `keys-${label}-${stamp}`,
      createdAt: new Date(),
    },
  });
  const maker = await db.maker.create({
    data: {
      slug: `keys-${label}-${stamp}`,
      name: `Keys ${label}`,
      organizationId,
      monthlyCapCents: 10_000,
    },
  });
  const made: Person[] = [];
  for (const [i, name] of people.entries()) {
    const person: Person = {
      memberId: randomUUID(),
      userId: randomUUID(),
      name,
      email: `${name.split(" ")[0].toLowerCase()}-${label}-${stamp}@kiln.test`,
      role: i === 0 ? "owner" : "member",
    };
    await db.user.create({
      data: { id: person.userId, name: person.name, email: person.email },
    });
    await db.member.create({
      data: {
        id: person.memberId,
        organizationId,
        userId: person.userId,
        role: person.role,
        // In order, so the owner is the oldest.
        createdAt: new Date(Date.now() + i),
      },
    });
    made.push(person);
  }
  const [ana, bob, carla] = made;
  return {
    label,
    makerId: maker.id,
    organizationId,
    ana,
    bob,
    carla,
    as: (person) =>
      person
        ? {
            id: maker.id,
            member: {
              id: person.memberId,
              userId: person.userId,
              role: person.role,
            },
          }
        : { id: maker.id },
  };
}

export async function closeStudio(studio: Studio | undefined): Promise<void> {
  if (!studio) return;
  const { db } = await import("@/lib/db");
  await db.generationJob.deleteMany({ where: { makerId: studio.makerId } });
  await db.generationBatch.deleteMany({ where: { makerId: studio.makerId } });
  await db.project.deleteMany({ where: { makerId: studio.makerId } });
  await db.maker.deleteMany({ where: { id: studio.makerId } });
  await db.organization.deleteMany({ where: { id: studio.organizationId } });
  await db.user.deleteMany({
    where: {
      id: { in: [studio.ana, studio.bob, studio.carla].map((p) => p.userId) },
    },
  });
}

// A key row in the new shape: for the whole team, or given to people. A key
// sealed under another purpose stands for one KILN_SECRET_KEY cannot read.
export async function writeKey(
  studio: Studio,
  key: {
    provider: ProviderId;
    name: string;
    secret: string;
    forTeam?: boolean;
    people?: Person[];
    unreadable?: boolean;
  },
): Promise<string> {
  const { db } = await import("@/lib/db");
  const { seal } = await import("@/server/secret-box");
  const row = await db.providerKey.create({
    data: {
      makerId: studio.makerId,
      provider: key.provider,
      name: key.name,
      forTeam: key.forTeam ?? false,
      sealed: seal(
        key.secret,
        key.unreadable ? "not-this-purpose" : `provider-key:${key.provider}`,
      ),
      hint: key.secret.slice(-4),
    },
    select: { id: true },
  });
  for (const person of key.people ?? []) {
    await db.providerKeyAccess.create({
      data: {
        makerId: studio.makerId,
        keyId: row.id,
        provider: key.provider,
        memberId: person.memberId,
      },
    });
  }
  return row.id;
}

// A project with no plan, enough for a queued job to be claimed (the queue
// claims only jobs that have a project).
export async function bareProject(studio: Studio): Promise<string> {
  const { db } = await import("@/lib/db");
  const project = await db.project.create({
    data: {
      makerId: studio.makerId,
      name: `Keys ${studio.label}`,
      type: "listing-kit",
      phase: "generation",
    },
    select: { id: true },
  });
  return project.id;
}

export const imageRequest = (
  provider: ProviderId = "openai",
  prompt = "a scene",
  model = provider === "openai" ? "gpt-image-2" : "gemini-3.1-flash-image",
) => ({
  kind: "image" as const,
  masterAssetUrl: "https://stub.local/plate.png",
  prompt,
  imageInputs: [],
  negative: "",
  model: { provider, model, aspect: "1:1", guidance: 7.5, strength: 0.65 },
});

// A job queued straight into the table, in its own batch (the poll reads
// only batched jobs), in a mode of the test's own so no other worker claims
// it.
export async function queueJob(
  studio: Studio,
  input: {
    mode: string;
    projectId: string;
    cardId: string;
    memberId: string | null;
    provider?: ProviderId;
    route?: unknown;
  },
): Promise<string> {
  const { db } = await import("@/lib/db");
  const request = imageRequest(input.provider, input.cardId);
  const batch = await db.generationBatch.create({
    data: {
      makerId: studio.makerId,
      projectId: input.projectId,
      mode: input.mode,
      count: 1,
      estimateMicros: 1,
      model: request.model.model,
    },
    select: { id: true },
  });
  const row = await db.generationJob.create({
    data: {
      batchId: batch.id,
      makerId: studio.makerId,
      projectId: input.projectId,
      cardId: input.cardId,
      mode: input.mode,
      status: "queued",
      maxAttempts: 2,
      estimateMicros: 1,
      // The prompt names the card, so the fake provider can say which job
      // it ran.
      request,
      ...(input.route ? { route: input.route as object } : {}),
      memberId: input.memberId,
    },
    select: { id: true },
  });
  return row.id;
}

export interface SeenCall {
  card: string;
  provider: ProviderId;
  key: string | undefined;
}

// The worker with its real repository and key wiring, as
// ensureGenerationWorker builds it, but claiming only `mode`'s jobs (live by
// default), with a fake image provider that records the key it was handed at
// the call. `hold` keeps a call open until released (a running job); `fail`
// answers a card's call with an error the provider answered.
export async function keysWorker(options: {
  mode: string;
  seen: SeenCall[];
  workerMode?: "live" | "mock";
  hold?: Promise<void>;
  onCall?: (card: string) => void;
  fail?: (card: string) => Error | undefined;
}) {
  const repo = await import("@/server/generation-repository");
  const { createWorker } = await import("@/server/generation-worker");
  const keys = await import("@/providers/keys");
  const providerKeys = (await import("@/server/provider-keys")) as Record<
    string,
    unknown
  >;
  const editBytes = async (
    input: { prompt: string; model: { provider: ProviderId; model: string } },
    call: { beforeCall?: () => Promise<void> },
  ) => {
    await call.beforeCall?.();
    const provider = input.model.provider;
    options.seen.push({
      card: input.prompt,
      provider,
      key: keys.providerKey(provider),
    });
    options.onCall?.(input.prompt);
    await options.hold;
    const failure = options.fail?.(input.prompt);
    if (failure) throw failure;
    return {
      bytes: new Uint8Array([1]),
      mime: "image/png",
      model: input.model.model,
      usage: { inputTextTokens: 1, inputImageTokens: 1, outputTokens: 1 },
    };
  };
  const deps = {
    mode: options.workerMode ?? "live",
    asMaker: providerKeys.withStarterKeys,
    keyInReach: keys.hasProviderKey,
    keyId: (keys as Record<string, unknown>).providerKeyId,
    concurrency: 1,
    leaseSec: 60,
    renewMs: 60_000,
    sweepMs: 60_000,
    callTimeoutMs: 10_000,
    claimJobs: (_mode: unknown, limit: number, leaseSec: number) =>
      repo.claimJobs(options.mode as never, limit, leaseSec),
    renewLease: repo.renewLease,
    markCallStarted: repo.markCallStarted,
    recordCost: repo.recordCost,
    completeJob: repo.completeJob,
    failJob: repo.failJob,
    requeueExpired: async () => 0,
    fallBack: repo.fallBackJob,
    runnable: () => true,
    overCap: async () => false,
    provider: (id: ProviderId) => ({ id, editBytes }),
    videoProvider: () => undefined,
    storeAsset: async () => "https://stub.local/keys.png",
    log: () => {},
  } as unknown as WorkerDeps;
  return createWorker(deps);
}
