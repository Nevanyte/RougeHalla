# First-playable staging map

`first-playable.json` is a new hand-authored, admitted `rh-map/2` input. Its native map hash is `0252d18b`; it is not a captured generated-map parity answer. It reuses the metadata conventions of the accepted small source-map and initial-loot fixtures. The original design/proof manifest is `cdeb336a0ed8cad28ccfd0c04c492b717c2d60f99c6ab50c1fc34945eb14a33c` in the private first-playable-map handoff.

The 48×40 tile map has eight separated exterior spawns, eight real potion-crate spots, 48 ground-loot opportunities, a central coliseum and four mob spots across Fire, Plague and Holy camps. Required Frost/Sentenced metadata records have no spawns or camps. Initial loot and private reward/main random streams execute normal constructors; the map specifies no resulting items, IDs, counters, HP or card grants.

Opt in explicitly:

```sh
cargo run -p rh-server -- --first-playable --bind 127.0.0.1:7777
```

The binary embeds this exact map, enables `initial_loot`, `MobMode::Pve` and `EngagementHolyPlagueFire`, and retains the existing eight-seat admission cap. `--map` cannot override this profile. Seat overrides require whole values: `--min-players 1..8` and `--fill-bots 0..8`; defaults remain 2 and 0. Lobby/fill durations retain defaults 30s/5s and accept finite nonnegative seconds. For one human and a normal existing bot seat, use `--min-players 1 --fill-bots 2`. Bots remain existing Brawler content. Without `--first-playable`, the prior foundation/default map and simulation settings are unchanged.

The service automatically starts its existing graceful drain four hours after process entry. An independent watchdog stops the process by four hours plus 180 seconds regardless of control/signal/drain state or unfinished matches/writes. Pending durable writes depend on the existing configured result-spool recovery; this profile adds no outcome or recovery policy. Production hosting must restart/drain within this lifetime. This is an operational capacity constraint, not a match time limit or a gameplay-rule change.

Conservative map budget for that lifetime: at most 82 camp waves × 4 mob weapon units + 48 possible constructor weapons + 16 player-slot units = 392 weapon units. Counting 8 crates + 48 ground containers + 8 bodies + all 392 loose weapon units gives 456 prop containers, deliberately double-counting some items. At most 12 actors are simultaneously present for eight seats. Both fit the existing 512-view bounds. Up to three initial stat offers and one elite offer can coexist. There is no infinite-lifetime accumulation claim.

Run the normal public-policy smoke with private outputs:

```sh
cargo run -p rh-headless --example first_playable -- maps/first-playable.json /tmp/first-playable-report.json
```

The six-seat smoke uses ordinary headless construction/joins/start and public policy inputs. The small wrapper chooses delivered chest handles, picks each public prop position once, uses owned potions and delegates combat to Brawler. Private constructor/payment facts are observed only for evidence and never supplied to a policy or HUD. The recorded input replay and terminal checkpoint must reproduce the final hash. Reports and the adjacent `.private.json` replay contain synthetic server evidence and must not be published as player observations.

The integrated smoke terminates normally at tick688 (34.4s), with three PvE kills, two cleared camps, three stat boosts and seven potion pickups/uses. It does not acquire an augment before ending. A separate retained earlier ordinary-input run acquired Siphon but truncated because its first proof wrapper repeatedly picked bodies; that is not represented as a finished match. This is a bounded native smoke, not the browser milestone, a benchmark or a full-default legacy-assembler parity claim.
