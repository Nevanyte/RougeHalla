import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import {
  LEADERBOARD_DEFAULT_LIMIT, LEADERBOARD_MAX_MONTHS, MONTH_RE, PROFILE_RE, PROFILE_TOKEN_HEADER, ROOM_NAME, TRAINING_ROOM_NAME,
  monthKey,
  type LeaderboardResponse, type ProfileDTO, type ProfileResponse, type ShopError, type ShopErrorCode, type ShopResponse,
} from "@raid/shared";
import type { BotStatsStoreApi } from "./bots/brain/types";
import { createBotStatsStore } from "./bots/learning/BotStatsStore";
import { loadConfig, type ServerConfig } from "./config";
import {
  JsonProfileStore, ProfileForbiddenError, type ProfileRecord, type ProfileStore, type ShopOutcome,
} from "./persistence/ProfileStore";
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
  return {
    name: r.name, gv: r.gv, gvLifetime: r.gvLifetime, gvByMonth: r.gvByMonth, stats: r.stats, cosmetics: r.cosmetics,
    achievements: r.achievements, progress: r.progress,
  };
}

/** HTTP status and player-facing text for each shop refusal. */
const SHOP_ERRORS: Record<ShopErrorCode, { status: number; error: string }> = {
  forbidden: { status: 403, error: "profile belongs to someone else" },
  bad_request: { status: 400, error: "bad request" },
  unknown_cosmetic: { status: 404, error: "unknown cosmetic" },
  unknown_slot: { status: 400, error: "unknown slot" },
  not_for_sale: { status: 409, error: "not for sale" },
  already_owned: { status: 409, error: "already owned" },
  insufficient_gv: { status: 402, error: "not enough GV" },
  not_owned: { status: 409, error: "not owned" },
  slot_mismatch: { status: 400, error: "that item does not go in that slot" },
};

function sendShopError(res: Response, code: ShopErrorCode, extra: { need?: number; have?: number } = {}): void {
  const { status, error } = SHOP_ERRORS[code];
  const body: ShopError = { error, code, ...extra };
  res.status(status).json(body);
}

/** The shop's bodies are a few dozen bytes; anything bigger is not from the game client. */
const SHOP_BODY_LIMIT = "1kb";
const parseShopBody = express.json({ limit: SHOP_BODY_LIMIT, type: "application/json" });

/** A malformed, oversized or mislabelled body is the caller's mistake, not a server error, and never an HTML page. */
const shopBodyError: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 400;
  const body: ShopError = { error: status === 413 ? "request too large" : "malformed request", code: "bad_request" };
  res.set("Cache-Control", "no-store");
  res.status(status).json(body);
};

/** Anything that fails outside a route's own handling: a caller's mistake (4xx) is named, anything else is hidden and logged. */
const apiError: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error("[server] unhandled API error:", err);
  res.set("Cache-Control", "no-store");
  res.status(status).json({ error: status === 500 ? "internal error" : "bad request" });
};

/** Only a JSON body is read: a form post or a bare string never reaches the parser. */
const requireJson: RequestHandler = (req, res, next) => {
  if (req.is("application/json")) {
    next();
    return;
  }
  res.set("Cache-Control", "no-store");
  res.status(415).json({ error: "expected application/json", code: "bad_request" } satisfies ShopError);
};

/** Express 5 serves HEAD through GET handlers; a mutating route accepts POST (and the CORS preflight) only. */
const postOnly: RequestHandler = (req, res, next) => {
  if (req.method === "POST") {
    next();
    return;
  }
  res.set({ Allow: "POST, OPTIONS", "Cache-Control": "no-store" });
  res.status(405).json({ error: "method not allowed" });
};

/**
 * A shop or wardrobe endpoint. The profile token is checked by the store itself, in the same synchronous step as the
 * change, so nothing here can mutate without it. A name that is malformed, a body that isn't an object and an
 * unknown profile all answer without touching the store.
 */
