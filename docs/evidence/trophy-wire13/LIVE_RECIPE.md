# Source-backed live Trophy selection recipe (not yet executed)

The existing ordinary `--map` CLI profile leaves initial loot and PvE off. The Wish duel map therefore cannot
produce an invested victim by opening a stat crate. Use the existing `--first-playable` profile for a separate real
Trophy browser scenario, with the final matched protocol-13 binary/player:

```sh
target/debug/rh-server --bind 127.0.0.1:7796 --first-playable \
  --min-players 3 --fill-bots 0 --max-rooms 1 \
  --lobby-seconds 30 --fill-seconds 0 --wish-full
```

This flag uses the embedded 48×40 `0252d18b` map and rejects `--map`. Its PvE faction profile admits Fire, Plague and
Holy; it does not admit Frost/Sentenced. Keep the existing five-ability R proof on its separate all-faction duel
profile. `--wish-full` is optional for this Trophy scenario and does not shorten the published 45-second Wish lock.
Use ordinary 50-ms steps. No seed/debug-grant/HP/stat/Trophy override is required or proposed.

1. Connect three ordinary clients before the lobby countdown ends. Two Unity clients can be victim and killer, with
   a third ordinary client kept connected and alive so two survive the PvP kill. A protocol-driven helper is possible
   but must be labeled as such, not as Unity input. Keep normal heartbeats; do not use synthetic gameplay inputs as a
   workaround for the separately repaired restore/clone scratch bug.
2. The victim walks to actual visible crates and uses normal F/Pickup. Exactly three of the eight initial crates
   yield stat offers. Inspect the actual decoded owner reward row: choose a kind-2 Boost other than Lifesteal using
   the ordinary UI/Choose path, then verify its server Build boost count increased. If a crate only yields a potion,
   continue to another unopened crate. Do not assume a stat offer from coordinates alone.
3. Have the killer defeat that same invested victim through normal gameplay. Keep the helper alive; do not end the
   match. The native kill creates its owner's Trophy at the killer's position.
4. Follow the actual owner-only kind-3 reward row. Wait for canonical CanChoose, navigate Next chest if an ordinary
   row is selected, and click its original option in Unity before the delivered expiry (normally 30 seconds).
   Capture the trusted click, outgoing Choose handle/index matching that row, and subsequent authoritative
   Picked/Taken/TakenBy update plus the Trophy HUD. Do not substitute a synthetic HUD row or debug grant.

The current wire intentionally has no cumulative killStats field. The live browser can verify the accepted real
selection and canonical taken row; exact native stat addition is separately proven by the matching-source Room/wire
integration tests. A claim of browser-observed hidden stat totals would exceed the delivered interface.

## Discovery and reproducibility

Crate positions from `maps/first-playable.json` are native world coordinates:

| Region | Crate positions |
| --- | --- |
| Fire | (240,208), (432,208), (240,688) |
| Plague | (1104,208), (1296,208), (1296,688) |
| Holy | (528,1136), (1040,1136) |

Each starts 32 units north of a matching spawn-pool point. Geometry is fixed, but the three stat-crate ranks and
runtime spawn choices use private production CSPRNG values. The map's seed=1 is generation metadata; there is no
live `--seed` CLI. Discover actual Boost rows during the run, sweeping up to all eight crates if needed. Account for
normal PvE threats, pickup range and heartbeat/lobby timing; this is a proposed executable route, not a completed
browser receipt. The existing two-client `wish-e2e.cjs` does not implement it as-is.

Source paths: `main.rs` first-playable settings/profile, `room.rs` production random room seeds,
`initial_world/mod.rs` private-salt crate ranking, `initial_world/rules.rs` three stat crates,
`systems/items.rs` real pickup-to-stat-offer, and `kill_augments.rs` real PvP-to-Trophy producer.
