// Loot panel for the container the player is standing next to. F toggles it (wired by the scene); the panel
// follows the synced container, disables Take while the server would refuse it, and closes once the player
// has clearly walked away.
import { INTERACT_RANGE, INVENTORY_SLOTS, type GameMap } from "@raid/shared";
import type { ContainerState, PlayerState, RaidState } from "@raid/shared/schema";
import { canInteract } from "../render/interact";
import { el, uiRoot } from "./dom";
import { describeItem } from "./inventory";

/**
 * Past INTERACT_RANGE (or behind a wall) Take is disabled but the panel stays open; it only closes this much
 * further out, so skirting the edge of the range doesn't flicker it shut.
 */
const CLOSE_SLACK = 8;

export interface LootHandlers {
  onTake(containerId: string, uid: string): void;
}

interface Row {
  root: HTMLElement;
  take: HTMLButtonElement;
}

export class LootPanel {
  private readonly root = el("div", "loot-panel");
  private readonly title = el("span", "loot-title");
  private readonly kind = el("span", "loot-kind");
  /** Rows keyed by item uid. A click that straddles a re-render is lost, so rows are never rebuilt needlessly. */
  private readonly list = el("div", "loot-list");
  private readonly rows = new Map<string, Row>();
  private readonly emptyNote = el("div", "loot-empty", "Empty");
  private readonly rangeHint = el("div", "loot-hint loot-warn", "Move closer to take items");
  private readonly fullHint = el("div", "loot-hint loot-warn", "Inventory full — shift+click a slot to drop");
  private openId: string | null = null;
  private signature = "";

  constructor(private readonly handlers: LootHandlers) {
    const close = this.button("×", "loot-close");
    close.dataset.action = "close";
    close.title = "Close (F / Esc)";
    const head = el("div", "loot-head");
    head.append(this.title, this.kind, close);
    this.root.append(head, this.list, this.emptyNote, this.rangeHint, this.fullHint, el("div", "loot-hint", "F or Esc to close"));

    this.root.addEventListener("click", (e) => this.onClick(e));
    // Keep focus where it was so Space/Enter can't re-press a button that was just clicked.
    this.root.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button")) e.preventDefault();
    });
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  get isOpen(): boolean {
    return this.openId !== null;
  }

  /** Closes if open; otherwise opens for `target` (the nearest container in range), if there is one. */
  toggle(target: ContainerState | null): void {
    if (this.openId) this.close();
    else if (target) this.open(target.id);
  }

  close(): void {
    if (!this.openId) return;
    this.openId = null;
    this.signature = "";
    this.root.remove();
    this.list.replaceChildren();
    this.rows.clear();
  }

  /** `me` is the local player's latest synced state (the position the server checks against), not the interpolated one. */
  update(state: RaidState, me: PlayerState | undefined, map: GameMap | undefined): void {
    if (!this.openId) return;
    const c = state.containers.get(this.openId);
    if (
      !c || !me || me.status !== "alive" ||
      Math.hypot(me.x - c.x, me.y - c.y) > INTERACT_RANGE + CLOSE_SLACK
    ) {
      this.close();
      return;
    }

    const inRange = !!map && canInteract(map, me, c);
    const full = me.inventory.length >= INVENTORY_SLOTS;
    let signature = `${c.kind}|${c.label}|${inRange}|${full}`;
    for (const it of c.items) signature += `|${it.uid}:${it.def}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.sync(c, inRange, full);
    this.root.hidden = false;
  }

  destroy(): void {
    this.openId = null;
    this.root.remove();
  }

  private open(id: string): void {
    this.openId = id;
    this.signature = "";
    // Stays hidden until the next update fills it in, so an empty shell is never painted.
    this.root.hidden = true;
    uiRoot().append(this.root);
  }

  /** Brings the DOM in line with the container: rows are added or removed individually, existing ones are kept. */
  private sync(c: ContainerState, inRange: boolean, full: boolean): void {
    this.title.textContent = c.label || c.kind;
    this.kind.textContent = c.kind;

    const uids = new Set<string>();
    for (const it of c.items) uids.add(it.uid);
    for (const [uid, row] of this.rows) {
      if (uids.has(uid)) continue;
      row.root.remove();
      this.rows.delete(uid);
    }

    let expected = this.list.firstElementChild;
    for (const it of c.items) {
      let row = this.rows.get(it.uid);
      if (!row) {
        row = this.createRow(it.uid, it.def);
        this.rows.set(it.uid, row);
      }
      if (row.root !== expected) this.list.insertBefore(row.root, expected);
      else expected = expected.nextElementSibling;
      row.take.disabled = !inRange;
    }

    this.emptyNote.hidden = c.items.length > 0;
    this.rangeHint.hidden = inRange;
    this.fullHint.hidden = !full;
  }

  private createRow(uid: string, defId: string): Row {
    const d = describeItem(defId);
    const swatch = el("span", "loot-swatch");
    swatch.style.background = d.color;
    const text = el("div", "loot-item");
    text.append(el("div", "loot-item-name", d.name));
    if (d.info) text.append(el("div", "loot-item-info", d.info));
    const take = this.button("Take", "btn small");
    take.dataset.uid = uid;
    const root = el("div", "loot-row");
    root.append(swatch, text, take);
    return { root, take };
  }

  private button(text: string, className: string): HTMLButtonElement {
    const b = el("button", className, text);
    b.tabIndex = -1;
    return b;
  }

  private onClick(e: MouseEvent): void {
    const button = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!button) return;
    if (button.dataset.action === "close") this.close();
    else if (button.dataset.uid && this.openId) this.handlers.onTake(this.openId, button.dataset.uid);
  }
}
