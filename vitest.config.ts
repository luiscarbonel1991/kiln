import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The provenance cascade + provider adapters live in packages/engine (@kiln/engine);
// the @/domain and @/providers aliases redirect there, the rest of @/ stays app-local.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "packages/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: [
      {
        find: /^@\/domain\//,
        replacement: fileURLToPath(
          new URL("./packages/engine/src/domain/", import.meta.url),
        ),
      },
      {
        find: /^@\/providers\//,
        replacement: fileURLToPath(
          new URL("./packages/engine/src/providers/", import.meta.url),
        ),
      },
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./src/", import.meta.url)),
      },
    ],
  },
});
