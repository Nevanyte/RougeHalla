/** Whether the nameplate tier pips should be shown dim at this drawn distance. */
export function markDimmed(distanceSquared: number, insideTrial: boolean, nearRange = 300): boolean {
  return !insideTrial && distanceSquared > nearRange * nearRange;
}

/** The Trial telegraph grows to its base radius; the landed field supplies the final radius. */
export function trialTelegraphRadius(progress: number, baseRadius: number, motion = true): number {
  const p = Math.max(0, Math.min(1, progress));
  const eased = motion ? 1 - Math.pow(1 - p, 3) : p;
  return baseRadius * (motion ? eased : 1);
}

/** The live Trial starts visually at the 300-unit cast radius and contracts to the server's authoritative field radius. */
export function trialFieldRadius(actualRadius: number, elapsedMs: number, contractionMs = 350): number {
  if (!(actualRadius < 300) || !(contractionMs > 0)) return actualRadius;
  const p = Math.max(0, Math.min(1, elapsedMs / contractionMs));
  return 300 + (actualRadius - 300) * p;
}
