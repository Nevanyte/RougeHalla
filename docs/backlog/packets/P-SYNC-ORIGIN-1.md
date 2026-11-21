# P-SYNC-ORIGIN-1: merge origin's integration branch into the local one, as protocol 20

- **Serves:** the integration branch itself (coordinator, 2026-11-20). Nothing can be pushed until the two lines are one.
- **Tier:** `implementer-opus` (a merge plus a wire renumber). Reviewer: `reviewer-opus`.
- **Base:** `feature/unity-rework` at the commit that adds this brief. Merge `origin/feature/unity-rework` @ `81866e9c4`
  (fetched 2026-11-20; merge base `24a2ce99f`). Do not fetch a newer origin: the coordinator re-syncs later.
- **Oracle (coordinator decision, recorded in MIGRATION):** there is no new oracle test. The oracle is the union of both
  lines' existing suites: every test either line has must pass on the merged tree, and no test may be weakened or
  deleted. Version-stamp moves are the only edits allowed in a test, and each is listed in the hand-off.

## Why

The two lines diverged on 2026-11-18. Origin (other sessions' merged pull requests) took protocol 19, observation 31 and
policy contract 26 for P-NET-DRAWAHEAD-1a (a walk hint in Full and delta actor records). The local line took protocol
19, observations 31 then 32, and policy contracts 26 then 27 for P-WIRE19-A/B: native card ids, the first-pick window
and the own-only readouts (State key 14). One number now names two different wires, so the merged wire needs a new one.

| | Local (`feature/unity-rework`) | Origin (`81866e9c4`) |
|---|---|---|
| Protocol | 19 (WIRE19-A/B) | 19 (DRAWAHEAD-1a) |
| Observation | 32 | 31 |
| Policy contract | 27 | 26 |
| Checkpoint | `rh-checkpoint/35` | `rh-checkpoint/32` |
| Content hash | `f79973a86f714d7a` | `7a542a13187f034c` |

## Decisions

1. **Wire: protocol 20** carries both changes: the walk hint and WIRE19-A/B.
   - The server refuses 19 and 18.
   - `protocol/fixtures/v20.json` comes only from `cargo run -p rh-protocol --bin protocol-fixtures`.
   - `protocol/fixtures/v19.json` takes origin's file, the protocol 19 that exists on origin and may have been
     deployed. The local v19 vectors were never deployed. Tests that read the local v19 vectors read v20.
   - The Rust, C# and JS decoders all carry both changes. The Unity copy of the net library moves only through
     `bash client-unity/sync-net.sh`.
2. **Observation 33 and policy contract 28.** Both lines changed the observation and the projection, so the merged
   shape is new.
3. **Checkpoint format.** Moving to `rh-checkpoint/36` is the default. If the merged serialized state is
   byte-identical in shape to local `/35` (origin added no serialized field, enum variant or format change since the
   merge base), it may stay at 35; say which and why.
   - Every new serialized field must reach save, restore and the state hash.
   - The refused-format lists add the formats the move retires.
4. **Content hash:** after the merge, `scripts/regolden-content.sh` only. On a conflict in any of its copies, take
   either side and rerun the script. `crates/rh-sim/tests/content.rs` holds more than the golden line: merge its tables
   by hand (both sides' rows), then let the script write the golden line.
5. **Hash tape** (`parity/abilities/hash-tape.json`):
   - `observationVersion` only through its recorder (`cargo test -p rh-sim --lib record_ability_hash_tape -- --ignored`).
   - `contentHash` and `checkpoint` only through the regolden script.
   - No case digest may move. If one does, stop and report it.
6. **`docs/MIGRATION.md`:** keep the local file. Add origin's new sections verbatim, in their order, under one heading,
   `## From origin (merged by P-SYNC-ORIGIN-1, 2026-11-20)`, placed directly after the local top section. This is part
   of the coordinator's merge and is delegated here; edit no other shared record.
7. **Every other conflict keeps both sides.**
   - Version-stamp tests take the new numbers: protocol 20, observation 33, policy contract 28, and checkpoint 36 if
     it moves.
   - A digest pin that hashes a whole observation moves only because of the version. Prove that by forcing the old
     version, as P-WIRE19-A did.
   - A behaviour conflict (both lines changing one rule differently) is not resolved here: stop and report it.
8. **Card provenance pin:** the pin of `tools/protocol-js/check-vectors.mjs` stays red and waived until P-CI-GREEN-7. Any
   other provenance failure is new: report it.

## Write scope

The merge commit and the commits after it on `agent/opus/P-SYNC-ORIGIN-1`:
- the conflicted files;
- the wire files of both changes (rh-protocol, the C# library and tests, the JS probe and checks, the rh-server version
  check, the rh-policy contract);
- the version-stamp tests;
- the fixtures, through their commands;
- the content-hash copies, through the script;
- the checkpoint format and its refused lists;
- `docs/MIGRATION.md`, as in decision 6.

Never: `packages/`, `hosting/`, `.github/`, `.claude/`, `scripts/gate.sh`, any `AGENTS.md`/`CLAUDE.md`, or
`Cargo.lock` (unless the merge itself conflicts there, in which case take the union and say so).

## Gate

`scripts/gate.sh --coordinator --keep-going --allow-artefacts --regen-fixtures --base feature/unity-rework`, with
Postgres. Start it with `RH_PGTEST_STATE=<a directory of your own> eval "$(tools/pgtest/start.sh)"` and stop it when
done. The only waived red is the card provenance pin of `check-vectors.mjs`. Also run:
- `dotnet test client-unity/RoguehallaNet.Tests`
- `node tools/protocol-js/check-vectors.mjs`
- `bash client-unity/sync-net.sh --check`

## Done

A merge commit of `81866e9c4` into the base, then the renumber, on `agent/opus/P-SYNC-ORIGIN-1`. The gate above is green
except the waived pin. The hand-off lists:
- every conflict and how it was resolved;
- every version-stamp move;
- the checkpoint decision;
- the new content hash;
- anything stopped and reported.
