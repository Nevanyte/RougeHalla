# Quest Room delivery candidate — final independent review

**Disposition: RELEASE for Root's scoped test-only seal/review; not native admission or full quest-port acceptance.**
This is a read-only review of the candidate at base `9ee84dfe3fa35cfdefc4b6cabaf4b9091db6a24c` in
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-quest-room-delivery`. I ran no tests, builds,
probes, captures, or source commands and did not change the worker tree.

## Candidate identity and scope

- The only tracked code change is additive `crates/rh-server/src/quest_bridge_tests.rs`, **+790 / −0**,
  SHA-256 `3a02b4097a583c8662bd06d54a6979836c469139cf369f32aad281f419fe0b6b`. It adds one test and private helpers;
  the four existing tests in that module are unchanged. There is no production, protocol, fixture, host, dependency,
  or `Cargo.lock` change.
- Candidate evidence is `docs/evidence/quest-public-completion-room-delivery/`. The exact working diff hashes to
  `33bf1b525637560ee30de590a7f1376ce886feed3d7591ec7071cf80e61d54be`; its bytes match the current `git diff`.
  `README.md` hashes to `c292a5d6e6136ac9f8fc1c66c1b02b5ae9737c9a419f5329c112f47f2a660118`, and
  `scoped-manifest.md` to `9382155de1a0ec6e802c38283df8b8b84314495f3becdf31960b01bfd3a9e14d`.
- I independently checked the 17 path/hash entries in `logs/09-final-manifest.log`: all exist and match. The
  manifest binds the Rust test, README/diff, all recorded logs, and the three read-only source witnesses. The manifest
  and its own log are explicitly self-excluded where necessary; their current hashes are recorded above / in this
  review. Frozen witness hashes still match: `quest-room-feedback/source.json`
  `977450a6e0e1a1fcc3bd135edf7ebe6291f10d4da7aef98a44fc76b5886bd978`, `quest-giver/source.json`
  `039d4e058fa914f42080f1c55d8640cc508c5b4745504930ca3db49579adc8b4`, and `arena/source.json`
  `6ff324e134127d9c84a4f4383965f11e08a108fbe306424b1547795265adf6f5`.
- `target-deepseek-quest-room-delivery/` is present as an untracked build cache and is not named in the scoped
  manifest; Root must exclude it from staging/sealing. The worker supplied force-add instructions for ignored `.log`
  evidence. The candidate has no worker commit; Root owns exact sealing.

## Final 22-line strengthening against Sol's reviewed cut

Sol's pre-seal review bound the earlier file at SHA-256
`d2cd0365dd5c4462f69856efbb98e7542ecf18f5add166153df3f6adea6f7651` (+768). The current final file is +790 and
retains the reviewed setup, accepted actions, Room wake/carry path, source oracle and exact viewer batches. The final
assertions close two concrete gaps:

- At `quest_bridge_tests.rs:1152-1200`, the **unmodified** completion `room.last_events` must contain exactly four
  native events: one quest `Event::Gv` and three actual Toast producers in expected source order. It also rejects a
  duplicated GV-as-world-Toast. The test does not claim a fabricated 13-event count or manufacture a receipt event.
- At `:1248-1295`, the decoded owner row must mark `owner_completed`, have closed `Done` state, and bind `done_by` to
  the declared owner name; the running native offer is independently `Done` and owned by the real joined player.

These assertions do not alter setup or expected output. The owner expected Toast vector remains four entries and the
foreign vector one; both are compared in full and in order against the actual completion-window decoded Outboxes.
Every row must be a Toast, batch lengths must match, both batches carry the native completion tick, and the source
`p0`→declared `name0` binding is explicit. The frozen oracle is only opened after native completion.

## Producer and privacy review

The focused test is `room::quest_bridge_tests::quest_room_earned_shards_completion_delivers_exact_owner_and_foreign_toasts`.
Its proof path matches the accepted plan:

1. It inspects a deterministic generated, published Open `shards-frost` Collect offer and fails if absent; it does
   not install or replace the offer. It labels the active-Sim swap as component bootstrap, uses one declared placement
   at the actual generated giver, and rebinds both seats' observers/projectors before actions.
2. Two human players join with distinct connections and real Outboxes. All movement/pickup/accept/return inputs pass
   through `Room::handle` with issued quest/pickup handles, per-seat connection, and monotone sequence. The owner
   acts from delivered Quest/Props/Self data. Pickups advance delivered progress; there is no teleport after setup,
   private container ID command, installed progress/reward/status, or direct `Sim::submit` proof.
3. Each ordinary fixed-50 ms `Room::wake` is the only advancement. It uses the actual step → FX feed → carry → Room
   Publisher → Outbox path. The test does not shortcut with `Sim::step` plus manual `publish`, install a carry/event,
   or invoke the projector with a fabricated report.
4. Native completion is detected in unchanged `room.last_events`; the test records its own running Room tick/time
   (`1386` / `69300 ms`). Source tick 8 / 400 ms is asserted only as oracle provenance and is not imposed on the
   native clock. It compares the entire owner and foreign completion-window event batches, not matching text
   membership. Owner private notices are absent from the foreign batch; no recipient field is invented for wire Toast.
5. Typed Done/done_by/GV/farm corroboration supplements, but never replaces, the decoded delivery proof.

The exact native producer batch is four events and the decoded owner/foreign Toast vectors are 4/1. This is not a
13-event case. The worker's expected rows are source-derived after native production; no expected answers feed the
native state or client actions.

## Receipt binding and finite limits

The final author receipts show the final source file's filesystem modification time before the final proof, module,
fmt, and lint commands. The focused proof and repeat ran after that edit; the quest bridge module reports 5 passed /
0 failed; `cargo fmt -p rh-server -- --check`, strict default/all-feature all-target Clippy all exit 0. Final
manifest generation followed those checks and hashes the exact current +790 source file. Their raw logs carry base
HEAD, cwd, toolchain and command, but do **not** embed the source SHA in each command header; the linkage is the
post-run manifest plus file/receipt chronology, not a per-command source-hash field.

The extra fresh-target receipt (`08-fresh-target-rebuild.log`) explicitly predates the final assign-op formatting
cleanup, so it is not counted as an independent build of final bytes. There was no reviewer execution. This does not
block the bounded test-only release: the focused repeat/module test, fmt, and both strict Clippy receipts are after
the final source edit and the current content hash is sealed by the final manifest. Root may choose an additional
fresh-target run for its own admission process, but this review did not perform one.

The proof is deliberately limited to a component Room with active-Sim bootstrap and the `shards-frost` completion
route. It does not claim the entire 181-row transport stream, ordinary hosted lobby/startup reachability, socket
delivery, Unity/browser presentation, persistence/reconnect retention, complete quest parity, or an activation/host
configuration change. The Source runtime profile already enables quests; the shared bridge's quest-disabled test
fixture is not a global host gate.

**Release condition:** Root may seal only the one additive test file and the manifested evidence, excluding the
target cache. Any different code/evidence bytes require a new manifest and corresponding verification. Native
admission and later full-workspace/browser/release gates remain separate.

## Root seal, integration and actual combined check

Root verified all17 receipt hash entries (including the three unchanged read-only source witnesses), the exact
working diff and scoped manifest, then sealed ONLY16 candidate files as
`47bf5c0b10c72e193fb110843cb08e4f5726a74b`; target caches remain untracked. It integrates as
`63dbe68a80cb3fb3f46195a5953702194b6a1f19`, with the test byte-identical to the released candidate.
Root executed the complete quest_bridge filter on that combined backend: **5 passed/0 failed**,3.43s test time,
including actual earned completion1386/69300ms and exact owner4/foreign1 decoded Toasts with Card now present.
Scoped server format also exits0. [Raw Root receipt](root-integrated-check.log) records HEAD, final test SHA,
commands/environment and individual exits; SHA256
`6fbe7ab74d65b6ec90cd4889ad7d946a20f6c65d00f76ed6f6b6c24e5e5b6fb7`.
Root admits this bounded delivery proof. It changes no production behavior and makes none of the broader claims
excluded above. Archetypes-mode composition is separately planned for the isolated Unity/backend preflight.
