// ASCII dump of generateMap(seed[, attempt]): `npx tsx packages/shared/scripts/printMap.ts 1234 [attempt]`
// Zones, territories, camps, chests, crates, landmarks, features and the spawn pool.
import { TILE } from "../src/constants";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL, regionAtTile, worldToTile } from "../src/map";
import type { RegionId } from "../src/map";
import { generateMap, mapHash } from "../src/mapgen";
import { TERRAIN_CREVASSE, TERRAIN_FENCE, TERRAIN_LAVA } from "../src/terrain";

const seed = Number(process.argv[2] ?? 1);
const map = process.argv[3] === undefined ? generateMap(seed) : generateMap(seed, Number(process.argv[3]));
const W = map.w;

const FLOOR_CH: Record<RegionId, string> = { none: "?", fire: "f", sentenced: "s", plague: "p", frost: "i", holy: "h", coliseum: "." };
// A LOW tile is drawn by its terrain kind; a kindless one (a hand-built barrier) is "L".
const LOW_CH: Record<number, string> = { [TERRAIN_LAVA]: "~", [TERRAIN_FENCE]: "|", [TERRAIN_CREVASSE]: ":" };
const gateTiles = new Set(map.coliseum.gates.flatMap((g) => g.tiles.map((t) => t.y * W + t.x)));
const inLandmark = (x: number, y: number) => map.buildings.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);

const grid: string[][] = [];
for (let y = 0; y < map.h; y++) {
  const row: string[] = [];
  for (let x = 0; x < W; x++) {
    const i = y * W + x, t = map.tiles[i], region = regionAtTile(map, x, y);
    let ch: string;
    if (gateTiles.has(i)) ch = "=";
    else if (t === TILE_WALL) ch = region === "none" || region === "coliseum" || inLandmark(x, y) ? "#" : "o";
    else if (t === TILE_LOW) ch = LOW_CH[map.terrain[i]] ?? "L";
    else {
      ch = FLOOR_CH[region];
      // Upper case: a floor tile on its territory's edge (a neighbour in another territory of the same zone).
      const T = map.territoryGrid[i];
      for (const d of [-1, 1, -W, W]) {
        const u = map.territoryGrid[i + d];
        if (T && u && u !== T && map.regionGrid[i + d] === map.regionGrid[i]) { ch = ch.toUpperCase(); break; }
      }
    }
    row.push(ch);
  }
  grid.push(row);
}
const mark = (p: { x: number; y: number }, ch: string) => { grid[worldToTile(p.y)][worldToTile(p.x)] = ch; };
map.groundSpots.forEach((p) => mark(p, "g"));
map.crateSpots.forEach((p) => mark(p, "C"));
for (const c of map.camps) {
  c.spots.forEach((p) => mark(p, "m"));
  mark(c.chest, c.eliteSpot >= 0 ? "E" : "M");
}
map.coliseum.innerSpawns.forEach((p) => mark(p, "T"));
map.spawnPool.forEach((p) => mark(p, "S"));

let rocks = 0, open = 0, low = 0;
for (let y = 0; y < map.h; y++) {
  for (let x = 0; x < W; x++) {
    const region = regionAtTile(map, x, y), t = map.tiles[y * W + x];
    if (region === "none" || region === "coliseum") continue;
    if (t === TILE_LOW) low++;
    if (t !== TILE_WALL) open++;
    else if (!inLandmark(x, y)) rocks++;
  }
}
console.log(
  `seed ${seed}, attempt ${map.attempt}, ${W}x${map.h}, mapHash ${mapHash(map)}: ${map.camps.length} camps, ${map.spawnPool.length} spawns in the pool ` +
  `(${new Set(map.spawnPool.map((s) => s.zone)).size} zones), ${map.buildings.length} landmarks, ${map.crateSpots.length} crates, ${map.groundSpots.length} ground spots, ` +
  `${rocks} zone wall tiles outside landmarks (${((100 * rocks) / (rocks + open)).toFixed(0)}% of the zones), ${low} low tiles; ${map.features.length} features ` +
  `(${[...new Set(map.features.map((f) => f.kind))].map((k) => `${k} ${map.features.filter((f) => f.kind === k).length}`).join(", ")})`,
);
console.log("legend: f s p i h zone floor (UPPER: on a territory edge)  o zone wall  # wall/landmark/border  ~ lava  | fence  : crevasse  L other low ground  = gate  . coliseum floor  T inner spawn");
console.log("        M camp (its chest tile)  E elite camp  m mob spot  C crate  g ground spot  S spawn pool member");
for (const f of REGION_FACTIONS) {
  const r = map.regions.find((g) => g.id === f)!, code = REGION_FACTIONS.indexOf(f) + 1;
  let floor = 0;
  for (let i = 0; i < map.tiles.length; i++) if (map.regionGrid[i] === code && map.tiles[i] === TILE_FLOOR) floor++;
  const camps = map.camps.filter((c) => c.zone === f);
  console.log(
    `  ${f.padEnd(9)} painted ${r.area}  floor ${floor}  pole (${worldToTile(r.pole.x)},${worldToTile(r.pole.y)})  spawns ${r.spawns.length}  crates ${r.chestSpots.length}  ` +
    `camps ${camps.map((c) => `${c.id}${c.eliteSpot >= 0 ? "*" : ""}@(${worldToTile(c.x)},${worldToTile(c.y)}) ${c.spots.length} mobs, territory ${c.area} tiles r ${(c.radius / TILE).toFixed(1)}`).join("; ")}`,
  );
}
console.log(grid.map((r) => r.join("")).join("\n"));
