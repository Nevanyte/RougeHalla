# Prediction echo receipt repair

Base **aef6da2c532874c52125545c4ee2a0fc42d1097d** (Claude netcode wave1). Reused inactive Post worktree/branch codex/claude-prediction-echo-fix; original Root Source output directories and prior refs preserved. Root owns merge/main/demo builds. New failing regression commit **b2032ffea7271774bab3d351506ce480a5e18ab9**, production repair **0bfe80f462be9eac02b67d3e8f89962dc3e3602a**.

## Actual defect and first failure

LocalMotion.OnSnapshot called new NoteEcho before the existing movement sent-frame/AckInput gate. NoteEcho retired the delay-alignment order ring and changed alignment using only a reusable byte. A held byte matching the first resumed/reused new order could therefore change prediction even while OrderPending correctly remained true because the command was unsent or its frame was not acknowledged.

The actual unchanged-aef production run compiled the NEW four-case managed regression and produced **2 FAIL /2 PASS /0 skipped**. Both stale cases (unsent; sent but AckInput older) draw113.65550994873047 at100ms against the identical no-receipt control117.0, losing3.3444900512695312u of lead. This is an ordinary public Session/queued synthetic transport test, not reflection, a private outcome installation or Rust/World parity. The source conditions are declared synthetic authoritative snapshots. The first-red log/TRX are immutable and included. Fresh exact sent-frame confirmation and a valid PRIOR sent motion while a newer order remains pending already passed before the fix; they prevent fixing the regression by suppressing all earlier confirmations.

## Minimum repair

ONLY LocalMotion.cs and its byte-identical UnityNet duplicate change production. Existing32-entry order ring now retains the actual WireCommand reference, whether it was sent and that actual frame sequence. MovementOrderSent records the exact reference even when a later held-key order became newest. NoteEcho cannot change alignment OR retire its covered prefix until that entry has a sent-frame proof and wrap-safe AckInput covers it, using the existing frame comparison semantics. A prior valid sent motion still reconciles while the newest order remains pending. Standalone direct method callers with no AckInput retain their existing API behavior.

No movement formula, speed mirror, smoothing/correction limit, clock, path/collision behavior, input rate, expectation/tolerance, existing test or protocol changes. No source oracle, canonical/Rust/shared status/Cargo.lock edit. The owner's authorized competitive-latency design remains intact; this only restores the freshness requirement in its new alignment state. The new fixed arrays are cold construction storage, not per-frame allocations; no allocation/performance benefit is claimed.

## Actual verification

- Local-only restore from the existing /Users/nevinmckinnon/.nuget/packages cache, with explicit source and NuGetAudit=false: exit0. Generates ordinary ignored local project obj/bin; no download/install/new package dependency/Rust target.
- First pre-fix focused run:2FAIL/2PASS/0skip (above).
- Same four cases after repair: **4PASS/0FAIL/0skip**.
- One full managed --no-build suite over that same compiled repair: **956PASS/0FAIL/0skip**,6s reported duration. Its expected total is the author's952 plus these4, not a second additive test campaign.
- Source files/managed Unity duplicate equality, unchanged existing InputSender/RenderClock/Session/tests, exact scoped Git diff and whitespace verified. Full TRX/raw stdout retained before this summary. Test/source bytes and generated managed assembly hash are pinned in MANIFEST.json.

No Editor/Unity scene assembly build, browser/Node/Source runtime, Rust/Cargo/game process, cloud/protocol activation or benchmark was run. Unity-specific MatchClient/ArenaView from Claude still require actual composition/compile after the independent current demo build seals. Preserve current Root MatchClient seat-resume/fake-null/retirement changes. Speed_milli tests in Claude remain C# modeled-server evidence, not newly generated Rust buff vectors; performance remains unmeasured, not an automatic old-policy blocker.

A source/component repair release is appropriate after independent review of this finite leaf. This does not certify the full Claude security/Rust half, actual Unity integration, live latency or demo release. No other suite was broadened/repeated.
