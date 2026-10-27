// The ground chips under the vitals: BURNING, SLOWED, ICE and RESTING for the tile the local fighter stands on, each a glyph and
// a word (colour is never the only cue), and a "Home ground" line for the faction that a hazard cannot touch. Derived from the
// shared map (render/zoneArt/terrainFeedback.ts); the DOM is rebuilt only when the set of chips changes. Hud places `root`.
import { NO_STATES, chipsOf, homeNote, sameStates, type TerrainStates } from "../render/zoneArt/terrainFeedback";
import { el } from "./dom";
import "./terrainChips.css";

export class TerrainChips {
  readonly root = el("div", "hud-terrain");
  private last: TerrainStates = NO_STATES;

  constructor() {
    this.root.hidden = true;
    this.root.setAttribute?.("aria-live", "polite");
  }

  /** `states` null (not playing, or dead) shows nothing. Cheap to call every frame. */
  update(states: TerrainStates | null): void {
    const next = states ?? NO_STATES;
    if (sameStates(next, this.last)) return;
    this.last = next;
    const chips = chipsOf(next);
    const note = homeNote(next);
    const nodes: HTMLElement[] = chips.map((chip) => {
      const node = el("span", `ground-chip ${chip.id}`);
      node.title = chip.title;
      node.append(el("span", "ground-chip-glyph", chip.glyph), chip.text);
      return node;
    });
    if (note) nodes.push(el("div", "ground-note", note));
    // The test DOMs (test/fakes.ts) have no replaceChildren: empty the list by hand there.
    if (typeof this.root.replaceChildren === "function") this.root.replaceChildren(...nodes);
    else {
      (this.root as unknown as { children: unknown[] }).children.length = 0;
      this.root.append(...nodes);
    }
    this.root.hidden = nodes.length === 0;
  }

  destroy(): void {
    this.root.remove();
  }
}
