import {
  TRADE_STATS, TRADE_STAT_NAMES, TRADER_RANGE, TRADER_SPEED, TRADER_STOP_MS, barterWeapons, circleClear, decodeMirrors, findPath,
  hasLineOfSight, isWeaponId, MASK_MOVE, parseStatTrade, segmentClear, TILE, tileToWorldCenter, WEAPONS,
  type StatTrade, type TradeStat, type Vec2,
} from "@raid/shared";
import { TraderState, type PlayerState } from "@raid/shared/schema";
import { baseMaxHp, syncMaxHp } from "./buffs";
import { combatant, factionOf, setSlot, slotItem } from "./combatant";
import { grantConsumable } from "./consumables";
import { recomputeMods, multOf, hasFlag } from "./mods";
import { actionBlocked } from "./status";
import { weaponChanged } from "./weapons";
import { chainHook, collisionMap, emit, type ActionHandler, type World } from "./world";

interface Walker { path: Vec2[]; nextWalkAt: number }
export interface TradersRuntime { walkers: Map<string, Walker>; barterAt: Map<string, number>; destinations: Vec2[] }

function notify(w: World, to: string, text: string): void { emit(w, { type: "toast", to, text }); }
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

export function spawnTraders(w: World): void {
  if (w.config.training || !w.traders || w.state.traders.size) return;
  const sites = shuffled(w.traders.destinations, w.rewardRandom);
  for (const [index, kind, name] of [[0, "barter", "Wandering Villager"], [1, "stats", "Soul Broker"]] as const) {
    const spot = sites[index === 0 ? 0 : Math.floor(sites.length / 2)] ?? w.map.coliseum.centre;
    const s = new TraderState();
    s.id = `trader-${kind}`; s.kind = kind; s.name = name; s.x = spot.x; s.y = spot.y;
    w.state.traders.set(s.id, s);
    w.traders.walkers.set(s.id, { path: [], nextWalkAt: w.state.serverTime + TRADER_STOP_MS + index * 1000 });
  }
}

/** Trade amounts are quoted from the player's current effective stats and remain fixed once offered. */
export function rollStatTrades(w: World, p: PlayerState): StatTrade[] {
  const f = factionOf(p), m = decodeMirrors(p);
  if (!f) return [];
  const current: Record<TradeStat, number> = {
    maxHp: p.maxHp / Math.max(1, baseMaxHp(p)), ad: Math.max(0, m.adBonus), ap: Math.max(0, m.apBonus),
    attackSpeed: m.asMult, moveSpeed: m.speedMult,
    armor: Math.max(0, f.armor + m.armorBonus), shield: Math.max(0, f.shield + m.shieldBonus),
  };
  const isFlat = (k: TradeStat) => k === "armor" || k === "shield" || k === "ad" || k === "ap";
  const costs = shuffled(TRADE_STATS.filter(k => current[k] > (isFlat(k) ? 1 : 0.3)), w.rewardRandom);
  return costs.slice(0, 3).map(cost => {
    const gain = shuffled(TRADE_STATS.filter(k => k !== cost), w.rewardRandom)[0]!;
    const costRaw = current[cost] * .12, gainRaw = Math.max(current[gain], isFlat(gain) ? 60 : 1) * .18;
    const costValue = rounded(costRaw / (cost === "ap" ? Math.max(.1, multOf(p, "ap")) : 1), cost);
    const gainValue = rounded(gainRaw / (gain === "ap" ? Math.max(.1, multOf(p, "ap")) : 1), gain);
    const shown = (value: number, stat: TradeStat) => stat === "maxHp" ? String(Math.round(value * baseMaxHp(p))) : quote(rounded(value, stat), stat);
    return { cost, costValue, gain, gainValue, label: `−${shown(costRaw, cost)} ${TRADE_STAT_NAMES[cost]} → +${shown(gainRaw, gain)} ${TRADE_STAT_NAMES[gain]}` };
  });
}

function rounded(value: number, stat: TradeStat): number { return Math.round(value * (stat === "armor" || stat === "shield" || stat === "ad" || stat === "ap" ? 10 : 1000)) / (stat === "armor" || stat === "shield" || stat === "ad" || stat === "ap" ? 10 : 1000); }
function quote(value: number, stat: TradeStat): string { return stat === "armor" || stat === "shield" || stat === "ad" || stat === "ap" ? String(value) : `${Math.round(value * 100)}%`; }

