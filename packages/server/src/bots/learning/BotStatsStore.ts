// What the filler bots learn across matches (docs/BOTS.md 6.2): per choice key (faction, opener, second weapon...) a decayed
// mean of how well the bots that took it placed, read back as a small utility nudge. Deliberately apart from the profile
// store: its own file, its own module, and no import of it (bots must never be able to touch a human's data). The write path
// copies that store's pattern (temp file in the same directory, fsync, rename, directory fsync) instead of sharing it.
// No timers: a write happens from record() (at most one per LEARN.writeEveryMs), flush() or close().
import fs from "node:fs";
import path from "node:path";
import { LEARN, TIER_IDS, type BotStatsStoreApi, type ChoiceKey, type LearnedBias, type RunSummary, type TierId } from "../brain/types";

/** The file operations the store uses, so a test can fail one step and see what the disk is left with. All synchronous. */
export interface BotStatsFs {
  /** The file's text, or null when it does not exist. Any other failure throws. */
  readText(file: string): string | null;
  mkdirp(dir: string): void;
  /** Creates or truncates `file`, writes `text` and fsyncs it. */
  writeSynced(file: string, text: string): void;
  rename(from: string, to: string): void;
  /** Makes a rename durable. A filesystem that cannot sync a directory is not a failure. */
  syncDir(dir: string): void;
  remove(file: string): void;
}

export interface BotStatsStoreOptions {
  /** Paths the store must never use (the profile file): constructing with one of them, or its `.lock`, throws. */
  forbid?: readonly string[];
  /** Server ms. Default Date.now. */
  now?: () => number;
  fs?: Partial<BotStatsFs>;
}

/** Opening or syncing a directory is not possible on every platform or filesystem; that is not a failed write. */
const DIR_SYNC_UNSUPPORTED = new Set(["EISDIR", "EPERM", "EINVAL"]);

