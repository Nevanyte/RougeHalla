# Ending metadata: the legacy room adapter boundary

`ending-metadata.json` is captured from the actual `RaidRoom.onJoin`, `RaidRoom.settle`, and
`RaidRoom.bankVoided` methods, calling the real `JsonProfileStore` with synthetic profiles in temporary files.
The transport is a socket-free room shell; only `sendInFlight`, `sendTo`, and liveness transport bookkeeping
are stubbed. A deterministic legacy world runs actual `startRaid`, `downPlayer`, `settle`, `removePlayer`,
`abandonPlayer`, `dropBody`, and `handleSwap`. Scenario setup supplies gear, damage-history qualification,
and final down order directly. This is a focused adapter/lifecycle capture, not a combat or network fixture.
It does not implement persistence rules in the capture tool.

Run from the repository root with Node 22.23.4:

```
node --import tsx tools/persist-fixtures/ending-metadata.ts --check
cargo test -p rh-sim results::tests
cargo test -p rh-server --features postgres --test ending_metadata
```

The 15 cases cover explicit versus automatic faction choice, empty selected slot with an armed other slot,
both empty (fists), held wand, second slot, actual swap, death, active MIA, a qualified posthumous winner,
draw, withheld win, positive/zero void payouts, the bot guard, and the training adapter's second guard.
The bot and training guard cases deliberately deliver an otherwise bankable result to the adapter; they
verify suppression at that boundary, not a full training or bot match. Rust's normal live shutdown drains
matches; no abandon/void or training mode is added by this metadata slice. The existing durable Store's
`outcome: None` behavior is tested separately against the captured void payout and counters.

The current reference source is the legacy tree at commit `29e4747cd29859c855564c9b43556fd3781307c2`:

- `RaidRoom.ts:448` records only the explicitly supplied faction in `picked`; `:775–786` reads it and the
  raw selected slot when banking. A runtime default is not a faction win.
- `arena.ts:333` drops the body before resolution; `loot.ts:183–192` clears both slots. Death and active
  MIA have no ending weapon, as does a final simultaneous-death winner. Capturing before drop would
  change gold-weapon progress for that winner.
- Empty slots persist no weapon. `activeWeapon` synthesizes fists for combat and is not this adapter's
  source. `metaRoom.test.ts:937–1006` explicitly verifies empty/default/swapped behavior.
- `ProfileStore.ts:684–688` counts faction/weapon wins only for a qualified win; the independent
  `GOLD_WEAPONS` set excludes fists. Withheld wins still increment ordinary wins. Void payouts record
  no run. Bots and training never reach either persistence call through the adapter.

## Explicit projection, compatibility, and coverage

Existing gameplay fixtures are unchanged. Their `resolved` stream has never carried ending metadata;
`rh-parity` continues comparing its existing named result fields. `results/tests.rs` compares *every*
legacy sim-result field to the new capture, then compares the new typed metadata to the separately
captured `recordRun` arguments. The shared test-only `cases.rs` decoder rejects unknown envelope,
input, result, GV, and record fields. A newly captured field cannot silently disappear in projection.
Stats and progress are compared as complete JSON documents in PostgreSQL tests.

The original join choice is private `Seat` state, and typed optional faction/weapon travel in the private
`RunResult`. They are retained through pending MIA checkpoints, replay, headless results/digest, and the
existing immutable-profile-ID/fenced result writer. No lookup of a departed player's mutable state is
needed. Store `MatchResult` already had defaulted optional string fields: result document version 1,
schema, leases, transactions, retry behavior, and dependencies remain unchanged.

The private serialized state changes to checkpoint 10 and replay 8, refusing old formats. Observation 7,
policy contract 4, and protocol 5 remain unchanged. Tests prove raw result metadata and faction-choice
provenance cannot change observations or public snapshots, and every faction/weapon pair yields the
same existing wire-result bytes. State-hash and private outcome-digest mutation tests cover both fields;
restore and replay retain the optional explicit choice and between-step MIA result.

Real PostgreSQL tests compare all captured counters and stored metadata, concurrent duplicate delivery,
rename/name reassignment, stale fences, rollback before COMMIT, successful retry, and old version-1
documents missing the optional metadata. Bot reports with otherwise valid human ownership/fence are
also checked through the actual Director report loop: they cannot bank a result.
