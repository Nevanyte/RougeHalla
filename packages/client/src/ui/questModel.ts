import {
  FACTIONS, QUEST_ITEM_PREFIX, QUEST_TURN_IN_RANGE, cardText, cardTitle, questDefById, questRewardCard, questRewardText, rewardCurve,
  QUEST_FEED_BRAKE,
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
}

const EMPTY_QUESTS: QuestCollection = { forEach: () => {} };
const EMPTY_CONTAINERS: QuestContainerCollection = { forEach: () => {} };

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
 * What a quest pays, in words. With the player's feed (shared feedScore of their kills) the card is the one the server will actually
 * grant (questRewardCard: a tier lower once the mob reward curve at their feed has fallen under QUEST_FEED_BRAKE), and a lowered one
 * says so; without it (the planning screen: nobody has fed yet) the nominal card. "Haste II (+16% attack speed) and 10 GV".
 */
export function questReward(def: QuestDef, feed?: number): string {
  const nominal = questRewardText(def);
  if (feed === undefined || !Number.isFinite(feed)) return nominal;
  const card = questRewardCard(def, feed);
  if (card === def.reward.card) return nominal;
  const title = cardTitle(card);
  return title === "" ? nominal : `${title} (${cardText(card)}) and ${def.reward.gv} GV. A tier lower, as you are far ahead`;
}

/** The feed above which a quest's card is paid a tier lower (the mob reward curve falls under QUEST_FEED_BRAKE there). */
export function questBrakeFeed(): number {
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rewardCurve(mid) < QUEST_FEED_BRAKE) hi = mid; else lo = mid;
  }
  return hi;
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
  quests: QuestCollection, localId: string, serverNow: number, localName = "", planning = false, feed?: number,
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
      reward: questReward(def, feed), status, ready, accepted, acceptance, expired, closed,
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
  quests.forEach((quest) => {
    if (!visibleQuest(quest) || quest.status !== "open") return;
    const def = questDefById(quest.def);
    if (!def) return;
    const accepted = questAccepted(quest, localId);
    out.push({ role: "giver", kind: def.kind, x: quest.x, y: quest.y, accepted });
    if (quest.carrier) {
      const at = positions.get(quest.carrier);
      if (at) out.push({ role: "carrier", kind: def.kind, x: at.x, y: at.y });
    }
    if (!accepted) {
      givers.push({ role: "objective", kind: def.kind, x: quest.x, y: quest.y });
      return;
    }
    if (questReady(quest, def, localId)) {
      objectives.push({ role: "objective", kind: def.kind, x: quest.x, y: quest.y });
      return;
    }
    if (def.kind === "collect" || (def.kind === "fetch" && !quest.carrier)) {
      for (const item of ground.get(quest.id) ?? []) objectives.push({ role: "objective", kind: def.kind, x: item.x, y: item.y });
    } else if (def.kind === "kill" && def.region && map) {
      const region = map.regions.find((r) => r.id === def.region);
      if (region) objectives.push({ role: "objective", kind: def.kind, x: region.pole.x, y: region.pole.y });
    }
  });
  const candidates = objectives.length > 0 ? objectives : givers;
  if (local && candidates.length > 0) {
    let nearest = candidates[0]!;
    let best = (nearest.x - local.x) ** 2 + (nearest.y - local.y) ** 2;
    for (let i = 1; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      const distance = (candidate.x - local.x) ** 2 + (candidate.y - local.y) ** 2;
      if (distance < best) { nearest = candidate; best = distance; }
    }
    out.push(nearest);
  }
  return out;
}
