import { afterEach, describe, expect, it, vi } from "vitest";
import { mapFromTiles, TILE_FLOOR } from "@raid/shared";
import { TraderPanel } from "../src/ui/traderPanel";
import { installPlanningDom } from "./planningDom";

afterEach(() => vi.unstubAllGlobals());
const map = mapFromTiles(20, 20, new Uint8Array(400).fill(TILE_FLOOR));
const trader = { id: "t", kind: "stats", name: "Soul Broker", x: 200, y: 200 };
const offers = [0, 1, 2].map(i => JSON.stringify({ cost: "maxHp", costValue: .12, gain: "ad", gainValue: 18, label: `Trade option ${i + 1}` }));
const player = () => ({ x: 200, y: 200, status: "alive", weapon0: "sword", weapon1: "", slot: 0, tradeUsed: false, tradeOffers: offers, potionSmall: 0 });

describe("wandering trader panel", () => {
  it("offers three server-defined choices nearby and sends one choice without duplicate clicks", () => {
    const dom = installPlanningDom(), send = vi.fn(), panel = new TraderPanel(send);
    const me = player();
    panel.update({ map, me, traders: new Map([[trader.id, trader]]), serverNow: 100 });
    expect(dom.ui.one("trader-panel").hidden).toBe(false);
    const buttons = dom.ui.byClass("trader-choice");
    expect(buttons.map(b => b.textContent)).toEqual(["Trade option 1", "Trade option 2", "Trade option 3"]);
    buttons[1]!.click(); buttons[1]!.click();
    expect(send).toHaveBeenCalledExactlyOnceWith("t", 1);
    me.tradeUsed = true;
    panel.update({ map, me, traders: new Map([[trader.id, trader]]), serverNow: 1000 });
    expect(dom.ui.byClass("trader-choice").every(b => b.disabled)).toBe(true);
    expect(dom.ui.one("trader-panel").allText).toContain("complete for this run");
    panel.destroy(); expect(dom.ui.byClass("trader-panel")).toHaveLength(0);
  });

  it("requires range, sight and a living player; closing stays dismissed until leaving", () => {
    const dom = installPlanningDom(), panel = new TraderPanel(vi.fn()), me = player();
    const frame = { map, me, traders: new Map([[trader.id, trader]]) };
    panel.update({ ...frame, canSee: () => false });
    expect(dom.ui.one("trader-panel").hidden).toBe(true);
    panel.update(frame); dom.ui.one("trader-close").click(); panel.update(frame);
    expect(dom.ui.one("trader-panel").hidden).toBe(true);
    me.x = 600; panel.update(frame); me.x = 200; panel.update(frame);
    expect(dom.ui.one("trader-panel").hidden).toBe(false);
    me.status = "dead"; panel.update(frame);
    expect(dom.ui.one("trader-panel").hidden).toBe(true);
    panel.destroy();
  });

  it("shows barter choices and disables item exchanges without a potion and empty slot", () => {
    const dom = installPlanningDom(), panel = new TraderPanel(vi.fn()), me = player();
    const frame = { map, me, traders: new Map([["t", { ...trader, kind: "barter" }]]) };
    panel.update(frame);
    expect(dom.ui.byClass("trader-choice")[2]!.disabled).toBe(true);
    me.potionSmall = 1; panel.update(frame);
    expect(dom.ui.byClass("trader-choice")[2]!.disabled).toBe(false);
    me.weapon1 = "wand"; panel.update(frame);
    expect(dom.ui.byClass("trader-choice")[2]!.disabled).toBe(true);
    panel.destroy();
  });
});
