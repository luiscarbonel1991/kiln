// Runs once per server process (Next.js instrumentation). Starts the background
// generation worker in the Node runtime — not in the edge runtime, not during
// `next build` — without awaiting it, so the server is ready at once. The
// worker resumes jobs left by a previous process (expired leases) on its sweep.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { ensureGenerationWorker } = await import("@/server/generation-queue");
  ensureGenerationWorker();
}
