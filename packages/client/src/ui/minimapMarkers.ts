import type { GameMap, Vec2 } from "@raid/shared";
import { COLOR_CHEST, COLOR_OUTLINE, COLOR_PLAYER, COLOR_PLAYER_DOWN, COLOR_ROUTE,
  FACTION_CSS, paintCamps, type ChestBlip } from "./mapPainter";
import { layoutMinimapMarks, type MapContact, type MapMark, type PlacedMark } from "./minimapLayout";
import { mapSpan } from "./minimapMath";
import { questKindCss, type QuestMapBlip } from "./questModel";

export const COLOR_ENEMY = "#ff8c91";
export const COLOR_RESPAWN = "#b4c9dc";
type Kind = "player" | "enemy" | "mob" | "chest" | "respawn" | "camp" | "quest" | "stop";
export interface TacticalMark extends MapMark {
  kind: Kind;
  color: string;
  text?: string;
  elite?: boolean;
  camp?: GameMap["camps"][number];
  state?: number;
  quest?: QuestMapBlip;
  next?: boolean;
}
export interface RespawnBlip extends Vec2 { left: number }
export interface MarkerInputs {
  player?: Vec2;
  alive: boolean;
  mobs: readonly MapContact[];
  enemies: readonly Vec2[];
  chests: readonly ChestBlip[];
  respawns: readonly RespawnBlip[];
  camps: GameMap["camps"];
  campStates: readonly number[];
  quests: readonly QuestMapBlip[];
  stops: readonly Vec2[];
  next: number;
}

/** Badge text uses a tabular font and explicit margins; the full text, icon, stroke and pulse fit in its reserved box. */
export function minimapMarks(input: MarkerInputs): PlacedMark<TacticalMark>[] {
  const k = 150 / mapSpan();
  const marks: TacticalMark[] = [];
  const add = (kind: Kind, key: string, at: Vec2, w: number, h: number, priority: number, color: string,
    extra: Partial<TacticalMark> = {}): void => {
    marks.push({ kind, key: `${kind}:${key}`, x: at.x * k, y: at.y * k, w, h, priority, color, ...extra });
  };
  if (input.player) add("player", "self", input.player, 8, 8, 100, input.alive ? COLOR_PLAYER : COLOR_PLAYER_DOWN, { essential: true, pinned: true });
  input.enemies.forEach((p, i) => add("enemy", String(i), p, 9, 9, 95, COLOR_ENEMY, { essential: true, pinned: true }));

  input.quests.forEach((q, i) => add("quest", String(i), q, q.tracked ? 16 : 8, q.tracked ? 11 : 8,
    q.tracked ? 90 : 55, questKindCss(q.kind), { quest: q, text: q.tracked ? "GO" : undefined, essential: q.tracked }));
  const clocks = (kind: "chest" | "respawn", blips: readonly ChestBlip[], priority: number, color: string): void => {
    blips.forEach((b, i) => {
      const seconds = Math.max(0, Math.ceil(b.left));
      const text = String(seconds);
      // Reserve the same collision box as the countdown changes, so digits never move its anchor.
      add(kind, String(i), b, 24, 12, priority, color, { text, essential: true, clock: true });
    });
  };
  clocks("chest", input.chests, 110, COLOR_CHEST);
  // A camp has one badge: loot lifetime while the chest is up, then its public respawn clock.
  const respawns = input.respawns.filter((r) => !input.chests.some((c) => Math.hypot(c.x - r.x, c.y - r.y) < 1));
  clocks("respawn", respawns, 110, COLOR_RESPAWN);

  input.mobs.forEach((p, i) => marks.push({ kind: "mob", key: `mob:${i}`, x: p.x, y: p.y,
    w: p.code % 2 ? 7 : 5.5, h: p.code % 2 ? 7 : 5.5, priority: 65, essential: true, pinned: true,
    color: FACTION_CSS[(p.code >> 1) - 1] ?? "#b1bfc5", elite: p.code % 2 === 1 }));
  input.stops.forEach((p, i) => add("stop", String(i), p, i === input.next ? 10 : 7, i === input.next ? 10 : 7,
    40, COLOR_ROUTE, { next: i === input.next }));
  input.camps.forEach((camp, i) => {
    // Contacts and clocks replace the background camp symbol at that spot.
    if (marks.some((m) => !m.pinned && m.kind !== "stop" && Math.hypot(m.x - camp.x * k, m.y - camp.y * k) < 8)) return;
    add("camp", String(i), camp, 11, 17, 10, "", { camp, state: input.campStates[i] ?? 0 });
  });
  return layoutMinimapMarks(marks);
}

