# Percept-witness source capture (P-PERCEPTION-WITNESS-1)

Canonical actual-source capture for the fair-observation admission review: the legacy public run-summary projection, the
human/roster/lobby availability surfaces, and one missing event's emission -> pack -> decode -> fair-perception path
(Windup), with Swing/Hit/Block controls. Evidence only: no production, schema, protocol or fixture change is made here.

The capture runs in the same pinned image as the other fixture tools,
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, with
`--platform linux/amd64` and the perception-fixtures mount pattern (repo read-only at `/repo`, tool directory read-only
at `/capture`, output at `/out`, `--tmpfs /repo/node_modules`, `npm ci --ignore-scripts`, `node --import tsx`).

```sh
bash tools/percept-witness-fixtures/capture.sh            # write parity/policy/percept-witness/*.json
bash tools/percept-witness-fixtures/capture.sh --check    # compare byte for byte (output mounted read-only)
bash tools/percept-witness-fixtures/run-mutants.sh        # three compiled semantic mutants + restored control
```

`RH_PERCEPT_WITNESS_OUTPUT` redirects the capture; the path must stay inside this isolated worktree. The canonical
serialization is `JSON.stringify(corpus) + "\n"`; each corpus carries `format: "rh-percept-witness/1"`, a profile (Node/
linux/x64 asserts, image digest, sha256 of the internal static TypeScript/style import graph, sha256 of the capture tools) and
`captureSha256` over the JSON including the profile and excluding only `captureSha256` itself.
External npm import names are listed; external package contents are outside this graph. Supplemental base-checkout
lockfile/manifest/TypeScript-config hashes are in `docs/evidence/percept-witness/admission-provenance.json`. `--check` compares the bytes, not parsed JSON.

## Corpora

- `run-summary.json` — 192 declared source-schema `perceive()` probes (Lobby/Planning/Active/Ended x training x four player
  cases x schema-default/fixed thresholds x empty/unique/64-character winner), each recording the full `frame.hud`, the
  sight-filtered `fighters` rows and `frame.self`; the hidden-status witness (one hidden player Alive -> Dead changes
  `hud.alive` while `fighters` is unchanged); current-row versus retained-roster counts; the real `RaidState.minPlayers` uint8
  boundary (0/1/254/255/256/257/-1 set, host value, encode/decode result); schema defaults and `startedWith` type reflection (not its value-boundary round trip); and `statusLine`/`winnerLabel`
  strings over a declared human-HUD matrix. Every probe is `provenance: "declared-probe"`.
- `availability.json` — `planningModeFor` over phase x training x held Tab; `mapRosterRows` over declared synced rows
  (dead, far, bot and EFFECT_HIDDEN rows included) with a `perceive()` contrast on the same rows; `LobbyStatus.snapshot`
  over five declared room/lease scenarios. A small CSS-stub ESM loader (`css-stub-loader.mjs`) plus minimal import-time
  DOM stubs let the real client modules load; no DOM lifecycle runs.
- `windup-path.json` — two real `createGameWorld`/`step` runs: a sword-into-shield fight (windup + swing + block + hit + heal)
  and a wand fight (single-source windups at t=100 and t=1400, and one step at t=2450 with windups from two sources). Every
  fx step records the raw `SimEvent`s, `packFx(events, t, {roster})`, the packed tuples, `unpackFx` `TimedFx` and the
  `perceive()` observations for visible, hidden, out-of-frame, `canSee=false`, two-batch and same-step-two-source states.
  Emission/packing is `actual-producer`; the actor state handed to `perceive` is a declared projection of the actual
  fighters plus a declared observer. Setup/actions live in the hashed tool; the corpus records producer steps,
  not the collected action arrays.

## Semantic mutants

The patches under `mutants/` are applied to a writable copy of the repository under `/tmp/repo`; `/repo` stays read-only.
`compare.mjs` reports the first semantic JSON-path mismatch (the `profile` block is skipped because a mutant necessarily
changes the mutated file's hash), and `run-mutants.sh` fails unless each mutant's first mismatch matches `mutants/expected.txt`:

| mutant | first mismatch |
|---|---|
| `01-visible-only-alive` | `run-summary.json /probes/0/frame/hud/alive` 5 -> 2 |
| `02-hidden-identity-leak` | `run-summary.json /probes/0/frame/fighters/2/id` "p-human" -> "p-hidden" |
| `03-final-batch-time` | `windup-path.json /observations/0/frame/events/0/t` 100 -> 999999 |

The mutated capture runs with `RH_PERCEPT_WITNESS_RECORD=1`, which records the observation expectations as booleans
instead of aborting (a mutant is supposed to break them); the comparator and the expected-signature check are not weakened.
After the three mutants the script reruns the unmutated capture with `--check` against the checked-in corpus.

## Boundaries of this evidence

These are source and projection witnesses, not full lifecycle traces: winner strings and player rows are declared schema
probes, and no reconnect/removal lifecycle is replayed. The equivalence between legacy frame-time visibility and native
completed-step visibility is not established here. Only the declared imports and the captured scenarios are covered.
