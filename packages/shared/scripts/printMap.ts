// ASCII dump of generateMap(seed): `npx tsx packages/shared/scripts/printMap.ts 1234`
import { generateMap, longestLane } from "../src/mapgen";
import { REGION_FACTIONS, TILE_WALL, regionAtTile, withGates, worldToTile } from "../src/map";
import type { RegionId } from "../src/map";

const seed = Number(process.argv[2] ?? 1);
const map = generateMap(seed);

const FLOOR_CH: Record<RegionId, string> = {
  none: "?", fire: "f", sentenced: "s", plague: "p", frost: "i", holy: "h", coliseum: ".",
};
const gateTiles = new Set(map.coliseum.gates.flatMap((g) => g.tiles.map((t) => t.y * map.w + t.x)));

const grid: string[][] = [];
for (let y = 0; y < map.h; y++) {
  const row: string[] = [];
  for (let x = 0; x < map.w; x++) {
    const wall = map.tiles[y * map.w + x] === TILE_WALL;
    const region = regionAtTile(map, x, y);
    const border = x === 0 || y === 0 || x === map.w - 1 || y === map.h - 1;
    row.push(
      gateTiles.has(y * map.w + x) ? "=" :
      wall ? (region === "none" && !border ? "%" : "#") :
      FLOOR_CH[region],
    );
  }
  grid.push(row);
}
const mark = (p: { x: number; y: number }, ch: string) => {
  grid[worldToTile(p.y)][worldToTile(p.x)] = ch;
};
for (const region of map.regions) {
  region.chestSpots.forEach((p) => mark(p, "C"));
  for (const camp of region.mobCamps) camp.spots.forEach((p) => mark(p, "m"));
}
for (const region of map.regions) for (const camp of region.mobCamps) mark(camp, camp.elite ? "E" : "M");
// The camp's reward chest tile: usually the camp centre itself (then M/E stands for both), else it gets its own K.
for (const c of map.camps) if (c.chest.x !== c.x || c.chest.y !== c.y) mark(c.chest, "K");
map.coliseum.innerSpawns.forEach((p) => mark(p, "T"));
map.extracts.forEach((e) => mark(e, "X"));
map.spawns.forEach((p) => mark(p, "S"));

// Walls inside a faction region and outside the ruins are rocks (obstacles and cover). The generator holds the longest
// sight corridor over all floor, gates open, to SIGHT_LATTICE.target tiles on its lattice (MAX_SIGHT_CORRIDOR for a
// free strip SIGHT_CORRIDOR_WIDTH wide at any angle).
let rocks = 0, openTiles = 0;
for (let y = 0; y < map.h; y++) {
  for (let x = 0; x < map.w; x++) {
    const region = regionAtTile(map, x, y);
    if (region === "none" || region === "coliseum") continue;
    if (map.tiles[y * map.w + x] !== TILE_WALL) openTiles++;
    else if (!map.buildings.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) rocks++;
  }
}
console.log(
  `seed ${seed}: ${map.buildings.length} ruins, ${map.spawns.length} spawns, ${map.crateSpots.length} chests, ${map.groundSpots.length} ground spots, ` +
  `${rocks} rock tiles (${((100 * rocks) / (rocks + openTiles)).toFixed(0)}% of the faction land), longest lattice lane ${longestLane(map).toFixed(0)} u (${longestLane(withGates(map)).toFixed(0)} u with the gates closed)`,
);
console.log("legend: # wall  % ridge wall  = gate  . coliseum floor  f/s/p/i/h fire/sentenced/plague/frost/holy floor");
console.log("        S player spawn  T inner spawn  C chest  M camp  E elite camp  m camp spot  K camp reward chest off the camp centre  X extract");
console.log(`  camp chests: ${map.camps.map((c) => `${c.id}(${worldToTile(c.chest.x)},${worldToTile(c.chest.y)})`).join(" ")}  [attempt ${map.attempt}]`);
for (const e of map.extracts) console.log(`  ${e.id} ${e.name} at tile (${worldToTile(e.x)}, ${worldToTile(e.y)})`);
for (const faction of REGION_FACTIONS) {
  const r = map.regions.find((g) => g.id === faction)!;
  let floor = 0;
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) if (map.tiles[y * map.w + x] !== TILE_WALL && regionAtTile(map, x, y) === faction) floor++;
  }
  console.log(
    `  ${faction.padEnd(9)} floor ${String(floor).padStart(4)}  spawns ${r.spawns.length}  chests ${r.chestSpots.length}  ` +
    `camps ${r.mobCamps.length} (${r.mobCamps.map((c) => c.id + (c.elite ? "*" : "")).join(" ")})`,
  );
}
console.log(grid.map((r) => r.join("")).join("\n"));
