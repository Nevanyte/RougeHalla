// rh-vision-value/1: an order-preserving, lossless JSON encoding of the JavaScript values the
// bot-vision witness records. It never normalizes a number or drops a member.
//   null, true, false, strings     -> themselves
//   finite numbers other than -0   -> JSON numbers (shortest round-trip text)
//   -0, NaN, +/-Infinity           -> {"$n": "-0" | "NaN" | "Infinity" | "-Infinity"}
//   undefined                      -> {"$u": 0}
//   arrays                         -> JSON arrays; a hole is {"$h": 0}
//   plain objects                  -> {"$o": [[key, value], ...]} in Object.keys order
//   Map                            -> {"$m": [[key, value], ...]} in iteration order (string keys only)
// Anything else (bigint, symbol, function, typed arrays, Set, class instances, symbol keys,
// accessors, cycles) throws: the witness fails closed rather than guess a representation.

export const CODEC = 'rh-vision-value/1';

export function encode(value, path = '$', stack = []) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (value === undefined) return { $u: 0 };
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return { $n: '-0' };
    if (Number.isNaN(value)) return { $n: 'NaN' };
    if (value === Infinity) return { $n: 'Infinity' };
    if (value === -Infinity) return { $n: '-Infinity' };
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${path}: unsupported ${typeof value}`);
  if (stack.includes(value)) throw new TypeError(`${path}: cycle`);
  const inner = [...stack, value];
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${path}: exotic array`);
    const extra = Reflect.ownKeys(value).filter((k) => k !== 'length' && !(typeof k === 'string' && /^(0|[1-9][0-9]*)$/.test(k) && Number(k) < value.length));
    if (extra.length) throw new TypeError(`${path}: array with extra keys`);
    const out = [];
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) { out.push({ $h: 0 }); continue; }
      out.push(encode(plainRead(value, i, path), `${path}[${i}]`, inner));
    }
    return out;
  }
  if (value instanceof Map) {
    if (Object.getPrototypeOf(value) !== Map.prototype) throw new TypeError(`${path}: exotic Map`);
    const out = [];
    for (const [k, v] of value) {
      if (typeof k !== 'string') throw new TypeError(`${path}: non-string Map key`);
      out.push([k, encode(v, `${path}.get(${JSON.stringify(k)})`, inner)]);
    }
    return { $m: out };
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${path}: non-plain object`);
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${path}: symbol keys`);
  const out = [];
  for (const key of Object.keys(value)) out.push([key, encode(plainRead(value, key, path), `${path}.${key}`, inner)]);
  if (Object.getOwnPropertyNames(value).length !== out.length) throw new TypeError(`${path}: non-enumerable own keys`);
  return { $o: out };
}

function plainRead(object, key, path) {
  const d = Object.getOwnPropertyDescriptor(object, key);
  if (!d || !('value' in d)) throw new TypeError(`${path}.${String(key)}: accessor`);
  return d.value;
}

/** Inverse of encode, for the verifier and declared-input emission checks only. */
export function decode(json, path = '$') {
  if (json === null || typeof json === 'boolean' || typeof json === 'string') return json;
  if (typeof json === 'number') return json;
  if (Array.isArray(json)) {
    const out = new Array(json.length);
    json.forEach((item, i) => {
      if (isTag(item, '$h')) return;
      out[i] = decode(item, `${path}[${i}]`);
    });
    return out;
  }
  if (isTag(json, '$u')) return undefined;
  if (isTag(json, '$n')) {
    const v = { '-0': -0, NaN, Infinity, '-Infinity': -Infinity }[json.$n];
    if (v === undefined && json.$n !== 'NaN') throw new TypeError(`${path}: bad $n`);
    return json.$n === 'NaN' ? NaN : v;
  }
  if (isTag(json, '$o')) return Object.fromEntries(entries(json.$o, path).map(([k, v]) => [k, decode(v, `${path}.${k}`)]));
  if (isTag(json, '$m')) return new Map(entries(json.$m, path).map(([k, v]) => [k, decode(v, `${path}.get(${k})`)]));
  throw new TypeError(`${path}: untagged object`);
}

function isTag(json, tag) {
  return json !== null && typeof json === 'object' && !Array.isArray(json) && Object.keys(json).length === 1 && Object.hasOwn(json, tag);
}
function entries(list, path) {
  if (!Array.isArray(list) || !list.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string')) throw new TypeError(`${path}: bad entries`);
  return list;
}
