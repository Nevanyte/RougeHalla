// Wardrobe tab: what the player owns, per slot, as chips to put on or take off, with a live preview of the look
// that results. Titles have their own tab. Golden looks follow the faction or weapon in use, so they are one group.
import { COSMETICS, cosmeticById, cosmeticsInSlot, packLook, unpackLook, type Cosmetic, type CosmeticSlot, type ProfileDTO } from "@raid/shared";
import { el } from "../dom";
import { closetOf, describeError, isEquipped, isGold, refocus, sectionHeading, StatusLine, type Closet } from "./hubUtil";
import type { HubActions, HubPanel } from "./hubPanels";
import { AvatarPreview, swatch } from "./swatch";

interface Chip {
  c: Cosmetic;
  btn: HTMLButtonElement;
}

interface Section {
  /** The single slot a section covers; null for the golden group, which spans ten slots. */
  slot: CosmeticSlot | null;
  items: readonly Cosmetic[];
  chips: Chip[];
  current: HTMLElement;
  unequip: HTMLButtonElement | null;
  empty: HTMLElement;
}

const SLOT_SECTIONS: ReadonlyArray<{ slot: CosmeticSlot; label: string }> = [
  { slot: "skin", label: "Colours" },
  { slot: "outline", label: "Outlines" },
  { slot: "trail", label: "Trails" },
];

export class WardrobePanel implements HubPanel {
  readonly title = "Wardrobe";
  readonly root = el("div", "hub-tab hub-wardrobe");
  private readonly status = new StatusLine();
  private readonly preview = new AvatarPreview();
  private readonly sections: Section[] = [];
  private profile: ProfileDTO | null = null;
  private busy = false;

  constructor(private readonly actions: HubActions) {
    const side = el("div", "hub-wardrobe-side");
    side.append(this.preview.root);
    const main = el("div", "hub-wardrobe-main");
    for (const { slot, label } of SLOT_SECTIONS) main.append(this.buildSection(slot, label, cosmeticsInSlot(slot)));
    main.append(this.buildSection(null, "Golden looks", COSMETICS.filter(isGold), "(shown when you play that faction / hold that weapon)"));
    this.root.append(this.status.root, side, main);
  }

  render(profile: ProfileDTO): void {
    this.profile = profile;
    this.paint();
    // The look word is what other players get, so the preview can't show anything they wouldn't see.
    this.preview.update(unpackLook(packLook(profile.cosmetics.equipped, profile.cosmetics.owned)));
  }

  onShow(): void {
    if (!this.busy) this.status.clear();
  }

  private buildSection(slot: CosmeticSlot | null, label: string, items: readonly Cosmetic[], note?: string): HTMLElement {
    const root = el("section", "hub-section");
    const current = el("span", "hub-section-current");
    const head = sectionHeading(label, note);
    const bar = el("div", "hub-section-bar");
    bar.append(head, current);
    let unequip: HTMLButtonElement | null = null;
    if (slot) {
      unequip = el("button", "btn small", "Unequip");
      unequip.setAttribute("aria-label", `Unequip ${label.toLowerCase()}`);
      unequip.addEventListener("click", () => this.onUnequip(slot));
      bar.append(unequip);
    }

    const chips = el("div", "hub-chips");
    const section: Section = { slot, items, chips: [], current, unequip, empty: el("div", "hub-empty", "Nothing owned yet. Buy or earn some first.") };
    for (const c of items) {
      const btn = el("button", "hub-chip");
      btn.append(swatch(c, "sm"), el("span", undefined, c.name));
      btn.addEventListener("click", () => this.onChip(c));
      chips.append(btn);
      section.chips.push({ c, btn });
    }
    this.sections.push(section);
    root.append(bar, chips, section.empty);
    return root;
  }

  private onChip(c: Cosmetic): void {
    if (this.busy || !this.profile) return;
    const worn = isEquipped(closetOf(this.profile), c);
    void this.change(c.slot, worn ? null : c.id, worn ? `Took off ${c.name}` : `Equipped ${c.name}`);
  }

  private onUnequip(slot: CosmeticSlot): void {
    if (this.busy || !this.profile) return;
    const worn = cosmeticById(Object.hasOwn(this.profile.cosmetics.equipped, slot) ? this.profile.cosmetics.equipped[slot] : undefined);
    void this.change(slot, null, worn ? `Took off ${worn.name}` : "Took it off");
  }

  private paint(): void {
    const profile = this.profile;
    if (!profile) return;
    const closet = closetOf(profile);
    for (const s of this.sections) this.paintSection(s, closet);
  }

  private paintSection(s: Section, closet: Closet): void {
    let owned = 0;
    let wearing: Cosmetic | undefined;
    for (const { c, btn } of s.chips) {
      const has = closet.owned.has(c.id);
      const worn = isEquipped(closet, c);
      if (has) owned++;
      if (worn) wearing = c;
      btn.hidden = !has;
      btn.disabled = this.busy;
      btn.setAttribute("aria-pressed", String(worn));
      btn.title = worn ? `Take off ${c.name}` : `Put on ${c.name}`;
    }
    s.empty.hidden = owned > 0;
    if (s.slot) {
      s.current.textContent = wearing ? `Wearing ${wearing.name}` : "Nothing worn";
      if (s.unequip) {
        s.unequip.hidden = !wearing;
        s.unequip.disabled = this.busy;
      }
    } else {
      const count = s.chips.filter(({ c }) => isEquipped(closet, c)).length;
      s.current.textContent = count > 0 ? `${count} on` : "";
    }
  }

  private async change(slot: string, id: string | null, done: string): Promise<void> {
    if (this.busy) return;
    const focused = document.activeElement;
    this.busy = true;
    this.status.set("Saving…");
    this.paint();
    try {
      await this.actions.equip(slot, id);
      this.status.set(done, "ok");
    } catch (err) {
      this.status.set(describeError(err), "error");
    } finally {
      this.busy = false;
      this.paint();
      refocus(focused);
    }
  }
}
