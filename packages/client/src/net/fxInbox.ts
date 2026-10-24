// The `fxs` batches a room sends before the scene is there to read them. The SDK drops a message nobody has a handler for,
// and the scene only starts on the first Phaser frame after the first state (a hidden tab does not draw frames at all), yet
// the server's first words to a client that joins or reconnects while arrows are flying are a batch announcing them. So main.ts
// registers `push` the moment it has the room, and the scene takes over with `attach`.
import type { FxBatch, FxDropped } from "@raid/shared";

/** At most this many batches are kept while nobody listens (a minute at the fullest rate: the scene drops the old ones anyway). */
export const FX_INBOX_MAX = 1200;

export class FxInbox {
  private held: FxBatch[] | null = [];
  private sink: ((batch: FxBatch) => void) | null = null;

  /** The room's `fxs` handler. */
  readonly push = (batch: FxBatch): void => {
    if (this.sink) this.sink(batch);
    else if (this.held) {
      this.held.push(batch);
      if (this.held.length > FX_INBOX_MAX) this.held.shift();
    }
  };

  /**
   * Hands `sink` every batch held so far, in the order they arrived, and every later one as it arrives. Returns the
   * function that stops it: the inbox is then closed for good (it is the room's, and the room is being left).
   */
  attach(sink: (batch: FxBatch) => void): () => void {
    const held = this.held ?? [];
    // One that arrives while this runs queues up behind the held ones, so the order stays the order of arrival.
    while (held.length > 0) sink(held.shift()!);
    this.held = null;
    this.sink = sink;
    return () => {
      if (this.sink === sink) this.sink = null;
    };
  }
}

/**
 * For `unpackFx`: says, once and in development builds only, that a tuple was skipped. An event lost this way (a death, a hit,
 * a projEnd) shows as nothing happening, so without this nobody would know.
 */
export function dropWarner(dev: boolean = import.meta.env.DEV): FxDropped {
  let warned = false;
  return (tuple, unresolved) => {
    if (!dev || warned) return;
    warned = true;
    console.warn(
      unresolved
        ? "fx dropped: it names a roster entry this client does not have (a server or ordering bug)"
        : "fx dropped: a tuple this client cannot read (a newer server?)",
      tuple,
    );
  };
}
