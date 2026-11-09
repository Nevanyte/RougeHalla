# Technical demo scope — owner decision, 2026-11-09

This is the current delivery scope. The owner asked to wrap up the beta port and prioritize a complete visual,
networked technical demo as soon as possible, to test Unity 2D and AWS/Rust speed. It supersedes the earlier requirement
to complete every original gameplay/content/production feature before delivering a demonstrable build.

## Demo acceptance

1. One optimized Unity Web build with the existing terrain, characters, attacks/effects, readable HUD, Settings,
   menus and results. Use the existing art; visual completeness does not require legacy asset identity.
2. An ordinary networked core match: join, movement, combat against players and mobs, representative loot/rewards,
   end of match/results and another join. Show at least two connected players; a three-seat normal game can also
   exercise the existing Trophy path. Training remains available for repeatable local checks.
3. Serve the same reviewed Rust and Unity build on practice **rougehalla.com**, using the approved staging account
   **048226733033 / ca-west-1**, within **CAD20 total gross spend**. Keep production play.roguehalla.com unchanged.
   Use existing staging resources where practical, TLS, a bounded lifetime and reliable cleanup. Account renewal is
   an external prerequisite; both AWS Core connections rejected authentication on the current check.
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
| Unity UI chat | Compose accepted Settings + icon HUD, focused native checks, one optimized Web build |
| Unity art chat | Review actual demo screenshots and fix only concrete major visual/readability defects using existing assets |
| Networking/browser chat | Ordinary multiplayer core match and Training acceptance; bounded normal helper seats, then actual metric capture |
| Account/native artifact chat | Independently inspect the one authorized Linux artifact retry and its terminal diagnostics/artifact |
| DeepSeek Rust / Post Rust | Park completed bounded work; take only concrete demo-blocking mechanical fixes when assigned |

The existing Claude prompts are optional backlog work. A Claude security/netcode change enters the demo only after
review and affected verification; unfinished Claude vision/installer/performance preparation does not block first play.

The demo is not yet complete: combined Web execution, real core-match acceptance, Calgary deployment and measurements
remain open. Historical passing runs keep their recorded revisions and scopes.
