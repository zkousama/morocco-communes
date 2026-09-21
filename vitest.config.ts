import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["pipeline/tests/**/*.test.ts", "api/tests/**/*.test.ts", "site/tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    // Many of these read the whole dataset or emit the whole API tree, some 10,000 files,
    // and a shared CI runner is several times slower than a laptop. The defaults suit
    // tests that finish in milliseconds; these limits still fail a test that hangs. A test
    // sets its own only to ask for more, as the two that run tsc and Python do.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
