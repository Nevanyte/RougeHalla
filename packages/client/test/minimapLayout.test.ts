import { describe, expect, it } from "vitest";
import { generateMap, rollCampElites, WORLD_W, type Vec2 } from "@raid/shared";
import { clusterMapContacts, layoutMinimapMarks, marksOverlap, type MapContact, type PlacedMark } from "../src/ui/minimapLayout";
import { minimapMarks, type MarkerInputs } from "../src/ui/minimapMarkers";
import { mapSpan } from "../src/ui/minimapMath";

function separated(marks: readonly PlacedMark[]): void {
  for (let i = 0; i < marks.length; i++) {
    const p = marks[i]!;
    expect(p.x - p.mark.w / 2).toBeGreaterThanOrEqual(1);
    expect(p.y - p.mark.h / 2).toBeGreaterThanOrEqual(1);
    expect(p.x + p.mark.w / 2).toBeLessThanOrEqual(149);
    expect(p.y + p.mark.h / 2).toBeLessThanOrEqual(149);
    for (const other of marks.slice(i + 1)) expect(marksOverlap(p, other)).toBe(false);
  }
}
const empty = (): MarkerInputs => ({ alive: true, mobs: [], enemies: [], chests: [], respawns: [], camps: [], campStates: [], quests: [], stops: [], next: -1 });

