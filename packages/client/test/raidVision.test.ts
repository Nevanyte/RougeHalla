import { afterEach, describe, expect, it, vi } from "vitest";
import { EFFECT_HIDDEN, REGION_COLISEUM, TILE, VISION_RADIUS, Y_SCALE, mapFromTiles, type GameMap } from "@raid/shared";
import { RaidVision, VisionFog, visibleCollection } from "../src/render/RaidVision";
import { shouldRenderActor } from "../src/render/visibility";
import { edgeThreat, EdgeThreatView } from "../src/ui/edgeThreat";
import { CampWards } from "../src/render/CampWards";
import { argsOf, fakeScene, installFakeDom } from "./fakes";

function map(): GameMap {
  const map = mapFromTiles(120, 80, new Uint8Array(120 * 80), 17);
  map.camps.push({ id: "fire-1", x: 2900, y: 1500, zone: "fire", r: 100, spots: [], eliteSpot: -1, chest: {x: 2900, y: 1500}, area: 0, radius: 100 });
  return map;
}
const origin = { x: 400, y: 400 };
function frame(vision: RaidVision, world: GameMap, now = 1000, camps = [{ wardOwner: "", wardExpiresAt: 0 }], alive = true, active = true, training = false) {
  vision.update(world, false, origin, alive, active, training, "me", camps, now);
}
afterEach(() => vi.unstubAllGlobals());

describe("session vision", () => {
  it("reveals a large coliseum across walls but retains circular sight and hidden actor rules", () => {
    const m = map();
    m.coliseum.rect = { x: 10, y: 10, w: 50, h: 35 };
    for (let y = 10; y < 45; y++) for (let x = 10; x < 60; x++) m.regionGrid[y * m.w + x] = REGION_COLISEUM;
    for (let y = 10; y < 45; y++) m.tiles[y * m.w + 32] = 1;
    const v = new RaidVision();
    v.update(m, false, { x: 20.5 * TILE, y: 25.5 * TILE }, true, true, false, "me", [], 1000);
    const hiddenEnemy = { x: 50.5 * TILE, y: 25.5 * TILE };
    expect(v.canSee(hiddenEnemy)).toBe(true);
    expect(v.canSee({ x: 20.5 * TILE, y: 26.5 * TILE })).toBe(true);
    expect(v.canSee({ x: 70.5 * TILE, y: 25.5 * TILE })).toBe(false);
    expect(shouldRenderActor(false, EFFECT_HIDDEN, hiddenEnemy, v.canSee)).toBe(false);
  });
  it("expires live trail after two minutes and does not refresh it while dead", () => {
    const v = new RaidVision(), m = map(); frame(v, m);
    expect(v.canSee(origin)).toBe(true);
    frame(v, m, 120999, undefined, false); expect(v.canSee(origin)).toBe(true);
    frame(v, m, 121000, undefined, false); expect(v.canSee(origin)).toBe(false);
  });
  it("retains a cleared camp only for its owner and drops ward vision at the exact deadline without trail", () => {
    const v = new RaidVision(), m = map(), ward = m.camps[0]!;
    frame(v, m, 1000, [{wardOwner: "other", wardExpiresAt: 181000}]); expect(v.canSee(ward)).toBe(false);
    frame(v, m, 1000, [{wardOwner: "me", wardExpiresAt: 181000}]); expect(v.canSee(ward)).toBe(true);
    frame(v, m, 180999, [{wardOwner: "me", wardExpiresAt: 181000}], false); expect(v.canSee(ward)).toBe(true);
    frame(v, m, 181000, [{wardOwner: "me", wardExpiresAt: 181000}], false); expect(v.canSee(ward)).toBe(false);
  });
  it("keeps the circle independent of window width and wall-blocks unseen tiles", () => {
    const m = map(); for (let y = 0; y < m.h; y++) m.tiles[y * m.w + 20] = 1;
    const v = new RaidVision(); frame(v, m);
    expect(v.canSee({x: 18.5 * TILE, y: origin.y})).toBe(true);
    expect(v.canSee({x: 21.5 * TILE, y: origin.y})).toBe(false);
    expect(v.canSee({x: origin.x, y: origin.y + VISION_RADIUS + 2 * TILE})).toBe(false);
  });
  it("resets on new map/session and bypasses fog in lobby and training", () => {
    const m = map(), v = new RaidVision(); frame(v, m);
    v.reset(m); frame(v, m, 1100, undefined, false); expect(v.canSee(origin)).toBe(false);
    frame(v, m, 1200, undefined, true, false); expect(v.canSee(m.camps[0]!)).toBe(true);
    frame(v, m, 1300, undefined, true, true, true); expect(v.canSee(m.camps[0]!)).toBe(true);
    frame(v, m, 1400, undefined, false); expect(v.canSee(origin)).toBe(false);
  });
  it("restores only a matching reconnect trail, without adding expiry time", () => {
    const m = map(), v = new RaidVision(); v.reset(m);
    const i = 12 * m.w + 12;
    v.applySnapshot({ seed: m.seed, w: m.w, h: m.h, at: 1000, cells: [[i, 5000]] });
    frame(v, m, 4999, undefined, false); expect(v.canSee(origin)).toBe(true);
    frame(v, m, 5000, undefined, false); expect(v.canSee(origin)).toBe(false);
    v.applySnapshot({ seed: 99, w: m.w, h: m.h, at: 5000, cells: [[i, 9000]] });
    expect(v.canSee(origin)).toBe(false);
  });
  it("uses a single actor gate for local visibility, Swarm, hover, and map collections", () => {
    const m = map(), v = new RaidVision(); frame(v, m);
    expect(shouldRenderActor(true, EFFECT_HIDDEN, m.camps[0]!, v.canSee)).toBe(true);
    expect(shouldRenderActor(false, EFFECT_HIDDEN, origin, v.canSee)).toBe(false);
    expect(shouldRenderActor(false, 0, m.camps[0]!, v.canSee)).toBe(false);
    const source = new Map([["visible", origin], ["unseen", m.camps[0]!]]), seen: string[] = [];
    visibleCollection(source, v.canSee).forEach((_point, id) => seen.push(id));
    expect(seen).toEqual(["visible"]);
  });
  it("reveals the hunted actor location without revealing terrain or other actors nearby", () => {
    const m = map(), v = new RaidVision(); frame(v, m);
    const far = { x: 70 * TILE, y: 50 * TILE };
    v.setTrackedTarget("rival");
    expect(v.canSee(far)).toBe(false);
    expect(v.canSeeActor("rival", far)).toBe(true);
    expect(v.canSeeActor("other", far)).toBe(false);
    v.setTrackedTarget("");
    expect(v.canSeeActor("rival", far)).toBe(false);
  });
});

