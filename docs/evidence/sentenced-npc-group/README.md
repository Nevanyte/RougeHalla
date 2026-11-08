# P-SENTENCED-NPC-GROUP-WITNESSES — bounded actual-source NPC Mark and camp-group evidence

Source-only continuation from admitted `optimization_port` `70579162ce41a1325aaed1a65a34b65b779ad1e7`; only new
`tools/sentenced-npc-group-fixtures/**`, `parity/sentenced-npc-group/**`, `docs/evidence/sentenced-npc-group/**`.
Production/native/server/client, old fixtures/tools, shared status, Cargo.lock, content/tapes/goldens untouched; the
five strict source-born Wish cases are unchanged. No public policy/architecture/format/admission decision; no second
Rust kernel.

## Captured profile and separation

Real `createGameWorld` on generated map seed1 attempt0 with two declared players (Sentenced p0, Holy p1), catalog-rolled
camps/mobs, real AI and ordinary player `attack` commands, 50 ms steps. `mobs:true, signatures:true, quests:false`.
Actions (hp/place/weapon/input/grant) are declared setup. The only instrumentation is a labelled read-only
`beforeDamage` ledger tap for pulses (`pulses` rows); it writes nothing and is not gameplay telemetry. Existing
`parity/sentenced/runtime-matrix.json` and `denial-matrix.json` are referenced as prior trusted-setup evidence only,
not as ordinary gameplay and not duplicated.

## Case matrix (6 cases, actual source outputs)

| Case | Actual source observation | Status |
|---|---|---|
| npc-sentenced-melee | Real catalog Sentenced melee NPC (`sword`) camp 20 fights a player; NPC `mob3j` builds its own Mark on p0 (`target p0`, group `fighter:p0`, size1, tier4, hits14) and real pulses by NPCs land on p0; p0 also builds camp:20 group Mark (tier4, hits36); player hp falls 5000→1051 | PROVEN |
| npc-sentenced-ranged | Real catalog Sentenced bow NPC camp 17; five NPCs each build `fighter:p0` Marks (tier4, hits14) and pulse p0; p0 camp:17 group Mark size5; player hp falls 5000→3606 | PROVEN |
| player-vs-camp | Sentenced p0 attacks a real 5-member camp; first `markGroupSize` 5 (`camp:1`), pulses hit all five members once per qualifying tick, group Mark tier2/hits3; original size recorded before any death | PROVEN |
| camp-sibling-death | Real retarget/handoff attempt after 160 ticks; no sibling death was reached inside the bound, group size stayed 5 and the frame shows the original-size state; pulses/continuation are recorded | PARTIAL (no death/Return reached) |
| storm-vs-camp | Real `gatheringStorm` card grant; same 5-member camp; progress 4.5 vs 3 neutral over the same three marks (tier2), pulses unchanged | PROVEN |
| dummy-singleton | Real training dummy singleton through an admitted training constructor; group `fighter:mob15`, size1, tier4 hits9, pulses observed | PROVEN |

Relevant observed actor facts: `markGroupOf` yields `camp:<index>` for camp members and `fighter:<id>` for players/dummy;
pulses are recorded once per live member per qualifying hit for groups; NPC source rows use the real catalog weapon
(sword/bow; no injected weapons, no fake Player); player p0's group identity/size is captured in `fighters`; camp IDs,
mob IDs and source events are recorded. The five strict source-born Wish cases were not edited or run as a modified
campaign.

## Gaps / remainders (exact)

1. **Sibling death, Return, focus handoff and original-size-after-shrink were not reached**: camp member HP pools
   survived the bounded 160-tick attacks; the captured frame shows the preserved size/state but no real death/Return.
2. **Weapon swap/Trial convicted near group and unfocused member** were not captured in this bounded corpus; the
   existing trusted setup `parity/sentenced/runtime-matrix.json` and `denial-matrix.json` remain the reference for the
   filter/denial domains, not an ordinary-gameplay witness.
3. **Tier-four execute denial with multiple owners/foes, death earlier in the pass and deferred payouts** was not
   reached in the 6-case bound; no denial output was installed or inferred.
4. **Zombie/campless/other practice controls beyond the real training dummy** were not captured; the dummy case uses the
   admitted training constructor.
5. No native world/hash equality, NPC/player-bonus or mutable-denial-set claim is made.

## Checks / provenance

`bash tools/sentenced-npc-group-fixtures/capture.sh --check` is byte-identical. Corpus SHA256
`d64e822b3e79540e99a0c82d4bfe331aa16df547587456fe35f5c237e5fda780`, 555,087 bytes, 6 cases. Pinned
node:22.23.4-bookworm-slim linux/amd64; tool hashes `capture.mts` `40904ce4…`, `capture.sh` `4bf4b233…`,
`run-mutants.sh` `c768493a…`; package-lock `991869bd…`; 127 source files digest `e6efe7f3…`. Three committed actual
semantic mutants are killed by actual runtime-output mismatches (3/3): `01-duplicate-or-unscaled-group-pulse`,
`02-current-survivor-size-wrong`, `03-wrong-regional-pool`; restoration exact, unchanged control passes. A comment-only
provenance mutation produced identical runtime cases/differing provenance, so it is not a kill.

Metadata-only recapture (task-92): the runner hardening changed only run-mutants.sh, which capture.mts pins in
provenance. Old corpus `82f1c909fa8679f5bda697a3537951f72bc89d17d7d2d28cfb87f50a4b29381f` -> new
`d64e822b3e79540e99a0c82d4bfe331aa16df547587456fe35f5c237e5fda780`; format+cases canonical payload SHA256
`4481b6add3e685b4202bf80e814d9dea821285d3a688fe3ecfab44d68308cf82` is identical old/new (deep equality, same
555,087 bytes); complete metadata except `provenance.tools.runMutantsSh` (`9ba3c6bb…` -> `c768493a…`) is identical.
No semantic payload changed. Runner hardening: complete backup copies + manifest are built first, then the completed
backup is verified (size>0 + SHA-256) against manifest/source before EXIT/HUP/INT/TERM is armed; backup failures are
fail-closed with the source untouched; unique mktemp logs; hash-verified exact restoration and nonzero failure
propagation retain recovery bytes; SIGKILL is untrappable and not claimed.
