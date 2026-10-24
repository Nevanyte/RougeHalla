// The walkable hub as data: one room, its solids and its stations, in world units (TILE = 32). Pure: no Phaser, so the
// layout and the walking rules can be tested headless. HubScene draws it and moves the avatar with it; nothing here is
// ever sent to the server (the hub is entirely client-side).
//
// The ring of walls around the floor is scenery: the floor rectangle is what the avatar may stand on. Stations in the
// walls (the stairs, the training door) have footprints outside the floor and are reached from the floor edge.
import { FACTIONS, FACTION_IDS, PLAYER_RADIUS, TILE, type FactionId } from "@raid/shared";

export interface Vec { x: number; y: number }
/** Top-left corner and size. */
export interface Rect { x: number; y: number; w: number; h: number }

export type HubStationId =
  | "arena" | "training" | "shop" | "wardrobe" | "achievements" | "leaderboard" | "counters"
  | `faction:${FactionId}`;

export type HubStationKind = "stairs" | "door" | "kiosk" | "decal" | "pedestal";

export interface HubStation {
  id: HubStationId;
  kind: HubStationKind;
  /** The sign over it. */
  label: string;
  /** What pressing the key does, for the prompt ("E: Shop"). */
  verb: string;
  key: "E";
  /** Footprint centre and size. The interaction zone is the footprint: standing within `reach` of it triggers the prompt. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** A spot on the floor from which the station is in reach (where a click on it sends the avatar). */
  stand: Vec;
  color: number;
  faction?: FactionId;
}

export interface HubLayout {
  /** The whole room, walls included. */
  bounds: Rect;
  /** Where the avatar may walk. */
  floor: Rect;
  /** The shell, for drawing (the floor rectangle already keeps the avatar in). The east wall has a gap for the training door. */
  walls: Rect[];
  /** Solids standing on the floor: kiosks and pillars. */
  obstacles: Rect[];
  stations: HubStation[];
  spawn: Vec;
}

/** The avatar triggers a station when its centre is this close to the station's footprint. */
export const INTERACT_REACH = PLAYER_RADIUS + 20;

const COLS = 28;
const ROWS = 18;
const W = COLS * TILE;
const H = ROWS * TILE;
const CX = W / 2;

const KIOSK_W = 56;
const KIOSK_D = 64;
const DOOR_H = 96;
const PEDESTAL = 48;

function kiosk(id: HubStationId, label: string, verb: string, color: number, cy: number): HubStation {
  return {
    id, kind: "kiosk", label, verb, key: "E", x: TILE + KIOSK_W / 2, y: cy, w: KIOSK_W, h: KIOSK_D,
    stand: { x: TILE + KIOSK_W + 24, y: cy }, color,
  };
}

/** One pedestal per faction, left to right in FACTION_IDS order, on a shallow arc near the south wall. */
const PEDESTAL_SPOTS: ReadonlyArray<Vec> = [
  { x: CX - 200, y: 456 }, { x: CX - 100, y: 492 }, { x: CX, y: 504 }, { x: CX + 100, y: 492 }, { x: CX + 200, y: 456 },
];

function pedestals(): HubStation[] {
  return FACTION_IDS.map((faction, i) => {
    const at = PEDESTAL_SPOTS[i]!;
    return {
      id: `faction:${faction}`, kind: "pedestal", label: FACTIONS[faction].displayName.toUpperCase(),
      verb: `Pick ${FACTIONS[faction].displayName}`, key: "E", x: at.x, y: at.y, w: PEDESTAL, h: PEDESTAL,
      stand: { x: at.x, y: at.y }, color: FACTIONS[faction].color, faction,
    } satisfies HubStation;
  });
}

