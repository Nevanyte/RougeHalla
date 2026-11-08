# Private owner-combat projection leaf

Based on private130cbab167bf2354928feb783bc75f58f26ba189. Carries coordinator's exact test-only warning repair8e6a5562 as localcad8bea6 (same patch). This leaf is deliberately not bound to SelfView, an observer, server publication, any codec, Unity or policy. It adds no canonical state and changes no gameplay/content/header/version.

`owner_combat::project(&Player, current_entitled_ids)` reads authoritative weapon.draw_started_at and weapon.ready_at, and only the exact three cached modifier wire mirrors. It does not read now, ready_in_ms or a pending action, refold modifiers, allocate, retain identity or issue an action capability. Its group is returned whole or refused. The module and its narrow getter allow dead_code only in non-test builds because activation is expressly held.

The pure source_to_u32 helper reproduces ECMAScript/schema truncation and modulo2^32, including declared negative/nonfinite inputs. The native projector separately rejects nonfinite canonical clocks BEFORE conversion. Mirrors retain binary64 thousandths; invalid/nonfinite/fractional/below-source-min cached values refuse the whole group. No u16/20x ceiling or new upper saturation is imposed. The helper's nonfinite->0 boundary behavior is not permission to mask corrupt native clocks.

Lock is Clear for an empty canonical target, otherwise Held with identity only from supplied CURRENT entitled membership. Held(None) preserves the approved owner's held state while narrowing source identity disclosure, including the one-step bush case. It carries no hidden raw ID/coordinates, mapping/history table or reference allocation. This leaf still returns native IDs for already-entitled candidates; one-time current-stage ActorRef mapping remains unimplemented and must precede public delivery.

## Imported immutable source and actual checks

Exactly two new corpus files are imported byte-for-byte from sealedd061aacd61c2338d00dd51119cab4d2651f4a23d, with no generator or expected-value edits and no recapture:

| File | Bytes | SHA256 |
|---|---:|---|
| parity/policy/owner-combat/producer.json |2483560|399758fd97403383c57c8e0395f9196d4d6ad23afa2ee57e7c5396bce6911ba2|
| parity/policy/owner-combat/boundaries.json |41479|6b040642ad184405b9c924cb10821fb3d174a6a539b802d5d9597500ee427e60|

Six focused tests pass. These include26 source schema+bot boundary rows;1616 clock conversions across all808 recorded frames; exact mirror bit retention over the source encoded/large-finite boundary values; native nonfinite-clock refusal before normalization; invalid cached-mirror refusal; and projection-only paired hidden A/B redaction plus known->unknown->Clear transitions. The mirror cache injection in the invalid/large-value test is a labeled diagnostic, not a gameplay grant or ordinary nonidentity producer.

The native prefix test uses real reset_active scenario creation, declared ground racks and ordinary ItemObserver-resolved Pickup plus validate+Sim::submit Target/re-click/retarget/Move/Stop/Attack/Release. It compares all136 recorded frames of L01/L02/L03/D01 to source-decoded lock, draw, ready and identity mirrors. Its map recreates the shared wall/floor layout; bush metadata is unnecessary for those four paths. reset_active already includes the source's raid-start t=50 step; no extra warm step or clock adjustment is installed. Before/after projection state_hash remains equal at every frame. This does not claim full native world/event/actor parity.

One separate explicitly ignored allocation test is actually run by its exact name. It reuses the inherited cfg(test) Frost dhat allocator, warms setup/profiler state, then measures90000 successful/error projection calls across empty/nonmatching/matching memberships. Every measured interval adds0 total heap blocks across the process, a conservative stronger bound on invoking-thread allocations. Other tests are excluded from that run; no second/runtime allocator or unsafe code is introduced. It also preserves the simulation hash.

Content scanner and unchanged content golden67183626db240b6a pass. The only registry explanations are the approved source-u32 representation modulus and the coordinator-approved inherited Full-base FROST_ALLOC test infrastructure repair. They change no registered game number. Strict `cargo clippy -p rh-sim --lib --tests -- -D warnings` and workspace formatting pass. Logs/checks/source manifest retain exact evidence; no broad simulation/workspace/source campaign was run.

## Reproduce

Use the project's final-env.sh and an isolated CARGO_TARGET_DIR. Commands:

```sh
cargo test -p rh-sim owner_combat:: --lib -- --test-threads=1
cargo test -p rh-sim --lib owner_combat::tests::projection_allocates_zero_for_visible_hidden_changed_identity_and_error_paths -- --exact --ignored --test-threads=1
cargo test -p rh-sim --test content every_const_in_the_source_tree_is_registered_or_explained -- --exact
cargo test -p rh-sim --test content hash_golden -- --exact
cargo clippy -p rh-sim --lib --tests -- -D warnings
cargo fmt --all --check
```

## Held scope

The source d061 slice is10 PASS+2 BLOCKED, not a complete owner-combat lifecycle: no new target death/permanent removal, draw cancel-versus-swap, conditional speed/clear or training down/reset proof is claimed. It kills three producer categories plus an optional UI helper, not four producers. Root waived only the inadmissible windup-specific producer requirement for that profile and rearmed source work for missing ordinary paths/genuine farm-earned attack speed; this leaf adds no grant fallback or waiver of nonidentity/live admission.

Still required before activation: completed source gates; prepared observer/current-stage reference mapping with drop/encode/enqueue/renewal controls; root/network-coordinated protocol14 union/goldens/three codecs; owned human and policy adapters with explicit unavailable/clear/epoch rules. No public admission, render/performance, headless bridge, browser, Editor or cloud result follows from this leaf.
