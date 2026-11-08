# BOT_TRIM_REPAIR (P-BOTS-7b follow-up): exact source trim membership, exhaustive scalar check, NEL controls

Lead packet: coordination/packets/BOT_TRIM_REPAIR.md (authoritative). Base: immutable ce246222 (BOT_FILL_REPAIR head) on
the isolated branch deepseek/bot-trim-repair. No root merge/push; no schema/observation/protocol/shared-status/Cargo.lock
or learning-storage architecture change; the expert lease and root's explicit default-Off learning mode are untouched.

## The source mismatch this repairs

The previous trim predicate used Rust's char::is_whitespace (plus FEFF/LS/PS). Rust's property includes U+0085 NEL, but
ECMAScript String.prototype.trim — the trim the actual legacy config source applies to every BOTS_* value — does NOT.
Consequences fixed here:

- BOTS_FILL_TO="\u0085": the old trim stripped NEL, leaving an empty string that Number reads as 0, so fillTo became 0
  instead of the source fallback 8.
- BOT_STATS_FILE="\u0085off\u0085": the old trim produced "off", disabling the learning subsystem, instead of leaving a
  literal file path (learning enabled) as the source does.

## What changed

crates/rh-server/src/bot_fill.rs: the broad Unicode property is replaced by is_js_trim_space(), the exact 25-code-point
ECMAScript trim membership, with the input scope (the BOTS_* environment surface's trims: num, parseMix items,
BOT_STATS_FILE and BOTS_SEED) and runtime scope (the pinned linux/amd64 Node 22.23.4 container) stated at the function.
trim_js_whitespace() now trims exactly those members. FEFF and the line terminators (U+000A/U+000D/U+2028/U+2029) remain
members; NEL is not; U+180E is not (not captured); the 0x1680/0x2000-0x200A/0x202F/0x205F/0x3000 spaces remain.

The membership is committed as a small list in parity/policy/bot-runtime.json ("trim", 25 code points) — not a
million-row corpus. It was captured from the pinned container by the existing tools/bot-runtime-fixtures capture tool
evaluating the ACTUAL unchanged legacy config source: config.ts parseMix applies String.prototype.trim to each
name:weight item, so a probe that surrounds the weight "6" with the candidate code point leaves easy:6 for a member and
falls back to the default mix for a non-member. The probe runs over every Unicode scalar value (surrogates excluded) and
the capture additionally cross-checks that the runtime's String.prototype.trim membership is identical, so the committed
list is the source's trim surface, not a guess.

parity/policy/bot-runtime.json is extended additively: config cases 82 -> 99 and the raw Number oracle 44 -> 53, plus the
new trim section. Existing values are unchanged — verified by prefix equality of the previous corpus's format,
provenance, delay, mixes, config and numbers against the new file (only the structural comma before the new top-level key
differs); capture.sh --check reproduces the new bytes exactly
(sha256 6479be3df339f4b367dd9edb8a2fcd9f22ee26bc0370920f40fd21edf25f6cc3).

Additive actual-source cases (all evaluated by the unchanged legacy source in the pinned runtime):

- NEL controls: BOTS_FILL_TO="\u0085" and "\u00856\u0085" fall back to 8 (Number is NaN); BOTS_ARRIVAL_SECONDS="\u0085"
  falls back to 12; BOTS_SEED="\u00857" is null (Number NaN); BOT_STATS_FILE="\u0085off\u0085" is a literal path
  (statsFile "file", learning enabled); BOTS_TIER_MIX="easy:\u00856" keeps the default mix (Number("\u00856") is NaN).
- Positive real-whitespace controls: NBSP/BOM/LS-PS/VT-FF-wrapped numeric values trim to the value (fillTo 6, arrival 3.5,
  latency/jitter, seed 7), NBSP/BOM-wrapped "off" is off, and NBSP/BOM-wrapped mix weights are 6.
- Raw Number oracle extends with "\u0085", "\u00855", "5\u0085", "\u0085 5 \u0085", "\u00a0\u00855\u00a0" (all NaN:
  NEL is not whitespace, and a NBSP wrapper only trims the ends) and the members "\ufeff 5 \ufeff", "\u2028 5 \u2029",
  "\u000b5\u000c", "\u00095\u000a" (=5).

## Proof

- New exhaustive check: bot_fill::tests::the_js_trim_membership_is_exact_over_every_unicode_scalar walks every Unicode
  scalar value and compares is_js_trim_space against the captured membership, so a single extra or missing member fails;
  it also pins the trim helper on NEL (stays) and FEFF/LS/PS (removed).
- New negative control: bot_fill::tests::the_old_whitespace_property_is_the_trim_negative_control keeps the pre-repair
  predicate, proves it differs from the captured membership exactly at U+0085, and reproduces both reviewer-named
  behaviours through BotFillConfig::from_env; its positive real-whitespace controls trim.
- Restoring the broad property is a committed mutant:
  tools/bot-runtime-fixtures/mutants/01-restore-is-whitespace.patch with tools/bot-runtime-fixtures/run-mutants.sh.
  Measured: "1/1 mutants killed; unchanged control passes" — the restored wide predicate fails the semantic bot_fill
  parity tests (NEL number oracle and the exhaustive membership check), not a compile or setup error.
- Focused checks run for this lane: cargo test -p rh-server --lib --all-features bot_fill (12 passed, including the two
  new repair tests and the additive corpus/oracle cases); cargo fmt --all --check clean; cargo clippy -p rh-server
  --all-targets --all-features -- -D warnings clean; bash tools/bot-runtime-fixtures/capture.sh --check PASS. The lead
  runs the combined gate.

## Files

- crates/rh-server/src/bot_fill.rs (exact membership + scope docs)
- crates/rh-server/src/bot_fill_tests.rs (exhaustive scalar check + old-property negative control)
- tools/bot-runtime-fixtures/capture.mts (source trim-membership probe and the additive controls)
- tools/bot-runtime-fixtures/mutants/01-restore-is-whitespace.patch + run-mutants.sh (restoring-is_whitespace mutant)
- parity/policy/bot-runtime.json (additive: trim membership, 17 config cases, 9 raw-Number cases)
- docs/evidence/stage2-bots-7-trim-repair/README.md (this record)

No other file; no protocol/observation/schema/Sim/Cargo.lock/packages/shared-status change; no other corpus touched.

## Remainder

- The lead composes this small delta on the BOT_FILL_REPAIR branch/repair series and runs the combined gate.
- Scope is the declared input/runtime surface: the BOTS_* environment trims in the pinned Node 22.23.4 runtime; other JS
  trim call sites elsewhere in the project are not claimed. The membership is captured, not inferred from the Unicode
  database, so a runtime update would need a recapture (capture.sh --check would flag the change).
