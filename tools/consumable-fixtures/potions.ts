/** Actual-source consumable proofs: the potion use/refusal trace and the camp-clear reward. No arithmetic is replaced. */
import { readFileSync, writeFileSync } from 'node:fs';
import { mapFromTiles, TICK_MS, TILE_FLOOR } from '@raid/shared';
import { createScenarioWorld, MODULES } from '../../parity/legacy-capture/world';
import { addPlayer, step } from '../../packages/server/src/sim/step';
import { grantConsumable } from '../../packages/server/src/sim/consumables';
import { createIntake } from '../../parity/legacy-capture/intake';
import { campContribOf, noteCampContributors, payCampHeal } from '../../packages/server/src/sim/campHeal';

type Any = any;

const openMap = () => mapFromTiles(24, 24, new Uint8Array(24 * 24).fill(TILE_FLOOR), 11);
const inertModules = ['loot', 'weapons', 'consumables'];

function scenario(map: Any, modules: string[], config: Any = {}): Any {
  return createScenarioWorld(
    { name: 'consumables', randomSeed: 12, modules, players: [{}, {}], config, rows: [], maxTicks: 1, drive: () => {} } as Any,
    map,
  );
}

function players(w: Any): Any[] {
  const p0 = w.state.players.get('p0')!;
  const p1 = w.state.players.get('p1')!;
  return [
    { kind: 'player', id: 'p0', s: p0, rt: w.players.get('p0')! },
    { kind: 'player', id: 'p1', s: p1, rt: w.players.get('p1')! },
  ];
}

const toast = (events: Any[]) => events.filter((e) => e.type === 'toast').map((e) => e.text);

function potionWorld() {
  const w = scenario(openMap(), inertModules);
  addPlayer(w, 'p0', 'P0', { faction: 'fire' });
  addPlayer(w, 'p1', 'P1', { faction: 'holy' });
  step(w, TICK_MS);
  const [p0, p1] = players(w);
  p0.s.hp = 300;
  return { w, p0, p1 };
}

function useCase(name: string, setup: (w: Any, p0: Any, p1: Any) => void, uses = 1) {
  const { w, p0, p1 } = potionWorld();
  setup(w, p0, p1);
  // The press goes through the real intake and the tick, exactly as a client's does (no direct handler call).
  const intake = createIntake(false);
  for (let u = 0; u < uses; u++) intake('p0', p0.rt.inputs, 'useConsumable', { kind: 'heal' }, w.state.serverTime, false);
  const events: Any[] = [];
  const trace: Any[] = [];
  for (let i = 0; i < 106; i++) {
    events.push(...step(w, TICK_MS));
    trace.push({
      hp: p0.s.hp,
      potionLarge: p0.s.potionLarge,
      potionSmall: p0.s.potionSmall,
      healingUntil: p0.s.healingUntil ?? 0,
      potionsHealing: p0.s.potionsHealing ?? 0,
    });
  }
  return { name, uses, maxHp: p0.s.maxHp, trace, toasts: toast(events) };
}

const potionCases = [
  useCase('large-preferred', (w, p0) => {
    grantConsumable(w, p0, 'potionLarge');
    grantConsumable(w, p0, 'potionSmall');
    grantConsumable(w, p0, 'potionSmall');
  }),
  useCase('small-only', (w, p0) => {
    grantConsumable(w, p0, 'potionSmall');
  }),
  useCase('empty-bag', () => {}),
  useCase('full-health', (w, p0) => {
    grantConsumable(w, p0, 'potionSmall');
    p0.s.hp = p0.s.maxHp;
  }),
  useCase(
    'busy-three',
    (w, p0) => {
      for (let i = 0; i < 4; i++) grantConsumable(w, p0, 'potionSmall');
    },
    4,
  ),
];

function grantRefusal() {
  const { w, p0 } = potionWorld();
  p0.s.potionLarge = 5;
  const stored = grantConsumable(w, p0, 'potionLarge');
  return { name: 'large-bag-full', stored, potionLarge: p0.s.potionLarge, potionSmall: p0.s.potionSmall };
}

// The layered map the Rust side loads for the same cases (parity/initial-loot/input-map.json): the camp centre and the
// all-zero territory grid must be exactly the ones the reward test sees.
function layeredMap() {
  const data = JSON.parse(readFileSync('parity/initial-loot/input-map.json', 'utf8'));
  const map = mapFromTiles(data.w, data.h, Uint8Array.from(data.tiles), data.seed);
  map.camps = data.camps;
  map.regions = data.regions;
  return map;
}

function campWorld() {
  const w = scenario(layeredMap(), inertModules);
  addPlayer(w, 'p0', 'P0', { faction: 'fire' });
  addPlayer(w, 'p1', 'P1', { faction: 'holy' });
  step(w, TICK_MS);
  const [p0, p1] = players(w);
  return { w, p0, p1 };
}

function campCase(name: string, setup: (w: Any, p0: Any, p1: Any) => void) {
  const { w, p0, p1 } = campWorld();
  const camp = w.map.camps[0]!;
  p0.s.x = camp.x;
  p0.s.y = camp.y;
  p1.s.x = 1400;
  p1.s.y = 1400;
  setup(w, p0, p1);
  payCampHeal(w, 0);
  const events: Any[] = w.events.splice(0);
  const after = {
    name,
    camp: { x: camp.x, y: camp.y },
    players: [...w.state.players.entries()].map(([id, p]) => ({
      id,
      hp: p.hp,
      potionLarge: p.potionLarge,
      potionSmall: p.potionSmall,
      campClears: w.players.get(id)!.campsCleared ?? 0,
      status: p.status,
    })),
    contributors: [...campContribOf(w, 0)].sort(),
    toasts: toast(events),
  };
  return after;
}

const note = (w: Any, ids: string[]) => {
  const entries = ids.map((id) => ({ by: { id } }));
  noteCampContributors(w, 1, entries as Any, ids.map(() => 100));
};

const campCases = [
  campCase('centre-and-far', (w) => note(w, ['p0', 'p1'])),
  campCase('full-bag-at-centre', (w, p0) => {
    p0.s.potionLarge = 5;
    note(w, ['p0']);
  }),
  campCase('down-contributor', (w, p0) => {
    p0.s.status = 'dead';
    p0.s.hp = 0;
    note(w, ['p0', 'p1']);
  }),
  campCase('nobody', () => {}),
];

const out = {
  format: 'rh-consumables-source/1',
  potionCases,
  grantRefusal: grantRefusal(),
  campCases,
};
const path = process.argv[2] ?? 'parity/consumables/source.json';
writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
console.log(`captured ${potionCases.length} potion cases, ${campCases.length} camp cases`);
