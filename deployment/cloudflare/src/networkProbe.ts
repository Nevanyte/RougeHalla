/** Tiny, bounded diagnostic frames. These carry no player data and never create a game room. */
export const PROBE_MAGIC = 0x52484c50;
let activeEchoes = 0;
export function networkProbeAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < 32) return false;
  const value = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (value.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
export function networkProbeLayer(path: string): "edge" | "coordinator" | "origin" | null {
  const match = /^\/_diagnostics\/net\/(edge|coordinator|origin)$/.exec(path);
  return match ? match[1] as "edge" | "coordinator" | "origin" : null;
}

export function networkProbeEcho(layer: "edge" | "coordinator"): Response {
  if (activeEchoes >= 8) return new Response("probe capacity reached", { status: 429, headers: { "Cache-Control": "no-store" } });
  activeEchoes++;
  const pair = new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.binaryType = "arraybuffer";
  let count = 0;
  const timeout = setTimeout(() => { release(); try { server.close(1000, "probe complete"); } catch {} }, 60_000);
  let released = false;
  const release = () => { clearTimeout(timeout); if (!released) { released = true; activeEchoes--; } };
  server.addEventListener("close", release);
  server.addEventListener("error", release);
  server.addEventListener("message", (event) => {
    const data = event.data;
    if (!(data instanceof ArrayBuffer) || data.byteLength !== 8 || new DataView(data).getUint32(0, true) !== PROBE_MAGIC || ++count > 256) {
      server.close(1008, "invalid probe");
      return;
    }
    try { server.send(data); } catch { release(); try { server.close(1011, "probe closed"); } catch {} }
  });
  server.accept();
  return new Response(null, { status: 101, webSocket: client, headers: { "X-Rougehalla-Probe-Layer": layer, "Cache-Control": "no-store" } });
}
