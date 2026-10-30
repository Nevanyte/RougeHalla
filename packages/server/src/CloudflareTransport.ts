import { WebSocketTransport } from "@colyseus/ws-transport";

/** An intermediary may answer control pings itself; normal game traffic also proves liveness. */
export class CloudflareTransport extends WebSocketTransport {
  readonly diagnostics = { connections: 0, pongs: 0, closed: [] as Array<{ code: number; messages: number; pongs: number; pendingPings: number; durationMs: number }> };

  constructor(options: ConstructorParameters<typeof WebSocketTransport>[0]) {
    super(options);
    this.wss.on("connection", (socket) => {
      const raw = socket as typeof socket & { pingCount: number };
      this.diagnostics.connections++;
      const opened = performance.now();
      let messages = 0;
      let pongs = 0;
      raw.on("message", () => { messages++; raw.pingCount = 0; });
      raw.on("pong", () => { pongs++; this.diagnostics.pongs++; });
      raw.on("close", (code) => {
        this.diagnostics.connections--;
        this.diagnostics.closed.push({ code, messages, pongs, pendingPings: raw.pingCount, durationMs: Math.round(performance.now() - opened) });
        if (this.diagnostics.closed.length > 10) this.diagnostics.closed.shift();
      });
    });
  }
}
