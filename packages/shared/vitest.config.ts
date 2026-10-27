import { defineConfig } from "vitest/config";

// The heavy suites (styled-map fuzz, 96x96 pathfinding) run beside other workspaces under `npm test`; vitest's 5 s default
// timed out on a loaded machine. The globs stay vitest's defaults.
export default defineConfig({
  test: {
    testTimeout: 60_000,
  },
});
