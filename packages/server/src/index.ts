import { pathToFileURL } from "node:url";
import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@raid/shared";
import { loadConfig, type ServerConfig } from "./config";
import { RaidRoom } from "./rooms/RaidRoom";

export function createServer(config: ServerConfig = loadConfig()) {
  RaidRoom.ctx = { config };
  const server = defineServer({
    transport: new WebSocketTransport(),
    greet: false,
    rooms: {
      [ROOM_NAME]: defineRoom(RaidRoom),
    },
    express: (app) => {
      app.get("/api/health", (_req, res) => {
        res.json({ ok: true });
      });
    },
  });
  if (config.latencyMs > 0) server.simulateLatency(config.latencyMs);
  return server;
}

export async function startServer(config: ServerConfig = loadConfig()) {
  const server = createServer(config);
  await server.listen(config.port);
  return server;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const config = loadConfig();
  startServer(config).then(
    () => console.log(`[server] listening on :${config.port}`),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
