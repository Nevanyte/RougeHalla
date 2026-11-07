/** Trusted setup probes of the actual installed `teleported` chain, NOT ordinary gameplay intake.
 *
 * Installs the explicit legacy module list (`HOLY_MODULES`: the default modules plus `factions`, in the recorded
 * install order), builds one world per case, applies the case's trusted private faction state, reads it back as
 * `before`, fires the actual installed hook (or the actual coliseum producer for the producer case), and records the
 * state again as `after` plus the two ordinary-heal lockout probes.
 *
 * Run only under the pinned Linux x64 Node 22.23.4 container (see tools/faction-fixtures/README.md).
 */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {mapFromTiles, SIG_BURNING, SIG_CHILLED, SIG_EXEC_BLOCKED, TILE_FLOOR, TICK_MS} from '@raid/shared';
import {createScenarioWorld} from '../../parity/legacy-capture/world';
import {HOLY_MODULES} from '../../parity/legacy-capture/scenarios/holy';
import {addPlayer, step} from '../../packages/server/src/sim/step';
import {combatant} from '../../packages/server/src/sim/combatant';
import {heal, noteContact, startHealOverTime} from '../../packages/server/src/sim/factions';
import {teleportToColiseum} from '../../packages/server/src/sim/arena';

if (process.version !== 'v22.23.4' || process.platform !== 'linux' || process.arch !== 'x64') {
  throw Error('requires Linux x64 Node22.23.4');
}

const NOW = 10000;
const FIGHTERS: Array<[string, 'sentenced' | 'holy' | 'frost']> = [
  ['p0', 'sentenced'],
  ['p1', 'holy'],
  ['p2', 'frost'],
];

function scene() {
  const w = createScenarioWorld(
    {name: 'faction-teleport-probe', randomSeed: 12, modules: HOLY_MODULES, players: []} as any,
    mapFromTiles(24, 20, new Uint8Array(24 * 20).fill(TILE_FLOOR), 11),
  );
  for (const [id, faction] of FIGHTERS) addPlayer(w, id, id, {faction});
  step(w, TICK_MS);
  step(w, TICK_MS);
  // noteContact is the actual exported helper: it creates the runtime entries we then set up.
  noteContact(w, 'p0', 'p1');
  noteContact(w, 'p2', 'p1');
  return w;
}

const inf = (v: any): any => (v === null || v === undefined ? -Infinity : v);
const num = (v: number): number | null => (Number.isFinite(v) ? v : null);
const byId = (w: any, id: string) => w.state.players.get(id)!;
const rtOf = (w: any, id: string) => w.players.get(id)!;
const sigOf = (w: any, id: string) => w.factions!.fighters.get(id)!;

