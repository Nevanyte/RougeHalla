import { abilityInSlot, cardPower, combatDamageShares, combatReadability, decodeFlat, FACTIONS, FISTS, isFactionId, isWeaponId, pvpFactor, WEAPONS } from "@raid/shared";
import type { InvestedStatKey } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { abilityTip, wishCooldownMultiplier } from "./combatTip";
import { combatIcon, iconLabel, STAT_ICON_COLORS } from "./combatIcons";
import { el, uiRoot } from "./dom";
import { RectTips } from "./rectTips";
import "./opponentInspector.css";

/** Public, visible target information only. A build cue deliberately does not predict who wins the fight. */
export class OpponentInspector {
  private readonly root = el("aside", "opponent-inspector");
  private readonly title = el("strong", "opponent-name");
  private readonly kit = el("div", "opponent-kit");
  private readonly health = el("div", "opponent-health");
  private readonly growth = el("div", "opponent-growth");
  private readonly stats = el("div", "opponent-investments");
  private readonly damage = el("div", "opponent-damage");
  private readonly offense = el("div", "opponent-offense");
  private readonly defenses = el("div", "opponent-defenses");
  private readonly wish = el("div", "opponent-wish");
  private readonly note = el("small", "", "Icons name each positive stat investment. Damage percentages describe the scaled basic hit; abilities and conditional effects can differ. Current health and matchups still matter.");
  private readonly tip = el("div", "opponent-tip");
  private tipItems: HTMLElement[] = [];
  private readonly tips: RectTips;

  constructor() {
    this.root.setAttribute("aria-label", "Opponent combat details");
    this.tip.hidden = true;
    this.root.append(this.title, this.kit, this.health, this.growth, this.stats, this.damage, this.offense, this.defenses, this.wish, this.note, this.tip);
    this.root.hidden = true;
    uiRoot().append(this.root);
    this.tips = new RectTips({
      container: () => this.root,
      items: () => this.tipItems,
      active: () => !this.root.hidden,
      onChange: (index) => {
        const item = this.tipItems[index];
        this.tip.textContent = item?.title ?? "";
        this.tip.hidden = !item;
      },
    });
  }

  update(p?: PlayerState, serverNow = 0, training = false): void {
    if (!p || p.status !== "alive" || !isFactionId(p.faction)) {
      this.root.hidden = true;
      this.tip.hidden = true;
      this.tips.hide();
      return;
    }
    this.root.hidden = false;
    const f = FACTIONS[p.faction];
    const w = p.slot === 1 ? p.weapon1 : p.weapon0;
    const strength = combatReadability(p);
    this.title.textContent = p.name;
    this.kit.textContent = `${f.displayName} · ${WEAPONS[isWeaponId(w) ? w : FISTS].name} · ${f.role}`;
    this.health.textContent = `Health ${Math.ceil(p.hp)} / ${Math.ceil(p.maxHp)}`;
    const power = cardPower(p.build);
    this.growth.textContent = `Card power ${power} · PvP factor ×${pvpFactor(power).toFixed(2)} · growth ×${strength.powerRatio.toFixed(2)}`;

    this.tipItems = [];
    this.stats.replaceChildren(...strength.investedStats.slice(0, 3).map(stat => {
      const chip = this.statChip(stat.key, stat.label);
      chip.title = `${stat.label}: positive investment from your build`;
      this.tipItems.push(chip);
      return chip;
    }));
    this.stats.hidden = strength.investedStats.length === 0;
    const mix = combatDamageShares(p);
    const shares = [["physical", mix.phys], ["magic", mix.magic], ["true", mix.true]] as const;
    this.damage.replaceChildren(...shares.filter(([, share]) => share > 0.005).map(([kind, share]) => {
      const label = kind === "physical" ? "Physical damage" : kind === "magic" ? "Magic damage" : "True damage";
      const chip = el("span", `opponent-damage-${kind}`);
      chip.title = `${label}: ${Math.round(share * 100)}% of the scaled basic hit`;
      chip.setAttribute("aria-label", chip.title);
      chip.append(combatIcon(kind), el("span", undefined, `${label} ${Math.round(share * 100)}%`));
      this.tipItems.push(chip);
      return chip;
    }));

    this.offense.replaceChildren(
      this.statChip("ad", "Attack damage", `+${Math.round(decodeFlat(p.adBonus))}`),
      this.statChip("ap", "Ability power", `+${Math.round(decodeFlat(p.apBonus))}`),
    );
    this.defenses.replaceChildren(
      this.statChip("armor", "Armor", String(Math.round(f.armor + decodeFlat(p.armorBonus)))),
      this.statChip("mr", "Magic resistance", String(Math.round(f.shield + decodeFlat(p.shieldBonus)))),
    );
    this.tipItems.push(...Array.from(this.offense.children) as HTMLElement[], ...Array.from(this.defenses.children) as HTMLElement[]);
    const ability = abilityInSlot(p, "wish");
    const ready = p.wishReadyAt > serverNow ? `Ready in ${Math.ceil((p.wishReadyAt - serverNow) / 1000)} s` : "Ready";
    this.wish.textContent = ability ? `Wish · ${ready}\n${abilityTip(ability.def, ability.rank, undefined, { training, wishCooldownMult: wishCooldownMultiplier(p.build, p.faction) })}` : "";
    this.tips.reset();
  }

  destroy(): void { this.tips.destroy(); this.root.remove(); }

  private statChip(key: InvestedStatKey, label: string, value?: string): HTMLElement {
    const chip = el("span", "opponent-stat-chip");
    chip.style.color = `#${STAT_ICON_COLORS[key].toString(16).padStart(6, "0")}`;
    chip.title = label;
    chip.setAttribute("aria-label", value === undefined ? label : `${label}: ${value}`);
    chip.append(combatIcon(key), el("span", "opponent-stat-label", label));
    if (value !== undefined) chip.append(el("strong", undefined, value));
    return chip;
  }
}
