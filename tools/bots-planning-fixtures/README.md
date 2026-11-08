# Planning-module source witness (P-BOTS-3 remainder)

Canonical actual-source capture for the brain's planning feature module (`packages/server/src/bots/brain/modules/planning.ts`)
and the shared planning maths it calls (`shared/planning.ts` matchupShare/campMatchup/nearestCamps,
`bots/mobHunt.ts` PLAN_CAMPS/planSpawnScore/planPick, over the reference duel in `shared/factions.ts` + `shared/mobs.ts`).

The corpus is `parity/policy/bot-planning.json`; the native comparison is
`crates/rh-policy/src/bots/planning_parity_tests.rs`. The capture runs in the pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5ba...` linux/amd64 image (the same immutable image as the other fixture tools):

```sh
bash tools/bots-planning-fixtures/capture.sh            # capture to parity/policy
bash tools/bots-planning-fixtures/capture.sh --check    # compare the checked-in corpus byte for byte
```

`RH_PLANNING_OUTPUT` points the capture elsewhere. The recorder asserts the exact Node version, platform and
architecture, and hashes the complete TypeScript dependency closure of the module plus the recorder itself into the corpus
provenance. The declared screen inputs are `plan-maps.json`: `pve` is the camps/spawn-pool pair of the admitted mob map,
and `spread` is a declared five-camp layout that separates the two dealt spawns (both are only the fields the shared
planning maths reads: spawn-pool positions/zones and camp centres/zones/elite spots).

## What the corpus witnesses

- The shared maths: 50 matchupShare rows (all factions x all regions x elite), 15 campMatchup rows over both maps, 6
  nearestCamps orders, 240 planSpawnScore rows (both maps x every pool spawn x every faction x six weapon choices) and 70
  planPick rows (free/taken/none/tie/alternate-spawn cases).
- Ten module cases, each a declared clock/deal script through the real `observe`/`intents`: no-deal Ready at the source's
  1000 ms boundary, a read-then-Ready case, a taken-spawn pick, the three-asks resend ladder, the spawn-answered boon ask
  (including a re-ask), a late deal with the timer Ready, non-planning phases staying silent, a learned spawn bias, a
  weapon-weighted (useless-weapon) spawn choice and a faction-less spawn.
- After every step the next draws of the module's decide/lapse streams are recorded, so a port that consumes a different
  number of draws fails even when its visible answer happens to match; the module's timing/constant tables and the tier
  numbers it reads are also recorded.

Recapture only with the pinned container: the corpus is immutable expected output, never regenerated from Rust.
