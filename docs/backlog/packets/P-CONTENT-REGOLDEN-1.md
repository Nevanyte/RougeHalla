# P-CONTENT-REGOLDEN-1: one command moves every pinned copy of the content hash

- **Serves:** the owner-approved elite and augment rework (2026-11-18), `docs/backlog/AUGMENT_ELITE_REWORK.md`, row P-CONTENT-REGOLDEN-1 (first wave); not a phase item of ORDER_OF_OPERATIONS
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer (Sonnet)
- **Integration base:** `feature/unity-rework` (fde1a625c)
- **D-rules touched:** D1 n/a (tooling; no legacy mechanic) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
The rework moves `content_hash` three times (P-AUG-CONTENT-1, P-AUG-NATIVE-1a, P-ELITE-TUNE-1). Today a move means
hand-editing copies across crates. This packet adds `scripts/regolden-content.sh`: it names every stale copy
(`--check`) and refreshes them all. It does NOT move the hash (today `7a542a13187f034c`, decimal 8814716632174625612).

## 2. Dependencies
None. P-AUG-RULES-1 also writes `docs/agent/AUGMENT_REWORK.md`; keep to one short section, create the file if absent.

## 3. Relevant legacy paths
None: the content hash is a Rust-only identity (`crates/rh-sim/src/content/hash.rs:8`, `content_hash()`). Owner
decisions: `docs/OWNER_DECISIONS.md:79` (2026-11-12, Frost Wall numbers into content; the hash moved once and every
pinned copy with it) is the precedent; nothing in the index forbids a script.

## 4. New paths
- `scripts/regolden-content.sh` (a failing stub is committed)
- `docs/agent/AUGMENT_REWORK.md` (only if absent)

## 5. Exclusive write scope
- `scripts/regolden-content.sh`
- `crates/rh-sim/tests/frost_wall_content.rs`: delete `WALL_CONTENT_HASH` (`:91-93`) and the test
  `the_content_hash_is_the_value_of_the_appended_rows` (`:95-102`), as `c9606e6eb` retired the tape digest. The other
  tests there compare copies to `GOLDEN_CONTENT_HASH` and stay. Check for an unused-import warning (`hex` is still used).
- `CONTRIBUTING.md`: a few lines under "Rules" (wire/fixtures bullet area).
- `docs/agent/AUGMENT_REWORK.md`: one short section.
- Nothing else. `scripts/gate.sh` is protected: do not edit. Do not edit the oracle test.

## 6. Contracts and references
C-PARITY (existing parity fixtures stay green); AGENTS.md "Protected paths": `parity/**` and `protocol/fixtures/**` are
regenerated only by their documented commands.

## 7. Behaviour to preserve
Hash value, every fixture and every other test unchanged by this packet: after the script runs on the current tree,
`git status --porcelain` is empty (the `#[ignore]` idempotence test is the proof).

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-CONTENT-REGOLDEN-1`.
- `cargo test -p rh-sim --test regolden_content` green; then by hand
  `cargo test -p rh-sim --test regolden_content -- --ignored` green.

### Script contract (what the oracle pins)
- Hash source: `--hash HEX` (16 lowercase hex digits, else exit 2), otherwise computed from the code. Suggested: a
  small mechanism that prints `content_hash()`; the existing `hash_golden` failure text (`content.rs:564`,
  "content_hash is now ...") is parseable but fragile. Any new bin or example in a crate is outside this write scope:
  parse it, or ask the coordinator.
- `--root DIR` (default: the repo root, found from the script's own path): the tree to read and edit.
- `--check`: exit 0 if all six copies hold the hash; else exit 1 and print `STALE <repo-relative path>` for each stale
  copy, nothing else with that prefix. It reads only the six files under DIR. Textual comparison only (it never runs
  the protected commands).
- Regen (no `--check`): rewrites the four text copies in place, preserving formatting byte for byte
  (`0x7a54_2a13_187f_034c` with underscores in `content.rs`; plain hex in the `.mjs` quotes; `0x7a542a13187f034cUL` in
  `BakedContent.cs`). Unless `--text-only`, then runs the documented commands for the two protected copies. A real
  protected regen refuses (exit 2) with a foreign `--root` or a `--hash` that differs from the code's hash, since those
  commands compute from the code. `--dry-run` edits nothing and prints `WOULD EDIT <path>` for text copies and
  `WOULD RUN <command>` for protected ones.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/regolden_content.rs`

