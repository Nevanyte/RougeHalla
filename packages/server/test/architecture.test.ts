// Source-level guards for the terrain layers (zone terrain). `isWallTile` / `isWallAt` mean "opaque" (they answer for sight,
// the wall class only), so movement code that read them would walk straight across a fence or a lava stream: server code and
// the client's prediction (`client/src/net`) must ask the movement mask (isSolidTile, circleClear, segmentClear, findPath) or
// name their reach mask (hasLineOfSight / raycast with MASK_MOVE or reachMask). And the sim never reads a map's `props`:
// they are decor only, and a server that skipped them (`decor: false`) must play the same game.
// The scan reads the files and ignores comments and string literals.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** packages/ */
const PACKAGES = fileURLToPath(new URL("../..", import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out.sort();
}

/** The code of a TypeScript source with comments and the insides of string and template literals blanked (newlines kept). */
function codeOnly(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") { out += " "; i++; }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** `file:line` for every match of `re` in the code of the files under `dirs`. */
function offenders(dirs: string[], re: RegExp): string[] {
  const hits: string[] = [];
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) {
      codeOnly(readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
        if (re.test(line)) hits.push(`${relative(PACKAGES, file)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  return hits;
}

describe("the scan itself", () => {
  it("ignores comments and strings and sees code", () => {
    const src = [
      "// isWallTile(map, 1, 2)",
      "/* isWallAt(map, 1, 2)",
      "   isWallTile(x) */",
      'const s = "isWallTile(" + \'isWallAt(\' + `isWallTile(${1})`;',
      "const url = 'http://x'; isWallTile(map, 3, 4);",
    ].join("\n");
    const lines = codeOnly(src).split("\n");
    expect(lines).toHaveLength(5);
    expect(lines.filter((l) => /\bisWall(Tile|At)\s*\(/.test(l))).toEqual([lines[4]]);
  });

  it("reads the trees it is meant to guard (a wrong path would pass for nothing)", () => {
    expect(sourceFiles(join(PACKAGES, "server/src")).length).toBeGreaterThan(30);
    expect(sourceFiles(join(PACKAGES, "server/src/sim")).length).toBeGreaterThan(15);
    expect(sourceFiles(join(PACKAGES, "client/src/net")).length).toBeGreaterThan(3);
  });
});

describe("terrain architecture", () => {
  it("no isWallTile( or isWallAt( in the server or the client's net code: movement asks the move mask", () => {
    const hits = offenders([join(PACKAGES, "server/src"), join(PACKAGES, "client/src/net")], /\bisWall(Tile|At)\s*\(/);
    expect(hits).toEqual([]);
  });

  it("the sim never reads a map's props (decor only)", () => {
    const hits = offenders([join(PACKAGES, "server/src/sim")], /\bprops\b/);
    expect(hits).toEqual([]);
  });
});
