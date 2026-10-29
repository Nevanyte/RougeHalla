/** All geometry uses the minimap's 150-unit overlay space, independent of DPR. */
export interface MapMark {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
  /** Background camp/route marks may disappear in a crowd; live contacts and clocks get first use of the space. */
  essential?: boolean;
  /** Countdowns can share aligned rows if ordinary nearby placement becomes fragmented. */
  clock?: boolean;
}
export interface PlacedMark<T extends MapMark = MapMark> {
  mark: T;
  x: number;
  y: number;
}
export const MARK_GAP = 1.2;
const SIZE = 150;
const EDGE = 1;
/** Reused across paints; avoid allocating and sorting rings for every moving contact. */
const OFFSETS: { x: number; y: number; radius: number }[] = [];
for (let radius = 2; radius <= SIZE; radius += 2) {
  const ring: { x: number; y: number; radius: number }[] = [];
  for (let d = -radius; d <= radius; d += 2) {
    for (const [x, y] of [[d, -radius], [d, radius], [-radius, d], [radius, d]]) ring.push({ x, y, radius });
  }
  ring.sort((a, b) => a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y);
  OFFSETS.push(...ring);
}

export function marksOverlap(a: PlacedMark, b: PlacedMark, gap = MARK_GAP): boolean {
  return Math.abs(a.x - b.x) < (a.mark.w + b.mark.w) / 2 + gap
    && Math.abs(a.y - b.y) < (a.mark.h + b.mark.h) / 2 + gap;
}

/** Closest vacant slot, in a deterministic order. Never paint two symbols/labels on top of one another. */
export function layoutMinimapMarks<T extends MapMark>(marks: readonly T[]): PlacedMark<T>[] {
  const clocks = marks.filter((m) => m.clock);
  if (clocks.length > 20) return placeMarks(marks, true);
  const nearby = placeMarks(marks, false);
  if (nearby.filter((p) => p.mark.clock).length === clocks.length) return nearby;
  return placeMarks(marks, true);
}

function placeMarks<T extends MapMark>(marks: readonly T[], alignClocks: boolean): PlacedMark<T>[] {
  const placed: PlacedMark<T>[] = [];
  const clocks = marks.filter((m) => m.clock);
  const clockW = Math.max(0, ...clocks.map((m) => m.w)), clockH = Math.max(0, ...clocks.map((m) => m.h));
  for (const mark of [...marks].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))) {
    if (![mark.x, mark.y, mark.w, mark.h].every(Number.isFinite) || mark.w <= 0 || mark.h <= 0) continue;
    const minX = EDGE + mark.w / 2, maxX = SIZE - EDGE - mark.w / 2;
    const minY = EDGE + mark.h / 2, maxY = SIZE - EDGE - mark.h / 2;
    if (maxX < minX || maxY < minY) continue;
    const x = Math.max(minX, Math.min(maxX, mark.x));
    const y = Math.max(minY, Math.min(maxY, mark.y));
    const available = (cx: number, cy: number): PlacedMark<T> | null => {
      if (cx < minX || cx > maxX || cy < minY || cy > maxY) return null;
      const candidate = { mark, x: cx, y: cy };
      return placed.some((p) => marksOverlap(candidate, p)) ? null : candidate;
    };
    let slot: PlacedMark<T> | null = null;
    if (alignClocks && mark.clock) {
      for (let cy = EDGE + clockH / 2; cy <= SIZE - EDGE - clockH / 2; cy += clockH + MARK_GAP + 0.05) {
        for (let cx = EDGE + clockW / 2; cx <= SIZE - EDGE - clockW / 2; cx += clockW + MARK_GAP + 0.05) {
          if (slot && (cx - x) ** 2 + (cy - y) ** 2 >= (slot.x - x) ** 2 + (slot.y - y) ** 2) continue;
          const candidate = available(cx, cy);
          if (candidate) slot = candidate;
        }
      }
    } else slot = available(x, y);
    // Search near the source first. Essential badges can use the whole map if a crowded edge needs it.
    const limit = mark.essential ? SIZE : 12;
    if (!slot) for (const offset of OFFSETS) {
      if (offset.radius > limit) break;
      slot = available(x + offset.x, y + offset.y);
      if (slot) break;
    }
    if (slot) placed.push(slot);
  }
  return placed;
}

export interface MapContact { x: number; y: number; code: number; count?: number }
/** Tight packs become one counted contact; different factions and enemy players stay distinct. */
export function clusterMapContacts(contacts: readonly MapContact[], distance: number): Required<MapContact>[] {
  const groups: Required<MapContact>[] = [];
  for (const contact of [...contacts].sort((a, b) => a.code - b.code || a.x - b.x || a.y - b.y)) {
    if (!Number.isFinite(contact.x + contact.y)) continue;
    const count = contact.count ?? 1;
    const group = groups.find((g) => g.code === contact.code && Math.hypot(g.x - contact.x, g.y - contact.y) <= distance);
    if (!group) groups.push({ ...contact, count });
    else {
      const total = group.count + count;
      group.x = (group.x * group.count + contact.x * count) / total;
      group.y = (group.y * group.count + contact.y * count) / total;
      group.count = total;
    }
  }
  return groups;
}
