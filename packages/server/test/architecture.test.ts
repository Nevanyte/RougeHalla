// Source-level guards for the terrain layers (zone terrain). `isWallTile` / `isWallAt` mean "opaque" (they answer for sight,
// the wall class only), so movement code that read them would walk straight across a fence or a lava stream: server code and
// the client's prediction (`client/src/net`) must ask the movement mask (isSolidTile, circleClear, segmentClear, findPath) or
// name their reach mask (hasLineOfSight / raycast with MASK_MOVE or reachMask). And the sim never reads a map's `props`:
// they are decor only, and a server that skipped them (`decor: false`) must play the same game.
// The same goes for a tile compared with TILE_WALL ("not a wall" read as "walkable"), and for an aliased import of the opaque
// names, which would hide a call from the name scan. The shared movement modules are scanned too (pathfind, geometry, walk,
// and blink when it exists). The scan reads the files and ignores comments and string literals.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

/** The opaque names called (also as a member: `shared.isWallTile(`), or imported under another name. */
const OPAQUE_CALL = /\bisWall(Tile|At)\s*\(/;
const OPAQUE_ALIAS = /\bisWall(Tile|At)\s+as\b/;
/** A tile compared with the wall literal: movement code that reads it means "walkable", and LOW is not a wall. */
const WALL_LITERAL = /[!=]==?\s*TILE_WALL\b|\bTILE_WALL\s*[!=]==?/;

/**
 * Files that may compare with TILE_WALL because they mean opaque, by `relative(PACKAGES, file)`. Empty: none of the scanned
 * code does today. Map building and its checks (mapgen.ts, terrain.ts, zoneStyle/) and the map dumps (scripts/) mean "is a
 * wall tile" and sit outside the scanned set instead (they are not movement code). Add a file here only with the reason.
 */
const WALL_LITERAL_ALLOWED: readonly string[] = [];

/** The shared movement modules. `blink.ts` joins when the tree has it. */
const SHARED_MOVEMENT = ["pathfind", "geometry", "walk", "blink"].map((n) => join(PACKAGES, `shared/src/${n}.ts`));
const sharedMovement = (): string[] => SHARED_MOVEMENT.filter((f) => existsSync(f));

/** `file:line` for every match of `re` in the code of the files under `targets` (directories or single files), but `allowed`. */
function offenders(targets: string[], re: RegExp, allowed: readonly string[] = []): string[] {
  const hits: string[] = [];
  for (const target of targets) {
    for (const file of statSync(target).isDirectory() ? sourceFiles(target) : [target]) {
      if (allowed.includes(relative(PACKAGES, file))) continue;
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
    expect(lines.filter((l) => OPAQUE_CALL.test(l))).toEqual([lines[4]]);
  });

  it("the call pattern sees plain, spaced and member calls and not other names", () => {
    for (const hit of ["isWallTile(map, 1, 2)", "if (isWallAt (map, x, y))", "shared.isWallTile(m, 0, 0)", "!isWallTile(m, 1, 1)"]) {
      expect(OPAQUE_CALL.test(hit), hit).toBe(true);
    }
    for (const miss of ["isWallTileCount(m)", "const isWallTile = 3;", "isSolidTile(m, 1, 2)", "unisWallTile(x)"]) {
      expect(OPAQUE_CALL.test(miss), miss).toBe(false);
    }
  });

  it("the alias pattern sees an aliased import of either name and not a plain one", () => {
    for (const hit of ["import { isWallTile as opaque } from \"@raid/shared\";", "  isWallAt as wallAt,", "import { a, isWallTile  as b } from \"x\";"]) {
      expect(OPAQUE_ALIAS.test(codeOnly(hit)), hit).toBe(true);
    }
    for (const miss of ["import { isWallTile } from \"@raid/shared\";", "// isWallTile as x", "const s = \"isWallAt as y\";", "isSolidTile as solid,"]) {
      expect(OPAQUE_ALIAS.test(codeOnly(miss)), miss).toBe(false);
    }
  });

  it("the wall-literal pattern sees a comparison either way round and not an assignment or a mask", () => {
    for (const hit of [
      "if (tiles[i] !== TILE_WALL) continue;",
      "const open = tiles[i] === TILE_WALL;",
      "return TILE_WALL !== map.tiles[i];",
      "x == TILE_WALL",
      "TILE_WALL != t",
      "t!==TILE_WALL",
    ]) {
      expect(WALL_LITERAL.test(codeOnly(hit)), hit).toBe(true);
    }
    for (const miss of [
      "tiles[i] = TILE_WALL;",
      "const MASK_SIGHT = TILE_WALL;",
      "(tiles[i] & MASK_MOVE) !== 0",
      "export const MASK_MELEE = TILE_WALL | TILE_LOW;",
      "// tiles[i] !== TILE_WALL",
      'const s = "t === TILE_WALL";',
      "t === TILE_WALL_EXTRA",
    ]) {
      expect(WALL_LITERAL.test(codeOnly(miss)), miss).toBe(false);
    }
  });

  it("offenders() reads single files and honours the allow-list", () => {
    const geometry = join(PACKAGES, "shared/src/geometry.ts");
    const map = join(PACKAGES, "shared/src/map.ts");
    // map.ts defines the wall literal (`MASK_SIGHT = TILE_WALL` is no comparison), so use a pattern it does match.
    const re = /\bTILE_WALL\b/;
    const all = offenders([map], re);
    expect(all.length).toBeGreaterThan(0);
    expect(offenders([map], re, [relative(PACKAGES, map)])).toEqual([]);
    expect(offenders([map], re, [relative(PACKAGES, geometry)])).toEqual(all);
    expect(offenders([geometry, map], re).length).toBeGreaterThanOrEqual(all.length);
  });

  it("every allow-listed file exists (a rename must not leave a stale exemption)", () => {
    for (const rel of WALL_LITERAL_ALLOWED) expect(existsSync(join(PACKAGES, rel)), rel).toBe(true);
  });

  it("reads the trees it is meant to guard (a wrong path would pass for nothing)", () => {
    expect(sourceFiles(join(PACKAGES, "server/src")).length).toBeGreaterThan(30);
    expect(sourceFiles(join(PACKAGES, "server/src/sim")).length).toBeGreaterThan(15);
    expect(sourceFiles(join(PACKAGES, "client/src/net")).length).toBeGreaterThan(3);
    const shared = sharedMovement().map((f) => relative(PACKAGES, f));
    for (const f of ["pathfind", "geometry", "walk"]) expect(shared).toContain(`shared/src/${f}.ts`);
  });
});

describe("terrain architecture", () => {
  const MOVEMENT = (): string[] => [join(PACKAGES, "server/src"), join(PACKAGES, "client/src/net"), ...sharedMovement()];

  it("no isWallTile( or isWallAt( in the server, the client's net code or the shared movement modules: movement asks the move mask", () => {
    expect(offenders(MOVEMENT(), OPAQUE_CALL)).toEqual([]);
  });

  it("no aliased import of isWallTile or isWallAt where movement lives (an alias would hide the call from the scan)", () => {
    expect(offenders(MOVEMENT(), OPAQUE_ALIAS)).toEqual([]);
  });

  it("no comparison with TILE_WALL in the sim, the client's net code or the shared movement modules: LOW blocks bodies too", () => {
    const dirs = [join(PACKAGES, "server/src/sim"), join(PACKAGES, "client/src/net"), ...sharedMovement()];
    expect(offenders(dirs, WALL_LITERAL, WALL_LITERAL_ALLOWED)).toEqual([]);
  });

  it("the sim never reads a map's props (decor only)", () => {
    const hits = offenders([join(PACKAGES, "server/src/sim")], /\bprops\b/);
    expect(hits).toEqual([]);
  });
});
