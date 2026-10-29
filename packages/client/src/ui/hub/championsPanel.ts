import { FACTIONS, FACTION_IDS, type FactionId } from "@raid/shared";
import { iconClipPath } from "../abilitySlot";
import { cssColor, el } from "../dom";
import { championGuide, GUIDE_WEAPON_IDS, weaponScalingGuide, type GuideAbility } from "./championGuide";
import type { HubPanel, HubPanelContext } from "./hubPanels";
import { CHAMPION_BUILDS, COMBAT_GUIDE_RULES } from "./weaponGuide";
import "./championsPanel.css";

let guides = 0;

/** Champion-select style reference: a compact kit first, exact rules while Shift is held (or details are pinned). */
export class ChampionsPanel implements HubPanel {
  readonly title = "Champions";
  readonly requiresProfile = false;
  readonly root = el("section", "champions-panel");
  private readonly navigation = el("div", "champion-navigation");
  private readonly buttons = new Map<FactionId, HTMLButtonElement>();
  private readonly content = el("div", "champion-content");
  private readonly name = el("h2", "champion-name");
  private readonly role = el("p", "champion-role");
  private readonly recommendation = el("p", "champion-recommendation");
  private readonly crest = el("span", "champion-crest");
  private readonly baseStats = el("div", "champion-base-stats");
  private readonly abilities = el("div", "champion-abilities");
  private readonly builds = el("section", "champion-builds");
  private readonly weaponRows = el("div", "champion-weapon-rows");
  private readonly selectButton = el("button", "btn champion-select");
  private readonly detailsButton = el("button", "btn small champion-details-toggle");
  private readonly mode = el("span", "champion-mode", "Quick view");
  private readonly detailNodes: HTMLElement[] = [];
  private readonly shiftKeys = new Set<string>();
  private shown = false;
  private pinned = false;
  private picked: FactionId | null = null;
  private viewed: FactionId = "fire";
  private readonly id = `champion-guide-${guides++}`;

