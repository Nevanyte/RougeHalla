import { describe, expect, it } from "vitest";
import { BEATS, FACTION_IDS } from "../src/factions";
import { WEAPON_BEATS, WEAPON_IDS } from "../src/weapons";
import { FACTION_WHEEL, WEAPON_WHEEL, ringOrder, ringPositions, wheelMatchups, type Wheel } from "../src/wheel";

type Pairs = ReadonlyArray<readonly [string, string]>;

const SETS: Array<{ name: string; wheel: Wheel<string>; ids: readonly string[]; beats: Pairs }> = [
  { name: "factions", wheel: FACTION_WHEEL, ids: FACTION_IDS, beats: BEATS },
  { name: "weapons", wheel: WEAPON_WHEEL, ids: WEAPON_IDS, beats: WEAPON_BEATS },
];

const key = ([w, l]: readonly [string, string]) => `${w}>${l}`;

describe("ringOrder", () => {
  for (const { name, ids, beats } of SETS) {
    it(`finds a ${name} ring starting at ids[0] in which every id beats the next two`, () => {
      const ring = ringOrder(ids, beats);
      const wins = new Set(beats.map(key));
      expect(ring[0]).toBe(ids[0]);
      expect([...ring].sort()).toEqual([...ids].sort());
      ring.forEach((id, i) => {
        expect(wins.has(key([id, ring[(i + 1) % ring.length]!])), `${id} beats the next`).toBe(true);
        expect(wins.has(key([id, ring[(i + 2) % ring.length]!])), `${id} beats the one after`).toBe(true);
      });
    });

    it(`starts the ${name} ring at whichever id comes first (the same ring, turned)`, () => {
      const turned = [...ids.slice(2), ...ids.slice(0, 2)];
      const ring = ringOrder(turned, beats);
      expect(ring[0]).toBe(turned[0]);
      const base = ringOrder(ids, beats);
      // The loop is a cycle: both orders list the same neighbours in the same direction.
      const at = base.indexOf(ring[0]!);
      expect(ring).toEqual([...base.slice(at), ...base.slice(0, at)]);
    });
  }

  it("throws on a graph with no such ring (one edge turned round)", () => {
    const broken = BEATS.map(([w, l]) => (w === "fire" && l === "plague" ? ([l, w] as const) : ([w, l] as const)));
    expect(() => ringOrder(FACTION_IDS, broken)).toThrow(/no ring order/);
  });

  it("throws on a graph where each id beats only the next one", () => {
    const cycle: Pairs = [["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"], ["e", "a"]];
    expect(() => ringOrder(["a", "b", "c", "d", "e"], cycle)).toThrow(/no ring order/);
  });

  it("throws on a transitive order (a champion that nobody beats can't sit on a ring)", () => {
    const order: Pairs = [["a", "b"], ["a", "c"], ["a", "d"], ["a", "e"], ["b", "c"], ["b", "d"], ["b", "e"], ["c", "d"], ["c", "e"], ["d", "e"]];
    expect(() => ringOrder(["a", "b", "c", "d", "e"], order)).toThrow(/no ring order/);
  });
});

describe("ringPositions", () => {
  it("puts node 0 at the top and the rest clockwise on screen (y down)", () => {
    const at = ringPositions(5);
    expect(at).toHaveLength(5);
    expect(at[0]!.x).toBeCloseTo(0, 9);
    expect(at[0]!.y).toBeCloseTo(-1, 9);
    // Clockwise with y pointing down: the z of the cross product of consecutive positions is positive, and node 1 is to the right.
    expect(at[1]!.x).toBeGreaterThan(0);
    at.forEach((p, i) => {
      const q = at[(i + 1) % at.length]!;
      expect(p.x * q.y - p.y * q.x).toBeGreaterThan(0);
    });
  });

  it("scales with the radius", () => {
    for (const p of ringPositions(5, 90)) expect(Math.hypot(p.x, p.y)).toBeCloseTo(90, 9);
  });
});

for (const { name, wheel, ids, beats } of SETS) {
  describe(`the ${name} wheel`, () => {
    const index = (id: string) => wheel.nodes.findIndex((n) => n.id === id);

    it("has five nodes covering the ids exactly once, and ten edges (five sides, five diagonals)", () => {
      expect(wheel.nodes).toHaveLength(5);
      expect(wheel.nodes.map((n) => n.id).sort()).toEqual([...ids].sort());
      expect(wheel.edges).toHaveLength(10);
      expect(wheel.edges.filter((e) => e.kind === "side")).toHaveLength(5);
      expect(wheel.edges.filter((e) => e.kind === "diagonal")).toHaveLength(5);
    });

    it("gives every node exactly two wins and two losses", () => {
      for (const { id } of wheel.nodes) {
        expect(wheel.edges.filter((e) => e.winner === id), `${id} wins`).toHaveLength(2);
        expect(wheel.edges.filter((e) => e.loser === id), `${id} losses`).toHaveLength(2);
      }
    });

    it("joins every pair of nodes once and never a node to itself", () => {
      const pairs = new Set(wheel.edges.map((e) => [e.winner, e.loser].sort().join("|")));
      expect(pairs.size).toBe(10);
      for (const e of wheel.edges) expect(e.winner).not.toBe(e.loser);
    });

    it("has a side edge to the next node clockwise and a diagonal to the one after", () => {
      for (const e of wheel.edges) {
        const step = (index(e.loser) - index(e.winner) + 5) % 5;
        expect(step, `${e.winner}>${e.loser}`).toBe(e.kind === "side" ? 1 : 2);
      }
    });

    it("has the edges of the designed loop and no others", () => {
      expect(new Set(wheel.edges.map((e) => key([e.winner, e.loser])))).toEqual(new Set(beats.map(key)));
      expect(wheel.edges.map((e) => key([e.winner, e.loser])).sort()).toEqual(beats.map(key).sort());
    });

    it("puts the nodes on the unit circle, node 0 at the top and the rest clockwise", () => {
      const at = ringPositions(5);
      wheel.nodes.forEach((n, i) => {
        expect(Math.hypot(n.x, n.y), n.id).toBeCloseTo(1, 9);
        expect(n.x).toBeCloseTo(at[i]!.x, 9);
        expect(n.y).toBeCloseTo(at[i]!.y, 9);
      });
      expect(wheel.nodes[0]!.x).toBeCloseTo(0, 9);
      expect(wheel.nodes[0]!.y).toBeCloseTo(-1, 9);
      expect(wheel.nodes[1]!.x).toBeGreaterThan(0);
    });

    it("reports matchups that agree with the loop", () => {
      for (const id of ids) {
        const m = wheelMatchups(wheel, id);
        expect([...m.beats].sort(), `${id} beats`).toEqual(beats.filter(([w]) => w === id).map(([, l]) => l).sort());
        expect([...m.losesTo].sort(), `${id} loses to`).toEqual(beats.filter(([, l]) => l === id).map(([w]) => w).sort());
        expect(m.beats).toHaveLength(2);
        expect(m.losesTo).toHaveLength(2);
      }
    });
  });
}
