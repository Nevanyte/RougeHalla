import { VISION_TRAIL_MS, type VisionSnapshotMessage } from "@raid/shared";

/** Validate the bounded snapshot before a scene copies it into a tile buffer. */
export function sanitizeVision(raw: unknown): VisionSnapshotMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<VisionSnapshotMessage>;
  if (!Number.isSafeInteger(m.seed) || !Number.isInteger(m.w) || !Number.isInteger(m.h)
    || !(m.w! > 0 && m.h! > 0 && m.w! * m.h! <= 1_048_576)
    || typeof m.at !== "number" || !Number.isFinite(m.at) || m.at < 0
    || !Array.isArray(m.cells) || m.cells.length > m.w! * m.h!) return null;
  const cells: VisionSnapshotMessage["cells"] = [];
  const seen = new Set<number>();
  for (const cell of m.cells) {
    if (!Array.isArray(cell) || cell.length !== 2) return null;
    const [index, expiry] = cell;
    if (!Number.isInteger(index) || index < 0 || index >= m.w! * m.h! || seen.has(index)
      || !Number.isFinite(expiry) || expiry <= m.at || expiry > m.at + VISION_TRAIL_MS) return null;
    seen.add(index);
    cells.push([index, expiry]);
  }
  return { seed: m.seed!, w: m.w!, h: m.h!, at: m.at, cells };
}

/** Holds reconnect data even when the scene is between shutdown and creation. */
export class VisionInbox {
  private latest: VisionSnapshotMessage | null = null;
  private sink: ((snapshot: VisionSnapshotMessage) => void) | null = null;

  readonly push = (raw: unknown): void => {
    const snapshot = sanitizeVision(raw);
    if (!snapshot || (this.latest && snapshot.seed === this.latest.seed && snapshot.at < this.latest.at)) return;
    this.latest = snapshot;
    this.sink?.(snapshot);
  };

  attach(sink: (snapshot: VisionSnapshotMessage) => void): () => void {
    this.sink = sink;
    if (this.latest) sink(this.latest);
    return () => { if (this.sink === sink) this.sink = null; };
  }
}
