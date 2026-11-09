# Proposed public readset and passive adapter

This is proposed source for Root review. Nothing was installed in an actual page.
The old full-page proof intercepts profile HTTP responses and stores session/ticket
bytes (`tools/browser-proof/protocol14-ui/proof.cjs`). It is not reused.

## Backend option A

Existing loopback authenticated `GET /control/rooms` provides public room hex,
callsign, status/reason and sampled `graceRemainingMs` for **hosted admitted**
players. `RoomReport::Seat::Back` updates the book. The DTO does not expose the
Rust player ID. `playerSessionId` is a hosted admission identifier, not that ID;
do not confuse or copy it into the public identity record. Direct owned seats do
not acquire control-book records. There is no public replay metadata route that
supplies the missing player ID. `/info` is process-wide; settlement is postcommit.
Therefore A alone does not prove exact same player/no-fresh-join.

Optional hosted corroboration must be projected by Root's private operator into
only room/mode/callsign/status/reason/countdown and local observation times. Do
not send raw control JSON, auth headers, admission IDs or private replay to this
collector. No control request or extractor activation occurs in this packet.

## Wire option B — exact current14 readset

All offsets are zero-based half-open byte ranges, derived from immutable6d/7a
Rust and C# codecs. Metadata is scoped to the actual dedicated game page.

| Message | Read | Cursor-only skip, never copy/decode/log payload |
| --- | --- | --- |
| Client Hello tag1 | tag`[0,1)`, protocolLEu16`[1,3)`, build/profile u8 length prefixes, ticket u16 length prefix, faction option tag, resume option tag | content`[3,11)`; build/profile/ticket bytes; optional faction value; optional16-byte resume capability |
| Server Welcome tag0x81 | protocol`[1,3)`, contentLEu64`[3,11)`, public match bytes`[11,27)`, playerLEu32`[27,31)`; structural map length/count headers | private session capability`[31,47)`; time header`[47,60)`; map hashes and all RLE payload bytes |

Hello output is only kind/protocol/resume-present plus the explicit structural-only
classification. Welcome output is protocol/content/raw-match-hex/player plus the
explicit prefix-only classification. Raw16 match hex is compared directly, without
C# Guid byte-order conversion; its network UUID is hex groups8-4-4-4-12 if needed
for the existing settlement route.

The bounds are inherited from the ordinary codec: 1024-byte Client frame,
256KiB Server frame, ticket448 bytes, map≤1024² cells and cumulative runs≤3×cells
maximum. The map reader checks dimensions, run-count bounds, extension framing,
version/flags/mode and EOF, but **skips** tile/run values and hashes. Hello cannot
validate skipped UTF-8 or faction content. No parser can validate bytes it is
forbidden to read. Accordingly `wholeFrameValidated=false` always; malformed
visible framing, unknown protocol/tag and unsupported buffer types fail closed
for metadata. Known unrelated14 tags are ignored, without decoding their bodies.
There is no Blob conversion or permissive text/binary fallback.

These are **wire observations**, never accepted Unity state, authentication,
delivery, rendered mode or gameplay attestation. A valid-looking prefix with
invalid omitted payload cannot satisfy the run by itself. Require current native98
guards, exact build/source linkage, subsequent ordinary verified-mode HUD/menu
transition, normal input/rendered gameplay and Root's review. Welcome has no mode.

## Proposed adapter contract

`proposeWireTap` is an inert factory. It returns a constructor proxy; importing it
does not change `window.WebSocket`. The separate generated preload is a proposal
that **would install** the observer if Root later executes it before Unity starts.
Its exact source hash must be in the later execution release.

- Only an actual game constructor call reaches the supplied native constructor,
  with identical args/newTarget. URL/protocol strings are not inspected or logged.
- Only an actual game `send` invocation reaches its original native method, exactly
  once with the same `this`, arguments and original buffer. Native return values
  and exceptions remain native. The observer makes no independent Connect/send,
  close, retry, HTTP request or timer call.
- Public parsing happens synchronously; no original event/frame/buffer/payload is
  stored in state, copied, base64-encoded or passed to a logging sink. An ordinary
  message listener receives the same original buffer. Unsupported strings/Blob/
  shared-memory representations are not converted.
- Diagnostic failures disable metadata for that connection and do not stop the
  game. Only hard-projected public rows are retained (≤256 rows/16 connections);
  budget overflow makes evidence unavailable and never changes service quotas.
- Stop removes only the observer's listeners/send wrapper and restores a property
  only if it is still that wrapper. The explicit preload restoration restores
  the global constructor only if it still equals the proposed proxy. It never
  closes a socket or overwrites another owner's later changes.

The wrapper changes observable constructor/method identity and adds unmeasured
diagnostic work. Synthetic forwarding checks are not I/O or performance evidence.
Root must approve the actual native browser integration and consider those limits
before installing it. No new owner permission flow or product identity UI is needed.

## Document and evidence collection

The own observer is idempotent per top-level document, records timeOrigin and a
local nonce, and reads navigation **type**, never its URL/name. Trusted pointer
coordinates and non-text keys are captured; no DOM text, input value, account key,
storage, cookie, HTTP or app object is accessed. Own exports are detached metadata.
The approved driver separately witnesses the same browser context/tab and fresh
execution context. Do not persist observer state in game/browser storage.

Before Reload, export the own observations externally. After the new document,
export them again. The approved preload must run in every document before normal
Unity startup. A later Root-approved driver can register the generated source as
one initialization script and then use only ordinary browser navigation/input;
the source packet chooses no live GUI route and runs none.

Capture the own wire export **first**, then the document export (which includes
fresh `capturedAt` clocks), so all retained wire/event timestamps precede the
document capture. The driver adds its context/tab witnesses and separately
correlates the screenshots. Do not use the initial install timestamp as Reload
time. The connection/Hello lower bound uses the actual trusted pointer's
monotonic clock; the one-second annotation tolerance applies only to screenshots.

The offline checker binds Hello/Welcome to the same connection, rejects a changed
match/player or nonresume fallback, and requires rendered-step screenshot hashes.
For stale owner/mode it also requires zero game constructor/Hello activity. It
checks clocks/new document and timing bounds, but cannot authenticate operator
labels, screenshots or source-build claims; `READY_FOR_ROOT_REVIEW` is its highest
status. All actual browser acceptance remains Root's separately recorded verdict.
