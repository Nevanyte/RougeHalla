import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXAMPLE_RUN } from "../../../packages/shared/test/fixtures/telemetryRun.example";
import { validateRunRecord } from "@raid/shared/telemetry";
import { DASHBOARD_FIXTURE } from "../src/dashboard/fixture";
import { dashboardHtml, dashboardScript, dashboardStyles } from "../src/dashboard/page";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("dashboard page", () => {
  const script = dashboardScript();
  const html = dashboardHtml();
  const css = dashboardStyles();

  it("the script holds no backtick or dollar-brace and parses as one function body", () => {
    expect(script).not.toContain("`");
    expect(script).not.toContain("${");
    expect(() => new Function(script)).not.toThrow();
  });

  it("the script never parses data as markup or code", () => {
    for (const bad of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"]) {
      expect(script, bad).not.toContain(bad);
    }
  });

  it("the HTML is CSP-safe: no inline script, style or handlers, and links its own two files", () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<link rel="stylesheet" href="/stats/app.css">');
    expect(html).toContain('<script src="/stats/app.js" defer></script>');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      expect(m[1]).toContain("src=");
      expect(m[2].trim()).toBe("");
    }
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('action="/stats/login"');
    expect(html).toContain('action="/stats/logout"');
  });

  it("the styles carry the client tokens, both themes and no external resources", () => {
    expect(css).toContain("--bg: #1b1f24");
    expect(css).toContain("prefers-color-scheme: light");
    expect(css).toContain(':root[data-theme="light"]');
    expect(css).not.toMatch(/@import|url\(/);
  });

  it("every endpoint the script calls has a fixture, and every fixture key is an endpoint", () => {
    const paths = new Set([...script.matchAll(/"(\/api\/stats\/[a-z/]+)"/g)].map((m) => m[1]));
    expect(paths.size).toBeGreaterThanOrEqual(15);
    for (const p of paths) {
      const key = p.endsWith("/run/") ? "/api/stats/run/:runId" : p;
      expect(DASHBOARD_FIXTURE, p).toHaveProperty([key]);
    }
    for (const key of Object.keys(DASHBOARD_FIXTURE)) {
      const bare = key.split("?")[0];
      expect(bare === "/api/stats/run/:runId" || paths.has(bare), key).toBe(true);
    }
  });

  it("the fixture's run record and the committed NDJSON fixture pass the ingest check", () => {
    expect(validateRunRecord(DASHBOARD_FIXTURE["/api/stats/run/:runId"])).toBeNull();
    expect(validateRunRecord(EXAMPLE_RUN)).toBeNull();
    const lines = readFileSync(path.join(root, "testing/telemetry/fixtures/runs-v1.ndjson"), "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBe(40);
    const ids = new Set<string>();
    for (const line of lines) {
      const r = JSON.parse(line);
      expect(validateRunRecord(r), r.runId).toBeNull();
      ids.add(r.runId);
    }
    expect(ids.size).toBe(40);
  });
});
