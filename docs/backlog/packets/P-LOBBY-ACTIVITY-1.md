# P-LOBBY-ACTIVITY-1: public lobby activity (who is in a game, who is waiting)

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-2 queue states, server half); owner direction 2026-11-10
  (MIGRATION checkpoint, decision 8)
- **Implementer tier:** implementer-opus (a new public HTTP surface on `rh-server`: it writes its own failing tests first)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 outcome-class (same information as legacy's endpoint) · D2 n/a · D6: none · D5/D9 none

## 1. ID and outcome
The owner wants the lobby to show who is in a game and who is waiting. Legacy serves `GET /api/lobby` (rooms with their
phase and players, with bot tags, plus the players waiting in the hub) and takes hub presence through
`POST`/`DELETE /api/lobby/presence`; the client polls it every 15 s. The Rust server has no public lobby endpoint
(`crates/rh-server/src/lib.rs:42-48` serves `/ws`, `/healthz`, `/info`, `/ping`, `/probe`; `/control/rooms` is loopback
only). When this lands `rh-server` serves the same public information, bounded and rate-limited, and the in-room match
roster (State key 12) is delivered during the lobby phase.

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/server/src/index.ts:408-442`: the lobby routes
- `packages/server/src/guards/lobbyStatus.ts:43-68`: what is exposed and its guards
- `packages/shared/src/messages.ts:459-484`: the response shape (players, bot tags, phase)
- `packages/client/src/net/lobby.ts:43-67`, `packages/client/src/ui/lobbyActivity.ts`: the consumer (polling, staleness)

## 4. New paths
- a module for the endpoint under `crates/rh-server/src/` and its tests (named by the implementer)

## 5. Exclusive write scope
- `crates/rh-server/src/lib.rs` (routes), the new module, `crates/rh-server/src/director.rs` (a read-only snapshot of
  rooms and seats)
- `crates/rh-policy/src/delivery/projection.rs` (around `:555`) only if the roster is not delivered in the lobby phase

## 6. Contracts and references
- C-OBS: only what legacy exposed publicly: display names, bot flag, room phase, counts. No account ids, tokens,
  addresses, positions or factions of players in a running match beyond what legacy's response carries.
- `crates/rh-server/AGENTS.md`: public HTTP rules, input validation, rate limits; the control surface stays loopback.
- Presence is unauthenticated input: bounded name length, bounded number of entries, expiry, per-address rate limit.
- No protocol change: this is HTTP JSON beside the wire. If roster delivery changes, observation and policy identities
  are stated in the hand-off.

## 7. Behaviour to preserve
- Existing routes and their responses byte-identical.
- `/control/*` stays loopback only.
- Wire bytes for every existing golden vector.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-LOBBY-ACTIVITY-1` passes (full, with Postgres).
- Tests written first by the implementer: the response lists rooms with phase and players (bot-tagged) and hub presence;
  no private field appears (a serialized-response allowlist test); oversized or malformed presence is refused; presence
  expires; the rate limit holds; a room in the lobby phase delivers the roster to every seat.

## Oracle files (read-only for implementers)
- security packet: the implementer's first commit is the failing tests; the coordinator records that commit as the oracle

## 9. Validation commands
- `cargo test -p rh-server` and `cargo test -p rh-server --features postgres`

## 10. Risk and suggested model tier
Opus: a public, unauthenticated endpoint. The risks are disclosure and abuse, not difficulty.

## 11. Known traps
- Legacy's hub-wallet privacy repairs (`codex/hub-wallet-privacy-repair`) show this surface has leaked before: build the
  response from an explicit public struct, never by serializing internal state.
- Names are user-controlled: treat them as data on every consumer.
- Whether State key 12 is sent in the lobby phase was not confirmed by the lookup: verify first.

## Notes from previous attempts
