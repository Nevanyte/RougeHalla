# P-STATUS-1 native review handoff — acceptance pending

The private implementation is based on d1027eac93be54ec9e37435ab71c2e97a3aafdc9 with the accepted stat-fold leaf module from 7f294cc7. Only the coordinator applies shared seams. No live edits, Cargo.lock, Unity, protocol codec, AWS, dependency or ML changes were made. The coordinator's later placement commit 25aca1ed is not copied into this private archive; shared patches must be applied serially, preserving placement changes.

## Runtime ownership

`status_runtime` owns the fourteen-kind ordered rule/instance table, exact effective string keys, sparse payload presence, readers and typed source snapshots. FighterCore holds the sole generic table (including axe shred), encoded attack-rate mirror and card-owned DoT critical accumulator/tick cache. Existing stagger/root_until/Frost/immune_until owners remain distinct. Source names and IDs are retained snapshot facts; refresh does not consult current roster names. Source Some IDs and owner IDs must be in retained roster at restore; None means the empty source identity, never arena damage. The old source999 refusal remains, including with an elevated next_id.

`systems/status` runs actual lifecycle, cast-fact cancellation, reveal, movement/mod sources and generic DoT. Cast production remains pending P-ABIL. `systems/fields` and `systems/displace` operate on real World state and reusable pathfinder. A single FIFO contains ordinary typed payouts and private displacement requests. Its drain has the current pathfinder/map and current modifier borrow. Nested ordinary effects execute immediately while collecting is false. Explicit next-tick deferred hits remain separate. Checkpoint serialization refuses collecting/nonempty same-tick FIFO; settled representation has no serialized scratch queue.

All modifier recompute triggers reuse one body for currently owned attack and armor mirrors, using accepted stat_fold codecs. Current ordinary provider is neutral because card/buff producers are not ported. Trusted nonneutral values are borrowed only through the explicitly enabled harness; no fixture recipe/view is stored in World, MatchStatic, checkpoint, hash or ordinary Sim configuration. DoT criticals use source accumulator/tick cache and zero PRNG draws. Actual heal/afterDamage consumers handle antiHeal, healTaken, regular/dot/farm lifesteal, and suppression cut restoration.

A DoT ledger row keeps an optional Arc-backed source snapshot independent of status lifetime; old weapon rows retain None. Entry became Clone in mechanical queue/slice transfers. `by` and source.id consistency is checked at restore. Snapshot name survives source departure and reaches kill attribution; explicit dot/ability/arena facts are separate. No status-index pointer survives table mutation.

## Harness and admission

Enable `trusted-status-probes` explicitly. `status_runtime::probe::Harness` owns closed trusted operations, observer trace, borrowed stat inputs and Hurt recipes outside Sim state. Normal step uses the same registered bodies/order with no recipe or override. Input operations call validate then Sim::submit literally. Genuine remove_player events are immediately folded into source-visible event order and consumed once at the next step. A feature-only fixed two-child payout models one source closure in the real FIFO; no recursive production sequence API exists.

`rh-parity`'s status-probes bin rejects recursive duplicate JSON keys, extra CLI arguments, missing versus null fields, unknown nested members, unsafe narrowing, invalid finite inputs, malformed enums/IDs and wrong case/source inventories. Whole-file preflight occurs before any Harness construction, including cases outside a selected filter. Expected initial/before/after values are assertions only. Setup input + operations are the only execution inputs. The metadata file binds source provenance/case names/factory seeds and salts; it contains no expected mechanic results.

The frozen v1/v2/v3 corpus is 80 cases: 79 real Sim/harness cases, plus one explicitly separate mob/quest role-admission leaf proof. That leaf uses the same rule/readers and does not claim native mob storage, gameplay, continuation or policy support. V3 supplies four separately frozen goal/collision/healTaken/farm witnesses. Existing freezes remain untouched.

## Compared projection and explicit scope

Every step compares ordered full status tables and payload presence, source snapshots, vitals/immunity/effects, body/path/history/slip, full owned weapon/lock state, attack/armor mirrors, owned cast facts, critical accumulator/cache, ordered fields and schema mirror facts, DoT buckets/clocks, entity counter, ledger/deferred/landed facts, returns, events, ordered hooks, actual callback outcomes, collection/FIFO cardinality and RNG continuation. The source full-world snapshot remains preserved evidence alongside the strictly typed bounded projection.

Excluded or normalized facts are explicit:

- Full cast rank/slot/target/point/refund metadata and ability spending/landing producers remain P-ABIL. Only ability/start/lands/cancellation facts and their actual status consequences are owned here.
- Source card container absence versus initialized neutral container is normalized to the owned neutral critical triple. Nonneutral accumulator/cache values compare exactly. Card acquisition, hooks, conditional rows and catalogs remain P-CARDS.
- Weapon lastShotAt is pending card-condition memory and is not fabricated as a constant.
- Unowned neutral AD/AP/shield/speed/windup mirrors are not claimed as a complete modifier component; current owned attack/armor plus supplied status consumer arithmetic are checked.
- Suppression cache absence versus empty is normalized to supplied owned suppression rows; unrelated future Mark/card producer caches are not fabricated.
- Source and native factories differ in initial random setup. Scoped operations are verified to consume zero actual draws on both sides, with each implementation's before/after continuation unchanged; no claim of identical cross-factory initial stream is made.
- Explicit arena false and absent arena normalize to the same actual default. Empty source identity remains independently represented.
- Finite negative values and fractional status/reveal times are supported. Native checkpoint IDs/coordinates and fixed tick counter use their actual admitted bounds; synthetic source arbitrary string IDs do not widen serialized provenance.
- The public temporal-report allocation domain is bounded by supported actor/source/ability identity combinations. Arbitrarily many synthetic historical identities/tags are not a full-game no-allocation claim; gameplay tables are not truncated to satisfy tests.

