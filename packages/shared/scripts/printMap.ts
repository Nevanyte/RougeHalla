// ASCII dump of generateMap(seed): `npx tsx packages/shared/scripts/printMap.ts 1234`
import { generateMap } from "../src/mapgen";
import { TILE_WALL, worldToTile } from "../src/map";

const seed = Number(process.argv[2] ?? 1);
const map = generateMap(seed);
const grid: string[][] = [];
for (let y = 0; y < map.h; y++) {
  const row: string[] = [];
  for (let x = 0; x < map.w; x++) row.push(map.tiles[y * map.w + x] === TILE_WALL ? "#" : ".");
  grid.push(row);
}
const mark = (p: { x: number; y: number }, ch: string) => {
  grid[worldToTile(p.y)][worldToTile(p.x)] = ch;
};
map.groundSpots.forEach((p) => mark(p, "g"));
map.crateSpots.forEach((p) => mark(p, "c"));
map.spawns.forEach((p) => mark(p, "S"));
map.extracts.forEach((e) => mark(e, "X"));

console.log(`seed ${seed}: ${map.buildings.length} buildings, ${map.spawns.length} spawns, ${map.crateSpots.length} crates, ${map.groundSpots.length} ground`);
for (const e of map.extracts) console.log(`  ${e.id} ${e.name} at tile (${worldToTile(e.x)}, ${worldToTile(e.y)})`);
console.log(grid.map((r) => r.join("")).join("\n"));