describe("minimap collision layout", () => {
  it("reserves the player position first, fits edge labels, and separates a stack of contacts and clocks", () => {
    const marks = layoutMinimapMarks([
      { key: "player", x: 4, y: 4, w: 8, h: 8, priority: 100, essential: true },
      ...Array.from({ length: 32 }, (_, i) => ({ key: `clock-${i}`, x: 0, y: 0, w: 28, h: 12, priority: 80, essential: true })),
      { key: "camp", x: 0, y: 0, w: 11, h: 17, priority: 10, essential: false },
    ]);
    expect(marks.filter((p) => p.mark.essential)).toHaveLength(33);
    expect(marks[0]).toMatchObject({ x: 5, y: 5, mark: { key: "player" } });
    separated(marks);
  });

  it("merges nearby same-faction contacts without losing counts or merging different factions", () => {
    const contacts = Array.from({ length: 280 }, (_, i) => ({ x: 70 + i % 3, y: 60 + i % 2, code: i % 4 }));
    const groups = clusterMapContacts(contacts, 4.8);
    expect(groups).toHaveLength(4);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(280);
    expect(clusterMapContacts([...contacts].reverse(), 4.8)).toEqual(groups);
  });

  it("keeps static map decorations separated around the full mix of camps, clocks and routes", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const map = generateMap(seed);
      const player = map.camps[0]!;
      const enemies: Vec2[] = Array.from({ length: 7 }, (_, i) => ({ x: player.x + i * 24, y: player.y + i * 12 }));
      const marks = minimapMarks({ ...empty(), player, enemies, camps: map.camps,
        // Every camp cleared: clocks are still public beyond vision.
        respawns: map.camps.map((c) => ({ ...c, left: 179 })),
        chests: map.camps.slice(0, 4).map((c) => ({ ...c, left: 12 })),
        mobs: map.camps.flatMap((c, i) => Array.from({ length: 5 }, (_, j) => ({
          x: c.x * 150 / WORLD_W + j * 0.5, y: c.y * 150 / WORLD_W, code: (i % 5 + 1) * 2,
        }))),
        stops: map.camps.slice(0, 8), next: 0,
      });
      expect(marks.filter((p) => p.mark.kind === "chest")).toHaveLength(4);
      expect(marks.filter((p) => p.mark.kind === "respawn")).toHaveLength(map.camps.length - 4);
      expect(marks.filter((p) => p.mark.kind === "enemy").length).toBeGreaterThan(0);
      separated(marks.filter((p) => !p.mark.pinned));
    }
  });

  it("carries each elite camp's own elite type on its mark, the k-th elite camp of a zone holding the zone's k-th elite", () => {
    const map = generateMap(5);
    const marks = minimapMarks({ ...empty(), camps: map.camps });
    const types = rollCampElites(map.camps);
    const camps = marks.filter((p) => p.mark.kind === "camp");
    expect(camps.some((p) => p.mark.eliteType !== "")).toBe(true);
    for (const p of camps) expect(p.mark.eliteType).toBe(types[Number(p.mark.key.split(":").pop())]);
    // Two elite camps a zone, each with its own type: the painter no longer has to recover the order from a lone copy.
    for (const zone of new Set(map.camps.map((c) => c.zone))) {
      const zoneTypes = camps.filter((p) => p.mark.camp!.zone === zone && p.mark.camp!.eliteSpot >= 0).map((p) => p.mark.eliteType);
      expect(new Set(zoneTypes).size).toBe(zoneTypes.length);
    }
  });

  it("never leaves out an elite camp's mark on a crowded 50-camp map: the elites claim their space first", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const map = generateMap(seed);
      const marks = minimapMarks({ ...empty(), camps: map.camps });
      const elites = marks.filter((p) => p.mark.kind === "camp" && p.mark.eliteType !== "");
      expect(elites, `seed ${seed}`).toHaveLength(map.camps.filter((c) => c.eliteSpot >= 0).length);
      // Placed near its camp (a displaced badge is tethered to its true place by minimap.ts), not across the map: seed 7 moves one 22 units.
      for (const p of elites) expect(Math.hypot(p.x - p.mark.x, p.y - p.mark.y), `seed ${seed} ${p.mark.key}`).toBeLessThan(30);
    }
  });

  it("replaces a camp with its clock, and its respawn with a live chest instead of drawing duplicates", () => {
    const camp = generateMap(3).camps[0]!;
    const marks = minimapMarks({ ...empty(), camps: [camp], chests: [{ ...camp, left: 12 }], respawns: [{ ...camp, left: 180 }] });
    expect(marks.map((p) => p.mark.kind)).toEqual(["chest"]);
    const afterLoot = minimapMarks({ ...empty(), camps: [camp], respawns: [{ ...camp, left: 165 }] });
    expect(afterLoot.map((p) => [p.mark.kind, p.mark.text])).toEqual([["respawn", "165"]]);
  });

  it("keeps actor marks pinned to their coordinates and timer anchors fixed as actors cross them", () => {
    const camp = generateMap(3).camps[0]!;
    const k = 150 / mapSpan();
    const timerAt = (player: Vec2, enemy: Vec2, mob: MapContact) => {
      const marks = minimapMarks({ ...empty(), camps: [camp], respawns: [{ ...camp, left: 180 }],
        player, enemies: [enemy], mobs: [mob],
      });
      return {
        timer: marks.find((p) => p.mark.kind === "respawn")!,
        player: marks.find((p) => p.mark.kind === "player")!,
        enemy: marks.find((p) => p.mark.kind === "enemy")!,
        mob: marks.find((p) => p.mark.kind === "mob")!,
      };
    };
    const frames = [0, 0.1, 0.2, 0.3].map((n) => timerAt(
      { x: camp.x + n, y: camp.y - n },
      { x: camp.x - n, y: camp.y + n },
      { x: (camp.x + n) * k, y: (camp.y - n) * k, code: 2 },
    ));
    const first = frames[0]!;
    for (const [i, frame] of frames.entries()) {
      expect(frame.timer.x).toBe(first.timer.x);
      expect(frame.timer.y).toBe(first.timer.y);
      expect(frame.timer.mark.w).toBe(first.timer.mark.w);
      expect(frame.player.x).toBeCloseTo((camp.x + i * 0.1) * k);
      expect(frame.player.y).toBeCloseTo((camp.y - i * 0.1) * k);
      expect(frame.enemy.x).toBeCloseTo((camp.x - i * 0.1) * k);
      expect(frame.enemy.y).toBeCloseTo((camp.y + i * 0.1) * k);
      expect(frame.mob.x).toBeCloseTo((camp.x + i * 0.1) * k);
      expect(frame.mob.y).toBeCloseTo((camp.y - i * 0.1) * k);
      expect(frame.player.mark.pinned).toBe(true);
      expect(frame.enemy.mark.pinned).toBe(true);
      expect(frame.mob.mark.pinned).toBe(true);
    }
  });
});
