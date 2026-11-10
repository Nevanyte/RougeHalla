# Morning single-owner Source launch flags

Prepared on base `29a7d597136e30f4698785904a238451bd3de3f7` in `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-morning-host`. The commit containing this receipt changes only the Source app-unit option string and this runtime documentation/evidence. No Rust, AWS, protocol/identity, expiry, isolation, shaper, budget, dependency or shared-status change. No Claude communication occurred.

Source now uses `--min-players 1 --fill-bots 8 --max-rooms 1 --lobby-seconds 10 --fill-seconds 3`. Fill8 is a total target of eight players, normally one human plus seven bots, not eight added bots. Training remains exactly `--min-players 1 --fill-bots 0 --max-rooms 1 --lobby-seconds 0 --fill-seconds 0`; a direct generated-unit comparison confirms its full text is byte-identical to the base. Both retain `--bot-learning off`, loopback binding, exact artifact readiness and original absolute expiry guards.

## Current runtime meaning, inspected read-only

- `crates/rh-server/src/runtime.rs:90–118` accepts these positive min/max seat counts and finite seconds; Source arena remains the validated map profile. `main.rs:524–531` propagates runtime.fill_bots to DirectorConfig; `:641–662` passes the explicit CLI count into server_fill_config and enables the genuine fill manager for non-Training. `bot_fill.rs:197–209` makes the CLI target override only fill_to.
- `bot_fill.rs:310–315` bounds the target by MAX_PLAYERS; `:350–398` requires a human, schedules `target - current players` bot seats, and squeezes them when the deadline shortens. `:402–416` fills any remaining seats at lobby close. Its normal constructor's arrival_seconds is12 (`:149–155`), so the initial10-second countdown is already in its arrival window; the one-second end margin and squeeze are actual code, not an invented arrival timer.
- `crates/rh-sim/src/sim.rs:378–380` initializes the first-seat deadline to now+lobby_seconds. `systems/lobby.rs:22–34` counts humans, and reaching min_players1 shortens that existing deadline to at most now+fill_seconds3. Therefore10seconds is the initial timeout; a present human normally makes the effective remaining countdown about3seconds. This is not a promise that active combat starts exactly3wall-clock seconds later: normal source planning/lifecycle and runtime scheduling still apply.
- `crates/rh-server/src/room.rs:1079–1128` runs actual lobby fill/closing before the applicable simulation step (`:1302`), seats normal BotSeatSpecs, and `:1134` onward constructs existing HumanBot policies. The ordinary fill manager, not placeholder direct brawler fill, is selected by current main startup. This is existing canonical public bot behavior; the separately admitted private full-Brain components are not newly activated by these flags.

One human can therefore trigger the Source lobby transition and total-eight fill under the current accepted runtime/code path. This conclusion is static code inspection, not an executed native match or final host acceptance. No Rust tests/probes were authored or run for this option-string edit.

## Actual offline checks

From the checkout root, Python3.9.6, with `PYTHONDONTWRITEBYTECODE=1`:

| Command | Actual result |
| --- | --- |
| `python3 -m unittest discover -s hosting/technical-demo -p test_offline.py -v` | exit0;12PASS/0.023s (`offline-tests.txt`) |
| `python3 -m unittest discover -s hosting/technical-demo -p test_stack.py -v` | exit0;7PASS/0.005s (`stack-tests.txt`) |
| Direct import/app_unit render; compare Training with read-only `git show29a7d597` baseline | exit0; Training byte-identical; exact Source/Training ExecStart/ExecStartPre captured in `rendered-units.txt` |
| `git diff --check` | exit0; empty output |

Existing suites remain unchanged. No new implementation-mirroring test was added. The render comparison is an offline receipt and does not run systemd, the native binary, networking or cloud APIs. No failure occurred in these commands.

## Final artifact gate

Current checked runtime is protocol14 (`crates/rh-protocol/src/lib.rs:172`). No unsupported `--hitboxes` flag was added. Root expects the separate final hitbox branch to default archetypes after union; that future merged behavior is not evidence from this checkout. After the permitted Claude handoff, Root must validate the final exact-tree binary/runtime, map export and full rendered flags together, derive exact protocol/content identities from that artifact, then perform the separately authorized launch/browser/cleanup gates. This preparation preserves all earlier deployment approval/budget and fixed-expiry conditions and claims none of that final proof.
