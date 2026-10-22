// Post-raid summary. Phase 5 fleshes this out (item lists, stash delta).
import type { RaidResult } from "@raid/shared";
import { el, uiRoot } from "./dom";

const TITLES: Record<RaidResult["outcome"], string> = {
  extracted: "EXTRACTED",
  died: "KILLED IN ACTION",
  mia: "MISSING IN ACTION",
};

export class ResultsScreen {
  private readonly root = el("div", "panel results");
  visible = false;

  constructor(private readonly handlers: { onContinue(): void }) {}

  show(r: RaidResult): void {
    this.root.replaceChildren(
      el("h1", `outcome-${r.outcome}`, TITLES[r.outcome]),
      el("p", undefined, `Time in raid: ${r.durationSec}s · Kills: ${r.kills}${r.killedBy ? ` · Killed by ${r.killedBy}` : ""}`),
    );
    const btn = el("button", "btn primary", "Back to menu");
    btn.addEventListener("click", () => this.handlers.onContinue());
    this.root.append(btn);
    uiRoot().append(this.root);
    this.visible = true;
  }

  hide(): void {
    this.root.remove();
    this.visible = false;
  }
}
