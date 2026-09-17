import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["pipeline/tests/**/*.test.ts"] },
});
