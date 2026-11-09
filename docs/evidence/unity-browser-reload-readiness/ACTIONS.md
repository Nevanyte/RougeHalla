# Ordinary browser actions and finite outcomes

All actions below are **NOT EXECUTED**. Root first releases the exact current
artifact/observer hashes and the browser route. Use ordinary rendered controls
and trusted browser input; do not call C# handlers, install Session state, edit
storage, inject Results or use diagnostic/auto/token/hash query overrides.

Use a dedicated owned test page. Suggested local public origin is the proposed
loopback router`http://127.0.0.1:8888`; both modes and `/api` must share that exact
scheme/host/port. The ordinary public configuration is
`?server=ws://127.0.0.1:8888/ws&trainingServer=ws://127.0.0.1:8888/training/ws`.
No account key or token goes in a URL. Native listeners7777/7779 are upstreams,
not two browser credential origins. Actual routing remains a runtime gate.

The normal controls are Canvas/uGUI, **not DOM selectors**:

| Purpose | Rendered control | Reference6d source |
| --- | --- | --- |
| Establish current existing owner | Callsign field → **LOAD** | `MatchHud.Accounts.cs:32–34` |
| Initial fresh seat only | **START RUN** / **TRAINING** | `MatchHud.Accounts.cs:45–51` |
| Deliberate resume | **RESUME…** → **RESUME ARENA** / **RESUME TRAINING** | `MatchHud.Resume.cs:29–39` |
| Separate deliberate discard | **FORGET SAVED RUN** | `MatchHud.Resume.cs` |

Root obtains actual coordinates from the newly rendered/layout-reviewed artifact;
source anchors do not establish current pixels. Record trusted pointer-up timing
and before/after screenshots for each meaningful control. Existing intercepted
HTTP/WS proof drivers are not reused. Ordinary LOAD/PrepareJoin are account
operations, not side-effect-free lookups; use genuinely existing owned profiles
after reload. Never press Reveal or copy a recovery key into evidence.

## Arena success

1. In the dedicated tab, use normal profile claim/sign-in for initial setup only,
   establish ownership, and click **START RUN**. A second ordinary human seat is
   needed for a real Source run with the intended min-players2 profile. Use normal
   Plan/Ready controls and wait for actual Active gameplay. Keep test players safe
   during the reload; no debug placement or result injection.
2. Observe the initial Hello with `resumePresent=false` and the public Welcome
   `(matchId raw16 hex, playerId, protocol, content)`. Record ordinary verified
   Arena HUD/menu transition and normal input/rendering. Welcome alone has no mode.
3. Natural saving occurs in `CaptureConfirmedSeat` only after a current owned,
   mode-verified accepted snapshot. It silently clears ResumeStatus. **There is
   no positive “saved” selector**. Do not inspect sessionStorage/checkpoints.
4. Export only the own document/wire observer metadata, capture the actual
   browser-context/tab/execution-context witness and screenshot, then perform a
   normal same-tab browser Reload. Do not Leave, close the tab or create another
   BrowserContext. In particular, do not use Training Escape as a reload.
5. In the same tab/origin, observe a fresh JS/Unity document: changed timeOrigin,
   changed per-document nonce, new execution-context witness, navigation type
   `reload`; browser-context and tab witnesses stay the same. BFCache/soft
   reconnect is not this case. Reinstalling an observer in the same document
   returns the same nonce, and does not satisfy it.
6. **LOAD** the same existing owner, open **RESUME…**, then click **RESUME ARENA**.
   Do not click Start Run. Record exactly one resulting resume Hello with the
   presence flag true, and its same-connection public Welcome.
7. Require the original public match hex and player ID exactly. No new nonresume
   Hello/fresh Join is permitted. Wait for ordinary mode-verified HUD/gameplay,
   then use ordinary arrow movement and observe the rebuilt playable view. Capture
   the expected Arena state and trusted input/rendered outcome. Raw Welcome is
   received metadata, not proof Unity accepted it.

SUCCESS: fresh same-tab document, current-owner LOAD + explicit Resume, same public
seat, natural persistence across reload, correct ordinary mode/gameplay, no fresh
fallback, unchanged20Hz/default10s configuration, and measured real-time window.
FAIL: changed player/match, nonresume fallback, soft reconnect only, wrong mode,
missing ordinary acceptance/rendering, or a reload window reaching10s. Missing
observability/artifact/approval evidence is OPEN, never a synthetic pass.

## Training success

Repeat a separate natural setup/reload cycle using **TRAINING**, wait for actual
confirmed Training, then **LOAD → RESUME… → RESUME TRAINING** after Reload. A single
tab-session slot holds one run/mode; Arena and Training cannot both remain saved.
Require same public Training seat, confirmed Training console/HUD and normal
input/rendering. Training has no normal match Result/bank receipt; do not invent
one. Do not press bare Escape before the reload because it leaves Training.

## Refusal cases

| Case | Ordinary setup/action | Required observed line | Forbidden/failure |
| --- | --- | --- | --- |
| Stale owner | Save real A seat; Reload; LOAD different genuinely owned B; Resume original mode | “The saved run does not match this profile, destination or build.”; no game connection | A stale operation joins, fresh fallback, or ownership established only by a typed callsign |
| Stale mode/config | Save Arena; Reload same origin/config; LOAD A; **RESUME TRAINING** | Same mismatch line; no game connection | Connecting/falling back despite saved mode mismatch |
| Expired saved seat | Save natural seat; Reload without Leave; wait for default real-time expiry; LOAD A; Resume original mode | Typed `NoSuchSession` path: “That saved run is no longer available. Start a new run separately.”; resume Hello true, no Welcome/fresh fallback | Generic failure mislabeled expiry, a new Join, or a manually installed expired record |

After typed expiry, a second explicit Resume should show “No saved run is
available in this tab. Start a new run separately.” without connecting. This is
behavioral compare-clear evidence; do not inspect storage. Other rejects/generic
failures retain details for explicit retry/Forget and do not prove expiry.

The stale-config case above is specifically a natural mode-context mismatch.
Endpoint/content mutation and in-flight stale-callback races remain distinct
OPEN cases unless Root supplies an ordinary, released setup; the finite native98
guards do not become browser evidence. There is no universal stale-response label.

## Real wall-clock accounting

Record browser Date.now/timeOrigin/performance.now without overriding clocks or
timers. All startup, LOAD and verification time consumes grace. Measure separately:

- browser reload-request → received resumed Welcome (must be strictly under10000ms
  in the bounded success case; warm ordinary reload, no cache editing);
- explicit Resume pointer-up → received Welcome;
- any separately available server control Away/countdown/Back or Gone sampling.

The first two are browser intervals, **not exact server Away duration**. Direct
owned mode has no control seat record. A successful same-ID resume plus the
unchanged default source is useful evidence, but do not fabricate an Away timestamp
from pagehide. Exact expiry-cause/grace sampling requires the optional hosted
public countdown corroboration mapped in PREREQUISITES; otherwise that claim stays
OPEN even if the typed unavailable UI is observed. Never increase grace or use
the old3ms accelerated native harness to fit the browser.
