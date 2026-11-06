# First playable Rust core integration

This checkpoint combines the actual selected gameplay producers with the observer and protocol6 delivery paths.
The rebuilt Unity HUD is verified separately in [its integration record](../first-playable-unity/INTEGRATION.md).
One-region AWS staging remains open; this is not full-port or deployment completion.
The owner-selected first-playable scope is recorded in [MIGRATION](../../MIGRATION.md).

## Included behavior

- One shared fighter/combat engine for players and supported regional mobs; NPC AI submits through the normal bounded
  input path. Holy/Fire/Plague signature interactions, camps, rewards and lifecycle use the native authoritative state.
- Actual constructor loot, two carried weapon slots, Small potion stock/healing and first-open stat offers. Initial
  allocations establish the prefix subsequently checked by mob restore admission.
- Slow Burn, Pocket Sand and Siphon plus eight stat boosts, source-ordered choices, reward expiry and private reward RNG.
  A single modifier runtime feeds weapons, defense, movement, HP, healing and signature power.
- Seat-owned pickup/reward handles and NPC references shared by live, headless and policy paths. Current projectile
  positions are filtered by flight-point visibility; hidden owners/private launch IDs do not enter delivery.
- Protocol6 inputs, notices, scalar fields and all seven reliable complete-replacement collections. C# and JS retain
  missing collections and clear explicit empties; pending unsent inputs reset on Welcome.

The genuine source fixtures are in `parity/{cards,initial-world,initial-loot,pve-dot}` and
`crates/rh-sim/tests/fixtures/mob-*.json`. The selected installer profile is deliberately narrower than the complete
legacy world. Weapon-only PvE and the separately captured signature-enabled fights have distinct comparison claims.
The post-terminal source queued-return difference is retained in the signature handoff; active combat agrees through
normal termination. This does not close the full P-MOBS-1 or other deferred-content acceptance packet.

## Integration repairs

The coordinator preserved actual loot storage when merging PvE checkpoint admission, rejected depleted unopened
constructor crates and altered constructor birth ticks, and preflighted unsupported reset placements before joining
any seat. Default PvE faction selection cycles only supported factions. NPC references reserve the wire's absent-source
sentinel. Content identity folds actual potion/private-stream definitions and supported-faction availability.

Schedule conformance now recognizes the newly executed mob input phase, potion/chest cleanup and Pocket Sand block
callbacks at their existing source positions. Pending fields contain real backlog packet IDs; responsibility prose
remains in the partial row's completed description. No tick phases or source registration lists were reordered.

A PostgreSQL process-recovery test now waits for its final completion diagnostic before killing the child. Its database,
fence, ledger, result and run assertions are preserved; the prior CI failed only because the diagnostic raced the kill.

## Proof and scope

The small-map public-policy run finishes normally at tick688 (34.4 simulated seconds): six seats, zero policy faults,
three mob kills, two camp clears, three boost choices, seven potion pickups/uses and 52 actual healing-payment
observations. Every recorded public-input replay hash agrees, and the terminal checkpoint restores. The preceding
retained run proves Siphon acquisition but truncates; it is not claimed as a terminal run. Map-specific capacity and
runtime admission are documented with the checked-in map.

Engine-independent client checks pass267 C# tests, 15,377 JS golden assertions and61 focused JS assertions. Native
workspace coverage passes1,304 tests (including three compile-fail documentation checks) with two existing manual ignores, both strict Clippy modes and formatting.
Long completed map tests were not repeated after test-only integration repairs. Exact checks and build identifiers
are recorded in [integration.json](integration.json); the actual WSS proof passes all15 checks.

Independent static merged-core and transport reviews are recorded in `REVIEW.md`; individual frozen proposals retain
their focused source/restore/privacy/headless results and exact manifests. No new broad source or load campaign was
added for these integration seams.

NPC references currently renew at20Hz and projectiles are complete current-position arrays, without stable per-flight
identity or extrapolation. One-shot ability/signature/heal telegraphs are not all transported; current HP/status/camp/
projectile facts are available. The Unity HUD/build and actual gameplay socket/UI proof are now verified separately.
The final matched full-port runtime comparison and AWS/TLS/DNS remain open. Cloud resources have not been created; CAD20 total and production-domain
restrictions remain in effect.

The four new canonical source recorders now run through portable, immutable Linux/amd64 Node22.23.4 wrappers and CI.
Each was regenerated and compared once without changing the recorder or expected fixture bytes; the constructor recorder’s
exact source spawn witness is retained alongside it. See [capture portability](capture-portability.json).
The Linux/arm64 Docker server also starts the embedded first-playable map with protocol6/content74192c062ab9eac1.
The Web packaging script retains source asset notices alongside the player. Cloud deployment remains separate.
