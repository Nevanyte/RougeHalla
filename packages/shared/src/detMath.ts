// Deterministic trigonometry for the generator: sin and cos from + - * / only (Taylor after range reduction), so every JS engine
// agrees to the bit. Moved verbatim from the retired cover.ts (zone-shapes contract 3.2); the coliseum's inner spawn ring uses them.

export const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;

/** sin from + - * / only (Taylor after range reduction), so every JS engine agrees to the bit. */
export function detSin(x: number): number {
  let y = x - Math.floor(x / TWO_PI + 0.5) * TWO_PI;
  if (y > HALF_PI) y = PI - y;
  else if (y < -HALF_PI) y = -PI - y;
  const y2 = y * y;
  return y * (1 + y2 * (-1 / 6 + y2 * (1 / 120 + y2 * (-1 / 5040 + y2 * (1 / 362880 + y2 * (-1 / 39916800 + y2 * (1 / 6227020800)))))));
}

export function detCos(x: number): number {
  return detSin(x + HALF_PI);
}
