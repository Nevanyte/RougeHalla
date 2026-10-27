import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { Encoder } from "@colyseus/schema";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import {
  LEADERBOARD_DEFAULT_LIMIT, LEADERBOARD_MAX_MONTHS, MONTH_RE, PASSCODE_HEADER, PROFILE_RE, PROFILE_TOKEN_HEADER, ROOM_NAME,
  TRAINING_ROOM_NAME, monthKey,
  type LeaderboardResponse, type ProfileDTO, type ProfileResponse, type ShopError, type ShopErrorCode, type ShopResponse,
} from "@raid/shared";
import type { BotStatsStoreApi } from "./bots/brain/types";
import { createBotStatsStore } from "./bots/learning/BotStatsStore";
import { loadConfig, type ServerConfig } from "./config";
import { clientAddress, stampClientAddress } from "./guards/clientIp";
import { corsOrigin } from "./guards/cors";
import { PASSCODE_REQUIRED, PASSCODE_THROTTLED, PasscodeGate } from "./guards/passcode";
import { RoomCounter } from "./guards/roomCounter";
import { KeyedTokenBuckets } from "./guards/tokenBucket";
import { NewProfileLimiter } from "./guards/windowLimiter";
import { MAP_POOL_TARGET, MapPool } from "./mapPool";
import { installNetSim, netSimEnabled, type NetSimParams } from "./net/netSim";
import {
  JsonProfileStore, ProfileForbiddenError, type ProfileRecord, type ProfileStore, type ShopOutcome,
} from "./persistence/ProfileStore";
import { ActiveProfiles, RaidRoom } from "./rooms/RaidRoom";

/**
 * The schema encoder's buffer, per room (Colyseus' default is 16 KB). A 136x136 run's state is larger: the camps, the roster and
 * about 160 mobs placed in one tick, and a joiner's first full sync is about 23 KB. The encoder grows its buffer on overflow and
 * works, but logs a warning once in every room that does, so the buffer is sized for the state instead. 64 KB holds the largest
 * state measured with room to spare; a room pays it once, as one allocation, and a bigger state still grows it. It must be set before
 * the first room is built (an Encoder allocates its buffer when it is constructed), so it is set when this module loads.
 */
export const ENCODER_BUFFER_BYTES = 64 * 1024;
Encoder.BUFFER_SIZE = ENCODER_BUFFER_BYTES;

/** What a cross-origin page may send to /api (the token travels in a header, never a cookie). */
const API_ALLOW_HEADERS = `${PROFILE_TOKEN_HEADER}, ${PASSCODE_HEADER}, content-type`;

/** The new-profile caps count the trailing hour. */
const HOUR_MS = 60 * 60 * 1000;

/** What Colyseus sends on its own, taken once: createServer may run again in one process (the tests do) with another config. */
let pristineCors: Record<string, string> | undefined;

/**
 * Colyseus answers every OPTIONS request itself, before Express sees it, and puts its CORS headers on every response
 * (pages and API included). Its list lacks our token headers, so a browser on another origin (VITE_SERVER_URL) would
 * fail the preflight for GET /api/profile/:name. Extending it is the documented hook for this.
 *
 * In sameOriginOnly mode (production, or when this server serves the client) nothing is sent for an origin that is not in
 * the allowlist, so the page the server serves itself is the only one that can read its answers. Colyseus's defaults carry
 * `Access-Control-Allow-Origin: *` and `Allow-Credentials`, and they are merged under whatever `getCorsHeaders` returns,
 * so those two come out of `DEFAULT_CORS_HEADERS` as well.
 */
function configureCors(config: ServerConfig): void {
  const { controller } = matchMaker;
  const defaults = controller as unknown as { DEFAULT_CORS_HEADERS: Record<string, string> };
  pristineCors ??= { ...defaults.DEFAULT_CORS_HEADERS };
  const base = { ...pristineCors };
  if (config.sameOriginOnly) {
    delete base["Access-Control-Allow-Origin"];
    delete base["Access-Control-Allow-Credentials"];
  }
  defaults.DEFAULT_CORS_HEADERS = base;
  const allowHeaders = `${pristineCors["Access-Control-Allow-Headers"]}, ${PROFILE_TOKEN_HEADER}, ${PASSCODE_HEADER}`;
  controller.getCorsHeaders = (headers) => {
    const origin = corsOrigin(headers.get("origin"), config.sameOriginOnly, config.corsOrigins);
    return {
      "Access-Control-Allow-Headers": allowHeaders,
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      ...(config.sameOriginOnly ? { Vary: "Origin" } : {}),
    };
  };
}

/** Who is asking, for the per-address caps: see guards/clientIp.ts (the socket's peer; Cloudflare's header only from a loopback peer). */
const clientIp = (req: Request): string => clientAddress(req.socket.remoteAddress, req.get("cf-connecting-ip"));

