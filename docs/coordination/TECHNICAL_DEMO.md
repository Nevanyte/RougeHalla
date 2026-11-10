# Technical demo scope — owner decision, 2026-11-09

This is the current delivery scope. The owner asked to wrap up the beta port and prioritize a complete visual,
networked technical demo as soon as possible, to test Unity 2D and AWS/Rust speed. It supersedes the earlier requirement
to complete every original gameplay/content/production feature before delivering a demonstrable build.

**Ownership change, 2026-11-10:** the owner has transferred Unity development to Claude and paused all Codex Unity
code/assets/settings/builds, client profiling and browser/Editor testing. Root continues Rust/backend/AWS and integration
coordination. Preserve the current build, worker branches and dirty Editor baselines. See the
[Unity handoff](CLAUDE_UNITY_HANDOFF.md). Do not resume Unity work without a new owner instruction.

## Demo acceptance

1. One optimized Unity Web build with the existing terrain, characters, attacks/effects, readable HUD, Settings,
   menus and results. Use the existing art; visual completeness does not require legacy asset identity.
2. An ordinary networked core match: join, movement, combat against players and mobs, representative loot/rewards,
   end of match/results and another join. Show at least two connected players; a three-seat normal game can also
   exercise the existing Trophy path. Training remains available for repeatable local checks.
3. Serve the same reviewed Rust and Unity build on practice **play.rougehalla.com**, using the approved staging account
   **048226733033 / ca-west-1**, within **CAD20 total gross spend**. Keep production play.roguehalla.com unchanged.
   Use existing staging resources where practical, TLS, a bounded lifetime and reliable cleanup. Both AWS Core
   connections rejected authentication, but Root has now renewed the local `rougehalla-staging` CLI profile through
   the in-app browser and verified STS account3033. The CLI can support the staging work.

   Owner hostname correction (2026-11-10): use **play.rougehalla.com** for the test build; official production is
   **play.roguehalla.com**. The apex test domain is not the delivery URL. Keep production DNS and services untouched.
4. Measure the actual M5 Pro client and server: frame time/FPS, Rust tick time/deadline misses, round-trip latency,
   memory and bandwidth. Record build identities, resolution, quality, renderer, browser/display limits, scenario and
   active player/mob count. Separate local from Calgary results, server tick rate from compute capacity, and displayed
   FPS from CPU/GPU headroom. The simulation stays at its authoritative 20 Hz. There is no 60 FPS target or cap.
5. Compare legacy and the new client/server using equivalent scenarios and disclose differences. First establish
   the new build's real measurements; do not delay the playable demo for an exhaustive content comparison.

## Deferred from the demo critical path

- Complete quest catalog, every augment and elite reward, and speculative beta balance/content work.
- Full advanced bot Memory/perception/strategy/hunting/learning parity and public Brain activation. Preserve private
  candidate branches; the demo can use existing bots and ordinary human/protocol seats.
- Optional owner attack-preview publication/new protocol, grouped bleed feedback polish, and exhaustive faction/
  resolution/content matrices. Damage and the included authoritative mechanics must continue to work.
- Full production regional scaling, production durability/lifecycle certification and exhaustive release audit.
  Preserve the already implemented account/persistence safeguards; no production changes are authorized here.

Rust remains authoritative; Unity presentation and corrected local movement prediction remain the only client scope.
Keep relevant parity, input/privacy, codec and integration checks. Use focused checks for the changed code and one
combined build. Do not add repeated unchanged campaigns or require approval for harmless recorded Editor serialization.

## Assigned critical path

| Owner | Delivery |
|---|---|
| Lead | Integrate accepted changes, fix current Linux CI, produce one release native artifact, coordinate demo acceptance and measurement |
| Claude | Unity/client development and profiling; Codex UI/art/client work paused by owner |
| Unity UI / art chats | Quiescent; preserve completed handoffs, assets and baselines |
| Networking chat | Finish only its already authorized backend-only public protocol test/cleanup; no Unity/browser work |
| Account/native artifact chat | Independently inspect the one authorized Linux artifact retry and its terminal diagnostics/artifact |
| DeepSeek Rust / Post Rust | Park completed bounded work; take only concrete demo-blocking mechanical fixes when assigned |

The existing Claude prompts are optional backlog work. A Claude security/netcode change enters the demo only after
review and affected verification; unfinished Claude vision/installer/performance preparation does not block first play.

### Competitive netcode direction

The owner explicitly confirmed that Claude's intentional departures from earlier constraints for speed are wanted.
Review these as design changes on correctness, gameplay fairness, security and measured benefit; an old-rule conflict
alone is not grounds for rejection. Claude's completed Wave1 candidate is `aef6da2c` on
`claude/peaceful-babbage-rtsgq6` (base76d170a1), including its earlier security commit. It still uses authoritative Rust
and20Hz; changes include rewind allowances, server timing metrics, movement reconciliation/speed prediction, render
timing, input coalescing and Unity feedback. Its claimed tests do not establish Unity compilation or real-link gains.
Root has reviewed and merged the server/client halves plus a reproduced stale-echo repair at `fe0e2983`. The current
combined Web B and Mac release include them; actual link/performance gains remain unmeasured. Proposed
later waves in `NETCODE_COMPETITIVE_PLAN.md` are separate implementation work, not already merged features.

The optimized Web B build now runs locally, with all five faction ability activations and a real three-player PvP
kill/Trophy choice reaching delivered chosen/taken state at 2560×1440/text 150%. The UI chat's build handoff is complete;
art/networking are finishing normal results and cleanup. The new-source Linux artifact 42729941646 also passes, and its
temporary trigger is removed at `bac4820f`. The first two Calgary guests terminated safely; the second proves the NFT
syntax error. The multiline fix passes an actual Ubuntu parser, and fixed guest `i-00b97e48b4e5c4f31` now passes real
native/storage/isolation/shaping checks. **https://play.rougehalla.com is live** with valid TLS and a real browser
profile-load/Training/movement/Leave check. Explicit Caddy MIME matching now enables gzip on actual WASM/data GETs;
no Unity/native rebuild was needed. Original shutdown remains **2026-11-10 03:50:21 UTC** (November9,20:50 Calgary).
Hosted multiplayer, actual M5 Pro/legacy performance measurements and final cleanup/release checks remain open.
Historical passing runs keep their recorded revisions and scopes.
