// The local dashboard scripts serve real run records (dashboardLocal) and a login flow (both): they must listen on
// loopback only and never fall back to a token committed in the repository.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts");

describe("local dashboard scripts", () => {
  for (const file of ["dashboardLocal.ts", "dashboardDev.ts"]) {
    it(`${file} binds 127.0.0.1 and draws its default token at random`, () => {
      const src = fs.readFileSync(path.join(DIR, file), "utf8");
      const listens = [...src.matchAll(/\.listen\(([^)]*?),\s*\(\)\s*=>/g)].map((m) => m[1]);
      expect(listens.length).toBe(1);
      expect(listens[0]).toMatch(/^port, "127\.0\.0\.1"$/);
      const fallback = src.match(/process\.env\.DASHBOARD_TOKEN \?\? ([^;]+);/);
      expect(fallback?.[1]).toBe('randomBytes(24).toString("hex")');
    });
  }
});