export const handleTrade: ActionHandler = (w, c, cmd) => {
  if (cmd.kind !== "trade" || c.kind !== "player") return;
  const npc = w.state.traders.get(cmd.trader), p = c.s;
  if (w.state.phase !== "active" || p.status !== "alive" || !npc || actionBlocked(w, c)) return;
  if (Math.hypot(p.x - npc.x, p.y - npc.y) > TRADER_RANGE || !hasLineOfSight(collisionMap(w), p, npc, MASK_MOVE)) { notify(w, c.id, "Move closer to the trader"); return; }
  if (cmd.pick < 0 || cmd.pick > 2 || !Number.isInteger(cmd.pick)) return;
  if (npc.kind === "stats") {
    if (p.tradeUsed) { notify(w, c.id, "You already made your stat trade this run"); return; }
    const offer = parseStatTrade(p.tradeOffers.at(cmd.pick) ?? "");
    if (!offer) { notify(w, c.id, "Wait for the trader's offers"); return; }
    p.tradeStats.set(offer.cost, (p.tradeStats.get(offer.cost) ?? 0) - offer.costValue);
    p.tradeStats.set(offer.gain, (p.tradeStats.get(offer.gain) ?? 0) + offer.gainValue);
    p.tradeUsed = true;
    const hpBefore = p.hp;
    recomputeMods(w, c); syncMaxHp(p);
    p.hp = Math.min(hpBefore, p.maxHp);
    notify(w, c.id, `Stat trade: ${offer.label}`);
    return;
  }
  const readyAt = w.traders?.barterAt.get(c.id) ?? 0;
  if (w.state.serverTime < readyAt) { notify(w, c.id, "The villager is packing your last trade"); return; }
  const held = slotItem(p, p.slot), [first, second] = barterWeapons(held ?? "");
  if (cmd.pick === 2) {
    if (p.potionSmall < 1) { notify(w, c.id, "Bring a small healing potion"); return; }
    if (held === second) { notify(w, c.id, "You already hold that weapon"); return; }
    const empty = slotItem(p, p.slot) === null ? (p.slot === 1 ? 1 : 0)
      : slotItem(p, 0) === null ? 0 : slotItem(p, 1) === null && !hasFlag(p, "lockSecondSlot") ? 1 : null;
    if (empty === null) { notify(w, c.id, "Make an empty weapon slot first"); return; }
    p.potionSmall--; setSlot(p, empty, second!);
    if (p.slot === empty) weaponChanged(w, c);
  } else {
    if (!held || !isWeaponId(held)) { notify(w, c.id, "Hold a weapon to trade"); return; }
    if (cmd.pick === 1 && !grantConsumable(w, c, "potionSmall")) { notify(w, c.id, "Your small potion pouch is full"); return; }
    setSlot(p, p.slot === 1 ? 1 : 0, cmd.pick === 0 ? first! : null); weaponChanged(w, c);
  }
  w.traders?.barterAt.set(c.id, w.state.serverTime + 5000);
  notify(w, c.id, cmd.pick === 1 ? "Traded weapon for a small healing potion" : `Traded for ${WEAPONS[(cmd.pick === 0 ? first : second)!].name}`);
};

export function updateTraders(w: World, dtMs: number): void {
  const rt = w.traders;
  if (!rt || w.state.phase !== "active") return;
  const map = collisionMap(w), now = w.state.serverTime;
  w.state.traders.forEach(npc => {
    const walker = rt.walkers.get(npc.id);
    if (!walker) return;
    let visitor = false;
    w.state.players.forEach((p, id) => {
      if (p.status !== "alive" || Math.hypot(p.x - npc.x, p.y - npc.y) > TRADER_RANGE || !hasLineOfSight(map, p, npc, MASK_MOVE)) return;
      visitor = true;
      if (npc.kind === "stats" && !p.tradeUsed && p.tradeOffers.length === 0) {
        const c = combatant(w, id); if (c) recomputeMods(w, c);
        for (const offer of rollStatTrades(w, p)) p.tradeOffers.push(JSON.stringify(offer));
      }
    });
    if (visitor) { walker.nextWalkAt = now + TRADER_STOP_MS; return; }
    if (!walker.path.length && now >= walker.nextWalkAt) {
      for (const goal of shuffled(rt.destinations, w.rewardRandom).slice(0, 8)) {
        if (Math.hypot(npc.x - goal.x, npc.y - goal.y) < TILE * 3) continue;
        const path = findPath(map, npc, goal, 12);
        if (path.length) { walker.path = path; break; }
      }
      walker.nextWalkAt = now + TRADER_STOP_MS;
    }
    let walk = TRADER_SPEED * dtMs / 1000;
    while (walk > 0 && walker.path.length) {
      const point = walker.path[0]!, dx = point.x - npc.x, dy = point.y - npc.y, distance = Math.hypot(dx, dy);
      const step = Math.min(walk, distance), next = distance > 0 ? { x: npc.x + dx / distance * step, y: npc.y + dy / distance * step } : point;
      if (!segmentClear(map, npc, next, 12)) { walker.path = []; break; }
      npc.x = next.x; npc.y = next.y; walk -= step;
      if (distance <= step) walker.path.shift();
    }
  });
}

export function install(w: World): void {
  if (w.config.training) return;
  const destinations: Vec2[] = [];
  for (let y = 2; y < w.map.h - 2; y += 4) for (let x = 2; x < w.map.w - 2; x += 4) {
    const point = { x: tileToWorldCenter(x), y: tileToWorldCenter(y) };
    if (circleClear(w.map, point, 12)) destinations.push(point);
  }
  w.traders = { walkers: new Map(), barterAt: new Map(), destinations };
  w.actions.trade = handleTrade;
  w.systems.push(updateTraders);
  chainHook(w, "raidStarted", spawnTraders);
}
