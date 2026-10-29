import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACTIONS, FACTION_IDS, encodeFlat, wishOf } from "@raid/shared";
import { MobState, PlayerState, RaidState } from "@raid/shared/schema";
import { ChampionCombatHud } from "../src/ui/championCombatHud";
import { Hud } from "../src/ui/hud";
import { FakeEl, fakeEvent, installFakeDom } from "./fakes";

beforeEach(() => { installFakeDom(); });
afterEach(() => { vi.unstubAllGlobals(); });

function player(faction = "fire"): PlayerState {
  const p = new PlayerState();
  p.faction = faction;
  p.status = "alive";
  p.maxHp = p.hp = FACTIONS[faction as keyof typeof FACTIONS].hp;
  p.weapon0 = "sword";
  p.weapon1 = "wand";
  p.adBonus = encodeFlat(40);
  p.apBonus = encodeFlat(80);
  return p;
}
function run(): RaidState {
  const state = new RaidState();
  state.phase = "active";
  return state;
}
function text(node: FakeEl): string {
  return [node.textContent, ...node.children.map(c => c instanceof FakeEl ? text(c) : c)].join(" ");
}
function descendant(root: FakeEl, className: string): FakeEl | undefined {
  if (root.className.split(" ").includes(className)) return root;
  for (const child of root.children) {
    if (child instanceof FakeEl) {
      const found = descendant(child, className);
      if (found) return found;
    }
  }
  return undefined;
}
function setup() {
  const dom = installFakeDom();
  const hud = new ChampionCombatHud(dom.ui as unknown as HTMLElement);
  const root = descendant(dom.ui, "champion-combat-hud")!;
  return { dom, hud, root };
}

describe("compact champion combat HUD", () => {
  it("refreshes zombie health and death without any change to Plague's stats", () => {
    const { hud, root } = setup();
    const state = run(), p = player("plague");
    p.corpseStacks = 1; p.plagueZombieId = "zombie";
    const zombie = new MobState();
    zombie.kind = "zombie"; zombie.ownerId = "plague";
    zombie.status = "alive"; zombie.hp = zombie.maxHp = 500;
    state.mobs.set("zombie", zombie);
    hud.update(state, p, 0);
    expect(text(root)).toContain("Zombie 500/500 HP");
    zombie.hp = 200;
    hud.update(state, p, 50);
    expect(text(root)).toContain("Zombie 200/500 HP");
    zombie.status = "dead"; zombie.hp = 0;
    hud.update(state, p, 100);
    expect(text(root)).toContain("Zombie fallen");
    expect(text(root)).toContain("walk over a body to revive");
  });

  it("shows the selected champion's kit during combat and training, and hides outside play", () => {
    const { hud, root } = setup();
    expect(root.hidden).toBe(true);
    const state = run();
    for (const faction of FACTION_IDS) {
      hud.update(state, player(faction), 0);
      expect(root.hidden).toBe(false);
      expect(text(root)).toContain(FACTIONS[faction].displayName);
      expect(text(root)).toContain(wishOf(faction)!.name);
    }
    state.phase = "lobby";
    hud.update(state, player(), 0);
    expect(root.hidden).toBe(true);
    state.phase = "planning";
    hud.update(state, player(), 0);
    expect(root.hidden).toBe(true);
    state.phase = "active";
    state.training = true;
    hud.update(state, player(), 0);
    expect(root.hidden).toBe(false);
    hud.update(state, undefined, 0);
    expect(root.hidden).toBe(true);
    const dead = player();
    dead.status = "dead";
    hud.update(state, dead, 0);
    expect(root.hidden).toBe(true);
    state.training = false;
    state.phase = "over";
    hud.update(state, player(), 0);
    expect(root.hidden).toBe(true);
    hud.destroy();
  });

  it("refreshes the equipped weapon and combat values on swaps and stat changes", () => {
    const { hud, root } = setup();
    const p = player();
    const state = run();
    hud.update(state, p, 0);
    expect(descendant(root, "champion-combat-weapon")!.textContent).toContain("Sword");
    const sword = text(root);
    p.slot = 1;
    hud.update(state, p, 50);
    expect(descendant(root, "champion-combat-weapon")!.textContent).toContain("Wand");
    expect(text(root)).not.toBe(sword);
    const wand = text(root);
    p.apBonus = encodeFlat(160);
    hud.update(state, p, 100);
    expect(text(root)).not.toBe(wand);
    const holy = player("holy");
    hud.update(state, holy, 150);
    const fullHp = text(root);
    holy.hp = holy.maxHp / 2;
    hud.update(state, holy, 200);
    expect(text(root)).not.toBe(fullHp);
    hud.destroy();
  });

  it("lets world clicks pass through and removes its passive hover listeners", () => {
    const { dom, hud, root } = setup();
    hud.update(run(), player(), 0);
    const event = fakeEvent("pointerdown", { target: root });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(event.propagationStopped).toBe(false);
    expect(dom.win.listenerCount("pointermove")).toBe(1);
    hud.destroy();
    expect(root.removed).toBe(true);
    expect(dom.win.listenerCount()).toBe(0);
  });

  it("refreshes an open hover explanation without dismissing it when the weapon changes", () => {
    const { dom, hud, root } = setup();
    const p = player();
    const state = run();
    hud.update(state, p, 0);
    const rows = descendant(root, "champion-combat-rows")!;
    const auto = descendant(rows, "auto")!;
    rows.rect = { left: 12, top: 500, width: 250, height: 120 };
    auto.rect = { left: 12, top: 500, width: 250, height: 36 };
    dom.win.dispatchEvent(fakeEvent("pointermove", { target: new FakeEl("canvas"), clientX: 40, clientY: 510 }));
    expect(auto.classList.contains("tip-on")).toBe(true);
    const tip = descendant(auto, "champion-combat-tip")!;
    const oldTip = tip.textContent;
    p.slot = 1;
    hud.update(state, p, 50);
    expect(tip.textContent).not.toBe(oldTip);
    expect(auto.classList.contains("tip-on")).toBe(true);
    p.status = "dead";
    hud.update(state, p, 100);
    expect(auto.classList.contains("tip-on")).toBe(false);
    hud.destroy();
  });

  it("hides with the Hud's death and results notifications before a status patch arrives", () => {
    const dom = installFakeDom();
    const hud = new Hud();
    const root = descendant(dom.ui, "champion-combat-hud")!;
    const state = run();
    const p = player();
    hud.update(state, p, 0);
    expect(root.hidden).toBe(false);
    hud.showDeath();
    hud.update(state, p, 50);
    expect(root.hidden).toBe(true);
    hud.noteResultShown();
    hud.update(state, p, 100);
    expect(root.hidden).toBe(true);
    hud.destroy();
  });
});
