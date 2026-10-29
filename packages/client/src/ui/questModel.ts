import {
  FACTIONS, MASK_MOVE, MOB_STAT_CAP, PLAYER_RADIUS, QUEST_ITEM_PREFIX, QUEST_TURN_IN_RANGE, TILE, circleClear, findPath, mobStatCount, mobStatReward, mobStatText, pathLength, segmentClear,
  questDefById, questRewardStats, questRewardText, moveComponents, worldToTile,
  type GameMap, type QuestDef, type QuestKind, type QuestRevealMessage,
} from "@raid/shared";

export interface QuestProgress {
  get(id: string): number | undefined;
}

/** QuestState.accepted: the player ids that accepted the offer at its giver. Absent on a private reveal preview (nobody can accept it yet). */
export interface QuestAccepted {
  get(id: string): boolean | undefined;
}

export interface QuestStateLike {
  id: string;
  def: string;
  x: number;
  y: number;
  known?: boolean;
  status: string;
  doneBy: string;
  expiresAt: number;
  carrier: string;
  progress: QuestProgress;
  accepted?: QuestAccepted;
  /** Comma-separated faction ids already visited for each player, synced for tour-quest navigation. */
  visitedRegions?: { get(id: string): string | undefined };
}

/** Whether the local player accepted this offer: nothing counts for them (kills, tokens, the parcel, the turn-in) until they have. */
export function questAccepted(quest: QuestStateLike, localId: string): boolean {
  return quest.accepted?.get(localId) === true;
}

export interface QuestCollection {
  forEach(cb: (quest: QuestStateLike, id: string) => void): void;
}

export interface QuestItemLike { def: string }
export interface QuestContainerLike {
  id: string;
  kind: string;
  x: number;
  y: number;
  label: string;
  items: { at(index: number): QuestItemLike | undefined; readonly length: number };
}

export interface QuestContainerCollection {
  forEach(cb: (container: QuestContainerLike, id: string) => void): void;
}

export interface QuestPosition { x: number; y: number }

export interface QuestRow {
  id: string;
  def: QuestDef;
  quest: QuestStateLike;
  objective: string;
  progress: string;
  time: string;
  reward: string;
  status: string;
  ready: boolean;
  /** The local player accepted it at the giver. */
  accepted: boolean;
  /** The row's acceptance line: "Accepted", "Not accepted: talk to <giver>", or in planning where nobody can accept yet, what to do in the run. "" for a closed row. */
  acceptance: string;
  expired: boolean;
  /** Done or expired (by the server's word or by the clock): no timer, no live styling, listed after the open rows. */
  closed: boolean;
}

export interface QuestMapBlip extends QuestPosition {
  role: "giver" | "objective" | "carrier";
  kind: QuestKind;
  /** A giver blip: the local player accepted its offer (drawn solid; an offer not yet accepted is an outline). */
  accepted?: boolean;
  /** This is the objective currently selected by the player's explicit quest tracking choice. */
  tracked?: boolean;
  /** Server-path waypoints from the local player to the tracked objective. */
  route?: readonly QuestPosition[];
  /** Short label and ordinal for the persistent tracked-quest waypoint HUD. */
  waypoint?: { label: string; step: number; total: number };
  /** Stable target identity used internally to retain navigation across render frames. */
  targetId?: string;
}

/** The synced fields needed to pick a living target for an accepted kill quest. */
export interface QuestMobTarget extends QuestPosition {
  /** The collection key, when available, keeps target selection stable while a mob walks. */
  id?: string;
  kind: string;
  status: string;
  faction: string;
}

export interface QuestMinimapOptions {
  /** An explicit quest selection. Its giver/objective wins even when another offer is closer. */
  trackedId?: string | null;
  /** Current synced mobs; omitting this keeps compatibility for planning and older callers. */
  mobs?: Iterable<QuestMobTarget>;
  /** Server clock for suppressing a public offer immediately at expiry, before its next sync patch. */
  serverNow?: number;
}

const EMPTY_QUESTS: QuestCollection = { forEach: () => {} };
const EMPTY_CONTAINERS: QuestContainerCollection = { forEach: () => {} };
const MAX_NAV_CACHE_KEYS = 64;
interface NavCache { targetId: string; route?: QuestPosition[] }
const mobTargetCache = new WeakMap<GameMap, Map<string, string>>();
const trackedNavCache = new WeakMap<GameMap, Map<string, NavCache>>();

