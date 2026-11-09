# Explicit owned-seat resume UI — source ready

Final source **`1bf48a8109249ec36497eab5b1ffc5548a384dd5`**, branch
`codex/unity-owned-seat-resume`, derives from coordinator cut
`dcee822dffa893bf14bb3817eb10f1180410b72d`. Candidate 1
`fe698d21f65d4e835018044f4f5a221555ceab7e` and its compiler/metadata evidence remain
distinct. Runtime corrections are frozen at `56523c6f4aa372eb5aa2b0850911c2ae0a8295f0`;
subsequent children only correct the new fixture, explicitly authorized by coordinator
review: two status-wording assertions, capture-before-delivery and the actual synchronous
Detached/Error/null postcondition, plus exact last-callsign preference isolation.
Production bytes and all prior 90 cases / new eight typed names and arguments are unchanged.
No new native tests or browser reload proof were run here.

## Implemented behavior

- The menu adds an explicit Resume chooser with separate configured Arena and Training
  actions. Fresh Start Run / Training remain separate. A callsign/checkpoint alone opens
  no HTTP request or socket. Resume requires an already-current, nonbusy Owned profile
  matching the selected callsign (normally established by explicit LOAD/sign-in); the code
  checks that state, not a LOAD-reason flag. Re-verification must return `Created == false`
  and a current join intent.
- Before storage and Connect, verify the same live owner/flow, callsign, generation,
  faction, selected mode, diagnostic request, full account scope/page/API configuration,
  exact configured target and content hash. The saved URL is compared, never a destination.
  Missing Training, mismatched/corrupt data and storage failures have explicit states.
  There is no automatic fresh admission or Arena fallback from resume failure.
  A created reply is never used to authorize that resume. The existing profile
  GET can create a now-free name under backend loss and retain/persist the newly returned
  credential, potentially replacing a previously saved credential, before resume refuses
  to connect. This is not a side-effect-free or existing-only endpoint; resume does not
  roll back profile or credential changes. See `fixture-isolation.md` for the exact boundary.
- The existing Session validates expected raw MatchId/player before publishing Welcome.
  Existing launch logic then waits for a fresh accepted matching mode snapshot before
  gameplay, map/player flows, Training or settlement access. Welcome's default mode is
  not confirmation. The pickup callback now shares that launch gate.
- Save the exact current owned Welcome capability/MatchId/player only after confirmed
  mode. The helper defensively copies and readback-confirms it. Attempt one write per
  delivered Welcome; ordinary frames and source-clock cuts do not write again. Save
  promptly during play. Unsaved/unavailable recovery is a nonfatal visible notice.
- Explicit Leave, differing-profile replacement and cancellation clear only captured
  revisions and use Leave. Re-verifying the same inactive owner preserves a kept record.
  Runtime/page retirement revokes generation first, unbinds owned callbacks and calls
  captured `Detach()` without Leave. OnApplicationQuit is an idempotent backup, not the
  sole save or cleanup hook. Account owner destruction never infers a user Leave.
- Atomic compare-and-clear preserves newer records. Close rechecks its retirement
  generation after storage callbacks: a superseded old transport detaches instead of
  sending an obsolete Leave against a replacement resume. Explicit Forget reports a
  changed or unavailable clear honestly.
- Only typed `NoSuchSession` proves expiry and invalidates its captured checkpoint.
  Other rejections and generic Failed keep it with an honest state and explicit retry /
  Forget / separate fresh Join. No Error-string parsing or new Session API was added.
- A resumed Arena gets fresh current settlement access and the existing genuine Result /
  raw MatchId / owner / Session / epoch / read-generation guards. Retained Result before
  mode waits for confirmation and the existing manual check. Training gets no settlement.
  No result, bank flag, balance, snapshots or queued commands are persisted.

The chooser owns Tab/Escape and focus, consumes the input update, blocks underlying
controls and hub walking, and restores on close/rebind/disable. Combat placement,
translucent surfaces, coloured icons and character/minimap scaling are unchanged.

## Scope and verification

Eleven authorized UI/test paths changed: new MatchClient and MatchHud resume partials,
one new Editor fixture, three metas, and five small existing-file hooks. All **34 existing
Editor test source files** (including every prior 90-case assertion) and **621 existing
metas** are byte-identical. The three new GUIDs are unique (624 total). All **33 library /
Unity mirror files**, five protocol source files, store/Session/jslib, BakedContent,
packages, art, server, Cargo.lock and shared status sources are unchanged.

