# rh-policy: local rules

Bots and the seat contract (ADR 0005, CONTRACTS C-POLICY, `POLICY_CONTRACT_VERSION`). Live rooms with a fill policy seat
`HumanBot` (`src/bots/`), a partial port of the legacy bot; without one they fall back to the scripted `Brawler`. The full
legacy Brain is ported privately (`P-BOT-BRAIN-NATIVE-1`) and is **not** wired to live bots; activation is
`P-BOT-FAIR-ACTIVATION-1` and needs legitimate shared observations first.

## Invariants

- Bots are players: their actions go through `validate` + `Sim::submit` like a human's (C-INPUT).
- Bots see only their own observation (C-OBS): no hidden state, no fabricated entity or item references.
- Decisions are deterministic given (observation, seeded RNG); `clippy.toml` bans hash-ordered collections, the clock
  (one sanctioned exception: the seat's decision budget) and platform math.
- Behaviour matches the legacy bot (`packages/server/src/bots/`): priorities compete every decision tick, so looting
  yields to fighting back or fleeing when attacked, as in legacy.
- No machine learning (R-ML). Bot learning here means the legacy opt-in statistics, nothing trained.

## Routing

Wiring the Brain into live play, or changing how priorities compete: `implementer-opus`, reviewed by `reviewer-opus`.
Module ports against existing source captures (`parity/policy/`) are ordinary oracle-backed packets.
