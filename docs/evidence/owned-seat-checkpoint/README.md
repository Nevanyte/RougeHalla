# Owned-seat tab checkpoint component

Pure component packet on `codex/owned-seat-checkpoint`, exact base **5b8e0423c26d5078585d2a9f8565b0862606ad7c**. Immutable executed code **c0e46e31210d8a4f32c5ede61e301344366413c6** adds13 new code/test/adapter/mirror/meta files. No existing Session, UI, storage integration, server, wire, dependency, package, workflow or shared status file changes. This evidence-only follow-up preserves the executed source. No push, merge, dispatch, browser, Editor, server, Rust/PG or cloud action.

## API and ownership boundary

`OwnedSeatCheckpointContext` requires an `OwnedAccount`, fixed `AccountEndpoint`, exact caller-configured match URL, `OwnedSeatMode` Arena/Training, current protocol and nonzero content hash. It extracts only the normalized callsign, not the account bearer. The API base is normalized in full, including path prefix. Targets must be well-formed WS/WSS `/ws` addresses on the account origin, without userinfo/query/fragment/whitespace/control characters. The selected mode uses a separate storage-component enum; UI adoption must map its already-validated launch mode explicitly.

The proof object is **not** independently reauthenticated or checked for current selection/generation by this component. Before Save, Read and consuming CreateSeed, the UI owner must establish current confirmed ownership, capture the current configured target/build expectations, and recheck its generation/session predicates. Save additionally requires a delivered identity and authoritative mode confirmation. Do not construct expectations from saved metadata or silently claim a profile to manufacture a resume identity. Read compares against all current expectations and exposes no record/seed for mismatch. `CreateSeed()` copies the secret capability and expected raw identity; no method joins, selects a destination, changes mode, infers a saved result, extends grace or reads an account bearer. Public MatchUrl is comparison metadata, never an instruction to navigate/connect to it.

`OwnedSeatCheckpointStore` takes an injected `IOwnedSeatCheckpointStorage` with one read/write slot and atomic compare-and-clear. Every Save creates a fresh nonempty Guid revision, copies the input arrays, writes, and requires exact readback before returning Saved+Record. Read decodes without modifying/deleting the slot, and only returns Ready+Record after all current metadata matches. `CopyMatchId` and `CreateSeed` cannot expose the record's array storage. Clear accepts a captured record and compares its complete canonical payload, including revision; an old callback cannot clear a replacement with the same seat but a new revision. Storage primitive implementations must preserve the compare/remove atomicity and honest statuses; this is not a multi-thread transaction or cryptographic integrity mechanism.

Outcomes are explicit: Read Ready/Missing/Invalid/Mismatch/Unavailable; Save Saved/Unsaved/Unavailable/Invalid; Clear Cleared/Missing/Changed/Unavailable/Unsaved/Invalid. Only successful results contain a record. Exceptions/copy failures never become Ready/Saved/Cleared. Unsaved or unavailable is **not** a guarantee that data was unchanged: a write/removal or copy may fail after partial progress. Save readback can also become unconfirmed if another record replaces it. No account key is erased and no invalid/foreign record is silently cleared.

## Version1 canonical local format

One dedicated sessionStorage key: `rh.seat.checkpoint.v1`. It is shared across account/target choices within this tab; saving a new record replaces the old one. The payload is exactly11 ordered `key=value` lines plus a final newline:

| Field | Canonical representation |
|---|---|
| version | `1` |
| scope | padded Base64 of strict UTF8 normalized full API base |
| name | normalized2–16 ASCII callsign |
| url | padded Base64 of strict UTF8 exact configured target string |
| mode | `arena` or `training` |
| protocol | positive UInt16 decimal without signs/leading zeros |
| content | nonzero UInt64 as16 lowercase hex digits |
| match | delivered raw16 bytes as32 lowercase hex digits |
| player | positive UInt32 canonical decimal |
| capability | secret16 bytes as32 lowercase hex digits |
| revision | fresh nonempty Guid in32 lowercase hex digits |

This is a tab-local record format, not a network protocol change. Fixed field count/order and full canonical re-encoding reject duplicates, unknown/reordered/extra fields, truncation, CRLF/extra newlines/NUL, alternate numeric/base64/hex forms, invalid UTF8, unsupported version and invalid identity shapes. Overall payload is bounded at8192 characters before parsing; decoded addresses at2048 characters. The canonical payload is ASCII; no credentials are placed in a URL. No account bearer/passcode, timestamp-derived expiry, balance, snapshot, command, Result or banked flag is stored. Revision/metadata are routing/staleness checks, not authentication. The component does not derive a10s expiry from last Welcome: server disconnect/grace/room lifetime remains authoritative.

