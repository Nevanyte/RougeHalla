import { ALL_WEAPON_IDS, FACTIONS, FACTION_IDS, WEAPONS, type FactionId, type WeaponId } from "@raid/shared";
import { cssColor, el } from "../dom";
import { guideNumber } from "./championGuide";
import { COMBAT_GUIDE_RULES, weaponAttackExample, weaponGuide } from "./weaponGuide";
import type { HubPanel } from "./hubPanels";
import "./weaponsPanel.css";

let panels = 0;

export class WeaponsPanel implements HubPanel {
  readonly title = "Weapon guide";
  readonly requiresProfile = false;
  readonly root = el("section", "weapons-panel");
  private readonly navigation = el("div", "weapon-guide-navigation");
  private readonly content = el("div", "weapon-guide-content");
  private readonly buttons = new Map<WeaponId, HTMLButtonElement>();
  private readonly example = el("div", "weapon-guide-example");
  private weapon: WeaponId = "sword";
  private faction: FactionId = "fire";
  private readonly id = `weapon-guide-${panels++}`;

  constructor() {
    this.root.setAttribute("aria-label", "Weapon scaling and counters");
    const intro = el("div", "weapon-guide-intro");
    intro.append(el("h2", undefined, "Choose a weapon, understand the trade"));
    for (const rule of COMBAT_GUIDE_RULES) intro.append(el("p", undefined, rule));
    this.navigation.setAttribute("role", "tablist");
    this.navigation.setAttribute("aria-label", "Weapon");
    for (const id of ALL_WEAPON_IDS) {
      const model = weaponGuide(id);
      const button = el("button", "weapon-guide-option");
      button.type = "button";
      button.id = `${this.id}-${id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", `${this.id}-content`);
      button.style.setProperty("--weapon-color", cssColor(WEAPONS[id].color));
      button.append(el("strong", undefined, model.name), el("small", undefined, model.build));
      button.addEventListener("click", () => this.select(id));
      this.buttons.set(id, button);
      this.navigation.append(button);
    }
    this.navigation.addEventListener("keydown", event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const at = ALL_WEAPON_IDS.findIndex(id => this.buttons.get(id) === document.activeElement);
      if (at < 0) return;
      const to = event.key === "Home" ? 0 : event.key === "End" ? ALL_WEAPON_IDS.length - 1
        : event.key === "ArrowRight" ? (at + 1) % ALL_WEAPON_IDS.length
        : event.key === "ArrowLeft" ? (at + ALL_WEAPON_IDS.length - 1) % ALL_WEAPON_IDS.length : null;
      if (to === null) return;
      event.preventDefault();
      const id = ALL_WEAPON_IDS[to]!;
      this.select(id);
      this.buttons.get(id)!.focus();
    });
    this.content.id = `${this.id}-content`;
    this.content.setAttribute("role", "tabpanel");
    this.content.tabIndex = 0;
    this.root.append(intro, this.navigation, this.content);
    this.select(this.weapon);
  }

  render(): void {}

  private select(id: WeaponId): void {
    this.weapon = id;
    const model = weaponGuide(id);
    this.root.style.setProperty("--weapon-color", cssColor(WEAPONS[id].color));
    for (const [weapon, button] of this.buttons) {
      button.setAttribute("aria-selected", String(weapon === id));
      button.tabIndex = weapon === id ? 0 : -1;
    }
    this.content.setAttribute("aria-labelledby", `${this.id}-${id}`);
    const header = el("header", "weapon-guide-header");
    header.append(el("h3", "weapon-guide-name", model.name), el("p", undefined, `${model.role} · ${model.range}`));
    const grid = el("div", "weapon-guide-grid");
    const scaling = el("section", "weapon-guide-card");
    scaling.append(el("h4", undefined, "Build around"), el("strong", "weapon-guide-build", model.build));
    for (const gain of model.gains) scaling.append(el("p", "weapon-guide-gain", gain));
    scaling.append(el("p", "weapon-guide-note", "Raw weapon damage per second at base attack speed, before defenses and modifiers. These are additions to your champion's base attack, not flat damage added to every hit."));
    const counters = el("section", "weapon-guide-card");
    counters.append(el("h4", undefined, "Intended matchups"));
    if (id === "fists") counters.append(el("p", undefined, "Outside the five-weapon counter wheel."));
    else counters.append(
      el("p", "weapon-guide-favored", `Favored into: ${model.beats.map(w => WEAPONS[w].name).join(", ")}`),
      el("p", "weapon-guide-unfavored", `Be careful into: ${model.losesTo.map(w => WEAPONS[w].name).join(", ")}`),
    );
    counters.append(el("p", "weapon-guide-note", "These are the designed counter-wheel edges, not measured win-rate promises. Positioning, champion, growth and execution can reverse them."));
    grid.append(scaling, counters);
    const mechanics = el("section", "weapon-guide-mechanics");
    mechanics.append(el("h4", undefined, "How to use it"), el("p", undefined, model.play));
    const list = el("ul");
    for (const text of model.mechanics) list.append(el("li", undefined, text));
    mechanics.append(list);
    const example = el("section", "weapon-guide-sample");
    const label = el("label", undefined, "Worked example · champion ");
    const picker = el("select", "weapon-guide-champion");
    picker.setAttribute("aria-label", "Example champion");
    for (const faction of FACTION_IDS) {
      const option = el("option", undefined, FACTIONS[faction].displayName);
      option.value = faction;
      picker.append(option);
    }
    picker.value = this.faction;
    picker.addEventListener("change", () => { this.faction = picker.value as FactionId; this.renderExample(); });
    label.append(picker);
    example.append(label, this.example);
    this.renderExample();
    const details = el("details", "weapon-guide-formula");
    details.append(el("summary", undefined, "Exact attack formula"));
    for (const text of [
      "S = attack-speed multiplier (1 at base speed). Interval = max(weapon minimum interval, 1 ÷ [champion base attacks/s × (1 + weapon speed bonus) × S]).",
      `Base DPS = arena-paced champion attack rate × hit damage × weapon damage multiplier (${guideNumber(WEAPONS[id].dpsMult)} for ${model.name}). Bonus DPS = ${model.scaling}.`,
      "Raw damage per hit = (base DPS + bonus DPS) × S × interval. The base keeps the champion's type mix; bonus Offense/health/defense damage is physical and bonus SO damage is magic.",
      "Attack speed raises weapon DPS. At the minimum interval, extra speed becomes more damage per hit. It does not directly multiply Fire's burn or Plague's disease.",
      "After the packet is built: crits, augments, PvP scaling and other effects may modify it. Each physical part is multiplied by 100/(100 + Defense); each magic part by 100/(100 + SD). At 100 resistance, that type takes half damage. True damage ignores those resistances.",
    ]) details.append(el("p", undefined, text));
    this.content.replaceChildren(header, grid, mechanics, example, details);
  }

  private renderExample(): void {
    const w = WEAPONS[this.weapon];
    const empty = { ad: 0, ap: 0, bonusMaxHp: 0, bonusDefense: 0 };
    const primary = Object.entries(w.scaling).sort((a, b) => b[1] - a[1])[0]![0];
    const stats = { ...empty };
    const value = 20;
    if (primary === "ad") stats.ad = value;
    else if (primary === "ap") stats.ap = value;
    else stats.bonusDefense = value;
    const before = weaponAttackExample(this.faction, this.weapon, empty);
    const after = weaponAttackExample(this.faction, this.weapon, stats);
    const damageNumber = (n: number): string => String(Number(n.toFixed(1)));
    const mix = (packet: typeof after): string => [
      packet.phys > 0 ? `${damageNumber(packet.phys)} physical` : "",
      packet.magic > 0 ? `${damageNumber(packet.magic)} magic` : "",
      packet.true > 0 ? `${damageNumber(packet.true)} true` : "",
    ].filter(Boolean).join(" + ");
    this.example.replaceChildren(
      el("p", undefined, `${FACTIONS[this.faction].displayName} + ${w.name} · base attack speed · no other bonuses`),
      el("p", "weapon-guide-before", `Base hit: ${mix(before)} = ${damageNumber(before.total)} raw damage.`),
      el("p", "weapon-guide-after", `With +${value} ${primary === "def" ? "combined bonus Defense/SD" : primary.toUpperCase()}: ${mix(after)} = ${damageNumber(after.total)} raw damage.`),
      el("p", undefined, `${Number(after.attacksPerSecond.toFixed(2))} attacks/s · ${Number(after.interval.toFixed(2))} s between attacks. Passive signature and Wish damage are separate.`),
      el("p", "weapon-guide-note", "Illustration before enemy defenses, crits, augments and PvP multipliers; not a final damage or kill-time prediction."),
    );
  }
}
