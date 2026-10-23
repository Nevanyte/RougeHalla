// Profile persistence (v2): GV, stats and cosmetics per callsign. The in-memory state is the source of truth:
// every mutation is synchronous (so Room callbacks never await between a check and the change it guards) and then
// schedules a write. Single process only; the interface exists so SQLite could replace the JSON file.
// There is no stash any more: run gear never leaves a run. A v1 (stash) file is migrated on load.
import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import {
  LEADERBOARD_DEFAULT_LIMIT, LEADERBOARD_MAX_LIMIT, MONTH_RE, PROFILE_RE, monthKey,
  type CosmeticsDTO, type LeaderboardEntry, type ProfileStats, type RunOutcome,
} from "@raid/shared";

export interface ProfileRecord {
  name: string;
  /** Proof of ownership. Never leaves the server except to the profile's own owner. */
  token: string;
  /** Spendable GV. */
  gv: number;
  /** Every GV ever banked; spending never lowers it. */
  gvLifetime: number;
  /** GV banked per UTC month ("YYYY-MM", see monthKey). Months with nothing banked are absent. */
  gvByMonth: Record<string, number>;
  stats: ProfileStats;
  cosmetics: CosmeticsDTO;
}

export interface ClaimResult {
  /** A snapshot: mutating it does not touch the store. */
  record: ProfileRecord;
  token: string;
  created: boolean;
}

/** What one resolved run banks. `gv` is the run's whole payout (RunResult.gv.total). */
export interface RunRecord { outcome: RunOutcome; kills: number; gv: number }

export interface ProfileStore {
  /** Creates the profile when `name` is unknown; otherwise `token` must match exactly. */
  claim(name: string, token?: string): ClaimResult;
  /** A snapshot of the profile, or undefined when the name is unknown (or invalid). */
  get(name: string): ProfileRecord | undefined;
  /** True only for a known profile and its exact token. */
  verifyToken(name: string, token: string): boolean;
  /**
   * Banks one resolved run: stats (`runs`, plus `wins`/`draws`/`deaths` by outcome, mia counting as a death, and
   * `kills`), and `gv` into the balance, the lifetime total and the current month. Throws UnknownProfileError.
   */
  recordRun(name: string, run: RunRecord): void;
  /** Banks GV without recording a run: a run voided by a server shutdown still pays what was earned. */
  bankGv(name: string, gv: number): void;
  /** Profiles by GV banked in `month` ("YYYY-MM"), highest first, ties by name; only months with GV > 0 count. */
  leaderboard(month: string, limit: number): LeaderboardEntry[];
  /** Resolves once everything mutated so far is on disk. Rejects if the write failed. */
  flush(): Promise<void>;
}

/** The store's notion of "now", for the month GV is banked in. Tests pass a fixed clock. */
export type Clock = () => number;
export const systemClock: Clock = () => Date.now();
export { monthKey };

export class InvalidProfileNameError extends Error {
  constructor(name: string) {
    super(`invalid profile name: ${JSON.stringify(name).slice(0, 40)}`);
    this.name = "InvalidProfileNameError";
  }
}

export class ProfileForbiddenError extends Error {
  constructor(name: string) {
    super(`profile "${name}" belongs to someone else`);
    this.name = "ProfileForbiddenError";
  }
}

export class UnknownProfileError extends Error {
  constructor(name: string) {
    super(`unknown profile "${name}"`);
    this.name = "UnknownProfileError";
  }
}

/** The profile file cannot be trusted as a whole. The server must not start (and so not overwrite it). */
export class ProfileFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileFileError";
  }
}

interface ProfileFile {
  version: 2;
  profiles: Record<string, ProfileRecord>;
}

const FILE_VERSION = 2;
/** The extraction build's format: a stash per profile. Read and migrated, never written. */
const V1_FILE_VERSION = 1;

/** A copy with plain own keys. Object.fromEntries defines them, so a key like "__proto__" stays data. */
const copyDict = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o));

function copyRecord(r: ProfileRecord): ProfileRecord {
  return {
    name: r.name,
    token: r.token,
    gv: r.gv,
    gvLifetime: r.gvLifetime,
    gvByMonth: copyDict(r.gvByMonth),
    stats: { ...r.stats },
    cosmetics: { owned: [...r.cosmetics.owned], equipped: copyDict(r.cosmetics.equipped) },
  };
}

