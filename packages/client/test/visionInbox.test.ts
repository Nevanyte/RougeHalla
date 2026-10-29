import { describe, expect, it } from "vitest";
import { VISION_TRAIL_MS, type VisionSnapshotMessage } from "@raid/shared";
import { sanitizeVision, VisionInbox } from "../src/net/visionInbox";

const snapshot = (at = 100): VisionSnapshotMessage => ({
  seed: 7, w: 4, h: 3, at, cells: [[0, at + 1], [11, at + VISION_TRAIL_MS]],
});

describe("private reconnect vision inbox", () => {
  it("buffers the latest snapshot before scene creation and streams reconnects", () => {
    const inbox = new VisionInbox();
    inbox.push(snapshot());
    const got: VisionSnapshotMessage[] = [];
    const detach = inbox.attach((m) => got.push(m));
    inbox.push(snapshot(200));
    inbox.push(snapshot(150));
    expect(got).toEqual([snapshot(), snapshot(200)]);
    detach();
    inbox.push(snapshot(300));
    expect(got).toHaveLength(2);
    inbox.attach((m) => got.push(m));
    expect(got.at(-1)).toEqual(snapshot(300));
  });

  it("an old scene cannot detach its replacement", () => {
    const inbox = new VisionInbox();
    const detachOld = inbox.attach(() => {});
    const got: VisionSnapshotMessage[] = [];
    inbox.attach((m) => got.push(m));
    detachOld();
    inbox.push(snapshot());
    expect(got).toEqual([snapshot()]);
  });

  it("copies valid cells and accepts an empty trail", () => {
    const original = snapshot();
    const parsed = sanitizeVision(original)!;
    original.cells[0]![1] = 9999;
    expect(parsed.cells[0]).toEqual([0, 101]);
    expect(sanitizeVision({ ...snapshot(), cells: [] })?.cells).toEqual([]);
  });

  it.each([
    null, {}, { ...snapshot(), w: 0 }, { ...snapshot(), h: 1.2 },
    { ...snapshot(), w: 1_048_577 }, { ...snapshot(), at: NaN }, { ...snapshot(), at: -1 },
    { ...snapshot(), seed: Infinity }, { ...snapshot(), cells: [[-1, 200]] },
    { ...snapshot(), cells: [[12, 200]] }, { ...snapshot(), cells: [[0.5, 200]] },
    { ...snapshot(), cells: [[0, 100]] }, { ...snapshot(), cells: [[0, Infinity]] },
    { ...snapshot(), cells: [[0, 101 + VISION_TRAIL_MS]] },
    { ...snapshot(), cells: [[0, 200], [0, 300]] }, { ...snapshot(), cells: [[0]] },
  ])("rejects malformed or overlong trail data (%#)", (raw) => {
    expect(sanitizeVision(raw)).toBeNull();
  });
});
