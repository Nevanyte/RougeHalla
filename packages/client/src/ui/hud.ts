// In-run DOM overlay: the lobby countdown or the run line (players standing, GV, your bounty), the arena timers (coliseum
// teleport → locked gates → sudden death), player vitals (faction and hp), the teleport-immunity hint and the
// "you died" line. The buff stacks, combo progress and feed line are buffsHud.ts, placed under the vitals.
import { FACTIONS, hpText, isFactionId } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { BuffsHud } from "./buffsHud";
import { cssColor, el, uiRoot } from "./dom";

function fmtSeconds(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
  private readonly buffs = new BuffsHud();
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

  constructor() {
    this.status.append(this.statusText, this.bountyTag);
    this.bountyTag.hidden = true;
    this.vitals.append(this.vitalsName, this.vitalsFaction, this.vitalsHp);
    this.root.append(this.status, this.vitals, this.buffs.root, this.arenaLine, this.arenaHint);
    this.center.append(this.suddenDeath, this.immuneLine);
    this.arenaLine.hidden = true;
    this.arenaHint.hidden = true;
    this.suddenDeath.hidden = true;
    this.immuneLine.hidden = true;
    this.deathLine.hidden = true;
    uiRoot().append(this.root, this.center, this.deathLine);
  }

  /** The local player has died (killing result or death fx): show the line now, ahead of the results panel. */
  showDeath(): void {
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
    let status: string;
    if (state.phase === "lobby") {
      status = `Waiting for players ${state.players.size}/${state.minPlayers} — run starts in ${fmtSeconds(state.lobbyEndsAt - serverNow)}`;
    } else if (state.phase === "active") {
      let alive = 0;
      state.players.forEach((p) => { if (p.status === "alive") alive++; });
      // Not players.size: leavers (including the dead going back to the hub) drop out of state.players.
      status = `Alive ${alive}/${state.startedWith}`;
      if (me) status += ` · Run GV ${me.gv}`;
    } else {
      status = state.winner ? `Run over — ${state.winner} is victorious` : "Run over";
    }
    if (status !== this.lastStatus) { this.statusText.textContent = status; this.lastStatus = status; }

    // A dead player's bounty can't be claimed any more, so it is only shown while they stand.
    const bounty = state.phase === "active" && me?.status === "alive" && me.bounty > 0 ? Math.floor(me.bounty) : 0;
    if (bounty !== this.lastBounty) {
      this.lastBounty = bounty;
      this.bountyTag.textContent = bounty > 0 ? ` · Bounty ${bounty}` : "";
      this.bountyTag.hidden = bounty === 0;
    }

    // hp is fractional on the wire; whole numbers on screen, and a player still standing never reads 0. The kill barrier
    // (hp the hp combos absorb) reads after it: "HP 400/500 +75 shield".
    const barrier = me && me.status === "alive" && me.barrier > 0 ? Math.ceil(me.barrier) : 0;
    let key = "";
    if (me) key = `${me.name}|${me.faction}|${Math.ceil(me.hp)}|${Math.round(me.maxHp)}|${barrier}|${me.status}`;
    if (key !== this.lastVitals) {
      this.lastVitals = key;
      const faction = me && isFactionId(me.faction) ? FACTIONS[me.faction] : null;
      this.vitalsName.textContent = me?.name ?? "";
      this.vitalsFaction.textContent = faction ? ` · ${faction.displayName}` : "";
      this.vitalsFaction.style.color = faction ? cssColor(faction.color) : "";
      this.vitalsHp.textContent = me ? ` · ${hpText(me.hp, me.maxHp, barrier)} · ${me.status}` : "";
    }

    this.buffs.update(state, me);
    this.updateArena(state, serverNow);
    const immune = me?.status === "alive" && state.phase === "active" && serverNow < me.immuneUntil;
    if (this.immuneLine.hidden === immune) this.immuneLine.hidden = !immune;
    this.setDeathShown((this.deathRequested || me?.status === "dead") && !this.resultShown);
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
    if (state.phase === "active") {
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
    this.buffs.destroy();
    this.root.remove();
    this.center.remove();
    this.deathLine.remove();
  }
}