function newRecord(name: string, token: string): ProfileRecord {
  return {
    name,
    token,
    gv: 0,
    gvLifetime: 0,
    gvByMonth: {},
    stats: { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 },
    cosmetics: { owned: [], equipped: {} },
  };
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** The checks every file version shares. */
function checkEntry(key: string, p: unknown): asserts p is Record<string, unknown> & { token: string } {
  if (!isObject(p) || p.name !== key || !PROFILE_RE.test(key) || typeof p.token !== "string" || p.token === "") {
    throw new Error("bad profile entry");
  }
}

function parseProfileV2(key: string, p: unknown): ProfileRecord {
  checkEntry(key, p);
  const { gv, gvLifetime, gvByMonth, stats, cosmetics } = p;
  if (!isCount(gv)) throw new Error("bad gv");
  if (!isCount(gvLifetime)) throw new Error("bad gvLifetime");
  if (!isObject(gvByMonth)) throw new Error("bad gvByMonth");
  for (const [month, amount] of Object.entries(gvByMonth)) {
    if (!MONTH_RE.test(month) || !isCount(amount)) throw new Error("bad gvByMonth");
  }
  if (
    !isObject(stats) || !isCount(stats.runs) || !isCount(stats.wins) || !isCount(stats.draws) ||
    !isCount(stats.deaths) || !isCount(stats.kills)
  ) {
    throw new Error("bad stats");
  }
  if (!isObject(cosmetics) || !Array.isArray(cosmetics.owned) || !isObject(cosmetics.equipped)) {
    throw new Error("bad cosmetics");
  }
  const owned = new Set<string>();
  for (const id of cosmetics.owned) {
    if (typeof id !== "string") throw new Error("bad cosmetics");
    if (owned.has(id)) throw new Error("duplicate cosmetic");
    owned.add(id);
  }
  for (const id of Object.values(cosmetics.equipped)) {
    if (typeof id !== "string") throw new Error("bad cosmetics");
  }
  return {
    name: key,
    token: p.token,
    gv,
    gvLifetime,
    gvByMonth: copyDict(gvByMonth as Record<string, number>),
    stats: { runs: stats.runs, wins: stats.wins, draws: stats.draws, deaths: stats.deaths, kills: stats.kills },
    cosmetics: { owned: [...owned], equipped: copyDict(cosmetics.equipped as Record<string, string>) },
  };
}

/**
 * Validated as strictly as the v1 store did, stash included: an entry it would have dropped is dropped here too,
 * even though the stash itself does not survive the migration.
 */
function parseProfileV1(key: string, p: unknown): ProfileRecord {
  checkEntry(key, p);
  const { stats, stash } = p;
  if (!isObject(stats) || !isCount(stats.raids) || !isCount(stats.extracts) || !isCount(stats.deaths) || !isCount(stats.kills)) {
    throw new Error("bad stats");
  }
  if (!Array.isArray(stash)) throw new Error("bad stash");
  const seen = new Set<string>();
  for (const it of stash) {
    if (!isObject(it) || typeof it.uid !== "string" || typeof it.def !== "string") throw new Error("bad stash item");
    if (seen.has(it.uid)) throw new Error("duplicate stash uid");
    seen.add(it.uid);
  }
  const record = newRecord(key, p.token);
  record.stats = { runs: stats.raids, wins: 0, draws: 0, deaths: stats.deaths, kills: stats.kills };
  return record;
}

interface ParsedFile {
  /** The version the text was in; a v1 file's profiles are already migrated. */
  version: 1 | 2;
  profiles: Map<string, ProfileRecord>;
  /** Entries that were left out, with the reason. Their key is untrusted text. */
  dropped: Array<{ name: string; reason: string }>;
}

/**
 * Two kinds of damage, handled differently. A file that is not JSON, or whose version or layout is not
 * one this code reads, throws: nothing in it can be trusted and guessing would wipe everyone. A valid
 * file with a few broken profile entries keeps the good ones and reports the rest.
 */
function parseFile(text: string): ParsedFile {
  const raw: unknown = JSON.parse(text);
  if (!isObject(raw)) throw new Error("not a JSON object");
  if (raw.version !== FILE_VERSION && raw.version !== V1_FILE_VERSION) {
    throw new Error(
      `unsupported version ${JSON.stringify(raw.version) ?? "(missing)"}, expected ${FILE_VERSION} (or ${V1_FILE_VERSION}, which is migrated)`,
    );
  }
  if (!isObject(raw.profiles)) throw new Error("missing \"profiles\" object");
  const parseEntry = raw.version === V1_FILE_VERSION ? parseProfileV1 : parseProfileV2;
  const profiles = new Map<string, ProfileRecord>();
  const dropped: ParsedFile["dropped"] = [];
  for (const [key, p] of Object.entries(raw.profiles)) {
    try {
      profiles.set(key, parseEntry(key, p));
    } catch (err) {
      dropped.push({ name: key, reason: (err as Error).message });
    }
  }
  return { version: raw.version, profiles, dropped };
}

/** Quoted and cut short: profile keys in a damaged file are arbitrary text. */
const quoted = (s: string): string => (s.length > 40 ? `${JSON.stringify(s.slice(0, 40))}...` : JSON.stringify(s));

const MAX_LISTED_DROPPED = 50;

/**
 * Counts and GV come from the sim, which only makes whole, non-negative numbers. Anything else (NaN, Infinity, a
 * negative, not a number, too big to stay exact) is a bug upstream. It is logged and counted as 0 rather than thrown:
 * a throw would also lose the rest of that run's record, and a silent clamp would hide the bug. Fractions are floored.
 */
function wholeAmount(profile: string, what: string, n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n) && n >= 0) {
    const whole = Math.floor(n);
    if (Number.isSafeInteger(whole)) return whole;
  }
  console.error(`[profiles] ${profile}: ignoring ${what} ${typeof n === "number" ? String(n) : typeof n}`);
  return 0;
}

