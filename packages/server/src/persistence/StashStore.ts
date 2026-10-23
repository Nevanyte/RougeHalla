// Profile + stash persistence. The in-memory state is the source of truth: every mutation is
// synchronous (so Room callbacks never await between a check and the change it guards) and then
// schedules a write. Single process only; the interface exists so SQLite could replace the JSON file.
import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import {
  PROFILE_RE, STARTER_KIT, type ItemDTO, type ProfileStats, type RaidOutcome,
} from "@raid/shared";

export interface ProfileRecord {
  name: string;
  /** Proof of ownership. Never leaves the server except to the profile's own owner. */
  token: string;
  stash: ItemDTO[];
  stats: ProfileStats;
}

export interface ClaimResult {
  /** A snapshot: mutating it does not touch the store. */
  record: ProfileRecord;
  token: string;
  created: boolean;
}

export interface StashStore {
  /** Creates the profile when `name` is unknown; otherwise `token` must match exactly. */
  claim(name: string, token?: string): ClaimResult;
  /** A snapshot of the profile, or undefined when the name is unknown (or invalid). */
  get(name: string): ProfileRecord | undefined;
  /** True only for a known profile and its exact token. */
  verifyToken(name: string, token: string): boolean;
  /** Removes and returns the items with these uids, in that order. All or nothing. */
  withdraw(name: string, uids: readonly string[]): ItemDTO[];
  /** Adds items to the stash. A uid that is already stashed is skipped, so a repeated deposit can't duplicate. */
  deposit(name: string, items: readonly ItemDTO[]): void;
  /** `mia` counts as a death. */
  recordRaid(name: string, outcome: RaidOutcome, kills: number): void;
  /** Resolves once everything mutated so far is on disk. Rejects if the write failed. */
  flush(): Promise<void>;
}

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

export class StashItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StashItemError";
  }
}

/** The stash file cannot be trusted as a whole. The server must not start (and so not overwrite it). */
export class StashFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StashFileError";
  }
}

interface StashFile {
  version: 1;
  profiles: Record<string, ProfileRecord>;
}

const FILE_VERSION = 1;

const copyItem = (i: ItemDTO): ItemDTO => ({ uid: i.uid, def: i.def });

function copyRecord(r: ProfileRecord): ProfileRecord {
  return { name: r.name, token: r.token, stash: r.stash.map(copyItem), stats: { ...r.stats } };
}

