// Strict tagged-value reader plus finite corpus/envelope/consumed-field checks. Not a public intake validator.
// All records are converted before any caller receives a case; this module never mutates a source/native instance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export function decode(v, diagnostic = false) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') { assert(Number.isFinite(v) && !Object.is(v, -0)); return v; }
  assert(v && typeof v === 'object' && !Array.isArray(v), 'a tagged MethodValue object');
  const closed = (fields) => assert.deepEqual(Object.keys(v).sort(), fields.sort(), 'closed tag fields');
  if (v.$ === 'undefined') { closed(['$']); return undefined; }
  if (v.$ === 'number') { closed(['$', 'value']); assert(['NaN', '+Infinity', '-Infinity', '-0'].includes(v.value)); return {NaN: NaN, '+Infinity': Infinity, '-Infinity': -Infinity, '-0': -0}[v.value]; }
  if (v.$ === 'callable') { assert(diagnostic); closed(['$']); return Symbol.for('source-callable'); }
  if (v.$ === 'hole') { assert(diagnostic); closed(['$']); return Symbol.for('source-hole'); }
  if (v.$ === 'array' || v.$ === 'set' || v.$ === 'u8') {
    closed(['$', 'values']); assert(Array.isArray(v.values)); const values = v.values.map((x) => decode(x, diagnostic));
    if (v.$ === 'set') { const s = new Set(values); assert.equal(s.size, values.length, 'duplicate Set member'); return s; }
    if (v.$ === 'u8') { assert(values.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)); return Uint8Array.from(values); }
    return values;
  }
  if (v.$ === 'map') {
    closed(['$', 'entries']); assert(Array.isArray(v.entries)); const m = new Map();
    for (const pair of v.entries) { assert(Array.isArray(pair) && pair.length === 2); const k = decode(pair[0], diagnostic);
      assert(k === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof k), 'primitive fixture Map key');
      assert(!m.has(k), 'duplicate Map key'); m.set(k, decode(pair[1], diagnostic)); }
    return m;
  }
  if (v.$ === 'object' || v.$ === 'instance') {
    assert(v.$ === 'object' || diagnostic, 'instances are output diagnostics only');
    closed(v.$ === 'object' ? ['$', 'entries'] : ['$', 'name', 'entries']);
    if (v.$ === 'instance') assert(typeof v.name === 'string' && v.name.length > 0);
    assert(Array.isArray(v.entries)); const object = Object.create(null);
    for (const pair of v.entries) { assert(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string');
      assert(!Object.hasOwn(object, pair[0]), 'duplicate object key'); object[pair[0]] = decode(pair[1], diagnostic); }
    return object;
  }
  assert.fail('unsupported MethodValue tag');
}
const suites = ['memory-api', 'strategy', 'hunt-adapter', 'mob-tracker', 'mob-hunter', 'build-route'];
const methods = ['observe', 'nullPercept', 'noteSent', 'recordChoice', 'whereabouts', 'decide', 'adapterDecide', 'release', 'trackerObserve', 'trackerQuery',
  'hunterDecide', 'isBanned', 'awakeNear', 'routeUpdate', 'routePlan', 'isContested', 'campValue'];
