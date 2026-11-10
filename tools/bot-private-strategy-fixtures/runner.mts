import assert from 'node:assert/strict';
import {encode, memorySnapshot} from './codec.mts';
import {shared, types, memory, strategy, adapter, hunt, route, knowledge} from './runtime.mts';
import {MAP} from './builders.mts';

// All dependency implementations are the real unchanged source classes. Only external services are declared here.
export function runCase(spec: any): any {
  let opIndex = -1, callbacks: any[] = [];
  let env: any = {};
  const record = (name: string, args: any[], fn: () => any) => {
    const entry: any = {sequence: callbacks.length, kind: 'callback', name, args: structuredClone(args)};
    callbacks.push(entry);
    const value = fn(); entry.result = structuredClone(value); return value;
  };
  const draws: any = {};
  const rng: any = {};
  const cfgSpec = spec.config ?? {};
  for (const [i, stream] of ['decide', 'motor', 'lapse', 'knowledge'].entries()) {
    const source = shared.mulberry32((cfgSpec.seed ?? 1) + i);
    let ordinal = 0;
    rng[stream] = () => {
      const supplied = cfgSpec.random?.[stream];
      const value = supplied && ordinal < supplied.length ? supplied[ordinal] : source();
      callbacks.push({sequence: callbacks.length, kind: 'rng', stream, index: ordinal++, value: encode(value)});
      return value;
    };
    draws[stream] = () => ordinal;
  }
  const tier = {...types.TIERS[cfgSpec.tier ?? 'hard'], ...cfgSpec.tierOverrides};
  const persona = {...types.PERSONAS[cfgSpec.persona ?? 'farmer'], ...cfgSpec.personaOverrides};
  const pathSpec = () => env.path ?? cfgSpec.path ?? {kind: 'open', factor: 1, exact: true};
  function walk(from: any, to: any): any {
    const p = pathSpec();
    if (p.kind === 'null') return null;
    if (p.kind === 'coordinate-block' && ((to.x >= p.minX && to.x <= p.maxX) || p.ids?.includes(to.id))) return null;
    if (p.kind === 'source') {
      const points = shared.findPath(MAP, from, to);
      return points.length ? {dist: hunt.pathLength(from, points), exact: true} : null;
    }
    return {dist: Math.hypot(to.x - from.x, to.y - from.y) * (p.factor ?? 1), exact: p.exact ?? true};
  }
  const svc = {paths: {
    walk: (from: any, to: any) => record('paths.walk', [from, to], () => walk(from, to)),
    path: (from: any, to: any) => record('paths.path', [from, to], () => pathSpec().kind === 'null' ? null : shared.findPath(MAP, from, to)),
    los: (from: any, to: any) => record('paths.los', [from, to], () => pathSpec().kind !== 'null' && shared.hasLineOfSight(MAP, from, to)),
    clear: (from: any, to: any) => record('paths.clear', [from, to], () => pathSpec().kind !== 'null' && shared.segmentClear(MAP, from, to, shared.PLAYER_RADIUS)),
    collisionMap: () => record('paths.collisionMap', [], () => MAP),
  }, log: (s: string) => record('services.log', [s], () => undefined)};
  const sourceKnowledge = ['strategy', 'hunt-adapter'].includes(spec.suite) ? knowledge.createKnowledge(tier, rng.knowledge) : null;
  const know: any = {};
  for (const name of ['factionEdge', 'weaponEdge', 'mobShare', 'odds'])
    know[name] = (...args: any[]) => record('knowledge.' + name, args, () => sourceKnowledge[name](...args));
  const learned = {enabled: cfgSpec.learned?.enabled ?? false,
    bias: (key: string) => record('learned.bias', [key], () => {
      const entries = env.learned?.entries ?? cfgSpec.learned?.entries ?? [];
      return entries.find(([k]: any) => k === key)?.[1] ?? 0;
    })};
  let currentContext: any;
  const modules = (cfgSpec.modules ?? []).map((m: any) => ({id: m.id,
    enabled: (features: any) => record('module.' + m.id + '.enabled', [features], () =>
      m.enabled === true || (typeof m.enabled === 'string' && !!features[m.enabled])),
    ...(m.goals === undefined ? {} : {goals: (ctx: any) => record('module.' + m.id + '.goals', [{contextOperation: opIndex, now: ctx.p.now, self: {id: ctx.p.self.id, hp: ctx.p.self.hp}}], () => {
      assert.equal(ctx, currentContext, 'callback receives the exact current source context');
      const entries = env.moduleGoals?.[m.id] ?? m.goals;
      return entries.filter((g: any) => !g.when || (g.when.after === undefined || ctx.p.now >= g.when.after)
        && (g.when.hpBelow === undefined || ctx.p.self.hp < g.when.hpBelow)).map(({when: _when, ...g}: any) => g);
    })}),
  }));
  const cfg = {id: cfgSpec.id ?? 'me', name: 'Declared source bot', tier, persona, seed: cfgSpec.seed ?? 1,
    map: MAP, features: cfgSpec.features, learned, services: svc, modules};
  const mem = memory.createMemory({tier, map: MAP, selfId: cfg.id, features: cfg.features});
  const memView = new Proxy(mem.view, {get(target, prop, receiver) {
    if (prop === 'whereabouts') return (id: string, now: number) => record('memory.whereabouts', [id, now], () => target.whereabouts(id, now));
    return Reflect.get(target, prop, receiver);
  }});
  const opts = {log: (s: string) => record('options.log', [s], () => undefined),
    ...(cfgSpec.attacking === undefined ? {} : {attacking: () => record('options.attacking', [], () => env.attacking ?? cfgSpec.attacking)})};
  const object: any = spec.suite === 'memory-api' ? null : spec.suite === 'mob-tracker' ? new hunt.MobTracker()
    : spec.suite === 'mob-hunter' ? new hunt.MobHunter({...hunt.MOB_HUNT, ...cfgSpec.huntOverrides}, opts.log)
    : spec.suite === 'build-route' ? new route.BuildRoute(route.buildOf(cfgSpec.faction ?? 'fire', cfgSpec.buildDraw ?? 0))
    : spec.suite === 'hunt-adapter' ? adapter.createHuntAdapter(cfg, opts)
    : strategy.createStrategy(opts);
  const setupTranscript = callbacks;
  callbacks = [];
  let p: any = null, lastDecision: any = {goal: {kind: 'idle'}};
  const rows: any[] = [];
  const initial = {memory: memorySnapshot(mem), own: encode(object),
    ...(spec.suite === 'strategy' ? {state: encode(object.state), plan: encode(object.plan), huntStats: encode(object.huntStats), huntTarget: encode(object.huntTarget)} : {})};
  for (const [i, op] of spec.operations.entries()) {
    opIndex = i; callbacks = []; env = op.env ?? {};
    const declarationBefore = encode(op);
    let input: any = op.input, result: any, identity: any;
    let inputBefore = encode(input);
    if (op.method === 'observe') { p = op.input; result = mem.observe(p); }
    else if (op.method === 'nullPercept') { assert.equal(op.input, null); result = null; }
    else if (op.method === 'noteSent') result = mem.noteSent(input);
    else if (op.method === 'recordChoice') result = mem.recordChoice(input);
    else if (op.method === 'whereabouts') result = mem.view.whereabouts(input.id, input.now);
    else if (op.method === 'decide' || op.method === 'adapterDecide' || op.method === 'release') {
      assert(p, 'a real observe precedes context methods');
      currentContext = {cfg, p, mem: memView, know, svc, rng, engaged: op.engaged ?? false};
      if (op.method === 'decide') {
        const current = op.current === '$previous' ? lastDecision.goal : op.current;
        input = {currentSource: op.current === '$previous' ? 'previous-decision' : 'declared', current,
          status: op.status, engaged: op.engaged ?? false};
        inputBefore = encode(input);
        result = object.decide(currentContext, current, op.status);
        identity = {returnedCurrentGoal: result.goal === current}; lastDecision = result;
      } else if (op.method === 'release') result = object.release(currentContext);
      else {
        const weight = op.typeWeights === undefined ? undefined : (type: any) => record('adapter.typeWeight', [type], () => op.typeWeights.find(([k]: any) => k === type)?.[1] ?? 0.25);
        result = object.decide(currentContext, weight, op.elitesReady);
      }
    } else if (op.method === 'trackerObserve') result = object.observe(input.mobs, input.now);
    else if (op.method === 'trackerQuery') {
      result = {mob: object.mob(input.id), home: object.home(input.id), returning: object.returning(input.id, input.now),
        awake: object.awake(input.id, input.now, input.awakeMoved), awakeNear: object.awakeNear(input.from, input.radius, input.now, input.awakeMoved)};
    } else if (op.method === 'hunterDecide') {
      const descriptor = input;
      const transformed = {...descriptor, walk: (to: any) => record('hunter.walk', [to], () => {
        const d = descriptor.walk;
        if (d.kind === 'null' || (d.kind === 'coordinate-block' && to.x >= d.minX && to.x <= d.maxX)) return null;
        return Math.hypot(to.x - descriptor.self.x, to.y - descriptor.self.y) * (d.factor ?? 1);
      }), ...(descriptor.typeWeights === undefined ? {} : {typeWeight: (type: any) => record('hunter.typeWeight', [type], () => descriptor.typeWeights.find(([k]: any) => k === type)?.[1] ?? 0.25)})};
      delete transformed.typeWeights;
      result = object.decide(transformed);
    } else if (op.method === 'isBanned') result = object.isBanned(input.id, input.now);
    else if (op.method === 'awakeNear') result = object.awakeNear(input.from, input.radius, input.now);
    else if (op.method === 'routeUpdate' || op.method === 'routePlan') {
      const transformed = {...input, canFarm: (camp: any) => record('route.canFarm', [camp], () => {
        const d = input.canFarm;
        return d.kind === 'allow' || (d.kind === 'indices' && d.allow.includes(camp.index)) || (d.kind === 'zones' && d.allow.includes(camp.zone));
      })};
      result = op.method === 'routeUpdate' ? object.update(transformed) : object.plan(transformed);
    } else if (op.method === 'isContested') result = object.isContested(input.camp, input.now);
    else if (op.method === 'campValue') result = object.campValue(input.camp, input.elites);
    else throw new Error('unsupported operation ' + op.method);
    // Snapshot NOW: each source API exposes mutable live Maps/records. Retaining references corrupts chronology.
    assert.deepEqual(encode(op), declarationBefore, 'source does not mutate declared method input');
    rows.push({method: op.method, input: inputBefore, declaration: declarationBefore, result: encode(result), memory: memorySnapshot(mem),
      own: encode(object), ...(identity ? {identity} : {}), callbacks: encode(callbacks), drawCounts: Object.fromEntries(Object.entries(draws).map(([k, fn]: any) => [k, fn()])),
      ...(spec.suite === 'strategy' ? {state: encode(object.state), plan: encode(object.plan), huntStats: encode(object.huntStats), huntTarget: encode(object.huntTarget)} : {}),
      ...(spec.suite === 'hunt-adapter' ? {stats: encode(object.stats), target: encode(object.hunter.target)} : {})});
  }
  return {id: spec.id, suite: spec.suite, covers: spec.covers, config: encode({...cfgSpec, tierValues: tier, personaValues: persona}),
    initial, setupTranscript: encode(setupTranscript), operations: rows};
}
