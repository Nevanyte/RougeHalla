import { VISION_RADIUS, Y_SCALE, type Vec2 } from "@raid/shared";
import { currentView } from "../view/viewState";
import { el, uiRoot } from "./dom";
import "./vision.css";

export interface EdgeThreat { x: number; y: number; hue: number; distance: number }
/** Ray/rectangle intersection uses projected bearing; distance and colour use the unsquashed ground. */
export function edgeThreat(origin: Vec2, enemy: Vec2, width: number, height: number, near = 150, far = VISION_RADIUS): EdgeThreat {
  const dx = enemy.x - origin.x, dy = (enemy.y - origin.y) * Y_SCALE;
  const distance = Math.hypot(dx, enemy.y - origin.y);
  if (dx === 0 && dy === 0) return { x: width / 2, y: 0, hue: 0, distance: 0 };
  // An axis with zero direction imposes no bound.
  const k = Math.min(dx === 0 ? Infinity : width / 2 / Math.abs(dx), dy === 0 ? Infinity : height / 2 / Math.abs(dy));
  return { x: width / 2 + dx * k, y: height / 2 + dy * k,
    hue: 120 * Math.max(0, Math.min(1, (distance - near) / Math.max(1, far - near))), distance };
}

/** Broad, diffuse independent edge glows; DOM never intercepts world input. */
export class EdgeThreatView {
  private readonly root = el("div", "edge-threats");
  private readonly dots: HTMLElement[] = [];
  constructor() { this.root.setAttribute("aria-hidden", "true"); uiRoot().append(this.root); }
  update(origin: Vec2 | undefined, enemies: readonly Vec2[]): void {
    const view = currentView();
    const w = view.uiW, h = view.uiH;
    let n = 0;
    if (origin) for (const enemy of enemies) {
      const p = edgeThreat(origin, enemy, w - 28, h - 28);
      const dot = this.dots[n] ?? el("i", "edge-threat");
      if (!this.dots[n]) { this.dots.push(dot); this.root.append(dot); }
      dot.hidden = false;
      dot.style.left = `${p.x + 14}px`; dot.style.top = `${p.y + 14}px`;
      dot.style.setProperty("--threat-color", `hsl(${p.hue} 95% 55%)`);
      n++;
    }
    for (; n < this.dots.length; n++) this.dots[n]!.hidden = true;
  }
  destroy(): void { this.root.remove(); this.dots.length = 0; }
}
