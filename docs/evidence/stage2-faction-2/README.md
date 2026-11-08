# P-FACTION-2 — Fire roam (DONE-VERIFIED)

Phase: stage 2, wave 3, the backlog packet [P-FACTION-2](../../backlog/README.md) row ("Fire roam"; deps P-FACTION-1
and P-STATUS-1, both landed). There is no P-FACTION-2 packet file: the scope here is the actual legacy
`packages/server/src/sim/fireRoam.ts`, `packages/shared/src/fireRoam.ts` and `docs/FIRE_ROAM.md`. Branch
`deepseek/p-faction-2`, based on `origin/deepseek/p-mobs-1` at `039ceb47` (line A, protocol 7); the PR is stacked
on `deepseek/p-mobs-1`.

Pull request: [#44](https://github.com/Nevanyte/RougeHalla/pull/44), stacked on the P-MOBS-1 PR #41; commit range
`039ceb47`..`6973f1bb` on `deepseek/p-faction-2`. Ledger row:
[`docs/evidence/deepseek-rust/PROGRESS.md`](../deepseek-rust/PROGRESS.md).

## What was missing (checked from the code, not memory)

At `039ceb47` the schedule still held **eight pending rows** labelled `P-FACTION-2` — the whole Fire roam module:

| row | position |
|---|---|
| `fireRoam.update` | `SYSTEMS[0]` (the source `world.systems.unshift`) |
| `fireRoam.roamingSpeed` | `MOD_SOURCES` 5th fold row |
| `fireRoam.onAttackStarted` | `ATTACK_STARTED` 3rd link |
| `fireRoam.<arrow>` (hurt) | `HURT` 2nd link |
| `fireRoam.<arrow>` (raidStarted) | `RAID_STARTED` 13th link |
| `fireRoam.<arrow>` (runEnded) | `RUN_ENDED` 12th link |
| `fireRoam.<arrow>` (fighterOut) | `FIGHTER_OUT` 7th link |
| `fireRoam.onHitLanded` | `HIT_LANDED` 2nd link |

No Fire roam constant, runtime state or consumer existed in `rh-sim`, and nothing installed the legacy auxiliary module
in the partial foundations. `docs/FIRE_ROAM.md` is stale where it disagrees with the code (owner question, below).

## The ported consumer

New `crates/rh-sim/src/systems/fire_roam.rs`, one module for the legacy module, wired only through the flipped rows
(`schedule.rs`, no reorder, C-TICK):

1. **Ramp and arm state** — `Roam { last_combat_at: Option<f64>, ready: bool }` on `Player` (hashed and
   checkpointed; the source's private `lastCombatAt` map plus the synced `roamReady`). `update` (`SYSTEMS[0]`)
   mirrors the source exactly: a non-Fire, non-alive or non-active seat resets to default; a Fire seat seeds its clock
   to now on the first tick and marks the burst ready once the elapsed out-of-combat time reaches `FIRE_ROAM_RAMP_MS`
   20 s. The synced `roamCharge` mirror is **derived** from the clock for diagnostics (`Sim::fire_roam`) and is not
   stored twice.
2. **Movement scaling** — `roamingSpeed` is the source's mod source (the fold row after `cardHooks.cardSource`): it
   returns `speedMult = 1 + 0.5 x charge/1000` for a live Fire seat in an active run, folded into the mirrored walk
   speed exactly as the source does. The source's own comment ("runs before sim/mods.ts so the movement mirror folds the
   current charge in this tick") is preserved by the row position: `update` first, the mirrors last.
3. **Armed identity and the charged burst** — the source keeps a `WeakMap<DamagePacket, owner>` armed at
   `attackStarted` and consumes the burst on a landed direct weapon auto. The port reproduces the identity with the
   packet-owner mark: `PendingAction.roam_armed` is set at the same hook (Fire, alive, active run, `ready`), copied
   by the existing packet value into the melee request or the projectile (`Projectile.roam_armed`), and read at
   `hitLanded` (projectile entries resolve their flight by `Entry::projectile`; a melee auto starts and lands in the
   same weapons phase, so its owner's current armed flag *is* the start state). A whiff, block, DoT tick, signature,
   ability, passive or derived entry can never consume it, a reflected flight is never armed, and one multi-target swing
   consumes it once (the source's own semantics).
4. **The burst** — `50 + 0.4 x bonus Offense`, physical, as an independent plain single-target entry with
   `weapon: null`, `derived: true`, `scale: 1`, deferred to the next tick's ledger (`World::deferred`, the source
   `deferHit`). It takes normal victim mitigation, PvP rules and outgoing rows; it repeats no on-hit effect.
5. **Resets** — a positive hit the Fire seat deals or takes restarts the ramp (never the armed flag, as the source
   documents); `raidStarted` seeds every seat's clock to now, drops every arm and replaces the source's armed-packet
   map; `fighterOut` forgets one seat; `runEnded` clears every seat. There is no `teleported` Fire roam link in the
   source, so none is added.

## Installation, gates and identity

Legacy installs the Fire roam auxiliary installer together with `installFactions` under `signatures: true`; the
partial capture worlds name their module list instead. To keep the recorded schedule honest, the port adds:

- `Gate::FireRoam` + `Gates.fire_roam`: the row's legacy condition. Production and training gate sets have it on
  (the source installs the module there); the capture, Holy-foundation and mob plans have it off.
- `FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam`: the explicit partial foundation that also installs the
  auxiliary module (the same pattern as the existing `Engagement*` levels: unimplemented installers never silently
  activate). `Plan::of` compiles the new gate set.
- The content registry gains the five source numbers (`FIRE_ROAM_RAMP_MS`, `..._MAX_SPEED_MULT`, `..._CHARGE_MAX`,
  `..._BURST_BASE`, `..._BURST_AD_SHARE`) and `content_hash` moves to `0x617dcdfa27c0e3e6` (the coordinator
  updates the shared status records; none edited here).
- The serialized world layout moves: `Player.roam`, `PendingAction.roam_armed` and `Projectile.roam_armed` are new
  checkpoint fields, so `CHECKPOINT_FORMAT` moves `rh-checkpoint/20` -> `/21`, `checkpoint.rs` validates the roam
  clock (in `0..=server_time`) and the two arm marks (a present owner's arm is only a Fire seat's), the hash-coverage
  `VALIDATED` list documents the two refusals, and the Rust-only ability per-tick hash tape is re-recorded on this
  branch (its cases unchanged in tick count; see the tape note; no legacy corpus was regenerated).
  `Runtime.source_speed` records the folded source speed product so a restored mirror is re-validated against the exact
  source contribution.
- **No wire change**: `roamCharge`/`roamReady` are the legacy synced mirrors, but this slice (like the accepted
  P-FACTION-1 slices' omitted signature bits) keeps them out of protocol 7 and leaves the Unity HUD mirror to the
  presentation slice; the authoritative movement is replicated through positions and the burst through damage. The lead's
  wire rule was conditional on touching the wire — this slice does not, so the base stays `deepseek/p-mobs-1` (line A,
  protocol 7).

## Owner question (backlog README item 10)

The backlog lists "Fire roam scaling: AP (docs/FIRE_ROAM.md) or bonus Offense (legacy CLAUDE)". **Code wins and is
unanimous**: `shared/fireRoam.ts fireRoamBurstDamage(offense)` adds `0.4 x bonus Offense` and its comment says "The
charged burst is physical"; `sim/fireRoam.ts` reads `adOf(owner)` and sends `{phys: 1, magic: 0}`; the merged kit
pass (`95cc68a0`, "Fire roam burst is physical off Offense") confirms it. `docs/FIRE_ROAM.md` line 7 ("raw magic
damage", "50 + 0.4 x AP") is stale. This slice implements the current legacy behaviour (physical, bonus Offense) and
flags the doc for the owner; nothing is guessed.

## Captured legacy fixtures (pinned container only)

All captured in the established pinned Linux x64 Node 22.23.4 container (image `c86ecead9e55`, the
`v22.23.4-linux-x64` prefix at `/node`, a read-only `/repo`) by `tools/fire-roam-fixtures/capture.sh`. The
probes/scripts are ordinary actual-source imports; `packages/` was byte-unchanged from the accepted baseline during
the capture.

- `parity/fixtures/fire_roam_charge_burst.json` (sha256 `f2dc90b0...`): 480 ticks. Fire roams 20 s out of combat
  while walking early (charge-scaled movement), reaches `charge 1000 / ready` at tick 401, and a landed sword auto
  consumes the burst as the next tick's derived physical hit; a later hit cannot repeat it.
- `parity/fixtures/fire_roam_ranged_arm.json` (sha256 `acab24a7...`): 470 ticks. A bow draw begun one tick before full
  charge is **not** armed even though its arrow lands after the ramp completes and finds `ready` true — the source's
  exact start-time arming rule; the next draw, started while armed, lands its burst across the arrow's flight.
- `parity/fire-roam/helpers.json` (sha256 `c84a30a3...`): 34 direct actual-export cases of `fireRoamCharge`,
  `fireRoamSpeedMult`, `fireRoamBurstDamage` and the five constants, including 19.999/20/20.001 s, 0/1000/5000
  charge, negative clamp and the Offense scale.

The fixture records the canonical `roam` diagnostic stream (per player, in join order: the synced `charge` mirror and
`ready`), verified from the real legacy `PlayerState.roamCharge`/`roamReady`, in addition to the shared faction
diagnostics (`raw` ledger, `landed`, `dotSince`, buckets, fighters, performed requests). `requires` cover the real
hits (and the arrow launch in the ranged trace).

## Tests and gate

- `crates/rh-parity/tests/fire_roam.rs`: both traces compare every one of the 950 ticks and restore/continue every
  tick; missing/extra/mutated `charge` or `ready` fails; a swapped module order, a different `rustSlice` and another
  packet each fail the provenance checks.
- `crates/rh-sim/src/systems/fire_roam.rs` unit tests: the captured actual-export helper fixture matches the Rust
  helpers and constants exactly, plus the ramp/burst boundaries.
- `crates/rh-parity/tests/schedule.rs`: 14/14 — the eight rows are flipped in place under the new gate and all three
  recorded worlds still match the legacy record.
- `cargo test --workspace --all-features --locked` (throwaway pinned PostgreSQL): **1,434 passed, 0 failed, 3 ignored, 152 test binaries, exit 0**.
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`: **clean, exit 0**;
  `cargo fmt --all -- --check` clean.

## Remaining / not in this slice

The client HUD mirror (`roamCharge`/`roamReady` on the wire + Unity) is deferred with the other signature-presentation
work; the auxiliary-module activation pattern here is the one P-FACTION-3/4/5 can reuse for Plague corpses/zombies, the
Sentenced hunt and bruiser passives, and the five full five-faction source-born cases still outstanding from P-ABIL-1
remain their packets' work. No `docs/MIGRATION.md`, `docs/CONTRACTS.md` status table, `Cargo.lock` or `packages/`
edit; no `DEVIATIONS.md` row; no merge.
