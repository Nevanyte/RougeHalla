import {
  cardTitle, hasLineOfSight, placeQuests, QUEST_ACCEPT_RANGE, QUEST_ITEM_PREFIX, QUEST_REFUSAL, QUEST_REVEAL_HEAD_START_MS,
  QUEST_REVEAL_RADIUS, QUEST_TURN_IN_RANGE, questAcceptedText, questAcceptFirstText, questRewardCard, selectQuests,
  type MobTypeId, type QuestDef, type Vec2,
} from "@raid/shared";
import { QuestState, type ContainerState, type PlayerState } from "@raid/shared/schema";
import { awardQuestGv } from "./arena";
import { grantCard } from "./chests";
import { combatant, standing as fighterStanding, type Combatant } from "./combatant";
import { feedOfPlayer } from "./feed";
import { addContainer, forgetBirth } from "./loot";
import { addMob } from "./mobs";
import { actionBlocked } from "./status";
import { chainHook, collisionMap, emit, nextId, tieRank, type ActionHandler, type PlayerRuntime, type World } from "./world";

export { QUEST_REVEAL_HEAD_START_MS } from "@raid/shared";

const CLOSED_QUEST_LINGER_MS = 20_000;

export interface QuestRuntime {
  id: string;
  def: QuestDef;
  s: QuestState;
  npcId: string;
  containers: string[];
  tours: Map<string, Set<string>>;
  placement: { at: Vec2; tokens?: Vec2[]; parcel?: Vec2 };
  published: boolean;
  publishAt: number;
  finder: string;
  lastCarrier: string;
  closedAt: number;
}

export interface QuestsRuntime {
  quests: Map<string, QuestRuntime>;
  carried: Map<string, string>;
  /**
   * A camp was cleared this tick. The kill offers are re-checked in questSystem, after the pass has paid every kill: the
   * campCleared hook runs BEFORE the clearing kill's own mobKilled (killMob queues it first), so checking in the hook would
   * expire an offer that kill has just finished.
   */
  recheck: boolean;
  onQuestPickup(world: World, c: Extract<Combatant, { kind: "player" }>, box: ContainerState): boolean;
}

function toast(world: World, to: string, text: string): void {
  emit(world, { type: "toast", to, text });
}

function announce(world: World, text: string): void {
  emit(world, { type: "toast", to: null, text });
}

/**
 * Fill bots (docs/BOTS.md) take no part in quests, whatever they stand next to. They have no quest policy, so a bot that
 * happened to stand at a token, a parcel or a giver would win an offer a human was racing for, and a bot's death pays no GV
 * (arena.ts creditKill), so it must not advance or pay a kill quest either. This is the one test every entry point asks:
 * kills and deaths, pickups, the finder of a hidden giver, the turn-in, the early-closure supply count.
 */
const takesPart = (rt: PlayerRuntime | undefined): rt is PlayerRuntime => !!rt && !rt.bot;

/** Whether this player accepted the offer at its giver: nothing counts for them before (kills, tokens, the parcel, the turn-in). */
const accepted = (qt: QuestRuntime, playerId: string): boolean => qt.s.accepted.get(playerId) === true;

function runtime(world: World): QuestsRuntime {
  return world.quests ?? (world.quests = { quests: new Map(), carried: new Map(), recheck: false, onQuestPickup });
}

function syncUnknownCount(world: World): void {
  let n = 0;
  for (const qt of world.quests?.quests.values() ?? []) if (!qt.published) n++;
  world.state.unknownQuests = n;
}

/** The roster and every hidden placement draw come only from the private quest stream. */
export function spawnQuests(world: World): void {
  if (world.quests || !world.config.quests || world.config.training || world.map.camps.length === 0) return;
  runtime(world); // from here a second call (planning start, then raid start) is a no-op even if nothing places
  const random = world.questRandom;
  const roster = selectQuests(random);
  // placeQuests returns its offers privately shuffled and each offer takes the next id in that order, so an id carries
  // neither the quest's theme nor whether it is a known one. Placement is a few ms of flood and scan, run here at
  // planning start (or the run's first tick without planning), never in an active-run tick.
  for (const placement of placeQuests(world.map, roster, random)) offerQuest(world, placement.def, placement.known, placement);
}