function applySetup(w: any, setup: any): void {
  const s = w.state;
  s.serverTime = setup.serverTime;
  s.tick = setup.tick;
  for (const p of setup.players) {
    const st = byId(w, p.id);
    const rt = rtOf(w, p.id);
    st.status = 'alive';
    st.hp = p.hp;
    st.x = p.at.x;
    st.y = p.at.y;
    st.readyAt = p.readyAt;
    st.sig = p.wire.sig;
    st.brand = p.wire.brand;
    st.markTier = p.wire.markTier;
    st.markBy = p.wire.markBy;
    st.markTax = p.wire.markTax;
    st.frostMoveMult = p.wire.frostMoveMult;
    if (p.fired.length > 0) rt.fired = new Set(p.fired);
    const f = sigOf(w, p.id);
    const g = p.sig;
    f.target = g.target;
    f.inReach = g.inReach;
    f.engaged = g.engaged;
    f.reachAt = inf(g.reachAt);
    f.contactAt = inf(g.contactAt);
    f.combatAt = inf(g.combatAt);
    f.hpFrac = g.hpFrac;
    f.tier = g.tier;
    f.markGroup = g.markGroup;
    f.markGroupSize = g.markGroupSize;
    f.markHits = g.markHits;
    f.markProgress = g.markProgress;
    f.markSwaps = g.markSwaps;
    f.markDenied = g.markDenied;
    f.farSince = inf(g.farSince);
    f.ampUntil = g.ampUntil;
    f.chill = g.chill;
    f.chillers = [...g.chillers];
    f.chillExposureStartedAt = inf(g.exposureStartedAt);
    f.chillLastNearAt = inf(g.chillLastNearAt);
    f.rangedChillUntil = inf(g.rangedChillUntil);
    f.frostMoveMult = g.frostMoveMult;
    f.dotPausedUntil = g.dotPausedUntil;
    f.engagedOn = g.engagedOn;
    if (g.apHits > 0) {
      f.apHits = Array.from({length: g.apHits}, () => setup.serverTime);
      f.apHitsOn = g.target ?? undefined;
    }
  }
  for (const d of setup.dot) {
    w.factions!.dot.set(`${d.by}>${d.victim}>${d.sig}`, {victim: d.victim, by: d.by, sig: d.sig, weapon: d.weapon, amount: d.amount});
  }
  w.factions!.dotSince = setup.dotSince;
  if (setup.hot) {
    const c = combatant(w, setup.hot.id)!;
    startHealOverTime(w, c, setup.hot.amount, setup.hot.ms, setup.hot.ignoreLockout);
  }
}

function dump(w: any): any {
  const players = [...w.state.players.keys()].map((id: string) => {
    const st = byId(w, id);
    const rt = rtOf(w, id);
    const f = sigOf(w, id);
    return {
      id,
      // Modeled faction state: compared one-to-one by the Rust port.
      target: f.target,
      inReach: f.inReach,
      engaged: f.engaged,
      reachAt: num(f.reachAt),
      contactAt: num(f.contactAt),
      combatAt: num(f.combatAt),
      hpFrac: f.hpFrac,
      tier: f.tier,
      markHits: f.markHits,
      markProgress: f.markProgress,
      markSwaps: f.markSwaps,
      markDenied: f.markDenied,
      farSince: num(f.farSince),
      ampUntil: f.ampUntil,
      chill: f.chill,
      chillers: [...f.chillers],
      exposureStartedAt: num(f.chillExposureStartedAt),
      chillLastNearAt: num(f.chillLastNearAt),
      rangedChillUntil: num(f.rangedChillUntil),
      frostMoveMult: f.frostMoveMult,
      dotPausedUntil: f.dotPausedUntil,
      engagedOn: f.engagedOn ?? null,
      apHits: f.apHits?.length ?? 0,
      bits: st.sig,
      hp: st.hp,
      readyAt: st.readyAt,
      x: st.x,
      y: st.y,
      fired: [...(rt.fired ?? [])].sort(),
      hots: (rt.hots ?? []).length,
      // Source-only presentation/group state: the capture pins what the source hook does to it.
      markGroup: f.markGroup,
      markGroupSize: f.markGroupSize,
      brand: st.brand,
      markTier: st.markTier,
      markBy: st.markBy,
      markTax: st.markTax,
      wireFrostMoveMult: st.frostMoveMult,
    };
  });
  return {
    players,
    dotSince: w.factions!.dotSince,
    dot: [...w.factions!.dot.values()].map((d: any) => ({victim: d.victim, by: d.by, sig: d.sig, weapon: d.weapon, amount: d.amount})),
  };
}