export function questFromReveal(message: QuestRevealMessage): QuestStateLike {
  return {
    id: message.id, def: message.def, x: message.x, y: message.y, status: "open", doneBy: "",
    expiresAt: message.expiresAt, carrier: "", progress: { get: () => undefined },
  };
}

/**
 * Forgets private reveal previews whose deadline passed. With `closed` (the coliseum gates are locked, or the run is over) it
 * forgets all of them: the server deletes an offer that never went public at the teleport and at the run's end without a word,
 * so a preview would otherwise stay in the log as an open offer nobody can reach until its own timer ran out.
 */
export function expireQuestPreviews(previews: Map<string, QuestStateLike>, serverNow: number, closed = false): void {
  if (closed) { previews.clear(); return; }
  for (const [id, preview] of previews) if (serverNow >= preview.expiresAt) previews.delete(id);
}

export function questCollections(
  state: unknown,
  preview?: QuestStateLike | Iterable<QuestStateLike> | null,
  serverNow = 0,
): { quests: QuestCollection; containers: QuestContainerCollection; hidden: number } {
  const s = state as { quests?: QuestCollection; containers?: QuestContainerCollection; unknownQuests?: number };
  const publicQuests = s.quests ?? EMPTY_QUESTS;
  const pending = new Map<string, QuestStateLike>();
  const add = (quest: QuestStateLike): void => { if (quest.expiresAt > serverNow) pending.set(quest.id, quest); };
  if (preview && Symbol.iterator in Object(preview)) for (const quest of preview as Iterable<QuestStateLike>) add(quest);
  else if (preview) add(preview as QuestStateLike);
  publicQuests.forEach((quest, id) => {
    pending.delete(id);
    pending.delete(quest.id);
  });
  const quests: QuestCollection = pending.size > 0 ? {
    forEach(cb) {
      publicQuests.forEach(cb);
      for (const quest of pending.values()) cb(quest, quest.id);
    },
  } : publicQuests;
  const count = s.unknownQuests ?? 0;
  // The server counts a revealed offer as hidden until it goes public; the finder already sees it as a preview row.
  const hidden = Number.isFinite(count) ? Math.max(0, Math.floor(count) - pending.size) : 0;
  return { quests, containers: s.containers ?? EMPTY_CONTAINERS, hidden };
}

export function visibleQuest(quest: QuestStateLike): boolean {
  return quest.known !== false;
}

export function questKindColor(kind: QuestKind): number {
  return kind === "kill" ? 0xef9a9a : kind === "collect" ? 0x80deea : 0xffd54f;
}

export function questKindCss(kind: QuestKind): string {
  return `#${questKindColor(kind).toString(16).padStart(6, "0")}`;
}

