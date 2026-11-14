# P-BOT-BRAIN-THEMED-1: the Brain values a camp by the buff it actually pays

- **Serves:** owner decision 2 (2026-11-10: zone-themed camp buffs) and the owner's condition on DEV-027 (signed
  2026-11-13): "the Brain's camp valuation must read themed buffs before `--bot-brain full` goes live"; owner decision 8
  (learner and tuner runs)
- **Implementer tier:** implementer-opus (bot priority, `rh-policy`)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-BOT-BRAIN-CHOICES-1
- **D-rules touched:** D1: legacy after its patch `a7a5c4ce` (zone-themed camp buffs) is the reference for how its
  Brain values a camp, if that patch changed the Brain; loose proof · C-OBS: the seat reads only the reward its own
  percept already carries · no wire or observation change expected

## 1. ID and outcome
With themed camp buffs (live, and now the Brain tournament's world) a camp pays the buff of its zone's theme, not the
buff its mob type used to imply. The Brain still values a camp by mob type:
`crates/rh-policy/src/bots/temporal_percept/strategy/build_route.rs:245-261` (`route_camp_value` uses
`type_weight(build, mob_type)`). The percept already delivers each camp's reward stat
(`brain/compose14.rs:945`); no strategy code reads it. About 30 percent of camps are misvalued, which biases which
camp a Brain seat opens on (the learner's `opener` statistics) and what every Brain tuner search scores.

When this lands the Brain values a camp by the reward the camp pays as the seat's own percept reports it, weighted
for the seat's build as legacy weights a buff of that stat; a camp whose reward is unknown to the seat is valued as
today. Under the legacy (unthemed) buff mode the valuation is unchanged, so the frozen-corpus and parity paths do not
move.

## 2. Dependencies
P-BOT-BRAIN-CHOICES-1 (the Brain tournament world has themed buffs on).

## 3. Relevant legacy paths
- `packages/server/src/bots/brain/` strategy (camp value and route planning) before and after `a7a5c4ce`: the oracle
  author establishes whether legacy's Brain was changed by that patch, and how it maps a reward stat to a weight.

## 5. Exclusive write scope
- `crates/rh-policy/src/bots/temporal_percept/strategy/build_route.rs` and the modules it needs for the weight
- not the percept composition (`compose14.rs`) unless the oracle author shows a missing fact, not `rh-sim`

## 7. Behaviour to preserve
- Unthemed mode: identical decisions (the existing `parity/policy/` Brain captures and `brain_bots` tests).
- The fair-seat contract: nothing about a camp the seat's percept does not carry.

## 8. Acceptance checks
- One loose-proof test: in a themed world, two camps of the same mob type that pay different buffs are valued
  differently by a build that wants one of those buffs, in the direction legacy's weights give; a seat with no
  reward fact for a camp values it as today. Red today.
- Guards: the unthemed captures and `brain_bots`, `brain_choices` stay green.
- `scripts/gate.sh --oracle packet/P-BOT-BRAIN-THEMED-1` passes.

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"; cargo test --locked -p rh-policy`; `cargo test --locked --release -p rh-headless --test brain_bots --test brain_choices`

## 10. Risk and suggested model tier
Opus (bot priority). Any learning store or searched table made before this lands is provisional and is regenerated
after it.

## 11. Known traps
- The frozen-corpus paths must keep the source rule exactly; branch on what the percept carries, not on a global mode.

## Notes from previous attempts
