// The planning screen's elite camps (ui/planning.ts): each wears the glyph of the elite that stands in it (the k-th elite camp of a zone holds the
// zone's k-th elite), the same shapes the minimap paints, as an inline SVG on the marker's crown element; the info line shows it in front of
// the hovered elite camp's sentence and names the elite; a marker with no known elite keeps the old crown. The DOM is the fake one (test/planningDom.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elitesOf, generateMap, isEliteCamp, mobTypeById, nearestCamps, type GameMap, type PlanMessage } from "@raid/shared";
import { SettingsStore } from "../src/settings";
import { CROWN_CLIP_PATH } from "../src/ui/mapPainter";
import { campEliteTypes, eliteGlyphOf, eliteGlyphSvg, noteEliteCamps } from "../src/ui/eliteGlyphs";
import { PlanningView, crown, type PlanningFrame } from "../src/ui/planning";
import { RouteState } from "../src/ui/route";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { asEl, installPlanningDom, type PEl } from "./planningDom";

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => { setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true })); });

const MAP: GameMap = generateMap(7);
const TYPES = campEliteTypes(MAP.camps);

const frame = (over: Partial<PlanningFrame> = {}): PlanningFrame => ({
  mode: "preview", serverNow: 0, endsAt: 12_000, meReady: false,
  players: [{ faction: "plague", ready: false, me: true }, { faction: "holy", ready: false, me: false }],
  campTypes: [], local: null, ...over,
});

function setup(map: GameMap = MAP) {
  installPlanningDom();
  const store = new SettingsStore({ getItem: () => null, setItem: () => {} });
  const view = new PlanningView({ map, route: new RouteState(null, null), send: () => {}, settings: store });
  const root = asEl(view.element);
  const camps = (): PEl[] => root.byClass("pl-camp");
  return { view, root, camps, q: (cls: string): PEl => root.one(cls) };
}

const url = (id: string): string => `url("data:image/svg+xml,${encodeURIComponent(eliteGlyphSvg(eliteGlyphOf(id)!))}")`;