export function formatQuestTime(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function numberText(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * What the quest pays, in words: a fixed stack reward with its shared cap plus GV. Feed does not change this reward.
 */
export function questReward(def: QuestDef, _feed?: number, mobStats?: Readonly<Record<string, number>> | Map<string, number>): string {
  if (!mobStats) return questRewardText(def);
  const reward = questRewardStats(def);
  const current = mobStatCount(mobStats, reward.id);
  const gained = Math.min(reward.stacks, MOB_STAT_CAP - current);
  const name = mobStatReward(reward.id)?.name ?? reward.id;
  const award = gained > 0 ? `${gained} ${name} stacks (${mobStatText(reward.id, gained)}; ${current + gained}/${MOB_STAT_CAP} total)` : `${name} at cap (${current}/${MOB_STAT_CAP})`;
  return `${award} and ${def.reward.gv} GV`;
}

export function questObjective(def: QuestDef): string {
  const count = numberText(def.count);
  if (def.kind === "fetch") return `Find the parcel and return it to ${def.giver}`;
  if (def.kind === "collect") return `Collect ${count} quest tokens, then return to ${def.giver}`;
  if (def.players) return `Defeat ${count} player${def.count === 1 ? "" : "s"}`;
  if (def.elite) return `Defeat ${count} elite${def.count === 1 ? "" : "s"}`;
  if (def.tour) return `Kill mobs in ${count} different regions`;
  const region = def.region ? ` in ${FACTIONS[def.region].displayName}` : "";
  return `Kill ${count} mobs${region}`;
}

export function questReady(quest: QuestStateLike, def: QuestDef, localId: string): boolean {
  if (quest.status !== "open") return false;
  return def.kind === "fetch" ? quest.carrier === localId : (quest.progress.get(localId) ?? 0) >= def.count;
}

export function questRows(
  quests: QuestCollection, localId: string, serverNow: number, localName = "", planning = false, feed?: number, mobStats?: Readonly<Record<string, number>> | Map<string, number>,
): QuestRow[] {
  const rows: QuestRow[] = [];
  quests.forEach((quest) => {
    if (!visibleQuest(quest)) return;
    const def = questDefById(quest.def);
    if (!def) return;
    const ready = questReady(quest, def, localId);
    const accepted = questAccepted(quest, localId);
    // In planning the clock is frozen and the server re-anchors `expiresAt` at raid start, so show the fixed duration instead.
    const expired = quest.status === "expired" || (!planning && quest.status === "open" && serverNow >= quest.expiresAt);
    const closed = expired || quest.status === "done";
    const status = quest.status === "done" ? `Done by ${quest.doneBy || "someone"}` : expired ? "Expired" : ready ? "Return to the giver" : "Open";
    // The server clears a parcel's carrier at the turn-in, so the winner would read 0 / 1: the name on the row says who finished it.
    const mine = quest.status === "done" && localName !== "" && quest.doneBy === localName;
    const progress = mine
      ? `${numberText(def.count)} / ${numberText(def.count)}`
      : def.kind === "fetch" ? `${quest.carrier === localId ? 1 : 0} / 1` : `${numberText(Math.min(def.count, quest.progress.get(localId) ?? 0))} / ${numberText(def.count)}`;
    const acceptance = closed ? "" : planning ? "Accept at the giver in the run" : accepted ? "Accepted" : `Not accepted: talk to ${def.giver}`;
    rows.push({
      id: quest.id, def, quest, objective: questObjective(def), progress,
      time: closed ? "" : formatQuestTime(planning ? def.expiresAtSec * 1000 : quest.expiresAt - serverNow),
      // Closed history describes the award at completion, not what this viewer's later feed would pay now.
      reward: closed ? questReward(def) : questReward(def, feed, mobStats), status, ready, accepted, acceptance, expired, closed,
    });
  });
  const group = (row: QuestRow): number => !row.closed ? 0 : row.quest.status === "done" ? 1 : 2;
  rows.sort((a, b) => group(a) - group(b) || a.def.name.localeCompare(b.def.name));
  return rows;
}

export function questItemQuestId(container: QuestContainerLike): string | null {
  if (container.kind !== "quest" || container.items.length === 0) return null;
  const def = container.items.at(0)?.def ?? "";
  return def.startsWith(QUEST_ITEM_PREFIX) ? def.slice(QUEST_ITEM_PREFIX.length) : null;
}

export function questTurnIn(quest: QuestStateLike, def: QuestDef, localId: string, me: QuestPosition | undefined): boolean {
  return me !== undefined && questReady(quest, def, localId) && Math.hypot(me.x - quest.x, me.y - quest.y) <= QUEST_TURN_IN_RANGE;
}

export function questMinimapBlips(
  quests: QuestCollection, containers: QuestContainerCollection, localId: string,
  local: QuestPosition | undefined, positions: ReadonlyMap<string, QuestPosition>, map: GameMap | null,
  options: QuestMinimapOptions = {},
): QuestMapBlip[] {
  const out: QuestMapBlip[] = [];
  // The one nearest objective points at an offer the local player accepted; only with none of those does it point at the
  // nearest open giver (an offer not yet accepted counts for nothing, so its items and kill zone are not what to walk to).
  const objectives: QuestMapBlip[] = [];
  const givers: QuestMapBlip[] = [];
  const ground = new Map<string, QuestContainerLike[]>();
  containers.forEach((container) => {
    const questId = questItemQuestId(container);
    if (!questId) return;
    const list = ground.get(questId) ?? [];
    list.push(container);
    ground.set(questId, list);
  });
  const trackedObjectives: QuestMapBlip[] = [];
  let mobs: readonly QuestMobTarget[] | undefined;
  const livingMobs = (): readonly QuestMobTarget[] => mobs ??= options.mobs
    ? (Array.isArray(options.mobs) ? options.mobs as QuestMobTarget[] : [...options.mobs])
    : [];
  quests.forEach((quest) => {
    if (!visibleQuest(quest) || quest.status !== "open" || (options.serverNow !== undefined && options.serverNow >= quest.expiresAt)) return;
    const def = questDefById(quest.def);
    if (!def) return;
    const accepted = questAccepted(quest, localId);
    out.push({ role: "giver", kind: def.kind, x: quest.x, y: quest.y, accepted });
    if (quest.carrier) {
      const at = positions.get(quest.carrier);
      if (at) out.push({ role: "carrier", kind: def.kind, x: at.x, y: at.y });
    }
    const isTracked = options.trackedId != null && quest.id === options.trackedId;
    if (!accepted) {
      const label = !accepted ? `Talk to ${def.giver}` : `Return to ${def.giver}`;
      const target = { role: "objective" as const, kind: def.kind, x: quest.x, y: quest.y,
        targetId: `giver:${quest.id}`,
        ...(isTracked ? { tracked: true, waypoint: { label, step: 1, total: 1 } } : {}) };
      if (isTracked) trackedObjectives.push(target);
      givers.push(target);
      return;
    }
    if (questReady(quest, def, localId)) {
      const target = { role: "objective" as const, kind: def.kind, x: quest.x, y: quest.y,
        targetId: `giver:${quest.id}`,
        ...(isTracked ? { tracked: true, waypoint: { label: `Return to ${def.giver}`, step: 1, total: 1 } } : {}) };
      if (isTracked) trackedObjectives.push(target);
      objectives.push(target);
      return;
    }
    // The explicit tracker is the only objective whose route needs refreshing each frame.
    if (options.trackedId != null && !isTracked) return;
    if (def.kind === "collect" || (def.kind === "fetch" && !quest.carrier)) {
      for (const item of ground.get(quest.id) ?? []) {
        const target = { role: "objective" as const, kind: def.kind, x: item.x, y: item.y,
          targetId: `item:${item.id}`,
          ...(isTracked ? { tracked: true, waypoint: { label: def.kind === "fetch" ? "Find the parcel" : "Collect quest tokens", step: Math.min(def.count, (quest.progress.get(localId) ?? 0) + 1), total: def.kind === "fetch" ? 1 : def.count } } : {}) };
        if (isTracked) trackedObjectives.push(target);
        objectives.push(target);
      }
    } else if (def.kind === "fetch" && quest.carrier) {
      const at = positions.get(quest.carrier);
      if (at) {
        const target = { role: "objective" as const, kind: def.kind, x: at.x, y: at.y,
          targetId: `carrier:${quest.carrier}`,
          ...(isTracked ? { tracked: true, waypoint: { label: "Recover the parcel", step: 1, total: 1 } } : {}) };
        if (isTracked) trackedObjectives.push(target);
        objectives.push(target);
      }
    } else if (def.kind === "kill" && !def.players) {
      const visited = new Set((quest.visitedRegions?.get(localId) ?? "").split(",").filter(Boolean));
      const targets = livingMobs().filter((m) => m.status === "alive" && (m.kind === "mob" || m.kind === "elite")
        && (!def.elite || m.kind === "elite") && (!def.region || m.faction === def.region)
        && (!def.tour || !visited.has(m.faction)));
      const target = nearestReachableMob(localId, quest.id, targets, local, map);
      if (target) {
        const region = FACTIONS[target.faction as keyof typeof FACTIONS]?.displayName ?? target.faction;
        const label = def.tour ? `Kill in ${region}` : def.elite ? "Defeat an elite" : `Defeat a ${region} mob`;
        const step = (quest.progress.get(localId) ?? 0) + 1;
        const blip = { role: "objective" as const, kind: def.kind, x: target.x, y: target.y,
          targetId: target.id ? `mob:${target.id}` : `mob:${target.faction}:${target.kind}:${target.x}:${target.y}`,
          ...(isTracked ? { tracked: true, waypoint: { label, step, total: def.count } } : {}) };
        if (isTracked) trackedObjectives.push(blip);
        objectives.push(blip);
      }
    }
  });
  const candidates = options.trackedId != null ? trackedObjectives : objectives.length > 0 ? objectives : givers;
  if (local && candidates.length > 0) {
    const navKey = `${localId}|${options.trackedId ?? "default"}`;
    const selected = nearestReachableBlip(candidates, local, map, navKey);
    if (selected) {
      if (selected.blip.tracked && map) {
        selected.blip.route = [{ x: local.x, y: local.y }, ...selected.path!.map((p) => ({ x: p.x, y: p.y }))];
      }
      out.push(selected.blip);
    }
  }
  return out;
}

function nearestReachableBlip(
  candidates: readonly QuestMapBlip[], local: QuestPosition, map: GameMap | null, navKey?: string,
): { blip: QuestMapBlip; path: QuestPosition[] | null } | undefined {
  const cache = map && navKey ? getBoundedCache(trackedNavCache, map) : undefined;
  const nav = navKey ? cache?.get(navKey) : undefined;
  const retained = nav ? candidates.find((candidate) => navigationId(candidate) === nav.targetId) : undefined;
  if (retained && map && nav?.route?.length === 1
    && Math.hypot(local.x - nav.route[0]!.x, local.y - nav.route[0]!.y) <= 1
    && Math.hypot(retained.x - nav.route[0]!.x, retained.y - nav.route[0]!.y) <= 1) {
    return { blip: retained, path: [] };
  }
  if (retained && map && nav?.route) {
    const reused = reuseRoute(nav.route, local, retained, map);
    if (reused) {
      nav.route = reused.map((point) => ({ x: point.x, y: point.y }));
      return { blip: retained, path: reused.slice(1) };
    }
  }
  if (!retained && cache && navKey) cache.delete(navKey);
  let best: QuestMapBlip | undefined;
  let bestPath: QuestPosition[] | null = null;
  let bestLength = Infinity;
  const ordered = map
    ? [...candidates]
      .filter((candidate) => movementReachable(map, local, candidate))
      .sort((a, b) => ((a.x - local.x) ** 2 + (a.y - local.y) ** 2) - ((b.x - local.x) ** 2 + (b.y - local.y) ** 2))
    : candidates;
  const shortlist = map ? ordered.slice(0, 4) : ordered;
  for (const candidate of shortlist) {
    const path = map ? serverRoute(local, candidate, map) : null;
    if (map && !path) continue;
    const length = map ? pathLength(local, path!) : Math.hypot(candidate.x - local.x, candidate.y - local.y);
    if (length < bestLength) { best = candidate; bestPath = path; bestLength = length; }
  }
  // Component and circle checks should be sufficient for findPath, but exhaust the remaining candidates if its bounded
  // search window rejects every member of the short list so the UI never claims there is no route prematurely.
  if (!best && map) for (const candidate of ordered.slice(shortlist.length)) {
    const path = serverRoute(local, candidate, map);
    if (!path) continue;
    const length = pathLength(local, path);
    if (length < bestLength) { best = candidate; bestPath = path; bestLength = length; }
  }
  if (best && cache && navKey) {
    const entry: NavCache = { targetId: navigationId(best) };
    if (map && bestPath) entry.route = [{ x: local.x, y: local.y }, ...bestPath.map((point) => ({ x: point.x, y: point.y }))];
    setBounded(cache, navKey, entry);
  }
  return best ? { blip: best, path: bestPath } : undefined;
}

function navigationId(blip: QuestMapBlip): string {
  return blip.targetId ?? `${blip.role}:${blip.kind}:${blip.x}:${blip.y}`;
}

function reuseRoute(
  route: readonly QuestPosition[], from: QuestPosition, to: QuestPosition, map: GameMap,
): QuestPosition[] | null {
  if (route.length < 2) return null;
  // A teleport or long detour makes the cached first leg a poor route even if its connector is open.
  const oldStart = route[0]!;
  if (Math.hypot(from.x - oldStart.x, from.y - oldStart.y) > TILE * 2) return null;
  const points = route.map((point) => ({ x: point.x, y: point.y }));
  // Drop waypoints the player has reached or passed so the route never points back behind them.
  while (points.length > 2) {
    const waypoint = points[1]!;
    const next = points[2]!;
    const near = Math.hypot(from.x - waypoint.x, from.y - waypoint.y) <= PLAYER_RADIUS * 0.5;
    const dx = next.x - waypoint.x, dy = next.y - waypoint.y;
    const passed = (from.x - waypoint.x) * dx + (from.y - waypoint.y) * dy >= 0;
    const canSkip = segmentClear(map, from, next, PLAYER_RADIUS, MASK_MOVE);
    if (passed && !canSkip) return null;
    if ((!near && !passed) || !canSkip) break;
    points.splice(1, 1);
  }
  const firstWaypoint = points[1]!;
  if (!segmentClear(map, from, firstWaypoint, PLAYER_RADIUS, MASK_MOVE)) return null;
  const last = points.length - 1;
  const oldTarget = points[last]!;
  const penultimate = last === 1 ? from : points[last - 1]!;
  if ((oldTarget.x !== to.x || oldTarget.y !== to.y) && !segmentClear(map, penultimate, to, PLAYER_RADIUS, MASK_MOVE)) return null;
  points[0] = { x: from.x, y: from.y };
  points[last] = { x: to.x, y: to.y };
  return points;
}

function getBoundedCache<T>(cache: WeakMap<GameMap, Map<string, T>>, map: GameMap): Map<string, T> {
  let values = cache.get(map);
  if (!values) { values = new Map(); cache.set(map, values); }
  return values;
}

function setBounded<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_NAV_CACHE_KEYS) cache.delete(cache.keys().next().value!);
}