export function offerQuest(
  world: World, def: QuestDef, known: boolean, placement: { at: Vec2; tokens?: Vec2[]; parcel?: Vec2 },
): QuestRuntime {
  const q = runtime(world);
  const id = nextId(world, "quest");
  const s = new QuestState();
  s.id = id;
  s.def = def.id;
  s.x = placement.at.x;
  s.y = placement.at.y;
  s.status = "open";
  s.expiresAt = world.state.serverTime + def.expiresAtSec * 1000;
  const qt: QuestRuntime = {
    id, def, s, npcId: "", containers: [], tours: new Map(), placement, published: false, publishAt: 0, finder: "", lastCarrier: "", closedAt: 0,
  };
  q.quests.set(id, qt);
  if (known) publishQuest(world, qt);
  else syncUnknownCount(world);
  return qt;
}

function publishQuest(world: World, qt: QuestRuntime): void {
  if (qt.published) return;
  qt.published = true;
  world.state.quests.set(qt.id, qt.s);
  syncUnknownCount(world);
  if (world.state.phase === "active") placePublishedQuest(world, qt);
  if (qt.finder) {
    const finder = world.state.players.get(qt.finder)?.name ?? "A scout";
    announce(world, `${finder} revealed quest: ${qt.def.name}`);
  }
}

function placePublishedQuest(world: World, qt: QuestRuntime): void {
  if (qt.npcId) return;
  qt.npcId = addMob(world, {
    kind: "quest", name: qt.def.giver, at: qt.placement.at,
    facing: Math.atan2(world.map.coliseum.centre.y - qt.s.y, world.map.coliseum.centre.x - qt.s.x),
  });
  if (qt.def.kind === "collect") {
    for (const at of qt.placement.tokens ?? []) dropQuestItem(world, qt, at);
  } else if (qt.def.kind === "fetch" && qt.placement.parcel) {
    dropQuestItem(world, qt, qt.placement.parcel);
  }
}

function dropQuestItem(world: World, qt: QuestRuntime, at: Vec2): void {
  const box = addContainer(world, "quest", at, qt.def.name, [{ uid: world.newItemUid(), def: QUEST_ITEM_PREFIX + qt.id }]);
  qt.containers.push(box.id);
}

function removeContainers(world: World, qt: QuestRuntime): void {
  for (const id of qt.containers) {
    world.state.containers.delete(id);
    forgetBirth(world, id);
  }
  qt.containers = [];
}

function onQuestPickup(world: World, c: Extract<Combatant, { kind: "player" }>, box: ContainerState): boolean {
  const q = world.quests;
  const item = box.items.at(0);
  if (!q || !item || !item.def.startsWith(QUEST_ITEM_PREFIX) || !takesPart(c.rt)) return false;
  const qt = q.quests.get(item.def.slice(QUEST_ITEM_PREFIX.length));
  if (!qt || !qt.published || qt.s.status !== "open") { toast(world, c.id, QUEST_REFUSAL.over); return true; }
  // The item stays where it lies: the refusal uses nothing up.
  if (!accepted(qt, c.id)) { toast(world, c.id, questAcceptFirstText(qt.def)); return true; }
  if (qt.def.kind === "fetch") {
    if (q.carried.has(c.id)) { toast(world, c.id, "you can carry one quest item"); return true; }
    if (qt.s.carrier !== "") return true;
    const stolen = qt.lastCarrier !== "" && qt.lastCarrier !== c.id;
    qt.s.carrier = c.id;
    qt.lastCarrier = c.id;
    q.carried.set(c.id, qt.id);
    removeBox(world, qt, box);
    if (stolen) announce(world, `${c.s.name} stole parcel: ${qt.def.name}`);
    toast(world, c.id, `Picked up: ${qt.def.name} — carry it to ${qt.def.giver}`);
    return true;
  }
  if ((qt.s.progress.get(c.id) ?? 0) >= qt.def.count) {
    toast(world, c.id, `You have enough tokens for ${qt.def.name}; return to ${qt.def.giver}`);
    return true;
  }
  bump(qt, c.id, 1);
  removeBox(world, qt, box);
  const n = qt.s.progress.get(c.id) ?? 0;
  toast(world, c.id, `${qt.def.name}: ${Math.min(n, qt.def.count)}/${qt.def.count}`);
  return true;
}

