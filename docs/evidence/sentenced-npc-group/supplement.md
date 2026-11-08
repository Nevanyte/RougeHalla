# P-SENTENCED-NPC-GROUP-WITNESSES — additive supplement

Source-only continuation on `deepseek/p-sentenced-npc-group-supplement` from the delivered corpus head
`9a8972a9ea739f0e8265fb969c1acede2ce7f197`. The delivered six-case corpus and its capture/runner/README bytes are
unchanged (corpus SHA256 `3808dac2…`). Only additive new files are added.

## New observed cases

### sibling-death-shrink-handoff (real death, shrink and focus handoff)

Real `createGameWorld` camp with five live catalog members; p0 (Sentenced) attacks the first member with a real bow and
captures `markGroup='camp:1'`, `markGroupSize=5` in the `mark-original-size` frame. A **second ordinary human attacker**
p2 (Sentenced, real bow attacks, no installed weapon/outcome) kills a sibling: the `sibling-dead` frame shows that
watched member `mob1b` with status `dead`, the original `markGroupSize` still 5, and the source focus handoff
`p0.target` changing from `mob1b` to live `mob1c`. Current survivors fall from 5 to 3 live members while the historical
size stays 5; `after-handoff` records the new focus and pulses. This is an actual weapon/ledger death, not an installed
one.

The leash-window action moved the surviving Mark owner p2 away and captured the camp's `brain.mode` still `fight`;
**Return/leash behavior was not reached in this bounded run** (p0 had already died to the camp, and the surviving
members stayed in fight). The focus handoff and shrink are proven; Return is an explicit remainder.

### trial-unfocused-member (real Trial cast on an unfocused member)

p0's Mark focuses `mob1a` (`camp:1`, size5); p2 then casts a real Trial Wish at the **unfocused** live member `mob1b`.
The `trial-cast` frame records the actual source `fx` cast event `{ability:'trial', target:'mob1b'}` while p0's focus
stays `mob1a`. No camp status/zone outcome was observed in the following 120 ticks, so the cast-on-unfocused-member
attempt is witnessed but its status consequence is **not claimed** (explicit remainder). Weapon-swap behavior was not
reachable through an admitted source producer in this bound.

## Checks / provenance

New corpus: `parity/sentenced-npc-group/source-supplement.json`, `rh-sentenced-npc-group-supplement/1`, 2 cases,
530,381 bytes, SHA256 `292496f06ddc3edb8ccb142df76e2661fd257b0679a2132809ad9e4560e75183`; `capture-supplement.sh
--check` byte-identical. Pinned Node 22.23.4 linux/amd64; corpus provenance tool hashes `capture-supplement.mts`
`d6935b13…`, `capture-supplement.sh` `fbc1b7e6…`, `run-supplement-mutants.sh` `6563e3e3…`, package-lock `991869bd…`,
and all 127 source files.

Three actual semantic mutants tied to the new behavior are killed by actual runtime-output mismatches (3/3):
`01-current-survivor-size-after-death` (recomputes group size from current survivors after the real sibling death),
`02-lost-focus-handoff-after-death` (clears the source survivor handoff), `03-unscaled-group-pulse` (removes the
original-size pulse share). The supplemental runner has a checked complete backup before trap arming, unique logs,
EXIT/HUP/INT/TERM restoration with nonzero propagation, and exact restoration; unchanged control passes. A comment-only
provenance mutation produced identical runtime cases/differing provenance and is a non-kill.

## Remainders (exact)

1. Return/leash mode transition was not reached (surviving camp stayed `fight`; p0 died before a successful owner move).
2. Trial cast on the unfocused member is witnessed, but no status/zone outcome was observed; not claimed.
3. Actual weapon swap and tier-four multi-owner execute denial/deferred order were not captured; the existing trusted
`parity/sentenced/runtime-matrix.json`/`denial-matrix.json` remain the only prior reference for those domains.
4. No native/hash equality or replacement-kernel claim; the GPT kernel/group implementation is separate.
