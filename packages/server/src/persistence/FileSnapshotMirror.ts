import fs from "node:fs";
import type { RemoteSnapshotSink } from "./RemoteSnapshot";

/** Best-effort learning snapshots are separate from the immediately durable player account store. */
export function mirrorSnapshotFile(file: string, sink: RemoteSnapshotSink, intervalMs = 30_000) {
  let saved = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  let queue = Promise.resolve();
  let closing: Promise<void> | undefined;
  const flush = (): Promise<void> => {
    queue = queue.catch(() => {}).then(async () => {
      let json: string;
      try { json = await fs.promises.readFile(file, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      if (json === saved) return;
      await sink.save(json);
      saved = json;
    });
    return queue;
  };
  const timer = setInterval(() => {
    void flush().catch(() => console.error("[bot-stats] remote snapshot failed; retrying"));
  }, intervalMs);
  timer.unref();
  return {
    flush,
    close(): Promise<void> {
      clearInterval(timer);
      return closing ??= flush();
    },
  };
}