/**
 * `questAccept` (an action, so within a tick accepts resolve in the shuffled actionOrder like a pickup). Checked in this order,
 * each refusal a private toast that changes nothing:
 *   a standing human in an active run (a fill bot, or anyone else, is ignored silently) ......... silent
 *   not stunned or casting (status.ts actionBlocked, as for a pickup) ............................ "Can't do that now"
 *   the offer exists, is published and open, and its giver stands (an unpublished id gets the same
 *   answer as a made-up one, so probing ids learns nothing) ....................................... "That quest is over"
 *   the SERVER position within QUEST_ACCEPT_RANGE of the giver ................................... "Too far away"
 *   with line of sight on collisionMap(world) .................................................... "Can't reach that"
 *   not accepted yet ............................................................................. "You already accepted that quest"
 * Success records the player in the public `accepted` set (progress counts from now, never backwards) and tells them.
 */
export const handleQuestAccept: ActionHandler = (world, c, cmd) => {
  const q = world.quests;
  if (cmd.kind !== "questAccept" || c.kind !== "player" || !q || world.state.phase !== "active" || !fighterStanding(c) || !takesPart(c.rt)) return;
  if (actionBlocked(world, c)) { toast(world, c.id, QUEST_REFUSAL.busy); return; }
  const qt = q.quests.get(cmd.quest);
  if (!qt || !qt.published || qt.s.status !== "open" || qt.npcId === "" || !world.state.mobs.has(qt.npcId)) {
    toast(world, c.id, QUEST_REFUSAL.over);
    return;
  }
  const p = c.s;
  if (Math.hypot(p.x - qt.s.x, p.y - qt.s.y) > QUEST_ACCEPT_RANGE) { toast(world, c.id, QUEST_REFUSAL.far); return; }
  if (!hasLineOfSight(collisionMap(world), p, qt.s)) { toast(world, c.id, QUEST_REFUSAL.blocked); return; }
  if (accepted(qt, c.id)) { toast(world, c.id, QUEST_REFUSAL.already); return; }
  qt.s.accepted.set(c.id, true);
  toast(world, c.id, questAcceptedText(qt.def));
};

function removeBox(world: World, qt: QuestRuntime, box: ContainerState): void {
  world.state.containers.delete(box.id);
  forgetBirth(world, box.id);
  qt.containers = qt.containers.filter((id) => id !== box.id);
}

function bump(qt: QuestRuntime, playerId: string, by: number): void {
  const now = qt.s.progress.get(playerId) ?? 0;
  if (now >= qt.def.count) return;
  qt.s.progress.set(playerId, Math.min(qt.def.count, now + by));
}

function onMobKilled(
  world: World, killer: PlayerRuntime,
  mob: { type: MobTypeId; zone: NonNullable<QuestDef["region"]>; camp: number; elite: boolean },
): void {
  const q = world.quests;
  if (!q || world.state.phase !== "active" || !takesPart(killer)) return;
  const p = world.state.players.get(killer.id);
  if (!p || p.status !== "alive") return;
  for (const qt of q.quests.values()) {
    const def = qt.def;
    if (!qt.published || qt.s.status !== "open" || def.kind !== "kill" || def.players || !accepted(qt, killer.id)) continue;
    if (def.elite && !mob.elite) continue;
    if (def.tour) {
      let seen = qt.tours.get(killer.id);
      if (!seen) qt.tours.set(killer.id, (seen = new Set()));
      seen.add(mob.zone);
      qt.s.progress.set(killer.id, Math.min(def.count, seen.size));
    } else if (!def.elite && def.region && mob.zone !== def.region) {
      continue;
    } else {
      bump(qt, killer.id, 1);
    }
  }
}

