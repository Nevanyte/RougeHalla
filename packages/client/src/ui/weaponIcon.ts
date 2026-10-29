import type Phaser from "phaser";
import type { WeaponId } from "@raid/shared";
import { drawWeapon, weaponCenterX } from "../render/FighterArt";
import { cssColor, el } from "./dom";
import "./weaponIcon.css";

const svgCache = new Map<WeaponId, string>();
const urlCache = new Map<WeaponId, string>();
const n = (value: number): string => String(Math.round(value * 1000) / 1000);

/** The static Graphics operations used by the game's resting weapon drawings, rendered as SVG. */
class WeaponSvg {
  readonly shapes: string[] = [];
  private fill = "#ffffff";
  private fillAlpha = 1;
  private stroke = "#ffffff";
  private strokeAlpha = 1;
  private width = 1;
  private path: string[] = [];

  fillStyle(color: number, alpha = 1): this { this.fill = cssColor(color); this.fillAlpha = alpha; return this; }
  lineStyle(width: number, color: number, alpha = 1): this { this.width = width; this.stroke = cssColor(color); this.strokeAlpha = alpha; return this; }
  beginPath(): this { this.path = []; return this; }
  moveTo(x: number, y: number): this { this.path.push(`M${n(x)} ${n(y)}`); return this; }
  lineTo(x: number, y: number): this { this.path.push(`L${n(x)} ${n(y)}`); return this; }
  closePath(): this { this.path.push("Z"); return this; }
  arc(x: number, y: number, radius: number, start: number, end: number): this {
    const point = `${n(x + Math.cos(start) * radius)} ${n(y + Math.sin(start) * radius)}`;
    this.path.push(`${this.path.length ? "L" : "M"}${point}`, `A${n(radius)} ${n(radius)} 0 ${Math.abs(end - start) > Math.PI ? 1 : 0} 1 ${n(x + Math.cos(end) * radius)} ${n(y + Math.sin(end) * radius)}`);
    return this;
  }
  fillPath(): this { return this.shape("path", `d="${this.path.join(" ")}"`, false); }
  strokePath(): this { return this.shape("path", `d="${this.path.join(" ")}"`, true); }
  fillRect(x: number, y: number, width: number, height: number): this { return this.rect(x, y, width, height, false); }
  strokeRect(x: number, y: number, width: number, height: number): this { return this.rect(x, y, width, height, true); }
  fillCircle(x: number, y: number, radius: number): this { return this.circle(x, y, radius, false); }
  strokeCircle(x: number, y: number, radius: number): this { return this.circle(x, y, radius, true); }
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this {
    return this.shape("polygon", `points="${n(x1)},${n(y1)} ${n(x2)},${n(y2)} ${n(x3)},${n(y3)}"`, false);
  }
  lineBetween(x1: number, y1: number, x2: number, y2: number): this {
    return this.shape("line", `x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"`, true);
  }
  private rect(x: number, y: number, width: number, height: number, stroke: boolean): this {
    return this.shape("rect", `x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}"`, stroke);
  }
  private circle(x: number, y: number, radius: number, stroke: boolean): this {
    return this.shape("circle", `cx="${n(x)}" cy="${n(y)}" r="${n(radius)}"`, stroke);
  }
  private shape(tag: string, geometry: string, stroke: boolean): this {
    const paint = stroke
      ? `fill="none" stroke="${this.stroke}" stroke-opacity="${n(this.strokeAlpha)}" stroke-width="${n(this.width)}"`
      : `fill="${this.fill}" fill-opacity="${n(this.fillAlpha)}"`;
    this.shapes.push(`<${tag} ${geometry} ${paint}/>`);
    return this;
  }
}

/** Reuses FighterArt's exact resting silhouettes and palette, with no scene, canvas or texture allocation. */
export function weaponIconSvg(weapon: WeaponId): string {
  let svg = svgCache.get(weapon);
  if (svg) return svg;
  const drawing = new WeaponSvg();
  drawWeapon(drawing as unknown as Phaser.GameObjects.Graphics, weapon);
  svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${weaponCenterX(weapon) - 24} -20 48 40"><g stroke-linecap="round" stroke-linejoin="round">${drawing.shapes.join("")}</g></svg>`;
  svgCache.set(weapon, svg);
  return svg;
}

/** Decorative icon: the containing slot supplies its accessible weapon/slot/equipped label. */
export function weaponIcon(weapon: WeaponId): HTMLElement {
  const node = el("span", "weapon-icon");
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("data-weapon", weapon);
  let url = urlCache.get(weapon);
  if (!url) { url = `url("data:image/svg+xml,${encodeURIComponent(weaponIconSvg(weapon))}")`; urlCache.set(weapon, url); }
  node.style.setProperty("--weapon-icon", url);
  return node;
}