function newStats(): ProfileStats {
  return { raids: 0, extracts: 0, deaths: 0, kills: 0 };
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function parseItem(v: unknown): ItemDTO | null {
  return isObject(v) && typeof v.uid === "string" && typeof v.def === "string" ? { uid: v.uid, def: v.def } : null;
}

/** One profile entry, or an Error saying what is wrong with it. */
function parseProfile(key: string, p: unknown): ProfileRecord {
  if (!isObject(p) || p.name !== key || !PROFILE_RE.test(key) || typeof p.token !== "string" || p.token === "") {
    throw new Error("bad profile entry");
  }
  const stats = p.stats;
  if (!isObject(stats) || !isCount(stats.raids) || !isCount(stats.extracts) || !isCount(stats.deaths) || !isCount(stats.kills)) {
    throw new Error("bad stats");
  }
  if (!Array.isArray(p.stash)) throw new Error("bad stash");
  const seen = new Set<string>();
  const stash: ItemDTO[] = [];
  for (const it of p.stash) {
    const item = parseItem(it);
    if (!item) throw new Error("bad stash item");
    if (seen.has(item.uid)) throw new Error("duplicate stash uid");
    seen.add(item.uid);
    stash.push(item);
  }
  return {
    name: key,
    token: p.token,
    stash,
    stats: { raids: stats.raids, extracts: stats.extracts, deaths: stats.deaths, kills: stats.kills },
  };
}

interface ParsedFile {
  profiles: Map<string, ProfileRecord>;
  /** Entries that were left out, with the reason. Their key is untrusted text. */
  dropped: Array<{ name: string; reason: string }>;
}

/**
 * Two kinds of damage, handled differently. A file that is not JSON, or whose version or layout is not
 * the one this code writes, throws: nothing in it can be trusted and guessing would wipe everyone. A
 * valid v1 file with a few broken profile entries keeps the good ones and reports the rest.
 */
function parseFile(text: string): ParsedFile {
  const raw: unknown = JSON.parse(text);
  if (!isObject(raw)) throw new Error("not a JSON object");
  if (raw.version !== FILE_VERSION) {
    throw new Error(`unsupported version ${JSON.stringify(raw.version) ?? "(missing)"}, expected ${FILE_VERSION}`);
  }
  if (!isObject(raw.profiles)) throw new Error("missing \"profiles\" object");
  const profiles = new Map<string, ProfileRecord>();
  const dropped: ParsedFile["dropped"] = [];
  for (const [key, p] of Object.entries(raw.profiles)) {
    try {
      profiles.set(key, parseProfile(key, p));
    } catch (err) {
      dropped.push({ name: key, reason: (err as Error).message });
    }
  }
  return { profiles, dropped };
}

/** Quoted and cut short: profile keys in a damaged file are arbitrary text. */
const quoted = (s: string): string => (s.length > 40 ? `${JSON.stringify(s.slice(0, 40))}...` : JSON.stringify(s));

const MAX_LISTED_DROPPED = 50;

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

export class JsonStashStore implements StashStore {
  private readonly file: string;
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

  constructor(file: string) {
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const { profiles, repaired } = this.load();
    this.profiles = profiles;
    // Rewrite the cleaned file now rather than at the next mutation, so the dropped entries are not
    // reported again (and not backed up again) on every restart.
    if (repaired) this.schedulePersist();
  }

  /**
   * An unusable file stops the server instead of silently becoming an empty stash: the next write
   * would replace it and every profile would be gone. The operator restores it and starts again.
   */
  private load(): { profiles: Map<string, ProfileRecord>; repaired: boolean } {
    let text: string;
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { profiles: new Map(), repaired: false };
      throw err;
    }
    let parsed: ParsedFile;
    try {
      parsed = parseFile(text);
    } catch (err) {
      throw this.refuseFile(err as Error);
    }
    if (parsed.dropped.length === 0) return { profiles: parsed.profiles, repaired: false };

    // The original goes to a backup before the cleaned file replaces it. If that fails, so does startup.
    const backup = `${this.file}.bak-${Date.now()}`;
    fs.writeFileSync(backup, text, { flag: "wx" });
    const listed = parsed.dropped.slice(0, MAX_LISTED_DROPPED).map((d) => `${quoted(d.name)} (${d.reason})`);
    const more = parsed.dropped.length - listed.length;
    console.error(
      `[stash] ${this.file}: dropped ${parsed.dropped.length} malformed profile(s), kept ${parsed.profiles.size}: ` +
        `${listed.join(", ")}${more > 0 ? `, and ${more} more` : ""}. The original file is saved as ${backup}.`,
    );
    return { profiles: parsed.profiles, repaired: true };
  }

  /** Moves the unusable file out of the way (keeping it for the operator) and builds the startup error. */
  private refuseFile(cause: Error): StashFileError {
    const aside = `${this.file}.corrupt-${Date.now()}`;
    let moved = `It has been moved to ${aside}.`;
    try {
      fs.renameSync(this.file, aside);
    } catch (err) {
      moved = `It could not be moved aside (${(err as Error).message}) and was left in place.`;
    }
    return new StashFileError(
      `[stash] refusing to start: ${this.file} is unusable (${cause.message}). ${moved} ` +
        `Restore it from a backup, or repair that copy and put it back at ${this.file}, then start the server again. ` +
        `Starting again without a file at that path begins with an empty stash.`,
    );
  }

  claim(name: string, token?: string): ClaimResult {
    if (typeof name !== "string" || !PROFILE_RE.test(name)) throw new InvalidProfileNameError(String(name));
    const existing = this.profiles.get(name);
    if (existing) {
      if (typeof token !== "string" || !tokensEqual(existing.token, token)) throw new ProfileForbiddenError(name);
      return { record: copyRecord(existing), token: existing.token, created: false };
    }
    const record: ProfileRecord = {
      name,
      token: randomUUID(),
      stash: STARTER_KIT.map((def) => ({ uid: randomUUID(), def })),
      stats: newStats(),
    };
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

  withdraw(name: string, uids: readonly string[]): ItemDTO[] {
    const r = this.require(name);
    const wanted = new Set<string>();
    for (const uid of uids) {
      if (typeof uid !== "string") throw new StashItemError("item uid must be a string");
      if (wanted.has(uid)) throw new StashItemError(`duplicate item uid in request: ${uid}`);
      wanted.add(uid);
    }
    const byUid = new Map(r.stash.map((i) => [i.uid, i]));
    const out: ItemDTO[] = [];
    for (const uid of uids) {
      const item = byUid.get(uid);
      if (!item) throw new StashItemError(`item not in stash: ${uid}`);
      out.push(copyItem(item));
    }
    if (out.length === 0) return out;
    r.stash = r.stash.filter((i) => !wanted.has(i.uid));
    this.schedulePersist();
    return out;
  }

  deposit(name: string, items: readonly ItemDTO[]): void {
    const r = this.require(name);
    const have = new Set(r.stash.map((i) => i.uid));
    let added = false;
    for (const it of items) {
      if (have.has(it.uid)) continue;
      have.add(it.uid);
      r.stash.push(copyItem(it));
      added = true;
    }
    if (added) this.schedulePersist();
  }

  recordRaid(name: string, outcome: RaidOutcome, kills: number): void {
    const r = this.require(name);
    r.stats.raids++;
    if (outcome === "extracted") r.stats.extracts++;
    else r.stats.deaths++;
    if (Number.isFinite(kills) && kills > 0) r.stats.kills += Math.floor(kills);
    this.schedulePersist();
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
        console.error(`[stash] failed to write ${this.file} (retrying in ${this.retryDelayMs} ms):`, err);
        this.scheduleRetry();
        return;
      }
    }
  }

  private async writeSnapshot(): Promise<void> {
    const profiles: Record<string, ProfileRecord> = Object.fromEntries(this.profiles);
    const data: StashFile = { version: FILE_VERSION, profiles };
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
