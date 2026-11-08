# Frozen browser acceptance — 1310ae00

Both requested browser proofs passed against the same frozen Unity artifact and Rust binary on 2026-11-08. The game implementation was not changed during this campaign. The new Trophy driver, helper and evidence contract are additive test tools.

## Frozen identities

- Source: `1310ae002870bf3fc674c7b65f38ff5ea55a7d75`.
- Protocol: **13**; content: **`67183626db240b6a`**; normal server step: **50 ms**.
- Rust binary SHA-256: `20d5b70e9ed79863f03350fbeb9478fd7f45e0a7a644ea2a802a13c14d75b4b0`.
- Unity artifact: `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/builds/protocol13-1310ae00`, served at `http://127.0.0.1:18913/` during the campaign. The [build manifest](build-manifest.json) records the source, generated BakedContent and all 14 archived file hashes. [served-checks.json](served-checks.json) independently verifies all 14 served files.
- Trophy map: source legacy hash `0252d18b`, protocol tile-layer hash `1c772b5b`. They use different hash inputs. The frozen `maps/first-playable.json` SHA-256 is `90bc4c8e82b7d4ba4819843001ae59da35c20ee870b5591b20192082b5bd16aa`.
- [provenance.json](provenance.json) records the frozen R runner, decoder, duel map and binary. Each Trophy attempt has its own `runner-identities.json`; those identify the evolving test driver separately from the frozen game.

## All five R abilities — PASS

The unmodified frozen `tools/latency/wish-e2e.cjs` passed its first actual browser campaign: **Blaze, Trial, Swarm, Freeze and Last Stand**. [wish-attempt-1.json](wish-attempt-1.json) contains the complete result; the five screenshots are in [wish-screens](wish-screens/).

Each case used two fresh Unity pages and its own PID-verified loopback server, with `--wish-full`, no bots, no training and the normal 45-second opening lock. Trusted browser pointer/R input produced Unity's sampled Cast sequence in the same Unity frame as the actual WebSocket send. The report pairs each own-caster native landed event with its exact source timestamp and applied Unity presentation marker, verifies charge spending, and preserves occurrence multiplicity. All five cases have no page errors, decoder errors or trace overflow.

The 19 R proof/readiness contract checks passed. No R campaign was repeated after this PASS.

## Real Trophy selection — PASS

[Trophy attempt 5](trophy-attempt-5/trophy-e2e.json) passed at `19:50:05Z`. The [independent contract verdict](trophy-attempt-5/independent-contract.json) is also PASS, with no failures.

1. Three distinct ordinary, nontraining protocol-13 seats joined a fresh `--first-playable` server. The Fire owner was the real Unity browser client (player 3); the Holy victim and third seat were ordinary protocol peers. Their commands went through the server's public input path.
2. The victim opened the real source crate at `(1296,208)` and chose its delivered kind-2 Boost, id 5, original option 0. The authoritative Build count changed only at index 5, from 0 to 1. The helper used the latest ready reward handle 2 after birth handle 1 changed.
3. The Fire Unity owner used its normal starting fists and ten trusted browser attack cycles. The server reported `Death { id: 1, by: 3 }`, and the owner's kills increased from 0 to 1. The owner and third seat remained alive.
4. The server produced a real owner-only kind-3 Trophy: attack-speed key 4, exact gain `0.015`. The trusted HUD pointer down/up selected original option 0. The actual Unity WebSocket command was `Choose { handle: 4, pick: 0 }`, bound to the current delivered ready row.
5. The server then delivered the same source position and ordered Trophy identity with `Picked=true`, `Taken=true`, `TakenBy=3`. Its public handle changed to 5 after selection. The [before](trophy-attempt-5/trophy-before-trusted-click.png) and [after](trophy-attempt-5/trophy-after-authoritative-taken.png) screenshots show the real HUD; the latter reads **TROPHY 1 / 1 · CHOSEN** and **+1.5% attack speed · taken**.

No HP, stat, Trophy, reward, expiry or kill outcome was injected. The victim's acquisition and staging used ordinary protocol inputs; the owner's movement, attacks and final selection used trusted Unity browser input. The wire deliberately has no cumulative `killStats` field: browser acceptance proves the real accepted selection and canonical taken state; exact native gain application is covered separately by the source-backed Trophy transport tests.

The independent Trophy contract has nine synthetic positive/negative controls; those are contract checks, not live gameplay evidence. All nine passed, and the actual attempt-5 report passed the same validator.

## Preserved incomplete attempts

| Attempt | Result | Observed stop |
| --- | --- | --- |
| [1](trophy-attempt-1/trophy-e2e.json) | INCOMPLETE | Driver compared the legacy map hash with the wire layer hash; stopped before gameplay. |
| [2](trophy-attempt-2/trophy-e2e.json) | INCOMPLETE | The boosted Plague victim's real passive Disease killed the Fire owner during approach. |
| [3](trophy-attempt-3/trophy-e2e.json) | INCOMPLETE | Optional weapon-pickup driver waited on a stale prop handle. That optional path was removed. |
| [4](trophy-attempt-4/trophy-e2e.json) | INCOMPLETE | Real investment, credited Unity kill and ready +2.5 AD Trophy succeeded; driver stopped on an obsolete pre-click reward handle. |
| [5](trophy-attempt-5/trophy-e2e.json) | PASS | Actual current-row Choose and authoritative taken state, independently validated. |

The separate [helper pilot](trophy-helper-pilot-success.json) proved normal Boost acquisition and movement with three protocol peers. It is not a Unity or PvP-kill proof.

## Reproduction

Use the manifest-pinned frozen artifact and Rust binary. The existing R command runs from the frozen source tree; the additive Trophy command runs from the tree containing these test tools. Set `RH_PLAYWRIGHT_MODULE` to the installed Playwright module used by the repository. Both runners require loopback endpoints and verify their own server child owns the listener.

```sh
RH_WISH_OUTPUT=/absolute/path/wish-report.json node tools/latency/wish-e2e.cjs \
  --url http://127.0.0.1:18913/ --server-bin /absolute/path/to/frozen/rh-server

RH_TROPHY_OUTPUT_DIR=/absolute/path/new-trophy-attempt node tools/latency/trophy-e2e.cjs \
  --url http://127.0.0.1:18913/ \
  --build-manifest /absolute/path/build-manifest.json \
  --wish-report /absolute/path/wish-report.json

node --test tools/latency/trophy-proof-contract.test.cjs
```

Source spawn order and loot remain random. A new run must discover real crate choices and earn its own Trophy. The saved proof makes no AWS, WAN latency, display scanout or production performance claim. The five R presentation markers establish the applied managed presentation stage.
