import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // lib/worker.ts imports "server-only" (a Next.js build-time guard);
      // outside the Next build it must resolve to a harmless empty module.
      "server-only": `${rootDir}tests/stubs/server-only.ts`,
      "@": rootDir,
    },
  },
  test: {
    environment: "node",
    // Single source of truth for the web test harness. Tasks 16 and 17 add
    // test files under these globs and must NOT create or modify any vitest
    // configuration of their own.
    include: [
      "tests/**/*.test.ts",
      "lib/**/*.test.ts",
      "components/**/*.test.ts",
      "components/**/*.test.tsx",
    ],
  },
});