const TAU = Math.PI * 2;
/** The dynamic layer shares the exact bounds used by the collision solver and the route's cutout mask. */
export function paintMinimapMarks(ctx: CanvasRenderingContext2D, marks: readonly PlacedMark<TacticalMark>[], px: number, pulse: number): void {
  for (const p of [...marks].sort((a, b) => {
    // Timer labels and other static markers keep their anchors; draw pinned actors last so overlap never conceals their locations.
    if (a.mark.pinned !== b.mark.pinned) return a.mark.pinned ? 1 : -1;
    return a.mark.priority - b.mark.priority;
  })) {
    const m = p.mark, x = p.x * px, y = p.y * px;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineWidth = px;
    ctx.strokeStyle = COLOR_OUTLINE;
    ctx.fillStyle = m.color;
    if (m.kind === "camp" && m.camp) {
      paintCamps(ctx, [{ ...m.camp, x: x, y: y }], 1, px * 0.8, [m.state ?? 0]);
    } else if (m.kind === "chest" || m.kind === "respawn") {
      const ix = x - 7 * px;
      ctx.fillStyle = m.color;
      if (m.kind === "chest") {
        ctx.globalAlpha = 0.45 + 0.45 * (1 - pulse);
        ctx.beginPath(); ctx.arc(ix, y, (3.4 + 1.2 * pulse) * px, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(ix, y, 2 * px, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(ix - 1.5 * px, y - 0.6 * px); ctx.lineTo(ix + 1.5 * px, y - 0.6 * px); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(ix, y, 2 * px, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ix, y - 1.3 * px); ctx.lineTo(ix, y); ctx.lineTo(ix + px, y); ctx.stroke();
      }
      ctx.font = `700 ${8 * px}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 2.5 * px;
      ctx.strokeStyle = COLOR_OUTLINE;
      ctx.strokeText(m.text ?? "", x + 2.5 * px, y);
      ctx.fillStyle = m.color;
      ctx.fillText(m.text ?? "", x + 2.5 * px, y);
    } else if (m.text) {
      const w = (m.w - 1.5) * px, h = (m.h - 1.5) * px;
      ctx.fillStyle = "#0b141cef";
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = m.color;
      const textOnly = m.kind === "quest";
      if (!textOnly) {
        const ix = x - w / 2 + 3 * px;
        if (m.kind === "enemy") {
          ctx.beginPath(); ctx.moveTo(ix, y - 2 * px); ctx.lineTo(ix + 1.6 * px, y);
          ctx.lineTo(ix, y + 2 * px); ctx.lineTo(ix - 1.6 * px, y); ctx.closePath(); ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(ix, y, 1.5 * px, 0, TAU); ctx.fill();
        }
      }
      ctx.font = `700 ${8 * px}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = m.color;
      ctx.fillText(m.text ?? "", x + (textOnly ? 0 : 2.5 * px), y + 0.3 * px);
    } else if (m.kind === "enemy" || m.kind === "quest") {
      const r = (m.kind === "enemy" ? 3.7 : 2.8) * px;
      ctx.beginPath();
      if (m.quest?.role === "carrier") ctx.rect(x - r, y - r, r * 2, r * 2);
      else if (m.quest?.role === "objective") ctx.arc(x, y, r, 0, TAU);
      else {
        ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      }
      if (m.quest?.accepted === false) { ctx.strokeStyle = m.color; ctx.stroke(); }
      else { ctx.fill(); ctx.stroke(); }
      if (m.kind === "enemy") {
        ctx.fillStyle = "#fff4ed";
        ctx.fillRect(x - 0.65 * px, y - 0.65 * px, 1.3 * px, 1.3 * px);
      }
    } else {
      const r = (m.kind === "player" ? 3.1 : m.kind === "stop" ? (m.next ? 3.9 : 2.5) : m.elite ? 2.8 : 2.1) * px;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      if (m.kind !== "stop" || m.next) ctx.fill();
      ctx.strokeStyle = m.elite ? "#ffd54f" : m.kind === "stop" ? COLOR_ROUTE : COLOR_OUTLINE;
      ctx.stroke();
      if (m.kind === "player") {
        ctx.strokeStyle = "#e4fff1";
        ctx.lineWidth = px * 0.65;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
