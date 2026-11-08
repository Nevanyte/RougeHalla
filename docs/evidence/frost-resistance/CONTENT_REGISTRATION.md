# Player Frost resistance content registration

Root composition extracts the actual resistance results into resisted_attack_chill and resisted_move_mult, then probes
those same runtime helpers in tagged content block frost/resistance/1. The existing stretch/thaw probes did not cover
the changed victim resistance or its position before movement quantization. No dummy tuning/revision constant is added.

Probes cover neutral/partial/full resistance, base/deepened attack chill, near/ranged overlap and thaw boundaries. Runtime
arithmetic/order is unchanged by extraction. The private intermediate content identity becomes0522ddd583cc9fd8; protocol12,
checkpoint25/replay19 and Observation18 are privately composed. Further gameplay composition still requires the final
combined hash and derived ability tape; this intermediate identity is not the served/main identity.

Root runs21 content tests,11 affected Frost tests and all3 compiled Frost resistance mutants/restored control. The
first two patches now mutate the shared runtime helpers, retaining their actual consumer failures after extraction.
Additional compiled controls show bypassing either helper changes hash_golden; both fail by the expected content-hash
assertion, not compilation, and the restored hash control passes. Existing source corpus bytes/tools are unchanged.

This registers the admitted PLAYER resistance fix, not held NPC candidate7d831c28. Native source evidence remains the
bounded folded-state/consumer scope documented in README, not replay of the full thirteen-case source timeline. No
NPC source/domain, private schema, schedule, console or publication gate is broadened here.
