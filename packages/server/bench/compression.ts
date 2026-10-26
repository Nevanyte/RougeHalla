// What permessage-deflate would do for the websocket: the real encoder's frames (bandwidth.ts) through zlib's raw deflate the way
// a websocket extension does it, per message with a sync flush. Measure only: the transport keeps `perMessageDeflate: false`.
//   npx tsx packages/server/bench/compression.ts [seed=N] [ticks=N]
// Models: "fresh" is one deflate per message with no memory of the last (the extension negotiated with no_context_takeover),
// "takeover" keeps the LZ77 window and the Huffman history across one connection's messages (the default negotiation, what ws does
// per client), and "ws default" is takeover with the ws library's own `threshold` of 1024 bytes, under which a message is sent as it is
// (almost every message of this game is under it). CPU is the process's user+system time per message (`process.cpuUsage`, the
// thread pool's included: ws runs zlib on libuv's pool, so the cost leaves the event loop and adds a hop of latency). The server
// would pay it once per client.
import zlib from "node:zlib";
import { HEAVY_CAMPS, TYPICAL_CAMPS, runBandwidth, type BandwidthOptions } from "./bandwidth";

const KIB = 1024;
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=")) as Array<[string, string]>);

/** One connection's deflate stream: keeps its window between messages, as the extension does. */
async function takeover(frames: Buffer[]): Promise<{ sizes: number[]; cpuUs: number }> {
  const z = zlib.createDeflateRaw({ level: zlib.constants.Z_DEFAULT_COMPRESSION });
  const sizes: number[] = [];
  let pending = 0;
  z.on("data", (d: Buffer) => { pending += d.length; });
  const c0 = process.cpuUsage();
  for (const f of frames) {
    pending = 0;
    z.write(f);
    await new Promise<void>((r) => z.flush(zlib.constants.Z_SYNC_FLUSH, () => r()));
    // RFC 7692 drops the 00 00 ff ff that a sync flush ends with.
    sizes.push(Math.max(1, pending - 4));
  }
  const c = process.cpuUsage(c0);
  z.destroy();
  return { sizes, cpuUs: c.user + c.system };
}

async function run(label: string, o: BandwidthOptions): Promise<void> {
  const frames: Buffer[] = [];
  const r = runBandwidth({
    ...o,
    ...(args.seed ? { seed: Number(args.seed) } : {}),
    ...(args.ticks ? { ticks: Number(args.ticks) } : {}),
    onFrame: (_kind, frame) => { frames.push(Buffer.from(frame)); },
  });
  const sec = r.seconds;
  const raw = frames.reduce((a, f) => a + f.length, 0);

  const c0 = process.cpuUsage();
  const fresh = frames.map((f) => Math.min(f.length, Math.max(1, zlib.deflateRawSync(f, { flush: zlib.constants.Z_SYNC_FLUSH }).length - 4)));
  const freshCpu = process.cpuUsage(c0);
  const tk = await takeover(frames);
  const takeSizes = tk.sizes.map((s, i) => Math.min(s, frames[i]!.length));
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const wsDefault = sum(frames.map((f, i) => (f.length >= 1024 ? takeSizes[i]! : f.length)));
  const sorted = frames.map((f) => f.length).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;

  const kbps = (b: number) => (b / sec / KIB).toFixed(2);
  const cores = (us: number) => (((us / frames.length) * (frames.length / sec) * 8) / 1e6 * 100).toFixed(1);
  console.log(`${label}: ${(r.patchKBps + r.fxKBps).toFixed(2)} KB/s per client with ws headers; ${(frames.length / sec).toFixed(0)} frames/s, payload p50 ${q(0.5)} p95 ${q(0.95)} max ${sorted[sorted.length - 1]} B`);
  console.log(`  raw payload                  ${kbps(raw)} KB/s`);
  console.log(`  fresh deflate per message    ${kbps(sum(fresh))} KB/s (x${(sum(fresh) / raw).toFixed(2)}), ${((freshCpu.user + freshCpu.system) / frames.length).toFixed(0)} us/msg   CPU for 8 clients: ${cores(freshCpu.user + freshCpu.system)}% of a core`);
  console.log(`  context takeover             ${kbps(sum(takeSizes))} KB/s (x${(sum(takeSizes) / raw).toFixed(2)}), ${(tk.cpuUs / frames.length).toFixed(0)} us/msg   CPU for 8 clients: ${cores(tk.cpuUs)}% of a core`);
  console.log(`  ws defaults (threshold 1024) ${kbps(wsDefault)} KB/s (x${(wsDefault / raw).toFixed(2)})`);
}

await run(`typical (${TYPICAL_CAMPS} camps)`, { camps: TYPICAL_CAMPS });
await run(`heavy   (${HEAVY_CAMPS} camps)`, { camps: HEAVY_CAMPS });
await run("idle    (60 mobs asleep)", { camps: 0 });