const STATIONS: HubStation[] = [
  {
    id: "arena", kind: "stairs", label: "THE ARENA", verb: "Enter the arena", key: "E",
    x: CX, y: TILE / 2, w: 160, h: TILE, stand: { x: CX, y: TILE + 24 }, color: 0xc8b48a,
  },
  {
    id: "training", kind: "door", label: "TRAINING GROUNDS", verb: "Train", key: "E",
    x: W - TILE / 2, y: H / 2, w: TILE, h: DOOR_H, stand: { x: W - TILE - 24, y: H / 2 }, color: 0xff8a65,
  },
  kiosk("shop", "SHOP", "Shop", 0xffb300, 100),
  kiosk("wardrobe", "WARDROBE", "Wardrobe", 0x8e24aa, 204),
  kiosk("achievements", "ACHIEVEMENTS", "Achievements", 0xffd54f, 308),
  kiosk("leaderboard", "LEADERBOARD", "Leaderboard", 0x00acc1, 412),
  {
    id: "counters", kind: "decal", label: "COUNTER WHEEL", verb: "Counter wheel", key: "E",
    x: CX, y: H / 2, w: 440, h: 160, stand: { x: CX, y: H / 2 }, color: 0xffe082,
  },
  ...pedestals(),
];

// The southern pair sits low enough that the east-facing kiosk labels clear their flames.
const PILLAR = 32;
const PILLARS: Rect[] = [
  { x: 136, y: 128, w: PILLAR, h: PILLAR }, { x: W - 136 - PILLAR, y: 128, w: PILLAR, h: PILLAR },
  { x: 136, y: 472, w: PILLAR, h: PILLAR }, { x: W - 136 - PILLAR, y: 472, w: PILLAR, h: PILLAR },
];

export function stationRect(s: HubStation): Rect {
  return { x: s.x - s.w / 2, y: s.y - s.h / 2, w: s.w, h: s.h };
}

/** Ground gap between a kiosk's east face and the start of its sign. */
export const KIOSK_LABEL_GAP = 8;

/**
 * Where a kiosk's sign starts: just east of its counter, on the counter's centre line (ground coordinates; the scene
 * left-aligns the text there and lifts it to the middle of the prop). Kiosks stand a counter apart, so a sign above one
 * would sit on the kiosk above it; to the east there is only the walkway.
 */
export function kioskLabelAnchor(s: HubStation): Vec {
  return { x: s.x + s.w / 2 + KIOSK_LABEL_GAP, y: s.y };
}

function buildLayout(): HubLayout {
  const door = STATIONS.find((s) => s.id === "training")!;
  const doorTop = door.y - door.h / 2;
  const doorBottom = door.y + door.h / 2;
  const kiosks = STATIONS.filter((s) => s.kind === "kiosk").map(stationRect);
  return {
    bounds: { x: 0, y: 0, w: W, h: H },
    floor: { x: TILE, y: TILE, w: W - 2 * TILE, h: H - 2 * TILE },
    walls: [
      { x: 0, y: 0, w: W, h: TILE },
      { x: 0, y: TILE, w: TILE, h: H - 2 * TILE },
      { x: W - TILE, y: TILE, w: TILE, h: doorTop - TILE },
      { x: W - TILE, y: doorBottom, w: TILE, h: H - TILE - doorBottom },
      { x: 0, y: H - TILE, w: W, h: TILE },
    ],
    obstacles: [...kiosks, ...PILLARS],
    stations: STATIONS,
    spawn: { x: CX, y: 408 },
  };
}

export const HUB_LAYOUT: HubLayout = buildLayout();

export function spawnPoint(layout: HubLayout): Vec {
  return { x: layout.spawn.x, y: layout.spawn.y };
}

export function stationById(layout: HubLayout, id: HubStationId): HubStation | undefined {
  return layout.stations.find((s) => s.id === id);
}

