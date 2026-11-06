# Source addendum revision 3: four bounded witnesses

The earlier v1/v2 corpora and native admission audit are immutable. This revision captures exactly four additional source cases, using unchanged package bodies and a separate recorder overlay. It makes no native acceptance claim.

## Declared input recipes and observed source outcomes

- `queued-displacement-current-goal`: trusted initial reachable path ends at A=(600,320); collect; queue actual displacement to B=(400,200); replace path with distinct goal C=(900,320); drain. Actual source re-plans to C at execution: final path ends (900,320).
- `queued-displacement-current-collision`: trusted initial goal (900,320) is reachable on the open 40×20 grid; queue displacement to (400,200); replace collision with the explicitly supplied same-size rows containing a complete wall at column20; drain. Actual source uses the current collision map and returns an empty unreachable path. Map replacement is a trusted future-producer/leaf setup, **not** an ordinary native mutable-map producer. Destination/goal selection and dynamic terrain production remain outside this packet.
- `nonneutral-healtaken-heal-kinds-floor-payout`: input healTaken row+.5 and antiHeal.2; real ordinary and ignore-lockout heals100 gain120 each, lifesteal100 gains80. Actual death-floor/ledger then records500 taken, holds HP5 and source teleport clear pays the floor through the heal funnel to HP605. The fixture proves multiplication/exemption, not naturally reached combat lockout or card production.
- `nonneutral-farm-lifesteal-outside-cap`: trusted normalized mobStats pre-state `rotMonk:400`, followed by the actual source `recomputeMods`. Actual source `mobStatRows` supplies the farm row from its own reward policy. Large regular lifesteal2, product-stat lifestealMult+1, dot term.4, healTaken+.5 and antiHeal.2 accompany generic DoT through a genuine source step/ledger/installed afterDamage. Alice loses50; Bob gains114, HP20→134. Farm contribution sits outside the regular total cap; lifesteal remains exempt from healTaken. No mob store, kill reward, acquisition, card or stat-trade producer is claimed.

`cases-v3.ts` declares every operation and trusted input. The source rotMonk effect and count maximum are captured as policy data through actual shared exports, never calculated from native outputs. New `farmSetup` only installs a declared safe nonnegative normalized count map and invokes real `recomputeMods`; it does not execute the acquisition/grant routine or emit its toast. Native test providers must derive supplied farm input from the declared count and bound source policy, never from expected getter/projection values. The shared stat-fold kernel remains its existing owner's responsibility.

## Schema delta

Format remains `rh-status-probes/1`; slice is `review-boundaries/3`. Base shared fields are unchanged. New required top-level policy:

```
policies.farmLifesteal = {
  mobType: "rotMonk",
  effect: { k:"stat", stat:"lifesteal", v:<actual source coefficient> },
  countMax:<actual source MOB_STAT_COUNT_MAX>
}
```

Closed new operations are `mapReplace {kind,rows}` and `farmSetup {kind,id,counts}`. This narrow profile uses 40×20 rows and unique rotMonk safe-integer counts. Unknown/duplicate map keys, unsupported kinds, fractional/negative/unsafe counts and missing actor references refuse during pure preflight. It is not a new general raw mob-stat wire validator.

Each existing `snapshot.runtime` adds:

- `collision:{seed,w,h,gatesLocked,rows,sourceMapHash}` from the actual current `collisionMap`. Rows and dimensions are the status harness's collision comparison. `sourceMapHash` is typed source evidence over legacy map layers/factory metadata, not a requirement to duplicate a map generator or reconstruct that hash from expected output.
- Ordered `modifierInputs:[{id,mobStats,farmSums,farmLifestealRows,regularLifestealRows,lifestealMult,lifestealDot,healTakenMult}]`, read from actual source module exports. These are assertions only.

Complete role/vitals/status/body/current-goal/path/history/locks/slip/cast/crit, ledger/deferred/landed, callbacks/hooks/events and actual stream continuations remain as in the inherited projection. Full source World evidence is retained. Undefined/null/sparse payload distinctions are unchanged. `setup.input` and operations drive execution; before/after/returns/projections never do.

## Commands and evidence

```
tools/status-fixtures/capture-v3.sh
tools/status-fixtures/capture-v3.sh --check
python3 tools/status-fixtures/validate-v3.py parity/status/boundaries-v3.json
```

Default separate output is `<prefix>/status-source-work-v3/output`; `RH_STATUS_V3_OUTPUT` overrides it. Canonical runtime is Linux amd64 Node22.23.4, binary-hashed, inside cached Docker c86ecead9e55 with `--pull=never`, read-only source/Node and executable dependency tmpfs. Host Node is not canonical evidence. The readonly bytecheck's before/after bytes and hashes are bound in the external manifest.

`validate-v3.py` is a closed overlay over immutable v2 admission. It preflights all requested operations before snapshot checks, rejects raw recursive duplicates, validates the new policy/projection, and runs22 fixed negative controls. Existing earlier profiles are not silently loosened. Source files and all earlier owned artifacts are hash-verified unchanged; every case requires untouched-run full-data/return equivalence and actual RNG continuation verification. No original source function body is edited or rewritten as an oracle. `probe-v3.ts` is a versioned capture scaffold derived from the earlier recorder, with only trusted setup operations and observational projection additions.
