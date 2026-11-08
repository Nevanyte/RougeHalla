# Integrated fill/configuration scope (November 8)

The coordinator admits the bounded7b continuation with repairs through `db94c05b`, composed on the exclusive-session
learning repair3619280f. The source branch's old automatic PgBackend initialization is deliberately not applied.

- `BOT_STATS_FILE=off` vetoes explicit learning activation before database learning I/O and drops applied biases. No file
  backend is created. Learning otherwise still requires explicit `--bot-learning single-writer`; default is Off.
- Effective fill is computed before profile-name startup lookup. With fill disabled, no registry snapshot is requested.
  Enabled fill treats a lookup error as fatal rather than pretending the exclusion set is empty. Names are a startup
  snapshot; profiles created afterward are not dynamically reserved.
- Root's live per-arrival bias refresh, successful-seat specs, yielded-spec removal, repeated-result guard and bounded
  shutdown remain intact. Bot commands use the separate jitter stream and bounded ordered queues, resolving/validating,
  submitting and recording replay inputs only at delivery. Line-cap drops and intake refusals remain separate counters.
- Exact trim membership is certified over all Unicode scalars against the captured25-member Node22 set; U+0085 NEL is
  retained, while FEFF and source line terminators trim. Prior corpus payloads remain unchanged; added numeric/config
  cases and the restoring-old-helper mutant pass. Arbitrary ECMAScript engine certification and radix inputs beyond the
  documented128-bit parsing scope are not claimed.

A stale shared Cargo artifact caused an early local compile mismatch against visibly current source. The final managed
checkout uses its own clean target directory: **384 affected server/policy tests pass**, two existing manual tests stay
ignored, both strict workspace Clippy modes and formatting pass, and a freshly rebuilt server passes all15 Chromium
WSS checks with protocol11/content801a76cde4cfd305 and zero page errors. Independent review separately reproduced the
canonical source corpus and semantic mutant. No native identity, wire/schema, game rule or lockfile change is introduced.

The historical branch report follows; full bot brain/outcome parity and the remaining public observation design are
separate incomplete work.

---

# BOT_FILL_REPAIR (P-BOTS-7b): the off gate, profile-name errors, source Number parsing and counter scope

Lead packet: coordination/packets/BOT_FILL_REPAIR.md (authoritative). Base: immutable bc47f833 (P-BOTS-7b) in the
isolated branch deepseek/bot-fill-repair. No architecture, lease, storage, shutdown, observation/protocol/schema,
Cargo.lock or shared-status change; this lane does not reimplement learning (the lead composes this delta on top of the
independently repaired learning 3619280f).

## What this repair changes

1. **BOT_STATS_FILE=off now disables the learning subsystem.** Previously StatsFile::Off parsed but was ignored: main
   started the PostgreSQL LiveLearning store whenever a database was configured and passed its snapshot into the fill
   policy unconditionally. Now:
   - crates/rh-server/src/bot_fill.rs: StatsFile::learning_enabled() / BotFillConfig::learning_enabled() state the gate
     (the source's empty statsFile means no store), and the new server_fill_config() composition applies it: an off
     statsFile drops any supplied snapshot and the fill policy receives NO_BIAS. The port has no file backend at all, so
     no file store can be created; the gate suppresses the durable (PostgreSQL) store entirely.
   - crates/rh-server/src/main.rs: the BOTS_* environment is parsed before learning starts; with off the store is never
     constructed or installed (no reads, no updates, no applied biases). The filled seat draw then replays the captured
     NO_BIAS manager stream. main builds its fill config through server_fill_config.
   - Regression: bot_stats_file_off_keeps_the_used_configuration_learning_free drives the real used composition (the
     startup sink decision, the config main hands the room, and the real BotFillState seat draw over 40 seeds) and proves
     the enabled snapshot is dropped; its negative control applies the pre-repair unconditional snapshot and shows the
     draw changes (so the test is not an enum-parse check).
2. **Persistence::bot_names no longer swallows PostgreSQL errors.** It now returns Result<HashSet, String>, and the new
   bot_names_for_startup() is the seam main uses: a durable read failure is reported and startup exits 2 instead of
   treating the set as empty (a claimable profile could otherwise be drawn by a fill bot). Memory mode is unchanged: it
   cannot hit a durable read error and returns Ok over the seats this process has seen. Error-path test:
   crates/rh-server/tests/bot_names.rs drops the profiles table in a throwaway database and requires the startup error
   to name the seam.
   **Documented limitation:** the names are a startup snapshot. Profiles created after startup are not dynamically
   reserved for the rest of the process; the source's isNameTaken reads the live store per claim. This repair does not
   build a reservation service.
3. **Numeric BOTS parsing now follows the source Number-and-clamp/fallback pipeline.** The pre-repair js_number() used
   Rust's f64 parser after a trim, which disagreed with ECMAScript Number() on the repaired classes (radix literals were
   NaN, "inf"/"infinity" were Infinity instead of NaN, a whitespace-only value fell back instead of being 0, and
   Math.round(nonNegative(x)) was implemented as floor(x + 0.5), which rounds the near-half double differently).
   crates/rh-server/src/bot_fill.rs now implements:
   - js_number(): the ECMAScript StringToNumber grammar for decimal/scientific literals, unsigned hex/binary/octal
     literals, Infinity/-Infinity, empty and invalid text, with specification whitespace trimming. Radix values are
     accumulated exactly in u128 and rounded once (an exact prefix continues in f64 past 128 bits);
   - number_or_fallback(): source num() semantics (undefined or the exact empty string falls back; any other value is
     Number() and a non-finite result falls back; a finite negative clamps to 0);
   - js_round(): specification Math.round (halves toward +Infinity; 0.49999999999999994 stays 0);
   - the BOTS_SEED path (exact trim-empty test, finite check, Math.trunc then specification ToUint32) and spec-trimmed
     BOT_STATS_FILE / mix items.
   The additive actual-source cases were captured from the unchanged TypeScript config.ts parseBots / Number() in the
   pinned linux/amd64 Node 22.23.4 container by the existing tools/bot-runtime-fixtures capture tool: parity/policy/
   bot-runtime.json grew from 12 to 82 config cases and gains a 44-case numbers oracle. The previous corpus is preserved
   exactly (git diff: insertions only, 0 deletions); capture.sh --check is byte-identical.
   The parity test iterates the enlarged corpus. **Not certified:** arbitrary complete ECMAScript parser behaviour; the
   declared class set is what is captured and tested (numeric separators/BigInt are rejected as in the source, and radix
   literals past 128 bits are outside the claim).
   **Negative controls:** the_old_number_pipeline_fails_the_repaired_classes keeps the pre-repair parser and shows it
   fails the captured classes (radix, inf/infinity spellings, whitespace-zero, near-half rounding) while the ported
   pipeline matches the oracle.
