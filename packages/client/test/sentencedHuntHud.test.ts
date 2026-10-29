import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerState, RaidState } from "@raid/shared/schema";
import { SentencedHuntHud } from "../src/ui/sentencedHuntHud";
import { FakeEl, installFakeDom } from "./fakes";

beforeEach(() => { installFakeDom(); });
afterEach(() => { vi.unstubAllGlobals(); });

function player(name: string, faction: string, status = "alive"): PlayerState {
  const p = new PlayerState();
  p.name = name; p.faction = faction; p.status = status;
  return p;
}
function find(root: FakeEl, cls: string): FakeEl | undefined {
  if (root.className.split(" ").includes(cls)) return root;
  for (const child of root.children) if (child instanceof FakeEl) {
    const result = find(child, cls);
    if (result) return result;
  }
  return undefined;
}

describe("Sentenced hunt HUD", () => {
  it("offers living rivals, sends the selected ID, and locks choices until the target falls", () => {
    const dom = installFakeDom();
    const hud = new SentencedHuntHud(dom.ui as unknown as HTMLElement);
    const state = new RaidState(); state.phase = "active";
    const me = player("Judge", "sentenced");
    state.players.set("me", me);
    state.players.set("r1", player("Alpha", "fire"));
    state.players.set("r2", player("Beta", "holy"));
    state.players.set("dead", player("Gone", "frost", "dead"));
    const sent: Array<{ id: string }> = [];
    const send = (message: { id: string }) => sent.push(message);

    hud.update(state, "me", send);
    const root = find(dom.ui, "sentenced-hunt-hud")!;
    const list = find(root, "sentenced-hunt-list")!;
    expect(root.hidden).toBe(false);
    expect(list.children).toHaveLength(2);
    expect(list.children.map((el) => (el as FakeEl).textContent)).toEqual(["Alpha · Fire", "Beta · Demon Blood"]);
    const first = list.children[0] as FakeEl;
    first.listeners.get("click")?.forEach((fn) => fn({}));
    expect(sent).toEqual([{ id: "r1" }]);

    me.huntTarget = "r1";
    hud.update(state, "me", send);
    expect(find(root, "sentenced-hunt-status")!.textContent).toContain("Tracking Alpha");
    expect(list.children).toHaveLength(0);
    me.huntTarget = ""; me.huntStacks = 1;
    hud.update(state, "me", send);
    expect(find(root, "sentenced-hunt-title")!.textContent).toContain("+2% mark strength");
    hud.destroy();
    expect(root.removed).toBe(true);
  });

  it("hides for other classes, dead players, training, and non-active phases", () => {
    const dom = installFakeDom();
    const hud = new SentencedHuntHud(dom.ui as unknown as HTMLElement);
    const state = new RaidState(); state.phase = "active";
    const me = player("Judge", "fire"); state.players.set("me", me);
    hud.update(state, "me", () => {});
    const root = find(dom.ui, "sentenced-hunt-hud")!;
    expect(root.hidden).toBe(true);
    me.faction = "sentenced"; me.status = "dead";
    hud.update(state, "me", () => {}); expect(root.hidden).toBe(true);
    me.status = "alive"; state.training = true;
    hud.update(state, "me", () => {}); expect(root.hidden).toBe(true);
    state.training = false; state.phase = "lobby";
    hud.update(state, "me", () => {}); expect(root.hidden).toBe(true);
    hud.destroy();
  });
});
