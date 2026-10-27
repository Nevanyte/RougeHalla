// The damage type of each signature's own damage (balance pass D6, BALANCE_CONTRACT 5.2), as the shares of the packet the
// ledger mitigates: burn and disease are magic (cut by magic resist), Fire's backlash physical (armor), the mark true
// (nothing). Whatever damage shares the faction's weapon hits have; a mob's signatures are typed the same way. Re-exported
// by signatures.ts (import it from there); a leaf of its own so factions.ts's reference duel can read it without a cycle.
import type { DamageShares } from "./factions";
import type { SignatureKind } from "./signatures";

export const SIGNATURE_SHARES: Readonly<Record<SignatureKind, DamageShares>> = {
  burn: { phys: 0, magic: 1, true: 0 },
  backlash: { phys: 1, magic: 0, true: 0 },
  disease: { phys: 0, magic: 1, true: 0 },
  mark: { phys: 0, magic: 0, true: 1 },
};
