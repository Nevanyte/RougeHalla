// The Wish icons: one small coloured shape per `AbilityIcon`, no assets. `abilityIconPoints` is the pure silhouette (the
// HUD's CSS icon uses the same shape names); `drawAbilityIcon` fills it and adds a detail or two. A Wish that is not ready
// (cooling down, or locked for the first 45 s) is drawn in grey and dimmed, so a glance at a fighter's name tells whether
// its Wish is up.
import type Phaser from "phaser";
import type { AbilityDef, AbilityIcon } from "@raid/shared";

/** A Wish that is not ready: a blue-grey, dimmed. */
export const ICON_GREY = 0x607d8b;
export const ICON_GREY_ALPHA = 0.6;
const ICON_EDGE = 0x1b1f24;
/** Detail colours: light on a ready icon, a paler grey on one that is not. */
const DETAIL_READY = 0xfff8e1;
const DETAIL_GREY = 0xb0bec5;

/** A regular star with `tips` points, outer radius 1 and inner radius `inner`, point up. */
function star(tips: number, inner: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < tips * 2; i++) {
    const r = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / tips;
    out.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return out;
}

/** Silhouettes in the unit box [-1, 1] x [-1, 1], y down (screen), centred on the origin. */
const UNIT: Readonly<Record<AbilityIcon, readonly number[]>> = {
  snowflake: star(6, 0.42),
  // A hive cell: pointy-top hexagon.
  swarm: star(3, 1),
  // The balance's beam, post and foot (the pans hang from the beam's ends, drawn separately).
  scales: [
    -1, -0.8, 1, -0.8, 1, -0.55, 0.12, -0.55, 0.12, 0.7, 0.55, 0.7, 0.55, 0.92, -0.55, 0.92, -0.55, 0.7, -0.12, 0.7, -0.12, -0.55,
    -1, -0.55,
  ],
  // A teardrop flame: tip up, belly down, a notch on the left.
  flame: [
    0, -1, 0.3, -0.5, 0.62, -0.12, 0.58, 0.42, 0.28, 0.86, 0, 0.98, -0.28, 0.86, -0.58, 0.42, -0.6, 0.0, -0.32, -0.18, -0.2, -0.55,
  ],
  // A plain cross: arms a little over half the box wide.
  cross: [
    -0.3, -1, 0.3, -1, 0.3, -0.3, 1, -0.3, 1, 0.3, 0.3, 0.3, 0.3, 1, -0.3, 1, -0.3, 0.3, -1, 0.3, -1, -0.3, -0.3, -0.3,
  ],
};

/** The silhouette of `icon` for a box `size` px wide, as x0, y0, x1, y1, ... around (0, 0) (y down). A copy: the caller may keep it. */
export function abilityIconPoints(icon: AbilityIcon, size: number): number[] {
  const half = size / 2;
  const unit = UNIT[icon] ?? UNIT.cross;
  return unit.map((v) => v * half);
}

/** The pans of the scales: two triangles hanging from the beam's ends, in the unit box. */
const PANS: ReadonlyArray<readonly number[]> = [
  [-0.82, -0.55, -0.4, 0.15, -1, 0.15],
  [0.82, -0.55, 1, 0.15, 0.4, 0.15],
];

/**
 * Draws `ability`'s icon centred on (x, y) in `g`'s local space, in a box `size` px wide. The caller clears `g` first (the
 * icon is redrawn only when something changed). `ready`: the ability's own colour at full strength; else grey at 0.6.
 */
export function drawAbilityIcon(g: Phaser.GameObjects.Graphics, ability: AbilityDef, x: number, y: number, size: number, ready: boolean): void {
  const color = ready ? ability.color : ICON_GREY;
  const alpha = ready ? 1 : ICON_GREY_ALPHA;
  const detail = ready ? DETAIL_READY : DETAIL_GREY;
  const half = size / 2;
  g.fillStyle(color, alpha).lineStyle(1, ICON_EDGE, ready ? 0.9 : 0.6);
  trace(g, abilityIconPoints(ability.icon, size), x, y);
  g.fillPath().strokePath();
  switch (ability.icon) {
    case "snowflake":
      g.fillStyle(detail, alpha).fillCircle(x, y, half * 0.18);
      break;
    case "swarm":
      // Three bees in the cell.
      g.fillStyle(ICON_EDGE, ready ? 0.85 : 0.5);
      g.fillCircle(x - half * 0.32, y - half * 0.14, half * 0.17).fillCircle(x + half * 0.32, y - half * 0.14, half * 0.17)
        .fillCircle(x, y + half * 0.34, half * 0.17);
      break;
    case "scales":
      g.fillStyle(color, alpha).lineStyle(1, ICON_EDGE, ready ? 0.9 : 0.6);
      for (const pan of PANS) {
        g.beginPath().moveTo(x + pan[0]! * half, y + pan[1]! * half).lineTo(x + pan[2]! * half, y + pan[3]! * half)
          .lineTo(x + pan[4]! * half, y + pan[5]! * half).closePath().fillPath().strokePath();
      }
      break;
    case "flame":
      // The hot core inside the flame.
      g.fillStyle(detail, alpha * 0.9).beginPath().moveTo(x, y - half * 0.2).lineTo(x + half * 0.26, y + half * 0.3)
        .lineTo(x, y + half * 0.7).lineTo(x - half * 0.26, y + half * 0.3).closePath().fillPath();
      break;
    case "cross":
      break;
  }
}

function trace(g: Phaser.GameObjects.Graphics, pts: readonly number[], ox: number, oy: number): void {
  g.beginPath();
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (i === 0) g.moveTo(ox + pts[i]!, oy + pts[i + 1]!);
    else g.lineTo(ox + pts[i]!, oy + pts[i + 1]!);
  }
  g.closePath();
}
