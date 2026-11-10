// Inputs only. Keys are computed by unchanged Strategy.goalKey, never by this harness.
import {config, observe, decide, NOW} from '/repo/tools/bot-private-strategy-fixtures/builders.mts';
const goal = (data: any) => ({kind: 'module', module: 'key', data});
const offer = (data: any, utility = 2, why = 'declared module key') => ({goal: goal(data), utility, why});
const step = (n: number, goals: any[], status = 'running') => [observe(NOW + n), decide({
  status: {state: status, why: 'declared caller status'}, env: {moduleGoals: {key: goals}}})];
const cfg = () => config({tierOverrides: {softmaxT: 0, lapseP: 0}, modules: [{id: 'key', enabled: true, goals: []}]});
export function cases(): any[] {
  const out: any[] = [];
  const add = (id: string, operations: any[]) => out.push({id, suite: 'strategy', config: cfg(), covers: ['Strategy.goalKey.module.JSON-stringification'], operations});
  add('negative-zero-positive-zero-collision', [
    ...step(0, [offer({v: -0}, 2, 'first-negative-zero'), offer({v: 0}, 1.9, 'second-positive-zero')]),
    ...step(1, [offer({v: 0})]),
    ...step(2, [offer({v: 0}), offer({v: -0}, 1.9), offer({v: 'safe'}, 1.8)], 'failed'),
    ...step(5001, [offer({v: 0}), offer({v: 'safe'}, 1.8)]),
    ...step(5002, [offer({v: 0}), offer({v: 'safe'}, 1.8)]),
  ]);
  add('nonfinite-null-collision-and-current-reuse', [
    ...step(0, [offer({v: NaN}, 2, 'first-NaN'), offer({v: Infinity}, 1.9), offer({v: -Infinity}, 1.8), offer({v: null}, 1.7)]),
    ...step(1, [offer({v: Infinity})]), ...step(2, [offer({v: -Infinity})]), ...step(3, [offer({v: null})]),
    ...step(4, [offer({v: null}), offer({v: Infinity}, 1.9), offer({v: -Infinity}, 1.8), offer({v: 'safe'}, 1.7)], 'failed'),
    ...step(5004, [offer({v: null}), offer({v: 'safe'}, 1.7)]),
  ]);
  const numbers = [1e-7, 1e-6, 1e20, 1e21];
  add('ecmascript-exponent-boundaries', [
    ...step(0, numbers.map((v, i) => offer({v}, 2 - i / 10))),
    ...step(1, [offer({v: 1e-6})]), ...step(2, [offer({v: 1e20})]), ...step(3, [offer({v: 1e21})]),
    ...step(4, [offer({v: 1e21})]),
    ...step(5, [offer({v: 1e21}), offer({v: 'safe'}, 1.8)], 'done'),
    ...step(1505, [offer({v: 1e21}), offer({v: 'safe'}, 1.8)]),
  ]);
  add('undefined-object-array-distinction', [
    ...step(0, [offer({v: undefined}, 2, 'undefined-property'), offer({}, 1.99, 'empty-object'),
      offer({v: [undefined]}, 1.98, 'array-undefined'), offer({v: [null]}, 1.97, 'array-null'),
      offer({v: {a: undefined}}, 1.96, 'nested-undefined-property'), offer({v: {}}, 1.95, 'nested-empty-object'),
      offer({v: []}, 1.94, 'empty-array'), offer({v: [{}]}, 1.93, 'array-object')]),
    ...step(1, [offer({})]),
    ...step(2, [offer({}), offer({v: undefined}, 1.99), offer({v: [null]}, 1.98)], 'failed'),
    ...step(3, [offer({v: [undefined]})]),
    ...step(4, [offer({v: {a: undefined}})]), ...step(5, [offer({v: {}})]),
  ]);
  return out;
}
