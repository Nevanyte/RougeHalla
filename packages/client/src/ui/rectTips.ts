// Tooltips for HUD elements that must never take the pointer (the cards row, the build strip, the weapon bar): a right-click move and a
// left-click lock under them must reach the canvas and the aim keeps streaming, so :hover is out. The pointer's client point is tested
// against the elements' rectangles instead, on window listeners that are passive and never stop or cancel anything. The owner decides how
// a tip looks (`onChange` gets the index under the pointer, or -1); this only finds it. Rectangles are read again after a change
// (`invalidate`), a resize, or when the container has moved or resized (the plate above it wrapped).
export interface RectTipsOptions {
  /** The box all the items sit in: its rectangle is the cheap "has anything moved" key. */
  container: () => HTMLElement;
  /** The elements, in the order the owner numbers them. */
  items: () => readonly HTMLElement[];
  /** False while the owner is hidden: no tip is shown then. */
  active: () => boolean;
  /** The element under the pointer changed: its index, or -1 for none. */
  onChange: (index: number) => void;
}

interface Rect { left: number; top: number; right: number; bottom: number }

/** The pointer is over the world (the canvas sits outside #ui), not over a panel of the interface. */
export function isWorldTarget(target: EventTarget | null): boolean {
  const t = target as { closest?: (selector: string) => unknown } | null;
  return t !== null && !(typeof t.closest === "function" && t.closest("#ui"));
}

export class RectTips {
  private at = -1;
  private rects: Array<Rect | null> = [];
  private dirty = true;
  private key = "";

  constructor(private readonly o: RectTipsOptions) {
    if (typeof window === "undefined") return;
    window.addEventListener("pointermove", this.onMove, { passive: true });
    window.addEventListener("pointerout", this.onOut, { passive: true });
    window.addEventListener("blur", this.hide);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("resize", this.invalidate);
  }

  /** The index shown now (-1: none). */
  get index(): number {
    return this.at;
  }

  /** The items changed or were repainted: read the rectangles again and forget what is shown (the owner has reset its tips). */
  reset(): void {
    this.dirty = true;
    this.at = -1;
  }

  readonly invalidate = (): void => {
    this.dirty = true;
  };

  /** Hides the tip. */
  readonly hide = (): void => {
    this.set(-1);
  };

  destroy(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerout", this.onOut);
    window.removeEventListener("blur", this.hide);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("resize", this.invalidate);
  }

  private itemAt(x: number, y: number): number {
    const box = this.o.container().getBoundingClientRect();
    const key = `${box.left},${box.top},${box.width},${box.height}`;
    if (this.dirty || key !== this.key) {
      this.key = key;
      this.dirty = false;
      this.rects = this.o.items().map((it) => {
        const r = it.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height };
      });
    }
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      if (r && x >= r.left && x < r.right && y >= r.top && y < r.bottom) return i;
    }
    return -1;
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.o.active() || !isWorldTarget(e.target)) {
      if (this.at >= 0) this.set(-1);
      return;
    }
    this.set(this.itemAt(e.clientX, e.clientY));
  };

  private readonly onOut = (e: PointerEvent): void => {
    if (!e.relatedTarget) this.set(-1);
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code === "Escape" || e.key === "Escape") this.set(-1);
  };

  private set(i: number): void {
    if (i === this.at) return;
    this.at = i;
    this.o.onChange(i);
  }
}
