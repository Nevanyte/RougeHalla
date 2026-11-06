export interface F64 {
  f64: string;
}

export function f64(value: number): F64 {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  return { f64: view.getBigUint64(0, false).toString(16).padStart(16, "0") };
}

export function isF64(value: unknown): value is F64 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "f64" && /^[0-9a-f]{16}$/.test((value as F64).f64);
}

export function fromF64(value: F64): number {
  if (!isF64(value)) throw new Error("expected an exact lowercase binary64 wrapper");
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(`0x${value.f64}`), false);
  return view.getFloat64(0, false);
}

export function encodeFloats(values: readonly number[]): F64[] {
  return values.map(f64);
}

export function decodeFloats(values: readonly F64[]): number[] {
  return values.map(fromF64);
}
