import { FACTIONS, WEAPONS, isFactionId, isWeaponId, type WeaponId } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { RectTips } from "./rectTips";
import { el } from "./dom";
import { championCombatModel, type ChampionCombatInput, type ChampionCombatRow } from "./championCombatModel";
import "./championCombatHud.css";

interface RowView {
  root: HTMLElement;
  name: HTMLElement;
  value: HTMLElement;
  scaling: HTMLElement;
  tip: HTMLElement;
}

function cardKey(build: PlayerState["build"]): string {
  if (!build) return "";
  const entries: string[] = [];
  const forEach = (build as { forEach?: unknown }).forEach;
  if (typeof forEach === "function") {
    (build as unknown as { forEach(cb: (count: number, id: string) => void): void }).forEach((count, id) => entries.push(`${id}:${count}`));
  } else {
    for (const [id, count] of Object.entries(build as unknown as Record<string, number>)) entries.push(`${id}:${count}`);
  }
  return entries.sort().join(",");
}

function heldWeapon(me: PlayerState): WeaponId {
  const id = me.slot === 1 ? me.weapon1 : me.weapon0;
  return isWeaponId(id) ? id : "fists";
}

/** Small bottom-left live combat reference; the shared model owns all combat estimates. */
export class ChampionCombatHud {
  readonly root = el("section", "champion-combat-hud");
  private readonly championName = el("span", "champion-combat-name");
  private readonly weaponName = el("span", "champion-combat-weapon");
  private readonly rowsRoot = el("div", "champion-combat-rows");
  private readonly rows: RowView[] = [];
  private readonly tips: RectTips;
  private inputSignature = "";
  private renderedSignature = "";
  private headerSignature = "";

  constructor(parent: HTMLElement) {
    this.root.setAttribute("aria-label", "Combat overview");
    const head = el("div", "champion-combat-head");
    head.append(this.championName, this.weaponName);
    for (const id of ["auto", "passive", "wish"] as const) {
      const name = el("span", "champion-combat-name-cell");
      const value = el("span", "champion-combat-value");
      const scaling = el("span", "champion-combat-scaling");
      const tip = el("span", "champion-combat-tip");
      const row = el("div", `champion-combat-row ${id}`);
      row.setAttribute("role", "group");
      row.append(name, value, scaling, tip);
      this.rows.push({ root: row, name, value, scaling, tip });
      this.rowsRoot.append(row);
    }
    this.root.append(head, this.rowsRoot);
    this.root.hidden = true;
    parent.append(this.root);
    this.tips = new RectTips({
      container: () => this.rowsRoot,
      items: () => this.rows.map((row) => row.root),
      active: () => !this.root.hidden,
      onChange: (index) => this.rows.forEach((row, i) => row.root.classList.toggle("tip-on", i === index)),
    });
  }

  update(state: RaidState, me: PlayerState | undefined, _serverNow: number): void {
    const allowed = me?.status === "alive" && (state.training === true || state.phase === "active");
    this.root.classList.toggle("training-room", state.training === true);
    if (!allowed || !me) {
      if (!this.root.hidden) this.root.hidden = true;
      this.tips.hide();
      this.inputSignature = "";
      return;
    }

    this.root.hidden = false;
    const weaponId = heldWeapon(me);
    const champion = isFactionId(me.faction) ? FACTIONS[me.faction] : null;
    const headerKey = `${me.faction}|${weaponId}`;
    if (headerKey !== this.headerSignature) {
      this.headerSignature = headerKey;
      this.championName.textContent = champion?.displayName ?? "Champion";
      this.championName.style.color = champion ? `#${champion.color.toString(16).padStart(6, "0")}` : "";
      this.weaponName.textContent = WEAPONS[weaponId].name;
    }

    const input: ChampionCombatInput = {
      faction: me.faction, weapon0: me.weapon0, weapon1: me.weapon1, slot: me.slot,
      asMult: me.asMult, windupMult: me.windupMult, speedMult: me.speedMult,
      armorBonus: me.armorBonus, shieldBonus: me.shieldBonus, adBonus: me.adBonus, apBonus: me.apBonus,
      maxHp: me.maxHp, hp: me.hp, sentence: me.sentence, build: me.build,
    };
    const inputSignature = [
      me.faction, me.weapon0, me.weapon1, me.slot, me.asMult, me.windupMult, me.speedMult,
      me.armorBonus, me.shieldBonus, me.adBonus, me.apBonus, me.maxHp, me.hp, me.sentence, cardKey(me.build),
    ].join("|");
    if (inputSignature === this.inputSignature) return;
    this.inputSignature = inputSignature;

    const model = championCombatModel(input);
    if (model.signature === this.renderedSignature) return;
    this.renderedSignature = model.signature;
    model.rows.forEach((item, i) => this.renderRow(this.rows[i]!, item));
    // Preserve any open tooltip: renderRow updates its contents in place, and RectTips only refreshes geometry on the next move.
    this.tips.invalidate();
  }

  destroy(): void {
    this.tips.destroy();
    this.root.remove();
  }

  private renderRow(view: RowView, row: ChampionCombatRow): void {
    view.name.textContent = row.name;
    view.value.textContent = row.value;
    view.scaling.textContent = row.scaling;
    view.tip.textContent = row.tooltip;
    view.root.setAttribute("aria-label", `${row.name}: ${row.value}. ${row.scaling}. ${row.tooltip}`);
  }
}