## Dedicated WebGL adapter

`WebGlSeatCheckpointStorage` has only conditional `DllImport("__Internal")` hooks, no UnityEngine dependency. Dedicated `RhSeatCheckpoint.jslib` uses sessionStorage only. It bounds reads before marshalling, distinguishes absent/invalid/unavailable, checks write readback and performs get/compare/remove/readback synchronously with no callback/promise between comparison and removal. Allocation/input/output-copy failures yield unconfirmed/unavailable results. **Outside a WebGL player the adapter explicitly returns Unavailable**, including in Editor; no PlayerPrefs, durable/localStorage or in-memory fallback is installed.

This is ordinary same-tab persistence. Same-origin scripts, copied/duplicated tab state and stolen capabilities are not protected; metadata does not jointly authenticate a seat against an account. The existing server bearer-capability semantics remain unchanged. sessionStorage availability/copy success is not host/crash durability. Actual Unity IL2CPP interop, page reload, tab-lifetime behavior, storage restrictions and Arena/Training integration remain later browser/UI gates.

## Verification on frozen source

- First focused normal managed run, warnings as errors: **97 passed /0 failed /0 skipped**, comprising56 new checkpoint cases and41 seed/detach cases. One run, no first red.
- One unfiltered normal full managed run, warnings as errors: **919 passed /0 failed /0 skipped**,6s reported duration. No allocation instrumentation, retry or tolerance change. Existing allocation harness/controls and Session are unchanged.
- First offline VM controls of the **actual `.jslib`**, injected storage/marshalling: **11 passed**. Covers absent vs corrupt, single-slot replacement, old-revision refusal, same-turn operation sequence, storage access/read/quota/remove failures, write/clear readback failure, oversize before copying/mutation, allocation/output-copy failure and input-copy failure. It is not an actual browser/WebAssembly/IL2CPP proof.
- WebGL conditional source compile (`UNITY_WEBGL`, C#9, warnings as errors): **PASS**, all33 library sources using121 existing .NET Standard2.1 reference assemblies and pinned SDK csc. No Editor lease or Unity assemblies required. It is compiler validation only, not an AOT runtime build. Exact arguments/output hash are retained.
- Exact Unity mirrors, source freeze, new-files-only scope and base whitespace checks PASS. All13 source/test/mirror payloads match their immutable Git objects after validation. Pinned SDK8.0.427/runtime8.0.33 macOS ARM64; Node25.8.1. Task-owned Rust/PG paths assigned after sourcing the environment remain unused/nonexistent.

Managed controls cover canonical parsing and strict identities, full API prefix/origin/name/path/mode/protocol/content mismatches, invalid current destinations before any storage work, source/getter mutation, a newly constructed Session's Hello, missing/empty/platform-unavailable states, exact readback, copy/partial-write exceptions, unsupported primitive statuses, distinct revisions and replacement immediately before an old clear. Test accounts/protocol values are synthetic unit fixtures, not real account, backend or reload evidence. No real credentials or raw capability/key payloads are in receipts/logs.

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/owned-seat-checkpoint/unused-cargo-target
export RH_PGTEST_STATE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/owned-seat-checkpoint/unused-pg-state
dotnet test client-unity/RoguehallaNet.Tests --filter 'FullyQualifiedName~OwnedSeatCheckpointTests|FullyQualifiedName~SeatResumeTests' -warnaserror
node client-unity/RoguehallaNet.Tests/OwnedSeatCheckpointAdapterTests.cjs
dotnet test client-unity/RoguehallaNet.Tests -warnaserror
bash client-unity/sync-net.sh --check
git diff 5b8e0423c26d5078585d2a9f8565b0862606ad7c --check
shasum -a 256 -c docs/evidence/owned-seat-checkpoint/SHA256SUMS
```

`frozen-source.json` binds executed base/code and all13 payloads. `receipt.json`, first-attempt logs, environment and source-compile receipt retain actual outcomes without suppressing failures; no failed attempts occurred. `SHA256SUMS` binds current code and evidence, excluding itself. The final evidence-only commit SHA is reported separately to the lead. Root retains review/integration and UI ownership remains untouched; stop here without claiming an actual full-page recovery.
