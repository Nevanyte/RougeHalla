# P-BOTS-2: the Wish module (abilityPolicy) on the bot policy seats

Stacked PR: [#51](https://github.com/Nevanyte/RougeHalla/pull/51), deepseek/p-bots-2 -> deepseek/p-bots-1 @
03557512; commits COMMIT_RANGE. No wire/protocol change (protocol 7), no dependency or Cargo.lock change.

Status: this slice is DONE-VERIFIED; P-BOTS-2 remains INCOMPLETE at packet level (the exact remainder is listed below).
There is no packet file for P-BOTS-2; the scope was derived from the backlog row (docs/backlog/README.md line 158: the
Wish module / abilityPolicy, depends on P-ABIL-1 + P-BOTS-1), its legacy owners (packages/server/src/bots/abilityPolicy.ts,
packages/server/src/bots/brain/modules/wishes.ts) and docs/BOTS.md 8 before writing.

## Assessment before writing (code + git)

The P-BOTS-1 base already carried the seams this packet needs: the Policy/Seat contract and deterministic seats, the fair
Perception built from Observation only, the Intent/IntentBody::Cast channel and the ported humanizer that turns a cast
intent into a client click (target snap, reaction time, hesitation, a unit cast that can miss like a lock click), plus the
PublicCommand::Cast emit path through the validated input boundary. The ability mechanics were available from
P-ABIL-1: the five Wish Definitions (target, cast time, charges, effects), the public blink::landing rule already pinned
against the source, and the observation's own wish: OwnerView and effects bits. What did not exist was the cast policy
itself (intent-tag decisions, escape headings, engage/peel rules), the Wish module (slot availability, Easy remember draw,
retry gap, the situation it describes and the intents it emits), and its perception facts (own effect bits, the Wish slot and
the owner's own hit events).

## What changed (the verified slice)

- The pure cast policy (crates/rh-policy/src/bots/wish.rs): decideCast by the public definition's intent tags in
  definition order (escape, sustain, engage/control, peel; burst/zone/buff inert until skills), with the source numbers
  (escape at low hp near a threat within 260 u, or low hp while being hit; sustain below 35% while hit; unit casts start 16 u
  inside their range; a chasing enemy within 150 u is peeled; a blink to engage needs a 120 u gap and stops 40 u short), the
  seven escape headings and the blink landing search (the first valid landing that is further from the threat by 24 u), the
  casting gate and the stun/silence block bits, and hidesCaster by the rank's effects. The five Wish rows are declared as the
  bot's static table and cross-checked in the parity test against the sim's own public Definitions (cast time, charges,
  target, hidden and blink effects) so the two cannot drift.
- The module and its seat hook (wish.rs + bot.rs): per-bot Wish state (availability edge, the Easy tier's defensive-tag
  filter and remember share drawn from the policy's own decide stream, the 1000 ms retry gap, the fair per-attacker hit
  memory); the situation built only from the frame (own hp share, own effects, being hit, the front end's chosen foe, the
  nearest enemy and whether it is chasing by velocity or a recent hit); the cast emitted as a cast intent with the source
  timing (fresh low-hp/hit/windup/draw/new-threat/incoming stimulus first, else the next step), reflex priority while below the
  escape hit line and combat priority otherwise. The front end offers the cast first, and the humanizer supplies the hand.
- Perception additions (Observation-only): the owner's effects bits, the Wish slot (ability, ready time, full-charge time,
  max charges, casting, rank), and the observation's own hit events (hit time plus player-attacker keys for the hit-memory).
- Fixtures and parity: tools/wish-fixtures/ captures the unmodified legacy policy in the pinned
  node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 linux/amd64 container
  (complete source-closure hashes, two-run byte-identical, --check mode) into parity/policy/bot-wish.json: the five rows,
  hidesCaster per rank, the module rule table, the policy constants and 173 declared situations with their decisions
  (blocked/casting gates; escape/sustain thresholds and near misses; engage/control range margin, los, mob and untargetable
  cases; blink close/far; peel distance/chasing/los/id edges; intent order; rank clamps; Blaze escape/engage landing searches
  beside declared walls). The parity test replays every case, pins the static rows, hides answers, rules and constants, and
  cross-checks the sim definitions.
- Mutants: seven committed patches (sustain hp, escape hit threshold, engage margin, peel distance, hidesCaster, the Easy
  filter, the blink-escape gain) with run-mutants.sh: 7/7 mutants killed; unchanged control passes.

## Tests

- crates/rh-policy: the bot-core corpus (17) plus the wish parity tests (5) and the policy-seat module tests (7): a troubled
  bot casting its self Wish through the humanizer, two seats deciding identically from the same staged observation, a normal
  bot engaging with its unit Wish while Easy never spends it, the blocked/casting/cooldown/absent gates, the retry gap and an
  old hit not sustaining, the Easy filter rows, and the Wish slot being a fair copy of the Observation.

## Verification

- Git: COMMIT_RANGE.
- CI: no wire change; the workspace gate below is authoritative (the base stack's rust workflow keeps its known long-run risk).
- GATE_PLACEHOLDER

## Exact remainder for P-BOTS-2

1. The Swarm slip goal: while a hiding Wish is armed (or the bot is hidden), the legacy module scores a module goal above a
   flee, walks away with slipStep/awayPoint and locks nobody until the hiding ends. That needs the P-BOTS-1 remainder's
   module-goal/strategy/tactics and services path layers, which this branch did not invent; the cast itself is delivered and the
   hidden Wish still fires.
2. Full fair-view foe/threat flags: the bounded perception does not carry the client's line-of-sight or mob-targetability
   flags, so the module treats a delivered actor as in sight and a visible mob as targetable (the parity corpus covers the
   policy's los/targetable inputs directly; the in-game adapter is the narrowed part).
3. Gate-locked blink collision: the fair static view carries the open public map only; the corpus keeps gatesLocked: false
   and this evidence states it (the sim's landing rule itself is P-ABIL-1 parity-pinned).
4. The policy's mob hook (a mob casting by the same tags) is not used until mob casting exists; the pure policy already takes a
   plain situation, so no code is pending here.

Delivered scope note: all decisions read Observation plus public static content; every action is a PublicCommand submitted
through the validated path; the seat remains deterministic under its own seed.