const nodeFs: BotStatsFs = {
  readText(file) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  mkdirp(dir) {
    fs.mkdirSync(dir, { recursive: true });
  },
  writeSynced(file, text) {
    const fd = fs.openSync(file, "w");
    try {
      fs.writeFileSync(fd, text, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  },
  rename(from, to) {
    fs.renameSync(from, to);
  },
  syncDir(dir) {
    let fd: number | undefined;
    try {
      fd = fs.openSync(dir, "r");
      fs.fsyncSync(fd);
    } catch (err) {
      if (!DIR_SYNC_UNSUPPORTED.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  },
  remove(file) {
    fs.rmSync(file, { force: true });
  },
};

/** A decayed count and a decayed sum of residuals (or, for a tier's baseline, of placement scores). */
interface Cell {
  n: number;
  s: number;
}

/** The score where a run says nothing: the residual of a run that placed as its tier usually does, and the bias's centre. */
const NEUTRAL = 0.5;
const DOMAINS: ReadonlySet<string> = new Set(["faction", "opener", "second", "spawn", "boon", "skill", "relic", "camp"]);
const MAX_KEY_LENGTH = 96;

/** Learning switched off: what a bot without a store reads. */
export const NO_BIAS: LearnedBias = Object.freeze({ enabled: false, bias: () => 0 });

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validKey(key: unknown): key is ChoiceKey {
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH) return false;
  const parts = key.split("|");
  return parts.length === 3 && parts.every((p) => p.length > 0) && DOMAINS.has(parts[0]!);
}

/** A run adds at most 1 to `s` for each 1 to `n` (scores are in 0..1), so a cell with more s than n is damaged. */
function toCell(v: unknown): Cell | null {
  if (!isRecord(v)) return null;
  const { n, s } = v;
  if (typeof n !== "number" || typeof s !== "number" || !Number.isFinite(n) || !Number.isFinite(s)) return null;
  if (n < 0 || s < 0 || s > n + 1e-9) return null;
  return { n, s };
}

/** The bias of a cell: its smoothed mean (the prior is worth LEARN.strength runs) minus the neutral score, capped. */
function biasOf(c: Cell): number {
  const m = (c.s + LEARN.prior * LEARN.strength) / (c.n + LEARN.strength);
  return clamp(m - NEUTRAL, -LEARN.cap, LEARN.cap);
}

/** One spelling for comparing paths: symlinked directories resolved, case folded (a case-insensitive disk is the same file). */
function canonical(p: string): string {
  const resolved = path.resolve(p);
  let dir = path.dirname(resolved);
  try {
    dir = fs.realpathSync(dir);
  } catch {
    // The directory does not exist yet: the resolved spelling is all there is.
  }
  return path.join(dir, path.basename(resolved)).toLowerCase();
}

function freshBaseline(): Record<TierId, Cell> {
  return { easy: { n: 0, s: 0 }, normal: { n: 0, s: 0 }, hard: { n: 0, s: 0 } };
}

interface Loaded {
  baseline: Record<TierId, Cell>;
  entries: Map<string, Cell>;
}

function parseFile(text: string): Loaded {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) throw new Error("not an object");
  if (raw.version !== LEARN.version) throw new Error(`version ${String(raw.version)}, expected ${LEARN.version}`);
  if (!isRecord(raw.baseline) || !isRecord(raw.entries)) throw new Error("baseline or entries missing");
  const baseline = freshBaseline();
  for (const tier of TIER_IDS) {
    if (!Object.hasOwn(raw.baseline, tier)) continue;
    const cell = toCell(raw.baseline[tier]);
    if (cell === null) throw new Error(`baseline for ${tier} is damaged`);
    baseline[tier] = cell;
  }
  // A damaged entry is dropped on its own: one bad row is not worth the other rows.
  const entries = new Map<string, Cell>();
  for (const [key, value] of Object.entries(raw.entries)) {
    const cell = toCell(value);
    if (cell !== null && validKey(key)) entries.set(key, cell);
  }
  return { baseline, entries };
}

class BotStatsStore implements BotStatsStoreApi {
  private readonly file: string | null;
  private readonly now: () => number;
  private readonly io: BotStatsFs;
  private entries = new Map<string, Cell>();
  private baseline = freshBaseline();
  private dirty = false;
  private closed = false;
  private lastWriteAt = Number.NEGATIVE_INFINITY;
  /** Frozen view handed to bots, rebuilt only after a record(), so a lobby full of joining bots shares one. */
  private cached: LearnedBias | null = null;

  constructor(file: string | null, opts: BotStatsStoreOptions) {
    this.now = opts.now ?? Date.now;
    this.io = { ...nodeFs, ...opts.fs };
    if (file === null || file === "") {
      this.file = null;
      return;
    }
    this.file = path.resolve(file);
    const mine = canonical(this.file);
    for (const other of opts.forbid ?? []) {
      const theirs = canonical(other);
      if (mine === theirs || mine === `${theirs}.lock`) {
        throw new Error(`[bot-stats] refusing to use ${file}: it is ${other} or its lock file, which the profile store owns`);
      }
    }
    this.load(this.file);
  }

  snapshot(): LearnedBias {
    if (this.cached !== null) return this.cached;
    const biases = new Map<string, number>();
    for (const [key, cell] of this.entries) biases.set(key, biasOf(cell));
    this.cached = Object.freeze({ enabled: true, bias: (key: ChoiceKey): number => biases.get(key) ?? 0 });
    return this.cached;
  }

  record(summary: RunSummary): void {
    if (summary.outcome === "void") return;
    const players = Math.floor(summary.players);
    const base = Object.hasOwn(this.baseline, summary.tier) ? this.baseline[summary.tier] : undefined;
    if (base === undefined || !(players >= 2)) return;
    const rounded = Math.round(summary.place);
    if (summary.outcome !== "draw" && !Number.isFinite(rounded)) return;
    const place = summary.outcome === "draw" ? 1 : clamp(rounded, 1, players);
    const s = (players - place) / (players - 1);

    // The baseline takes this run in first: the first run of a tier has nothing to be compared with and so says nothing.
    base.n = LEARN.decay * base.n + 1;
    base.s = LEARN.decay * base.s + s;
    const r = clamp(NEUTRAL + s - base.s / base.n, 0, 1);

    const touched = new Set<string>();
    for (const key of summary.choices) {
      if (!validKey(key) || touched.has(key)) continue;
      touched.add(key);
      const cell = this.entries.get(key);
      if (cell === undefined) this.entries.set(key, { n: 1, s: r });
      else {
        cell.n = LEARN.decay * cell.n + 1;
        cell.s = LEARN.decay * cell.s + r;
      }
    }
    this.evict(touched);
    this.cached = null;
    this.dirty = true;
    this.writeIfDue();
  }

  flush(): void {
    this.write();
  }

  close(): void {
    this.write();
    this.closed = true;
  }

  /** The smallest n goes first (the oldest of equals); what this very run touched stays, or a full table would refuse every newcomer. */
  private evict(keep: ReadonlySet<string>): void {
    while (this.entries.size > LEARN.maxEntries) {
      let victim: string | null = null;
      let least = Infinity;
      for (const [key, cell] of this.entries) {
        if (cell.n < least && !keep.has(key)) {
          least = cell.n;
          victim = key;
        }
      }
      if (victim === null) return;
      this.entries.delete(victim);
    }
  }

  private writeIfDue(): void {
    if (this.file === null || this.closed) return;
    const t = this.now();
    // A clock that went backwards must not hold the next write off for as long as it went back.
    if (t < this.lastWriteAt || t - this.lastWriteAt >= LEARN.writeEveryMs) this.write();
  }

  /** Never throws: a failed write stays dirty and is tried again by the next due record(), flush() or close(). */
  private write(): void {
    if (this.file === null || !this.dirty || this.closed) return;
    const at = this.now();
    this.lastWriteAt = at;
    try {
      this.persist(this.file, at);
      this.dirty = false;
    } catch (err) {
      console.error(`[bot-stats] could not write ${this.file}:`, err);
    }
  }

  private persist(file: string, at: number): void {
    const keys = [...this.entries.keys()].sort();
    const entries: Record<string, Cell> = {};
    for (const key of keys) entries[key] = this.entries.get(key)!;
    const body = JSON.stringify({ version: LEARN.version, updatedAt: at, baseline: this.baseline, entries });
    const dir = path.dirname(file);
    const tmp = `${file}.tmp-${process.pid}`;
    this.io.mkdirp(dir);
    try {
      this.io.writeSynced(tmp, body);
      this.io.rename(tmp, file);
    } catch (err) {
      try {
        this.io.remove(tmp);
      } catch {
        // Whatever is left over is garbage that the next write replaces.
      }
      throw err;
    }
    this.io.syncDir(dir);
  }

  private load(file: string): void {
    let text: string | null;
    try {
      text = this.io.readText(file);
    } catch (err) {
      this.setAside(file, err);
      return;
    }
    if (text === null) return;
    try {
      const loaded = parseFile(text);
      this.baseline = loaded.baseline;
      this.entries = loaded.entries;
      this.evict(new Set());
    } catch (err) {
      this.setAside(file, err);
    }
  }

  /** An unusable file is kept for the operator and the store starts empty: bots are never worth stopping the server for. */
  private setAside(file: string, cause: unknown): void {
    const aside = `${file}.bad-${this.now()}`;
    const why = cause instanceof Error ? cause.message : String(cause);
    let moved = `moved to ${aside}`;
    try {
      this.io.rename(file, aside);
    } catch (err) {
      moved = `left in place, it could not be moved aside (${(err as Error).message})`;
    }
    console.error(`[bot-stats] ${file} is unusable (${why}): ${moved}; starting empty`);
  }
}

/**
 * `file` null (or "") keeps everything in memory. The caller passes the profile file in `forbid`; learning "off" is the
 * caller not creating a store at all (a bot reads NO_BIAS).
 */
export function createBotStatsStore(file: string | null, opts: BotStatsStoreOptions = {}): BotStatsStoreApi {
  return new BotStatsStore(file, opts);
}