(The stub `scripts/regolden-content.sh` is in the `stub:` commit; the implementer replaces it.)

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p rh-sim --test regolden_content`
- `scripts/regolden-content.sh --check` (computes via cargo)

## 10. Risk and suggested model tier
Sonnet. Traps in sections 11 and the pinned-copy table.

## 11. Known traps
- `BakedContent.cs` is a build artefact by name: `scripts/gate.sh` ARTEFACT_RE (`:274`) refuses it in a diff unless
  `--allow-artefacts`. This packet does not change its value, so it passes; but every P-AUG-* packet that runs the
  script will touch it and needs `--allow-artefacts` (coordinator to note in those briefs). Its documented producer is
  `client-unity/UnityProject/Tools/build-web.sh` (bakes from a running server's `/info`, needs a server); the script
  writes the same file text.
- `hash-tape.json` is not a one-field edit: `record_ability_hash_tape` rewrites all 63 case digests (they follow the
  state hash) as well as `contentHash`. That is the documented behaviour; run it, do not patch the field.
- The archetypes golden is `hitbox-fixtures` output; `crates/rh-parity/src/bin/hitbox_fixtures.rs` has a `--check`.
- `frost_wall_content.rs` also pins a digest of `archetypes_v1.json` without `contentHash` (`:264-`), and its
  `every_pinned_copy_...` test compares four copies to `GOLDEN_CONTENT_HASH`: both are unaffected by a pure hash move.

## Pinned copies and regen commands (grep for both spellings of `7a542a13187f034c`; docs under `docs/` excluded: history)

| # | Copy | Kind | Refresh |
|---|---|---|---|
| 1 | `crates/rh-sim/tests/content.rs:568` `GOLDEN_CONTENT_HASH` | text | the script (the one hand value) |
| 2 | `crates/rh-sim/tests/frost_wall_content.rs:93` `WALL_CONTENT_HASH` (+ test `:96`) | value pin | retired by this packet |
| 3 | `parity/abilities/hash-tape.json:258` | protected | `cargo test -p rh-sim --lib record_ability_hash_tape -- --ignored` (`abilities/source_tests/hash_tape.rs:62-64`; feature flags to verify, `sim_tests` uses `trusted-status-probes`). Not in CONTRIBUTING or the parity README; documented only on the test. |
| 4 | `protocol/fixtures/archetypes_v1.json:300` | protected | `cargo run -p rh-parity --bin hitbox-fixtures` (`--check` exists); documented in the bin header and `hitbox_goldens.rs`. Not in CONTRIBUTING. |
| 5 | `tools/unity-browser-reload-proof/check.mjs:8` `CONTENT` | text | the script |
| 6 | `tools/unity-browser-reload-proof/normal-companion.mjs:7` `EXPECTED_CONTENT_HASH` | text | the script |
| 7 | `client-unity/UnityProject/Assets/Scripts/BakedContent.cs:6` | text, artefact | `Tools/build-web.sh` bakes it from `/info`; the script writes the same text |

The oracle's sweep test requires that exactly rows 1, 3-7 name the hash anywhere under `crates tools protocol parity
scripts client-unity/...` (source extensions). Docs (`MIGRATION.md`, `CONTRACTS.md:20`, packets) are history, not copies.

## Existing tests that pin what this packet changes
- `crates/rh-sim/tests/content.rs:560` `hash_golden`: asserts `content_hash() == GOLDEN_CONTENT_HASH`. Kept; the script rewrites its constant.
- `crates/rh-sim/tests/frost_wall_content.rs:96` `the_content_hash_is_the_value_of_the_appended_rows`: asserts `content_hash() == WALL_CONTENT_HASH` (a second value pin). Retired here; the oracle's `the_wall_test_keeps_no_value_pin_of_its_own` demands it. This is an edit to an existing test, in the implementer's scope by the plan of record, not an expectation change (the same value stays pinned in row 1); owner/coordinator to approve.
- `frost_wall_content.rs:175` `every_pinned_copy_of_the_content_hash_names_the_golden_value`: rows 3, 4, 5, 6 equal `GOLDEN_CONTENT_HASH`. Kept; the script's check duplicates it for a different audience.
- `crates/rh-sim/src/abilities/source_tests/hash_tape.rs:41` `ability_hash_tape_matches_the_base`; `crates/rh-parity/tests/pnet2_goldens.rs` and `hitbox_fixtures --check`: the protected copies' own guards. Unchanged.
- No conflict with the oracle for any of these.

## Provenance chain
`tools/provenance/check-card-chain.mjs` (gate step "card provenance chain (pins current)"): no conflict. Its pins cover
`parity/card-*`, `tools/*-fixtures/capture.*`, `tools/protocol-js`, `tools/browser-proof` and the catalog's
`protectedSha256` map; none of rows 1-7 appears in `parity/` or `tools/provenance` outside `hash-tape.json`, which is
not in a chain pin. Verified by grep. (`pin-sources.mjs` reads `BakedContent.cs` from fixed git revisions, not the working tree.)

## Oracle choice and how it is run
Rust integration test in `rh-sim` that shells out to the script (fast: no nested cargo; `--hash` comes from the
in-process `content_hash()`). Chosen because `gate.sh --oracle-check` reads cargo test targets only, and python
`scripts/test_*.py` files are not wired into the gate (no `unittest discover -s scripts` step exists). It sweeps all
six copies, not one. The idempotence proof on the real tree (runs cargo, rewrites protected copies) is `#[ignore]`.

## Notes from previous attempts
<!-- Coordinator appends on escalation. -->
