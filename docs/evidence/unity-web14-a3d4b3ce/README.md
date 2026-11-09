# Frozen Unity Web14 UI acceptance packet

**PARTIAL.** This packet records one frozen production frontend, three retained attempts, and a separate visual review. Attempt03 has seven automated checks PASS, zero contract failures, and five raw OPEN checks. It does not certify the complete UI migration.

## Identity and scope

| Item | Exact identity |
| --- | --- |
| Frontend/build source | `a3d4b3ce575442c9a06916888035ca849a6cd05a` |
| Protocol / content | `14` / `643d294869db55a4` |
| Unity / build | `6000.0.85f2` / `build_c9711b3ad936`, production Web, compression disabled |
| Artifact manifest SHA-256 | `c5a10239a43d339f033de943f28df987401c40226d259290f221f6213acd0434` |
| Artifact files / bytes | `14` / `106765469` |
| Standalone arm64 server SHA-256 | `0b08727ba9cc7a5850e10f09e0737042937b865ee47dd29f1afc67abbbc242eb` |
| Final proof source | `4a185be20ef8d2bed0f9d927c6e576f46b58b54c` on `codex/unity-web-proof14` |
| Browser / driver | Headed Chrome for Testing `156.0.8078.4` / Playwright `1.64.1` |
| Host / renderer | macOS arm64, Apple M5 Pro, 64 GB; `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)` |
| Viewport / canvas / PNG | `2560×1440`, DPR 1 |

Original build receipts are copied byte-for-byte under [build-receipts](build-receipts). [source-receipt.json](source-receipt.json) records the three harness commits, source hashes, and unchanged raw output hashes. The five new harness files are in [tools/browser-proof/protocol14-ui](../../../tools/browser-proof/protocol14-ui). No game, art, server, protocol, shared status, lockfile, or older proof contract was changed by this lane.

## Retained attempts

| Attempt | Harness commit | Raw result | What happened |
| --- | --- | --- | --- |
| [01](attempt-01/report.json) | `bea7c9e2f908fb7bac6d0cc8265c24fac2f1a787` | FAIL | Own Python supervisor referenced undefined `repo` while creating its private runtime record. PG durability and server readiness had been checked, but the runtime ready event/browser sequence was not reached. No browser evidence. |
| [02](attempt-02/report.json) | `a81c06e1cb2ec4f70ec9a2473271320112ca6416` | FAIL | Real owned profile/Join/snapshots/input/reconnect and 14 screenshots. The harness incorrectly compared final Stop sequence 8 only with Moves 1–7; two inspector-cache response-body reads also failed. Zero page/Unity errors. The original report remains FAIL. |
| [03](attempt-03/report.json) | `4a185be20ef8d2bed0f9d927c6e576f46b58b54c` | PARTIAL | One authorized retry after bounded harness corrections. Captures intermediate authoritative Move echoes and hashes unchanged static-host response streams rather than relying on evictable inspector response bodies. Zero contract failures and zero page/Unity/observer errors. |

Attempts01/02 were not rewritten or promoted after corrections. All copied reports, progress files and PNGs retain their original bytes. No fourth browser run was performed.

## Attempt03 functional observations

The ordinary Canvas Menu loads before a game socket is created. The real masked account form loads/claims a fresh synthetic profile through the integrated HTTP API, then the real Canvas Run button creates Unity's Hello. The passively observed Hello credential matches the real owned profile response; no credential is published. Hello, Welcome and live `/info` agree on protocol/content. All 11 reliable collections arrive.

The finite real keyboard sequence sends seven Move commands and one Stop through Unity's own WebSocket. Thirteen changed-pose Rust self samples echo sent Move sequences; the separately retained final Stop echo is true. The authoritative position changes from `(1040,1104)` to `(1150.5,1104)` and `moveSeq` from `0` to `8`. The complete run observes 368 snapshots. Interrupting the actual game-created socket leads to a resumed Hello and same-player/same-match Welcome. No replacement Hello/input producer, direct Join, fake API, actor setter or diagnostic game is used.

The seven automated PASS checks are Menu, profile ownership, ordinary Join, authoritative snapshots, authoritative input, reconnect and render heartbeat. The actual C# trace advances through source frames `839–3560` (2722 frame starts and 2630 self presentations). GL draws and drawn RAFs also advance. These are functional liveness observations, not CPU/GPU, allocation, frame-rate or latency acceptance.

All four browser-requested Build resources match complete bytes streamed by the owned static host, including the correct `application/wasm` MIME. All 14 artifact files match their frozen hashes before/after. Every retained PNG's actual dimensions, length and SHA-256 were checked against its raw report.

The raw HUD/help/active-journal/drawer checks remain OPEN. [VISUAL_REVIEW.md](VISUAL_REVIEW.md) records independently inspected rendered subcases without mutating or upgrading that report. Planning remains OPEN: the frozen CLI configuration uses lifecycle Off and quests false, and no ordinary planning activation exists in this baseline.

## Cleanup and privacy

Only owned local services were used. Each attempt has a separate temporary PostgreSQL16 cluster with SQL-verified `fsync=on`, `synchronous_commit=on` and `full_page_writes=on`. PostgreSQL data, connection strings, access codes, profile/session credentials, result spool and raw logs remain in private mode0700 directories outside Git; secret files are0600. No AWS/cloud/user-account access occurred.

All owned browsers and all three runtime/server/PG sets are stopped; attempt01 did not reach browser launch. The server required a recorded forced kill after the bounded graceful wait in attempts02/03. This proves cleanup and makes no claim of a completed or banked match. [cleanup-independent-verification.json](cleanup-independent-verification.json) independently checks all nine recorded supervisor/server/postgres PIDs absent and all nine owned listener ports closed, without stopping unrelated processes.

The copied public JSON/PNGs were scanned against retained run secrets, access codes and database URLs before copying, then the complete packet was scanned again before sealing. No matches were found. Screenshot privacy review finds no visible access code, recovery token or credential; the displayed callsigns are synthetic. No private state/log/database directory was copied.

## Remaining gates

- Root admission of the separately reviewed rendered rows.
- UI022 planning-J and the separate native25 gate: absent from this frozen artifact and not substituted by the active unavailable-state journal.
- Authoritative planning/ready/spawn races, populated quests/traders, training, complete match/rewards/results/banking and refreshed profile flow.
- Full catalogue reachability, the full focus/typing/modal matrix, route/map fairness and persistence.
- Other resolutions, ultrawide, 150% text, grayscale/CVD and other browsers.
- M5 performance acceptance and Editor/native render issues. Absence of cyan here applies only to this exact Web build/browser/size; it does not erase earlier failures or diagnose their cause.

No further feature or browser work is included in this seal. The newer coordinator integration and server candidate remain separate.
