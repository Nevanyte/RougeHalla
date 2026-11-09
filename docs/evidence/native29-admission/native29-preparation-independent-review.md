# Native29 private preparations — independent source review

**SOURCE-READY pending compilation and focused execution: corrected Root digest preparation20f3bd2b plus hash preparation50ac37a94f07bd02c07d895c576b25f47ab40864. Not native admission.** Original d21a3fb4 contains the concrete test-constructor blocker below and remains a retained predecessor, not an executed passing receipt.

Read immutable Git blobs from private base2f1c4758e0db84515551f483c6df0d23879f4a99. Root digest source d21a3fb4a5ddd10ea5bd3f26ff16d79bdcaf7c7f, correction20f3bd2b; test-only code0eca8958e1b86a46fca9a0ad60c94ec58a1aed93, evidence50ac37a9. No build, Cargo/cache, test, Editor, capture, WIP/source mutation or Git operation that changes state was performed. All new test execution is UNRUN.

## Concrete Root setup defect — fixed in20f

`rh-headless/tests/mark_tax_digest.rs::scene(true)` at d21 combines MobMode::SpawnFoundation with Sentenced-capable faction mode. Actual systems/mobs.rs::admit_factions refuses non-Off faction modes unless MobMode::Pve; initialize_body calls it, and foundation restore independently requires FactionMode::Off. Therefore d21's NPC test necessarily panics before digest assertions.

20f3bd2b changes only SpawnFoundation→Pve in that test. Static admission is now consistent: complete Sentenced-capable mode is allowed, this fixture's only camp is Fire with3 spots, actual validated layers exist, and mob_checkpoint dispatches its PvE validator. No abilities/consumables/initial_loot=true prerequisite exists for this scene. The actual map fixture has no props/buildings/crateSpots/groundSpots/features; initial_loot=false's constructor probe therefore has no missing object storage requirement. Do not generalize this to arbitrary maps with real loot objects. No production guard was relaxed. Actual constructor/restore execution is still required.

## Root digest/TLS preparation

The8-line production change in rh-headless/src/digest.rs folds PublicPlayer.mark_tax and NPC ActorView.mark_tax only when nonzero, using tagged public_mark_tax plus the integer percentage. For all zero values the executed byte-fold sequence is exactly the predecessor sequence; the new tag adds no unconditional marker, length or zero scalar. This is source proof of old-zero fingerprint preservation, not an independently computed golden result. Existing normal headless fingerprint checks remain relevant during execution.

No private tax binding owner/cache/index is read by OutcomeDigest. The new restored historical controls correctly couple positive public percentage to SIG_TAXED and a matching victim binding; percentage0 leaves no public row and clears the bit. Source mark_tax::validate explicitly permits historical player-namespace markers without today's faction/tier/near/alive reconstruction. Private owners1 and3 are real retained player identities, distinct from each chosen victim. Tests compare private-owner-changed snapshots equal, canonical state hashes different, and behavior digest equal; positive15→20 must change behavior digest. No gameplay producer/source parity is claimed by these declared serialization states. Actual enabled public projection and digest tests remain UNRUN.

The exact3 NON_GAMEPLAY additions name PHASES, PUBLIC_MARKS and SEEN_SIGNATURE in systems/sentenced/mark_tax/source_tests.rs. Each declaration exists; the entire source_tests module and record_phase entry are cfg(test), observational, with World borrowed read-only. These are narrow filename+declaration exemptions for captured phase/RNG/signature bookkeeping, not gameplay constants, public fields or content-hash exclusions. No broader number-free exception or production tuning was added.

## Hash preparation legality and coupling

Six seeds are explicitly DECLARED serialization states, not earned cards/Marks/WalkHints:

