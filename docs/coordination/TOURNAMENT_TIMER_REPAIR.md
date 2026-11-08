# P-BOTS6b timer-wiring repair

Lead-owned packet; implement mechanically in a new isolated branch from immutable51e72c7d785da0c0472a596c2e9ae6e998148beb. Preserve all active worktrees. No optimization_port merge/push, shared status, Cargo.lock, protocol/observation/schema or Sim rules.

The reviewer found that tournament CLI --patience and --sudden are parsed and serialized into the plan, and sim_config_for(plan) exists, but the binary still builds default_config() and passes it to run_game. run_game clones the supplied configuration and never applies these plan overrides. Consequently both flags silently do nothing despite the exported JSON.

Required behavior: the real CLI execution uses the configuration derived from its plan at the appropriate existing call site. Preserve every default, deterministic seed/seat assignment, source arithmetic, output contract and reduced-runner limitations. Do not claim full bot-brain/outcome parity or wire/policy observation completion.

Success: focused actual CLI/run regression shows both overrides affect the simulation's real configured timers/phase transition, with a deterministic default control. A direct sim_config_for unit test alone is insufficient because it cannot catch the ignored return at the binary call site. Restoring the old default_config call must fail semantically; restored control passes. Retain existing corpus expectations; no hand-adjusted fixture values. Run affected formatting/Clippy/tests, report exact SHA/files/commands and remaining scope to the lead. Do not repeat unrelated full map/workspace campaigns.

Failure: either flag remains ignored, defaults drift, output describes a configuration not actually used, the negative control does not catch old wiring, or an existing source fixture changes without genuine source evidence. Stop and report the precise blocker instead of pushing unverified code.
