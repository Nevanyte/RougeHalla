# P-QUEST-GIVER-SOURCE-WITNESS — bounded source quest-giver evidence (source-only)

Continuation from frozen private `1310ae002870bf3fc674c7b65f38ff5ea55a7d75` on `deepseek/p-quest-giver-witness`
(head in the coordination report). Only NEW `tools/quest-giver-fixtures/**`, `parity/quest-giver/**` and
`docs/evidence/quest-giver/**`; production/native/old tools/corpora/shared status/Cargo.lock are read-only. No native
world/hash equality is claimed; the GPT quest-owner and Post Rust lanes are untouched.

## Captured profile and separation of witnesses

Generated map seed 1 attempt 0 (`decor:false`), three declared players Fire/Frost/Sentenced, real `createGameWorld`
with `mobs:true, signatures:true, quests:true, training:false, dummies:false`, `planSeconds` 2 for the planning case and
0 otherwise, `wishLockSeconds:0` for the status-attempt case; all positions/loadouts are recorded as actions. Every
case runs ordinary inputs and 50 ms steps and records source events/state. The only non-producer instrumentation is a
declared **read-only ledger tap** at the `beforeDamage` producer boundary, labelled in the corpus input and in
`diagnosticLedger` (it reads `world.combat.ledger`, writes nothing). The direct `addStatus` helper call on the giver is
recorded as a labelled helper action (`diagnosticAddStatusOnGiver`), never as runtime. No expected giver, status, damage,
telemetry or outcome was installed.

## Observed source facts (case matrix)

| Case | Actual source observation | Status |
|---|---|---|
| planning-then-active-birth | Lobby→planning: known quests 10, unknown 10, **no giver** (none in state.mobs), idCounter 45→65 with no actor input; active first tick: 10 real givers born, idCounter 304, first giver `mob7i` name `Cartographer Ines` at (2320,1680), facing 1.292497, hp/maxHp 5000; `standingCombatants` has 217 fighters incl. 10 `mob:quest`; runtime brain null, path0, history1 | PROVEN |
| movement-through-giver | p0 moves by real `move` input 2240→2400 and crosses the giver at x2320; giver position unchanged, runtime history grows 1→8 while brain/path stay null; giver `hostileFromP0` false | PROVEN |
| projectile-through-giver | a real bow shot from x2180 to a valid player at x2460 passes the giver at x2320 (arrow frames 2270→2405); the player behind takes the hit (~36.03); giver hp stays 5000 and no giver victim appears in landed/ledger; no interception | PROVEN |
| melee-through-giver | a real sword swing with the giver between attacker and valid player hits the player (~30.64); giver hp stays 5000; a direct `target`+`attack` at the giver itself produces no giver hit/damage | PROVEN |
| status-wish-on-giver | a real unit-targeted Freeze input at the giver is accepted by the input queue but produces no cast/status (target gate: non-hostile); a real Trial Wish cast at the nearby valid player creates its zone and applies the `zoned` status to that player while the giver's statuses stay empty; the labelled direct `addStatus` helper returns null for the giver and giver hp stays 5000 | PROVEN for the admitted/helper paths; limit below |
| fire-ember-through-giver | the giver is placed on an actual generated Embers tile by declared setup; a Fire player crosses under/through it by real `move`. The labelled ledger tap observes actual entries `{victim: giver, by: 'terrain:ember', raw: 5, arena: true}` each tick, `hazards.seconds.ember` rises 0→~3.0 s, giver hp stays 5000 and no hp damage row/landed hit exists for it (zero-HP change cannot hide the ledger entry) | PROVEN |
| expiry-retirement | a real `questAccept` at the giver starts the actual timer: accepted at 100 ms, expiresAt 300100 ms = 6000 fixed steps; after the real expiry (before-expiry frame 300000 ms, expired 300150 ms) the giver is removed (10→9), the public offer is expired, idCounter remains a recorded real value (304→316 across the 300 s because hidden offers reveal/birth other givers) | PROVEN |
| completion-retirement | a real known collect offer is accepted, its tokens are picked with real `pickup` inputs, the player returns to the giver and the real automatic turn-in removes the giver (10→9), public status done, idCounter unchanged 304 | PROVEN |

