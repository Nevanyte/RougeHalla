// ASCII dump of one zone of a generated map: `npx tsx packages/shared/scripts/printZone.ts <seed> [zone] [--plain] [--props] [--features]`
// zone is a faction id (fire sentenced plague frost holy), a zone name (scorch gallows warren rime sanctum) or the faction's
// code 1..5 (REGION_FACTIONS order); omitted = all five. --plain builds the same seed without the zone stylers (another
// map: the generator's later stages see other ground); --props marks the decor; --features draws every tile a feature owns as
// its kind's letter (map.featureGrid) instead of its terrain.
import { generateMap } from "../src/mapgen";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL, worldToTile } from "../src/map";
import type { FeatureKind } from "../src/map";
import {
  TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT,
} from "../src/terrain";
import { ZONE_PROP_KINDS } from "../src/zoneStyle/propKinds";

const ZONE_NAMES: Record<string, number> = { fire: 1, sentenced: 2, plague: 3, frost: 4, holy: 5, scorch: 1, gallows: 2, warren: 3, rime: 4, sanctum: 5 };
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const seed = Number(args[0] ?? 1);
const which = args[1] === undefined ? [1, 2, 3, 4, 5] : [ZONE_NAMES[args[1]] ?? Number(args[1])];

const map = flags.has("--plain") ? generateMap(seed, undefined, { styleZones: null }) : generateMap(seed);
const { w, h } = map;
const propAt = new Map<number, string>();
for (const p of flags.has("--props") ? map.props : []) propAt.set(worldToTile(p.y) * w + worldToTile(p.x), ZONE_PROP_KINDS[p.kind].key[0]);
const mark = new Map<number, string>();
for (const s of map.spawnPool) mark.set(worldToTile(s.y) * w + worldToTile(s.x), "S");
for (const c of map.crateSpots) mark.set(worldToTile(c.y) * w + worldToTile(c.x), "C");
for (const c of map.camps) mark.set(worldToTile(c.chest.y) * w + worldToTile(c.chest.x), c.eliteSpot >= 0 ? "E" : "M");

/** One letter per feature kind (--features). */
const FEATURE_GLYPH: Record<FeatureKind, string> = {
  landmark: "K", crater: "O", lavaRiver: "R", fenceRow: "F", gallows: "G", barrow: "B", mere: "Q", headland: "H", spire: "^",
  causeway: "=", hall: "X", infill: "x",
};
const showFeatures = flags.has("--features");

function glyph(i: number): string {
  const t = map.tiles[i], k = map.terrain[i];
  if (mark.has(i)) return mark.get(i)!;
  if (propAt.has(i)) return "*";
  if (showFeatures && map.featureGrid[i] !== 0) return FEATURE_GLYPH[map.features[map.featureGrid[i] - 1].kind];
  if (t === TILE_WALL) return k !== 0 ? "P" : "#";
  if (t === TILE_LOW) return k === TERRAIN_LAVA ? "~" : k === TERRAIN_FENCE ? "|" : k === TERRAIN_CREVASSE ? ":" : "?";
  if (k === TERRAIN_EMBER) return "e";
  if (k === TERRAIN_BOG) return "b";
  if (k === TERRAIN_ICE) return "i";
  if (k === TERRAIN_LIGHT) return "L";
  return ".";
}

console.log(`seed ${seed} attempt ${map.attempt}${flags.has("--plain") ? " (no stylers)" : ""}`);
for (const code of which) {
  const faction = REGION_FACTIONS[code - 1];
  let x0 = w, y0 = h, x1 = -1, y1 = -1, painted = 0, floor = 0, walls = 0, low = 0, hazard = 0, pillars = 0;
  for (let i = 0; i < w * h; i++) {
    if (map.regionGrid[i] !== code) continue;
    const x = i % w, y = (i - x) / w;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    painted++;
    const t = map.tiles[i], k = map.terrain[i];
    if (t === TILE_FLOOR) { floor++; if (k !== 0) hazard++; } else if (t === TILE_LOW) low++; else { walls++; if (k !== 0) pillars++; }
  }
  console.log(`--- zone ${code} ${faction} (${x1 - x0 + 1}x${y1 - y0 + 1} box)`);
  for (let y = y0; y <= y1; y++) {
    let row = "";
    for (let x = x0; x <= x1; x++) row += map.regionGrid[y * w + x] === code ? glyph(y * w + x) : " ";
    console.log(row);
  }
  const pct = (n: number): string => `${n} (${((100 * n) / painted).toFixed(1)}%)`;
  console.log(`painted ${painted}  floor ${floor}  walls ${pct(walls)} (pillars in a LOW feature ${pillars})  low ${pct(low)}  hazard ${pct(hazard)}  props ${map.props.filter((p) => map.regionGrid[worldToTile(p.y) * w + worldToTile(p.x)] === code).length}`);
  const feats = map.features.filter((f) => f.zone === faction);
  console.log(`features ${feats.length}: ${feats.map((f) => `${f.kind}${f.variant ? `/${f.variant}` : ""} ${f.tiles}t [${f.jobs.join(",")}] p=${JSON.stringify(f.p)}`).join("; ")}`);
}
console.log("legend: # wall  P pillar in a LOW feature  ~ lava  | fence  : crevasse  e ember  b bog  i ice  L light  . floor  * prop (--props)  S spawn pool member  C crate  M camp chest  E elite camp chest");
if (showFeatures) console.log(`features: ${Object.entries(FEATURE_GLYPH).map(([k, g]) => `${g} ${k}`).join("  ")}`);
