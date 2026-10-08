import { afterEach, describe, expect, it, vi } from "vitest";

const started = vi.hoisted(
  () => [] as { wake: () => void; stop: () => void }[],
);

vi.mock("@/server/generation-worker", () => ({
  createWorker: () => {
    const worker = {
      wake: vi.fn(),
      stop: vi.fn(),
      active: () => 0,
      idle: async () => {},
    };
    started.push(worker);
    return worker;
  },
}));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasDatabase: () => true,
}));

const slot = globalThis as {
  kilnGenerationWorker?: unknown;
  kilnGenerationWorkerCode?: unknown;
};

describe("ensureGenerationWorker", () => {
  afterEach(() => {
    delete slot.kilnGenerationWorker;
    delete slot.kilnGenerationWorkerCode;
  });

  it("keeps one worker per code; after a code reload it stops the old one and starts another", async () => {
    const first = await import("@/server/generation-queue");
    const worker = first.ensureGenerationWorker();
    expect(first.ensureGenerationWorker()).toBe(worker);
    expect(started).toHaveLength(1);

    vi.resetModules();
    const reloaded = await import("@/server/generation-queue");
    const next = reloaded.ensureGenerationWorker();
    expect(next).not.toBe(worker);
    expect(started[0].stop).toHaveBeenCalledOnce();
    expect(reloaded.ensureGenerationWorker()).toBe(next);
    expect(started).toHaveLength(2);
  });
});
