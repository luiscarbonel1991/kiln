import { expect, vi } from "vitest";

// Tests never make a paid call: the provider keys are dropped before any
// module reads the environment, so every adapter takes its key-free path even
// when the shell exports a real key.
delete process.env.OPENAI_API_KEY;
delete process.env.GOOGLE_API_KEY;

// Nor a call to Etsy; and what a test seals uses a key of its own.
delete process.env.ETSY_API_KEY;
delete process.env.ETSY_SHARED_SECRET;
delete process.env.ETSY_REDIRECT_URI;
process.env.KILN_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");

// Server Actions and the app's own route handlers start by requiring a
// session (src/server/session.ts). Tests call them directly, with no request,
// so the guard lets them through as a maker: with the database tests on, the
// instance's maker (KILN_MAKER, the one the rows belong to), else a stand-in. The guard's
// presence is its own test (session-guard.test.ts).
vi.mock("@/server/session", () => ({
  requireMaker: async () => {
    if (
      process.env.KILN_DB_TESTS === "1" &&
      expect.getState().testPath?.includes("__tests__")
    ) {
      const { getCurrentMaker } = await vi.importActual<
        typeof import("@/server/maker-repository")
      >("@/server/maker-repository");
      return getCurrentMaker();
    }
    return { id: "test", slug: "test", name: "Test" };
  },
  denyWithoutSession: async () => null,
}));
