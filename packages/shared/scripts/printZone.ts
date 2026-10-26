// ASCII dump of one zone of a styled wedge map: `npx tsx packages/shared/scripts/printZone.ts <seed> [zone] [--plain] [--props]`
// zone is a faction id (fire sentenced plague frost holy), a zone name (scorch gallows warren rime sanctum) or 1..5; omitted = all five.
// --plain shows the finished map before styling; --props marks the decor.
import { generateMap } from "../src/mapgen";
import { REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL, worldToTile } from "../src/map";
import {
  TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT,
} from "../src/terrain";
import { styleFinishedMapDetailed, styleReport } from "../src/zoneStyle/finishedMap";
import { ZONE_PROP_KINDS } from "../src/zoneStyle/propKinds";

const ZONE_NAMES: Record<string, number> = { fire: 1, sentenced: 2, plague: 3, frost: 4, holy: 5, scorch: 1, gallows: 2, warren: 3, rime: 4, sanctum: 5 };
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const seed = Number(args[0] ?? 1);
const which = args[1] === undefined ? [1, 2, 3, 4, 5] : [ZONE_NAMES[args[1]] ?? Number(args[1])];

const before = generateMap(seed);
const { map: after, results, protect } = flags.has("--plain") ? { map: before, results: [], protect: new Uint8Array(before.w * before.h) } : styleFinishedMapDetailed(before);
const { w, h } = before;
const propAt = new Map<number, string>();
for (const p of flags.has("--props") ? after.props : []) propAt.set(worldToTile(p.y) * w + worldToTile(p.x), ZONE_PROP_KINDS[p.kind].key[0]);

function glyph(i: number): string {
  const t = after.tiles[i], k = after.terrain[i];
  if (propAt.has(i)) return "*";
  if (t === TILE_WALL) return before.tiles[i] === TILE_FLOOR ? "X" : k !== 0 ? "P" : "#";
  if (t === TILE_LOW) return k === TERRAIN_LAVA ? "~" : k === TERRAIN_FENCE ? "|" : k === TERRAIN_CREVASSE ? ":" : "?";
  if (k === TERRAIN_EMBER) return "e";
  if (k === TERRAIN_BOG) return "b";
  if (k === TERRAIN_ICE) return "i";
  if (k === TERRAIN_LIGHT) return "L";
  return protect[i] ? "," : ".";
}

for (const code of which) {
  const faction = REGION_FACTIONS[code - 1];
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (before.regionGrid[i] !== code) continue;
    const x = i % w, y = (i - x) / w;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  console.log(`--- seed ${seed} zone ${code} ${faction} (${x1 - x0 + 1}x${y1 - y0 + 1} box)`);
  for (let y = y0; y <= y1; y++) {
    let row = "";
    for (let x = x0; x <= x1; x++) row += before.regionGrid[y * w + x] === code ? glyph(y * w + x) : " ";
    console.log(row);
  }
  const rep = styleReport(before, after).zones[code - 1];
  const res = results[code - 1];
  console.log(
    `walls ${rep.walls} (${rep.wallPct.toFixed(1)}%)  low ${rep.low} (${rep.lowPct.toFixed(1)}%)  hazard ${rep.hazardPct.toFixed(1)}%  effective ${rep.effectivePct.toFixed(1)}%  props ${rep.props}` +
    (res ? `  refused ${res.refused}  joins ${res.joinChecks}  ${res.ms.toFixed(2)} ms` : ""),
  );
}
console.log("legend: X styler wall  # existing wall  P pillar in a LOW feature  ~ lava  | fence  : crevasse  e ember  b bog  i ice  L light  , protected floor  . floor  * prop (--props)");