Additional observed facts: giver hp/maxHp 5000 and status unchanged in every attempted interaction; `isQuestGiver`
true and `hostile(player,giver)` false; runtime `brain` absent and `path` empty (AI exclusion), while
`standingCombatants` includes it for movement/history and a faction `signatureState` exists (`target:null, tier:0,
hpFrac:1, chill:1`) when signatures are installed. ID allocation/counters are recorded before/after each birth/removal.

## Limits / gaps (absence is reported, not zero telemetry)

1. **Direct status application on the giver is not reachable through an admitted Wish**: the unit-target gate rejects
   the non-hostile giver, so Freeze at the giver produces no cast. The Trial zone proves a real status-producing Wish
   applied `zoned` to the valid player and skipped the giver; the actual `addStatus` rejection of the giver is only
   shown by the separately labelled helper call (returned null), not by an admitted player cast on the giver.
2. Fizzle/Interrupted and other reason matrices, NPC/full-signature behavior, and native world/hash/event equality are
   outside this source-only packet and are not claimed.
3. The giver-on-ember placement is declared test setup (`placeGiverOnEmber`), not a source placement producer; the
   burn/ledger/hazard observations after it are genuine runtime outputs.
4. The ledger tap is a labelled diagnostic; it is not a gameplay producer and must not be read as telemetry the
   production server exposes.

## Checks / provenance

`bash tools/quest-giver-fixtures/capture.sh --check` reproduces the canonical corpus byte-identically (8 cases).
Corpus SHA256 `51c074b4c41b28147de7a2d215a581e617363ed5552a45aac4e46025b612d4fa`; image Node 22.23.4 linux/amd64;
capture tool hashes `capture.mts` `b0946ff2…`, `capture.sh` `23bdd66a…`, `run-mutants.sh` `fb3cfd8f…`; package-lock
`991869bd…`; 127 imported source files digest `e6efe7f3…`. Three committed actual-source semantic mutants
(`01-projectile-giver-exclusion-removed`, `02-hostile-giver-exclusion-removed`,
`03-giver-quest-damage-immunity-removed`) are killed by **actual runtime-output mismatches** (3/3; runner compares
`format`+`cases`, excluding provenance), restored byte-for-byte, unchanged control passes. A separate comment-only
provenance mutation produced identical runtime cases and differing provenance, so it is not counted as a kill.

Combined-guard mutant scope: mutant 01 (projectiles.ts:172) removes the `hostile(owner,c)` non-ally skip, the
`mobShot && c.kind=="mob"` skip and the `isQuestGiver(c)` skip from one predicate (owner and isEvading are retained);
mutant 02 (combatant.ts:151) removes both `isQuestGiver(a)` and `isQuestGiver(b)` from `hostile()`; mutant 03
(mobLife.ts hurtMob) removes both the `isQuestGiver(c)` immunity and the `!brain` no-AI early return, leaving only the
status-alive guard. These are combined-guard patches: a kill does not isolate a single guard site.

Metadata-only recapture (task-96): the runner safety repair changed only run-mutants.sh, which capture.mts pins in
provenance. Old corpus `49ca8a7c83d007fcf8dfbaad15552ef52c3cbfa8c42e67981877b68ae64e7f99` -> new
`51c074b4c41b28147de7a2d215a581e617363ed5552a45aac4e46025b612d4fa`; canonical format+cases payload SHA256
`ad6e10ddd7f2de02530b8ae037101315941aef4da815cdfd279773f32b215b8d` is identical old/new (deep-equal cases; capture
reports 1,229,692 bytes / on-disk 1,229,693 bytes); complete metadata except provenance.tools.runMutantsSh
(`9b4da71b…` -> `fb3cfd8f…`) is identical; capture.mts/captureSh/packageLock hashes are unchanged. No semantic/runtime
payload changed.

Runner safety: complete backups + manifest are built first and every backup is verified nonempty and SHA-256-identical
to source/manifest before EXIT/HUP/INT/TERM is armed; backup failures fail closed with originals untouched. Restore is
SHA-verified, single-shot cleanup uses signal exits 129/130/143 while EXIT preserves the normal result, recovery bytes
are retained on failure, logs are unique mktemp paths, and SIGKILL is untrappable and not claimed. The disposable
controls in tools/quest-giver-fixtures/tests/runner-safety.sh exercise mocked cp failure/partial copies, HUP/INT/TERM
during the checked-copy window, and restoration failure with retained recovery; they use temporary files only.

A separate checker should audit the declared actor/profile/producer binding and the case matrix; this packet claims no
implementation/admission.