const goalKinds = ['idle', 'farm', 'hunt', 'fight', 'loot', 'flee', 'roam', 'hold', 'module'];
const commandKinds = ['move', 'stop', 'target', 'attack', 'release', 'swap', 'pickup', 'cast', 'plan', 'choose', 'useConsumable'];
function allowed(object, keys, label) {
  assert(object && typeof object === 'object' && !Array.isArray(object), label);
  for (const key of Object.keys(object)) assert(keys.includes(key), label + ': unsupported field ' + key);
}
function checkGoal(g) {
  assert(g && goalKinds.includes(g.kind), 'supported Goal kind');
  const fields = {idle: [], farm: ['mob', 'camp'], hunt: ['target'], fight: ['target'], loot: ['container'], flee: ['from', 'until'],
    roam: ['to', 'why'], hold: ['at', 'why'], module: ['module', 'data']};
  allowed(g, ['kind', ...fields[g.kind]], 'Goal');
  for (const key of fields[g.kind]) assert(Object.hasOwn(g, key), 'missing Goal field ' + key);
  if (g.kind === 'hunt' || g.kind === 'fight') assert(typeof g.target === 'string' && g.target.length > 0);
  if (g.kind === 'farm') assert(typeof g.mob === 'string' && (typeof g.camp === 'string' || g.camp === null));
  if (g.kind === 'loot') assert(typeof g.container === 'string');
}
function checkPercept(p) {
  allowed(p, ['now', 'viewT', 'self', 'hud', 'fighters', 'mobs', 'containers', 'projectiles', 'minimap', 'events', 'extras', 'features'], 'Percept');
  assert(typeof p.now === 'number' && Number.isFinite(p.now));
  allowed(p.self, ['id','name','x','y','facing','status','hp','maxHp','barrier','faction','weapons','slot','attackTarget','drawStartedAt','readyAt','immuneUntil',
    'sig','brand','power','asMult','windupMult','speedMult','kills','mobKills','gv','bounty','moveSeq','mobStats'], 'Self');
  assert(['alive', 'dead', 'mia'].includes(p.self.status));
  const factions = [null, 'fire', 'sentenced', 'plague', 'frost', 'holy'];
  assert(factions.includes(p.self.faction));
  assert(Array.isArray(p.fighters) && Array.isArray(p.mobs) && Array.isArray(p.events));
  const observed = ['windup','swing','hit','block','stagger','cancel','projEnd','death','heal','teleport','bounty','victory','toast','result','private','ext'];
  for (const e of p.events) assert(observed.includes(e.kind), 'ObservedEvent kind');
  for (const f of p.fighters) { assert(factions.includes(f.faction)); assert(['alive','dead','mia'].includes(f.status)); }
}
export function validate(body) {
  allowed(body, ['format','methodValue','profile','maps','cases'], 'source envelope');
  assert.equal(body.format, 'rh-bot-private-strategy-source/1'); assert.equal(body.methodValue, 'rh-method-value/1');
  assert(Array.isArray(body.maps) && body.maps.length === 1 && body.maps[0].id === 'generated7'); decode(body.maps[0].value);
  assert(Array.isArray(body.cases)); const ids = new Set(); const converted = [];
  for (const c of body.cases) {
    allowed(c, ['id','suite','covers','config','initial','setupTranscript','operations'], 'case');
    assert(typeof c.id === 'string' && !ids.has(c.id)); ids.add(c.id); assert(suites.includes(c.suite));
    const cfg = decode(c.config); assert(['easy', 'normal', 'hard'].includes(cfg.tier)); assert(['farmer', 'hunter', 'opportunist', 'cautious'].includes(cfg.persona));
    decode(c.initial.memory, true); decode(c.initial.own, true); decode(c.setupTranscript, true);
    assert(Array.isArray(c.operations)); const operations = [];
    for (const row of c.operations) {
      allowed(row, ['method','input','declaration','result','memory','own','identity','callbacks','drawCounts','state','plan','huntStats','huntTarget','stats','target'], 'operation');
      assert(methods.includes(row.method), 'supported method'); const input = decode(row.input); const declaration = decode(row.declaration);
      assert.equal(declaration.method, row.method); const result = decode(row.result, true);
      if (row.method === 'observe') checkPercept(input);
      if (row.method === 'decide') { checkGoal(input.current); assert(['running', 'done', 'failed', 'blocked'].includes(input.status.state)); checkGoal(result.goal); }
      if (row.method === 'noteSent') assert(commandKinds.includes(input.cmd.type), 'supported emitted command');
      decode(row.memory, true); decode(row.own, true); const callbacks = decode(row.callbacks, true);
      assert(Array.isArray(callbacks)); callbacks.forEach((call, i) => { assert.equal(call.sequence, i); assert(['callback', 'rng'].includes(call.kind)); });
      for (const k of ['state', 'plan', 'huntStats', 'huntTarget', 'stats', 'target']) if (Object.hasOwn(row, k)) decode(row[k], true);
      operations.push({method: row.method, input, declaration, result});
    }
    converted.push({id: c.id, suite: c.suite, config: cfg, operations});
  }
  return converted;
}
export function readerControls(body) {
  const reject = (v) => assert.throws(() => decode(v));
  reject({$: 'future'}); reject({$: 'number', value: 'Infinity'}); reject({$: 'undefined', extra: 1});
  reject({$: 'map', entries: [['same', 1], ['same', 2]]});
  reject({$: 'map', entries: [[0, 1], [{$: 'number', value: '-0'}, 2]]});
  reject({$: 'object', entries: [['x', 1], ['x', 2]]}); reject({$: 'instance', name: 'Fake', entries: []});
  reject({$: 'u8', values: [256]}); reject({$: 'callable'});
  assert(Object.is(decode({$: 'number', value: '-0'}), -0)); assert(Number.isNaN(decode({$: 'number', value: 'NaN'})));
  assert.equal(decode({$: 'number', value: '-Infinity'}), -Infinity); assert.equal(decode({$: 'undefined'}), undefined);
  assert.equal(decode(null), null);
  if (body) {
    assert.throws(() => validate({...body, unsupported: true}));
    assert.throws(() => validate({...body, format: 'future'}));
    const first = body.cases[0];
    assert.throws(() => validate({...body, cases: [{...first, suite: 'future'}]}));
    assert.throws(() => validate({...body, cases: [{...first, operations: [{...first.operations[0], method: 'future'}]}]}));
    assert.throws(() => validate({...body, cases: [first, first]}));
    return 19;
  }
  return 14;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = process.argv[2] ?? 'parity/policy/bot-private-strategy/source.json';
  const bytes = readFileSync(path); const body = JSON.parse(bytes); const cases = validate(body); const count = readerControls(body);
  console.log(JSON.stringify({validated: path, cases: cases.length, operations: cases.reduce((n, c) => n + c.operations.length, 0), readerControls: count,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}));
}