| Seed | Source-level legality / purpose |
|---|---|
| watched fight-only | Adds one real SlowStarter count and a nonempty fight tuple start0,last=worldclock. The watched conditional is inactive at these fresh ticks and existing cached holds remain false, so no derived stat change is installed. Cache validation re-folds the real rows using the retained holds bits. |
| watched fight+Wish | Same clock plus the real preexisting WishSpend from wish_states; independent owners coexist. Both Runtime option fields are present, no serde default or empty lazy runtime is manufactured. |
| tax index-only | Complete Sentenced-capable config, historical retained IDs, distinct nonself victims/owners, unique victim rows; no public bits/cache. This admits independent victim/by and shortening edits. |
| public tax | Victims2/4 have positive48/23 public rows, corresponding taxed bindings, and exact SIG_TAXED bits; third nonpublic binding allows valid index shortening. Historical caches need not reconstruct current Mark ownership or rates. |
| hint255/3 | Existing private Player fields permit bounded dir255/ticks3; strictly labelled declared bytes, not a producer or config-flag proof. |
| retained dir255/0 | Retains direction when ticks0, exercising absence of a false zero-direction canonical constraint. |

Fight validator requires finite0<=start<=last<=worldclock; only Source lifecycle imposes absolute50ms grid. New ±TICK_MS candidates supply an accepted start+50 and last−50 on these seeds (and retain refusals for negative/future alternatives). The comment about one-ULP grid refusal is specifically true for Source lifecycle; Off also admits fractional epochs. Using grid-sized candidates does not weaken Off validation or excuse an unhashable clock. Removing fight from fight-only may legitimately leave an empty invalid runtime, while the fight+Wish seed provides a lawful nonempty counterpart.

Generic assertions require8 populated leaf patterns, nonzero hint dir/ticks, and accepted hash-changing perturbations for7 independently editable patterns. public_tax.victim is intentionally the eighth populated but structurally coupled pattern; valid whole-row permutations separately require both ordered taxed and public_tax vectors to change canonical hash. All accepted mutations, including paths listed in VALIDATED, still unconditionally require a changed hash. No unhashed-field exemption is introduced.

Exactly3 new VALIDATED entries reflect actual restore constraints:

1. taxed.*.victim can orphan a positive public row; index-only seed still requires an accepted victim mutation.
2. public_tax.*.victim must agree with exact per-actor SIG_TAXED and a retained binding; isolated identity edits can break that relationship.
3. public_tax.#len removal can strand SIG_TAXED without a percentage.

The public cache percentage mutation remains independently required and cannot be hidden behind these entries. Swapping whole rows changes canonical ordered identity without breaking victim/bit membership. Existing card_runtime/wish_cast descriptions are corrected for watched fight memory; their pattern set is not broadened.

## Format refusal and artifact checks

Checkpoint predecessor28 joins existing older tags. The new malformed world/statics plus wrong content control explicitly tests UnsupportedFormat under format-first and format-last payload key orders, with wrong content first in both. This checks tag precedence rather than relying on a later payload/content error. Replay predecessor22 likewise must yield ReplayError::Format before its wrong content/first expected hash, and the fixture has nonempty recorded hashes. Neither test adds old-format defaults or compatibility.

All4 evidence manifest entries match immutable50ac byte counts/SHA256; all3 source.json test-file pins match. code.patch is byte-identical to the actual scoped2f1→0eca diff. Evidence source.json/README truthfully say compiled=false, testsExecuted=false, execution NOT_RUN. Retained rustfmt syntax/diff checks are explicitly not a typecheck or execution pass. Review did not rerun them.

Root can compose these source preparations, then use the stated first cheap gates: declared seed restore/ordered-vector test, predecessor checkpoint test, predecessor replay test, and corrected headless digest test before the full generic campaign. Retain any first constructor/restore/typecheck failure. No scope expansion or new production change is requested by this review.

Produced WalkHint and None/Some(false)/Some(true) SimConfig.walk_hints coverage remain intentionally HELD until the exact frozen producer arrives. These declared private bytes do not close that gate. Final content identity, broader timing-visitor/hash coverage, old tapes, allocation/source campaigns and publication remain Root-owned; preparation source readiness is not admission or evidence of gameplay.
