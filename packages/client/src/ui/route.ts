// The route a player draws on the planning screen: waypoints, kept in this tab's sessionStorage by room id (so a reload of the
// page finds them again) and never sent to the server. The same state feeds the planning map, the minimap's faint route and
// the hold-Tab map. Pure apart from the storage, which is wrapped like every other storage access in the client.
import type { GameMap, Vec2 } from "@raid/shared";
import { MAX_WAYPOINTS, advanceNext, clampToWorld, planRoute, routeAhead, type RouteAhead, type RoutePlan } from "./planningMath";

/** The slice of Storage this module uses, so a test can pass a fake. */
export interface RouteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const ROUTE_KEY_PREFIX = "raidbr.route.v1:";

export function routeStorageKey(roomId: string): string {
  return ROUTE_KEY_PREFIX + roomId;
}

function sessionStore(): RouteStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Anything (a parsed file) turned into a list of at most MAX_WAYPOINTS points inside the world; bad entries are dropped. */
export function sanitizeWaypoints(raw: unknown): Vec2[] {
  const list = typeof raw === "object" && raw !== null && Array.isArray((raw as { wp?: unknown }).wp) ? (raw as { wp: unknown[] }).wp : [];
  const out: Vec2[] = [];
  for (const entry of list) {
    if (out.length >= MAX_WAYPOINTS) break;
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [x, y] = entry as unknown[];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push(clampToWorld({ x: Math.round(x), y: Math.round(y) }));
  }
  return out;
}

export function loadRoute(roomId: string, storage: RouteStorage | null = sessionStore()): Vec2[] {
  try {
    const text = storage?.getItem(routeStorageKey(roomId));
    if (text) return sanitizeWaypoints(JSON.parse(text));
  } catch {
    /* unreadable or blocked: no route */
  }
  return [];
}

/** Best effort: returns whether the write went through. */
export function saveRoute(roomId: string, waypoints: readonly Vec2[], storage: RouteStorage | null = sessionStore()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(routeStorageKey(roomId), JSON.stringify({ v: 1, wp: waypoints.map((p) => [Math.round(p.x), Math.round(p.y)]) }));
    return true;
  } catch {
    return false;
  }
}

type Listener = () => void;

export class RouteState {
  private pts: Vec2[];
  private startAt: Vec2 | null = null;
  private nextIdx = 0;
  /** Bumped by every change to the waypoints or the start: what a view compares to know it must repaint. */
  version = 0;
  private cache: { map: GameMap; version: number; plan: RoutePlan } | null = null;
  private readonly listeners = new Set<Listener>();

  /** `roomId` null (training, a test): nothing is kept. */
  constructor(private readonly roomId: string | null = null, private readonly storage: RouteStorage | null = sessionStore()) {
    this.pts = roomId ? loadRoute(roomId, storage) : [];
  }

  get waypoints(): readonly Vec2[] {
    return this.pts;
  }

  /** Where the walk starts, or null. */
  get start(): Vec2 | null {
    return this.startAt;
  }

  /** The index of the waypoint the player is heading for (the number already reached, while a run is on). */
  get next(): number {
    return this.nextIdx;
  }

  /** The start of the walk: the picked spawn while planning, the player's own position once the run starts. */
  setStart(at: Vec2 | null): void {
    const same = at === null ? this.startAt === null : this.startAt !== null && this.startAt.x === at.x && this.startAt.y === at.y;
    if (same) return;
    this.startAt = at ? { x: at.x, y: at.y } : null;
    this.changed(false);
  }

  /** Adds a stop (clamped into the world). False when the route is full. */
  add(at: Vec2): boolean {
    if (this.pts.length >= MAX_WAYPOINTS) return false;
    this.pts.push(clampToWorld(at));
    this.changed(true);
    return true;
  }

  /** Removes stop `i`; false for an index that is not there. */
  removeAt(i: number): boolean {
    if (!Number.isInteger(i) || i < 0 || i >= this.pts.length) return false;
    this.pts.splice(i, 1);
    if (this.nextIdx > i) this.nextIdx--;
    this.changed(true);
    return true;
  }

  removeLast(): boolean {
    return this.removeAt(this.pts.length - 1);
  }

  clear(): void {
    if (this.pts.length === 0) return;
    this.pts = [];
    this.nextIdx = 0;
    this.changed(true);
  }

  /** The route over `map` from the current start: cached until the waypoints or the start change. */
  plan(map: GameMap): RoutePlan {
    if (this.cache && this.cache.map === map && this.cache.version === this.version) return this.cache.plan;
    const plan = planRoute(map, this.startAt, this.pts);
    this.cache = { map, version: this.version, plan };
    return plan;
  }

  /** The part of the route still ahead of the player (from the next stop on), for the minimap and the in-run map. */
  ahead(map: GameMap): RouteAhead {
    return routeAhead(this.plan(map), this.nextIdx);
  }

  /** Moves the next stop past every stop the player has reached at `at`. True when it moved. */
  advance(at: Vec2): boolean {
    const n = advanceNext(this.pts, this.nextIdx, at);
    if (n === this.nextIdx) return false;
    this.nextIdx = n;
    this.version++;
    this.notify();
    return true;
  }

  /** Starts counting the stops from the first again (a new run on the same drawing). */
  restart(): void {
    if (this.nextIdx === 0) return;
    this.nextIdx = 0;
    this.version++;
    this.notify();
  }

  /** Calls `cb` after each change (not now). Returns the unsubscribe. */
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private changed(waypoints: boolean): void {
    this.version++;
    if (waypoints && this.roomId) saveRoute(this.roomId, this.pts, this.storage);
    this.notify();
  }

  private notify(): void {
    for (const cb of [...this.listeners]) cb();
  }
}
