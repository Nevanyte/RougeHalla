// How the hub looks: the room shell, the props and the counter-wheel decal, all coloured shapes drawn into Phaser
// Graphics in the 2.5D projection (ground squashed by Y_SCALE, height drawn upward). Draw functions take ground
// coordinates and project them; HubScene decides depths, labels and what animates.
import type Phaser from "phaser";
import { Y_SCALE, type Wheel } from "@raid/shared";
import { stationRect, type HubLayout, type HubStation, type Rect } from "./hubLayout";
import { projX, projY } from "../render/projection";

type Gfx = Phaser.GameObjects.Graphics;

/** Screen pixels the back wall rises. The side walls and the front ledge stay low so they never hide the floor behind them. */
export const WALL_HEIGHT_NORTH = 64;
const WALL_HEIGHT_SIDE = 22;
const WALL_HEIGHT_SOUTH = 8;
export const KIOSK_HEIGHT = 26;
export const PILLAR_HEIGHT = 40;
export const STEP_COUNT = 5;
export const STEP_RISE = 7;
export const PORTAL_HEIGHT = 24;
export const GEM_LIFT = 34;

const FLOOR_A = 0x2a323d;
const FLOOR_B = 0x2e3743;
const WALL_FRONT = 0x48505c;
const WALL_TOP = 0x707986;
const TRIM = 0xc8b48a;
const EDGE = 0x12161b;

