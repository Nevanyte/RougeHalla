import { abilityInSlot, cardPower, combatDamageShares, combatReadability, decodeFlat, FACTIONS, FISTS, isFactionId, isWeaponId, pvpFactor, WEAPONS } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { abilityTip, wishCooldownMultiplier } from "./combatTip";
import { el, uiRoot } from "./dom";
import "./opponentInspector.css";

/** Public, visible target information only. A build cue deliberately does not predict who wins the fight. */
export class OpponentInspector {
  private root = el("aside", "opponent-inspector");
  private title = el("strong");
  private kit = el("div");
  private health = el("div");
  private growth = el("div");
  private stats = el("div", "opponent-investments");
  private damage = el("div", "opponent-damage");
  private offense = el("div");
  private defenses = el("div");
  private wish = el("div", "opponent-wish");
  private note = el("small", "", "Badges = largest card stat investments. Glow reflects run power. P = physical, M = magic, T = true basic-hit damage after weapon scaling. Abilities and conditional effects can differ; current health and matchups still matter.");
  constructor() {
    this.root.setAttribute("aria-label", "Opponent combat details");
    this.root.append(this.title, this.kit, this.health, this.growth, this.stats, this.damage, this.offense, this.defenses, this.wish, this.note);
    this.root.hidden = true;
    uiRoot().append(this.root);
  }
  update(p?: PlayerState, serverNow = 0, training = false): void {
    if (!p || p.status !== "alive" || !isFactionId(p.faction)) { this.root.hidden = true; return; }
    this.root.hidden = false;
    const f = FACTIONS[p.faction];
    const w = p.slot === 1 ? p.weapon1 : p.weapon0;
    const strength = combatReadability(p);
    this.title.textContent = p.name;
    this.kit.textContent = `${f.displayName} · ${WEAPONS[isWeaponId(w) ? w : FISTS].name} · ${f.role}`;
    this.health.textContent = `HP ${Math.ceil(p.hp)} / ${Math.ceil(p.maxHp)}`;
    const power = cardPower(p.build);
    this.growth.textContent = `Card power ${power} · PvP ×${pvpFactor(power).toFixed(2)} · PvP growth ×${strength.powerRatio.toFixed(2)}`;
    this.stats.textContent = strength.topStats.length ? strength.topStats.map(s => `${s.short} · ${s.label}`).join("    |    ") : "Starting kit · no stat investments yet";
    const mix = combatDamageShares(p);
    const shares = [["Physical", mix.phys, "physical"], ["Magic", mix.magic, "magic"], ["True", mix.true, "true"]] as const;
    this.damage.replaceChildren(...shares.filter(([, share]) => share > 0).map(([name, share, cls]) => el("span", cls, `${name} ${Math.round(share * 100)}%`)));
    this.offense.textContent = `AD +${Math.round(decodeFlat(p.adBonus))} · AP +${Math.round(decodeFlat(p.apBonus))}`;
    this.defenses.textContent = `Armor ${Math.round(f.armor + decodeFlat(p.armorBonus))} · Magic resist ${Math.round(f.shield + decodeFlat(p.shieldBonus))}`;
    const ability = abilityInSlot(p, "wish");
    const ready = p.wishReadyAt > serverNow ? `Ready in ${Math.ceil((p.wishReadyAt - serverNow) / 1000)} s` : "Ready";
    this.wish.textContent = ability ? `Wish · ${ready}\n${abilityTip(ability.def, ability.rank, undefined, { training, wishCooldownMult: wishCooldownMultiplier(p.build, p.faction) })}` : "";
  }
  destroy(): void { this.root.remove(); }
}
