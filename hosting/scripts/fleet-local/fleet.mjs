#!/usr/bin/env node
// A local "fleet" with no AWS (docs/hosting/DEPLOYMENT.md section 6, SCALING.md section 6). Each container group is the real image
// content run natively: the fakesdk glbridge (which plays GameLift for that group over its loopback script port) supervising a
// real `rh-server --max-rooms 1 --require-admit`. This file is the fake fleet manager: it plays GameLift's fleet service
// (placement, scale-out, scale-in of idle groups only, rolling deployment, rollback) and drives real matches with the real
// one-seat client (crates/rh-server/examples/fleet_client.rs).
//
//   node fleet.mjs lifecycle|deploy|rollback-canary|rollback-mid [--bin-dir D] [--out D]
//
// Every scenario prints PASS/FAIL checks and exits 1 on any FAIL. All processes are started in their own process group and are
// killed on exit; the last step greps for leftovers (pgrep, docker ps). Nothing here touches the network beyond 127.0.0.1.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { decide, DEFAULTS } from './policy.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const scenario = argv[0];
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const binDir = opt('--bin-dir', path.join(root, 'target/fleet-local/bin'));
const outDir = opt('--out', path.join(root, 'target/fleet-local/run-' + scenario));
const BOTS = Number(opt('--bots', 8)); // bots a session is filled to (fillBotsTo)
// The slice has no natural end within minutes (no sudden death yet, docs/backlog P-ARENA-1; an idle human among 7 scripted bots did not
// end a match in 3+ minutes). So a match here ends when its one human quits after PLAY seconds of a real, ticking match: the room then
// closes by itself (`abandoned`). What the proof checks is that the FLEET never ends a match: no abort, no crash, no early drop.
const PLAY = Number(opt('--play-secs', 14));
const TAG = `rhfleet${process.pid}`; // goes into every --instance-id so leftovers can be found by pgrep
const map = path.join(root, 'parity/maps/seed1.map.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const eventsFile = fs.openSync(path.join(outDir, 'events.jsonl'), 'a');
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(2);
function log(ev, data = {}) {
  const line = JSON.stringify({ t: Number(ts()), ev, ...data });
  fs.writeSync(eventsFile, line + '\n');
  console.log(`[${ts().padStart(6)}s] ${ev} ${Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')}`);
}
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  log(ok ? 'PASS' : 'FAIL', { check: name, detail });
}
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
    s.on('error', rej);
  });
}
async function http(port, method, p, body) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: String(e) };
  }
}
async function waitFor(what, ms, f) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await f()) return true;
    await sleep(100);
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------------
class Group {
  constructor(fleet, build, bad) {
    this.fleet = fleet;
    this.build = build;
    this.bad = bad;
    this.id = `g${++fleet.seq}`;
    this.state = 'starting'; // starting | idle | active | draining | exited | failed
    this.since = Date.now();
    this.session = null;
    this.exit = null;
    this.metrics = {};
    this.lastDropped = 0;
    this.terminateSent = false;
    this.created = Date.now();
  }
  idleFor() { return this.state === 'idle' ? Date.now() - this.since : 0; }
  set(state) { this.state = state; this.since = Date.now(); }
  calls() {
    try { return fs.readFileSync(this.callsFile, 'utf8').split('\n').filter(Boolean); } catch { return []; }
  }
  async start() {
    const f = this.fleet;
    this.ports = { game: await freePort(), control: await freePort(), script: await freePort() };
    this.callsFile = path.join(outDir, `${this.id}.calls`);
    const logFd = fs.openSync(path.join(outDir, `${this.id}.log`), 'a');
    const args = [
      '--server-bin', path.join(binDir, `rh-server-${this.build}`),
      '--control-addr', `127.0.0.1:${this.ports.control}`,
      '--game-port', String(this.ports.game),
      // A "flag that makes the build unhealthy": an arena the server refuses to host. rh-server exits non-zero before it is
      // ever Ready, so the bridge never calls ProcessReady and the group never becomes healthy.
      '--map', this.bad ? '/nonexistent/arena.map.json' : map,
      '--poll-interval', '100ms', '--admit-interval', '100ms', '--drain-deadline', '120s',
      '--', '--lobby-seconds', '1', '--min-players', '1', '--fill-seconds', '0', '--instance-id', `${TAG}-${this.id}-${this.build}`,
      // The bridge binds 0.0.0.0 and the local fleet runs dev auth: rh-server refuses that on a public bind without this opt-in.
      '--insecure-dev-auth',
    ];
    this.proc = spawn(path.join(binDir, 'glbridge-fake'), args, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, GLBRIDGE_FAKE_ADDR: `127.0.0.1:${this.ports.script}`, GLBRIDGE_FAKE_CALLS: this.callsFile },
    });
    this.exited = new Promise((res) => this.proc.on('exit', (code, sig) => {
      this.exit = { code, sig, at: Date.now() };
      const wasReady = this.state !== 'starting';
      if (this.state === 'starting') this.state = 'failed'; else this.state = 'exited';
      log('group exit', { group: this.id, build: this.build, code, sig, wasReady });
      res();
    }));
    log('group start', { group: this.id, build: this.build, bad: this.bad, ports: this.ports, pid: this.proc.pid });
    this.ready = this.#waitReady(f.readyTimeoutMs);
    return this;
  }
  async #waitReady(ms) {
    const ok = await waitFor('ready', ms, async () => {
      if (this.exit) return true;
      if (!this.calls().some((c) => c.startsWith('ProcessReady:'))) return false;
      const h = await http(this.ports.control, 'GET', '/control/health');
      return h.status === 200;
    });
    if (!ok || this.exit) {
      log('group not healthy', { group: this.id, build: this.build, exited: !!this.exit });
      if (this.state === 'starting') this.state = 'failed';
      this.kill();
      return false;
    }
    this.set('idle');
    log('group ready', { group: this.id, build: this.build, startupMs: Date.now() - this.created });
    return true;
  }
  kill() {
    if (this.proc && !this.exit) { try { process.kill(-this.proc.pid, 'SIGTERM'); } catch { /* gone */ } }
  }
  hardKill() {
    if (this.proc && !this.exit) { try { process.kill(-this.proc.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  /** GameLift's OnProcessTerminate (scale-in, deployment, unhealthy). The bridge drains rh-server and exits when the room closes. */
  async terminate(why) {
    if (this.terminateSent || this.exit) return;
    this.terminateSent = true;
    const wasActive = this.state === 'active';
    if (this.state === 'idle' || this.state === 'active') this.set('draining');
    log('terminate', { group: this.id, build: this.build, why, activeSession: wasActive ? this.session?.id : null });
    await http(this.ports.script, 'POST', '/terminate');
  }
  async pollMetrics() {
    if (this.exit || this.state === 'starting') return;
    const h = await http(this.ports.control, 'GET', '/control/health');
    const m = h.json?.metrics;
    if (!m) return;
    const dropped = m.droppedSteps ?? 0;
    this.metrics = { latenessP99Us: m.latenessUs?.p99 ?? 0, droppedStepsDelta: dropped - this.lastDropped, rssBytes: m.rssBytes ?? 0, steps: m.steps ?? 0 };
    this.lastDropped = dropped;
    this.fleet.peak.rss = Math.max(this.fleet.peak.rss, this.metrics.rssBytes);
    this.fleet.peak.latenessP99Us = Math.max(this.fleet.peak.latenessP99Us, this.metrics.latenessP99Us);
    this.fleet.peak.dropped += Math.max(0, this.metrics.droppedStepsDelta);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
class Fleet {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.seq = 0;
    this.groups = [];
    this.queue = [];
    this.results = [];
    this.target = 'A';
    this.readyTimeoutMs = 20000;
    this.joinDelays = [];
    this.scaleInTargets = []; // [{group, state at the time}] every scale-in decision, to prove only idle groups are ever named
    this.peak = { rss: 0, latenessP99Us: 0, dropped: 0, groups: 0 };
    this.badStarts = new Set(); // nth start of a B group that gets the unhealthy flag
    this.bStarts = 0;
    this.timer = null;
    this.deploying = false;
    this.sessionSeq = 0;
    this.paused = false;
  }
  live() { return this.groups.filter((g) => !g.exit && g.state !== 'failed'); }
  async startGroup(build) {
    if (build === 'B') this.bStarts += 1;
    const g = new Group(this, build, build === 'B' && this.badStarts.has(this.bStarts));
    this.groups.push(g);
    this.peak.groups = Math.max(this.peak.groups, this.live().length);
    await g.start();
    return g;
  }
  /** A session request from the backend (the placement service). Resolves with the session record when the match closed. */
  submit(opts = {}) {
    const n = ++this.sessionSeq;
    const req = { n, id: `arn:local:game-session/${this.target}-${n}`, callsigns: [`p${n}x`], bots: opts.bots ?? BOTS, queuedAt: Date.now(), tag: opts.tag ?? '', playSecs: opts.playSecs ?? PLAY };
    req.done = new Promise((res) => (req.resolve = res));
    this.queue.push(req);
    log('session requested', { n, queue: this.queue.length });
    return req;
  }
  async tick() {
    if (this.paused) return;
    await Promise.all(this.live().map((g) => g.pollMetrics()));
    // rssBytes in /control/health is Linux-only (null on macOS), so the local proof reads the real rh-server RSS from ps.
    try {
      const ps = execFileSync('ps', ['-axo', 'rss=,command='], { encoding: 'utf8' }).split('\n');
      for (const g of this.live()) {
        const line = ps.find((l) => l.includes(`rh-server`) && l.includes(`--instance-id ${TAG}-${g.id}-`));
        if (line && g.metrics) {
          g.metrics.rssBytes = Number(line.trim().split(/\s+/)[0]) * 1024;
          this.peak.rss = Math.max(this.peak.rss, g.metrics.rssBytes);
        }
      }
    } catch { /* no ps */ }
    // Placement: queued requests take an idle group of the build the fleet currently targets, skipping guardrail-avoided groups.
    const avoid = new Set(decide(this.#state(), this.cfg).avoid);
    for (const req of [...this.queue]) {
      const g = this.groups.find((x) => x.state === 'idle' && x.build === this.target && !avoid.has(x.id));
      if (!g) break;
      this.queue.splice(this.queue.indexOf(req), 1);
      this.#run(g, req);
    }
    if (this.deploying) return; // the deployer owns capacity while a rollout runs
    const d = decide(this.#state(), this.cfg);
    const key = d.reasons.join('|');
    if (key && key !== this.lastGuard) log('guardrail', { reasons: d.reasons });
    this.lastGuard = key;
    for (let i = 0; i < d.scaleOut; i++) {
      log('scale out', { build: this.target, idleWanted: d.idleWanted, queued: this.queue.length });
      void this.startGroup(this.target);
    }
    for (const id of d.scaleIn) {
      const g = this.groups.find((x) => x.id === id);
      this.scaleInTargets.push({ id, state: g.state, session: g.session?.id ?? null });
      log('scale in', { group: id, state: g.state });
      void g.terminate('scale-in of an idle group');
    }
  }
  #state() {
    const mine = this.groups.filter((g) => g.build === this.target && !g.exit && g.state !== 'failed' && g.state !== 'draining');
    const recent = this.joinDelays.slice(-20).sort((a, b) => a - b);
    return {
      groups: mine.filter((g) => g.state === 'idle' || g.state === 'active').map((g) => ({ id: g.id, state: g.state, idleForMs: g.idleFor(), metrics: g.metrics })),
      starting: mine.filter((g) => g.state === 'starting').length,
      queued: this.queue.length,
      joinP95Ms: recent.length >= 3 ? recent[Math.floor(recent.length * 0.95)] : null,
    };
  }
  start() { this.timer = setInterval(() => void this.tick().catch((e) => log('tick error', { e: String(e) })), 400); }
  stop() { clearInterval(this.timer); }

  async #run(g, req) {
    g.set('active');
    g.session = req;
    const rec = { n: req.n, id: req.id, group: g.id, build: g.build, startedAt: Date.now(), waitedMs: Date.now() - req.queuedAt, tag: req.tag };
    log('session start', { n: req.n, group: g.id, build: g.build, waitedMs: rec.waitedMs });
    const sp = g.ports.script, cp = g.ports.control;
    await http(sp, 'POST', '/start', { id: req.id, maxPlayers: 8, properties: { fillBotsTo: String(req.bots) } });
    const activated = await waitFor('activate', 10000, async () => g.calls().includes('Activate'));
    const reservedAt = Date.now();
    for (const c of req.callsigns) await http(sp, 'POST', '/reserve', { id: `psess-${c}`, playerId: c });
    const clients = req.callsigns.map((c) => this.client(g, c, { maxSecs: 240, leaveAfter: req.playSecs }).then((r) => { if (r.welcomeAt) this.joinDelays.push(r.welcomeAt - reservedAt); return r; }));
    // Watch the room until it is closed (the bridge then ends the process: ProcessEnding, Destroy, exit 0).
    let room = null, sawDraining = false;
    for (;;) {
      const r = await http(cp, 'GET', '/control/rooms');
      if (r.json) {
        room = r.json.rooms?.[0] ?? room;
        if (r.json.draining) sawDraining = true;
        if (room?.phase === 'closed') break;
      } else if (g.exit) break; // the control port is gone and so is the process
      await sleep(80); // fast: a closed room is only visible for a few ms before the bridge ends the process
    }
    const humans = await Promise.all(clients);
    await Promise.race([g.exited, sleep(15000)]);
    Object.assign(rec, {
      endedAt: Date.now(), activated, endingCalled: g.calls().includes('ProcessEnding'), phase: room?.phase, endReason: room?.endReason ?? null, sawDraining,
      humans: humans.map((h) => ({ callsign: h.callsign, code: h.code, result: h.result, left: h.left, rejects: h.rejects })),
      steps: g.metrics.steps ?? 0,
      groupExitCode: g.exit?.code ?? null, groupGone: !!g.exit, interrupted: g.exit ? g.exit.code !== 0 : false,
    });
    this.results.push(rec);
    log('session end', { n: req.n, group: g.id, build: g.build, phase: rec.phase, endReason: rec.endReason, stayedUntilQuit: humans.every((h) => h.left), steps: g.metrics.steps ?? 0, seconds: ((rec.endedAt - rec.startedAt) / 1000).toFixed(1), groupExit: rec.groupExitCode });
    req.resolve(rec);
  }

  /** One real game client; retries the documented "not admitted" refusal for a few seconds (the bridge admits on its poll). */
  async client(g, callsign, { maxSecs = 120, leaveAfter = null, noRetry = false } = {}) {
    const out = { callsign, code: null, result: false, left: false, welcomeAt: null, rejects: [] };
    for (let attempt = 0; attempt < (noRetry ? 1 : 25); attempt++) {
      const args = ['--url', `ws://127.0.0.1:${g.ports.game}/ws`, '--callsign', callsign, '--max-secs', String(maxSecs)];
      if (leaveAfter != null) args.push('--leave-after-secs', String(leaveAfter));
      const evs = [];
      const code = await new Promise((res) => {
        const p = spawn(path.join(binDir, 'fleet_client'), args, { stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = '';
        p.stdout.on('data', (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            try {
              const e = JSON.parse(buf.slice(0, i));
              evs.push(e);
              if (e.ev === 'welcome') out.welcomeAt ??= Date.now(); // stamped when it arrives, not when the client exits
            } catch { /* ignore */ }
            buf = buf.slice(i + 1);
          }
        });
        p.on('exit', (c) => res(c));
        p.on('error', () => res(99));
      });
      out.code = code;
      if (evs.some((e) => e.ev === 'result')) out.result = true;
      if (evs.some((e) => e.ev === 'left')) out.left = true;
      const rej = evs.find((e) => e.ev === 'reject');
      if (rej) out.rejects.push(`${rej.code}:${rej.reason}`);
      if (rej && rej.reason === 'not admitted' && !noRetry) { await sleep(250); continue; }
      break;
    }
    return out;
  }

  /** Probes a draining group with a live session: it must refuse a new session, an admit and a new player, and keep the match. */
  async probeDraining(g, label) {
    const sid = g.session?.id;
    const a = await http(g.ports.control, 'POST', '/control/session', { v: 1, gameSessionId: 'arn:local:probe-new', properties: {} });
    const b = await http(g.ports.control, 'POST', '/control/admit', { v: 1, gameSessionId: sid, playerSessionId: 'psess-intruder', callsign: 'intruder' });
    const c = await this.client(g, 'intruder', { maxSecs: 10, noRetry: true });
    const rooms = await http(g.ports.control, 'GET', '/control/rooms');
    const room = rooms.json?.rooms?.[0];
    check(`${label}: draining group refuses a new session (409 draining)`, a.status === 409 && a.json?.error?.code === 'draining', `${a.status} ${a.json?.error?.code}`);
    check(`${label}: draining group refuses an admit (409 draining)`, b.status === 409 && b.json?.error?.code === 'draining', `${b.status} ${b.json?.error?.code}`);
    check(`${label}: draining group refuses a new player's Hello`, c.rejects.length === 1 && c.code === 3, `exit=${c.code} ${c.rejects.join(',')}`);
    check(`${label}: the running match survives the probes (room still ${room?.phase})`, room && (room.phase === 'active' || room.phase === 'lobby'), `phase=${room?.phase} draining=${rooms.json?.draining}`);
  }

  async waitIdleOrDone(ms) { await waitFor('idle', ms, async () => this.live().every((g) => g.state !== 'starting')); }

  async scaleToZeroAndWait(ms = 60000) {
    this.cfg = { ...this.cfg, warmMin: 0, warmMax: 0, minGroups: 0, idleScaleInMs: 500 };
    const ok = await waitFor('zero', ms, async () => this.live().length === 0 && this.queue.length === 0);
    return ok;
  }

  // ---- rolling deployment from this.target to `to` (docs/hosting/DEPLOYMENT.md section 3) --------------------------------
  async deploy(to) {
    const from = this.target;
    this.deploying = true;
    const startedAt = (this.deployStartedAt = Date.now());
    const summary = { to, from, ok: false, stage: 'canary', replaced: 0, aborted: null };
    log('deploy begin', { from, to });
    // 1. canary: one group of the new build must become ready and serve a real session (join, seat, accept) before anything changes.
    const canary = await this.startGroup(to);
    const ready = await canary.ready;
    let canaryOk = false;
    if (ready) {
      await http(canary.ports.script, 'POST', '/start', { id: 'arn:local:canary', maxPlayers: 4, properties: { fillBotsTo: '0' } });
      await waitFor('activate', 10000, async () => canary.calls().includes('Activate'));
      await http(canary.ports.script, 'POST', '/reserve', { id: 'psess-canary', playerId: 'canary' });
      canary.set('active'); canary.session = { id: 'arn:local:canary' };
      const c = await this.client(canary, 'canary', { maxSecs: 30, leaveAfter: 2 });
      canaryOk = c.welcomeAt != null && canary.calls().includes('Accept:psess-canary');
      await Promise.race([canary.exited, sleep(15000)]);
      log('canary', { group: canary.id, welcome: c.welcomeAt != null, accepted: canary.calls().includes('Accept:psess-canary'), exit: canary.exit?.code });
    }
    if (!ready || !canaryOk) {
      summary.aborted = ready ? 'canary session failed' : 'canary group never became healthy';
      return this.#rollback(summary, from, to);
    }
    // 2. the new build takes all new placements; old groups are drained one wave at a time, each replaced first (surge).
    summary.stage = 'rolling';
    this.target = to;
    // Worst case first: groups with a running match are replaced before the idle ones.
    const old = this.groups.filter((g) => g.build === from && !g.exit && g.state !== 'failed' && !g.terminateSent).sort((a, b) => (b.state === 'active') - (a.state === 'active'));
    log('rolling', { old: old.map((g) => `${g.id}:${g.state}`) });
    for (const g of old) {
      const repl = await this.startGroup(to);
      const ok = await repl.ready;
      if (!ok) {
        summary.aborted = `replacement ${repl.id} for ${g.id} never became healthy`;
        return this.#rollback(summary, from, to);
      }
      const wasActive = g.state === 'active';
      // Never kill: terminate = OnProcessTerminate. An active match plays out, an idle group exits at once.
      await g.terminate(`deployment ${from}->${to}`);
      if (wasActive) {
        await waitFor('draining', 5000, async () => (await http(g.ports.control, 'GET', '/control/rooms')).json?.draining === true);
        await this.probeDraining(g, `deploy ${g.id}`);
      }
      summary.replaced += 1;
      log('wave', { replaced: g.id, by: repl.id, wasActive });
    }
    // 3. complete when every old group is gone (active ones finish their matches first).
    const drained = await waitFor('old gone', 240000, async () => this.groups.filter((g) => g.build === from).every((g) => g.exit));
    summary.ok = drained;
    summary.stage = 'complete';
    summary.ms = Date.now() - startedAt;
    this.deploying = false;
    log('deploy end', summary);
    return summary;
  }

  async #rollback(summary, from, to) {
    summary.stage = 'rollback';
    log('rollback begin', { reason: summary.aborted, from, to });
    this.target = from; // new placements go to the old build again
    for (const g of this.groups.filter((x) => x.build === to && !x.exit && x.state !== 'failed')) {
      if (g.state === 'idle' || g.state === 'starting') void g.terminate('rollback: remove the new build');
    }
    // Groups of the old build that were already drained are replaced by old-build groups (the policy does this from demand and
    // the warm floor); a drained group's active match is untouched either way.
    await waitFor('new build gone', 60000, async () => this.groups.filter((g) => g.build === to).every((g) => g.exit || g.state === 'failed'));
    summary.ok = false;
    summary.rolledBack = true;
    summary.ms = Date.now() - this.deployStartedAt;
    this.deploying = false;
    log('rollback end', { target: this.target, newBuildGroupsLeft: this.groups.filter((g) => g.build === to && !g.exit && g.state !== 'failed').length });
    return summary;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
function leftovers() {
  let pg = '';
  try { pg = execFileSync('pgrep', ['-fl', TAG], { encoding: 'utf8' }); } catch { pg = ''; }
  const mine = pg.split('\n').filter((l) => l && !l.includes('pgrep'));
  // The proof starts no container (the groups are native processes of the real binaries). The shared Docker daemon may run other
  // people's containers, so the check is "none is ours" (nothing mentions TAG) and the counts are reported, not compared.
  let docker = { count: 'n/a', ours: [] };
  try {
    const rows = execFileSync('docker', ['ps', '--no-trunc', '--format', '{{.ID}} {{.Names}} {{.Command}}'], { encoding: 'utf8', timeout: 45000 }).trim().split('\n').filter(Boolean);
    docker = { count: rows.length, ours: rows.filter((r) => r.includes(TAG)) };
  } catch { /* docker unavailable */ }
  return { processes: mine, docker };
}

let fleet;
function cleanupAll() {
  if (!fleet) return;
  fleet.stop();
  for (const g of fleet.groups) g.hardKill();
}
process.on('SIGINT', () => { cleanupAll(); process.exit(130); });
process.on('SIGTERM', () => { cleanupAll(); process.exit(143); });
process.on('uncaughtException', (e) => { console.error(e); cleanupAll(); process.exit(1); });

function endedClean(r) {
  // finished, not interrupted: the human stayed seated until it chose to quit (the server never dropped it), the simulation really
  // ran (steps), the room was not closed by an abort or a crash, the bridge reported ProcessEnding and exited 0.
  return !r.interrupted && r.endingCalled && r.humans.every((h) => h.left) && r.steps >= 100 && !['ended_by_bridge', 'crashed'].includes(r.endReason) && r.groupExitCode === 0;
}

async function main() {
  if (!['one', 'lifecycle', 'deploy', 'rollback-canary', 'rollback-mid'].includes(scenario)) {
    console.error('usage: fleet.mjs lifecycle|deploy|rollback-canary|rollback-mid [--bin-dir D] [--out D]');
    process.exit(2);
  }
  const dockerBefore = leftovers().docker.count;
  fleet = new Fleet({ maxGroups: 5, warmMin: 1, warmMax: 2, idleScaleInMs: 3000, targetAvailablePct: 25 });
  fleet.start();
  log('scenario', { scenario, maxGroups: fleet.cfg.maxGroups, warmMin: fleet.cfg.warmMin, warmMax: fleet.cfg.warmMax, idleScaleInMs: fleet.cfg.idleScaleInMs, tag: TAG, outDir });
  if (scenario === 'one') { const r = await fleet.submit().done; log('one', { phase: r.phase, why: r.endReason, humans: r.humans }); }
  else if (scenario === 'lifecycle') await lifecycle();
  else if (scenario === 'deploy') await deployScenario();
  else await rollbackScenario(scenario === 'rollback-canary' ? 'canary' : 'mid');

  // ---- drain the fleet to zero and prove nothing is left ----
  const zero = await fleet.scaleToZeroAndWait(90000);
  fleet.stop();
  check('fleet scaled to zero groups', zero, `live=${fleet.live().length}`);
  const left = leftovers();
  check('no glbridge/rh-server process left (pgrep)', left.processes.length === 0, left.processes.join(' | '));
  check('no docker container of this run exists (docker ps)', left.docker.ours.length === 0, `containers on the shared daemon before=${dockerBefore} after=${left.docker.count}; ours=${left.docker.ours.length}`);
  const busy = fleet.scaleInTargets.filter((t) => t.state !== 'idle' || t.session);
  check(`scale-in only ever selected idle groups (${fleet.scaleInTargets.length} decisions)`, busy.length === 0, JSON.stringify(busy));
  const bad = fleet.results.filter((r) => !endedClean(r));
  check(`every session that started ran to the player's own quit with a clean group exit (never aborted or dropped by the fleet) (${fleet.results.length} sessions)`, bad.length === 0, JSON.stringify(bad.map((r) => ({ n: r.n, group: r.group, phase: r.phase, endReason: r.endReason, interrupted: r.interrupted }))));
  log('peaks', { groups: fleet.peak.groups, rssMiB: (fleet.peak.rss / 1048576).toFixed(1), latenessP99Us: fleet.peak.latenessP99Us, droppedSteps: fleet.peak.dropped });
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ scenario, checks, sessions: fleet.results, peaks: fleet.peak, wallSeconds: Number(ts()) }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${scenario}: ${checks.length - failed.length}/${checks.length} checks passed in ${ts()} s; raw output ${outDir}`);
  cleanupAll();
  process.exit(failed.length ? 1 : 0);
}

// Scenario 1: scale-out from demand, scale-in of idle groups only, an active match is never touched.
async function lifecycle() {
  // Phase 1: a burst of 3 long sessions against an empty fleet: groups are launched from the queue (plus the warm group).
  const first = [fleet.submit({ playSecs: 28 }), fleet.submit({ playSecs: 28 }), fleet.submit({ playSecs: 28 })];
  await waitFor('3 active', 30000, async () => fleet.groups.filter((g) => g.state === 'active').length >= 3);
  check('scale-out launched one group per queued session', fleet.groups.filter((g) => g.state === 'active').length === 3, `active=${fleet.groups.filter((g) => g.state === 'active').length} peak=${fleet.peak.groups}`);
  // Phase 2: raise the warm floor so idle groups pile up next to the 3 active matches (capped by maxGroups), then drop it to zero:
  // the idle ones must be released and the active ones must not be touched.
  fleet.cfg = { ...fleet.cfg, warmMin: 3, warmMax: 3 };
  await waitFor('warm pool', 20000, async () => fleet.groups.filter((g) => g.state === 'idle').length >= 2);
  const active = fleet.groups.filter((g) => g.state === 'active');
  const idleIds = fleet.groups.filter((g) => g.state === 'idle').map((g) => g.id);
  check('the fleet is at its cap while 3 matches run', fleet.live().length <= fleet.cfg.maxGroups && idleIds.length >= 2, `live=${fleet.live().length} max=${fleet.cfg.maxGroups} idle=${idleIds.join(',')} active=${active.map((g) => g.id).join(',')}`);
  log('lowering the warm floor to zero', { active: active.map((g) => g.id), idle: idleIds });
  fleet.cfg = { ...fleet.cfg, warmMin: 0, warmMax: 0, minGroups: 0, idleScaleInMs: 1500 };
  await waitFor('idle released', 30000, async () => idleIds.every((id) => fleet.groups.find((g) => g.id === id).exit));
  check('every idle group was released (scale-in)', idleIds.every((id) => fleet.groups.find((g) => g.id === id).exit), `released=${idleIds.filter((id) => fleet.groups.find((g) => g.id === id).exit).join(',')}`);
  check('all 3 matches are still running after the scale-in (none touched)', active.every((g) => g.state === 'active' && !g.exit), active.map((g) => `${g.id}:${g.state}:${g.exit ? 'exited' : 'up'}`).join(' '));
  await Promise.all(first.map((r) => r.done));
  check('all 3 matches ran to the player\'s own quit', fleet.results.length === 3 && fleet.results.every(endedClean), `finished=${fleet.results.length}`);
}

async function warmFleet(n) {
  fleet.cfg = { ...fleet.cfg, warmMin: n, warmMax: n };
  await waitFor('warm', 30000, async () => fleet.groups.filter((g) => g.state === 'idle').length >= n);
}

// Scenario 2: rolling deployment A -> B with active matches running.
async function deployScenario() {
  await warmFleet(2);
  const live = [fleet.submit(), fleet.submit()];
  await waitFor('two active', 30000, async () => fleet.groups.filter((g) => g.state === 'active').length >= 2);
  fleet.cfg = { ...fleet.cfg, warmMin: 2, warmMax: 2 };
  await waitFor('idle warm', 20000, async () => fleet.groups.filter((g) => g.state === 'idle').length >= 1);
  log('fleet before the deployment', { groups: fleet.live().map((g) => `${g.id}:${g.build}:${g.state}`) });
  const activeA = fleet.groups.filter((g) => g.state === 'active').map((g) => g.id);
  const dep = await fleet.deploy('B');
  check('deployment A->B completed', dep.ok, JSON.stringify(dep));
  await Promise.all(live.map((r) => r.done));
  const onA = fleet.results.filter((r) => activeA.includes(r.group));
  check('the matches that were active on A finished (not interrupted) while A drained', onA.length === 2 && onA.every(endedClean), JSON.stringify(onA.map((r) => ({ g: r.group, phase: r.phase, why: r.endReason, left: r.humans.map((h) => h.left) }))));
  // New demand after the deployment runs on build B only.
  const after = fleet.submit();
  const rec = await after.done;
  check('a session placed after the deployment ran on build B', rec.build === 'B' && endedClean(rec), `build=${rec.build} group=${rec.group}`);
  check('no group of build A is left', fleet.groups.filter((g) => g.build === 'A').every((g) => g.exit), '');
}

// Scenarios 3 and 4: build B is unhealthy; the rollout stops and the fleet is back on A.
async function rollbackScenario(kind) {
  await warmFleet(2);
  const live = [fleet.submit(), fleet.submit()];
  await waitFor('two active', 30000, async () => fleet.groups.filter((g) => g.state === 'active').length >= 2);
  fleet.cfg = { ...fleet.cfg, warmMin: 2, warmMax: 2 };
  await waitFor('idle warm', 20000, async () => fleet.groups.filter((g) => g.state === 'idle').length >= 1);
  fleet.readyTimeoutMs = 8000;
  // canary: the first B group (the canary) is bad. mid: canary and the first replacement are fine, the second replacement is bad,
  // so one old group was already drained when the gate trips.
  fleet.badStarts = new Set(kind === 'canary' ? [1] : [3]);
  const activeA = fleet.groups.filter((g) => g.state === 'active').map((g) => g.id);
  const dep = await fleet.deploy('B');
  check(`rollout stopped at the ${kind === 'canary' ? 'canary' : 'second replacement'} health gate`, !dep.ok && dep.rolledBack === true, JSON.stringify(dep));
  check('the fleet targets build A again', fleet.target === 'A', `target=${fleet.target}`);
  check('no group of build B is left running', fleet.groups.filter((g) => g.build === 'B').every((g) => g.exit || g.state === 'failed'), '');
  await Promise.all(live.map((r) => r.done));
  const onA = fleet.results.filter((r) => activeA.includes(r.group));
  check('the matches active on A before the failed rollout finished untouched', onA.length === 2 && onA.every(endedClean), JSON.stringify(onA.map((r) => ({ g: r.group, phase: r.phase, why: r.endReason }))));
  const after = fleet.submit();
  const rec = await after.done;
  check('a session placed after the rollback runs on build A', rec.build === 'A' && endedClean(rec), `build=${rec.build} group=${rec.group}`);
}

main().catch((e) => { console.error(e); cleanupAll(); process.exit(1); });
