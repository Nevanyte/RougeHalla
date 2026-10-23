// Bottom-center inventory bar. Click = use (healing items only), shift+click = drop; a number key uses a slot and
// shift+number drops it (wired by the scene). It only reflects the synced inventory and asks the server to act.
import { INVENTORY_SLOTS, itemDef, type ItemDef } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { el, uiRoot } from "./dom";

const UNKNOWN_COLOR = 0x888888;

export interface InventoryHandlers {
  onUse(uid: string): void;
  onDrop(uid: string): void;
}

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Display fields for an item def id; unknown ids (newer server content) still render. */
export function describeItem(defId: string): { name: string; color: string; info: string } {
  const def: ItemDef | undefined = itemDef(defId);
  if (!def) return { name: defId, color: cssColor(UNKNOWN_COLOR), info: "" };
  let info: string;
  switch (def.kind) {
    case "weapon": info = `Weapon · ${def.damage} dmg · range ${def.range}`; break;
    case "armor": info = `Armor · absorbs ${Math.round(def.reduction * 100)}%`; break;
    case "healing": info = `Heals ${def.heal}`; break;
    case "valuable": info = "No use in a run"; break;
  }
  return { name: def.name, color: cssColor(def.color), info };
}

interface Slot {
  root: HTMLElement;
  swatch: HTMLElement;
  name: HTMLElement;
  uid: string | null;
  /** Only healing items do anything when used; for the rest the server just answers "Can't use". */
  usable: boolean;
}

export class InventoryBar {
  private readonly root = el("div", "inventory");
  private readonly slots: Slot[] = [];
  /** Starts as a value no real signature can equal so the first update always renders. */
  private signature: string | null = null;

  constructor(private readonly handlers: InventoryHandlers) {
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const root = el("div", "inv-slot empty");
      const swatch = el("span", "inv-swatch");
      const name = el("span", "inv-name");
      root.append(el("span", "inv-key", String(i + 1)), swatch, name);
      root.addEventListener("click", (e) => this.onSlotClick(i, e));
      this.slots.push({ root, swatch, name, uid: null, usable: false });
      this.root.append(root);
    }
    // Right-click is move-to; a browser menu popping up over the bar would just be in the way.
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
    uiRoot().append(this.root);
  }

  /** Cheap per frame: the DOM is touched only when the carried items change. */
  update(me: PlayerState | undefined): void {
    let signature = "";
    if (me) for (const it of me.inventory) signature += `${it.uid}:${it.def}|`;
    if (signature === this.signature) return;
    this.signature = signature;

    const items = me ? me.inventory.map((it) => ({ uid: it.uid, def: it.def })) : [];
    this.slots.forEach((slot, i) => {
      const item = items[i];
      slot.uid = item?.uid ?? null;
      slot.usable = !!item && itemDef(item.def)?.kind === "healing";
      slot.root.classList.toggle("empty", !item);
      if (!item) {
        slot.swatch.style.background = "";
        slot.name.textContent = "";
        slot.root.title = "";
        return;
      }
      const d = describeItem(item.def);
      slot.swatch.style.background = d.color;
      slot.name.textContent = d.name;
      slot.root.title = `${d.name}${d.info ? ` — ${d.info}` : ""}\n${slot.usable ? "Click: use · " : ""}Shift+click: drop`;
    });
  }

  /** Does nothing for an empty slot or an item that can't be used. */
  useSlot(index: number): void {
    const slot = this.slots[index];
    if (slot?.uid && slot.usable) this.handlers.onUse(slot.uid);
  }

  dropSlot(index: number): void {
    const uid = this.slots[index]?.uid;
    if (uid) this.handlers.onDrop(uid);
  }

  destroy(): void {
    this.root.remove();
  }

  private onSlotClick(index: number, e: MouseEvent): void {
    if (e.shiftKey) this.dropSlot(index);
    else this.useSlot(index);
  }
}
