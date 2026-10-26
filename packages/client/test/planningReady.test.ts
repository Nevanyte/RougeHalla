// The planning screen's Ready latch and picks follow the server's word (ui/planning.ts). A click shows at once but waits for the
// server (planReady, the next `plan` message) for PENDING_EXPIRE_MS; an order the socket dropped while reconnecting (the client
// keeps no queue, net/connection.ts) must not lock the player out of planning, nor hold up the early start for everyone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMap, type ClientMessages, type GameMap, type PlanMessage } from "@raid/shared";
import { ORDER_EXPIRE_MS } from "../src/net/localMotion";
import { DEFAULT_SETTINGS, SettingsStore } from "../src/settings";
import { PENDING_EXPIRE_MS, PlanningView, RECONNECTING_TITLE, type PlanningFrame } from "../src/ui/planning";
import { RouteState } from "../src/ui/route";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { asEl, installPlanningDom, type PEl } from "./planningDom";

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => { setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true })); });

const MAP: GameMap = generateMap(7);
const SA = 0;
const SB = MAP.spawnPool.findIndex((s) => s.zone !== MAP.spawnPool[SA]!.zone);

const plan = (over: Partial<PlanMessage> = {}): PlanMessage => ({
  endsAt: 12_000, spawns: [SA, SB], taken: [false, false], pick: -1, boons: [], boon: -1, ...over,
});

const frame = (over: Partial<PlanningFrame> = {}): PlanningFrame => ({
  mode: "planning", serverNow: 0, endsAt: 12_000, meReady: false,
  players: [{ faction: "plague", ready: false, me: true }, { faction: "holy", ready: false, me: false }],
  campTypes: [], local: null, ...over,
});

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

function setup() {
  installPlanningDom();
  const store = new SettingsStore(memoryStorage());
  store.update({ ...DEFAULT_SETTINGS });
  const clock = { t: 1000 };
  const link = { up: true };
  const sent: Array<ClientMessages["plan"]> = [];
  const view = new PlanningView({
    map: MAP, route: new RouteState(null, null), settings: store,
    send: (m) => { sent.push(m); }, now: () => clock.t, canSend: () => link.up,
  });
  const root = asEl(view.element);
  const ready = (): PEl => root.one("pl-ready");
  const cards = (): PEl[] => root.byClass("pl-spawn");
  const boons = (): PEl[] => root.byClass("pl-boon");
  /** One frame later: what the scene does every tick. */
  const tick = (ms: number, over: Partial<PlanningFrame> = {}): void => { clock.t += ms; view.update(frame(over)); };
  const open = (p: PlanMessage = plan(), over: Partial<PlanningFrame> = {}): void => { view.setPlan(p); view.update(frame(over)); };
  return { view, sent, clock, link, ready, cards, boons, tick, open, status: (): string => root.one("pl-status").textContent };
}

describe("Ready follows the server", () => {
  it("waits as long as an order may take, the same wait the walk prediction gives", () => {
    expect(PENDING_EXPIRE_MS).toBe(ORDER_EXPIRE_MS);
    expect(PENDING_EXPIRE_MS).toBeGreaterThan(0);
  });

  it("shows Ready at once, and lets go when the server never confirms: the button works again, and so do the picks", () => {
    const { view, sent, ready, cards, tick, open, status } = setup();
    open(plan({ pick: 0 }));
    ready().click();
    expect(sent).toEqual([{ ready: true }]);
    expect(view.ready).toBe(true);
    expect(ready().disabled).toBe(true);
    expect(ready().textContent).toBe("Ready ✓");
    // Frames that still say "not ready" inside the wait keep it latched, and the picks refused.
    tick(PENDING_EXPIRE_MS - 100);
    expect(view.ready).toBe(true);
    expect(ready().disabled).toBe(true);
    cards()[1]!.click();
    expect(sent).toEqual([{ ready: true }]);
    // Past it, the server's word stands: not ready.
    tick(200);
    expect(view.ready).toBe(false);
    expect(ready().disabled).toBe(false);
    expect(ready().textContent).toBe("Ready");
    expect(ready().getAttribute("aria-pressed")).toBe("false");
    expect(status()).toContain("did not confirm");
    cards()[1]!.click();
    expect(sent).toEqual([{ ready: true }, { spawn: 1 }]);
    ready().click();
    expect(sent).toEqual([{ ready: true }, { spawn: 1 }, { ready: true }]);
  });

  it("stays latched once the server confirms, however long planning goes on", () => {
    const { view, sent, ready, cards, tick, open } = setup();
    open(plan({ pick: 0 }));
    ready().click();
    tick(80, { meReady: true });
    tick(PENDING_EXPIRE_MS * 5, { meReady: true });
    expect(view.ready).toBe(true);
    expect(ready().disabled).toBe(true);
    expect(ready().textContent).toBe("Ready ✓");
    cards()[1]!.click();
    ready().click();
    expect(sent).toEqual([{ ready: true }]);
  });

  it("is latched from the first frame when the state already says so (a reload), with no click of its own", () => {
    const { view, sent, ready, tick, open } = setup();
    open(plan({ pick: 1 }), { meReady: true });
    expect(view.ready).toBe(true);
    expect(ready().disabled).toBe(true);
    tick(PENDING_EXPIRE_MS * 2, { meReady: true });
    expect(view.ready).toBe(true);
    expect(sent).toEqual([]);
  });

  it("lets go when the server's frame says not ready after it said ready", () => {
    const { view, ready, cards, sent, tick, open } = setup();
    open(plan({ pick: 0 }), { meReady: true });
    expect(view.ready).toBe(true);
    tick(50, { meReady: false });
    expect(view.ready).toBe(false);
    expect(ready().disabled).toBe(false);
    expect(ready().textContent).toBe("Ready");
    cards()[1]!.click();
    expect(sent).toEqual([{ spawn: 1 }]);
  });

  it("a click after an unlatch, confirmed later than the wait, still ends up latched", () => {
    const { view, ready, tick, open } = setup();
    open(plan({ pick: 0 }));
    ready().click();
    tick(PENDING_EXPIRE_MS + 50);
    expect(view.ready).toBe(false);
    tick(40, { meReady: true }); // the slow patch arrives after all
    expect(view.ready).toBe(true);
    expect(ready().disabled).toBe(true);
  });

  it("forgets a click that was waiting when the plan is cleared (a new room) or the screen is left", () => {
    const { view, tick, ready, open } = setup();
    open(plan({ pick: 0 }));
    ready().click();
    expect(view.ready).toBe(true);
    view.setPlan(null);
    tick(10);
    expect(view.ready).toBe(false);
    open(plan({ pick: 0 }));
    ready().click();
    expect(view.ready).toBe(true);
    tick(10, { mode: "hidden" });
    tick(10);
    expect(view.ready).toBe(false);
  });
});

