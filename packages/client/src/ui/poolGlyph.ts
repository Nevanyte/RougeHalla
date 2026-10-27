// A skill pool's mark: a zone's own marker shape (the one its camps and buffs wear) in the zone's colour, a plain disc for the
// neutral pool. Used by the chest panel's cards and the passives row, so a skill's zone is told by shape and by words, not by
// hue alone.
import { isFactionId } from "@raid/shared";
import { zoneClipPath, zoneColor } from "./mapPainter";

/** The neutral pool's colour. */
export const NEUTRAL_COLOR = "#cfd5dc";

/** Styles `node` (an empty inline-block span) as the pool's mark. */
export function setPoolGlyph(node: HTMLElement, pool: string): void {
  if (isFactionId(pool)) {
    node.style.setProperty("clip-path", zoneClipPath(pool));
    node.style.setProperty("background", zoneColor(pool));
    node.style.setProperty("border-radius", "0");
  } else {
    node.style.setProperty("clip-path", "");
    node.style.setProperty("background", NEUTRAL_COLOR);
    node.style.setProperty("border-radius", "50%");
  }
}
