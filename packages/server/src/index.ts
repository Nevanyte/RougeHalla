import { pathToFileURL } from "node:url";
import { defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { RequestHandler } from "express";
import {
  LEADERBOARD_DEFAULT_LIMIT, MONTH_RE, PROFILE_RE, PROFILE_TOKEN_HEADER, ROOM_NAME, monthKey,
  type LeaderboardResponse, type ProfileDTO, type ProfileResponse,
} from "@raid/shared";
import { loadConfig, type ServerConfig } from "./config";
import { JsonProfileStore, ProfileForbiddenError, type ProfileRecord, type ProfileStore } from "./persistence/ProfileStore";
import { ActiveProfiles, RaidRoom } from "./rooms/RaidRoom";

/** What a cross-origin page may send to /api (the token travels in a header, never a cookie). */
const API_ALLOW_HEADERS = `${PROFILE_TOKEN_HEADER}, content-type`;

/**
 * Colyseus answers every OPTIONS request itself, before Express sees it, with its own header list.
 * That list lacks our token header, so a browser on another origin (VITE_SERVER_URL) would fail the
 * preflight for GET /api/profile/:name. Extending it is the documented hook for this.
 */
function allowProfileTokenInPreflight(): void {
  const { controller } = matchMaker;
  controller.getCorsHeaders = (headers) => ({
    "Access-Control-Allow-Origin": headers.get("origin") || "*",
    "Access-Control-Allow-Headers": `${controller.DEFAULT_CORS_HEADERS["Access-Control-Allow-Headers"]}, ${PROFILE_TOKEN_HEADER}`,
  });
}

/** Field by field, so the record's token can never ride along by accident. */
function toProfileDTO(r: ProfileRecord): ProfileDTO {
  return { name: r.name, gv: r.gv, gvLifetime: r.gvLifetime, gvByMonth: r.gvByMonth, stats: r.stats, cosmetics: r.cosmetics };
}

/**
 * Express 5 serves HEAD through the GET handlers, which for the profile route would claim the name and throw
 * the token away. Anything but GET is refused before it can reach them.
 */
const getOnly: RequestHandler = (req, res, next) => {
  if (req.method === "GET") {
    next();
    return;
  }
  res.set({ Allow: "GET, OPTIONS", "Cache-Control": "no-store" });
  res.status(405).json({ error: "method not allowed" });
};

export function createServer(config: ServerConfig = loadConfig()) {
  const store: ProfileStore = new JsonProfileStore(config.stashFile);
  const profiles = new ActiveProfiles();
  RaidRoom.ctx = { config, store, profiles };
  allowProfileTokenInPreflight();
  const server = defineServer({
    transport: new WebSocketTransport(),
    greet: false,
    rooms: {
      [ROOM_NAME]: defineRoom(RaidRoom),
    },
    express: (app) => {
      // Colyseus has already set its own CORS headers on the response (echoed origin, credentials);
      // /api is credential-free, so a wildcard origin is the accurate statement.
      app.use("/api", (_req, res, next) => {
        res.removeHeader("Access-Control-Allow-Credentials");
        res.set({
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": API_ALLOW_HEADERS,
        });
        next();
      });

      app.get("/api/health", (_req, res) => {
        res.json({ ok: true });
      });

      app.all("/api/profile/:name", getOnly);
      app.all("/api/leaderboard", getOnly);

      // Claims a free name (no token header) or returns the profile for its owner. The response
      // carries this profile's token only, never anyone else's.
      app.get("/api/profile/:name", (req, res) => {
        res.set("Cache-Control", "no-store");
        const name = req.params.name;
        if (typeof name !== "string" || !PROFILE_RE.test(name)) {
          res.status(400).json({ error: "invalid profile name" });
          return;
        }
        try {
          const { record, token, created } = store.claim(name, req.get(PROFILE_TOKEN_HEADER));
          const body: ProfileResponse = { profile: toProfileDTO(record), token, created };
          res.json(body);
        } catch (err) {
          if (err instanceof ProfileForbiddenError) {
            res.status(403).json({ error: "profile belongs to someone else" });
            return;
          }
          console.error("[server] GET /api/profile failed:", err);
          res.status(500).json({ error: "internal error" });
        }
      });

      // Public: names and monthly GV only. `month` defaults to the current UTC month; a malformed one is an
      // error, but a malformed `limit` just gets the default (the store clamps whatever integer it is).
      app.get("/api/leaderboard", (req, res) => {
        res.set("Cache-Control", "no-store");
        const { month: rawMonth, limit: rawLimit } = req.query;
        const month = rawMonth === undefined ? monthKey(Date.now()) : rawMonth;
        if (typeof month !== "string" || !MONTH_RE.test(month)) {
          res.status(400).json({ error: "invalid month, expected YYYY-MM" });
          return;
        }
        const limit = typeof rawLimit === "string" && /^[+-]?\d+$/.test(rawLimit) ? Number(rawLimit) : LEADERBOARD_DEFAULT_LIMIT;
        const body: LeaderboardResponse = { month, entries: store.leaderboard(month, limit) };
        res.json(body);
      });
    },
  });
  // Runs after every room is disposed (their onLeave handlers have settled), also on SIGINT/SIGTERM.
  server.onShutdown(async () => {
    try {
      await store.flush();
    } catch (err) {
      console.error("[server] could not flush the profiles on shutdown:", err);
    }
  });
  if (config.latencyMs > 0) server.simulateLatency(config.latencyMs);

  /** Shuts the server down without exiting the process and resolves once the profiles are on disk. */
  async function stop(): Promise<void> {
    try {
      await server.gracefullyShutdown(false);
    } finally {
      await store.flush();
    }
  }
  return Object.assign(server, { store, profiles, stop });
}

export type RaidServer = ReturnType<typeof createServer>;

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
