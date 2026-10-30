import { DurableObject } from "cloudflare:workers";
import { serverBuild } from "../build-meta.json";
import { containerReleaseLabel, ensureContainerImage, isReadyServerBuild } from "./containerLifecycle";
import { handleBotSnapshot, handleProfileSnapshot } from "./profileSnapshots";

const ROOM_NAME = "rougehalla-controller-v2";
const CONTROLLER_VERSION = "8";
const PORT = 2567;
const CONTAINER_INSTANCE = "standard-1";
const ARENA_LIMIT = "1";
const TRAINING_LIMIT = "2";
const STARTUP_TIMEOUT_MS = 75_000;
const INACTIVITY_TIMEOUT_MS = 10 * 60_000;
const RELEASE_HEADER = "X-Rougehalla-Controller-Release";
let lastContainerErrorLogAt = 0;

interface Env {
  GAME_CONTAINER: DurableObjectNamespace<PublicGameContainer>;
  PROFILES: R2Bucket;
  ASSETS: Fetcher;
  MATCHMAKE_LIMITER: RateLimit;
  PROFILE_SNAPSHOT_TOKEN?: string;
  PROFILE_EPOCH?: string;
  GAME_MAINTENANCE?: string;
}

function controllerRelease(env: Env): Promise<string> {
  return containerReleaseLabel(serverBuild, `${CONTROLLER_VERSION}:${CONTAINER_INSTANCE}:${ARENA_LIMIT}:${TRAINING_LIMIT}:${env.PROFILE_EPOCH ?? ""}:${env.GAME_MAINTENANCE ?? "0"}`);
}

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, no-transform");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function proxyRequest(request: Request, url: URL): Request {
  const forwarded = new Request(url, request);
  const headers = forwarded.headers;
  headers.delete("host");
  // Never forward client-provided proxy metadata. Cloudflare replaces CF-Connecting-IP at its edge;
  // copy that trusted value into the one-hop header the Express app is configured to trust.
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-proto");
  headers.delete("cf-connecting-ip");
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) {
    headers.set("X-Forwarded-For", clientIp);
    headers.set("CF-Connecting-IP", clientIp);
  }
  headers.set("X-Forwarded-Host", new URL(request.url).host);
  headers.set("X-Forwarded-Proto", new URL(request.url).protocol.slice(0, -1));
  return forwarded;
}

