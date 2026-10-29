// What the HUD says about hp and the barrier (GAME_DESIGN 15). Pure, so the numbers and the wording are tested without a DOM; the
// client only lays the strings out. (The buff strip this file used to feed is gone with the buffs: BALANCE_CONTRACT 3.6.)

/**
 * A barrier of this share of max hp draws as a full ring on the body. Second Skin (a card) and R6's skills bring barriers; this is the
 * scale they draw against (the old Bulwark's 30%).
 */
export const BARRIER_FULL_SHARE = 0.3;

/** 0..1: how full a barrier of `barrier` hp is against BARRIER_FULL_SHARE of max hp. */
export function barrierStrength(barrier: number, maxHp: number): number {
  if (!(barrier > 0) || !(maxHp > 0)) return 0;
  return Math.min(1, barrier / (maxHp * BARRIER_FULL_SHARE));
}

/**
 * The hp bar's two segments as shares of the bar: hp, then the barrier after it. The bar spans max hp; if hp plus the
 * barrier is more than that, both shrink so the pair still fits.
 */
export function hpBarFractions(hp: number, maxHp: number, barrier: number): { hp: number; barrier: number } {
  const h = hp > 0 ? hp : 0;
  const b = barrier > 0 ? barrier : 0;
  const total = Math.max(maxHp > 0 ? maxHp : 0, h + b);
  if (!(total > 0)) return { hp: 0, barrier: 0 };
  return { hp: h / total, barrier: b / total };
}

/** Round health upward without turning floating-point noise into an extra point. Living fractions still read at least 1. */
export function hpDisplayValue(value: number): number {
  if (!Number.isFinite(value)) return Math.ceil(value);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 8;
  const whole = Math.ceil(value - tolerance);
  return value > 0 ? Math.max(1, whole) : whole;
}

/** The HUD's hp readout: "HP 400/500", and "HP 400/500 +75 barrier" while a barrier holds. */
export function hpText(hp: number, maxHp: number, barrier: number): string {
  const base = `HP ${hpDisplayValue(hp)}/${hpDisplayValue(maxHp)}`;
  return barrier > 0 ? `${base} +${hpDisplayValue(barrier)} barrier` : base;
}
