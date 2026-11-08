# P-BOTS-4: the pure mob-hunt and build-route decision layer

Stacked PR: deepseek/p-bots-4 -> deepseek/p-bots-3 @ 16250bbd; branch created at that head, clean before work. No
wire/protocol change (protocol 7), no dependency or Cargo.lock change, no schedule change. Ledger row:
docs/evidence/deepseek-rust/PROGRESS.md.

Status: DONE-VERIFIED slice; P-BOTS-4 remains INCOMPLETE at packet level (exact remainder below). No packet file
exists: the scope was derived from the backlog row (line 160: "Mob hunting, build routes, camp farming, elite rules",
deps P-MOBS-1 + P-BOTS-1), the P-BOTS-1/P-BOTS-3 evidence remainders and the legacy code, which wins over prose.

## Assessment before writing (code and git, not memory)

The previous owner's survey was verified against the checkout. P-BOTS-1/2/3 already landed the tier/persona tables,
the bot seats and humanizer, the room path service, away-point tactics and the Wish module (docs/evidence/stage2-bots-*).
What was missing for this packet was the mob-hunt/build-route decision surface itself. Two blockers were listed:

1. **rh-sim exposed no public weapon-loop accessor** (shared/weapons.ts WEAPON_BEATS/weaponEdge). Resolution: ported as
   a policy helper in rh-policy/src/bots/mob_hunt.rs (the assignment allowed "or a policy helper"), so rh-sim's content
   contract is untouched: no rh-sim file, no content constant and no content hash changed, and the content registry test
   does not see a new table. is_ranged is derived from rh-sim's public content::weapon shape (no duplication).
2. **The mob-stat reward catalog was said to be unexposed.** Verified false at this base: rh-sim's
   modifiers::farm::DEFINITION (the actual source MOB_STAT_REWARDS rows and kill-stack bounds) is public, as are the
   stat_fold EffectStat/FlatStat enums. rh-policy reads it read-only in build_route.rs reward_stat, mapping the 20 normal
   types to the build stat keys; no content change and no duplicated table. A parity assertion also requires every
   normal type in rh-sim's mob catalog to have a ported reward row.

## Delivered

- crates/rh-policy/src/bots/mob_hunt.rs: the MobHuntConfig struct with the 30 MOB_HUNT fields and the exact source
  defaults; hunt_config_for(tier, persona) with PVE_RELIEF; the weapon loop (WEAPON_BEATS/weapon_edge), is_ranged,
  MobLike and mob_weapon; useless, best_edge, best_slot_vs_mob; retreat_point (16 headings, two distances, the source
  tie order); HuntDecision and wants_mobs with NO_MOB_IN_REACH. Pure: no clock, I/O or entropy.
- crates/rh-policy/src/bots/build_route.rs: FarmStat, BuildGoal and the two builds per faction as exact stat weights
  (BUILD_GOALS, FactionId::ALL order); the route/elite constants (STAT_FLOOR, ROUTE_STEPS, MAX_WAIT_MS,
  CLEAR_MS_PER_MOB, CLEAR_MS_ELITE, ELITE_VALUE, ELITE_AFTER_MS, ELITE_MIN_KILLS, ELITE_EARLY_POWER, CONTEST_MS,
  ZONE_CONTESTS, ZONE_MEMORY_MS, ZONE_AVOID_MS, CONTEST_PLAYER_RANGE, OWN_FIGHT_SLACK, WALK_FACTOR, REPLAN_MS);
  build_of, release-safe reward_stat, type_weight, ready_for_elites, RouteCamp and the pure camp_value.
- bots/mod.rs registers and re-exports both modules.
- parity/policy/bot-mob-hunt.json (rh-bot-mob-hunt-source/1, 148,378 bytes, 973 cases, SHA256
  22ac53ca86ab0b24f317c1ca59d07f82a0c6e4bba96d6064617edbe70315e43b), captured only in the pinned Linux amd64
  Node 22.23.4 container by tools/bot-mob-hunt-fixtures/capture.sh and byte-compared by --check. It records the
  source closure hashes (13 files), the declared retreat map, and exact outputs for: the 30-field MOB_HUNT table;
  12 tier x persona hunt configs; 36 weaponEdge pairs; 36 useless pairs; 78 bestEdge cases; 112 bestSlotVsMob cases;
  64 mobWeapon cases (including empty/unknown ids); 9 retreatPoint cases (open, cornered, walls, short-step, enclosed
  and inside-wall null); 6 HuntDecision/wantsMobs cases; the 10 BUILD_GOALS; the 17 build-route constants; 20 buildOf,
  320 typeWeight, 80 readyForElites and 200 campValue cases.
- crates/rh-policy/src/bots/mob_hunt_parity_tests.rs: 5 parity tests replaying every declared case through the ported
  functions (numbers bit-exact; retreat points at the capture's 1e-6 rounding, since both sides run the ported trig).
- tools/bot-mob-hunt-fixtures/mutants/ + run-mutants.sh: 5 committed mutants (elite-share default, wand-vs-bow useless
  rule, elite camp value, build stat floor, retreat heading count). All 5 are killed by a semantic parity failure and
  the unchanged control passes.

## Verification

- tools/bot-mob-hunt-fixtures/capture.sh --check: byte-identical recapture in the pinned container (973 cases).
- cargo test -p rh-policy --all-features --lib -- bots::mob_hunt_parity_tests: 5 passed / 0 failed.
- tools/bot-mob-hunt-fixtures/run-mutants.sh: 5/5 mutants killed; unchanged control passes.
- cargo test --workspace --all-features --locked with the PostgreSQL test cluster (tools/pgtest/start.sh):
  1,466 passed / 0 failed / 3 existing ignored across 152 test binaries; exit 0.
- cargo clippy --workspace --all-targets --all-features -- -D warnings: clean (exit 0, zero warnings).
- cargo fmt --all -- --check: clean.

## Exact remainder for P-BOTS-4

1. The stateful MobHunter (mobHunt.ts): MobTracker observe/home/returning/awake/awakeNear, the engagement record and
   keep/drop rules, bans, retreat timers, the pick scoring over candidates and walks, focus stats. It needs the
   brain's memory/percept frames (P-BOTS-1 remainder) and a walk callback.
2. createHuntAdapter (brain/huntAdapter.ts): per-bot config wiring, mobLikeOf/mobMaxHp over memory, seedHomes, the
   catch-up replay in 240 ms pieces, release, and the WHEREABOUTS_MAX_AGE_MS / BLOCKED_THREAT_FACTOR /
   STRAIGHT_WALK_FACTOR constants.
3. The stateful BuildRoute planner (brain/buildRoute.ts): update/plan/noteContests/done, the route value-per-second
   greedy over ROUTE_STEPS, respawn waiting, contested camps and zone memory.
4. planSpawnScore/planPick/PLAN_CAMPS and re-exported matchupShare (mobHunt.ts): they need the planning camps and the
   shared campMatchup layer (P-BOTS-3 remainder, planning module).
5. The full strategy.ts scoring/threat layer and tactics/{fight,world} (the P-BOTS-1/P-BOTS-4 remainder), which is the
   consumer of these pure helpers, plus the remaining feature modules.

This slice reads only static shared content and declared arguments, keeps the seats deterministic and changes no wire,
schedule or serialized state; P-BOTS-4 INCOMPLETE covers items 1-5 above.