function serverRoute(from: QuestPosition, to: QuestPosition, map: GameMap): QuestPosition[] | null {
  if (!movementReachable(map, from, to)) return null;
  const path = findPath(map, from, to, PLAYER_RADIUS);
  if (path.length === 0 && Math.hypot(from.x - to.x, from.y - to.y) > 1) return null;
  return path;
}

function movementReachable(map: GameMap, from: QuestPosition, to: QuestPosition): boolean {
  if (!circleClear(map, from, PLAYER_RADIUS, MASK_MOVE) || !circleClear(map, to, PLAYER_RADIUS, MASK_MOVE)) return false;
  const fx = worldToTile(from.x), fy = worldToTile(from.y), tx = worldToTile(to.x), ty = worldToTile(to.y);
  if (fx < 0 || fy < 0 || tx < 0 || ty < 0 || fx >= map.w || tx >= map.w || fy >= map.h || ty >= map.h) return false;
  const components = moveComponents(map);
  return components[fy * map.w + fx] >= 0 && components[fy * map.w + fx] === components[ty * map.w + tx];
}

/** Pick a real living target using the same movement mask/pathfinder the server uses. */
function nearestReachableMob(
  localId: string, questId: string, targets: readonly QuestMobTarget[], local: QuestPosition | undefined, map: GameMap | null,
): QuestMobTarget | undefined {
  if (targets.length === 0) return undefined;
  if (!local) return targets[0];
  if (!map) {
    return targets.reduce((best, m) => (m.x - local.x) ** 2 + (m.y - local.y) ** 2 < (best.x - local.x) ** 2 + (best.y - local.y) ** 2 ? m : best);
  }
  const components = moveComponents(map);
  const lx = worldToTile(local.x), ly = worldToTile(local.y);
  const start = lx >= 0 && ly >= 0 && lx < map.w && ly < map.h ? components[ly * map.w + lx] : -1;
  if (start < 0) return undefined;
  const cache = getBoundedCache(mobTargetCache, map);
  // A few geometrically-near targets are enough to make the objective path-aware without running A* for every mob every frame.
  // Filter disconnected components and invalid endpoints first; then rank the short list by the actual server route length.
  const eligible = targets.filter((m) => {
    const tx = worldToTile(m.x), ty = worldToTile(m.y);
    return tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && components[ty * map.w + tx] === start
      && circleClear(map, m, PLAYER_RADIUS, MASK_MOVE);
  });
  const cacheKey = `${localId}|${questId}`;
  const selectedId = cache.get(cacheKey);
  if (selectedId) {
    const retained = eligible.find((candidate) => candidate.id === selectedId);
    if (retained) return retained;
  }
  const candidates = eligible.sort((a, b) => ((a.x - local.x) ** 2 + (a.y - local.y) ** 2) - ((b.x - local.x) ** 2 + (b.y - local.y) ** 2));
  let best: QuestMobTarget | undefined;
  let bestLength = Infinity;
  for (const candidate of candidates.slice(0, 4)) {
    const path = findPath(map, local, candidate, PLAYER_RADIUS);
    if (path.length === 0 && Math.hypot(candidate.x - local.x, candidate.y - local.y) > 1) continue;
    const length = pathLength(local, path);
    if (length < bestLength) { best = candidate; bestLength = length; }
  }
  if (!best) for (const candidate of candidates.slice(4)) {
    const path = findPath(map, local, candidate, PLAYER_RADIUS);
    if (path.length === 0 && Math.hypot(candidate.x - local.x, candidate.y - local.y) > 1) continue;
    const length = pathLength(local, path);
    if (length < bestLength) { best = candidate; bestLength = length; }
  }
  if (best?.id) setBounded(cache, cacheKey, best.id);
  return best;
}
