# Native quest-giver lifecycle (private Slice 2)

This stack starts with representation prerequisite `b4d209fe4605fdc4f20597e243d7e19a10c226b4`, merges the coordinator-approved source/tool admissions at `86ead858`, and composes sealed Full implementation `86b09783de35afbbd69fa06eba40caebf26d64a6` through private union `130cbab167bf2354928feb783bc75f58f26ba189` (merge `765f9727a6710afbb76e000ec198091bf841a9f0`). The latter merge retained the Full NPC diagnostics, actual faction eligibility, farm notices, weapon swaps, HitLanded/stagger/Overkilled order, and camp-mate melee contact with zombie-specific transparency. The later coordinator test-only cfg repair `8e6a5562` is included by equivalent source adaptation.

Offers now link to a real `MobKind::QuestGiver`, with neutral affiliation, no weapon/type/regional brain, source HP 5000, stationary rewind history, and immutable typed birth provenance. Birth consumes the global entity serial before parcel/token containers. Planning allocates offer IDs before initial camps; immediate publication interleaves known givers and containers with offer IDs after camps. Hidden reveals retain the real four-second head start. Retirement removes the live actor and link, without death/combat hooks, while provenance survives the closed-offer sweep. No retired-body or signature-map cache is invented.

The shared hostility predicate excludes givers in both directions while preserving owned-zombie rules. Melee removes givers from the standing-body candidate list, preserving Full's ordinary camp-mate contact semantics. Target/ability selection and status admission reject them explicitly. Both input doors reject giver actions before changing queues or budgets; a regional actor whose real brain is temporarily borrowed remains supported. Givers take part in terrain exposure and real pre-apply ledger bookkeeping, but actual HP/applied damage remains immune. No new diagnostic probe/storage/hook was added: the reader uses the existing finalized `Sim::damage_entries()` boundary.

Restore reconstructs the immutable quest placement/stream and initial serial order from the existing secrets and map. It checks offer/body/provenance crosslinks, actor and global serial bounds, typed affiliation/capabilities, stationary history, resource disjointness, target ownership, and retirement semantics. It rejects unpublished accepted/closed runtime, malformed neutral bodies, forged links, and giver combat references without panicking. This reconstruction only runs during validation; it does not advance gameplay RNG or add a birth-plan cache. The camp validators account for the real planning prefix and exclude givers from camp membership. Existing actor/entity headroom includes future quest births and resources.

The final restore-only audit also rejects a missing runtime only when the existing quests/nontraining/source-map-camps guard and Planning/raid phase necessarily spawned one. Real pre-spawn, quests-Off, no-camps and training worlds remain valid. Hidden origin records with a retained offer require its published/finder/publication clock facts. Birth/history reconstruction uses elapsed ticks relative to the actual finite clock, not an assumed epoch; the existing `TIE_EPS_MS.max(8 * f64::EPSILON * now)` allowance handles f64 arithmetic. Source history trim can retain one fewer boundary sample at a rounding boundary, so only that one window-boundary variation is admitted; the latest timestamp remains exactly now. No canonical clock value is rounded or rewritten. Native controls use pre-spawn epochs 0.1, 1/3 and corresponding high offsets, real known/hidden births, restoration and continuation. Declared human placement resets isolate the pre-existing human exact-history-gap validator; giver histories and clocks are never edited.

The schedule repair honors the already-valid `fire_roam` mode flag in mob worlds and supplies the corresponding compiled Frost/quest/FireRoam combinations. It changes no row order, installer entry point, constructor eligibility, or gameplay table. Earlier Full+FireRoam lifecycle runs before this repair did not exercise those disabled rows. The final Full lifecycle, headless and allocation controls were rerun with the flag honored. The separate strict 63-case source gate retains its actual nonroam profile.

## Captured source scope

The unchanged eight-case corpus has file SHA256 `039d4e058fa914f42080f1c55d8640cc508c5b4745504930ca3db49579adc8b4`, format/cases payload SHA256 `ad6e10ddd7f2de02530b8ae037101315941aef4da815cdfd279773f32b215b8d`: 74 frames, 39 ordered actions, 6,337 actual native steps. All cases execute their ordinary constructor/join/input path with the actual Full+FireRoam installer set, map seed 1/attempt 0/decor false, and source config. An installed regen module does not override the source's omitted/default-false regen switch.

