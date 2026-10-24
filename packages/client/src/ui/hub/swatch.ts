// Previews of cosmetics as plain DOM + CSS (the hub has no canvas): a disc for a colour, a ring for an outline, fading
// dots for a trail, coloured text for a title, a gold disc for a golden look. Colours come from the shared catalog.
import {
  GOLD_COLOR, GOLD_EDGE, cssColor,
  type Cosmetic, type Look, type TrailStyle,
} from "@raid/shared";
import { el } from "../dom";

export type SwatchSize = "md" | "sm";

/** The local player's body colour when no skin is worn (PlayerView's LOCAL_COLOR; that module is Phaser-only). */
const DEFAULT_BODY = 0x4caf50;
const DEFAULT_EDGE = "2px solid rgba(17, 17, 17, 0.8)";
/** A neutral body for outline swatches, so the ring reads as an edge around something. */
const OUTLINE_BODY = "#59636e";

interface Piece { w: number; h: number; dy: number; a: number; turn: number }

/** Tail first, head last: the pieces nearest the body are the strongest. */
const TRAIL_PIECES: Record<TrailStyle, readonly Piece[]> = {
  dots: [
    { w: 3, h: 3, dy: 0, a: 0.25, turn: 0 }, { w: 4, h: 4, dy: 0, a: 0.5, turn: 0 },
    { w: 5, h: 5, dy: 0, a: 0.75, turn: 0 }, { w: 6, h: 6, dy: 0, a: 1, turn: 0 },
  ],
  streak: [
    { w: 12, h: 3, dy: 0, a: 0.25, turn: 0 }, { w: 10, h: 3, dy: 0, a: 0.5, turn: 0 },
    { w: 8, h: 3, dy: 0, a: 0.75, turn: 0 }, { w: 6, h: 3, dy: 0, a: 1, turn: 0 },
  ],
  sparks: [
    { w: 3, h: 3, dy: -5, a: 0.35, turn: 45 }, { w: 3, h: 3, dy: 4, a: 0.55, turn: 45 },
    { w: 4, h: 4, dy: -3, a: 0.8, turn: 45 }, { w: 4, h: 4, dy: 3, a: 1, turn: 45 },
  ],
};

/** The pieces of one trail, left to right (the body is on the right). `scale` sizes them for the big preview. */
function trailPieces(color: number, style: TrailStyle, scale: number): HTMLElement {
  const box = el("span", "sw-trail-pieces");
  const css = cssColor(color);
  for (const p of TRAIL_PIECES[style]) {
    const piece = el("span");
    const s = piece.style;
    s.width = `${p.w * scale}px`;
    s.height = `${p.h * scale}px`;
    s.background = css;
    s.opacity = String(p.a);
    s.borderRadius = style === "dots" ? "50%" : style === "streak" ? "2px" : "1px";
    s.transform = `translateY(${p.dy * scale}px) rotate(${p.turn}deg)`;
    box.append(piece);
  }
  return box;
}

function goldDisc(): HTMLElement {
  const disc = el("span", "sw-disc sw-gold");
  disc.style.background = cssColor(GOLD_COLOR);
  disc.style.borderColor = cssColor(GOLD_EDGE);
  return disc;
}

/** A small preview of any cosmetic. Its name is written next to it (a title is its own name), so the picture is hidden from screen readers. */
export function swatch(c: Cosmetic, size: SwatchSize = "md"): HTMLElement {
  const root = el("span", size === "sm" ? "sw sw-sm" : "sw");
  // A title swatch is its name in its own colour (nothing else says it), so only the pictures are decorative.
  if (c.slot !== "title") root.setAttribute("aria-hidden", "true");
  if (c.slot === "skin") {
    const disc = el("span", "sw-disc");
    disc.style.background = cssColor(c.color);
    root.append(disc);
  } else if (c.slot === "outline") {
    const ring = el("span", "sw-disc sw-ring");
    ring.style.background = OUTLINE_BODY;
    ring.style.border = `${size === "sm" ? Math.min(c.width, 3) : c.width}px solid ${cssColor(c.color)}`;
    root.append(ring);
  } else if (c.slot === "trail") {
    root.classList.add("sw-wide");
    root.append(trailPieces(c.color, c.style, size === "sm" ? 0.8 : 1));
  } else if (c.slot === "title") {
    root.classList.add("sw-text");
    root.textContent = c.text;
    root.style.color = cssColor(c.color);
  } else {
    root.append(goldDisc());
  }
  return root;
}

/** The player as others see them: body, outline, trail behind, title under the feet, and the golden looks owned. */
export class AvatarPreview {
  readonly root = el("div", "avatar");
  private readonly body = el("span", "avatar-body");
  private readonly trail = el("span", "avatar-trail");
  private readonly title = el("div", "avatar-title");
  private readonly gold = el("div", "avatar-gold");

  constructor() {
    const stage = el("div", "avatar-stage");
    const row = el("div", "avatar-row");
    this.body.append(el("span", "avatar-nose"));
    row.append(this.trail, this.body);
    stage.append(row, this.title);
    this.root.append(stage, this.gold);
    this.root.setAttribute("role", "img");
  }

  update(look: Look): void {
    this.body.style.background = cssColor(look.skin ? look.skin.color : DEFAULT_BODY);
    this.body.style.border = look.outline ? `${look.outline.width * 1.5}px solid ${cssColor(look.outline.color)}` : DEFAULT_EDGE;
    this.trail.replaceChildren(...(look.trail ? [trailPieces(look.trail.color, look.trail.style, 2)] : []));

    this.title.hidden = !look.title;
    this.title.textContent = look.title?.text ?? "";
    this.title.style.color = look.title ? cssColor(look.title.color) : "";

    this.gold.hidden = look.gold.length === 0;
    this.gold.replaceChildren(
      ...look.gold.map((g) => {
        const chip = el("span", "avatar-gold-chip");
        chip.append(swatch(g, "sm"), el("span", undefined, g.name));
        return chip;
      }),
    );

    const parts = [look.skin?.name ?? "Default colour", look.outline?.name, look.trail?.name, look.title?.text, ...look.gold.map((g) => g.name)];
    this.root.setAttribute("aria-label", `Preview: ${parts.filter(Boolean).join(", ")}`);
  }
}