4. **bot_refused counter scope documented and made source-legible.** The source manager's refused counts delivery-time
   intake refusal only (enqueueClientMessage false); its MAX_QUEUED / unsupported-message rejections in deliver are not
   part of it. The port previously counted both in bot_refused. Now crates/rh-server/src/room.rs counts delay-line cap
   drops in the separate native bot_line_dropped counter, and bot_refused is the delivery-time intake refusal (the
   semantics the source names); the room field docs state the distinction explicitly and that the counters as a whole are
   NOT parity-identical (source stats report no line-cap counter; native lost also covers a seat that left between queuing
   and delivery). Focused regression:
   room::tests::bot_refused_is_delivery_intake_only_and_line_drops_are_separate fills the line past MAX_QUEUED, asserts
   accepted + dropped accounting, that refused stays at its prior value, then proves a resolver-refused delivered command
   increments refused only.
   Preserved semantics (untouched): the separate manager jitter RNG, the per-seat ordered 256-command queue,
   delivery-before-step, validate + submit, and replay-at-delivery.

## Verification (this branch)

- cargo test -p rh-server --lib --all-features bot_fill: 10 passed, 0 failed (includes the enlarged config corpus test,
  the 44-case Number oracle, the old-parser negative control and the off-gate regression).
- cargo test -p rh-server --lib --all-features bot_refused: 1 passed.
- cargo test -p rh-server --test bot_names --all-features (pinned throwaway PostgreSQL): 2 passed, including the
  unreadable-registry startup error path.
- cargo fmt --all --check: clean.
- cargo clippy -p rh-server --all-targets --all-features -- -D warnings: clean (affected crate; the lead runs the
  combined gate).
- bash tools/bot-runtime-fixtures/capture.sh --check: PASS, byte-identical in the pinned container
  (sha256 10516ebae835b826cfdab6d1972050c0527f07c9f39cbe9a80a953e554f54e5e, 82 config + 44 number cases).
- Existing source controls and fixtures stay exact: parity/policy/bot-fill.json and every other corpus untouched;
  bot-runtime.json changed additively (no deletions).

## Files

- crates/rh-server/src/bot_fill.rs: the Number pipeline, the learning gate and server_fill_config composition.
- crates/rh-server/src/main.rs: startup order and the off gate around the live store; the startup profile-name seam.
- crates/rh-server/src/persist.rs: Result-returning bot_names + bot_names_for_startup + the snapshot limitation doc.
- crates/rh-server/src/room.rs: bot_line_dropped apart from bot_refused, field docs and the focused regression.
- crates/rh-server/src/bot_fill_tests.rs: number oracle, old-parser negative control, off-gate/used-config regression.
- crates/rh-server/tests/bot_names.rs: Result update and the unreadable-registry error path.
- tools/bot-runtime-fixtures/capture.mts: additive declared parser cases and the Number oracle.
- parity/policy/bot-runtime.json: additively recaptured (existing values byte-identical).

## Remainder for the lead / root composition

- Compose this 7b delta on top of repaired learning 3619280f: the main.rs hunk is written against the 7b base that still
  started learning automatically; the reusable parts are the bot_fill gate + server_fill_config and the off-wins rule.
  In the composed root, --bot-learning keeps its explicit single-writer requirement and BOT_STATS_FILE=off wins by
  disabling the subsystem; no automatic database learning is reintroduced by this delta.
- Run the combined full gate (this lane ran focused affected tests only, per the packet).
- CI wiring of the additive bot-runtime capture --check is a coordinator proposal (not changed here).
- The startup name snapshot is documented, not extended to a reservation service (out of packet scope).
