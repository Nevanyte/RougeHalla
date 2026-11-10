# Backend / Unity branch union — read-only readiness audit

**Disposition: concrete merge decisions identified; no merge, identity reservation or combined-artifact admission.**
Read-only git/source audit on2026-11-10. No Rust edits, tests/probes/captures, AWS action, merge, permission changes,
or Claude/DeepSeek contact. Only this NEW evidence document is written; prior audits and active worktrees are preserved.
Any Claude coordination remains after17:30UTC/10:30 Edmonton, under Root's instruction.

## Inspected cuts and scope

| Tree | Exact inspected identity/state |
|---|---|
| Primary `feature/unity-rework` | `feaae8e474b857bb03515913d95d6fde913c8e1a` at `/Users/nevinmckinnon/Documents/Projects/RogueHalla`; ONE uncommitted generated `client-unity/UnityProject/Assets/Scripts/BakedContent.cs` edit. Not a clean final artifact. |
| Admitted backend integration | `770a424a4c3c7311162fe3bde8453f3216f3b65a` at initial read (after Root's stated `a5642976`; documentation updates), `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests`. |
| Card | WIP on `03ec330be74d695ee6034def69c1cb5df72e7b34`, `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-card-bleed-feedback`; not sealed/admitted. Capacity/evidence follow-up remains separate. |
| Actual committed merge base, primary versus backend | `61f9f15f3c97c961c0e7c5e16920d34785d7741d`. |

The older4151b3af comparison is useful history, but is not the actual merge base. Do not interpret a direct
primary-versus-backend diff as deliberate deletion of every backend improvement. The actual-base shared-file/blob
inspection found ledger.rs, weapons.rs, fighter_churn_tests.rs and systems/mod.rs already IDENTICAL between the
committed primary/backend cuts. The mid-pass zombie/fighter-churn crash fixes must remain, but do not require another
implementation or manual duplicate port. Primary's `a1f1d129` and `2bfdc57b` already contain the corresponding fixes.

## 1. Identity collision needs a union identity, not a lucky clean merge

| Identity | Backend admitted | Primary hitboxes | Card WIP |
|---|---|---|---|
| Protocol |14|16|14|
| Checkpoint |29|30|30|
| Replay |23|24|24|
| Observation |21|22|22|
| Policy contract |15|16|16|
| Content golden / tape metadata |`8edd862f48ffa100`|`026f083d8473fa4b`|`fa16f195dc22ef69`|

Verified actual constants: primary `rh-protocol/src/lib.rs:176`, `rh-sim/src/checkpoint.rs:23`, `replay.rs:11`,
`observe.rs:20`, `rh-policy/src/lib.rs:38`; Card corresponding constants are30/24/22/16 with unchanged wire14.
Both internal branches used30/24/22/16 for DIFFERENT schema/knowledge semantics. A textual merge may report no
conflict on those equal literal edits; that is not semantic compatibility. Root must reserve a distinct combined
checkpoint/replay/OBS/policy identity after rechecking the final cuts. Natural next values are31/25/23/17 if still
unused, but this review does NOT reserve them. Preserve fail-closed old-format/content/contract rejection.

Primary wire16 carries archetype identifiers/table and the Welcome vision block. Card adds no new WireEvent shape
and deliberately emits the existing Hit after eligibility/round/cast guards. Therefore union alone gives no reason
to change wire16 to17. Preserve primary16 codec, negotiation, scene-candidate/archetype/vision support; verify the
existing v16 Rust/C#/JS vectors on the final combined tree. Only a further incompatible wire change would need a new
protocol/vector generation decision. Internal observation/policy semantics still need their distinct union versions.

Exact identity/pin consumers to reconcile are `rh-sim/src/{checkpoint,replay,observe,fighter,content}.rs`,
`rh-policy/src/lib.rs`, `rh-sim/tests/{checkpoint,replay,content,hash_coverage}.rs`,
`rh-sim/src/reward_chests/trophy_observer_tests.rs`, `rh-sim/src/systems/sentenced/npc_tests.rs`, and
`parity/abilities/hash-tape.json`. Update literal assertions/docs only to the final reserved identity; retain both
branches' actual validation/hash coverage. Do not use an arbitrary old content golden or hand-edit native fold answers.

## 2. Exact runtime and shared-file union decisions

| File/hunk family | Required composed behavior |
|---|---|
| `rh-sim/src/state.rs` | Keep primary footprint-based Path methods, Player constructor mode/archetype assignment and ProjectileLaunch.height; ADD Card's World.card_bleed leaf/default. Those are separate state, not alternative models. |
| `rh-sim/src/sim.rs` | Keep Player::joining(...config.hitboxes). Preserve Card cold preparation at constructor/Clone/reset_active and fresh projector identities. No constructor path may skip mode assignment or Card reserve/rebuild. |
| `rh-sim/src/fighter.rs` | Keep archetype/hull/foot accessors and stored core row, plus the final composed checkpoint doc identity. |
| `rh-sim/src/checkpoint.rs` | Keep primary archetype assignment/mode and projectile valid_height checks; add Card B3/report/pending-event invariant audit and cold preparation. Neither branch's accepted restored domain is replaced by the other's. |
| `rh-sim/src/systems/mob_checkpoint.rs` | Combine primary expected-birth Mob constructor's extra hitbox-mode argument with admitted earned-Hemorrhage exception and its bleed_tests module. Preserve Blaze/generic validation and the finite/fractional-clock producer addition check. Primary currently lacks the NPC bleed exception. |
| `rh-sim/src/observe.rs` | Keep primary self/player/mob archetype fields, height-aware test literals and views; keep backend observe_with_tiles/NPC tile-cache path and compatibility wrapper; ADD Card raw Event omission and final OBS identity. No whole-file ours/theirs. |
| `rh-sim/src/item_view.rs`, `vision.rs` | Retain backend tile-cache reuse and nonfinite-point fallback/npc_cache_tests. Add primary vision/golden registration and retain its Welcome vision constants/projection chain. A source diff showing the older direct point loop is not authority to discard the admitted cache. |
| `rh-sim/src/systems/frost.rs` | Both cuts already contain the late-born attack_started safety path. Preserve backend short-circuit ordering in after_damage: signature/target/identity gates before pure structural_source. Primary still evaluates structural_source first. This is the retained backend performance hunk, not another crash repair. |
| `rh-sim/src/systems/{ledger,weapons,mod}.rs`, fighter_churn_tests.rs | Committed primary/backend blobs identical. Union once. Card adds ONLY its separate module registration to systems/mod.rs, preserving existing fighter_churn_tests registration. |
| `rh-sim/src/content.rs` | Keep primary hitbox-archetypes/1 progression visitor and its visitor count; also retain Card card-bleed-feedback/1 marker/definition visitor. Compute the combined hash from actual code. |
| `rh-sim/tests/{content,hash_coverage}.rs` | Union hitbox geometry/height/mode validated leaves and constant registrations with Card derived-index serde-skip/representation registrations. Golden is regenerated after real source comparison, not picked from either branch. |
| `rh-headless/examples/source_soak.rs`, tests/source_arena_soak.rs | Preserve existing churn seeds and deterministic checks while retaining primary's LegacyCircle/Archetypes mode parameter and extra archetypes test. Both-mode coverage is additive; do not replace one branch's test with the other. |
| Card-only report/projector/hooks | Preserve strict tagged trusted B3, checked exact viewer sums, entitlement/redaction before errors/grouping, actual f64-to-f32 guard, raw Event server-only treatment, Q+T0 bounds and cold reserves. Primary adds no replacement Card engine. |

Card and primary both touch these exact tracked files (in addition to the semantic interactions above):
`rh-policy/src/lib.rs`; `rh-sim/src/{checkpoint,content,fighter,observe,replay,sim,state}.rs`;
`rh-sim/src/reward_chests/trophy_observer_tests.rs`; `rh-sim/src/systems/{mob_checkpoint,mod}.rs`;
`rh-sim/src/systems/sentenced/npc_tests.rs`; `rh-sim/tests/{checkpoint,content,hash_coverage,replay}.rs`;
`parity/abilities/hash-tape.json`. Card raw digest/canon arms are new backend changes; preserve the private tagged digest
and bounded old-corpus omission, never route raw Card totals into observation or public wire output.

Primary Pathfinder accepts `impl Into<Footprint>` (`pathfind.rs:227-247`) and preserves the legacy radius adapters
(`447-459`). The admitted private borrowed-budget service still calls the same radius12 path core. There is no
observed need for another policy path refactor merely to compile with hitboxes; verify it as composition, do not
silently change legacy private source witnesses to fighter-box paths. Fair live/private Brain activation remains a
separate gate and cannot be inferred from new public archetype/vision fields.

## 3. User-requested new live hitboxes are NOT the current default

Primary `crates/rh-server/src/runtime.rs:24-30` explicitly leaves LIVE_DEFAULT_HITBOXES=LegacyCircle. Parser33-43
supports `--hitboxes legacy|archetypes`; Settings::sim forwards the selected mode at190. core_hitboxes50-59 uses the
live default for --first-playable and keeps no-runtime/--runtime core as the legacy development default. SimConfig's
own Default also remains LegacyCircle (`rh-sim/src/statics.rs:243-246,282`), intentionally preserving parity/headless.

The morning bootstrap currently supplies Source min1/fill8(total target)/max1/lobby10/fill3, and Training min1/fill0/
max1/zero timers; neither adds a hitboxes override (`hosting/technical-demo/bootstrap.py:213-216`). On this primary
that means LegacyCircle. Earlier browser hitbox evidence explicitly used --hitboxes archetypes, not a default launch
(`docs/rework/evidence/hitbox/README.md:3-5`). It cannot prove a default flip or this future combined artifact.

Root confirms the user wants the new hitboxes as the LIVE default. After17:30UTC, resolve that on the exact combined
artifact with Claude/Root's allocated scope; a host-only explicit override is a temporary mode selection, not fulfillment
of the global default request. Preserve explicit legacy override and bare-core/default legacy behavior. No unsupported
flag is added to the current backend protocol14 runtime here.

Actual test updates are broader than the primary comment's “two-line change”:

- which_runtimes_default_to_which_hitbox_mode at263-284 pins its local live=LegacyCircle.
- hitboxes_take_effect_on_the_core_path_too at285-313 also expects LegacyCircle for --first-playable by default.
- every_runtime_defaults_to_the_legacy_circle_and_archetypes_opt_in at316+ pins Source and Training LegacyCircle.

Change only the intended live-default expectations/name and exact constant under a later allocation; retain both
supported overrides, invalid flag rejection and bare core behavior. No blanket SimConfig default flip that would
rewrite the legacy source/parity contract.

## 4. Static identity edits versus actual combined proof

Internal version literal updates/serde-skip inventories are bookkeeping, not proof of behavioral composition. Existing
component receipts bind their own branches. For the later combined build, Root needs the following concrete seams:

1. Frozen ability source63 must actually pass under explicit/default LegacyCircle with BOTH hitbox schema and Card
   state present. Frozen Card7/390 and the admitted NPC earned-bleed restore/continuation controls must likewise remain
   intact. Do not recapture legacy source or alter its expected gameplay to make archetypes look legacy-exact.
2. Preserve primary foot/body/inside-target projectile/homing and mode-valid-height restore checks and the uniform
   player chest30 C-OBS rule (`archetype.rs:108,205-216`). New archetypes are an intentional mechanic, not claimed old
   circle parity. A focused real earned-Hemorrhage/restore and Card projection composition in the selected live mode
   is the relevant union seam; old legacy-only receipts do not themselves attest new-mode reach. Use actual accepted
   producers; no installed completion/status or expected output. Root chooses exact focused controls/leases.
3. After those source/runtime facts are sound, Root separately authorizes the existing native ability recorder on the
   final union tree, then its checker and content golden/full hash-leaf admission. The three existing tapes are
   different derived native products, not candidates to hand-merge. No source fixture/recorder/checker edits or fold
   substitutions. Retain first failures and truthful final commands/exits; unchanged private Memory-heavy tests need
   not be repeated merely because a metadata literal moved.
4. Exercise the selected Source/Training default/parser and existing churn/restore/geometry/public projection seams
   against final code; scoped strict default/all-feature lint/format and required compile/checkpoint/hash gates belong
   to that composed cut. No combined green result is inferred by this static audit. Existing final source/native
   admission packets still govern their own unfinished evidence (Card capacity; active private Brain; Quest delivery).
5. Check actual v16 Rust/C#/JS decode vectors and the final client prediction/aim/raised-projectile/Welcome vision
   binding. Refresh generated client content and launch manifest from the final binary, then exact runtime/map/flags/
   browser proof; this is later joint integration ownership, not work authorized here.

Public progression/content identity currently differs on all trees. Primary's committed BakedContent still has the
old7c6a633f68c2cc72, while its uncommitted generated edit is026f083d8473fa4b (hitbox-only content). Card's current
content isfa16f195dc22ef69; neither is the future union. `client-unity/UnityProject/Tools/build-web.sh:6-17` reads
/info contentHash and emits BakedContent. Preserve the user's/Claude's uncommitted file and regenerate through the
actual final build workflow later; never silently commit the dirty value as a union hash. Hosting's strict protocol/
content identity configuration, /info, runtime/map bytes and immutable artifact checksum must all describe the actual
same merged binary/client. The current hosting script's protocol14-era evidence is not a final protocol16 artifact
validation, though its isolation/budget/expiry/strict-type logic is independent and remains unchanged.

## Minimal integration order after the handoff time

1. Re-read exact clean/dirty tips, active worker seals and identities with Root; preserve primary's uncommitted bake.
   Finish/admit Card first (and any other ready backend seal) on the isolated branch. No WIP production transplant.
2. Form one isolated union from actual merge base; apply the hunk decisions above, preserve both definitions and
   validation sets, reserve distinct union internal identities, and allocate the exact live-default correction.
3. Run real combined source/runtime gates, then authorize derived native identities/goldens and verify them once on
   that final code. Retain separate LegacyCircle parity and Archetypes live behavior claims.
4. Coordinate final client/codec/artifact generation and exact launch proof after17:30UTC. Freshly revalidate flags,
   content/map/protocol/hash and expiry before any later deployment. This audit grants none of those mutations.

Already covered elsewhere and not reopened: Card B3/numeric/privacy design and independent capacity HOLD;
NPC producer-shaped restore admission; F0/F1 fair bot provider/activation gaps; Source/Training fill/expiry hosting
preparation; existing v16 client hitbox/vision evidence. Their scope limits persist. ADR0025 lingering tracks is design
only at51cf1c35 and does not authorize adding another runtime mechanic to this union.
