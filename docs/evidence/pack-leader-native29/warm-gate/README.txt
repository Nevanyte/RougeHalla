WARM/ALLOCATION GATE (Root-requested, native29):
- tests/no_alloc (unchanged broader suite): PASS, 1 test, exit 0 (logs/no-alloc.log).
- camps warm gate (new, tests/pack_leader_warm.rs): a real >8-actor training world grown with ordinary Train commands;
the same finite 40-step input-free windows measured on the original, Clone and real restore each allocate 0 blocks; the
produced state hashes match and the canonical camps count is identical after the windows. Label: direct component setup is
only the training campaign (ordinary Train commands); the snapshot internals (population/cleanup, >8 prepared capacity) are
asserted by the focused lib controls (modifiers::camps_tests, systems::ledger::camps_tests), not by this integration gate.
- Known separate non-training WindEmblem 384B after-clone red is untouched and not concealed.
