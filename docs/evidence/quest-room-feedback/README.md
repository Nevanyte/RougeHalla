# Source quest-GV room feedback witness

Bounded source-only packet, based exactly on public `d2ca1376a28e5836056fc9c52ebd9d866f461d82`, branch
`codex/quest-room-feedback-proof`. Only NEW `tools/quest-room-feedback-fixtures/**`, `parity/quest-room-feedback/**` and
this evidence directory are written. Native/server Rust, protocol, Unity, identities, headers, content, tapes, shared
status, dependency manifests/locks and all existing corpora are unchanged. The preceding sealed native-QA reports are
untouched. No cloud, deployment, Editor, merge, push, new login or additional worker was used.

## Exact input and producer scope

Input is the existing `parity/quest-giver/source.json`, SHA-256
`039d4e058fa914f42080f1c55d8640cc508c5b4745504930ca3db49579adc8b4`, zero-based case7 `completion-retirement`,
frame8 `turned-in` (one-based case8/frame9), tick8/serverTime400ms. The previous frame is tick7/time350ms. The existing
producer harness's unchanged source hash is checked against the corpus provenance; its original completion script
performs exactly one step between these frames. Raw event-array SHA-256 is
`6e40908a3cf563b1d5778b185129c829218af6fd80c903a8a1605552563e7a26`.

The input events are real captured quest GV10 to p0, the Rime Stalker farm notice, private quest completion to p0, and
public room completion. No World, quest, grant, token, outcome or gameplay event is newly constructed/stepped/recaptured.
The input is cloned only to call the source method and is asserted unchanged afterward.

## Actual invoked methods and declared receiver

Actual imports are `RaidRoom` and `FxChannel`, with real installed Colyseus/shared dependencies and no import stubs.
The receiver inherits RaidRoom.prototype. Its handleEvents/toastTo/sendTo references are asserted to be those exact
prototype functions; none is reimplemented. It uses the actual `world` getter through a declared minimal `built` record.
The provided dependencies are client send/getById recorders, broadcast recorder, no telemetry, recorded time400ms,
empty projectiles and optional bot route sinks. There is no Room construction, creation/join/session lifecycle, transport,
authentication or socket. No settlement event is present, so no persistence/settle/lock/timer dependency is stubbed.

A transparent FxChannel Proxy delegates to the real batch method on a real instance. Each projection records one call
with0fx events, time400ms,0projectiles and null result; no fxs broadcast or bot batch is emitted. The original frame's
projectile list is independently required to be empty. No formatter or GV_TOAST lookup table is copied into the tool.

## Observed output order

| Order | Actual method sink | Recipient | Exact text |
|---:|---|---|---|
|0| client.send toast |p0| `+10 GV (quest)` |
|1| client.send toast |p0| `Rime Stalker: +10 kill stacks · +12.5 Defense total` |
|2| client.send toast |p0| `Quest complete: Shards of the Watch` |
|3| broadcast toast |null (public-call recorder)| `name0 completed quest: Shards of the Watch` |

The raw GV becomes the first private toast through actual handleEvents→toastTo→sendTo. The other three captured toasts
retain order. Additional entries are labelled DISPATCH CONTROLS, not more producer/gameplay cases: duplicate decorative
receiver labels leave typed-ID routing unchanged; a missing owner causes all three private lookups to find nobody and
never fall back to a foreign receiver; a declared p0 bot route calls its onToast sink three times. Public broadcast calls
remain visible in every control. Decorative receiver labels are not a real duplicate-name Colyseus/schema session test;
bot classification is not evidence that bots can earn/complete quests. No broadcast fanout implementation is invented.

## Pins and checks

Official Node22.23.4 bookworm-slim image digest `sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
Linuxamd64/x64, npm10.9.9; host is Apple M5 Pro/macOS arm64, so this uses Docker's pinned amd64 execution rather than a
native-host timing claim. The unchanged lockfile pins tsx4.23.15, TypeScript7.0.2, esbuild0.28.2, Colyseus core0.18.23 and
schema5.0.42. The corpus records209 complete server/shared source-file hashes (a conservative import-closure superset),
eight harness file hashes, ten configuration/producer hashes including all three package tsconfigs, root config, lockfile
and actual producer capture harness. Source paths, rather than ephemeral working paths/timestamps, make output portable.

```sh
bash tools/quest-room-feedback-fixtures/capture.sh
bash tools/quest-room-feedback-fixtures/capture.sh --check
bash tools/quest-room-feedback-fixtures/run-mutants.sh
```

Host source is mounted read-only at `/source`. Source copies, npm ci and variants live in container-owned tmpfs; the only
writable host capture mount is the NEW output directory. --check and mutant baseline mounts are read-only. No host
node_modules directory is created. All dependency installs use the original lock with scripts/audit/fund disabled.
No actual gameplay producer is run again: these commands repeat only room projection over the immutable batch.

## Semantic controls

Every mutant gets a fresh writable source copy and a fresh Node process. Actual projection must exit0 before comparison;
a dependency/import/harness crash cannot count as a kill. The standalone comparator asserts actual input/receiver
recipient/text/order with provenance excluded, and `--check` runs this assertion before its full byte/provenance check.

| Variant | Required result | Observed first actual output mismatch |
|---|---|---|
| Quest label in actual RaidRoom | semantic kill | first row text `+10 GV (quest)` → `+10 GV (QUEST_LABEL_MUTANT)` |
| Private route in actual toastTo | semantic kill | first row recipient p0 → p1 |
| Comment-only provenance change | semantic non-kill | identical actual output; provenanceChanged=true |
| Pristine before/after | pass | exact byte equality |

All variants are disposable container-only copies of RaidRoom.ts; no host source restoration or global cleanup is needed.
Changing source hashes alone is explicitly not a semantic kill. [Bounded logs](bounded.txt) and [receipt](receipt.json)
record exit statuses and corpus/hash checks. External source-capsule reproduction is recorded separately after export.

## Limits and initial harness correction

The first import/binding attempt successfully imported actual dependencies but assigned `receiver.world`, which is a
getter. That attempt failed before projection and was preserved privately. Supplying the declared built record through
the original getter repaired the harness without any legacy/source change or import workaround. Final provenance pin
completion only added config/toolchain coverage; all input and actual receiver output bytes were separately compared
unchanged. These are harness corrections, not successful gameplay recaptures or production defects.

This proves a SOURCE ROOM METHOD projection over a captured genuine completion input. It does not prove actual sockets,
live/authenticated sessions, bank completion, telemetry, FX delivery, client toast visibility/retention, generic GV reasons
or amounts, native quest observation/wire behavior, complete public quest flow, or complete-port admission. Native/UI
repairs and public admission remain the lead's separate responsibility. No legacy expected outcome was retconned.
