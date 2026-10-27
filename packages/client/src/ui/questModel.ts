import {
  FACTIONS, QUEST_ITEM_PREFIX, QUEST_TURN_IN_RANGE, buffDef, questDefById,
  type GameMap, type QuestDef, type QuestKind, type QuestRevealMessage,
} from "@raid/shared";

export interface QuestProgress {
  get(id: string): number | undefined;
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
  expired: boolean;
}

export interface QuestMapBlip extends QuestPosition {
  role: "giver" | "objective" | "carrier";
  kind: QuestKind;
}

const EMPTY_QUESTS: QuestCollection = { forEach: () => {} };
const EMPTY_CONTAINERS: QuestContainerCollection = { forEach: () => {} };

export function questFromReveal(message: QuestRevealMessage): QuestStateLike {
  return {
    id: message.id, def: message.def, x: message.x, y: message.y, status: "open", doneBy: "",
    expiresAt: message.expiresAt, carrier: "", progress: { get: () => undefined },
  };
}

export function expireQuestPreviews(previews: Map<string, QuestStateLike>, serverNow: number): void {
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
  return {
    quests,
    containers: s.containers ?? EMPTY_CONTAINERS,
    hidden: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0,
  };
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

export function questReward(def: QuestDef): string {
  const reward = def.reward as QuestDef["reward"] & { buff?: string; stat?: string };
  const buff = typeof reward.buff === "string" ? buffDef(reward.buff) : undefined;
  const what = buff?.name ?? (reward.stat === "attackSpeed" ? "attack speed" : reward.stat === "moveSpeed" ? "move speed" : reward.stat === "hp" ? "max hp" : "buff");
  return `${numberText(reward.stacks)} ${what} stacks · ${numberText(reward.gv)} GV`;
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
  quests: QuestCollection, localId: string, serverNow: number, localName = "",
): QuestRow[] {
  const rows: QuestRow[] = [];
  quests.forEach((quest) => {
    if (!visibleQuest(quest)) return;
    const def = questDefById(quest.def);
    if (!def) return;
    const ready = questReady(quest, def, localId);
    const expired = quest.status === "expired" || (quest.status === "open" && serverNow >= quest.expiresAt);
    const status = quest.status === "done" ? `Done by ${quest.doneBy || "someone"}` : expired ? "Expired" : ready ? "Return to the giver" : "Open";
    const wonFetch = quest.status === "done" && def.kind === "fetch" && quest.doneBy === localName;
    const progress = def.kind === "fetch" ? `${wonFetch || quest.carrier === localId ? 1 : 0} / 1` : `${numberText(Math.min(def.count, quest.progress.get(localId) ?? 0))} / ${numberText(def.count)}`;
    rows.push({
      id: quest.id, def, quest, objective: questObjective(def), progress,
      time: quest.status === "open" && !expired ? formatQuestTime(quest.expiresAt - serverNow) : "",
      reward: questReward(def), status, ready, expired,
    });
  });
  const group = (row: QuestRow): number => row.quest.status === "open" && !row.expired ? 0 : row.quest.status === "done" ? 1 : 2;
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
  const objectives: QuestMapBlip[] = [];
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
    out.push({ role: "giver", kind: def.kind, x: quest.x, y: quest.y });
    if (quest.carrier) {
      const at = positions.get(quest.carrier);
      if (at) out.push({ role: "carrier", kind: def.kind, x: at.x, y: at.y });
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
  if (local && objectives.length > 0) {
    let nearest = objectives[0]!;
    let best = (nearest.x - local.x) ** 2 + (nearest.y - local.y) ** 2;
    for (let i = 1; i < objectives.length; i++) {
      const candidate = objectives[i]!;
      const distance = (candidate.x - local.x) ** 2 + (candidate.y - local.y) ** 2;
      if (distance < best) { nearest = candidate; best = distance; }
    }
    out.push(nearest);
  }
  return out;
}