describe("directional edge hue", () => {
  it("uses ground distance for green, yellow and red, independent of projection", () => {
    expect(edgeThreat(origin, {x: 550, y: 400}, 1600, 900).hue).toBe(0);
    expect(edgeThreat(origin, {x: 925, y: 400}, 1600, 900).hue).toBe(60);
    expect(edgeThreat(origin, {x: 1300, y: 400}, 1600, 900).hue).toBe(120);
    expect(edgeThreat(origin, {x: 400, y: 1300}, 1600, 900).hue).toBe(120);
  });
  it("intersects the projected bearing with each aspect ratio without changing proximity", () => {
    const p = edgeThreat({x:0,y:0}, {x:500,y:500}, 1600, 900);
    expect(p.x).toBeCloseTo(800 + 450 / Y_SCALE); expect(p.y).toBe(900);
    const tall = edgeThreat({x:0,y:0}, {x:500,y:500}, 600, 900);
    expect(tall.x).toBe(600); expect(tall.y).toBeCloseTo(450 + 300 * Y_SCALE);
    expect(tall.hue).toBe(p.hue);
    expect(edgeThreat(origin, origin, 1600, 900)).toMatchObject({x:800,y:0,hue:0});
  });
  it("renders multiple directions, hides removed enemies and removes the overlay on teardown", () => {
    const {ui} = installFakeDom();
    // FakeEl supplies the DOM setters used by this view.
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => Object.assign(create(tag), {setAttribute() {}})) as typeof document.createElement);
    const view = new EdgeThreatView();
    view.update(origin, [{x:900,y:400}, {x:400,y:900}]);
    const root = ui.children[0] as any;
    expect(root.children).toHaveLength(2);
    view.update(origin, []); expect(root.children.every((el: any) => el.hidden)).toBe(true);
    view.destroy(); expect(root.removed).toBe(true);
  });
});

describe("fog lifecycle and public timers", () => {
  it("draws only unknown tiles, clears when disabled, and destroys its graphics", () => {
    const {scene, ofKind} = fakeScene(), v = new RaidVision(), m = map(); frame(v, m);
    const fog = new VisionFog(scene), camera = {worldView:{x:0,y:0,width:3800,height:1500}};
    fog.update(v, m, 1000, camera);
    const g = ofKind("graphics")[0]!;
    expect(argsOf(g, "fillRect").length).toBeGreaterThan(0);
    frame(v, m, 1100, undefined, true, false); fog.update(v, m, 1100, camera);
    expect(argsOf(g, "fillRect")).toHaveLength(0);
    fog.destroy(); expect(argsOf(g, "destroy")).toHaveLength(1);
  });
  it("shows fixed-width public respawn and ward countdowns only during active play", () => {
    const {scene, ofKind} = fakeScene(), view = new CampWards(scene), m = map();
    const camps = [{state: 2, respawnAt: 181000, wardOwner: "me", wardExpiresAt: 181000}];
    view.update(m, camps, 1000, "me", true);
    const texts = ofKind("text"), timer = texts.find((o) => String(o.args[2]).startsWith(""))!;
    expect(texts).toHaveLength(2);
    expect(texts[0]!.args[3]).toMatchObject({fixedWidth: 128, align: "center"});
    expect((texts[0]!.args[3] as {fontFamily: string}).fontFamily).toContain("monospace");
    expect(texts.map((o) => o.state.text)).toContain("RESPAWN 180s");
    expect(texts.map((o) => o.state.text)).toContain("YOUR WARD 180s");
    view.update(m, camps, 2000, "me", false);
    expect(argsOf(texts[0]!, "destroy")).toHaveLength(1);
    view.destroy();
    expect(argsOf(timer!, "destroy")).toHaveLength(1);
  });
});
