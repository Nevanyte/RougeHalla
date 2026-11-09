# Actual room feedback over one captured quest completion

```sh
bash tools/quest-room-feedback-fixtures/capture.sh          # write only parity/quest-room-feedback/source.json
bash tools/quest-room-feedback-fixtures/capture.sh --check  # byte check; output mounted read-only
bash tools/quest-room-feedback-fixtures/run-mutants.sh      # disposable actual-source semantic controls
```

The pinned official image is `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
platform `linux/amd64`, Node22.23.4/npm10.9.9. `npm ci --ignore-scripts --no-audit --no-fund` uses the unchanged lockfile.
The host checkout is mounted read-only at `/source`; packages, dependency installation and mutants exist only in
container-owned `/work` tmpfs. The only writable host mount during capture is the NEW output directory. Check and
mutant modes mount that output read-only. Each container has a task-owned name and is removed after execution.

`capture.mts` reads ONE immutable existing producer batch: `parity/quest-giver/source.json`, zero-based case7
`completion-retirement`, frame8 `turned-in`, tick8/time400ms. The full original corpus SHA-256 and capture harness hash
are checked before use. The preceding frame is tick7/time350ms; the original harness steps once before this frame.
No World is constructed or stepped and no source gameplay is recaptured.

It imports the actual `RaidRoom` and `FxChannel` plus real installed Colyseus/shared dependencies, with no import stubs.
An object inheriting the actual RaidRoom prototype supplies only declared receiver dependencies: fake client sinks and
getById, a broadcast-call recorder, a minimal `built` record accessed through the actual world getter, no telemetry,
recorded serverTime400ms and an explicitly empty projectile Map (the source frame has none). Actual handleEvents,
toastTo and sendTo execute. A transparent Proxy records arguments/results while delegating to the actual FxChannel
batch method on its actual instance. No GV_TOAST map or formatter is copied into the harness.

One genuine human-receiver witness is followed by THREE labelled dispatch controls using that same unchanged input:
decorative duplicate receiver labels, absent owner with foreign clients present, and a declared bot sink. The bot
classification is a receiver override, not genuine bot quest progression. Receiver labels are diagnostic stub metadata,
not a real Colyseus/schema name flow. Broadcast calls are recorded without pretending to implement Colyseus fanout.

Provenance pins the conservative complete209-file server/shared source superset, eight executable/JSON harness files,
ten configuration/producer files, the lockfile, image and toolchain versions. `--check` asserts input/actual receiver
output equality BEFORE full provenance/byte equality. No native identities, protocol headers or existing corpora change.

Mutants modify exactly one actual RaidRoom source location in a fresh container-only copy per variant. Projection must
succeed before comparison: a crash/import error is not a kill. Quest-label and private-route mutants must fail the
actual output assertion with provenance excluded; a comment-only provenance change must survive semantic comparison
and demonstrably change provenance. Fresh pristine checks run before and after. Every Node invocation has its own
module cache; no mutable host source or restoration of host files is involved.

This is a room-method projection witness over a captured producer batch. It proves no sockets, authenticated/live
sessions, bank/persistence completion, telemetry, client display/queue behavior, other GV reason/amount, or full quest
flow. See [evidence and limits](../../docs/evidence/quest-room-feedback/README.md).
