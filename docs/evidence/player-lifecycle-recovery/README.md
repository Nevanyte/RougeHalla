# Recovered base-player lifecycle witnesses

The interrupted `2ddb7fc9` work retained two exact legacy source companions: five faction reset/continuation cases
(1,146 ordinary 50 ms steps) and one Axe/Shred reset/continuation case (229 steps). Their 17 capture, harness,
provenance and companion README files are copied byte-for-byte from that preserved recovery commit. No capture output
was regenerated or normalized in this integration. The original companion READMEs contain the pinned source capture
commands and corpus hashes; fresh source/protected-file metadata verification remains a coordinator gate.

The native consumer reuses the current actual constructor, validated inputs, ordinary tick runner and checkpoint
restore. New runner support executes the declared `untilTeleport` timer boundary and the explicitly declared source
`healProbe` helper. Expected snapshots remain assertion inputs. It compares all five faction states and delayed
signature-hit flushes, the Axe's cleared status with retained armor cache, restore/continuation hashes and private
observation boundaries. The full abilities test also invokes both companions.

The recovered runtime replacement and its base-player-only Source admission validator were not imported. Current NPC
reset, healing cleanup, card support, hook order and broader lifecycle admission remain in their existing owners.
Synthetic stale-reset rejection checks that depended on that obsolete narrow validator are excluded; ordinary
source snapshots, canonical modifier rejection checks and reset/restore/continuation assertions remain intact.

The real Sentenced sequence exposed a retained corpse checkpoint after its dead player was removed. Validation now
requires that corpse identity to exist in the retained roster, and requires Dead when the player is still present.
This admits the state the ordinary producer/removal path already creates.

`HitWindow::reset` clears its fight history while retaining storage. Raid-start and the existing all-fighter teleport
reset preserve that owner. A test reads capacities immediately before and after an actual timer-driven teleport after
real weapon landings: history clears but capacity stays. Removing this preservation is killed by the test (capacity
0 versus the warmed 4). The restored implementation passes again.

The headless replay and warmed post-reset allocation scenarios explicitly disable consumables: these bounded player
reset profiles install no wind module. This avoids measuring a newly spawned wind prop during the allocation sample.
The first cold arena transition remains diagnostic; only the warmed post-reset combat/observation sample asserts zero.

Private verification on the integrated source archive:

- `cargo test -p rh-sim --lib player_lifecycle --features trusted-status-probes --locked`: three tests pass.
- `cargo test -p rh-sim --test player_faction_reset_no_alloc --features trusted-status-probes --locked`: one test passes,
  covering all five factions with zero allocations in each warmed sample.
- `cargo test -p rh-headless --test player_faction_reset --locked`: one test passes, covering all five public seats,
  genuine timer teleports, checkpoint hashes and byte-identical replay hashes.
- Capacity-dropping mutation: the real teleport capacity assertion fails; unchanged control passes.

Verification used the coordinator's already repaired policy perception and headless determinism config files as local
build prerequisites. Those unrelated repairs are excluded from this patch. No shared status records, Cargo.lock,
protocol identities or global hash tapes are changed here. This is bounded source/player lifecycle coverage, not
certification of the five still-pending full source-born NPC Wish cases or full public Wish transport.