function withCacheControl(response: Response, value: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function staticAsset(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  const response = await env.ASSETS.fetch(request);
  if (!response.ok) return withCacheControl(response, "no-store");
  if (path === "/" || path === "/index.html") return withCacheControl(response, "no-cache");
  const hashed = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(path);
  return withCacheControl(response, hashed ? "public, max-age=31536000, immutable" : "no-cache");
}

export class GameContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;
  private currentImage: string | undefined;
  private currentBuild: string | undefined;
  private exitMonitor: Promise<void> | undefined;
  private stopRequested = false;
  private startupPhase = "idle";
  private retired = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = this.ctx.container;
    if (container?.running) {
      void this.ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
      this.watchContainerExit(container);
    }
  }

  private watchContainerExit(container: Container): Promise<void> {
    if (!this.exitMonitor) {
      let monitored: Promise<void>;
      monitored = Promise.resolve()
        .then(() => container.monitor())
        .then(() => undefined, () => undefined)
        .finally(() => { if (this.exitMonitor === monitored) this.exitMonitor = undefined; });
      this.exitMonitor = monitored;
      this.ctx.waitUntil(monitored);
    }
    return this.exitMonitor;
  }

  private async retireController(): Promise<void> {
    this.retired = true;
    const container = this.ctx.container;
    if (container?.running) {
      const exit = this.watchContainerExit(container);
      try { this.requestContainerStop(container); } catch { /* already exiting */ }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([exit, new Promise<void>((resolve) => { timer = setTimeout(resolve, 15_000); })]);
      } finally { clearTimeout(timer); }
      if (container.running) return;
    }
    // Release a pinned old coordinator only after Node has flushed its snapshots and exited.
    this.ctx.abort("Game controller release changed");
  }

  private requestContainerStop(container: Container): void {
    if (this.stopRequested) return;
    container.signal(15);
    this.stopRequested = true;
  }

  private async startAndWaitForReady(request: Request): Promise<void> {
    this.startupPhase = "release-check";
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    const container = this.ctx.container;
    this.startupPhase = "container-binding";
    if (!container) throw new Error("Container binding is unavailable");
    this.startupPhase = "snapshot-credential";
    const snapshotToken = this.env.PROFILE_SNAPSHOT_TOKEN;
    if (!snapshotToken || snapshotToken.length < 32) throw new Error("Profile snapshot token is missing or too short");
    const image = container.images.base;
    this.startupPhase = "image-binding";
    const release = await controllerRelease(this.env);
    if (!image) throw new Error("Container image is unavailable");
    this.startupPhase = "image-reconcile";
    if (!container.running || this.currentImage !== image || this.currentBuild !== release) {
      const snapshotUrl = new URL("/_internal/profiles", request.url).href;
      await ensureContainerImage(container, image, () => {
        this.stopRequested = false;
        this.startupPhase = "container-start";
        container.start({
          image,
          labels: { serverBuild: release },
          instance: CONTAINER_INSTANCE,
          enableInternet: true,
          env: {
            PORT: String(PORT),
            RAID_PORT: String(PORT),
            STASH_FILE: "/data/stash.json",
            CLIENT_DIST: "/app/packages/client/dist",
            CLIENT_DIR: "/app/packages/client/dist",
            PROFILE_SNAPSHOT_URL: snapshotUrl,
            BOT_STATS_SNAPSHOT_URL: new URL("/_internal/bot-learning", request.url).href,
            PROFILE_SNAPSHOT_TOKEN: snapshotToken,
            TRUST_PROXY: "1",
            MAX_ARENA_ROOMS: ARENA_LIMIT,
            MAX_TRAINING_ROOMS: TRAINING_LIMIT,
            MAP_POOL: "2",
            MAP_WORKER_HANG_MS: "30000",
            CLOUD_GAME_WARMUP: "1",
            GAME_BUILD_ID: serverBuild,
          },
        });
      }, () => this.watchContainerExit(container), Math.min(15_000, Math.max(0, deadline - Date.now())), () => this.requestContainerStop(container), release);
      this.currentImage = image;
      this.currentBuild = release;
    }
    this.watchContainerExit(container);
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(PORT);
    this.startupPhase = "readiness";
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const response = await port.fetch(`http://container:${PORT}/readyz`, { signal: AbortSignal.timeout(750) });
        await response.body?.cancel();
        const actualBuild = response.headers.get("X-Rougehalla-Server-Build");
        this.startupPhase = `readiness:${response.status}:${actualBuild?.slice(0, 12) ?? "missing-build"}`;
        if (isReadyServerBuild(response, serverBuild)) return;
        // A labeled process that serves different code must never accept traffic. The image/label
        // gate above replaces legacy processes once; polling here cannot start a restart loop.
        if (response.ok) throw new Error("Game container server build does not match this Worker release");
        lastError = new Error(`readiness returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Game container did not become ready within 75 seconds", { cause: lastError });
  }

  async fetch(request: Request): Promise<Response> {
    if (this.retired || request.headers.get(RELEASE_HEADER) !== await controllerRelease(this.env)) {
      await this.retireController();
      return new Response("game release changing", { status: 503, headers: { "Retry-After": "2", "Cache-Control": "no-store" } });
    }
    if (this.env.GAME_MAINTENANCE === "1") {
      if (this.ctx.container?.running) await this.retireController();
      return new Response("game maintenance", { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } });
    }
    // Concurrent cold-start requests share one readiness loop.
    this.starting ??= this.startAndWaitForReady(request).finally(() => { this.starting = undefined; });
    try {
      await this.starting;
    } catch (error) {
      let detail = error instanceof Error ? error.message : "unknown startup failure";
      if (this.env.PROFILE_SNAPSHOT_TOKEN) detail = detail.replaceAll(this.env.PROFILE_SNAPSHOT_TOKEN, "[redacted]");
      console.error(`[game] startup failed phase=${this.startupPhase} expected=${serverBuild.slice(0, 12)} detail=${detail.slice(0, 300)}`);
      return new Response("game server unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "2" },
      });
    }

    const url = new URL(request.url);
    url.protocol = "http:";
    url.hostname = "container";
    url.port = String(PORT);
    const forwarded = proxyRequest(request, url);
    // Preserve the native upgrade stream, including binary frames and control frames.
    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }
}

// A fresh namespace replaces the legacy coordinator whose long-lived monitor pinned old code.
// The legacy export remains available until its old, fenced containers are retired.
export class PublicGameContainer extends GameContainer {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/_edge/health") {
      return request.method === "GET" || request.method === "HEAD"
        ? new Response(request.method === "HEAD" ? null : "ok", {
          status: 200, headers: { "Cache-Control": "no-store", "X-Rougehalla-Expected-Build": serverBuild },
        })
        : new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/_internal/profiles") {
      return noStore(await handleProfileSnapshot(request, env.PROFILES, env.PROFILE_SNAPSHOT_TOKEN));
    }
    if (url.pathname === "/_internal/bot-learning") {
      return noStore(await handleBotSnapshot(request, env.PROFILES, env.PROFILE_SNAPSHOT_TOKEN));
    }
    if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/build-info.json" || url.pathname.startsWith("/assets/")) {
      if (request.method === "GET" || request.method === "HEAD") return staticAsset(request, env);
      if (url.pathname.startsWith("/assets/")) return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    if (url.pathname === "/matchmake" || url.pathname.startsWith("/matchmake/")) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.MATCHMAKE_LIMITER.limit({ key: ip });
      if (!success) return new Response("matchmaking rate limit exceeded", {
        status: 429,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "10" },
      });
    }
    const id = env.GAME_CONTAINER.idFromName(ROOM_NAME);
    try {
      const game = env.GAME_CONTAINER.get(id, { locationHint: "wnam" });
      const release = await controllerRelease(env);
      // Existing coordinators can briefly retain their previous code during a deployment. Check
      // the executable from the current public Worker before allowing HTTP or a WebSocket join.
      const ready = await game.fetch(new Request(new URL("/readyz", request.url), { headers: { [RELEASE_HEADER]: release } }));
      if (!isReadyServerBuild(ready, serverBuild)) {
        await ready.body?.cancel();
        throw new Error("Game executable does not match the public Worker release");
      }
      if (url.pathname === "/readyz") return ready;
      await ready.body?.cancel();
      const forwarded = new Request(request);
      forwarded.headers.set(RELEASE_HEADER, release);
      return await game.fetch(forwarded);
    } catch {
      // Avoid logging request details or error objects: they can contain credentials. Keep noisy upstream
      // failures bounded when a container is down or restarting.
      const now = Date.now();
      if (now - lastContainerErrorLogAt >= 60_000) {
        lastContainerErrorLogAt = now;
        console.error("Game container request failed; retrying may recover.");
      }
      return new Response("game server unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "2" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