function shopRoute(
  store: ProfileStore,
  run: (name: string, token: string, body: Record<string, unknown>) => ShopOutcome,
): RequestHandler {
  return (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    const name = req.params.name;
    const body: unknown = req.body;
    if (typeof name !== "string" || !PROFILE_RE.test(name)) {
      res.status(400).json({ error: "invalid profile name", code: "bad_request" } satisfies ShopError);
      return;
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      sendShopError(res, "bad_request");
      return;
    }
    try {
      const outcome = run(name, req.get(PROFILE_TOKEN_HEADER) ?? "", body as Record<string, unknown>);
      if (!outcome.ok) {
        sendShopError(res, outcome.code, { need: outcome.need, have: outcome.have });
        return;
      }
      const reply: ShopResponse = { profile: toProfileDTO(outcome.record) };
      res.json(reply);
    } catch (err) {
      console.error("[server] shop request failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  };
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

/**
 * What the fill bots learn across runs (docs/BOTS.md 6.2): one store for the process, in its own file next to the profile file
 * (BOT_STATS_FILE moves it, "off" turns it off). None when there are no fill bots to learn. It is told never to use the profile
 * file, and a problem with it costs the bots their memory, never the server.
 */
function createBotStats(config: ServerConfig): BotStatsStoreApi | null {
  const { fillTo, statsFile } = config.bots;
  if (fillTo <= 0 || statsFile === "") return null;
  const file = statsFile ?? path.join(path.dirname(config.stashFile), "bot-stats.json");
  try {
    return createBotStatsStore(file, { forbid: [config.stashFile] });
  } catch (err) {
    console.error("[server] the bots will not learn:", err);
    return null;
  }
}

export function createServer(config: ServerConfig = loadConfig()) {
  const store: ProfileStore = new JsonProfileStore(config.stashFile);
  const profiles = new ActiveProfiles();
  const botStats = createBotStats(config);
  RaidRoom.ctx = { config, store, profiles, botStats };
  allowProfileTokenInPreflight();
  const server = defineServer({
    transport: new WebSocketTransport(),
    greet: false,
    // The handler's options win over the client's (Colyseus merges them that way), so the mode is the server's choice:
    // the arena handler can't be talked into creating a training room, and the training one can't create an arena.
    rooms: {
      [ROOM_NAME]: defineRoom(RaidRoom, { mode: "arena" }),
      [TRAINING_ROOM_NAME]: defineRoom(RaidRoom, { mode: "training" }),
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
      app.all("/api/profile/:name/purchase", postOnly);
      app.all("/api/profile/:name/equip", postOnly);

      // Shop and wardrobe. The token header is mandatory (the store refuses without it) and the client's word is never
      // taken for a price, a balance or ownership: only the cosmetic id, and the slot for equip, come from the body.
      app.post(
        "/api/profile/:name/purchase", requireJson, parseShopBody,
        shopRoute(store, (name, token, body) => store.purchase(name, token, body.id)), shopBodyError,
      );
      app.post(
        "/api/profile/:name/equip", requireJson, parseShopBody,
        shopRoute(store, (name, token, body) => store.equip(name, token, body.slot, body.id)), shopBodyError,
      );

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

      // Public: names, equipped titles and monthly GV of the top rows only. `month` defaults to the current UTC month; a
      // malformed one is an error, but a malformed `limit` just gets the default (the store clamps whatever integer it
      // is). An optional `name` adds that profile's own place in the month's ranking, for its owner (token header).
      app.get("/api/leaderboard", (req, res) => {
        res.set("Cache-Control", "no-store");
        const { month: rawMonth, limit: rawLimit, name: rawName } = req.query;
        const month = rawMonth === undefined ? monthKey(Date.now()) : rawMonth;
        if (typeof month !== "string" || !MONTH_RE.test(month)) {
          res.status(400).json({ error: "invalid month, expected YYYY-MM" });
          return;
        }
        const limit = typeof rawLimit === "string" && /^[+-]?\d+$/.test(rawLimit) ? Number(rawLimit) : LEADERBOARD_DEFAULT_LIMIT;
        const body: LeaderboardResponse = {
          month, entries: store.leaderboard(month, limit), months: store.leaderboardMonths(LEADERBOARD_MAX_MONTHS),
        };
        // Only the named profile's owner gets its place: the board stops at LEADERBOARD_MAX_LIMIT rows, and without the
        // token anyone could otherwise follow any callsign's GV month by month. No token or a wrong one: no `you`, no error.
        if (typeof rawName === "string" && PROFILE_RE.test(rawName) && store.verifyToken(rawName, req.get(PROFILE_TOKEN_HEADER) ?? "")) {
          const you = store.leaderboardRank(month, rawName);
          if (you) body.you = you;
        }
        res.json(body);
      });

      // Last under /api: anything unmatched, and any error raised before a handler ran (Express decodes route params
      // first, so a malformed %-escape in a name never reaches ours), answers JSON. Express's own page would carry a stack
      // trace with filesystem paths, since the server doesn't run with NODE_ENV=production.
      app.use("/api", (_req, res) => {
        res.set("Cache-Control", "no-store");
        res.status(404).json({ error: "not found" });
      });
      app.use("/api", apiError);
    },
  });
  // Runs after every room is disposed (their onLeave handlers have settled), also on SIGINT/SIGTERM. The final flush,
  // then the profile file's lock goes, so the next server (a deploy, a tsx-watch restart) can take the file.
  server.onShutdown(async () => {
    try {
      await store.close();
    } catch (err) {
      console.error("[server] could not flush the profiles on shutdown:", err);
    }
    botStats?.close();
  });
  if (config.latencyMs > 0) server.simulateLatency(config.latencyMs);

  /** Shuts the server down without exiting the process and resolves once the profiles are on disk. */
  async function stop(): Promise<void> {
    try {
      await server.gracefullyShutdown(false);
    } finally {
      await store.close();
      botStats?.close();
    }
  }
  return Object.assign(server, { store, profiles, botStats, stop });
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