describe("while the connection is down", () => {
  it("sends nothing and latches nothing: Ready is disabled with a reconnecting title", () => {
    const { view, sent, link, ready, tick, open, status } = setup();
    open(plan({ pick: 0 }));
    link.up = false;
    tick(16);
    expect(ready().disabled).toBe(true);
    expect(ready().title).toBe(RECONNECTING_TITLE);
    expect(ready().title.toLowerCase()).toContain("reconnecting");
    expect(ready().textContent).toBe("Ready");
    // A click that gets through anyway (a keyboard press on a focused button, a test): refused, not shown as done.
    ready().click();
    expect(sent).toEqual([]);
    expect(view.ready).toBe(false);
    expect(ready().getAttribute("aria-pressed")).toBe("false");
    expect(status().toLowerCase()).toContain("reconnecting");
    // A long outage later, nothing is waiting on the server.
    tick(PENDING_EXPIRE_MS * 4);
    expect(view.ready).toBe(false);
  });

  it("is back to normal once the connection is: the button works and the title is gone", () => {
    const { view, sent, link, ready, tick, open } = setup();
    open(plan({ pick: 0 }));
    link.up = false;
    tick(16);
    ready().click();
    link.up = true;
    tick(16);
    expect(ready().disabled).toBe(false);
    expect(ready().title).toBe("");
    ready().click();
    expect(sent).toEqual([{ ready: true }]);
    expect(view.ready).toBe(true);
  });

  it("neither sends a pick or a boon nor shows one as made", () => {
    const { view, sent, link, cards, boons, tick, open } = setup();
    open(plan({ boons: ["quickStep", "ironSkin"] }));
    link.up = false;
    tick(16);
    cards()[1]!.click();
    boons()[1]!.click();
    expect(sent).toEqual([]);
    expect(view.pick).toBe(-1);
    expect(boons()[1]!.getAttribute("aria-pressed")).toBe("false");
    link.up = true;
    cards()[1]!.click();
    expect(sent).toEqual([{ spawn: 1 }]);
  });

  it("a Ready that was sent just before the drop and never confirmed still lets go", () => {
    const { view, link, ready, tick, open } = setup();
    open(plan({ pick: 0 }));
    ready().click();
    link.up = false;
    tick(PENDING_EXPIRE_MS + 50);
    expect(view.ready).toBe(false);
    expect(ready().disabled).toBe(true); // down: it cannot be pressed again yet
    link.up = true;
    tick(16);
    expect(ready().disabled).toBe(false);
  });
});

describe("a pick or a boon the server never answered", () => {
  it("falls back to the server's pick after the wait, and the next click is sent again", () => {
    const { view, sent, cards, tick, open } = setup();
    open(plan());
    cards()[0]!.click();
    expect(view.pick).toBe(0);
    tick(PENDING_EXPIRE_MS - 100);
    expect(view.pick).toBe(0);
    tick(200);
    expect(view.pick).toBe(-1);
    cards()[0]!.click();
    expect(sent).toEqual([{ spawn: 0 }, { spawn: 0 }]);
  });

  it("the server's resend inside the wait confirms it, and the wait leaves it alone", () => {
    const { view, cards, tick, open } = setup();
    open(plan());
    cards()[1]!.click();
    view.setPlan(plan({ pick: 1 }));
    tick(PENDING_EXPIRE_MS * 3);
    expect(view.pick).toBe(1);
  });

  it("a boon click falls back the same way", () => {
    const { sent, boons, tick, open } = setup();
    open(plan({ boons: ["quickStep", "ironSkin"], boon: 0 }));
    boons()[1]!.click();
    expect(boons()[1]!.getAttribute("aria-pressed")).toBe("true");
    tick(PENDING_EXPIRE_MS + 50);
    expect(boons()[1]!.getAttribute("aria-pressed")).toBe("false");
    expect(boons()[0]!.getAttribute("aria-pressed")).toBe("true");
    boons()[1]!.click();
    expect(sent).toEqual([{ boon: 1 }, { boon: 1 }]);
  });
});