  constructor(private readonly options: { onPick?: (id: FactionId) => void; onWeapons?: () => void } = {}) {
    this.root.setAttribute("aria-label", "Champions, abilities and scaling");
    const intro = el("div", "champion-guide-intro");
    const introCopy = el("div");
    introCopy.append(el("div", "champion-eyebrow", "KNOW YOUR CHAMPION"), el("p", undefined, "Learn the kit. Find the stats that make it stronger."));
    const controls = el("div", "champion-detail-controls");
    const hint = el("span", "champion-shift-hint");
    hint.append("Hold ", el("kbd", undefined, "Shift"), " for exact numbers");
    this.mode.setAttribute("role", "status");
    this.detailsButton.type = "button";
    this.detailsButton.setAttribute("aria-controls", `${this.id}-content`);
    this.detailsButton.addEventListener("click", () => { this.pinned = !this.pinned; this.updateDetails(); });
    controls.append(hint, this.detailsButton, this.mode);
    intro.append(introCopy, controls);

    this.navigation.setAttribute("role", "tablist");
    this.navigation.setAttribute("aria-label", "Champion");
    this.navigation.setAttribute("aria-orientation", "vertical");
    for (const id of FACTION_IDS) {
      const guide = championGuide(id);
      const button = el("button", "champion-option");
      button.type = "button";
      button.id = `${this.id}-${id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", `${this.id}-content`);
      button.style.setProperty("--champion-color", cssColor(guide.faction.color));
      const glyph = el("span", "champion-option-glyph");
      glyph.style.setProperty("clip-path", iconClipPath(guide.wish.def.icon));
      glyph.setAttribute("aria-hidden", "true");
      const copy = el("span");
      copy.append(el("strong", undefined, guide.faction.displayName), el("small", undefined, guide.faction.role));
      button.append(glyph, copy);
      button.addEventListener("click", () => this.select(id));
      this.buttons.set(id, button);
      this.navigation.append(button);
    }
    this.navigation.addEventListener("keydown", (event) => this.onNavigationKey(event));

    const header = el("header", "champion-header");
    const identity = el("div", "champion-identity");
    identity.append(this.name, this.role, this.recommendation);
    this.crest.setAttribute("aria-hidden", "true");
    this.selectButton.type = "button";
    this.selectButton.hidden = !options.onPick;
    this.selectButton.addEventListener("click", () => this.options.onPick?.(this.viewed));
    header.append(this.crest, identity, this.selectButton);
    this.content.id = `${this.id}-content`;
    this.content.setAttribute("role", "tabpanel");
    this.content.tabIndex = 0;
    const weapons = el("section", "champion-weapons");
    weapons.append(el("h3", undefined, "Your weapon adds its own scaling"), el("p", "champion-weapon-caption", "Bonus damage per second at base attack speed. Every champion can use every weapon; a run starts on fists."), this.weaponRows);
    if (options.onWeapons) {
      const link = el("button", "btn small champion-open-weapons", "Weapon guide · examples & counters →");
      link.type = "button";
      link.addEventListener("click", () => options.onWeapons?.());
      weapons.prepend(link);
    }
    const rules = el("div", "champion-rules");
    rules.append(el("strong", undefined, "How champion × weapon works"));
    for (const rule of COMBAT_GUIDE_RULES.slice(0, 2)) rules.append(el("p", undefined, rule));
    this.content.append(header, rules, this.baseStats, this.builds, this.abilities, weapons, el("p", "champion-base-note", "Base kit values. Enemy defenses, augments and PvP bonuses can change final damage. Browsing does not change your faction until you choose it."));
    const layout = el("div", "champion-layout");
    layout.append(this.navigation, this.content);
    this.root.append(intro, layout);
    this.renderChampion();
  }

  /** Browsing is separate from the faction chosen for the next run. */
  setPick(pick: { faction: FactionId | null }): void {
    if (pick.faction === this.picked) return;
    this.picked = pick.faction;
    if (pick.faction) this.select(pick.faction);
    this.updatePickButton();
  }

  render(): void { this.updatePickButton(); }

  onShow(context?: HubPanelContext): void {
    if (!this.shown) {
      this.shown = true;
      window.addEventListener("keydown", this.onKeyDown);
      window.addEventListener("keyup", this.onKeyUp);
      window.addEventListener("blur", this.onBlur);
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    if (context?.shiftKey) this.shiftKeys.add("opening-shift");
    this.updateDetails();
  }

  onHide(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.shown = false;
    this.shiftKeys.clear();
    this.pinned = false;
    this.updateDetails();
  }

  private select(id: FactionId): void {
    if (id === this.viewed) { this.updatePickButton(); return; }
    this.viewed = id;
    this.renderChampion();
  }

  private renderChampion(): void {
    const guide = championGuide(this.viewed);
    this.root.style.setProperty("--champion-color", cssColor(guide.faction.color));
    this.content.setAttribute("aria-labelledby", `${this.id}-${this.viewed}`);
    this.name.textContent = guide.faction.displayName;
    this.role.textContent = guide.faction.role;
    this.recommendation.textContent = `Generally pairs best with: ${CHAMPION_BUILDS[this.viewed].map(build => weaponScalingGuide(build.weapon).name).join(" or ")}`;
    this.crest.style.setProperty("clip-path", iconClipPath(guide.wish.def.icon));
    for (const [id, button] of this.buttons) {
      button.setAttribute("aria-selected", String(id === this.viewed));
      button.tabIndex = id === this.viewed ? 0 : -1;
    }
    this.baseStats.replaceChildren(...[
      ["Health", guide.faction.hp], ["Defense", guide.faction.armor], ["Magic resist", guide.faction.shield],
    ].map(([label, value]) => {
      const cell = el("span");
      cell.append(el("small", undefined, String(label)), el("strong", undefined, String(value)));
      return cell;
    }), el("span", "champion-base-mix", `Base attacks · ${guide.baseDamage}`));
    this.detailNodes.length = 0;
    this.builds.replaceChildren(el("h3", undefined, "Top 2 recommended weapons"), el("p", "champion-weapon-caption", "General recommendations based on champion synergy and scaling. Your current stats and the enemy's counter weapon can change the best choice."));
    const examples = el("div", "champion-build-grid");
    for (const [index, build] of CHAMPION_BUILDS[this.viewed].entries()) {
      const card = el("article", "champion-build-example");
      card.append(
        el("h4", "champion-build-weapon", `${index + 1}. ${weaponScalingGuide(build.weapon).name} · ${build.name}`),
        el("strong", "champion-build-stats", build.stats),
        el("p", undefined, build.why), el("p", "champion-build-caution", build.caution),
      );
      examples.append(card);
    }
    this.builds.append(examples);
    this.abilities.replaceChildren(this.abilityCard(guide.passive), this.abilityCard(guide.wish, [guide.wish.cooldown, guide.wish.targeting]));
    this.weaponRows.replaceChildren(...GUIDE_WEAPON_IDS.map(id => {
      const model = weaponScalingGuide(id);
      const row = el("div", "champion-weapon-row");
      const head = el("div", "champion-weapon-heading");
      head.append(el("strong", undefined, model.name), el("span", undefined, model.scaling));
      const detail = el("p", "champion-advanced", model.detail);
      this.detailNodes.push(detail);
      row.append(head, detail);
      return row;
    }));
    this.updatePickButton();
    this.updateDetails();
  }

  private abilityCard(ability: GuideAbility, metrics: string[] = []): HTMLElement {
    const card = el("article", "champion-ability");
    const head = el("div", "champion-ability-head");
    const key = el("span", "champion-ability-key", ability.key);
    key.setAttribute("aria-label", ability.key === "P" ? "Passive, automatic" : "D key");
    const title = el("div");
    title.append(el("span", "champion-ability-kind", ability.kind), el("h3", undefined, ability.name));
    head.append(key, title);
    const tags = el("div", "champion-scaling-tags");
    for (const tag of ability.tags) tags.append(el("span", `champion-scaling-tag scaling-${tag.kind}`, tag.label));
    const details = el("div", "champion-advanced");
    details.append(el("h4", undefined, "Detailed rules"));
    const list = el("ul");
    for (const text of ability.details) list.append(el("li", undefined, text));
    details.append(list);
    this.detailNodes.push(details);
    card.append(head, el("p", "champion-ability-summary", ability.summary));
    if (metrics.length) card.append(el("div", "champion-ability-metrics", metrics.join("  ·  ")));
    card.append(tags, el("p", "champion-scaling", ability.scaling), details);
    return card;
  }

  private updatePickButton(): void {
    const selected = this.viewed === this.picked;
    this.selectButton.textContent = selected ? "Selected for next run" : `Choose ${FACTIONS[this.viewed].displayName}`;
    this.selectButton.disabled = selected;
    if (selected && document.activeElement === this.selectButton) this.buttons.get(this.viewed)?.focus();
  }

  private updateDetails(): void {
    const detailed = this.pinned || this.shiftKeys.size > 0;
    for (const node of this.detailNodes) node.hidden = !detailed;
    this.root.setAttribute("data-detail", String(detailed));
    this.detailsButton.setAttribute("aria-expanded", String(detailed));
    this.detailsButton.textContent = this.pinned ? "Use Shift instead" : detailed ? "Keep details open" : "More details";
    const mode = detailed ? "Detailed view" : "Quick view";
    if (this.mode.textContent !== mode) this.mode.textContent = mode;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Shift" || event.ctrlKey || event.metaKey || event.altKey) return;
    this.shiftKeys.delete("opening-shift");
    this.shiftKeys.add(event.code || "Shift");
    this.updateDetails();
  };
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== "Shift") return;
    this.shiftKeys.delete("opening-shift");
    this.shiftKeys.delete(event.code || "Shift");
    // An opening click tells us Shift was held, but not which side. Keep the view open if the other Shift is still down.
    if (this.shiftKeys.size === 0 && event.shiftKey) this.shiftKeys.add("opening-shift");
    this.updateDetails();
  };
  private readonly onBlur = (): void => { this.shiftKeys.clear(); this.updateDetails(); };
  private readonly onVisibility = (): void => { if (document.visibilityState === "hidden") this.onBlur(); };

  private onNavigationKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const at = FACTION_IDS.findIndex(id => this.buttons.get(id) === document.activeElement);
    if (at < 0) return;
    const to = event.key === "Home" ? 0 : event.key === "End" ? FACTION_IDS.length - 1
      : ["ArrowDown", "ArrowRight"].includes(event.key) ? (at + 1) % FACTION_IDS.length
      : ["ArrowUp", "ArrowLeft"].includes(event.key) ? (at + FACTION_IDS.length - 1) % FACTION_IDS.length : null;
    if (to === null) return;
    event.preventDefault();
    const id = FACTION_IDS[to]!;
    this.select(id);
    this.buttons.get(id)!.focus();
  }
}
