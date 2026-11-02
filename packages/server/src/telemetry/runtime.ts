// The Room's side of telemetry (docs/TELEMETRY.md 6.1): one TelemetryRuntime per process (the sink, the build, the salt), and
// one RunTelemetry per arena world: it installs the recorder, hears the Room's events, holds the per-client facts the sim does
// not know (AFK clocks, drops and reconnects, the client's perf sample), and on finalize fills the Room-owned fields of the
// draft and submits the record once. Nothing here runs inside a step: the Room calls it between steps and from its timers.
import { randomUUID } from "node:crypto";
import {
  AFK_FLAG_MIN_MS, AFK_FLAG_SHARE, AFK_IDLE_MS, sanitizeClientPerf,
  type BotPersonaId, type BotTierId, type BuildInfo, type ClientPerfSample, type PlayerRecord, type RecordSource, type RunRecord,
} from "@raid/shared";
import { installTelemetry, noteRoomEvent, telemetryDraft, type TelemetryRecorder } from "../sim/telemetry";
import type { SimEvent, World } from "../sim/world";
import { pidOf } from "./identity";
import type { SinkStats, TelemetrySink } from "./sink";

export interface TelemetryRuntimeOptions {
  sink: TelemetrySink;
  source: RecordSource;
  build: BuildInfo;
  salt: string | null;
  positions: boolean;
  botsFillTo: number;
  /** Wall clock (epoch ms); Date.now by default. */
  now?: () => number;
}

export interface BotTag { tier: BotTierId; persona: BotPersonaId }

export class TelemetryRuntime {
  readonly opts: TelemetryRuntimeOptions;
  constructor(opts: TelemetryRuntimeOptions) {
    this.opts = opts;
  }

  /** Installs the recorder on an arena world (never training) and returns its run's collector. */
  attach(world: World, botTag?: (id: string) => BotTag | undefined): RunTelemetry {
    return new RunTelemetry(this, world, installTelemetry(world, { positions: this.opts.positions }), botTag);
  }

  close(deadlineMs: number): Promise<void> {
    return this.opts.sink.close(deadlineMs);
  }

  stats(): SinkStats {
    return this.opts.sink.stats();
  }
}

interface AfkClock { last: number; ms: number }

export class RunTelemetry {
  readonly rec: TelemetryRecorder;
  private readonly runtime: TelemetryRuntime;
  private readonly world: World;
  private readonly botTag: ((id: string) => BotTag | undefined) | undefined;
  private runId: string | null = null;
  private startedAtEpoch = 0;
  private endedAtEpoch = 0;
  private finalized = false;
  private readonly afk = new Map<string, AfkClock>();
  private readonly net = new Map<string, { drops: number; reconnects: number }>();
  private readonly perf = new Map<string, ClientPerfSample>();
  private readonly tags = new Map<string, BotTag>();

  constructor(runtime: TelemetryRuntime, world: World, rec: TelemetryRecorder, botTag?: (id: string) => BotTag | undefined) {
    this.runtime = runtime;
    this.world = world;
    this.rec = rec;
    this.botTag = botTag;
  }

  private now(): number {
    return (this.runtime.opts.now ?? Date.now)();
  }

  get started(): boolean { return this.runId !== null; }
  get done(): boolean { return this.finalized; }
  /** The sim ended the run (a winner or a draw): the Room arms its grace timer. */
  get ended(): boolean { return this.rec.endAt >= 0; }

  /** Every event of a step (or of a leave between steps), before the Room's own handling (settle's bot early return). */
  onEvents(events: readonly SimEvent[]): void {
    if (this.finalized) return;
    for (const ev of events) {
      if (ev.type === "raidStarted") this.onRaidStarted();
      else if (ev.type === "raidEnded") this.endedAtEpoch = this.now();
      else if (ev.type === "resolved" || ev.type === "gv") noteRoomEvent(this.rec, ev);
    }
  }

  private onRaidStarted(): void {
    if (this.runId !== null) return;
    this.runId = randomUUID();
    this.startedAtEpoch = this.now();
    for (let s = 0; s < this.rec.n; s++) {
      const id = this.rec.ids[s]!;
      if (this.rec.bots[s]) {
        const tag = this.botTag?.(id);
        if (tag) this.tags.set(id, tag);
      } else this.afk.set(id, { last: this.startedAtEpoch, ms: 0 });
    }
  }

  /** An input the sim accepted from this client (a human's presence). */
  noteInput(id: string): void {
    const clock = this.afk.get(id);
    if (!clock || this.finalized) return;
    const t = this.now();
    const gap = t - clock.last;
    if (gap > AFK_IDLE_MS) clock.ms += gap - AFK_IDLE_MS;
    clock.last = t;
  }

  noteDrop(id: string): void {
    if (!this.started || this.finalized) return;
    const n = this.net.get(id) ?? { drops: 0, reconnects: 0 };
    n.drops++;
    this.net.set(id, n);
  }

  noteReconnect(id: string): void {
    if (!this.started || this.finalized) return;
    const n = this.net.get(id) ?? { drops: 0, reconnects: 0 };
    n.reconnects++;
    this.net.set(id, n);
  }

  /** The client's one perf message of the run: true when it was kept. */
  notePerf(id: string, msg: unknown): boolean {
    if (!this.started || this.finalized || this.perf.has(id) || !this.rec.slotOf.has(id)) return false;
    const sample = sanitizeClientPerf(msg);
    if (!sample) return false;
    this.perf.set(id, sample);
    return true;
  }

  /**
   * Builds the record and submits it, once. `end`: the Room's own end (a shutdown's void, a dispose mid-run's abandon); the
   * sim's winner or draw otherwise. Null (and nothing sent) for a run that never started or was already sent.
   */
  finalize(end?: "void" | "abandoned"): RunRecord | null {
    if (this.finalized || this.runId === null) return null;
    this.finalized = true;
    let draft;
    try {
      draft = telemetryDraft(this.world, this.rec, end);
    } catch (err) {
      console.error("[telemetry] could not assemble a run record:", err);
      return null;
    }
    if (!draft) return null;
    const opts = this.runtime.opts;
    const endedAtEpoch = this.endedAtEpoch > 0 ? this.endedAtEpoch : this.now();
    const players: PlayerRecord[] = draft.players.map(({ id, profile, ...p }) => {
      const tag = this.tags.get(id);
      const clock = this.afk.get(id);
      let afkMs = 0;
      if (clock && !p.bot) {
        const until = Math.min(endedAtEpoch, this.startedAtEpoch + p.aliveMs);
        const trailing = until - clock.last;
        afkMs = clock.ms + (trailing > AFK_IDLE_MS ? trailing - AFK_IDLE_MS : 0);
      }
      const client = this.perf.get(id);
      return {
        ...p,
        pid: p.bot ? null : pidOf(opts.salt, profile),
        ...(tag ? { tier: tag.tier, persona: tag.persona } : {}),
        net: this.net.get(id) ?? { drops: 0, reconnects: 0 },
        ...(client ? { client } : {}),
        afkMs: Math.round(afkMs),
        afk: !p.bot && afkMs >= Math.max(AFK_FLAG_MIN_MS, AFK_FLAG_SHARE * p.aliveMs),
      };
    });
    const record: RunRecord = {
      ...draft,
      runId: this.runId,
      source: opts.source,
      build: opts.build,
      startedAtEpoch: this.startedAtEpoch,
      endedAtEpoch,
      config: { ...draft.config, botsFillTo: opts.botsFillTo },
      players,
    };
    opts.sink.submit(record);
    return record;
  }
}
