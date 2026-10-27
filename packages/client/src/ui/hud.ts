// In-run DOM overlay: the lobby countdown or the run line (players standing, GV, your bounty), the arena timers (coliseum
// teleport → locked gates → sudden death), player vitals (faction and hp), the teleport-immunity hint and the
// "you died" line. A training room shows none of the run's lines: its banner, your faction, weapon and hp. The cards row
// (a chip per card held) is cardsRow.ts, placed under the vitals, and the build strip (what the cards add up to) buildHud.ts under it.
import { FACTIONS, WEAPONS, hpText, isFactionId, isWeaponId } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { winnerLabel } from "../render/displayName";
import type { TerrainStates } from "../render/zoneArt/terrainFeedback";
import { BuildHud } from "./buildHud";
import { CardsRow } from "./cardsRow";
import { cssColor, el, uiRoot } from "./dom";
import { TerrainChips } from "./terrainChips";

function fmtSeconds(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What the training room shows where the arena shows its run line: it records nothing, so the HUD says so. */
export const TRAINING_BANNER = "TRAINING — nothing here is recorded: no GV, no stats";

/** The fields of the room state the top status line reads. */
export interface StatusInput {
  training: boolean;
  phase: string;
  playerCount: number;
  minPlayers: number;
  lobbyEndsAt: number;
  /** Players standing; only read while the run is active. */
  alive: number;
  startedWith: number;
  winner: string;
  /** The local player's run GV, or null while they are not in the state. */
  gv: number | null;
  /** Server time the planning phase ends (RaidState.planEndsAt); absent or 0 when it has no end to show. */
  planEndsAt?: number;
}

/** The first HUD line. Training has no lobby, no standing count and no GV, so it never shows them. */
export function statusLine(s: StatusInput, serverNow: number): string {
  if (s.training) return TRAINING_BANNER;
  if (s.phase === "lobby") {
    return `Waiting for players ${s.playerCount}/${s.minPlayers} — run starts in ${fmtSeconds(s.lobbyEndsAt - serverNow)}`;
  }
  if (s.phase === "planning") {
    return s.planEndsAt ? `Planning ${fmtSeconds(s.planEndsAt - serverNow)}` : "Planning";
  }
  if (s.phase === "active") {
    // startedWith, not the player count: leavers (including the dead going back to the hub) drop out of state.players.
    const line = `Alive ${s.alive}/${s.startedWith}`;
    return s.gv === null ? line : `${line} · Run GV ${s.gv}`;
  }
  return s.winner ? `Run over — ${s.winner} is victorious` : "Run over";
}

/** The fields of the local player the vitals line reads. */
export interface VitalsInput {
  hp: number;
  maxHp: number;
  status: string;
  weapon0: string;
  weapon1: string;
  slot: number;
  /** The barrier still held (0 or absent: none). */
  barrier?: number;
}

/** The weapon in hand by name: "Fists" for an empty hand, "no weapon" for an id from newer server content. */
export function heldWeaponName(me: Pick<VitalsInput, "weapon0" | "weapon1" | "slot">): string {
  const id = me.slot === 1 ? me.weapon1 : me.weapon0;
  if (id === "") return WEAPONS.fists.name;
  return isWeaponId(id) ? WEAPONS[id].name : "no weapon";
}

/**
 * The hp end of the vitals line (after the name and the faction). hp is fractional on the wire; whole numbers on screen,
 * and a player still standing never reads 0. Training swaps the status word (always "alive" there) for the weapon in hand.
 */
export function vitalsHpText(me: VitalsInput | undefined, training: boolean, barrier = 0): string {
  if (!me) return "";
  const hp = hpText(me.hp, me.maxHp, barrier);
  return training ? ` · ${heldWeaponName(me)} · ${hp}` : ` · ${hp} · ${me.status}`;
}

export class Hud {
  private readonly root = el("div", "hud");
  private readonly status = el("div", "hud-status");
  private readonly statusText = el("span");
  /** Your own bounty, next to the run GV: what whoever kills you is paid. */
  private readonly bountyTag = el("span", "hud-bounty");
  /** Name, faction (in its colour) and hp of the local player. */
  private readonly vitals = el("div", "hud-vitals");
  private readonly vitalsName = el("span");
  private readonly vitalsFaction = el("span", "hud-faction");
  private readonly vitalsHp = el("span");
  private readonly cards = new CardsRow();
  /** AD, AP, armor, MR, attack and move speed, leech, card power and the PvP factor (BALANCE_CONTRACT 9), under the cards. */
  private readonly build = new BuildHud();
  /** The ground under the local fighter: BURNING, SLOWED, ICE, RESTING and the home-ground note. */
  private readonly terrain = new TerrainChips();
  private readonly arenaLine = el("div", "hud-arena");
  private readonly arenaHint = el("div", "hud-hint");
  /** Top-center notices; a sibling of the HUD block so they can sit mid-width. */
  private readonly center = el("div", "hud-center");
  private readonly suddenDeath = el("div", "sudden-death", "SUDDEN DEATH");
  private readonly immuneLine = el("div", "immune-line", "Teleport shield — you can't be hurt yet");
  /** Centered over the world; a sibling of the HUD block (not a child) so it can sit mid-screen. */
  private readonly deathLine = el("div", "death-line", "YOU DIED");
  private lastStatus = "";
  private lastBounty = 0;
  private lastVitals = "";
  private lastArena = "";
  /** Set by showDeath(): the server's `result`/death fx arrive before the dead-status patch, so status alone is too late. */
  private deathRequested = false;
  private resultShown = false;
  private deathShown = false;
  /** Training room (state.training, read every update): no run, so no death line either. */
  private training = false;

  constructor() {
    this.status.append(this.statusText, this.bountyTag);
    this.bountyTag.hidden = true;
    this.vitals.append(this.vitalsName, this.vitalsFaction, this.vitalsHp);
    this.root.append(this.status, this.vitals, this.cards.root, this.build.root, this.terrain.root, this.arenaLine, this.arenaHint);
    this.center.append(this.suddenDeath, this.immuneLine);
    this.arenaLine.hidden = true;
    this.arenaHint.hidden = true;
    this.suddenDeath.hidden = true;
    this.immuneLine.hidden = true;
    this.deathLine.hidden = true;
    uiRoot().append(this.root, this.center, this.deathLine);
  }

  /**
   * The HUD plate's box (status, vitals, cards row, arena lines) in the unscaled #ui coordinate system, for overlays
   * docked beside or beneath it (the J quest log). Reads layout: call it only when something needs it.
   */
  get plate(): { left: number; top: number; right: number; bottom: number } {
    const root = this.root;
    return { left: root.offsetLeft, top: root.offsetTop, right: root.offsetLeft + root.offsetWidth, bottom: root.offsetTop + root.offsetHeight };
  }

  /** The ground chips for the tile the local fighter stands on; null shows none. Cheap to call every frame. */
  setTerrain(states: TerrainStates | null): void {
    this.terrain.update(states);
  }

  /** The local player has died (killing result or death fx): show the line now, ahead of the results panel. */
  showDeath(): void {
    // A training room puts a downed fighter back on its feet; there is nothing to announce.
    if (this.training) return;
    this.deathRequested = true;
    this.setDeathShown(!this.resultShown);
  }

  /** The results panel is actually on screen; the death line must not show through or reappear behind it. */
  noteResultShown(): void {
    this.resultShown = true;
    this.setDeathShown(false);
  }

  /**
   * `serverNow`: the estimated current server time (the clock the interpolator syncs, not the render time, which runs
   * INTERP_DELAY_MS behind). Every deadline here (lobby, patience, sudden death, immunity) is a server-time value
   * about the present, so it is counted down against the present; state.serverTime would step in 50 ms jumps.
   */
  update(state: RaidState, me: PlayerState | undefined, serverNow: number): void {
    // Strictly true: a server that predates the field leaves it undefined, and classList.toggle(x, undefined) would toggle.
    const training = state.training === true;
    if (training !== this.training) {
      this.training = training;
      this.status.classList.toggle("training", training);
    }
    let alive = 0;
    if (state.phase === "active" && !training) state.players.forEach((p) => { if (p.status === "alive") alive++; });
    const status = statusLine({
      training, phase: state.phase, playerCount: state.players.size, minPlayers: state.minPlayers,
      lobbyEndsAt: state.lobbyEndsAt, alive, startedWith: state.startedWith, winner: winnerLabel(state.winner, state.players), gv: me ? me.gv : null,
      planEndsAt: state.planEndsAt,
    }, serverNow);
    if (status !== this.lastStatus) { this.statusText.textContent = status; this.lastStatus = status; }

    // A dead player's bounty can't be claimed any more, so it is only shown while they stand.
    const bounty = !training && state.phase === "active" && me?.status === "alive" && me.bounty > 0 ? Math.floor(me.bounty) : 0;
    if (bounty !== this.lastBounty) {
      this.lastBounty = bounty;
      this.bountyTag.textContent = bounty > 0 ? ` · Bounty ${bounty}` : "";
      this.bountyTag.hidden = bounty === 0;
    }

    // The barrier (hp it absorbs) reads after the hp: "HP 400/500 +75 barrier".
    const barrier = me && me.status === "alive" && me.barrier > 0 ? Math.ceil(me.barrier) : 0;
    let key = "";
    if (me) {
      key = `${me.name}|${me.faction}|${Math.ceil(me.hp)}|${Math.round(me.maxHp)}|${barrier}|${me.status}`;
      if (training) key += `|T|${me.slot}|${me.weapon0}|${me.weapon1}`;
    }
    if (key !== this.lastVitals) {
      this.lastVitals = key;
      const faction = me && isFactionId(me.faction) ? FACTIONS[me.faction] : null;
      this.vitalsName.textContent = me?.name ?? "";
      this.vitalsFaction.textContent = faction ? ` · ${faction.displayName}` : "";
      this.vitalsFaction.style.color = faction ? cssColor(faction.color) : "";
      this.vitalsHp.textContent = vitalsHpText(me, training, barrier);
    }

    this.cards.update(me?.build, me?.status === "alive");
    this.build.update(me, me?.status === "alive");
    this.updateArena(state, serverNow);
    const immune = !training && me?.status === "alive" && state.phase === "active" && serverNow < me.immuneUntil;
    if (this.immuneLine.hidden === immune) this.immuneLine.hidden = !immune;
    this.setDeathShown(!training && (this.deathRequested || me?.status === "dead") && !this.resultShown);
  }

  /**
   * The patience timer, the locked gates and sudden death, from the deadlines the server publishes. The hint line is
   * the rule for the phase the player is looking at (a death resets everything), which is what the timers hang on.
   */
  private updateArena(state: RaidState, serverNow: number): void {
    let line = "";
    let hint = "";
    let locked = false;
    let sudden = false;
    // Training has no patience timer, gates or sudden death (the server never arms them; this is the second lock).
    if (state.phase === "active" && state.training !== true) {
      if (state.gatesLocked && state.suddenDeathAt > 0) {
        if (serverNow >= state.suddenDeathAt) {
          sudden = true;
          hint = "Everyone is losing hp, faster every second — a death ends it";
        } else {
          locked = true;
          line = `Gates locked — sudden death in ${fmtSeconds(state.suddenDeathAt - serverNow)}`;
          hint = "The gates open when someone dies";
        }
      } else if (state.patienceEndsAt > 0) {
        // Gates that opened after a death in the coliseum close again when the timer runs out.
        line = `${state.inColiseum ? "Gates lock again" : "Coliseum"} in ${fmtSeconds(state.patienceEndsAt - serverNow)}`;
        // The length follows the players standing (5:00 at 8, 2:00 at 3 or fewer), so say which way it moves.
        hint = "Any death resets the timer — fewer players left, shorter timer";
      }
    }

    // The tone is part of the key so a change of tone with the same text still repaints.
    const key = `${locked ? "L" : ""}${sudden ? "S" : ""}|${line}|${hint}`;
    if (key !== this.lastArena) {
      this.lastArena = key;
      this.arenaLine.textContent = line;
      this.arenaLine.hidden = line === "";
      this.arenaLine.classList.toggle("locked", locked);
      this.arenaHint.textContent = hint;
      this.arenaHint.hidden = hint === "";
      this.suddenDeath.hidden = !sudden;
    }
  }

  private setDeathShown(shown: boolean): void {
    if (shown === this.deathShown) return;
    this.deathShown = shown;
    this.deathLine.hidden = !shown;
  }

  destroy(): void {
    this.cards.destroy();
    this.build.destroy();
    this.terrain.destroy();
    this.root.remove();
    this.center.remove();
    this.deathLine.remove();
  }
}
