# P-PERCEPTION-WITNESS-1: source witnesses before fair-view expansion

Owner: one available DeepSeek worker, preferably the completed Post Rust lane. The current Rust lane's active packets
continue; do not reset/rebase its WIP. The lead owns admission, shared status records and all design/version decisions.
Read [the admission review](FAIR_OBSERVATION_ADMISSION_REVIEW.md), current MIGRATION/CONTRACTS and the existing
`tools/perception-fixtures/README.md` foundation before starting. Use a fresh isolated branch/worktree from the pushed
lead checkpoint containing this packet; report that immutable base. Never write the primary or managed snapshot.

## Deliverable

Capture the actual legacy public run-summary projection and one missing event's emission→packing→fair-perception path,
starting with Windup. Supply honest controls against current Rust observation/wire behavior. This is evidence for a
later contract decision, **not authorization to expose new fields/events, port memory or change game rules**.

Writable scope:

- New `tools/percept-witness-fixtures/**` and `parity/policy/percept-witness/**` files.
- New `crates/rh-sim/tests/percept_witness.rs` and `crates/rh-server/tests/percept_witness.rs` if needed for current public
  adapter/privacy controls, using existing supported APIs. No production source changes or test-only privileged APIs.
- `docs/evidence/percept-witness/**` for commands, immutable input/source/tool hashes, actual results and remainder.

All existing source/fixtures, current perception helpers, production crates, protocol fixtures, client code, shared
status records and Cargo.lock are read-only. Use absolute isolated-worktree paths for every patch and shell workdir.

## Required witnesses

1. Run the actual `perceive()` constructor on declared source-schema inputs and retain its raw output. Capture owner,
   visible and hidden player rows across Lobby/Planning/Active/Ended and training, with humans/bots and dead/removed
   rows, configured minimum and fixed starters. Witness that changing one hidden player's Alive status can change
   the public Alive aggregate while sight-filtered actor output remains unchanged. Distinguish declared projection
   probes from genuine runtime lifecycle traces; do not describe hand-built snapshots as complete lifecycle parity.
   Separately witness actual human projection/availability: RaidScene's held-Tab `mapRosterRows` (non-training Active,
   results closed) and menu lobby activity (first non-training room, recognized human/bot seats). Keep these different
   populations separate from bot `perceive()` and runtime traces. Their public identities/order are evidence, not
   authorization to widen Rust's information contract.
2. Cover current-row versus retained-roster counts, held disconnect versus removal, bot-filled lobby, unique winner
   name versus empty/draw/no-winner, and winner retention after leaving. Where a genuine source action/lifecycle trace
   is used, record actions and emitted state; where it is a declared schema probe, label it as such. Do not infer a
   durable draw bit from an empty source winner string. Record uint8 schema versus host-integer boundaries explicitly.
3. Witness Windup through the actual source producer, `packFx`/`unpackFx` and `perceive`, with visible/hidden actors and
   one-step versus multiple-source-batch timing. Include already-delivered Swing/Hit/Block as controls where suitable.
   Preserve originating times and all redaction evidence. Do not hand-author an expected event and call it emission.
   If a source producer is unavailable in the fixture profile, report the exact installer/prerequisite and retain an
   incomplete result rather than substituting an invented producer.
4. Native controls must exercise current actual ItemObserver/actor references and human encoding/decoding where public
   APIs permit. Prove hidden identities/coordinates do not leak and pre-existing controls still pass. Report visible
   Windup absence and other unsupported native/wire facts explicitly as gaps, not successful semantic parity. Do not
   alter existing whole-observation absence tests to make this task pass.
   Reuse current meaningful controls. A verified partial handoff may document a missing public API or native producer;
   do not add privileged seams, duplicate the implementation in tests or fabricate parity to satisfy a checkbox.

## Capture and negative controls

Use the existing pinned Linux/amd64 Node22.23.4 image and module-profile/mount pattern. Keep repository/source mounts
read-only and hash the real dependency closure. Preserve current `bot-perception.json` and all prior payload bytes.
Provide a canonical capture and read-only `--check` mode; expected values come from actual TypeScript, never Rust.
Record all declared inputs, schema defaults, clock values, observation boundaries and any explicit ID mapping. No
real account data, secrets, ML datasets/training or cloud resources belong to this work.

At least three **compiled, semantic** negative controls must be demonstrated: visible-only counting replacing the
global status count; leaking a hidden identity/coordinate; and replacing originating event time with final-batch time.
Use disposable copies for mutants, restore controls and show the exact witnessed mismatch. A compile error, dropped
case or weakened comparator is not a kill. If a control exposes a genuine legacy disclosure, retain and report it;
do not silently redact/rewrite the captured expected payload.
Source-mutant kills demonstrate source-witness discrimination; they do not certify missing native adapters. Retain the
distinction between legacy frame-time visibility and originating native completed-step visibility.

## Success and failure lines

- Success: reproducible source corpus with provenance, independent read-only byte recapture, meaningful native current-
  behavior/privacy controls, all required witness groups accounted for, semantic negative controls and an exact
  admission matrix of present/missing/deliberately narrower facts. Run only affected native tests and strict lint/fmt
  for touched crates; do not repeat unchanged expensive map campaigns.
- Failure/hold: production or schema edits; reused observation17; raw event reclassification; invented event times,
  identities or source outputs; modified old goldens; hidden disclosure without an explicit recorded gap; unverifiable
  provenance; absent semantic controls; or claims that omitted/unimplemented facts match. Stop at the largest verified
  slice and report the blocker. Unverified work stays isolated and is never pushed as accepted.
- Handoff: base/head SHA, exact files, source/image/tool/corpus hashes, commands and actual counts, mutant failures plus
  restored controls, native/wire gaps and next prerequisite. No automatic merge, transport approval or full-brain claim.
  A verified partial handoff keeps the packet INCOMPLETE and identifies the exact unexercised control/prerequisite.