| Check | Evidence |
|---|---|
| Final Editor Client source | 0 errors / 0 warnings; `editor-client-06` |
| Final Player Client source | 0 errors / 0 warnings; `player-client-03` |
| Final all-Editor-test source | 0 errors; the preexisting Trophy CS0067 warning; `editor-tests-05` |
| Focused managed execution | **97/97 PASS**, 0 skipped; `focused-managed-02` |
| Single full managed execution | **923/923 PASS**, 0 skipped; `full-managed-01` |
| Compiled union | Prior **90** typed case objects preserved + **8** new = **98** |
| New native / public discovery / Play / Web / browser / server / cloud | **UNRUN / none here** |

Managed execution occurred on frozen candidate 1. The final child only changes Unity
source/tests; all inputs to those 923 managed tests remain byte-identical. The unchanged
managed suite was not repeated. The initial focused invocation was build-blocked before
test execution because the sparse cut omitted Probe. Its raw failure is retained.
Existing Probe, account JSON, protocol, mirror and trophy fixture dependencies were
materialized without source edits; the corrected focused run was the first actual
focused execution. Neither run is relabelled or combined into another result.

All compile logs are retained, including interim pre-freeze compiles. Final profiles
and source/input/reference pins identify the final source compilation. Compiler DLL
hashes/MVIDs are **not** newly loaded Unity identities. Lossless TRX and source-diff
archives have raw hashes and byte counts for verification.

## Review and metadata provenance

Candidate 1's independent review found the callsign affordance mismatch and post-clear
Leave race. The child fixes both, adds a real reentrant-clear regression and a chooser
test using scoped synthetic Dynamic Tab/Escape input. Eight new NUnit cases cover real
HTTP ownership/created replies, encoded Welcome/Snapshot/Result callbacks, mode gating,
retained receipts, terminal/ambiguous failures, stale owner/config completions, revision
protection, explicit Leave versus detach and modal focus. They are compiled, **not run**.

`metadata/candidate04-1bf48a81/` contains the final typed contract, complete relevant IL,
source/reference/GUID pins and audit receipt. It verifies initial seed assignment,
connect gate, matching mode before save, generation-first retirement, captured cleanup,
post-clear generation decision and no Error-string parsing. The tool invokes no Unity
API or test body. `native-selectors.txt` contains the proposed 98-case union; fresh
public native discovery must bind it before execution.

The first metadata attempt misformatted NUnit long literals without their `L` suffix.
Its command and exact combined tool response are retained; separate streams were not
captured. The correction compares fixture/method/declared types/typed arguments and
carries the prior 90 expected objects verbatim. Candidate 1 tool bytes were recovered
from the recorded edit and verified against their already recorded SHA-256; both tool
versions and recovery receipts are included. The archived candidate 1 source is lossless
gzip so that building the current SDK tool project does not compile two top-level
programs. Decompress that version separately when reproducing its audit.

Candidate 3's first metadata invocation had the wrong final SHA character. The source
guard stopped it before metadata was read; its command/error and corrected second
invocation are retained separately. No guard was weakened and no native failure was
reclassified. The final 98 case objects are identical to candidate 2; only source/test
provenance changed for the two literal corrections. Candidate 4 further records the
new fixture constructor/disposal/preference-restore IL as metadata only; runtime method
IL and all 98 selector/attribute objects remain identical.

The fixture uses injected in-memory HTTP/API, credential, transport and checkpoint
stores. Its fresh Join path touches only the known non-secret `rh.ui.profile` preference,
captured privately and restored with exact presence/value in `finally`, including setup
rollback. Twelve named presentation prefs are read-only in these tests. No default
Bootstrap/Play, real auth-key access, key enumeration, DeleteAll or browser storage read
is invoked by the fixture. The packet contains no native staging scripts. The detailed
dependency/key/method inventory is in `fixture-isolation.md`; a fresh project still shares
Company/product PlayerPrefs, so native staging must preserve any UI keys it changes.

## Remaining release evidence

Independent source review released this source (`independent-source-review.md`). A fresh
source-bound **98-case native gate**, actual
menu/layout/text-scale/keyboard review and frozen Editor baseline return remain open.
The keyboard test restores owned device/settings in nested finally; baseline restoration
must also be observed by the native worker. Root owns coherent content regeneration;
this lane left the admitted BakedContent unchanged.

Later Web proof must actually reload into a new document/Unity Session, restore the same
seat, obtain fresh state/mode and accept authoritative input in both configured modes.
No token reinjection or installed expected result. Default server grace remains 10s;
this packet makes no cold-load timing or durability claim. Resume remains the existing
server bearer-capability authority: client metadata/account checks add no cryptographic
joint account/seat authentication and do not prevent copied-capability theft.