describe("the planning map's elite camps", () => {
  it("puts the glyph of the camp's own elite over every elite camp: the zone's k-th elite for its k-th elite camp, ten different ones in all", () => {
    const { camps } = setup();
    const seen = new Set<string>();
    camps().forEach((button, i) => {
      const camp = MAP.camps[i]!;
      const marks = button.byClass("pl-crown");
      if (!isEliteCamp(camp)) { expect(marks, camp.id).toHaveLength(0); return; }
      expect(marks, camp.id).toHaveLength(1);
      const mark = marks[0]!;
      expect(TYPES[i], camp.id).not.toBe("");
      expect(mark.classList.contains("pl-elite-glyph"), camp.id).toBe(true);
      expect(mark.getAttribute("data-elite"), camp.id).toBe(TYPES[i]);
      expect(mark.style.props["background-image"], camp.id).toBe(url(TYPES[i]!));
      expect(mark.style.props["clip-path"], camp.id).toBeUndefined();
      expect(mark.getAttribute("aria-hidden")).toBe("true");
      seen.add(TYPES[i]!);
    });
    expect(seen.size).toBe(10);
    for (const zone of ["fire", "sentenced", "plague", "frost", "holy"] as const) {
      const mine = camps().filter((_, i) => MAP.camps[i]!.zone === zone && isEliteCamp(MAP.camps[i]!)).map((b) => b.one("pl-crown").getAttribute("data-elite"));
      expect(mine).toEqual(elitesOf(zone).map((e) => e.id));
    }
  });

  it("shows the elite's own glyph in front of the hovered elite camp's line, and its name, without the room having said it yet", () => {
    const { camps, q, view } = setup();
    view.update(frame());
    const i = MAP.camps.findIndex(isEliteCamp);
    const elite = mobTypeById(TYPES[i]!)!;
    camps()[i]!.dispatch("mouseenter");
    const info = q("pl-info");
    expect(info.byClass("pl-crown")).toHaveLength(1);
    expect(info.one("pl-crown").getAttribute("data-elite")).toBe(elite.id);
    expect(info.textContent).toContain(`Guarded by the ${elite.name}`);
    expect(info.textContent).toContain("Elite camp: dangerous");
    expect(camps()[i]!.getAttribute("aria-label")).toContain(elite.name);
    // Off the camp, the line is the plain default and the icon is gone; a plain camp has none either.
    camps()[i]!.dispatch("mouseleave");
    expect(info.byClass("pl-crown")).toHaveLength(0);
    const plain = MAP.camps.findIndex((c) => !isEliteCamp(c));
    camps()[plain]!.dispatch("mouseenter");
    expect(info.byClass("pl-crown")).toHaveLength(0);
    expect(info.textContent).not.toContain("Guarded by");
  });

  it("does not name the elite twice once the room does: its own line (\"Elite: ...\") stands, with the icon", () => {
    const { camps, q, view } = setup();
    const i = MAP.camps.findIndex(isEliteCamp);
    const types = MAP.camps.map(() => "");
    const elites = MAP.camps.map(() => "");
    types[i] = elitesOf(MAP.camps[i]!.zone)[0]!.id; // any normal type id will do for the line; an elite's own is fine here
    elites[i] = TYPES[i]!;
    view.update(frame({ campTypes: types, campElites: elites }));
    camps()[i]!.dispatch("focus");
    expect(q("pl-info").textContent).toContain(`Elite: ${mobTypeById(TYPES[i]!)!.name}`);
    expect(q("pl-info").textContent).not.toContain("Guarded by");
    expect(q("pl-info").byClass("pl-crown")).toHaveLength(1);
  });

  it("puts the same glyph on the spawn cards' nearest camps as on the map", () => {
    const { root, view } = setup();
    view.setPlan({ endsAt: 12_000, spawns: [0, MAP.spawnPool.findIndex((s) => s.zone !== MAP.spawnPool[0]!.zone)], taken: [false, false], pick: -1, boons: [], boon: -1 } as PlanMessage);
    view.update(frame({ mode: "planning" }));
    const items = root.byClass("pl-near-item");
    expect(items.length).toBeGreaterThan(0);
    const wanted = [0, MAP.spawnPool.findIndex((s) => s.zone !== MAP.spawnPool[0]!.zone)].flatMap((s) => nearestCamps(MAP, MAP.spawnPool[s]!, 2));
    items.forEach((item, n) => {
      const camp = wanted[n]!;
      const marks = item.byClass("pl-crown");
      expect(marks.length > 0, camp.id).toBe(isEliteCamp(camp));
      if (marks.length > 0) expect(marks[0]!.getAttribute("data-elite"), camp.id).toBe(TYPES[MAP.camps.indexOf(camp)]);
    });
  });
});

describe("the mark over an elite camp", () => {
  it("is the glyph of an elite it knows, and the old gold crown (its clip path, no glyph, no elite named) for one it cannot tell", () => {
    installPlanningDom();
    const known = asEl(crown("archon"));
    expect(known.classList.contains("pl-crown")).toBe(true);
    expect(known.classList.contains("pl-elite-glyph")).toBe(true);
    expect(known.getAttribute("data-elite")).toBe("archon");
    expect(known.style.props["background-image"]).toBe(url("archon"));
    for (const unknown of ["", "someNewElite"]) {
      const fallback = asEl(crown(unknown));
      expect(fallback.classList.contains("pl-crown"), unknown).toBe(true);
      expect(fallback.classList.contains("pl-elite-glyph"), unknown).toBe(false);
      expect(fallback.style.props["clip-path"], unknown).toBe(CROWN_CLIP_PATH);
      expect(fallback.style.props["background-image"], unknown).toBeUndefined();
      expect(fallback.getAttribute("data-elite"), unknown).toBeNull();
    }
  });

  it("tells no elite for an elite camp of a zone with no elites to hold (an odd hand-built camp), without throwing", () => {
    const odd = [{ zone: "none" as never, eliteSpot: 0 }, { zone: "fire" as const, eliteSpot: 0 }];
    expect(campEliteTypes(odd)).toEqual(["", elitesOf("fire")[0]!.id]);
    expect(() => noteEliteCamps(odd)).not.toThrow();
  });
});
