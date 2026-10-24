import { afterEach, describe, expect, it, vi } from "vitest";
import type { FxBatch } from "@raid/shared";
import { dropWarner, FX_INBOX_MAX, FxInbox } from "../src/net/fxInbox";

const batch = (t: number): FxBatch => ({ t, l: [[8]] });
const times = (batches: FxBatch[]): number[] => batches.map((b) => b.t);

describe("FxInbox: batches that come before the scene is listening", () => {
  it("holds them, and hands them over in the order they came when the scene attaches", () => {
    const inbox = new FxInbox();
    inbox.push(batch(1));
    inbox.push(batch(2));
    const got: FxBatch[] = [];
    inbox.attach((b) => got.push(b));
    expect(times(got)).toEqual([1, 2]);
  });

  it("passes every later batch straight on", () => {
    const inbox = new FxInbox();
    const got: FxBatch[] = [];
    inbox.attach((b) => got.push(b));
    inbox.push(batch(5));
    inbox.push(batch(6));
    expect(times(got)).toEqual([5, 6]);
  });

  it("hands over what was held before a later one, never after", () => {
    const inbox = new FxInbox();
    inbox.push(batch(1));
    inbox.push(batch(3));
    const got: number[] = [];
    inbox.attach((b) => {
      got.push(b.t);
      if (b.t === 1) inbox.push(batch(4)); // one that arrives while the held ones are being replayed
    });
    expect(got).toEqual([1, 3, 4]);
  });

  it("keeps only the newest FX_INBOX_MAX while nobody listens", () => {
    const inbox = new FxInbox();
    for (let t = 1; t <= FX_INBOX_MAX + 50; t++) inbox.push(batch(t));
    const got: FxBatch[] = [];
    inbox.attach((b) => got.push(b));
    expect(got).toHaveLength(FX_INBOX_MAX);
    expect(got[0]!.t).toBe(51);
    expect(got.at(-1)!.t).toBe(FX_INBOX_MAX + 50);
  });

  it("is closed once the scene lets go of it: nothing is held for a room that is being left", () => {
    const inbox = new FxInbox();
    const got: FxBatch[] = [];
    const detach = inbox.attach((b) => got.push(b));
    detach();
    inbox.push(batch(1));
    expect(got).toEqual([]);
    const again: FxBatch[] = [];
    inbox.attach((b) => again.push(b));
    expect(again).toEqual([]);
  });
});

describe("dropWarner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("says so once in a development build, whatever was dropped after", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dropped = dropWarner(true);
    dropped([4, 9], true);
    dropped([4, 10], true);
    dropped([99], false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/roster/);
    expect(warn.mock.calls[0]![1]).toEqual([4, 9]);
  });

  it("says nothing in a production build", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    dropWarner(false)([4, 9], true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("tells a tuple it cannot read from a roster entry it does not have", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    dropWarner(true)([99], false);
    expect(String(warn.mock.calls[0]![0])).toMatch(/cannot read/);
  });
});
