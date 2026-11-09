# WalkHint source repair — ENV-BLOCKED WIP (not sealed)

Status: ENV-BLOCKED / WIP, not a source release. The three bounded repair changes are implemented in
tooling and static checks pass, but the single pinned recapture could not start because Docker/containerd
failed resolving the pinned image blob. Per Root instruction there were no Docker retries, restarts,
prunes or deletions after that first result, and no Docker call has been made since. The old
627/8cb fixture, receipts and branch remain historical and untouched.

## Isolation / WIP heads

- Base sealed source: 627ba6c461167b54dd3f51ac0e6d221a6aafba0a (code 563eb298a0f8537c8f0af9e783a21a6750641b26).
- Exact public base: db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de.
- New additive repair branch: deepseek/walk-hint-source-repair.
- WIP code/tool head: 450079d1337555e605a5f22a5a9b885ee7b12310.
- WIP evidence head: the branch head containing this file; reported to Root.
- Old branch deepseek/walk-hint-source still points at 627; old parity/walk-hint/source.json remains
  8cb8b2c24fe0be184e660a4670b0981b946c35782d9e7a47ae1ba3eff567ab77 (44,372 B). No new fixture was produced.

## First blocker (preserved raw)

Command: bash tools/walk-hint-fixtures/capture.sh (capture mode; defaults to the new repair directory).
Exit: 125 before any container was created. Raw daemon error preserved in logs/env-blocked-capture.log:

    docker: Error response from daemon: rpc error: code = Unknown desc = blob sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 expected at /var/lib/desktop-containerd/daemon/io.containerd.content.v1.content/blobs/sha256/aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292: open ...: input/output error

There is no container ID and no live capture process from this call: docker run failed before container
creation. No further Docker call was attempted after this first blocked result.

## Repairs implemented (static, not executed)

1. capture.sh output safety: controls now select a fresh owned /tmp/walk-hint-controls.XXXXXX when no
   output is supplied; caller-supplied outputs must not already exist; both the old and new canonical
   corpus trees are refused; no recursive removal exists. A cheap fake-repo sentinel test proves default,
   canonical and caller content survive (test-output-guard.sh, logs/output-guard.log and
   logs/static-checks.log: PASS).
2. controls provenance: each build records the actual onLoad path, exact original/transformed byte
   counts/hashes, one expected load, produced bundle bytes/hash/path, baseline disk hash and a unique
   bundle import per pristine/restored execution. Baseline disk pins are explicitly labelled baseline;
   executed-mutant provenance is carried per row. The comment arm must remain semantically equal while
   changing executed source provenance; compiler/setup failures stay ERROR, not KILL.
3. scenario input record: the actual accepted seq5 Move returned by enqueueClientMessage is retained on
   waypoint-0 instead of discarded; assertFacts and verify.mjs require that accepted move/seq. Same
   14-frame/action recipe; no extra frame or input.
4. Runtime wording: runProbe asserts the pinned Node v22.23.4, linux, x64 environment instead of only
   recording it.

## What is not proved (blocked)

- No new actual-source fixture was captured; no 14-frame repair fixture exists at this head.
- No canonical metadata/input-record change was executed or compared to the old fixture.
- No pinned capture/check, readonly byte check, compiled controls run with executed provenance, or fresh
  frozen Git export was performed. The old 8cb fixture and old evidence remain the only sealed source
  artifact; this WIP does not supersede them.
- Static checks were run on host Node v25.8.1 only for syntax and shell guard purposes; that is not the
  pinned Node22.23.4 source execution environment and is not a source/behaviour proof.

Concrete limits: native/Rust/Cargo/target, Unity, wire/protocol/public, lifecycle/end/teleport/roots/ice/
locks/attack-move and all broader campaign claims remain out of scope. Root owns environment recovery,
admission and the next lease. Preserve this WIP and the first raw blocker; no Docker retry/restart/delete
is authorized from this lane.
