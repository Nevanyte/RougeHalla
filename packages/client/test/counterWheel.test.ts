// No DOM here (the client's vitest runs in node): only the pure parts of the counter wheel.
import {
  FACTIONS, FACTION_IDS, FACTION_WHEEL, SIGNATURE_WEAPONS, WEAPONS, WEAPON_IDS, WEAPON_WHEEL, wheelMatchups, type Wheel,
} from "@raid/shared";
import { describe, expect, it } from "vitest";
import { joinNames, matchupText, startingKitText, trimSegment, wheelDescription, wheelHighlight } from "../src/ui/hub/counterWheel";

const count = (roles: string[], role: string) => roles.filter((r) => r === role).length;

function picksOf<Id extends string>(name: string, wheel: Wheel<Id>, ids: readonly Id[]): void {
  for (const id of ids) {
    it(`${name} pick ${id}: itself, two victims, two beaters`, () => {
      const h = wheelHighlight(wheel, id);
      const roles: string[] = Object.values(h.nodes);
      expect(h.pick).toBe(id);
      expect(roles).toHaveLength(5);
      expect(count(roles, "pick")).toBe(1);
      expect(count(roles, "beats")).toBe(2);
      expect(count(roles, "losesTo")).toBe(2);
      expect(count(roles, "other")).toBe(0);

      const m = wheelMatchups(wheel, id);
      expect(h.nodes[id]).toBe("pick");
      for (const v of m.beats) expect(h.nodes[v], `${id} beats ${v}`).toBe("beats");
      for (const b of m.losesTo) expect(h.nodes[b], `${b} beats ${id}`).toBe("losesTo");
    });

    it(`${name} pick ${id}: its two wins and two losses are the lit edges, the other six are dim`, () => {
      const h = wheelHighlight(wheel, id);
      expect(h.edges).toHaveLength(wheel.edges.length);
      expect(count(h.edges, "win")).toBe(2);
      expect(count(h.edges, "loss")).toBe(2);
      expect(count(h.edges, "other")).toBe(6);
      wheel.edges.forEach((e, i) => {
        const expected = e.winner === id ? "win" : e.loser === id ? "loss" : "other";
        expect(h.edges[i], `${e.winner}>${e.loser}`).toBe(expected);
      });
    });
  }

  it(`${name} wheel with no pick: everything is "other" and nothing is picked`, () => {
    const h = wheelHighlight(wheel, null);
    expect(h.pick).toBeNull();
    expect(Object.keys(h.nodes)).toHaveLength(5);
    expect(Object.values(h.nodes).every((r) => r === "other")).toBe(true);
    expect(h.edges).toHaveLength(10);
    expect(h.edges.every((r) => r === "other")).toBe(true);
  });
}

describe("wheelHighlight", () => {
  picksOf("faction", FACTION_WHEEL, FACTION_IDS);
  picksOf("weapon", WEAPON_WHEEL, WEAPON_IDS);

  it("treats a pick that is not on the wheel as no pick", () => {
    const h = wheelHighlight(FACTION_WHEEL, "sword" as never);
    expect(h.pick).toBeNull();
    expect(Object.values(h.nodes).every((r) => r === "other")).toBe(true);
    expect(h.edges.every((r) => r === "other")).toBe(true);
  });

  it("lights each faction's signature weapon on the weapon wheel", () => {
    for (const f of FACTION_IDS) {
      const h = wheelHighlight(WEAPON_WHEEL, SIGNATURE_WEAPONS[f]);
      expect(h.pick).toBe(SIGNATURE_WEAPONS[f]);
      expect(h.nodes[SIGNATURE_WEAPONS[f]]).toBe("pick");
    }
  });
});

describe("the weapon ring's caption", () => {
  it("says a run starts on fists, which are not on the ring, and names the faction", () => {
    const [first, second] = startingKitText("Demon Blood");
    expect(first).toBe("Demon Blood starts on fists: the fastest hands, the shortest reach, and a swing no shield stops.");
    expect(second).toContain("outside this ring");
    // The ring is the five loop weapons; fists are not a node of it.
    expect(WEAPON_WHEEL.nodes.map((n) => n.id)).not.toContain("fists");
  });
});

describe("wording", () => {
  it("joins names the way a sentence does", () => {
    expect(joinNames([])).toBe("no one");
    expect(joinNames(["Fire"])).toBe("Fire");
    expect(joinNames(["Fire", "Frost"])).toBe("Fire and Frost");
    expect(joinNames(["Fire", "Frost", "Plague"])).toBe("Fire, Frost and Plague");
  });

  it("states a matchup", () => {
    expect(matchupText("Fire", ["Sentenced", "Plague"], ["Frost", "Demon Blood"]))
      .toBe("Fire beats Sentenced and Plague, and loses to Frost and Demon Blood.");
  });

  it("describes every node of a wheel for a screen reader, with the displayed names", () => {
    const text = wheelDescription(FACTION_WHEEL, (id) => FACTIONS[id].displayName);
    for (const id of FACTION_IDS) {
      const m = wheelMatchups(FACTION_WHEEL, id);
      expect(text).toContain(`${FACTIONS[id].displayName} beats ${joinNames(m.beats.map((b) => FACTIONS[b].displayName))}.`);
    }
    expect(text.split(". ")).toHaveLength(5);
    const weapons = wheelDescription(WEAPON_WHEEL, (id) => WEAPONS[id].name);
    expect(weapons).toContain("Axe beats Wand and Shield.");
  });
});

describe("trimSegment", () => {
  it("shortens a segment by the given gaps at each end, along its own line", () => {
    const s = trimSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 20);
    expect(s).toEqual({ x1: 10, y1: 0, x2: 80, y2: 0 });
    const d = trimSegment({ x: 0, y: 0 }, { x: 30, y: 40 }, 5, 5);
    expect(Math.hypot(d.x2 - d.x1, d.y2 - d.y1)).toBeCloseTo(40, 9);
    expect(d.x1 / d.y1).toBeCloseTo(30 / 40, 9);
  });

  it("leaves a zero-length segment alone", () => {
    expect(trimSegment({ x: 3, y: 4 }, { x: 3, y: 4 }, 5, 5)).toEqual({ x1: 3, y1: 4, x2: 3, y2: 4 });
  });
});