/** Mixes `color` toward white (amount > 0) or black (amount < 0). */
export function shade(color: number, amount: number): number {
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  const ch = (shift: number): number => Math.round(((color >> shift) & 255) * (1 - t) + target * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A block on the ground: footprint (x, y, w, d) with `height` screen pixels of front face under a lifted top face. */
function box(g: Gfx, x: number, y: number, w: number, d: number, height: number, top: number, front: number): void {
  g.fillStyle(front, 1).fillRect(projX(x), projY(y + d) - height, w, height);
  g.fillStyle(top, 1).fillRect(projX(x), projY(y) - height, w, d * Y_SCALE);
  g.lineStyle(1, EDGE, 0.5).strokeRect(projX(x), projY(y) - height, w, d * Y_SCALE + height);
}

/** The floor and the ring of walls. Everything stands on top of it, so the whole shell draws on the floor layer. */
export function drawShell(g: Gfx, layout: HubLayout): void {
  const f = layout.floor;
  for (let ty = 0; ty * 32 < f.h; ty++) {
    for (let tx = 0; tx * 32 < f.w; tx++) {
      g.fillStyle((tx + ty) % 2 === 0 ? FLOOR_A : FLOOR_B, 1).fillRect(projX(f.x + tx * 32), projY(f.y + ty * 32), 32, 32 * Y_SCALE);
    }
  }
  g.lineStyle(2, EDGE, 0.6).strokeRect(projX(f.x), projY(f.y), f.w, f.h * Y_SCALE);

  // North to south, so a wall in front paints over the one behind it.
  const pieces = [...layout.walls].sort((a, b) => a.y + a.h - (b.y + b.h));
  for (const w of pieces) {
    const north = w.y === layout.bounds.y;
    const south = w.y + w.h === layout.bounds.y + layout.bounds.h;
    const height = north ? WALL_HEIGHT_NORTH : south ? WALL_HEIGHT_SOUTH : WALL_HEIGHT_SIDE;
    box(g, w.x, w.y, w.w, w.h, height, WALL_TOP, WALL_FRONT);
    if (north) drawBackWallDetail(g, w);
  }
}

/** Stone courses and a sand trim along the top of the tall back wall. */
function drawBackWallDetail(g: Gfx, w: Rect): void {
  const base = projY(w.y + w.h);
  g.lineStyle(1, EDGE, 0.28);
  for (let row = 1; row * 16 < WALL_HEIGHT_NORTH; row++) {
    const y = base - row * 16;
    g.lineBetween(projX(w.x), y, projX(w.x + w.w), y);
    for (let x = w.x + (row % 2 === 0 ? 0 : 24); x < w.x + w.w; x += 48) g.lineBetween(projX(x), y, projX(x), y + 16);
  }
  g.fillStyle(TRIM, 0.8).fillRect(projX(w.x), base - WALL_HEIGHT_NORTH, w.w, 3);
}

/** Runner from the stairs and the plate under the counter wheel. */
export function drawFloorDecor(g: Gfx, layout: HubLayout): void {
  const stairs = layout.stations.find((s) => s.kind === "stairs");
  const wheel = layout.stations.find((s) => s.kind === "decal");
  if (stairs && wheel) {
    const top = stairs.y + stairs.h / 2;
    const bottom = wheel.y - wheel.h / 2;
    g.fillStyle(0x5a2a30, 0.9).fillRect(projX(stairs.x - 32), projY(top), 64, (bottom - top) * Y_SCALE);
    g.lineStyle(2, TRIM, 0.55).strokeRect(projX(stairs.x - 32), projY(top), 64, (bottom - top) * Y_SCALE);
  }
  if (wheel) {
    const r = stationRect(wheel);
    g.fillStyle(0x222933, 0.95).fillRoundedRect(projX(r.x), projY(r.y), r.w, r.h * Y_SCALE, 18);
    g.lineStyle(2, TRIM, 0.4).strokeRoundedRect(projX(r.x), projY(r.y), r.w, r.h * Y_SCALE, 18);
  }
}

/** Stairs climbing into the back wall, a lit portal at the top and a banner on either side. */
export function drawStairs(g: Gfx, s: HubStation, layout: HubLayout): void {
  const r = stationRect(s);
  const base = projY(layout.floor.y);
  const rise = STEP_COUNT * STEP_RISE;
  const cx = projX(s.x);

  g.fillStyle(0x1a1410, 1).fillRect(projX(r.x) - 8, base - rise - PORTAL_HEIGHT - 6, r.w + 16, rise + PORTAL_HEIGHT + 6);
  g.fillStyle(0xfff3c4, 0.92).fillRect(cx - 28, base - rise - PORTAL_HEIGHT, 56, PORTAL_HEIGHT);
  g.fillEllipse(cx, base - rise - PORTAL_HEIGHT, 56, 22);
  g.fillStyle(0xffffff, 0.35).fillEllipse(cx, base - rise - PORTAL_HEIGHT * 0.5, 30, 14);
  for (let k = 0; k < STEP_COUNT; k++) {
    const inset = k * STEP_RISE;
    const y = base - (k + 1) * STEP_RISE;
    g.fillStyle(shade(0x8c7c58, k * 0.05), 1).fillRect(projX(r.x) + inset, y + 3, r.w - 2 * inset, STEP_RISE - 3);
    g.fillStyle(shade(0xc2b184, k * 0.05), 1).fillRect(projX(r.x) + inset, y, r.w - 2 * inset, 3);
  }
  g.fillStyle(TRIM, 1).fillRect(projX(r.x) - 8, base - rise - PORTAL_HEIGHT - 6, 8, rise + PORTAL_HEIGHT + 6);
  g.fillRect(projX(r.x + r.w), base - rise - PORTAL_HEIGHT - 6, 8, rise + PORTAL_HEIGHT + 6);

  for (const bx of [projX(r.x) - 34, projX(r.x + r.w) + 18]) {
    g.fillStyle(0x8e2a2a, 1).fillRect(bx, base - 58, 16, 40);
    g.fillTriangle(bx, base - 18, bx + 16, base - 18, bx + 8, base - 8);
    g.fillStyle(TRIM, 0.9).fillRect(bx, base - 58, 16, 3).fillCircle(bx + 8, base - 38, 3.5);
  }
}

/** The opening in the east wall: a dark threshold with a glowing orange rim and a frame post at each end. */
export function drawDoor(g: Gfx, s: HubStation): void {
  const r = stationRect(s);
  g.fillStyle(0x0e1115, 1).fillRect(projX(r.x), projY(r.y), r.w, r.h * Y_SCALE);
  g.fillStyle(s.color, 0.22).fillRect(projX(r.x), projY(r.y), r.w, r.h * Y_SCALE);
  g.fillStyle(s.color, 0.55).fillRect(projX(r.x), projY(r.y), 4, r.h * Y_SCALE);
  box(g, r.x, r.y - 8, r.w, 8, 34, shade(s.color, 0.25), shade(s.color, -0.2));
  box(g, r.x, r.y + r.h, r.w, 8, 34, shade(s.color, 0.25), shade(s.color, -0.2));
}

/** A counter in the station's colour with a prop on top that says what it is for. */
export function drawKiosk(g: Gfx, s: HubStation): void {
  const r = stationRect(s);
  box(g, r.x, r.y, r.w, r.h, KIOSK_HEIGHT, shade(s.color, -0.15), shade(s.color, -0.5));
  const x = projX(s.x);
  const y = projY(s.y) - KIOSK_HEIGHT;
  switch (s.id) {
    case "shop":
      for (let i = 0; i < 7; i++) {
        g.fillStyle(i % 2 === 0 ? s.color : 0xffffff, 1).fillRect(x - 28 + i * 8, y - 34, 8, 14);
        g.fillTriangle(x - 28 + i * 8, y - 20, x - 20 + i * 8, y - 20, x - 24 + i * 8, y - 14);
      }
      g.fillStyle(0x5d4037, 1).fillRect(x - 28, y - 20, 3, 24).fillRect(x + 25, y - 20, 3, 24);
      g.fillStyle(0xffd54f, 1).fillCircle(x, y - 2, 5);
      g.lineStyle(1.5, EDGE, 0.8).strokeCircle(x, y - 2, 5);
      break;
    case "wardrobe":
      g.fillStyle(shade(s.color, -0.3), 1).fillRect(x - 15, y - 46, 30, 48);
      g.fillStyle(0xd1c4e9, 1).fillRect(x - 11, y - 42, 22, 40);
      g.fillStyle(0xffffff, 0.45).fillRect(x - 8, y - 40, 5, 34);
      g.lineStyle(1.5, EDGE, 0.7).strokeRect(x - 15, y - 46, 30, 48);
      break;
    case "achievements":
      g.fillStyle(s.color, 1).beginPath()
        .moveTo(x - 11, y - 30).lineTo(x + 11, y - 30).lineTo(x + 6, y - 14).lineTo(x - 6, y - 14).closePath().fillPath();
      g.fillRect(x - 2, y - 14, 4, 8).fillRect(x - 9, y - 6, 18, 5);
      g.lineStyle(2.5, s.color, 1).strokeCircle(x - 13, y - 24, 5).strokeCircle(x + 13, y - 24, 5);
      g.fillStyle(0xffffff, 0.6).fillRect(x - 6, y - 28, 3, 10);
      break;
    case "leaderboard":
      g.fillStyle(s.color, 1).fillRect(x - 19, y - 24, 12, 24).fillRect(x - 5, y - 36, 12, 36).fillRect(x + 9, y - 16, 12, 16);
      g.fillStyle(0xffffff, 0.8).fillRect(x - 19, y - 24, 12, 3).fillRect(x - 5, y - 36, 12, 3).fillRect(x + 9, y - 16, 12, 3);
      g.lineStyle(1.5, EDGE, 0.7).strokeRect(x - 19, y - 24, 12, 24).strokeRect(x - 5, y - 36, 12, 36).strokeRect(x + 9, y - 16, 12, 16);
      break;
    default:
      break;
  }
}

export function drawPillar(g: Gfx, r: Rect): void {
  box(g, r.x, r.y, r.w, r.h, PILLAR_HEIGHT, 0x808996, 0x555d69);
  g.fillStyle(0x2b2118, 1).fillRect(projX(r.x) + 4, projY(r.y) - PILLAR_HEIGHT + 3, r.w - 8, r.h * Y_SCALE - 6);
}

/** A flame in local coordinates, base at the origin. */
export function drawFlame(g: Gfx): void {
  g.fillStyle(0xff7043, 0.95).beginPath().moveTo(-6, 0).lineTo(0, -18).lineTo(6, 0).closePath().fillPath();
  g.fillStyle(0xffee58, 0.95).beginPath().moveTo(-3, 0).lineTo(0, -10).lineTo(3, 0).closePath().fillPath();
}

/** The floor plate of a faction pedestal; `picked` lights it and ringed in white. */
export function drawPedestal(g: Gfx, s: HubStation, picked: boolean): void {
  const x = projX(s.x);
  const y = projY(s.y);
  g.fillStyle(EDGE, 0.8).fillEllipse(x, y + 3, s.w + 6, (s.w + 6) * Y_SCALE);
  g.fillStyle(0x2a313b, 1).fillEllipse(x, y, s.w, s.w * Y_SCALE);
  g.fillStyle(s.color, picked ? 0.6 : 0.26).fillEllipse(x, y, s.w * 0.72, s.w * 0.72 * Y_SCALE);
  g.lineStyle(3, s.color, 1).strokeEllipse(x, y, s.w, s.w * Y_SCALE);
  if (picked) g.lineStyle(2, 0xffffff, 0.95).strokeEllipse(x, y, s.w + 10, (s.w + 10) * Y_SCALE);
}

/** The faction gem that floats over a pedestal, in local coordinates around the origin. */
export function drawGem(g: Gfx, color: number): void {
  g.fillStyle(color, 1).beginPath().moveTo(0, -10).lineTo(8, 0).lineTo(0, 10).lineTo(-8, 0).closePath().fillPath();
  g.fillStyle(shade(color, 0.45), 1).beginPath().moveTo(0, -10).lineTo(8, 0).lineTo(0, 0).closePath().fillPath();
  g.lineStyle(1.5, EDGE, 0.8).beginPath().moveTo(0, -10).lineTo(8, 0).lineTo(0, 10).lineTo(-8, 0).closePath().strokePath();
}

/** A highlight ring around a station's footprint (and `lift` pixels above it, for props with height). */
export function drawStationRing(g: Gfx, s: HubStation, lift: number): void {
  const r = stationRect(s);
  g.lineStyle(2, 0xffe082, 1);
  if (s.kind === "pedestal") {
    g.strokeEllipse(projX(s.x), projY(s.y), s.w + 18, (s.w + 18) * Y_SCALE);
    return;
  }
  g.strokeRect(projX(r.x) - 3, projY(r.y) - lift - 3, r.w + 6, r.h * Y_SCALE + lift + 6);
}

/**
 * One pentagram of the counter wheel on the floor, centred on ground point (cx, cy). The pick is drawn big with a white
 * ring; the edges it wins are green and the edges it loses are red, as in the faction picker.
 */
export function drawWheel<Id extends string>(
  g: Gfx, wheel: Wheel<Id>, cx: number, cy: number, radius: number, color: (id: Id) => number, picked: Id | null,
): void {
  const at = new Map(wheel.nodes.map((n) => [n.id, { x: projX(cx + n.x * radius), y: projY(cy + n.y * radius) }]));
  g.lineStyle(1.5, 0x8d99a6, 0.3).strokeEllipse(projX(cx), projY(cy), radius * 2.5, radius * 2.5 * Y_SCALE);
  for (const e of wheel.edges) {
    const a = at.get(e.winner)!;
    const b = at.get(e.loser)!;
    let c = 0xaeb7c2;
    let width = 1;
    let alpha = e.kind === "diagonal" ? 0.5 : 0.28;
    if (picked !== null) {
      if (e.winner === picked) { c = 0x81c784; width = 2.5; alpha = 0.95; }
      else if (e.loser === picked) { c = 0xe57373; width = 2.5; alpha = 0.95; }
      else alpha *= 0.55;
    }
    g.lineStyle(width, c, alpha).lineBetween(a.x, a.y, b.x, b.y);
  }
  for (const n of wheel.nodes) {
    const p = at.get(n.id)!;
    const on = n.id === picked;
    const size = on ? 20 : 13;
    if (on) g.fillStyle(color(n.id), 0.3).fillEllipse(p.x, p.y, size + 14, (size + 14) * Y_SCALE);
    g.fillStyle(color(n.id), 1).fillEllipse(p.x, p.y, size, size * Y_SCALE);
    g.lineStyle(on ? 2.5 : 1.5, on ? 0xffffff : EDGE, on ? 1 : 0.8).strokeEllipse(p.x, p.y, size, size * Y_SCALE);
  }
}
