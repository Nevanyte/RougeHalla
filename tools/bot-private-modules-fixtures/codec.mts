// Lossless offline method-fixture values. All objects are explicit ordered entries, so no marker collides with source data.
export function encode(value: any, ancestors = new Set<any>()): any {
  if (value === undefined) return {$: 'undefined'};
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return {$: 'number', value: 'NaN'};
    if (!Number.isFinite(value)) return {$: 'number', value: value > 0 ? '+Infinity' : '-Infinity'};
    if (Object.is(value, -0)) return {$: 'number', value: '-0'};
    return value;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'function') return {$: 'callable'}; // diagnostic only; never an input service
  if (ancestors.has(value)) throw new Error('cyclic source value');
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) return {$: 'array', values: Array.from({length: value.length}, (_, i) =>
    i in value ? encode(value[i], next) : {$: 'hole'})};
  if (value instanceof Map) return {$: 'map', entries: [...value].map(([k, v]) => [encode(k, next), encode(v, next)])};
  if (value instanceof Set) return {$: 'set', values: [...value].map((v) => encode(v, next))};
  if (value instanceof Uint8Array) return {$: 'u8', values: [...value]};
  if (typeof value !== 'object') throw new Error('unsupported source type: ' + typeof value);
  const name = Object.getPrototypeOf(value)?.constructor?.name;
  return {$: name && name !== 'Object' ? 'instance' : 'object', ...(name && name !== 'Object' ? {name} : {}),
    entries: Object.keys(value).map((k) => [k, encode(value[k], next)])};
}
export function memorySnapshot(api: any): any {
  const v = api.view;
  return encode({fighters: v.fighters, mobs: v.mobs, camps: v.camps, containers: v.containers,
    self: v.self, stimuli: v.stimuli, bounties: v.bounties, choices: v.choices});
}