/** Serves the built client (index.html, hashed assets) from the same origin as the API and the websocket. */
function serveClient(app: express.Application, dir: string): void {
  if (!fs.existsSync(path.join(dir, "index.html"))) {
    throw new Error(`CLIENT_DIR ${dir} has no index.html: build the client first (npm run build)`);
  }
  app.use(express.static(dir, {
    setHeaders(res, file) {
      // Vite names everything under assets/ by content hash, so those never change under their name; the page that names them is always re-checked.
      if (file.split(path.sep).includes("assets")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      else if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
      else res.setHeader("Cache-Control", "public, max-age=3600");
    },
  }));
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
 * A profile's shop and wardrobe requests share one token bucket (SHOP_BURST, SHOP_PER_SECOND), checked before the body is
 * read. Only a request that proves the profile's token spends from it, so the map of buckets holds at most one per
 * profile, and anyone else gets the store's own refusal as before.
 */
function shopRateLimit(store: ProfileStore, buckets: KeyedTokenBuckets, config: ServerConfig): RequestHandler {
  return (req, res, next) => {
    const name = req.params.name;
    const limited = config.shopBurst > 0 && config.shopPerSecond > 0 && typeof name === "string"
      && store.verifyToken(name, req.get(PROFILE_TOKEN_HEADER) ?? "") && !buckets.take(name, Date.now());
    if (!limited) {
      next();
      return;
    }
    res.set({ "Retry-After": "1", "Cache-Control": "no-store" });
    res.status(429).json({ error: "too many requests, slow down" });
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

/**
 * The simulator delays and drops every connection, so a server on a public link (sameOriginOnly) refuses to install it:
 * a variable left in the host's shell would slow every friend. ALLOW_NETSIM_WHEN_HOSTING=1 is the explicit override. Either way
 * the log says what happened, once.
 */
function installNetSimUnlessHosting(sim: NetSimParams, config: ServerConfig): (() => void) | null {
  if (!netSimEnabled(sim)) return null;
  const what = `rtt ${sim.rttMs} ms, jitter ${sim.jitterMs} ms, loss ${sim.lossPct}%`;
  if (config.sameOriginOnly && !config.allowNetSimWhenHosting) {
    console.warn(
      `[server] network simulator REFUSED (${what}): this server is hosting a public link, where it would slow every player. ` +
      "Unset COLYSEUS_LATENCY, NET_JITTER_MS and NET_LOSS_PCT, or set ALLOW_NETSIM_WHEN_HOSTING=1 to install it anyway.",
    );
    return null;
  }
  console.log(`[server] network simulator ON (${what})${config.sameOriginOnly ? " while hosting (ALLOW_NETSIM_WHEN_HOSTING)" : ""}`);
  return installNetSim(sim);
}

export function createServer(config: ServerConfig = loadConfig(), opts: { maps?: MapPool } = {}) {
  const store: ProfileStore = new JsonProfileStore(config.stashFile);
  const profiles = new ActiveProfiles();
  // Warmed here, before the first room can ask: the main thread's mapgen tables (the fixed layout and the zone layout, for a fallback) and the worker's queue.
  const maps = (opts.maps ?? new MapPool({ target: config.mapPoolSize ?? MAP_POOL_TARGET })).start();
  const botStats = createBotStats(config);
  const rooms = new RoomCounter({ arena: config.maxArenaRooms, training: config.maxTrainingRooms });
  const passcodeGate = new PasscodeGate(config.passcode, config.passcodeFailsPerMinute, config.passcodeFailsPerMinuteAll);
  RaidRoom.ctx = { config, store, profiles, rooms, passcodeGate, maps, botStats };
  configureCors(config);
  const newProfiles = new NewProfileLimiter(config.maxNewProfilesPerHour, config.maxNewProfilesPerIpPerHour, HOUR_MS);
  const shopBuckets = new KeyedTokenBuckets(config.shopBurst, config.shopPerSecond);
  // Our own http server only to stamp each request with the address the guards count it under (guards/clientIp.ts); it is
  // what WebSocketTransport would have made.
  const httpServer = http.createServer();
  stampClientAddress(httpServer);
  const server = defineServer({
    transport: new WebSocketTransport({ server: httpServer }),
    greet: false,
    // The handler's options win over the client's (Colyseus merges them that way), so the mode is the server's choice:
    // the arena handler can't be talked into creating a training room, and the training one can't create an arena.
    rooms: {
      [ROOM_NAME]: defineRoom(RaidRoom, { mode: "arena" }),
      [TRAINING_ROOM_NAME]: defineRoom(RaidRoom, { mode: "training" }),
    },
    express: (app) => {
      app.disable("x-powered-by");
      // Colyseus has already set its own CORS headers on the response (see configureCors); /api is credential-free, so
      // a wildcard origin is the accurate statement in dev. Hosting for a public link (sameOriginOnly) keeps what
      // Colyseus set: no origin header at all, except for an origin on the allowlist.
      app.use("/api", (_req, res, next) => {
        res.removeHeader("Access-Control-Allow-Credentials");
        if (!config.sameOriginOnly) res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Headers", API_ALLOW_HEADERS);
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
      const shopLimit = shopRateLimit(store, shopBuckets, config);
      app.post(
        "/api/profile/:name/purchase", shopLimit, requireJson, parseShopBody,
        shopRoute(store, (name, token, body) => store.purchase(name, token, body.id)), shopBodyError,
      );
      app.post(
        "/api/profile/:name/equip", shopLimit, requireJson, parseShopBody,
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
          // Claiming a free name is the one thing a stranger can do here, so it is the one thing guarded: the passcode (when
          // the host set one) and a cap on how many callsigns can appear in an hour. Opening an existing profile needs its token.
          const isNew = store.get(name) === undefined;
          const ip = clientIp(req);
          if (isNew) {
            const verdict = passcodeGate.check(req.get(PASSCODE_HEADER), ip, Date.now());
            if (!verdict.ok) {
              if (verdict.blocked) {
                res.set("Retry-After", String(Math.ceil(verdict.retryAfterMs / 1000)));
                res.status(429).json({ error: PASSCODE_THROTTLED, code: "passcode_throttled" });
              } else {
                res.status(401).json({ error: PASSCODE_REQUIRED, code: "passcode_required" });
              }
              return;
            }
            const waitMs = newProfiles.retryAfterMs(ip, Date.now());
            if (waitMs > 0) {
              res.set("Retry-After", String(Math.ceil(waitMs / 1000)));
              res.status(429).json({ error: "too many new callsigns lately, try again later" });
              return;
            }
          }
          const { record, token, created } = store.claim(name, req.get(PROFILE_TOKEN_HEADER));
          if (created) newProfiles.record(ip, Date.now());
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

      // Last of all, so a page can never shadow /api. The websocket upgrade and Colyseus's /matchmake routes are answered
      // before Express sees a request, so they are out of its reach too.
      if (config.clientDir) serveClient(app, config.clientDir);
    },
  });
  // Runs after every room is disposed (their onLeave handlers have settled), also on SIGINT/SIGTERM. The final flush,
  // then the profile file's lock goes, so the next server (a deploy, a tsx-watch restart) can take the file.
  // The profiles go first: the pool's stop() is bounded, but nothing about a worker thread should ever sit in front of
  // the final flush.
  server.onShutdown(async () => {
    try {
      await store.close();
    } catch (err) {
      console.error("[server] could not flush the profiles on shutdown:", err);
    }
    botStats?.close();
    await maps.stop();
  });
  // Our own model (net/netSim.ts) replaces Colyseus's fixed delay. Core also reads COLYSEUS_LATENCY itself when the server
  // starts listening and would stack its delay on ours, so the variable is taken out of the environment here.
  delete process.env.COLYSEUS_LATENCY;
  const sim: NetSimParams = {
    rttMs: config.latencyMs, jitterMs: config.netJitterMs ?? 0, lossPct: config.netLossPct ?? 0, seed: config.netSeed,
  };
  const uninstallNetSim = installNetSimUnlessHosting(sim, config);

  /** Shuts the server down without exiting the process and resolves once the profiles are on disk. */
  async function stop(): Promise<void> {
    try {
      await server.gracefullyShutdown(false);
    } finally {
      uninstallNetSim?.();
      try {
        await store.close();
        botStats?.close();
      } finally {
        await maps.stop();
      }
    }
  }
  return Object.assign(server, { store, profiles, rooms, maps, botStats, stop });
}

export type RaidServer = ReturnType<typeof createServer>;

export async function startServer(config: ServerConfig = loadConfig(), opts: { maps?: MapPool } = {}) {
  const server = createServer(config, opts);
  await server.listen(config.port);
  return server;
}

/**
 * `scripts/playtest.mjs` gives the server a stdin pipe it never writes to and sets RAID_EXIT_ON_STDIN_END. When the pipe
 * ends, the launcher is gone (it was killed or crashed; a normal stop signals the server first), and a server left behind
 * would keep the port and the profile file's lock: so it shuts down the way a SIGTERM does (rooms closed, GV banked,
 * profiles flushed, lock freed). Off unless the flag is set: a stdin that is /dev/null ends at once.
 */
function shutDownWhenStdinEnds(server: RaidServer): void {
  let ended = false;
  const onEnd = () => {
    if (ended) return;
    ended = true;
    console.log("[server] the launcher is gone (its pipe closed): shutting down");
    void server.gracefullyShutdown(true);
  };
  process.stdin.on("end", onEnd);
  process.stdin.on("close", onEnd);
  process.stdin.on("error", onEnd);
  process.stdin.resume(); // reading is what notices the end
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const config = loadConfig();
  startServer(config).then(
    (server) => {
      console.log(`[server] listening on :${config.port}`);
      if (process.env.RAID_EXIT_ON_STDIN_END) shutDownWhenStdinEnds(server);
    },
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
