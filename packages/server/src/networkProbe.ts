import { monitorEventLoopDelay } from "node:perf_hooks";
import type WebSocket from "ws";

export const NETWORK_PROBE_PATH = "/_diagnostics/net/origin";
const MAGIC = 0x52484c50;
const active = new Set<WebSocket>();
/** A transport-only echo, kept separate from room creation, game updates and account storage. */
export function attachNetworkProbe(socket: WebSocket & { pingCount: number }): void {
  if (active.size >= 4) { socket.close(1013, "probe capacity reached"); return; }
  active.add(socket);
  socket.pingCount = 0;
  socket.on("pong", () => { socket.pingCount = 0; });
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let count = 0;
  const timeout = setTimeout(() => socket.close(1000, "probe complete"), 60_000);
  timeout.unref();
  const cleanup = () => { clearTimeout(timeout); loop.disable(); active.delete(socket); };
  socket.once("close", cleanup);
  socket.once("error", cleanup);
  socket.on("message", (data, binary) => {
    const start = performance.now();
    if (!binary || !Buffer.isBuffer(data) || data.length !== 8 || data.readUInt32LE(0) !== MAGIC || ++count > 256) {
      socket.close(1008, "invalid probe");
      return;
    }
    const reply = Buffer.allocUnsafe(32);
    data.copy(reply, 0);
    // The histogram includes its nominal 10ms sampling period: report only the overshoot.
    reply.writeDoubleLE(Number.isFinite(loop.percentile(95)) ? Math.max(0, loop.percentile(95) / 1e6 - 10) : 0, 16);
    reply.writeDoubleLE(socket.bufferedAmount, 24);
    reply.writeDoubleLE(performance.now() - start, 8);
    socket.send(reply, { binary: true });
  });
}
