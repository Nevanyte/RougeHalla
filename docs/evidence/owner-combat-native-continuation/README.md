# Private native owner-combat continuation

Base `ce4de3614a2bcd75fad95e44d8ddeb700faea143`. Production gate correction is separately sealed at
`a30696671e22798bde6a7503bfca9845269a6575`; inherited ActorRefs test-initializer cleanup is separately sealed at
`b956cfedf2190c1642bf810ba3f7bc22d03490c8` (equivalent to the coordinator's separately delivered notice-branch cleanup).
The remaining code is one new cfg(test) consumer module and its declaration. The projector, mirror getter, canonical
layout, public observations, codecs, identities, content, tapes, source corpora/tools and shared status are untouched.

## Discovered and corrected installer mismatch

The first real M04/M05 native frame read cached mirrors `[1000,1000,1001]`; the immutable source host and decoded group
read `[1000,1000,1000]`. Native `TRAINING_NO_SIGNATURES` disabled only Signatures, retaining FireRoam and Bruiser.
Source `packages/server/src/sim/gameplay.ts` omits those auxiliary installers together under `signatures:false`.
The coordinator approved setting only those two gate fields false. Ordinary TRAINING retains them. No registration
table, row order, eligibility predicate, gameplay constant or projector/cache was changed. The regression checks the
auxiliary systems, mod sources, hooks and compiled system rows in both profiles.

`logs/pre-fix-m04.txt` and `logs/pre-fix-gates.txt` are actual compiled exit-101 regressions: wrong mirror1001 and an
incorrectly installed `bruiserPassives.update`, respectively. The former precedes the later raw-ID observer adapter
correction; its first owner frame does not name an NPC, so that correction does not affect the mirror regression.

## Immutable oracle and actual replay

The consumer reads **raw producer frames**, not human optimistic LockDisplay, human DrawTrack or the disclosed defective
transition arrays. Source continuation producer SHA256 is
`6edf61838c6ff65afae7878f929afb832896cb1a9f031b8d7273babdbe51d096`; human-projection SHA256 remains
`b21e041e4b043c945928955ff9548ee54e1528d682fbdd66fdf5dbff5eb5324d`. Neither was regenerated or edited.

| Case | Native steps | Raw frames | Matched real raw/applied hits | Boundary |
|---|---:|---:|---:|---|
| L07 | 293 | 31 | 14 | Ordinary wand damage kills target; one completed post-death Held frame, then Clear |
| L08 | 24 | 24 + 1 direct | 0 | Explicit public `Sim::remove_player`; retained canonical Held loses identity immediately, next step Clear; real MIA result |
| D02 | 30 | 30 | 0 | Legal bow-to-wand swap cancels pending draw, preserves source cooldown; no bow flight on any step |
| M05 | 1004 | 195 | 123 | Actual train Overkill/practice Executioner; real deaths494/994, same-step full-health reset, original build retained |
| M04 | 26 | 26 | 0 | Ordinary base-card request is refused; empty build/farm, all mirrors1000; no fallback grant |

Total: **1377 actual native steps, 306 raw frames + 1 direct snapshot, 137 actual raw/applied hits**. Unrecorded lead-in
steps execute normally. Every declared ordinary action uses `validate` and `Sim::submit`; only L08 uses the explicitly
labelled lifecycle call. Constructor racks, seats and pose/path/history setup follow the source declaration. Source
`mulberry32(8)` order/reward salt derivation is adapted through the existing native RNG/fmix helpers. No expected lock,
draw, clock, death, revival, card, farm stat or mirror outcome is installed.

Canonical held identity and direct draw/ready clocks compare against the host frame (absolute tolerance1e-8 for source
binary64 arithmetic); source-u32 clocks and all three cached mirrors compare exactly with decoded source values. Real
pending actions, weapon slots, HP/status, build/farm and raw/applied causal hits are checked too. M05's two actual Death
events plus low preceding HP, landed damage and same-step alive/HP950/ready0/draw0 frames prove real resets; this consumer
does not claim an additional native callback snapshot at the source's pre-settle observer tap.

The projector receives CURRENT entitled canonical IDs from existing `observe_with`, before ActorRefs mapping. An early
test adapter incorrectly mixed public NPC references with raw canonical IDs; that adapter was corrected, with source
entitlement assertions retained. L08 never uses a retired reference or a retained identity. Projection state hashes are
unchanged. This is a private group proof, not a new raw policy-observation constructor or public capability.

## Explicit construction and publication limits

Native full MapExport refuses `mapFromTiles`' empty coliseum; native Source lifecycle also refuses its absent fallback
spawns. The coordinator approved the existing owner-prefix convention: ordinary collision-only TileMap plus lifecycle
Off for this bounded pre-teleport replay. Source patience is3600s, far beyond the <=50.25s window. Recorded players and
named NPC probes are outside the omitted bush. No bush/whole-map/lifecycle/Room/socket or Unity-rendering parity is claimed.
Source optimistic human lock retention500ms is not the native oracle. M05 proves persistence of the actual Overkill build
and identity mirrors; it does not prove persistence of an unproduced nonidentity mirror. Genuine farm-earned attack-speed
production remains open. No fourth producer or source-producer mutant claim is made.

## Bounded verification

Commands source `final-env.sh` then override `CARGO_TARGET_DIR` to this worker's isolated target. `manifest.json` pins code,
oracle and receipt bytes. Owner suite11pass/1 separately ignored allocation test; schedule6pass; training14pass including
its captured corpus; strict Full source1pass/all63cases; original isolated90k projection allocation test1pass/zero blocks.
Affected strict Clippy runs cover default and trusted-status-probes; formatting/whitespace checks are recorded separately.
No workspace, map-generation, source-capture, browser, Editor, cloud or unchanged broad campaign was run.

`consumer-lock-clear.patch` is one compiled **consumer-output diagnostic**: it forces Clear only when projecting the real
L07 death frame281. The exact test compiled and failed at `L07/281/current identity` (Clear versus Held/target2, exit101).
The exact consumer bytes were restored from a verified complete backup, then the same one-test compiled control passed.
`consumer-mutant.json` records both source hashes and commands; logs retain the semantic failure and restored control.
This is not a kernel or source-producer kill, and makes no process-signal recovery claim. Broad owner/training/schedule/63
and allocation checks were not repeated after the independent test-initializer cleanup or exact consumer restoration.