function onPlayerKilled(world: World, killer: PlayerRuntime, victim: PlayerRuntime, outcome: "died" | "mia"): void {
  const q = world.quests;
  if (!q || outcome !== "died" || world.state.phase !== "active" || !takesPart(killer) || !takesPart(victim)) return;
  const p = world.state.players.get(killer.id);
  if (!p || p.status !== "alive") return;
  for (const qt of q.quests.values()) {
    if (qt.published && qt.s.status === "open" && qt.def.kind === "kill" && qt.def.players && accepted(qt, killer.id)) bump(qt, killer.id, 1);
  }
}

function dropParcel(world: World, p: PlayerState): void {
  const q = world.quests;
  if (!q || q.carried.size === 0) return;
  let pid: string | null = null;
  for (const [id, pp] of world.state.players) if (pp === p) { pid = id; break; }
  if (pid === null) return;
  const questId = q.carried.get(pid);
  if (!questId) return;
  q.carried.delete(pid);
  const qt = q.quests.get(questId);
  if (!qt || qt.s.status !== "open") return;
  qt.s.carrier = "";
  dropQuestItem(world, qt, p);
  announce(world, `${p.name} dropped parcel: ${qt.def.name}`);
}

/** A player a quest can see: a human who is alive, up and not yet resolved. */
const standing = (p: PlayerState, rt: PlayerRuntime | undefined): rt is PlayerRuntime =>
  p.status === "alive" && takesPart(rt) && !rt.down && !rt.resolved;

function ready(qt: QuestRuntime, playerId: string): boolean {
  if (!accepted(qt, playerId)) return false;
  if (qt.def.kind === "fetch") return qt.s.carrier === playerId;
  return (qt.s.progress.get(playerId) ?? 0) >= qt.def.count;
}

function removeGiver(world: World, qt: QuestRuntime): void {
  if (!qt.npcId) return;
  world.state.mobs.delete(qt.npcId);
  world.mobs.delete(qt.npcId);
  qt.npcId = "";
}

/**
 * An open offer ends here, however it ends: its carried parcel link, ground items and giver go at once, and its timer
 * stops. A public row then stays CLOSED_QUEST_LINGER_MS for the log (status "done" or "expired"), swept by questSystem.
 */
function retire(world: World, qt: QuestRuntime): void {
  const q = world.quests!;
  if (qt.s.carrier !== "") {
    q.carried.delete(qt.s.carrier);
    qt.s.carrier = "";
  }
  qt.closedAt = world.state.serverTime;
  qt.s.expiresAt = Math.min(qt.s.expiresAt, qt.closedAt);
  removeContainers(world, qt);
  removeGiver(world, qt);
}

function completeQuest(world: World, qt: QuestRuntime, playerId: string): void {
  const p = world.state.players.get(playerId);
  const rt = world.players.get(playerId);
  if (!p || !rt || !standing(p, rt)) return;
  qt.s.status = "done";
  qt.s.doneBy = p.name;
  retire(world, qt);
  awardQuestGv(world, p, rt, qt.def.reward.gv);
  // The card: the quest's nominal one, a tier lower once the finisher's feed has braked the mob reward curve (shared questRewardCard).
  const card = questRewardCard(qt.def, feedOfPlayer(p, rt));
  const c = combatant(world, playerId);
  if (c?.kind === "player" && grantCard(world, c, card) !== null) {
    emit(world, { type: "toast", to: playerId, text: `Quest complete: ${cardTitle(card)}` });
  }
  announce(world, `${p.name} completed quest: ${qt.def.name}`);
}

