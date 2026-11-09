# Quest-notice native bounded consumer (first slice)

Root decision revision: this is a bounded notice/view consumer, NOT equality of the legacy 181-record transport
stream. Base root 1ddad5d63f7016e65d3eddaa5bd47082c3a3710f plus only the sealed source leaf pair
6397c42b (source receipt) and c10698ed (sealed source evidence README); consumer branch base c10698ed. The source
corpus parity/quest-notices/source.json is immutable: sha256
a20d751e88cb16765cf2aa3ef856765a0d3321d8e25eb6e41c6722cdf9a99244, 1,154,229 bytes, format
rh-quest-notices-source/1.

## Selected cases

- cases[0] parcel-feedback
- cases[4] run-end-silent-close

These are the first ordinary bounded slice. The consumer uses the actual native constructor, quest runtime, ordinary
stepping and validate+submit for actor inputs. Declared source setup is mirrored: seed-1 map, three typed human seats,
initial positions/HP/loadout, and the case-4 declared sword/HP setup. Labels are resolved through retained actor
provenance; a label is never treated as a typed identity.

## Notice parity contract

Source Toast/Gv events and native Event::Toast / Event::Gv are filtered explicitly by those classes on both sides.
Every retained notice is compared in order with exact tick, time, kind, owner-vs-room recipient, text, GV id/amount/
reason. No notice inside the selected classes is omitted.

| case | source matched notices | source excluded events | source total | native matched notices | native excluded events | native total | previews |
|---|---:|---:|---:|---:|---:|---:|---:|
| parcel-feedback | 15 | 7 | 22 | 15 | 6 | 21 | 1 |
| run-end-silent-close | 4 | 14 | 18 | 4 | 14 | 18 | 0 |

The excluded source classes are the legacy transport/event records outside Toast/Gv (for example fx, resolved,
raidStarted); the native excluded count can differ because private quest reveals are not injected as a duplicate raw
Event. This is notice parity only.

## Private QuestView preview companion

parcel-feedback contains one source private questReveal: tick 2, time 100, to p0, quest id quest84, def cull-frost,
giver point (1712,48), expiresAt 0. At that observed source frame the native entitled prepared QuestView for p0 is
compared for preview definition, giver point, expiry and recipient privacy; every other human view is asserted not to
contain the preview. The consumer does not fabricate a QuestReveal raw event and does not install a reveal.

run-end-silent-close contains no source QuestReveal.

## Implementation and files

- NEW crates/rh-sim/src/quests/notices_source_tests.rs sha256
  db4c70cd31dc74de5e12ae9884b778b2a567d7827637e4a9c28ec21d124df7ec
- cfg(test)-only declaration added to crates/rh-sim/src/quests/mod.rs sha256
  d42f0e23d777fe74315c3c580a09ec067aa8dc5c3fc5763386ecfccb1a0bde98
- immutable source corpus sha256 a20d751e88cb16765cf2aa3ef856765a0d3321d8e25eb6e41c6722cdf9a99244

## Commands and results

Build with root final-env.sh and a private target (CARGO_TARGET_DIR=/tmp/quest-notice-consumer-target,
CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0, jobs 1):

    cargo test -p rh-sim --all-features --lib selected_parcel_and_run_end_cases_match_ordered_toast_gv_notices -- --nocapture --test-threads=1

Result: 1 passed. Output records both cases' matched/excluded/event counts above; the ordered Toast/Gv sequences are
equal and the parcel preview companion is entitled/privacy-checked. fmt --check and the scoped rh-sim
--all-targets --all-features Clippy with -D warnings pass.

## Explicit limits / remainders

1. Only cases[0] and cases[4] are covered. cases[1] pickup-closed-guard (noncanonical stale-state guard),
   cases[2] expiry-cohort-order (order-only expireSoon), cases[3] teleport-close-notices (direct exported producer) and
   cases[5] camp-and-publication-closure (inline whole-region killMob) are NOT verified here.
2. No equality of the full 181-record legacy stream is claimed; excluded classes and counts are reported above.
3. The source private reveal is verified through the entitled native QuestView preview; no duplicate QuestReveal event
   or production teleport/killMob API was added.
4. No method-level second slice, stale guard, expiry deadline or whole-region producer claim is made here. The genuine
   giver8 evidence remains the real 300-second deadline witness.
5. No production rules, canonical structs, protocol/content/header/tape/status/Cargo.lock or source corpus edits.
6. For other already-covered mechanics, cite the existing genuine giver8/publication evidence at
   docs/evidence/quest-giver/README.md and docs/evidence/quest-notices/README.md; this slice does not replace it.

This is a deliberately partial, coherent notice/view slice for Root review; Root owns merge/admission and any wider
method-level continuation.

## Final held-review repair (task-125)

Base sealed consumer 95efd6945d9ccd673d2e2cae3cd2fc88c1d0ab77; fresh isolated branch
deepseek/p-quest-notice-final-repair. CODE commit 48a5cfedf1ccc30dd791557b923aec001393899a changes only the existing
cfg(test) consumer (crates/rh-sim/src/quests/notices_source_tests.rs). No production/source corpus/capture/tools/APIs/
identities/tapes/content/version/status/shared/Cargo.lock edits; the sealed source pair is retained. Source corpus
sha256 remains a20d751e88cb16765cf2aa3ef856765a0d3321d8e25eb6e41c6722cdf9a99244, 1,154,229 bytes; coverage is still
honestly cases0/4 only.

### Nonvacuous run-end closure

The consumer now retains the real Sim and captures actual native state at the source accepted and run-ended frames while
driving case4. It asserts source frame facts and reached native runtime:
- source accepted frame tick3/time150: 20 open offers; native earlier-open = 20 at tick3/time150;
- source run-ended frame tick14/time700: phase ended and 0 open offers; native reached run-ended phase ended, tick14/
  time700, 0 open offers;
- final native phase is ended and open offers remain 0.
No ended phase or closure is installed, copied or obtained through a production hook. The complete Toast/Gv sequence
assertion is unchanged (source case4 4 notices / 14 excluded / 18 events; native 4 / 14 / 18).

### Foreign privacy tightening

At the tick2 private reveal companion, every foreign human prepared QuestView is now required to contain NO row of the
hidden cull-frost definition regardless of RowState (not merely no Preview row); the source public snapshots at this frame
publish 0 cull-frost rows. The owner preview definition/giver point/expiry checks, typed fixture bindings and no-fabricated
raw-event rule are retained. Case0 remains source 15 notices / 7 excluded / 22 events vs native 15 / 6 / 21 with one
entitled preview.

### Portable raw native receipts

The following files are force-tracked in the evidence commit because repository gitignore ignores *.log. Each contains
the exact command, working directory, environment (CARGO_TARGET_DIR=/tmp/quest-notice-consumer-target,
CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0, jobs1) and exit code plus raw output:
- logs/focused-final.log: focused two-case test, exit 0.
- logs/fmt-first-failure.log and logs/fmt-final.log: first check failure preserved, final fmt --check exit 0.
- logs/clippy-first-failure.log and logs/clippy-final.log: first scoped strict clippy failure preserved (collapsible_if),
  final rh-sim --all-targets --all-features clippy -D warnings exit 0.
- logs/sealed-git-manifest.log: sealed-Git per-file sizes/SHA256 for code, source corpus, this evidence and logs.

No inherited source-control log is substituted. The focused output reports the same matched/excluded counts above and
the run-end/privacy assertions are inside that test.