function outcomeStat(outcome: RunOutcome): "wins" | "draws" | "deaths" {
  switch (outcome) {
    case "won": return "wins";
    case "draw": return "draws";
    case "died":
    case "mia": return "deaths";
    default: throw new TypeError(`unknown run outcome ${JSON.stringify(outcome)}`);
  }
}

/** Saturates instead of passing 2^53, past which a stored count would stop reloading. */
const addCount = (a: number, b: number): number => Math.min(a + b, Number.MAX_SAFE_INTEGER);

const byGvThenName = (a: LeaderboardEntry, b: LeaderboardEntry): number =>
  b.gv - a.gv || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Write failures are retried after this long, doubling up to the cap, until one succeeds. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/** Opening or syncing a directory is not possible on every platform or filesystem; that is not a failed write. */
const DIR_SYNC_UNSUPPORTED = new Set(["EISDIR", "EPERM", "EINVAL"]);

/** Makes a rename durable: the new directory entry is only crash-safe once the directory itself is synced. */
async function syncDir(dir: string): Promise<void> {
  let fh: FileHandle | undefined;
  try {
    fh = await fs.promises.open(dir, "r");
    await fh.sync();
  } catch (err) {
    if (!DIR_SYNC_UNSUPPORTED.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
  } finally {
    await fh?.close();
  }
}

export class JsonProfileStore implements ProfileStore {
  private readonly file: string;
  private readonly clock: Clock;
  /** A Map, not an object: "__proto__" is a legal profile name. */
  private readonly profiles: Map<string, ProfileRecord>;

  /** True while in-memory state is newer than what the last finished write contained. */
  private dirty = false;
  /** The running write loop. At most one exists, so two writes are never in flight. */
  private writing: Promise<void> | null = null;
  private lastError: unknown = null;
  /** Pending retry of a failed write. While it is armed, mutations only mark the data dirty. */
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelayMs = RETRY_MIN_MS;

  constructor(file: string, opts: { clock?: Clock } = {}) {
    this.file = path.resolve(file);
    this.clock = opts.clock ?? systemClock;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const { profiles, rewrite } = this.load();
    this.profiles = profiles;
    // Rewrite the new file now rather than at the next mutation, so a migration is not repeated (and the dropped
    // entries are not reported and backed up again) on every restart.
    if (rewrite) this.schedulePersist();
  }

  /**
   * An unusable file stops the server instead of silently becoming an empty store: the next write
   * would replace it and every profile would be gone. The operator restores it and starts again.
   */
  private load(): { profiles: Map<string, ProfileRecord>; rewrite: boolean } {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(this.file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { profiles: new Map(), rewrite: false };
      throw err;
    }
    let parsed: ParsedFile;
    try {
      parsed = parseFile(bytes.toString("utf8"));
    } catch (err) {
      throw this.refuseFile(err as Error);
    }
    const migrating = parsed.version === V1_FILE_VERSION;
    if (!migrating && parsed.dropped.length === 0) return { profiles: parsed.profiles, rewrite: false };

    // The original goes to a backup before the new file replaces it. If that fails, so does startup.
    const backup = migrating
      ? this.saveOriginal(bytes, [`${this.file}.bak-v1`, `${this.file}.bak-v1-${Date.now()}`])
      : this.saveOriginal(bytes, [`${this.file}.bak-${Date.now()}`]);
    if (migrating) {
      console.log(
        `[profiles] ${this.file}: migrated ${parsed.profiles.size} profile(s) from file version 1 to ${FILE_VERSION}; ` +
          `their stashes are gone. The original file is saved as ${backup}.`,
      );
    }
    if (parsed.dropped.length > 0) {
      const listed = parsed.dropped.slice(0, MAX_LISTED_DROPPED).map((d) => `${quoted(d.name)} (${d.reason})`);
      const more = parsed.dropped.length - listed.length;
      console.error(
        `[profiles] ${this.file}: dropped ${parsed.dropped.length} malformed profile(s), kept ${parsed.profiles.size}: ` +
          `${listed.join(", ")}${more > 0 ? `, and ${more} more` : ""}. The original file is saved as ${backup}.`,
      );
    }
    return { profiles: parsed.profiles, rewrite: true };
  }

  /**
   * Keeps the original bytes under the first of `candidates` that is free; an existing file is never overwritten
   * ("wx"). Synced, because once the new file replaces the original this is the only copy. A failed write leaves
   * no partial backup behind.
   */
  private saveOriginal(bytes: Buffer, candidates: string[]): string {
    let last: unknown;
    for (const backup of candidates) {
      let fd: number;
      try {
        fd = fs.openSync(backup, "wx");
      } catch (err) {
        last = err;
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        break;
      }
      try {
        try {
          fs.writeFileSync(fd, bytes);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      } catch (err) {
        last = err;
        fs.rmSync(backup, { force: true });
        break;
      }
      return backup;
    }
    throw new Error(
      `[profiles] refusing to start: could not save a copy of ${this.file} before rewriting it (${(last as Error).message}). ` +
        `The file was left as it is.`,
      { cause: last },
    );
  }

  /** Moves the unusable file out of the way (keeping it for the operator) and builds the startup error. */
  private refuseFile(cause: Error): ProfileFileError {
    const aside = `${this.file}.corrupt-${Date.now()}`;
    let moved = `It has been moved to ${aside}.`;
    try {
      fs.renameSync(this.file, aside);
    } catch (err) {
      moved = `It could not be moved aside (${(err as Error).message}) and was left in place.`;
    }
    return new ProfileFileError(
      `[profiles] refusing to start: ${this.file} is unusable (${cause.message}). ${moved} ` +
        `Restore it from a backup, or repair that copy and put it back at ${this.file}, then start the server again. ` +
        `Starting again without a file at that path begins with no profiles.`,
    );
  }

  claim(name: string, token?: string): ClaimResult {
    if (typeof name !== "string" || !PROFILE_RE.test(name)) throw new InvalidProfileNameError(String(name));
    const existing = this.profiles.get(name);
    if (existing) {
      if (typeof token !== "string" || !tokensEqual(existing.token, token)) throw new ProfileForbiddenError(name);
      return { record: copyRecord(existing), token: existing.token, created: false };
    }
    const record = newRecord(name, randomUUID());
    this.profiles.set(name, record);
    this.schedulePersist();
    return { record: copyRecord(record), token: record.token, created: true };
  }

  get(name: string): ProfileRecord | undefined {
    const r = this.profiles.get(name);
    return r ? copyRecord(r) : undefined;
  }

  verifyToken(name: string, token: string): boolean {
    const r = this.profiles.get(name);
    return !!r && typeof token === "string" && tokensEqual(r.token, token);
  }

  recordRun(name: string, run: RunRecord): void {
    const r = this.require(name);
    // Everything that can throw comes before the first change, so a bad call leaves the profile as it was.
    const stat = outcomeStat(run.outcome);
    const kills = wholeAmount(name, "kills", run.kills);
    const gv = wholeAmount(name, "gv", run.gv);
    const month = gv > 0 ? this.currentMonth() : "";
    r.stats.runs = addCount(r.stats.runs, 1);
    r.stats[stat] = addCount(r.stats[stat], 1);
    r.stats.kills = addCount(r.stats.kills, kills);
    this.credit(r, gv, month);
    this.schedulePersist();
  }

  bankGv(name: string, gv: number): void {
    const r = this.require(name);
    const amount = wholeAmount(name, "gv", gv);
    if (amount === 0) return;
    this.credit(r, amount, this.currentMonth());
    this.schedulePersist();
  }

  leaderboard(month: string, limit: number): LeaderboardEntry[] {
    if (typeof month !== "string" || !MONTH_RE.test(month)) return [];
    const whole = Math.floor(limit);
    const n = Number.isNaN(whole) ? LEADERBOARD_DEFAULT_LIMIT : Math.min(Math.max(whole, 1), LEADERBOARD_MAX_LIMIT);
    const rows: LeaderboardEntry[] = [];
    for (const r of this.profiles.values()) {
      const gv = r.gvByMonth[month];
      if (gv !== undefined && gv > 0) rows.push({ name: r.name, gv });
    }
    return rows.sort(byGvThenName).slice(0, n);
  }

  async flush(): Promise<void> {
    this.lastError = null;
    if (this.dirty && !this.writing) this.start();
    // The loop re-checks `dirty` after each write, so awaiting it also covers writes scheduled meanwhile.
    while (this.writing) await this.writing;
    if (this.dirty && this.lastError) throw this.lastError;
  }

  private require(name: string): ProfileRecord {
    const r = this.profiles.get(name);
    if (!r) throw new UnknownProfileError(String(name));
    return r;
  }

  /** The month a payout lands in. A clock that gives an unusable date fails the call before anything changes. */
  private currentMonth(): string {
    const month = monthKey(this.clock());
    if (!MONTH_RE.test(month)) throw new RangeError(`the clock gave an unusable time (${month})`);
    return month;
  }

  private credit(r: ProfileRecord, gv: number, month: string): void {
    if (gv === 0) return;
    r.gv = addCount(r.gv, gv);
    r.gvLifetime = addCount(r.gvLifetime, gv);
    r.gvByMonth[month] = addCount(r.gvByMonth[month] ?? 0, gv);
  }

  private schedulePersist(): void {
    this.dirty = true;
    // After a failure the retry timer owns the next attempt; hammering a failing disk on every mutation helps nobody.
    if (!this.writing && !this.retryTimer) this.start();
  }

  private start(): void {
    this.cancelRetry();
    this.writing = this.writeLoop().finally(() => {
      this.writing = null;
      // A microtask can mutate between the loop's last check and here; don't strand that change.
      if (this.dirty && !this.lastError) this.start();
    });
  }

  private cancelRetry(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Backs off 1 s, 2 s, 4 s ... up to 30 s between attempts. Unref'd: a pending retry never keeps the process alive. */
  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(delay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.dirty && !this.writing) this.start();
    }, delay);
    this.retryTimer.unref();
  }

  private async writeLoop(): Promise<void> {
    // Let the rest of the current synchronous burst land first so it costs one write, not several.
    await Promise.resolve();
    while (this.dirty) {
      this.dirty = false;
      try {
        await this.writeSnapshot();
        this.lastError = null;
        this.retryDelayMs = RETRY_MIN_MS;
      } catch (err) {
        // Keep the data dirty and try again later. Never throw from the background loop.
        this.dirty = true;
        this.lastError = err;
        console.error(`[profiles] failed to write ${this.file} (retrying in ${this.retryDelayMs} ms):`, err);
        this.scheduleRetry();
        return;
      }
    }
  }

  private async writeSnapshot(): Promise<void> {
    const profiles: Record<string, ProfileRecord> = Object.fromEntries(this.profiles);
    const data: ProfileFile = { version: FILE_VERSION, profiles };
    const json = JSON.stringify(data);
    const tmp = `${this.file}.tmp`;
    const fh = await fs.promises.open(tmp, "w");
    try {
      await fh.writeFile(json, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.promises.rename(tmp, this.file);
    await syncDir(path.dirname(this.file));
  }
}