/** The station for a "faction:<id>" station id, or null for any other. */
export function factionOfStation(id: HubStationId): FactionId | null {
  if (!id.startsWith("faction:")) return null;
  const faction = id.slice("faction:".length);
  return (FACTION_IDS as readonly string[]).includes(faction) ? (faction as FactionId) : null;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** True when a circle of `radius` centred on `pos` is on the floor and its centre is not inside an obstacle grown by `radius`. */
export function isFree(pos: Vec, radius: number, layout: HubLayout): boolean {
  const f = layout.floor;
  if (pos.x < f.x + radius || pos.x > f.x + f.w - radius || pos.y < f.y + radius || pos.y > f.y + f.h - radius) return false;
  for (const o of layout.obstacles) {
    if (pos.x > o.x - radius && pos.x < o.x + o.w + radius && pos.y > o.y - radius && pos.y < o.y + o.h + radius) return false;
  }
  return true;
}

/** A start that is off the floor or inside a solid (a window resize can't do this, but a bad caller could) is pushed to the nearest free edge. */
function settle(pos: Vec, radius: number, layout: HubLayout): Vec {
  const f = layout.floor;
  let x = clamp(pos.x, f.x + radius, f.x + f.w - radius);
  let y = clamp(pos.y, f.y + radius, f.y + f.h - radius);
  for (const o of layout.obstacles) {
    const x0 = o.x - radius;
    const x1 = o.x + o.w + radius;
    const y0 = o.y - radius;
    const y1 = o.y + o.h + radius;
    if (x <= x0 || x >= x1 || y <= y0 || y >= y1) continue;
    const toLeft = x - x0;
    const toRight = x1 - x;
    const toTop = y - y0;
    const toBottom = y1 - y;
    const least = Math.min(toLeft, toRight, toTop, toBottom);
    if (least === toLeft) x = x0;
    else if (least === toRight) x = x1;
    else if (least === toTop) y = y0;
    else y = y1;
  }
  return { x, y };
}

/** Moves along x from (x, y) by dx, stopping at the first obstacle face in the way and at the floor edge. */
function sweepX(x: number, y: number, dx: number, radius: number, layout: HubLayout): number {
  let nx = x + dx;
  for (const o of layout.obstacles) {
    if (y <= o.y - radius || y >= o.y + o.h + radius) continue;
    const x0 = o.x - radius;
    const x1 = o.x + o.w + radius;
    if (dx > 0 && x <= x0 && nx > x0) nx = x0;
    else if (dx < 0 && x >= x1 && nx < x1) nx = x1;
  }
  const f = layout.floor;
  return clamp(nx, f.x + radius, f.x + f.w - radius);
}

function sweepY(x: number, y: number, dy: number, radius: number, layout: HubLayout): number {
  let ny = y + dy;
  for (const o of layout.obstacles) {
    if (x <= o.x - radius || x >= o.x + o.w + radius) continue;
    const y0 = o.y - radius;
    const y1 = o.y + o.h + radius;
    if (dy > 0 && y <= y0 && ny > y0) ny = y0;
    else if (dy < 0 && y >= y1 && ny < y1) ny = y1;
  }
  const f = layout.floor;
  return clamp(ny, f.y + radius, f.y + f.h - radius);
}

/**
 * Where a circle of `radius` at `pos` ends up after moving by `delta`: each axis is swept on its own (x, then y), so a
 * move against a wall slides along it, and a delta of any size stops at the first face instead of tunnelling through.
 * Obstacles are grown by `radius` (the avatar is treated as a square, which is generous at corners and never wrong
 * enough to matter in a hub). Does not mutate `pos`.
 */
export function moveWithCollision(pos: Vec, delta: Vec, radius: number, layout: HubLayout): Vec {
  const start = settle(pos, radius, layout);
  const x = sweepX(start.x, start.y, delta.x, radius, layout);
  const y = sweepY(x, start.y, delta.y, radius, layout);
  return { x, y };
}

/** Distance from `pos` to the station's footprint: 0 inside it. */
export function distanceToStation(pos: Vec, s: HubStation): number {
  const r = stationRect(s);
  const dx = Math.max(r.x - pos.x, 0, pos.x - (r.x + r.w));
  const dy = Math.max(r.y - pos.y, 0, pos.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** The station closest to `pos` within `reach` (ties go to the earlier one in the layout), or null. */
export function nearestStation(pos: Vec, layout: HubLayout, reach = INTERACT_REACH): HubStation | null {
  let best: HubStation | null = null;
  let bestDistance = Infinity;
  for (const s of layout.stations) {
    const d = distanceToStation(pos, s);
    if (d <= reach && d < bestDistance) {
      best = s;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * The start edge of the view along one axis, in world pixels. When the room (`lo`..`hi`) fits in `viewSize` it is
 * centred; otherwise the view follows `focus` and never shows past either end of the room.
 */
export function frameAxis(focus: number, viewSize: number, lo: number, hi: number): number {
  if (hi - lo <= viewSize) return (lo + hi) / 2 - viewSize / 2;
  return clamp(focus - viewSize / 2, lo, hi - viewSize);
}