const markedSetup = () => ({
  serverTime: NOW,
  tick: 200,
  players: [
    {
      id: 'p0',
      faction: 'sentenced',
      hp: 1085,
      readyAt: 9900,
      at: {x: 400, y: 320},
      fired: [],
      wire: {sig: SIG_BURNING, brand: 75, markTier: 3, markBy: 'p0', markTax: 12, frostMoveMult: 1000},
      sig: {
        target: 'p1', inReach: true, engaged: true, reachAt: NOW, contactAt: NOW - 100,
        combatAt: NOW - 2000, hpFrac: 0.83, tier: 3, markGroup: 'fighter:p1', markGroupSize: 1,
        markHits: 4, markProgress: 4, markSwaps: 1, markDenied: true, farSince: NOW - 200, ampUntil: NOW + 500,
        chill: 1, chillers: [], exposureStartedAt: null, chillLastNearAt: null, rangedChillUntil: null,
        frostMoveMult: 1, dotPausedUntil: 0, engagedOn: 'p1', apHits: 2,
      },
    },
    {
      id: 'p1',
      faction: 'holy',
      hp: 400,
      readyAt: 9950,
      at: {x: 456, y: 320},
      fired: ['secondWind'],
      wire: {sig: SIG_CHILLED, brand: 100, markTier: 4, markBy: 'p0', markTax: 7, frostMoveMult: 700},
      sig: {
        target: 'p0', inReach: true, engaged: true, reachAt: NOW, contactAt: NOW - 50,
        combatAt: NOW - 2500, hpFrac: 0.35, tier: 4, markGroup: 'fighter:p1', markGroupSize: 1,
        markHits: 9, markProgress: 9, markSwaps: 0, markDenied: false, farSince: null, ampUntil: 0,
        chill: 0.68, chillers: ['p2'], exposureStartedAt: NOW - 2000, chillLastNearAt: NOW - 100,
        rangedChillUntil: NOW + 400, frostMoveMult: 0.7, dotPausedUntil: NOW + 100, engagedOn: null, apHits: 0,
      },
    },
    {
      id: 'p2',
      faction: 'frost',
      hp: 985,
      readyAt: 10050,
      at: {x: 512, y: 320},
      fired: [],
      wire: {sig: SIG_BURNING | SIG_EXEC_BLOCKED, brand: 0, markTier: 0, markBy: '', markTax: 0, frostMoveMult: 1000},
      sig: {
        target: 'p1', inReach: true, engaged: true, reachAt: NOW, contactAt: NOW - 120,
        combatAt: NOW - 3000, hpFrac: 1, tier: 0, markGroup: null, markGroupSize: 1,
        markHits: 0, markProgress: 0, markSwaps: 0, markDenied: false, farSince: null, ampUntil: 0,
        chill: 1, chillers: [], exposureStartedAt: null, chillLastNearAt: null, rangedChillUntil: null,
        frostMoveMult: 1, dotPausedUntil: 0, engagedOn: null, apHits: 0,
      },
    },
  ],
  dot: [
    {victim: 'p1', by: 'p0', sig: 'mark', weapon: 'fists', amount: 12.5},
    {victim: 'p0', by: 'p1', sig: 'disease', weapon: 'wand', amount: 3.25},
  ],
  dotSince: NOW - 600,
  hot: {id: 'p1', amount: 100, ms: 2000, ignoreLockout: true},
});

