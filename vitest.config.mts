import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "node", env: { PGLITE_DIR: "memory", DATABASE_URL: "" }, testTimeout: 30000, fileParallelism: false },
});
