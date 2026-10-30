import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// `pnpm eval:chat`: the chat agent's fixed tasks (src/**/*.eval.ts), apart
// from the test run because they call a real text model.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/**/*.eval.ts"],
    setupFiles: ["./vitest.eval.setup.ts"],
    testTimeout: 5 * 60_000,
  },
});