| Captured case | Actual steps |
|---|---:|
| planning-then-active-birth | 42 |
| movement-through-giver | 41 |
| projectile-through-giver | 81 |
| melee-through-giver | 31 |
| status-wish-on-giver | 45 |
| fire-ember-through-giver | 61 |
| expiry-retirement | 6003 |
| completion-retirement | 33 |

The reader compares real giver bodies/history/signatures, global birth counters, quest state/links, standing counts and identities, player pose/HP/status/cast/history/outcomes, and terrain exposure. It consumes every ordered action, including the declared direct status helper after the final status-case snapshot. The valid player behind a giver remains a positively compared recipient. The Ember case produces 60 real pre-apply giver ledger entries with raw 5 and the source arena flag; applied/landed giver damage and giver Hit/Death events remain absent. The native typed terrain source's display label `Lava` is normalized to the captured stable ID `terrain:ember` only for that exact source identity.

Source `rt.fighters` creates its signature row lazily; native signatures are inline defaults from birth. When the captured row is null the test asserts a real default native signature; when present it compares values. The corpus does not expose source stale reference-cache lifetime after retirement, so no equivalence of that storage lifetime is claimed. The Ember relocation changes only the coordinates specified by the source setup; its altered stationary actor checkpoint is explicitly refused, while ordinary source lifecycle snapshots restore canonically.

These are giver-specific source assertions, not whole-world event, projectile, terrain-map or quest-notice equality. Quest announce/refusal/reveal events and public transports remain deferred. No source outcome was installed into native state, no source capture or golden was regenerated, and no ML artifact was created.

## Scoped validation

Exact commands, source-file hashes and captured log hashes are in `slice2-verification.json`; logs are under `slice2-logs/`. All Rust commands source the existing `final-env.sh` and then use the giver worker's isolated target directory.

* Quest suite: 25 passed / 1 separately ignored allocation test, including all eight source cases and six new native lifecycle/input/restore/schedule controls. After the final two restore-only controls were added, the focused `neutral_giver_` suite passed 10 tests / 1 ignored allocation test (eight native controls plus constructor/view checks); the unchanged source campaign was not repeated for that final audit.
* Owner quest-view suite: 21 passed; typed ownership, preview/bot limits, lazy hidden identities and transactional prepare/drop behavior remain covered.
* Strict Full source: 1 test / all 63 cases, zero pending. Full replay/restore numeric controls: 2 passed / allocation test separately ignored.
* Headless: actual Full and actual Full+FireRoam external input/restore continuation, plus public-handle quest acceptance/neutral target refusal and a fresh-session continuation (2 tests).
* Protocol13 refusal: the existing unsupported giver/neutral/unarmed publisher test was rerun against the live-giver implementation (1 passed).
* FireRoam source: 2 tests over the two captured fixtures, including 950 per-tick restores and source/schema/provenance negative controls.
* Isolated allocation gates: one Full Mark/Frost test measures 20 warmed restored steps in each mode; one Full+quests+FireRoam test measures a quiet 20-step warmed restored window with actual live givers. Both allocate zero blocks in their measured windows. Birth/retirement allocations and arbitrary full-game load are outside that claim.
* Selected sim/server/policy/headless/parity Clippy: all targets, default and all features, strict warnings; formatting/whitespace checked.

## Admission held by coordinator

Public quests stay closed. Protocol13 bytes/tags and concrete player/self fields are unchanged; unsupported giver/neutral/unarmed observations are refused before publisher/observer authority commit. Private OBS20/policy14 reservations remain. Checkpoint28/replay22 are reserved by the coordinator for this changed private layout; this worker deliberately leaves the inherited checkpoint27/replay21 headers untouched. Content identity, derived tapes, final public actor/quest codecs, status records and activation are coordinator-owned follow-up work. This is a native implementation delivery, not public release admission or a full-port completion claim.