/**
 * Closes an open offer without pay. A public one stays as "expired" for the log (returns true: the caller announces it);
 * one nobody has seen is deleted and leaves no trace but the lower unknown count (returns false).
 */
function expireQuest(world: World, qt: QuestRuntime): boolean {
  if (qt.s.status !== "open") return false;
  retire(world, qt);
  if (qt.published) {
    qt.s.status = "expired";
    return true;
  }
  world.state.quests.delete(qt.id);
  world.quests!.quests.delete(qt.id);
  syncUnknownCount(world);
  return false;
}

function announceExpired(world: World, expired: readonly QuestRuntime[]): void {
  if (expired.length === 1) announce(world, `Quest expired: ${expired[0]!.def.name}`);
  else if (expired.length > 1) announce(world, `${expired.length} quests expired`);
}

/** The coliseum teleport and the run's end: nothing can be delivered any more, so every open offer closes, unpaid. */
function closeAll(world: World, loud: boolean): void {
  const expired: QuestRuntime[] = [];
  for (const qt of [...world.quests?.quests.values() ?? []]) if (expireQuest(world, qt)) expired.push(qt);
  if (loud) announceExpired(world, expired);
}

/** Camps never respawn, so the mobs standing now are all the kills a kill offer will ever get. */
function onCampCleared(world: World): void {
  if (world.quests) world.quests.recheck = true;
}

/**
 * Whether any standing player could still finish this kill offer: they either already have the whole objective (the turn-in
 * is all that is left) or the live mobs it counts still cover what they lack. A dead or departed player's progress is
 * worth nothing. Returns true when no player is standing at all (the run is over; nothing to close early).
 */
function killSupplyLeft(
  world: World, qt: QuestRuntime, zones: ReadonlyMap<string, number>, elites: number,
): boolean {
  const def = qt.def;
  let anyone = false;
  for (const [pid, p] of world.state.players) {
    if (!standing(p, world.players.get(pid))) continue;
    anyone = true;
    const have = qt.s.progress.get(pid) ?? 0;
    const need = def.count - have; // zero or less: the whole objective is done and only the turn-in is left
    if (def.tour) {
      const seen = qt.tours.get(pid);
      let fresh = 0;
      for (const [zone, n] of zones) if (n > 0 && !seen?.has(zone)) fresh++;
      if (fresh >= need) return true;
    } else if (def.elite) {
      if (elites >= need) return true;
    } else if (def.region) {
      if ((zones.get(def.region) ?? 0) >= need) return true;
    } else {
      let all = 0;
      for (const n of zones.values()) all += n;
      if (all >= need) return true;
    }
  }
  return !anyone;
}

/**
 * Closes the kill offers whose targets are gone (called from questSystem once a camp was cleared, and for one offer the tick
 * it is published). A hidden offer is never closed here: its deletion would lower the public `unknownQuests` on the tick a
 * camp is cleared and so tell everyone a hidden offer of that zone existed. It stays hidden until its own deadline, the
 * teleport or the run's end, and is checked the moment it goes public (`only`), where closing it leaks nothing.
 */
function closeImpossible(world: World, out: QuestRuntime[], only?: QuestRuntime): void {
  const zones = new Map<string, number>();
  let elites = 0;
  for (const rt of world.mobs.values()) {
    const s = world.state.mobs.get(rt.id);
    if (!rt.brain || !s || s.status !== "alive" || (s.kind !== "mob" && s.kind !== "elite")) continue;
    zones.set(rt.brain.region, (zones.get(rt.brain.region) ?? 0) + 1);
    if (rt.brain.elite) elites++;
  }
  for (const qt of only ? [only] : [...world.quests!.quests.values()]) {
    const def = qt.def;
    if (!qt.published || qt.s.status !== "open" || def.kind !== "kill" || def.players) continue;
    if (!killSupplyLeft(world, qt, zones, elites) && expireQuest(world, qt)) out.push(qt);
  }
}

