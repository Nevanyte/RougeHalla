// Post-run summary: outcome, placing, run stats and the Glorious Victory the run paid out.
import { WIN_BONUS_MIN_OPPONENTS, WIN_BONUS_MIN_PLAYERS, achievementById, cosmeticById, type RunOutcome, type RunResult } from "@raid/shared";
import { formatNumber } from "../net/profile";
import { el, uiRoot } from "./dom";

const TITLES: Record<RunOutcome, string> = {
  won: "VICTORY",
  draw: "DRAW",
  died: "YOU DIED",
  mia: "LEFT THE RUN",
};

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Players in a draw share the place, so say so. */
function fmtPlace(r: RunResult): string {
  const base = `#${r.place} of ${r.players} ${r.players === 1 ? "player" : "players"}`;
  return r.outcome === "draw" ? `${base} (shared)` : base;
}

/** Why a winner's bonus row reads +0: the anti alt-farming rule (shared constants, so the text can't drift). */
const WITHHELD = `Win bonus: needs ${WIN_BONUS_MIN_PLAYERS}+ players and damage on ${WIN_BONUS_MIN_OPPONENTS}+ opponents`;

function gvRows(r: RunResult): HTMLElement {
  const gv = r.gv;
  const box = el("div", "gv-box");
  const winText = r.winBonusWithheld ? WITHHELD : "Win bonus";
  for (const [text, amount] of [["Kills", gv.kills], ["Mobs", gv.mobs], ["Bounties", gv.bounty], [winText, gv.win]] as const) {
    // `|| 0`: a field missing from the payload (an older server) reads as nothing earned, not as "+NaN".
    const earned = amount || 0;
    const row = el("div", earned > 0 ? "gv-row" : "gv-row zero");
    row.append(el("span", undefined, text), el("span", "gv-amount", `+${formatNumber(earned)}`));
    box.append(row);
  }
  const total = el("div", "gv-total");
  total.append(el("span", undefined, "GV banked"), el("span", "gv-amount", `+${formatNumber(gv.total)}`));
  box.append(total);
  return box;
}

/**
 * What the run unlocked: each achievement with the cosmetics it granted. Ids come from the server but only the
 * catalog's own names are shown, and ids this client doesn't know are skipped.
 */
function achievementRows(ids: readonly string[] | undefined): HTMLElement | null {
  const unlocked = (Array.isArray(ids) ? ids : []).flatMap((id) => achievementById(id) ?? []);
  if (unlocked.length === 0) return null;
  const box = el("div", "ach-box");
  box.append(el("div", "ach-title", "Achievements unlocked"));
  for (const a of unlocked) {
    const row = el("div", "ach-row");
    row.append(el("span", "ach-name", a.name));
    const rewards = a.reward.flatMap((id) => cosmeticById(id)?.name ?? []);
    if (rewards.length > 0) row.append(el("span", "ach-reward", `Reward: ${rewards.join(", ")}`));
    box.append(row);
  }
  return box;
}

export class ResultsScreen {
  private readonly root = el("div", "panel results");
  visible = false;

  constructor(private readonly handlers: { onContinue(): void }) {}

  show(r: RunResult): void {
    const facts = [`Time ${fmtDuration(r.durationSec)}`, `Kills ${r.kills}`];
    if (r.killedBy) facts.push(`Killed by ${r.killedBy}`);

    const unlocked = achievementRows(r.achievements);
    const btn = el("button", "btn primary", "Back to hub");
    btn.addEventListener("click", () => this.handlers.onContinue());

    this.root.replaceChildren(
      el("h1", `outcome-${r.outcome}`, TITLES[r.outcome] ?? "RUN OVER"),
      el("p", "result-place", fmtPlace(r)),
      el("p", "result-facts", facts.join(" · ")),
      gvRows(r),
      ...(unlocked ? [unlocked] : []),
      btn,
    );
    uiRoot().append(this.root);
    this.visible = true;
  }

  hide(): void {
    this.root.remove();
    this.visible = false;
  }
}
