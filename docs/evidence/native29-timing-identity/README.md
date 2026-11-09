# Mirrored timing identity follow-up — CODE ONLY

Base `3e5a1fafa6a610e8802edd8503463771fa517764` remains preserved on `codex/walk-hint-native29`. New branch `codex/native29-timing-identity` carries code commit `5d4d3c116d809d931abbef2c8e915d5e8d37ba57`. This packet adds only content.rs, the new mirror_timing_content integration tests and this dedicated evidence. **No Cargo/rustc/build/test/content-hash execution or cache use occurred.** Root independently reviews and executes the combined identity gate. Formatting/static checks are not compilation proof.

## Exact API and aggregate path

- `pub fn visit_mirror_timing_content(word: impl FnMut(u64))` streams actual `mirror_timings` results for all5 actual paced factions ×6 actual weapons ×2 profiles ×4 finite input pairs: `(1,1)`, `(1.5,0.5)`, `(0.5,1.5)`, `(1,1.5)` =240 rows. Fixed stack arrays and direct callbacks only: no production Vec/String/Box/collect construction, I/O, cache or canonical state.
- Internal transcript domain `mirror-timing-probes/1`; ordered faction/weapon/profile key tables include cardinalities, numeric keys and durable names. Input table contains exact AS/windup bits. Nine row keys are `profile,faction,weapon,asMult,windupMult,interval,windup,root,ranged`; each row emits those exact key/input/result bits and ranged flag in that fixed order. Row order is faction→weapon→player/NPC→input-pair. Cardinalities/row count/schema are explicit.
- Private `RuntimeWords.timings:Option<&[u64]>` defaultsNone. The **real content_hash_of_definitions aggregate** invokes existing `fold_status_stream` with separate domain `mirror-timings/1`, supplying actual visitor output by default (count pass then data pass), or the provided timing words only through the sensitivity seam.
- `pub fn content_hash_of_mirror_timing_words(registry:&[Entry],stagger_weapons:&[WeaponId],words:&[u64])->u64` follows the same aggregate/definitions/registry path as existing progression_words. It overrides only this output stream, never gameplay formulas/state, other visitors or registry values.

## Tests written, ALL UNRUN

Five tests independently parse the complete keyed240-row stream and reject trailing data; bind actual supplied words to `content_hash()`; change **each emitted word** through the real aggregate; remove/reorder complete rows; isolate a profile key change without touching its numeric payload; associate all18 unchanged NPC source observations (including seconds/ms/root/ranged exact bits); and check real branch-sensitive floor/reduction/increase/clamp outputs.

The source18 association reuses immutable `parity/walk-hint/helpers/source.json`,40317B SHA `a7b8feda1aca08fe20f5a46ee11f57959a2a186619caf73611a67cb086eaae06`. No source value or fixture is edited/recaptured. The fourth finite input pair is an identity probe of actual current Rust arithmetic, not a newly captured source outcome.

## Exact coverage limit

Every current player/NPC root output is zero (including NPC_AXE_ROOT/share0). All root bits are streamed and tested for hash sensitivity, so changed root output/tuning changes identity. This finite grid **does not reach or claim** scaleWindup's positive-root branch. No synthetic positive-root timing input or gameplay constant is introduced. The fourth pair does reach NPC Fire Bow's interval clamp; the source-covered fast Bow row distinguishes the actual NPC base-speed floor. Fire fast Wand is not used as a false floor discriminator.

## Preserved / deferred

Static byte comparisons confirm all4 real timing functions (`player_timings,npc_timings,scale_windup,mirror_timings`) and the entire old formula-probe block are unchanged. Existing probes remain in their old order; the new domain is inserted beside progression/status streams. No gameplay semantics/constants, source fixtures, final golden, native tape, header/version/status/Cargo.lock/other Rust path is changed. Root applies one final content/golden/tape admission after combining this code.

Formatter command (exit0, empty format.log): `rustfmt --edition 2021 --config skip_children=true --check crates/rh-sim/src/content.rs crates/rh-sim/tests/mirror_timing_content.rs` (actual invocation uses the bundled1.97 tool path). `git diff --check` also passed. Compilation, tests, aggregate sensitivity and numeric assertions remain UNRUN. Suggested Root gate: `cargo test --locked -p rh-sim --test mirror_timing_content --test progression_content --test status_content`, followed by Root's final content/golden checks. These commands were not executed by this worker.