/** After the ledger: cleanup, delayed reveals, expiry, then automatic turn-ins. Planning never calls this system. */
export function questSystem(world: World): void {
  const q = world.quests;
  if (!q || q.quests.size === 0 || world.state.phase !== "active") return;
  const now = world.state.serverTime;
  for (const qt of [...q.quests.values()]) {
    if (qt.s.status !== "open" && now - qt.closedAt >= CLOSED_QUEST_LINGER_MS) {
      q.quests.delete(qt.id);
      world.state.quests.delete(qt.id);
    }
  }
  const map = collisionMap(world);
  const expired: QuestRuntime[] = [];
  if (q.recheck) {
    q.recheck = false;
    closeImpossible(world, expired);
  }

  for (const qt of [...q.quests.values()]) {
    if (qt.s.status !== "open") continue;
    if (now >= qt.s.expiresAt) {
      if (expireQuest(world, qt)) expired.push(qt);
      continue;
    }
    if (qt.published) continue;
    if (qt.publishAt > 0) {
      if (now >= qt.publishAt) {
        publishQuest(world, qt);
        closeImpossible(world, expired, qt);
      }
      continue;
    }
    if (world.state.gatesLocked) continue;
    let finder: string | null = null;
    for (const [pid, p] of world.state.players) {
      const rt = world.players.get(pid);
      if (!standing(p, rt)) continue;
      if (Math.hypot(p.x - qt.s.x, p.y - qt.s.y) > QUEST_REVEAL_RADIUS) continue;
      if (finder !== null && tieRank(world, pid) > tieRank(world, finder)) continue;
      finder = pid;
    }
    if (finder === null) continue;
    qt.finder = finder;
    qt.publishAt = now + QUEST_REVEAL_HEAD_START_MS;
    emit(world, {
      type: "questReveal", to: finder,
      quest: { id: qt.id, def: qt.def.id, x: qt.s.x, y: qt.s.y, expiresAt: qt.s.expiresAt },
    });
    toast(world, finder, `Quest discovered: ${qt.def.name} (${qt.def.giver})`);
  }
  announceExpired(world, expired);
  if (world.state.gatesLocked) return;

  for (const qt of q.quests.values()) {
    if (!qt.published || qt.s.status !== "open") continue;
    let best: string | null = null;
    for (const [pid, p] of world.state.players) {
      const rt = world.players.get(pid);
      if (!standing(p, rt) || !ready(qt, pid)) continue;
      if (Math.hypot(p.x - qt.s.x, p.y - qt.s.y) > QUEST_TURN_IN_RANGE) continue;
      if (!hasLineOfSight(map, p, qt.s)) continue;
      if (best !== null && tieRank(world, pid) > tieRank(world, best)) continue;
      best = pid;
    }
    if (best !== null) completeQuest(world, qt, best);
  }
}

function raidStarted(world: World): void {
  spawnQuests(world);
  for (const qt of world.quests?.quests.values() ?? []) {
    qt.s.expiresAt = world.state.raidStartedAt + qt.def.expiresAtSec * 1000;
    if (qt.published) placePublishedQuest(world, qt);
  }
}

export function install(world: World): void {
  if (!world.config.quests || world.config.training) return;
  world.actions.questAccept = handleQuestAccept;
  chainHook(world, "planningStarted", spawnQuests);
  chainHook(world, "raidStarted", raidStarted);
  chainHook(world, "mobKilled", onMobKilled);
  chainHook(world, "playerKilled", onPlayerKilled);
  chainHook(world, "campCleared", onCampCleared);
  chainHook(world, "teleported", (w) => closeAll(w, true));
  chainHook(world, "runEnded", (w) => closeAll(w, false));
  const prevDrop = world.hooks.dropBody;
  world.hooks.dropBody = (w, p) => {
    prevDrop(w, p);
    dropParcel(w, p);
  };
  world.systems.push(questSystem);
}
