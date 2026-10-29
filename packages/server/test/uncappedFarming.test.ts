import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import { describe, expect, it } from "vitest";
import {
  FACTIONS, TILE, TILE_FLOOR, decodeMirrors, mapFromTiles, mobStatCount, mobStatReward, mulberry32,
  questDefById, questRewardStats, TICK_MS,
} from "@raid/shared";
import { PlayerState, RaidState } from "@raid/shared/schema";
import { combatant, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { grantMobStat } from "../src/sim/mobStats";
import { farmLifestealRowsOf, asMultOf, defenseBonusOf, outgoingMult, setExtraRows, speedMultOf } from "../src/sim/mods";
import { placeMob, hurtMob } from "../src/sim/mobLife";
import { offerQuest } from "../src/sim/quests";
import { recordHit } from "../src/sim/ledger";
import { packetFor } from "../src/sim/weapons";
import { addPlayer, step } from "../src/sim/step";
import type { LedgerEntry, World } from "../src/sim/world";

function fixture(options: { players?: number; quests?: boolean } = {}): { world: World; player: Extract<Combatant, { kind: "player" }> } {
  const size = 24;
  const map = mapFromTiles(size, size, new Uint8Array(size * size).fill(TILE_FLOOR));
  const world = createGameWorld({
    seed: 0, random: mulberry32(515), map,
    config: {
      minPlayers: options.players ?? 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600,
      patienceMinSeconds: 3600, suddenDeathSeconds: 60, mobs: false, quests: options.quests ?? false, pvpRules: false,
    },
  });
  for (let i = 0; i < (options.players ?? 1); i++) addPlayer(world, i === 0 ? "p" : "v", i === 0 ? "Player" : "Victim");
  step(world, TICK_MS);
  const player = combatant(world, "p");
  if (!player || player.kind !== "player") throw new Error("player missing from test world");
  return { world, player };
}

function killMob(world: World, type: "emberImp"): void {
  const id = placeMob(world, { region: "fire", elite: false, type, at: { x: 10 * TILE, y: 10 * TILE } });
  const mob = combatant(world, id);
  if (!mob || mob.kind !== "mob") throw new Error("mob missing from test world");
  const entry: LedgerEntry = {
    victim: id, by: { id: "p", name: "Player" }, packet: { raw: mob.s.maxHp + 1, phys: 1, magic: 0, true: 0 },
    weapon: "sword", scale: 1, stagger: false,
  };
  hurtMob(world, mob, [mob.s.maxHp + 1], [entry]);
}

function connect(encoder: Encoder<RaidState>): Decoder<RaidState> {
  const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
  decoder.decode(encoder.encodeAll());
  return decoder;
}

describe("uncapped mob reward progression", () => {
  it("keeps all nine farm reward kinds effective beyond their former card, wire, and stat ceilings", () => {
    const { world, player } = fixture();
    const basePacket = packetFor(player, "sword").raw;
    const counts = [
      ["emberImp", 10_000],       // damage
      ["cinderHound", 10_000],    // move speed
      ["magmaBrute", 10_000],     // max health
      ["bailiff", 10_000],        // armor
      ["chainWarden", 10_000],    // magic resist
      ["plagueRat", 10_000],      // attack speed
      ["rotMonk", 10_000],        // lifesteal
      ["flameCaller", 10_000],    // ability power
      ["pardoner", 10_000],       // attack damage
    ] as const;
    for (const [id, amount] of counts) {
      expect(mobStatReward(id)).toBeDefined();
      expect(grantMobStat(world, player, id, amount), id).toBe(amount);
      expect(mobStatCount(player.s.mobStats, id), id).toBe(amount);
    }

    const mirror = decodeMirrors(player.s);
    expect(mirror.adBonus).toBeGreaterThan(3276.7);
    expect(mirror.apBonus).toBeGreaterThan(3276.7);
    expect(mirror.asMult).toBeGreaterThan(1.5);
    expect(mirror.speedMult).toBeGreaterThan(1.3);
    expect(mirror.armorBonus).toBeGreaterThan(200);
    expect(mirror.shieldBonus).toBeGreaterThan(200);
    expect(player.s.maxHp).toBeGreaterThan(FACTIONS[player.s.faction as keyof typeof FACTIONS].hp * 2);
    expect(packetFor(player, "sword").raw).toBeGreaterThan(basePacket);
    expect(outgoingMult(player.s, 1, undefined, "hit")).toBeGreaterThan(2.5);
    expect(farmLifestealRowsOf(player.s)).toBeGreaterThan(0.85);

    const metrics = () => {
      const decoded = decodeMirrors(player.s);
      return {
        ad: decoded.adBonus, ap: decoded.apBonus, as: decoded.asMult, move: decoded.speedMult,
        armor: decoded.armorBonus, mr: decoded.shieldBonus, hp: player.s.maxHp,
        outgoing: outgoingMult(player.s, 1, undefined, "hit"), leech: farmLifestealRowsOf(player.s),
      };
    };
    const atTenThousand = metrics();
    for (const [id] of counts) expect(grantMobStat(world, player, id, 1), id).toBe(1);
    const atTenThousandAndOne = metrics();
    for (const key of Object.keys(atTenThousand) as Array<keyof typeof atTenThousand>) {
      expect(atTenThousandAndOne[key], key).toBeGreaterThan(atTenThousand[key]);
    }

    // These mirrors and counts exceed the former int16/uint16-backed ranges; reflection plus the state patch carries them intact.
    const state = new RaidState();
    const wire = new PlayerState();
    wire.asMult = player.s.asMult;
    wire.speedMult = player.s.speedMult;
    wire.armorBonus = player.s.armorBonus;
    wire.shieldBonus = player.s.shieldBonus;
    wire.adBonus = player.s.adBonus;
    wire.apBonus = player.s.apBonus;
    wire.mobStats.set("emberImp", 10_001);
    state.players.set("p", wire);
    const decoder = connect(new Encoder(state));
    const received = decoder.state.players.get("p")!;
    expect(received.asMult).toBe(wire.asMult);
    expect(received.speedMult).toBe(wire.speedMult);
    expect(received.armorBonus).toBe(wire.armorBonus);
    expect(received.shieldBonus).toBe(wire.shieldBonus);
    expect(received.adBonus).toBe(wire.adBonus);
    expect(received.apBonus).toBe(wire.apBonus);
    expect(received.mobStats.get("emberImp")).toBe(10_001);
  });

  it("continues granting on real repeated mob kills and pays a quest reward after the old ten-stack threshold", () => {
    const { world, player } = fixture({ quests: true });
    for (let i = 0; i < 11; i++) killMob(world, "emberImp");
    expect(mobStatCount(player.s.mobStats, "emberImp")).toBe(11);

    const def = questDefById("cull-fire")!;
    const reward = questRewardStats(def);
    const beforeQuestReward = mobStatCount(player.s.mobStats, reward.id);
    grantMobStat(world, player, reward.id, 10);
    const quest = offerQuest(world, def, true, { at: { x: 12 * TILE, y: 12 * TILE } });
    quest.s.accepted.set(player.id, true);
    quest.s.progress.set(player.id, def.count);
    player.s.x = quest.s.x;
    player.s.y = quest.s.y;
    step(world, TICK_MS);

    expect(quest.s.status).toBe("done");
    expect(mobStatCount(player.s.mobStats, reward.id)).toBe(beforeQuestReward + 10 + reward.stacks);
  });

  it("applies farm leech through the landed-hit healing pipeline above the former 85% total cap", () => {
    const { world, player } = fixture({ players: 2 });
    const victim = world.state.players.get("v")!;
    grantMobStat(world, player, "rotMonk", 1_000);
    player.s.hp = player.s.maxHp - 100;
    const hpBefore = player.s.hp;
    const victimBefore = victim.hp;
    let hitInserted = false;
    world.beforeDamage.push(() => {
      if (hitInserted) return;
      hitInserted = true;
      recordHit(world, {
        victim: "v", by: { id: "p", name: "Player" }, packet: { raw: 10, phys: 1, magic: 0, true: 0 },
        weapon: "sword", stagger: false,
      });
    });
    step(world, TICK_MS);
    const healed = player.s.hp - hpBefore;
    const damageDealt = victimBefore - victim.hp;
    expect(damageDealt).toBeGreaterThan(0);
    expect(healed).toBeGreaterThan(damageDealt);
  });

  it("keeps ordinary card/source ceilings when no farm rewards exist", () => {
    const { world, player } = fixture();
    setExtraRows(world, player, [
      { k: "stat", stat: "attackSpeed", v: 10 },
      { k: "stat", stat: "moveSpeed", v: 2 },
      { k: "flat", stat: "armor", v: 500 },
      { k: "flat", stat: "shield", v: 500 },
      { k: "mult", key: "hit", v: 10 },
    ]);
    expect(asMultOf(player.s)).toBe(1.5);
    expect(speedMultOf(player.s)).toBe(1.3);
    expect(defenseBonusOf(player.s)).toEqual({ armor: 200, shield: 200 });
    expect(outgoingMult(player.s, 1, undefined, "hit")).toBe(1);
  });
});
