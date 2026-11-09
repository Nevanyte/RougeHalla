# Safety-correction and tool-hash-only recapture (P-QUEST-HUMAN-ELIGIBILITY)

Base f034ace7d1f6617ed64a1eb194469e0b4531caa9; branch deepseek/quest-human-eligibility. This note covers the
correction commit after the first delivered head 16234ebc00a2cb499af8ef7d3bc672752e6e7ff9.

## Why

The delivered evidence initially claimed a real SIGTERM proof, but the shipped host run-mutants.sh did not drive a
signal: with RH_QUEST_MUTANT_SIGNAL_TEST=1 the inner script printed READY and slept 60 s, then took the ordinary
selftest restore path. No docker kill --signal=TERM existed, so the claimed INTERRUPTED/SIGNAL_RESTORE_PASS outcome
was not reproducible from the committed tool. This is a required safety property (signal-safe exact restore), so it
was fixed rather than relabelled. The independent checker independently found the same gap at 16234ebc.

## Fix

- tools/quest-human-eligibility-fixtures/run-mutants-inner.sh: the SIGTERM trap restores the verified backup and
  prints MUTANTS INTERRUPTED: restoring exact backup bytes followed by
  SIGNAL_RESTORE_PASS: exact backup bytes verified after SIGTERM; the wait is 120 s (the host kills promptly).
- tools/quest-human-eligibility-fixtures/run-mutants.sh: when RH_QUEST_MUTANT_SIGNAL_TEST=1, it starts the pinned
  container detached, waits for the inner READY line, sends a real docker kill --signal=TERM, waits for the trap,
  requires both proof lines and rejects any restore/verification failure; it still performs the protected-source host
  guard before/after and exits 0 only on the full proof.

## Tool-hash-only recapture

The corpus profiles hash the two corrected runner scripts, so the corpora were genuinely recaptured in the pinned
image. Only metadata changed; semantic content is identical.

| corpus | old bytes/sha/captureSha | new bytes/sha/captureSha |
|---|---|---|
| ordinary.json | 100431 / cbf2b1fe... / 0445f690... | 100431 / bc1630f1999f4c6b3613bebda0ec6e7c192442ba53719e5dad83cf3a9667b809 / b4da16ca28aae591ac5b2a3badedbfd6d49cdd02f6ac3002f7d43220e80eb99a |
| diagnostic.json | 38981 / aee0b6f0... / 4048fe4d... | 38981 / 51f641fcc69b4331ae718b5a6d2e9aab10d98cfff17b68d56e80ceefbb3c6838 / b0fe57629ae79167399f7346609fc79ab3abe2f9abec21bed9d3ae6d70dda640 |
| manifest.json | 4994 / d8bdc03d... | 4994 / eef0accea8a91fc478a0f7607c53b09d3b1fab083bb5df61450eef75a26b0c6c |

Semantic equality old vs new (provenance/tool hashes excluded): true for ordinary (ordinary cases/unreachables/
frames/events identical), diagnostic (cases/frames/events identical) and manifest (counters/tool-list paths/versions
identical; only files[].sha256, files[].captureSha256, provenance.tool entries for the two runner scripts and the
derived captureSha values changed). No expected offer/acceptance/progress/ready/reward or toast was installed and no
comparison was relaxed.

## Reproduction (Lead-run)

- bash tools/quest-human-eligibility-fixtures/capture.sh: recapture; in-run check 1/2 and 2/2 pass.
- bash tools/quest-human-eligibility-fixtures/capture.sh --check (twice): read-only byte-identical.
- bash tools/quest-human-eligibility-fixtures/run-mutants.sh: 5 KILLs, provenance NON-KILL, RESTORED CONTROL PASS,
  HOST GUARD PASS.
- RH_QUEST_MUTANT_SELFTEST=1 bash tools/quest-human-eligibility-fixtures/run-mutants.sh: SELFTEST PASS.
- RH_QUEST_MUTANT_SIGNAL_TEST=1 bash tools/quest-human-eligibility-fixtures/run-mutants.sh: exit 0 with SIGNAL TEST
  READY, MUTANTS INTERRUPTED: restoring exact backup bytes, SIGNAL_RESTORE_PASS: exact backup bytes verified after
  SIGTERM, HOST GUARD PASS.

No existing source, native, Cargo.lock or shared status changed; only the new packet's tools/corpora/evidence were
touched. Root owns the merge and identities.
