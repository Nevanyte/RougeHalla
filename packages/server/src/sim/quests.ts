import {
  hasLineOfSight, placeQuests, QUEST_ITEM_PREFIX, QUEST_REVEAL_HEAD_START_MS, QUEST_REVEAL_RADIUS,
  QUEST_TURN_IN_RANGE, rewardCurve, selectQuests, type FactionId, type QuestDef, type Vec2,
} from "@raid/shared";
import { QuestState, type ContainerState, type PlayerState } from "@raid/shared/schema";
import { awardQuestGv } from "./arena";
import { grantBuff } from "./buffs";
import type { Combatant } from "./combatant";
import { feedOfPlayer } from "./feed";
import { addContainer, forgetBirth } from "./loot";
import { addMob } from "./mobs";
import { chainHook, collisionMap, emit, nextId, tieRank, type PlayerRuntime, type World } from "./world";

export { QUEST_REVEAL_HEAD_START_MS } from "@raid/shared";

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
}

export interface QuestsRuntime {
  quests: Map<string, QuestRuntime>;
  carried: Map<string, string>;
  onQuestPickup(world: World, c: Extract<Combatant, { kind: "player" }>, box: ContainerState): boolean;
}

function toast(world: World, to: string, text: string): void {
  emit(world, { type: "toast", to, text });
}

function announce(world: World, text: string): void {
  emit(world, { type: "toast", to: null, text });
}

function runtime(world: World): QuestsRuntime {
  return world.quests ?? (world.quests = { quests: new Map(), carried: new Map(), onQuestPickup });
}

function syncUnknownCount(world: World): void {
  let n = 0;
  for (const qt of world.quests?.quests.values() ?? []) if (!qt.published) n++;
  world.state.unknownQuests = n;
}

/** The roster and every hidden placement draw come only from the private reward stream. */
export function spawnQuests(world: World): void {
  if (world.quests) return;
  runtime(world);
  const roster = selectQuests(world.rewardRandom);
  for (const placement of placeQuests(world.map, roster, world.rewardRandom)) {
    offerQuest(world, placement.def, placement.known, placement);
  }
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
    id, def, s, npcId: "", containers: [], tours: new Map(), placement, published: false, publishAt: 0, finder: "", lastCarrier: "",
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
  if (!q || !item || !item.def.startsWith(QUEST_ITEM_PREFIX)) return false;
  const qt = q.quests.get(item.def.slice(QUEST_ITEM_PREFIX.length));
  if (!qt || !qt.published || qt.s.status !== "open") { toast(world, c.id, "That quest is over"); return true; }
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

function onMobKilled(world: World, killer: PlayerRuntime, mob: { region: FactionId; elite: boolean }): void {
  const q = world.quests;
  if (!q || world.state.phase !== "active") return;
  const p = world.state.players.get(killer.id);
  if (!p || p.status !== "alive") return;
  for (const qt of q.quests.values()) {
    const def = qt.def;
    if (!qt.published || qt.s.status !== "open" || def.kind !== "kill" || def.players) continue;
    if (def.elite && !mob.elite) continue;
    if (def.tour) {
      let seen = qt.tours.get(killer.id);
      if (!seen) qt.tours.set(killer.id, (seen = new Set()));
      seen.add(mob.region);
      qt.s.progress.set(killer.id, Math.min(def.count, seen.size));
    } else if (!def.elite && def.region && mob.region !== def.region) {
      continue;
    } else {
      bump(qt, killer.id, 1);
    }
  }
}

function onPlayerKilled(world: World, killer: PlayerRuntime, _victim: PlayerRuntime, outcome: "died" | "mia"): void {
  const q = world.quests;
  if (!q || outcome !== "died" || world.state.phase !== "active") return;
  const p = world.state.players.get(killer.id);
  if (!p || p.status !== "alive") return;
  for (const qt of q.quests.values()) {
    if (qt.published && qt.s.status === "open" && qt.def.kind === "kill" && qt.def.players) bump(qt, killer.id, 1);
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

const standing = (p: PlayerState, rt: PlayerRuntime | undefined): rt is PlayerRuntime =>
  p.status === "alive" && !!rt && !rt.down && !rt.resolved;

function ready(qt: QuestRuntime, playerId: string): boolean {
  if (qt.def.kind === "fetch") return qt.s.carrier === playerId;
  return (qt.s.progress.get(playerId) ?? 0) >= qt.def.count;
}

function completeQuest(world: World, qt: QuestRuntime, playerId: string): void {
  const p = world.state.players.get(playerId);
  const rt = world.players.get(playerId);
  if (!p || !rt || !standing(p, rt)) return;
  qt.s.status = "done";
  qt.s.doneBy = p.name;
  qt.s.carrier = "";
  const q = world.quests!;
  if (q.carried.get(playerId) === qt.id) q.carried.delete(playerId);
  removeContainers(world, qt);
  awardQuestGv(world, p, rt, qt.def.reward.gv);
  grantBuff(world, p, rt, qt.def.reward.buff, qt.def.reward.stacks * rewardCurve(feedOfPlayer(p, rt)));
  toast(world, playerId, `Quest complete: ${qt.def.name}`);
  announce(world, `${p.name} completed quest: ${qt.def.name}`);
}

function expireQuest(world: World, qt: QuestRuntime): void {
  const q = world.quests!;
  if (qt.s.carrier !== "") {
    q.carried.delete(qt.s.carrier);
    qt.s.carrier = "";
  }
  removeContainers(world, qt);
  if (qt.npcId) {
    world.state.mobs.delete(qt.npcId);
    world.mobs.delete(qt.npcId);
    qt.npcId = "";
  }
  if (qt.published) {
    qt.s.status = "expired";
    announce(world, `Quest expired: ${qt.def.name}`);
    return;
  }
  world.state.quests.delete(qt.id);
  q.quests.delete(qt.id);
  syncUnknownCount(world);
}

/** After the ledger: delayed reveals, expiry, then automatic turn-ins. Planning never calls this system. */
export function questSystem(world: World): void {
  const q = world.quests;
  if (!q || q.quests.size === 0 || world.state.phase !== "active") return;
  const now = world.state.serverTime;
  const map = collisionMap(world);

  for (const qt of [...q.quests.values()]) {
    if (qt.s.status !== "open") continue;
    if (now >= qt.s.expiresAt) { expireQuest(world, qt); continue; }
    if (qt.published) continue;
    if (qt.publishAt > 0) {
      if (now >= qt.publishAt) publishQuest(world, qt);
      continue;
    }
    for (const [pid, p] of world.state.players) {
      const rt = world.players.get(pid);
      if (!standing(p, rt)) continue;
      if (Math.hypot(p.x - qt.s.x, p.y - qt.s.y) <= QUEST_REVEAL_RADIUS) {
        qt.finder = pid;
        qt.publishAt = now + QUEST_REVEAL_HEAD_START_MS;
        emit(world, {
          type: "questReveal", to: pid,
          quest: { id: qt.id, def: qt.def.id, x: qt.s.x, y: qt.s.y, expiresAt: qt.s.expiresAt },
        });
        toast(world, pid, `Quest discovered: ${qt.def.name} (${qt.def.giver})`);
        break;
      }
    }
  }

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
  chainHook(world, "planningStarted", spawnQuests);
  chainHook(world, "raidStarted", raidStarted);
  chainHook(world, "mobKilled", onMobKilled);
  chainHook(world, "playerKilled", onPlayerKilled);
  const prevDrop = world.hooks.dropBody;
  world.hooks.dropBody = (w, p) => {
    prevDrop(w, p);
    dropParcel(w, p);
  };
  world.systems.push(questSystem);
}
