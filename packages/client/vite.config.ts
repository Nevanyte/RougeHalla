import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { computeWireBuildId } from "../server/src/buildId.ts";

export default defineConfig(({ command }) => ({
  // A production build carries the wire build of the shared sources it bundles and sends it with every join (net/connection.ts), so a
  // server that has moved on tells a tab that outlived the deploy to reload. Dev and tests carry none: hot reload keeps a page
  // across edits of shared code, and the server asks for nothing in dev.
  define: command === "build"
    ? { "import.meta.env.VITE_WIRE_BUILD": JSON.stringify(computeWireBuildId(fileURLToPath(new URL("../../", import.meta.url)))) }
    : {},
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:2567",
    },
  },
}));