const clearSetup = () => ({
  serverTime: NOW,
  tick: 200,
  players: [
    {
      id: 'p0', faction: 'sentenced', hp: 1085, readyAt: 9900, at: {x: 400, y: 320}, fired: [],
      wire: {sig: SIG_BURNING, brand: 50, markTier: 2, markBy: 'p0', markTax: 0, frostMoveMult: 1000},
      sig: {
        target: null, inReach: false, engaged: false, reachAt: null, contactAt: null, combatAt: NOW - 100,
        hpFrac: 1, tier: 0, markGroup: null, markGroupSize: 1, markHits: 0, markProgress: 0, markSwaps: 0,
        markDenied: false, farSince: null, ampUntil: 0, chill: 1, chillers: [], exposureStartedAt: null,
        chillLastNearAt: null, rangedChillUntil: null, frostMoveMult: 1, dotPausedUntil: 0,
        engagedOn: null, apHits: 0,
      },
    },
    {
      id: 'p1', faction: 'holy', hp: 1000, readyAt: 10000, at: {x: 456, y: 320}, fired: ['secondWind'],
      wire: {sig: 0, brand: 0, markTier: 0, markBy: '', markTax: 0, frostMoveMult: 1000},
      sig: {
        target: null, inReach: false, engaged: false, reachAt: null, contactAt: null, combatAt: NOW - 2999,
        hpFrac: 1, tier: 0, markGroup: null, markGroupSize: 1, markHits: 0, markProgress: 0, markSwaps: 0,
        markDenied: false, farSince: null, ampUntil: 0, chill: 1, chillers: [], exposureStartedAt: null,
        chillLastNearAt: null, rangedChillUntil: null, frostMoveMult: 1, dotPausedUntil: 0,
        engagedOn: null, apHits: 0,
      },
    },
    {
      id: 'p2', faction: 'frost', hp: 985, readyAt: 10000, at: {x: 512, y: 320}, fired: [],
      wire: {sig: SIG_CHILLED, brand: 0, markTier: 0, markBy: '', markTax: 0, frostMoveMult: 1000},
      sig: {
        target: null, inReach: false, engaged: false, reachAt: null, contactAt: null, combatAt: NOW - 100,
        hpFrac: 1, tier: 0, markGroup: null, markGroupSize: 1, markHits: 0, markProgress: 0, markSwaps: 0,
        markDenied: false, farSince: null, ampUntil: 0, chill: 1, chillers: [], exposureStartedAt: null,
        chillLastNearAt: null, rangedChillUntil: null, frostMoveMult: 1, dotPausedUntil: 0,
        engagedOn: null, apHits: 0,
      },
    },
  ],
  dot: [],
  dotSince: NOW,
  hot: null,
});

const cases = [
  {
    name: 'marked_chilled_locked',
    hook: 'teleported',
    positionsAfter: 'reset',
    setup: markedSetup(),
    heal: {id: 'p1', amount: 10, advanceMs: 600},
  },
  {
    name: 'clear_fighters',
    hook: 'teleported',
    positionsAfter: 'reset',
    setup: clearSetup(),
    heal: {id: 'p1', amount: 10, advanceMs: 2},
  },
  {
    name: 'producer_teleport',
    hook: 'teleportToColiseum',
    positionsAfter: 'teleport',
    setup: markedSetup(),
    heal: {id: 'p1', amount: 10, advanceMs: 600},
  },
];

function run(c: any): any {
  const w = scene();
  applySetup(w, c.setup);
  const before = dump(w);
  const eventsBefore = w.events.length;
  if (c.hook === 'teleportToColiseum') teleportToColiseum(w);
  else w.hooks.teleported!(w);
  const emitted = w.events.slice(eventsBefore).map((e: any) => e.type);
  const after = dump(w);
  const target = combatant(w, c.heal.id)!;
  const healWithin = heal(w, target, c.heal.amount);
  w.state.serverTime += c.heal.advanceMs;
  const healAfter = heal(w, target, c.heal.amount);
  return {
    name: c.name,
    hook: c.hook,
    positionsAfter: c.positionsAfter,
    setup: c.setup,
    before,
    after,
    emitted,
    heal: {
      id: c.heal.id,
      amount: c.heal.amount,
      withinLockout: healWithin,
      afterLockout: healAfter,
      advanceMs: c.heal.advanceMs,
    },
  };
}

const out = {
  format: 'rh-faction-teleport-reset/1',
  kind: 'trusted private faction setup; actual installed teleported chain (or actual coliseum producer); not ordinary gameplay intake',
  modules: HOLY_MODULES,
  provenance: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    nodeSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),
    sourceBaseline: 'packages/ byte-identical to the pinned capture source (host worktree checked out at the capture revision)',
  },
  cases: cases.map(run),
};
writeFileSync(process.argv[2] ?? 'parity/faction/teleport-reset.json', JSON.stringify(out, null, 2) + '\n');
console.log(`captured ${out.cases.length} actual installed teleport-reset cases`);