## Public/headless seam for coordinator

SelfView, ActorView and PublicPlayer gain `effects: u16` and `displace_seq: u8`. Observation/PublicSnapshot gain `fields: Vec<FieldView>`. FieldView contains kind, ability, redacted owner/subject, x/y/x2/y2/r/vx/vy, started_at and ends_at. It intentionally has no raw field ID, source snapshot, ownerId, private payload, exit-stun value, DoT bucket identity or cast target. Preserve multiplicity and sort only by fully redacted public values. There is no allocator, global counter handle or target-input requirement for field identity.

Source boundaries: packages/server/src/bots/brain/perception.ts seeFields requires canSee(origin) and, for trails, canSee(endpoint), then visibleId(owner); schema fields and sim/fields.ts bind geometry. Native projection reuses existing native point visibility, not a new vision algorithm. Source bot viewport clipping is not a newly introduced native camera requirement. Source perception.ts hidden effect gate (around610–611) and client render visibility suppress a hidden actor's presentation; current targetability remains a separate current-status reader, so source-timed effects mirrors do not add a stale gameplay concealment gate.

New seen events are AbilityHit(victim, redacted by, ability, amount), CastEnded(id, ability, reason), StatusApplied(id, kind, ms, redacted by). AbilityHit uses the existing private temporal report machinery and per-viewer baseline/redaction; no raw buckets go public. Live/headless/policy share observe(). Full public_snapshot keeps the repository's existing spectator contract; departed field owners are redacted.

Protocol/client support is deliberately not implemented in this private candidate. Observation/policy version bump, wire reach, Rust/C#/JS codecs and golden vectors are coordinator-owned integration work. Checkpoint15/replay13 remain proposals; observation11 is unchanged pending coordinated integration. The new content identity must be folded with the accepted map/kernel owners, never restored to the old aggregate.

## Evidence and remaining review

Source v3 manifest 960c6b962ab85a8982ae7ec1e10e901df8d5f6d5f30ff8c3b36140f41a948a93. Source v1 manifest fbb7481ede19fa31eb4167f20d50b7c3e82f7e2218e2ff943f65d53304cb2313; v2 e3bce45c585aa4a7bddcd4c377ff127c295adb732baa668412669189ef41a523. Native admission audit bb1dc2b4c7ea05fea9e74a4e5e2fb0d48769ae91d760c47ee84061be41f86706; current repairs reject all23 malformed controls, preserving five original passing controls. Source and accepted kernel files remain immutable.

Focused checks already include ordinary axe input/departure/restore; true headless/direct Sim equality; sparse/repeated observation neutrality; all14 trusted prestate continuation; hidden-versus-absent actors; redacted field ordering/multiplicity under actual hidden prop/projectile allocations; settled-FIFO refusal; restored field/status/slip/card/deferred continuation; every newly serialized populated leaf hash sensitivity plus Option presence; and warmed remove/fresh/stale/queued status churn, fields/DoT/FX/displacement, restored warmup allocation tests. Existing ordinary no_alloc passes. Semantic mutant logs bind source file baselines and show successful compile then behavioral failure; every edited file is restored afterward.

The final native bundle binds exact files and logs. Independent review, coordinator integration/broad gates and coordinated observation/transport versions remain pending. This document is not packet acceptance.


## Review corrections and v3 boundary

Machine-readable Run::Partial now retains P-ABIL-1 and names the completed status lifecycle/field/reveal and raid reset callbacks. The dispatcher and trace execute those callbacks at the same source positions. Full ability work is not classified Ported. The staggered cast hook remains Pending.

Geometry admission uses finite squared fourfold magnitude, an arithmetic headroom check for differences, squared lengths and two-term products. This is not a gameplay/map radius cap. It is applied to owned geometry in whole-file fixture preflight and checkpoint field/slip validation. Status magnitudes retain finite negative values, duration/reveal times retain fractional values. Checkpoint status field IDs must be positive and no greater than the run-local allocation counter; removed-field references remain valid. No historical field registry was invented.

The v3 farm recipe is explicitly trusted pre-state: one declared rotMonk count and its byte-bound source reward coefficient are folded through accepted stat_fold. Extra rows use that same kernel, including product-stat lifestealMult, then source getter normalization supplies the borrowed stat view. No grant/acquisition event or native mob progression is claimed. The feature-only map replacement rebuilds MatchStatic from the supplied collision rows while preserving configuration/secrets and actual pathfinder ownership; ordinary maps remain immutable. V3 compares native executed rows/dimensions and supplied modifier sums/readers. sourceMapHash covers additional legacy map layers and is retained as typed source evidence, not a claimed native map-generator comparison.

All owned operation returns, hooks (name/arity/actor wrapper/status facts), events/FX/results and callback results have closed preflight shapes. Unported source actor schema maps such as build/extra/trade data remain explicitly opaque evidence, alongside the full source World. Their contents never supply setup. A pure declared-input reference pass checks direct actor targets and field aliases before constructing any Harness; immutable source metadata identities remain distinct from live actor references.

Native comparison command: `cargo run -p rh-parity --features trusted-status-probes --bin status-probes -- <fixture.json> [case]`. Run all four frozen corpora; output reports Sim and role-leaf counts separately. Production defaults do not install probe recipes or mutable provider overrides. The ordinary axe replay, headless continuation, allocation and restore checks do not rely on an unrecorded hook injection.
