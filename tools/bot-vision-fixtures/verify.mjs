// Raw-first verifier for the bot-vision witness. It reads ONLY the saved raw observations and the
// declared inputs; it imports no source and never changes or re-derives a recorded output.
// Structural checks prove the raw is complete and that every recorded input is exactly the declared
// one. Coverage checks prove each declared case actually reached its intended source branch. A FAIL
// keeps the raw; it is never a reason to edit expectations. This is not the parity judge: the
// native comparison lives in crates/rh-policy (temporal_percept/vision/source_tests.rs).
import { decode } from './codec.mjs';

export const RAW_FORMAT = 'rh-bot-vision-source/1';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function verify(raw, { manifestSha, declared }) {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) });
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? '' : String(r)); } catch (e) { check(name, false, `threw ${e?.message}`); } };

  check('format', raw.format === RAW_FORMAT && raw.codec === 'rh-vision-value/1' && raw.scenarioFormat === 'rh-bot-vision-scenario/1');
  check('manifest', raw.manifestSha256 === manifestSha);
  const want = decodeDeclared(declared);
  check('case ids', same(raw.cases?.map((c) => c.id), want.map((c) => c.id)));
  if (!Array.isArray(raw.cases) || raw.cases.length !== want.length) return finish(checks);

  // ---------------------------------------------------------------- structure: declared inputs only
  raw.cases.forEach((c, ci) => {
    const d = want[ci];
    const threw = c.steps.findIndex((s) => s.threw);
    if (d.expectThrow) check(`${c.id}: throws at its last declared step`, threw === d.steps.length - 1 && c.steps.length === d.steps.length);
    else check(`${c.id}: no throw and every step recorded`, threw === -1 && c.steps.length === d.steps.length);
    c.steps.forEach((s, si) => {
      const ds = d.steps[si];
      const at = `${c.id}[${si}]`;
      if (!ds || s.op !== ds.op) { check(`${at}: op`, false, s.op); return; }
      if (s.op === 'update') {
        check(`${at}: declared input`, same(s.input, ds.encodedInput) && s.selfId === ds.selfId);
        if (!s.threw) check(`${at}: complete`, same(s.returned, { $u: 0 }) && s.inputUnchanged === true && s.diagnostic !== undefined);
      } else if (s.op === 'canSee') {
        check(`${at}: declared points`, same(s.points, ds.encodedPoints) && s.results.length === ds.points.length && s.results.every((r) => typeof r === 'boolean'));
      } else if (s.op === 'filter') {
        check(`${at}: declared percept`, same(s.input, ds.encodedPercept));
        if (!s.threw) check(`${at}: complete`, s.output !== undefined && s.inputUnchanged === true && s.stateUnchanged === true && typeof s.sameObject === 'boolean');
      }
    });
  });
  if (checks.some((c) => !c.ok)) return finish(checks);

  // ------------------------------------------------------------- coverage: intended branches reached
  const cs = Object.fromEntries(raw.cases.map((c) => [c.id, c.steps]));
  const diag = (id, i) => decode(cs[id][i].diagnostic);
  const out = (id, i) => decode(cs[id][i].output);
  const seen = (id, i) => cs[id][i].results;
  const ids = (rows) => rows.map((r) => r.id);

  guard('reset: disabled canSee is true and filter is identity', () =>
    seen('reset-gates', 1).every(Boolean) && cs['reset-gates'][2].sameObject && cs['reset-gates'][5].sameObject);
  guard('reset: enabled filter drops a row', () => out('reset-gates', 8).fighters.length < decode(cs['reset-gates'][8].input).fighters.length);
  guard('reset: nonactive clears trail and wards', () => {
    const d = diag('reset-gates', 10);
    return d.memory.cells.length === 0 && d.wards.length === 0 && d.memory.lastMap === null && !d.enabled;
  });
  guard('reset: full scan after clear', () => diag('reset-gates', 12).memory.cells.length > 0 && diag('reset-gates', 12).memory.lastUpdate === 1600);
  guard('reset: training truthiness', () => diag('reset-gates', 14).enabled === true && diag('reset-gates', 15).enabled === false);

  guard('trail: fround origin', () => diag('trail-throttle', 0).memory.lastX === Math.fround(784.1) && Math.fround(784.1) !== 784.1);
  guard('trail: throttle ignores movement', () => same(diag('trail-throttle', 2).memory, diag('trail-throttle', 0).memory));
  guard('trail: reuse refresh keeps older A-only cells', () => {
    const cells = diag('trail-throttle', 6).memory.cells.map(([, e]) => e);
    return cells.includes(35200) && cells.includes(35000);
  });
  guard('trail: exclusive expiry boundary', () => seen('trail-throttle', 10).some((v, i) => v && !seen('trail-throttle', 12)[i]));
  guard('trail: everything expires', () => seen('trail-throttle', 14).every((v) => !v));
  guard('trail: backwards time is not throttled', () => diag('trail-throttle', 16).memory.lastUpdate === 39990);
  guard('trail: far move inside the window is throttled', () => same(diag('trail-throttle', 17).memory, diag('trail-throttle', 16).memory));
  guard('trail: missing seat does not scan', () => diag('trail-throttle', 20).memory.lastUpdate === diag('trail-throttle', 18).memory.lastUpdate);

  guard('restore: accepted cells installed by the source', () => diag('reconnect-restore', 0).memory.cells.length > 0);
  guard('restore: refused envelopes change nothing', () => same(diag('reconnect-restore', 2).memory, diag('reconnect-restore', 0).memory));
  guard('restore: last accepted snapshot wins entirely', () => diag('reconnect-restore', 4).memory.cells.length === 1);
  guard('restore: empty accepted snapshot clears', () => diag('reconnect-restore', 7).memory.cells.length === 0);
  guard('restore: disabled update ignores privates', () => diag('reconnect-restore', 11).memory.cells.length === 0);

  guard('bush: exactly 64 is not concealed; reveal shows its owner', () => ['p2', 'p3', 'p4'].every((id) => ids(out('bush-reveal', 2).fighters).includes(id)));
  guard('bush: 64.5 conceals a seen occupant', () => {
    const probes = cs['bush-reveal'][3].probes.filter((p) => p.family === 'fighter');
    const kept = ids(out('bush-reveal', 3).fighters);
    return probes[0].seen === true && !kept.includes('p2');
  });
  guard('bush: same bush never conceals', () => ['p2', 'p3', 'p5', 'p6', 'p7', 'ghost'].every((id) => ids(out('bush-reveal', 4).fighters).includes(id)));
  guard('bush: reveal expires exclusively', () => !ids(out('bush-reveal', 6).fighters).includes('p3'));

  guard('wards: owned ward at camp 0', () => same(diag('wards', 0).wards.map((w) => w.index), [0]) && seen('wards', 1)[0] === true);
  guard('wards: unchanged ward is kept', () => same(diag('wards', 2).wards, diag('wards', 0).wards));
  guard('wards: renewal and gate rebuild', () => diag('wards', 4).wards[0].end === 30000 && diag('wards', 5).wards[0].map === 'locked');
  guard('wards: foreign owner removes', () => diag('wards', 7).wards.length === 0);
  guard('wards: original indexes; no site skipped', () => same(diag('wards', 9).wards.map((w) => w.index), [0, 3]));
  guard('wards: end == now removes', () => same(diag('wards', 11).wards.map((w) => w.index), [3]));
  guard('wards: infinite end kept but unscanned', () => diag('wards', 13).wards.some((w) => w.index === 0 && w.end === Infinity && w.memory.cells.length === 0));
  guard('wards: absent camps remove all', () => diag('wards', 15).wards.length === 0);

  guard('gates: locked hides a cell that open shows', () => seen('gates-coliseum', 1).some((v, i) => !v && seen('gates-coliseum', 3)[i]));
  guard('gates: coliseum reveals the whole arena probes', () => seen('gates-coliseum', 5).slice(1, 5).every(Boolean));

  guard('filter: hidden fighter/mob/container/projectile/minimap/chest dropped', () => {
    const o = out('filter-families', 1);
    return same(ids(o.fighters), ['p2']) && same(ids(o.mobs), ['7']) && o.containers.length === 1 && o.projectiles.length === 1
      && o.minimap.mobs.length === 1 && o.extras.chests.length === 1;
  });
  guard('filter: unseen death redacted, other unseen events dropped', () => {
    const e = out('filter-families', 1).events;
    return e.filter((x) => x.kind === 'death' && x.at === null && x.by === null).length === 2 && !e.some((x) => x.kind === 'hit' && x.by === 'p3');
  });
  guard('filter: a trail needs both ends', () => {
    const f = out('filter-families', 1).extras.fields;
    return f.some((x) => x.kind === 'trail' && x.x2 === 848) && !f.some((x) => x.kind === 'trail' && x.x2 === 3000) && !f.some((x) => x.kind === 'trail' && x.x === 3000);
  });
  guard('filter: effects trimmed to seen ids in object key order', () => same(Object.keys(out('filter-families', 1).extras.effects), ['7', 'p1', 'p2']));
  guard('filter: trail-retained rows kept after moving away', () => same(ids(out('filter-families', 5).fighters), ['p2']));

  return finish(checks);
}

function finish(checks) {
  return { status: checks.every((c) => c.ok) ? 'PASS' : 'FAIL', passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok) };
}

/** The declared cases as encoded by runtime.mjs (`encode(cases())`), with per-step encodings kept. */
function decodeDeclared(encoded) {
  return encoded.map((c) => {
    const o = Object.fromEntries(c.$o);
    return {
      id: o.id, expectThrow: o.expectThrow === true,
      steps: o.steps.map((s) => {
        const st = Object.fromEntries(s.$o);
        return {
          op: st.op, selfId: st.selfId, encodedInput: st.input, encodedPercept: st.percept, encodedPoints: st.points,
          points: st.points ? decode(st.points) : undefined,
        };
      }),
    };
  });
}
