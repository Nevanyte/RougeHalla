//! The content registry contract (crates/rh-sim/src/constants.rs, docs in content.rs): every gameplay number is declared
//! once in the `content!` registry, `content_hash` folds all of it, and nothing escapes by living in another file.

use rh_sim::constants::{ContentVal, Entry, REGISTRY};
use rh_sim::content::{
    content_hash, content_hash_of, content_hash_of_rules, staggers, WeaponId, STAGGER_WEAPONS,
};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Types that cannot carry a number, matched against the declared type with whitespace removed: a const or static of one
/// of these needs no entry. Anything else, including every struct-typed const, is scanned and must be registered or listed
/// in NON_GAMEPLAY. (type matcher, why it holds no number)
const NUMBER_FREE_TYPES: &[(&str, bool, &str)] = &[
    ("[Link;", true, "hook chain of the schedule (fn pointers and names), pinned by the schedule conformance test (C-TICK)"),
    ("[Item<", true, "legacy tick/hook/action table of the schedule (names and fn pointers), pinned by the conformance test (C-TICK)"),
    ("[ActionRow;", true, "action table of the schedule (names and fn pointers), pinned by the conformance test (C-TICK)"),
    ("[HookRow;", true, "hook table of the schedule (names and chains), pinned by the conformance test (C-TICK)"),
    ("[Hook;", true, "list of hook names (identifiers)"),
    ("Plan", false, "compiled schedule plan, built from the tables above and pinned by the conformance test (C-TICK)"),
    ("Gates", false, "gate set of a schedule plan (bools: which legacy modules the world has)"),
    ("&str", false, "format tag or name (text)"),
    ("&[&str]", false, "list of names (text)"),
];

/// Every other `const` / `static` in `crates/rh-sim/src` that is deliberately not a gameplay number, as (file, name, reason).
/// The file is part of the key: a gameplay `const DX` or `const ALL` added in some other file is not exempted by its name.
/// Each entry must match a declaration the scan finds and not be covered by NUMBER_FREE_TYPES. Adding to this list is a
/// review decision: a number that can change an outcome belongs in the registry instead.
const NON_GAMEPLAY: &[(&str, &str, &str)] = &[
    ("abilities/source_tests/mod.rs", "PENDING_SOURCE_CASES", "test-only names/profiles/reasons for five explicitly unattempted source cases; no gameplay reads this inventory"),
    ("mob_catalog/mod.rs", "ALL", "the 30 source mob identifiers in wire/training order; full gameplay definitions are registered through DEFINITION and the training source corpus exercises the mapping"),
    ("abilities/source_tests/setup.rs", "PLAYER_COUNT", "test-only source actor identity mapping per executor thread; never read by gameplay"),
    ("systems/terrain/source_tests.rs", "FIXTURE_FNV", "test-only actual-source witness integrity pin; not read by gameplay"),
    ("systems/mob_life/mob_lifecycle_tests.rs", "SEATS", "cfg(test)-only declared seat count of the captured mobile lifecycle scenario; never read by gameplay"),
    ("systems/mob_life/mob_lifecycle_tests.rs", "DIGITS", "cfg(test)-only base-36 label alphabet for comparing captured actor ids; not gameplay policy"),
    ("projectile_view.rs", "MAX_VISIBLE_PROJECTILES", "complete public projectile representation capacity; never read by game rules"),
    ("projectile_view.rs", "PROJECTILE_ROW_BYTES_MAX", "complete public projectile representation capacity; never read by game rules"),
    ("projectile_view.rs", "PROJECTILE_VIEW_BYTES_MAX", "complete public projectile representation capacity; never read by game rules"),
    ("actor_refs.rs", "NPC_REFERENCE_BLOCK", "observer presentation block capacity, not a gameplay number"),
    ("actor_refs.rs", "NPC_REFERENCE_BASE", "disjoint non-reused presentation reference namespace, not a game rule"),
    ("cards/catalog.rs", "ALL", "the 80 source card ids in wire order (identifiers only); the definitions live in the catalog table"),
    ("cards/catalog_data.rs", "DEFINITIONS", "typed 80-card catalog table generated from the accepted source corpus; the gameplay numbers are the registered source constants"),
    ("cards/mod.rs", "SUPPORTED", "the three-card native subset selector (identifiers only), not a game rule"),
    ("cards/mod.rs", "MAX_FOLD_ROWS", "fixed scratch bound equal to the generated catalog's total fold rows, not a game rule"),
    ("modifiers/mod.rs", "MAX_FOLD_INPUT", "fixed fold scratch bound (the catalog rows plus the test-only diagnostic overlay), not a game rule"),
    ("modifiers/mod.rs", "NO_BIT", "sentinel marking a row that owns no while bit, not a game rule"),
    ("reward_chests/pools.rs", "INTERACTIVE", "the source interactive augment id list (identifiers only); tiers and rows are the registered catalog"),
    ("kill_augments.rs", "ALL", "the nine readable investment keys in source order (identifiers only); the UNIT numbers are the registered kill-augments table"),
    ("quests/catalog.rs", "ALL", "the three quest verb kinds in source order (identifiers only); the rows are the registered quests table"),
    ("traders/mod.rs", "ALL", "the two trader kinds in source order (identifiers only); the visitors fold their kind/name/id rows"),
    ("traders/mod.rs", "ALL", "the seven trade stats in source order (identifiers only); the visitors fold their stat/name/flat rows"),
    ("quests/rules.rs", "REFUSAL", "the five source refusal phrases (wording, not numbers); the accept action is not ported yet"),
    ("cards/on_hit.rs", "MAX_ON_HIT_ROWS", "fixed stack buffer bound for the owned on-hit rows; never a game rule"),
    ("cards/on_hurt.rs", "MAX_ROWS", "fixed stack buffer bound for the owned hpBelow rows; never a game rule"),
    ("reward_chests/tests.rs", "FIXTURE_FNV", "cfg(test)-only frozen source fixture integrity; not runtime policy"),
    ("mapgen/style_zones/tests.rs", "CASES", "cfg(test)-only exact source open-case/provenance inventory; never read by runtime policy"),
    ("mapgen/style_zones/tests.rs", "SOURCE_NAMES", "cfg(test)-only exact source open-case/provenance inventory; never read by runtime policy"),
    ("mapgen/pipeline/styled_controls.rs", "INPUTS", "cfg(test)-only exact source input/provenance inventory; never read by runtime policy"),
    ("mapgen/pipeline/styled_controls.rs", "SOURCE_FILES", "cfg(test)-only exact source input/provenance inventory; never read by runtime policy"),
    ("mapgen/pipeline/style_contract_tests.rs", "STATEMENTS", "cfg(test)-only exact source case/statement/provenance inventory, never read by runtime policy"),
    ("mapgen/style_warren/tests.rs", "FIXED", "cfg(test)-only immutable fixed-layout memo used by oracle fixture setup; not a gameplay definition or runtime cache"),
    ("mapgen/style_warren/tests.rs", "CASES", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_warren/tests.rs", "UNITS", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_warren/tests.rs", "SOURCES", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_scorch/tests.rs", "CASES", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_scorch/tests.rs", "UNITS", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_scorch/tests.rs", "SOURCES", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_rime/tests.rs", "CASES", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_rime/tests.rs", "UNITS", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_rime/tests.rs", "SOURCES", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_gallows/tests.rs", "CASES", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_gallows/tests.rs", "UNITS", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_gallows/tests.rs", "SOURCES", "cfg(test)-only exact source case/provenance inventory; never read by runtime decisions"),
    ("mapgen/style_features/tests.rs","FIXTURE_DIGEST","cfg(test)-only byte-integrity guard for the captured helper fixture; never read by runtime algorithms"),
    ("mapgen/style_sanctum/tests.rs","CASES","cfg(test)-only exact genuine source-case identity inventory"),
    ("mapgen/style_sanctum/tests.rs","UNITS","cfg(test)-only labelled direct source-case inventory"),
    ("mapgen/style_sanctum/tests.rs","SOURCES","cfg(test)-only source path inventory for capture provenance"),

    ("mapgen/certify/labels.rs", "LABELS", "human-readable ordered diagnostic wording; numbers in descriptions are never decision thresholds; exact source diagnostic fixtures cover every label"),
    ("mapgen/certify/review_expected.rs", "EXPECTED", "cfg(test)-only independently captured expected failure arrays, never read by runtime decisions"),
    ("mapgen/certify/terrain.rs", "KEYS", "terrain names used only in diagnostic messages, not terrain acceptance decisions"),
    ("mapgen/certify/terrain.rs", "PROP_KEYS", "prop names used only in diagnostic messages, not prop acceptance decisions"),
    ("mapgen/spots/tests.rs", "EMPTY_OWNER", "cfg(test)-only all-zero ownership input for malformed and synthetic crate fixtures"),
    ("mapgen/style_runtime/tests.rs", "OPERATIONS", "cfg(test)-only transcript operation-name inventory; protects fixtures without driving runtime rules"),
    ("mapgen/style_runtime/tests.rs", "ARRAYS", "cfg(test)-only names of compared scratch/layer fields; never runtime tuning"),

    ("mapgen/landmarks/recipes/direct_family/tests.rs", "TRACE", "cfg(test)-only observational transcript storage; not present in production and never drives recipe decisions"),
    ("mapgen/landmarks/recipes/direct_family/tests.rs", "SOURCE_INVENTORY", "cfg(test)-only exact reference-source path/SHA inventory; validates evidence, never drives runtime rules"),
    ("mapgen/landmarks/recipes/direct_family/tests.rs", "CASE_INVENTORY", "cfg(test)-only exact reference-case identity/state-count inventory; not runtime tuning"),
    ("mapgen/landmarks/recipes/direct_family/tests.rs", "SYNTHETIC_INVENTORY", "cfg(test)-only labelled reference-helper identity/state-count inventory; not runtime tuning"),
    ("mapgen/landmarks/recipes/search_family/tests.rs", "OBS", "cfg(test)-only observational transcript storage; not present in production and never drives recipe decisions"),
    ("mapgen/landmarks/recipe_support/mod.rs", "DEFAULT_DEFINITION", "all six shared helper tunables drive execution and are folded by content_hash_of_landmark_support_definition"),
    ("mapgen/landmarks/recipe_support/mod.rs", "DIR16", "fixed bearing encoding, not an independent tuning knob; every signed coordinate is folded by content_hash and source differential tests pin all directions"),
    ("mapgen/landmarks/search/mod.rs", "DEFAULT_DEFINITION", "both search tunables drive selection and are folded by content_hash_of_landmark_search_definition"),
    ("mapgen/landmarks/templates/mod.rs", "WALL", "internal parsed-cell role encoding; source differential proves all role mappings, not a geometry tunable"),
    ("mapgen/landmarks/templates/mod.rs", "FLOOR", "internal parsed-cell role encoding, not a geometry tunable"),
    ("mapgen/landmarks/templates/mod.rs", "DOOR", "internal parsed-cell role encoding, not a geometry tunable"),
    ("mapgen/landmarks/templates/mod.rs", "NOOK", "internal parsed-cell role encoding, not a geometry tunable"),
    ("mapgen/landmarks/templates/mod.rs", "LIGHT", "internal parsed-cell role encoding, not a geometry tunable"),
    ("fx_report.rs", "FX_REPORT_EVENTS_MAX", "sealed projection report capacity; unsupported scenes fail explicitly, never changes gameplay"),
    ("fx_report.rs", "ABILITY_CONTRIBUTIONS_MAX", "checked sealed-report representation capacity for temporal ability contributions; unsupported scenes fail explicitly rather than changing rules"),
    ("fx_report.rs", "FX_REPORT_OPS_MAX", "derived per-step projection operation capacity, not a rule"),
    ("fx_report.rs", "FX_PUBLIC_BUCKETS_MAX", "bounded viewer-local public report storage, never read by gameplay"),
    ("fx_report.rs", "FX_INSTANT_BUCKETS_MAX", "bounded same-tick projected signature output, not a game rule"),
    ("fx_report.rs", "FX_OUTPUT_EVENTS_MAX", "derived projected output capacity; explicit refusal rather than truncation"),
    ("mapgen/det_math.rs", "TWO_PI", "mathematical constant"),
    ("mapgen/coliseum.rs", "W", "typed alias of registered MAP_TILES_W"),
    ("mapgen/coliseum.rs", "H", "typed alias of registered MAP_TILES_H"),
    ("mapgen/coliseum.rs", "CX", "centre derived from registered MAP_TILES_W"),
    ("mapgen/coliseum.rs", "CY", "centre derived from registered MAP_TILES_H"),
    ("mapgen/grid_ops.rs", "NB4", "fixed orthogonal neighbour order derived from registered width; exact legacy topology fixtures"),
    ("mapgen/grid_ops.rs", "RING_OFF", "ring offsets derived from registered width; exact legacy topology fixtures"),
    ("mapgen/grid_topology.rs", "RING_DX", "ring neighbour order of the topology algorithm; all 256 masks checked against legacy"),
    ("mapgen/grid_topology.rs", "RING_DY", "ring neighbour order of the topology algorithm; all 256 masks checked against legacy"),
    ("mapgen/grid_topology.rs", "SIMPLE", "derived ring connectivity truth table, not a geometry tunable; all 256 masks checked against legacy"),
    ("mapgen/grid_topology.rs", "DX", "5/7/11 distance-field neighbour expansion order; exact legacy differential fixtures"),
    ("mapgen/grid_topology.rs", "DY", "5/7/11 distance-field neighbour expansion order; exact legacy differential fixtures"),
    ("mapgen/grid_topology.rs", "COST", "integer chamfer-distance algorithm representation, not combat or map-shape tuning; exact legacy differential fixtures"),
    ("mapgen/zones/mod.rs", "ZONES", "derived from the existing hashed faction identity table"),
    ("mapgen/zones/mod.rs", "N", "grid area derived from registered map dimensions"),
    ("mapgen/spots/mod.rs", "N", "grid area derived from registered map dimensions"),
    ("mapgen/repair/mod.rs", "N", "grid area derived from registered map dimensions"),
    ("mapgen/zones/growth.rs", "KEY", "Int32 packed heap-key encoding; total key/tile order is pinned by exact differential partition fixtures, not a tunable rule"),
    ("mapgen/zones/camps/mod.rs", "KEY", "Int32 packed camp/territory heap ordering; exact differential fixtures pin representation and ties"),
    ("map.rs", "TILE_FLOOR", "tile class code of the map encoding; the rule is carried by the MASK_* registry rows"),
    ("map.rs", "TILE_WALL", "tile class code of the map encoding; the rule is carried by the MASK_* registry rows"),
    ("map.rs", "TILE_LOW", "tile class code of the map encoding; the rule is carried by the MASK_* registry rows"),
    ("item_view.rs", "MAX_VISIBLE_PROPS", "public item view size limit, does not change the simulation"),
    ("item_view.rs", "GRACE", "observer-local renewal and input lifetime, never part of the world"),
    ("observe.rs", "OBSERVATION_VERSION", "observation layout version (a format, versioned on its own), not a rule"),
    ("hash.rs", "K", "mixing multiplier of the state hash (an observer, never read by the simulation)"),
    ("math.rs", "PI", "mathematical constant"),
    ("pathfind.rs", "SQRT2", "mathematical constant"),
    ("checkpoint.rs", "COORD_MARGIN", "how far past the map edge a restored coordinate may be; a sanity bound on untrusted checkpoints, never read by the tick"),
    ("sight.rs", "SLOTS_PER_PAIR", "sizing of the derived sight memo (hit rate only, never a verdict); not a rule"),
    ("sight.rs", "MIN_ENTRIES", "sizing of the derived sight memo (hit rate only, never a verdict); not a rule"),
    ("sight.rs", "MAX_ENTRIES", "memory bound of the derived sight memo (hit rate only, never a verdict); not a rule"),
    ("sight.rs", "NO_KEY", "the sight memo's empty-entry key; not a rule"),
    ("sight.rs", "NO_VIEWER", "the memo's empty viewer-slot value; not a rule"),
    ("sight.rs", "EMPTY","the memo's empty-entry value; not a rule"),
    ("scratch.rs", "NONE", "empty marker of the dense per-slot working lists; an index sentinel, not a rule"),
    ("map.rs", "STEP_DX", "A* neighbour offsets in the legacy expansion order; algorithm structure pinned by the pathfinding parity fixture (300 queries), not a tunable rule number"),
    ("map.rs", "STEP_DY", "A* neighbour offsets in the legacy expansion order; algorithm structure pinned by the pathfinding parity fixture (300 queries), not a tunable rule number"),
    ("pathfind.rs", "UNKNOWN", "memo cell state of the string-pull circle_clear cache; internal encoding, not a rule"),
    ("pathfind.rs", "CLEAR", "memo cell state of the string-pull circle_clear cache; internal encoding, not a rule"),
    ("pathfind.rs", "BLOCKED", "memo cell state of the string-pull circle_clear cache; internal encoding, not a rule"),
    ("rng.rs", "LEGACY_12", "test vector captured from the legacy generator"),
    ("rng.rs", "LEGACY_0", "test vector captured from the legacy generator"),
    ("schedule.rs", "CAP", "bound of the test-only schedule trace buffer; not a rule"),
];

/// Rules that are tables rather than scalar rows: they are folded by `content_hash` directly (see content.rs). As
/// (file, name, reason).
const TABLES_FOLDED_BY_HASH: &[(&str, &str, &str)] = &[
    ("abilities/mod.rs", "CANCELLED_BY", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "RANGE_SLACK", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "TELEPORT_GRACE_MS", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "WISH_LOCK_MS", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "TRAINING_COOLDOWN_MS", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "WISH_MULT_MIN", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "FREEZE_STUN_MS", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "SWARM_MS", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "SWARM_RADIUS", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "TRIAL_MS", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "TRIAL_RADIUS", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "TRIAL_CONVICTED_RADIUS", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "TRIAL_DEALT_MULT", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "TRIAL_TAKEN_MULT", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "TRIAL_MOVE_MULT", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "BLAZE_TRAIL_MS", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "BLAZE_HALF_WIDTH", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "LAST_STAND_MS", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "LAST_STAND_FLOOR", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "LAST_STAND_HASTE", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/mod.rs", "LAST_STAND_HEAL", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/blink.rs", "MIN_DIST", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/blink.rs", "MAX_DIST", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("abilities/blink.rs", "STEP", "executable Wish catalog/blink policy folded by abilities::visit_content"),
    ("systems/arena_rules.rs", "MAX_DURATION_SECONDS", "actual arena duration admission bound folded by arena_rules::visit_content"),
    ("systems/arena_rules.rs", "PATIENCE_MIN_PLAYERS", "actual source patience scaling endpoint folded by arena_rules::visit_content"),
    ("systems/arena_rules.rs", "PATIENCE_FULL_PLAYERS", "actual source patience scaling endpoint folded by arena_rules::visit_content"),
    ("systems/arena_rules.rs", "SD_START", "actual sudden-death damage start folded by arena_rules::visit_content"),
    ("systems/arena_rules.rs", "SD_RAMP", "actual sudden-death damage ramp folded by arena_rules::visit_content"),
    ("systems/coliseum.rs", "SPOT_SEARCH_TILES", "actual fallback search bound folded by arena_rules::visit_content"),
    ("systems/coliseum.rs", "RING_RADIUS", "actual fallback ring radius folded by arena_rules::visit_content"),
    ("systems/coliseum.rs", "IMMUNITY_MS", "actual teleport immunity folded by arena_rules::visit_content"),
    ("systems/planning/deal.rs", "WALK_TOLERANCE", "actual planning comparison tolerance folded by planning::deal::visit_content"),
    ("systems/planning/deal.rs", "TIER_EPS", "actual planning tier arithmetic epsilon folded by planning::deal::visit_content"),
    ("systems/planning/deal.rs", "SEARCH_BUDGET", "actual planning assignment budget folded by planning::deal::visit_content"),
    ("systems/planning/deal.rs", "SPARE_BUDGET", "actual planning fallback budget folded by planning::deal::visit_content"),
    ("terrain.rs", "NEUTRAL", "actual complete runtime surface matrix folded by terrain::visit_content"),
    ("potions/mod.rs", "DEFINITION", "actual Small potion stock/concurrency/duration/share read by runtime and progression content visitor"),

    ("cards/rules.rs", "DEFINITION", "actual selected card tiers/effect words folded by visit_progression_content"),
    ("modifiers/farm.rs", "DEFINITION", "actual ordered mob reward rows and count bounds folded by visit_progression_content"),
    ("modifiers/rules.rs", "DEFINITION", "actual weapon/signature stat scaling words folded by visit_progression_content"),
    ("private_rng.rs", "DEFINITION", "actual private reward stream warmup policy folded by visit_progression_content"),
    ("reward_chests/rules.rs", "DEFINITION", "actual source offer/range/expiry/skip policy folded by visit_progression_content"),
    ("reward_chests/view.rs", "ALL", "actual boost identities/index/name order folded by visit_progression_content"),
    ("kill_augments.rs", "DEFINITION", "actual source UNIT normalisers and readable-stat order folded by visit_progression_content (kill-augments table)"),
    ("quests/catalog.rs", "DEFINITION", "the twenty typed K1 quest rows folded by visit_progression_content (quests/1 table)"),
    ("initial_world/rules.rs", "DEFINITION", "actual initial-world constructor policies are folded through their runtime visitor"),
    ("status_runtime/fields.rs", "TRIAL_FIELD_POLICY", "actual rank-one exit-stun/burn policy read by status fields and visit_extra_content"),
    ("status_runtime/fields.rs", "BLAZE_FIELD_POLICY", "actual rank-one exit-stun/burn policy read by status fields and visit_extra_content"),
    ("status_runtime/mod.rs", "ALL", "actual ordered AbilityId identities and text keys folded by visit_extra_content"),
    ("status_runtime/readers.rs", "HASTE_BASE_FLOOR", "actual status movement floor folded by visit_extra_content"),
    ("status_runtime/readers.rs", "DEATH_FLOOR_DEFAULT_HP", "actual death-floor default folded by visit_extra_content"),
    ("status_runtime/rules.rs", "STATUS_KINDS", "actual ordered status kind identities consumed by visit_content"),
    ("status_runtime/rules.rs", "STATUS_RULES", "all actual status duration/combine/cap/cleanse/bit/role fields consumed by visit_content"),
    ("status_runtime/rules.rs", "HIDDEN_REVEAL_MS", "actual reveal interval consumed by visit_content"),
    ("status_runtime/rules.rs", "EFFECT_CASTING", "actual casting effect bit consumed by visit_content"),
    ("status_runtime/stats.rs", "CRIT_EPSILON", "actual deterministic DoT critical threshold consumed by visit_extra_content"),
    ("status_runtime/stats.rs", "CRIT_MULT", "actual critical damage multiplier consumed by visit_extra_content"),
    ("status_runtime/stats.rs", "CRIT_CHANCE_MAX", "actual critical chance bound consumed by visit_extra_content"),
    ("status_runtime/stats.rs", "LIFESTEAL_MAX", "actual lifesteal bound consumed by visit_extra_content"),
    ("status_runtime/stats.rs", "HOLY_LEECH_ROW_MULT", "actual Holy row multiplier consumed by visit_extra_content"),
    ("mob_catalog/mod.rs", "DEFINITION", "actual ordered role/type/region metadata and four roster/reach policies folded by content_hash_of_mob_catalog_definition through the runtime visitor"),
    ("mapgen/style_zones/mod.rs", "ENTRIES", "actual five-faction callback identity and phase metadata folded by style_zones::visit_entries into aggregate content"),
    ("mapgen/style_rime/shape.rs", "NORMALS", "actual facet geometry coordinates folded through the same style_rime::visit_content definition visitor"),
    ("mapgen/style_features/rules.rs","DEFAULT_DEFINITION","all eleven shared feature arithmetic/search policies are folded by content_hash_of_style_features_definition"),
    ("mapgen/style_features/mod.rs","DIR8","derived topology-bearing coordinates used by callbacks are folded directly by content_hash"),
    ("mapgen/style_features/mod.rs","CHAMFER_FAR","typed alias of DEFAULT_DEFINITION.chamfer_far, folded by the same feature definition visitor"),
    ("mapgen/style_sanctum/mod.rs","DEFAULT_DEFINITION","all nine Holy shape/surface/decor policies are folded by content_hash_of_style_sanctum_definition"),

    ("mapgen/certify/rules.rs", "R", "independent hard-check runtime definition/table folded by certify::rules::visit_definition into content_hash"),
    ("mapgen/certify/rules.rs", "TERRAIN", "independent hard-check runtime definition/table folded by certify::rules::visit_definition into content_hash"),
    ("mapgen/certify/rules.rs", "PROP_CLASSES", "independent hard-check runtime definition/table folded by certify::rules::visit_definition into content_hash"),
    ("mapgen/certify/rules.rs", "KINDS", "independent hard-check runtime definition/table folded by certify::rules::visit_definition into content_hash"),
    ("mapgen/certify/rules.rs", "PATH_HAZARDS", "independent hard-check runtime definition/table folded by certify::rules::visit_definition into content_hash"),
    ("mapgen/certify/rules.rs", "ZONES", "independent hard-check runtime definition/table folded by certify::rules::visit_definition into content_hash"),
    ("mapgen/certify/rules.rs", "WEAPONS", "independent hard-check runtime definition/table folded by certify::rules::visit_definition into content_hash"),
    ("mapgen/certify/rules.rs", "LANDMARKS", "independent hard-check runtime definition/table folded by certify::rules::visit_definition into content_hash"),
    ("mapgen/pipeline/rules.rs", "DEFAULT_DEFINITION", "actual plain/styled orchestration retry/feature limits folded by content_hash_of_pipeline_definition"),
    ("mapgen/style_runtime/rules.rs", "DEFAULT_DEFINITION", "all sixteen guarded-runtime/stream/route policies folded by content_hash_of_style_runtime_definition"),
    ("mapgen/style_runtime/mod.rs", "MAX_CELLS", "shared route-index representation/admission bound folded directly by content_hash"),
    ("mapgen/style_runtime/mod.rs", "DIAMOND2", "actual LOW support/release neighborhood coordinates folded directly by content_hash"),

    ("mapgen/records/rules.rs", "DEFAULT_DEFINITION", "canonical faction/weapon policy and ICE identity are live inputs folded by content_hash_of_records_definition"),
    ("mapgen/terrain_gate/rules.rs", "DEFAULT_DEFINITION", "terrain acceptance tables and halo distances are live inputs folded by content_hash_of_terrain_gate_definition"),
    ("mapgen/terrain_gate/rules.rs", "KINDS", "default terrain key/class/home rows are traversed by the actual terrain acceptance definition and content visitor"),
    ("mapgen/terrain_gate/rules.rs", "PROPS", "default prop key/class/home rows are traversed by the actual terrain acceptance definition and content visitor"),
    ("mapgen/terrain_gate/rules.rs", "GENERATOR_TILE_CLASSES", "derived from the sole KINDS table and folded through the live repair definition"),
    ("mapgen/spots/rules.rs", "DEFAULT_DEFINITION", "live camp/crate/ground placement tuning is traversed by content_hash_of_spot_definition"),
    ("mapgen/tail/mod.rs", "DEFAULT_DEFINITION", "final wall-piece admission and loot exclusion tuning is traversed by content_hash_of_tail_definition"),
    (
        "factions.rs", "ALL",
        "signature identities and each live is_dot classification are folded by content_hash_of_signature_rules",
    ),
    (
        "mapgen/landmarks/runtime/rules.rs", "DEFAULT_DEFINITION",
        "all three landmark guard rules drive runtime and the allocation-free content fold",
    ),
    (
        "mapgen/bushes/rules.rs",
        "DEFAULT_DEFINITION",
        "all 11 elite-bush tunables drive runtime and are folded by content_hash_of_bush_definition",
    ),
    (
        "mapgen/spawns/rules.rs",
        "DEFAULT_DEFINITION",
        "all 27 spawn/protection/gate tunables drive runtime and are folded by content_hash_of_spawn_definition",
    ),
    (
        "mapgen/attempt/rules.rs",
        "DEFAULT_DEFINITION",
        "both attempt-prefix values drive runtime and are folded by content_hash_of_attempt_definition",
    ),
    (
        "mapgen/zones/camps/rules.rs",
        "DEFAULT_DEFINITION",
        "all 13 camp/initial-territory tunables drive generation and are folded by content_hash_of_camp_definition",
    ),
    (
        "mapgen/zones/rules.rs",
        "DEFAULT_DEFINITION",
        "all 28 partition tunables drive generation and are folded by content_hash_of_zone_definition",
    ),
    (
        "mapgen/coliseum.rs",
        "DEFAULT_DEFINITION",
        "all fixed geometry and pillar-orbit words are read by generation and folded by content_hash_of_map_definition",
    ),
    (
        "content.rs",
        "ALL",
        "FactionId::ALL / WeaponId::ALL wire-order tables: folded by name, in order",
    ),
    (
        "content.rs",
        "STAGGER_WEAPONS",
        "which weapons stagger: folded as a per-weapon flag",
    ),
];

/// Numbers the hash folded at the base revision a0cfa2e: everything else in the list below was missing from it.
const MISSING_AT_BASE: &[&str] = &[
    "TICK_RATE", // only through TICK_MS
    "MAP_TILES_W",
    "MAP_TILES_H",
    "WORLD_W",
    "WORLD_H",
    "MAX_PLAYERS",
    "MAX_ACTIONS_PER_TICK",
    "AIM_STALE_MS",
    "STAGGER_IMMUNITY_SECONDS",
    "SWAP_SECONDS",
    "MOVE_MULT_FLOOR",
    "TIE_EPS_MS",
    "RANGED_RELEASE_PAUSE_MS",
    "KILL_CREDIT_SECONDS",
    "WIN_BONUS_MIN_PLAYERS",
    "WIN_BONUS_MIN_OPPONENTS",
    "BOUNTY_FREE_KILLS",
    "BOUNTY_ANNOUNCE_MS",
    "ORDER_BURST",
    "ORDER_PER_SECOND",
];

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read_dir {}: {e}", dir.display()))
        .map(|e| e.unwrap().path())
        .collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            rs_files(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

/// (path relative to src, source with line comments removed) of every rust file under src, recursively.
fn sources() -> Vec<(String, String)> {
    let root = src_dir();
    let mut files = Vec::new();
    rs_files(&root, &mut files);
    assert!(!files.is_empty());
    files
        .into_iter()
        .map(|p| {
            let text = std::fs::read_to_string(&p).unwrap();
            let code: String = text
                .lines()
                .map(|l| l.split("//").next().unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\n");
            (
                p.strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
                code,
            )
        })
        .collect()
}

fn is_ident(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// A scanned `const NAME: TYPE` / `static NAME: TYPE` declaration; `ty` has its whitespace removed.
#[derive(Debug, PartialEq)]
struct Decl {
    name: String,
    ty: String,
}

/// Declarations of `const NAME` or `static NAME` (upper case identifiers; `const fn`, `$name` and const generic parameters
/// such as `<const N: usize>` do not match).
fn declared_consts(code: &str) -> Vec<Decl> {
    let mut out = Vec::new();
    for kw in ["const ", "static "] {
        let mut from = 0;
        while let Some(i) = code[from..].find(kw) {
            let at = from + i;
            from = at + kw.len();
            if code[..at].chars().next_back().is_some_and(is_ident) {
                continue;
            }
            if code[..at]
                .trim_end()
                .chars()
                .next_back()
                .is_some_and(|c| c == '<' || c == ',')
            {
                continue; // a const generic parameter, not an item
            }
            let name: String = code[from..].chars().take_while(|c| is_ident(*c)).collect();
            if name
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_uppercase() || c == '_')
                && name
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
            {
                let rest = code[from + name.len()..].trim_start();
                let mut depth = 0i32;
                let ty: String = rest
                    .strip_prefix(':')
                    .unwrap_or("")
                    .chars()
                    .take_while(|c| {
                        match c {
                            '[' | '<' | '(' => depth += 1,
                            ']' | '>' | ')' => depth -= 1,
                            _ => {}
                        }
                        !(depth == 0 && (*c == '=' || *c == ';'))
                    })
                    .filter(|c| !c.is_whitespace())
                    .collect();
                out.push(Decl { name, ty });
            }
        }
    }
    out
}

/// Does the declared type hold no number (see NUMBER_FREE_TYPES)?
fn number_free(ty: &str) -> bool {
    NUMBER_FREE_TYPES
        .iter()
        .any(|(m, prefix, _)| if *prefix { ty.starts_with(m) } else { ty == *m })
}

/// Does `code` mention `name` as a whole word?
fn uses_word(code: &str, name: &str) -> bool {
    let mut from = 0;
    while let Some(i) = code[from..].find(name) {
        let at = from + i;
        let end = at + name.len();
        let before_ok = !code[..at].chars().next_back().is_some_and(is_ident);
        let after_ok = !code[end..].chars().next().is_some_and(is_ident);
        if before_ok && after_ok {
            return true;
        }
        from = end;
    }
    false
}

fn registry_names() -> BTreeSet<&'static str> {
    REGISTRY.iter().map(|e| e.name).collect()
}

fn find(name: &str) -> &'static Entry {
    REGISTRY
        .iter()
        .find(|e| e.name == name)
        .unwrap_or_else(|| panic!("{name} is not registered"))
}

fn bump(v: ContentVal) -> ContentVal {
    match v {
        ContentVal::F64(x) => ContentVal::F64(f64::from_bits(x.to_bits() ^ 1)),
        ContentVal::U64(x) => ContentVal::U64(x ^ 1),
        ContentVal::I64(x) => ContentVal::I64(x ^ 1),
    }
}

fn perturbed(i: usize) -> Vec<Entry> {
    let mut r = REGISTRY.to_vec();
    r[i].val = bump(r[i].val);
    r
}

#[test]
fn registry_is_well_formed() {
    let mut seen = BTreeSet::new();
    for e in REGISTRY {
        assert!(seen.insert(e.name), "{} is registered twice", e.name);
        assert!(!e.unit.is_empty(), "{} has no unit", e.name);
        assert!(
            e.name
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'),
            "{} is not SCREAMING_CASE",
            e.name
        );
        if let ContentVal::F64(x) = e.val {
            assert!(x.is_finite(), "{} is not finite", e.name);
        }
    }
    assert!(
        REGISTRY.len() >= 50,
        "registry shrank to {} rows",
        REGISTRY.len()
    );
}

#[test]
fn hash_is_stable_and_derived_from_the_registry() {
    assert_eq!(content_hash(), content_hash());
    assert_eq!(content_hash(), content_hash_of(REGISTRY));
}

/// The rules identity of this build. A change here is a gameplay (or rules identity) change on purpose: Welcome, /info and
/// replays carry it, older replays are refused with ContentMismatch. Update it in the same commit as the change that moves it.
#[test]
fn hash_golden() {
    assert_eq!(
        content_hash(),
        GOLDEN_CONTENT_HASH,
        "content_hash is now {:016x}",
        content_hash()
    );
}
const GOLDEN_CONTENT_HASH: u64 = 0x0522_ddd5_83cc_9fd8;

#[test]
fn every_registry_row_perturbs_the_hash() {
    let base = content_hash();
    let mut hashes = BTreeSet::new();
    hashes.insert(base);
    for (i, e) in REGISTRY.iter().enumerate() {
        let h = content_hash_of(&perturbed(i));
        assert_ne!(h, base, "changing {} does not change content_hash", e.name);
        assert!(
            hashes.insert(h),
            "changing {} collides with another perturbation",
            e.name
        );
    }
}

#[test]
fn removing_renaming_or_reordering_a_row_perturbs_the_hash() {
    let base = content_hash();
    let mut removed = REGISTRY.to_vec();
    removed.pop();
    assert_ne!(content_hash_of(&removed), base);
    let mut renamed = REGISTRY.to_vec();
    renamed[0].name = "SOMETHING_ELSE";
    assert_ne!(content_hash_of(&renamed), base);
    let mut swapped = REGISTRY.to_vec();
    swapped.swap(0, 1);
    assert_ne!(content_hash_of(&swapped), base);
}

#[test]
fn numbers_missing_from_the_hash_at_the_base_now_move_it() {
    let base = content_hash();
    for name in MISSING_AT_BASE {
        let i = REGISTRY
            .iter()
            .position(|e| e.name == *name)
            .unwrap_or_else(|| panic!("{name} is not registered"));
        assert_ne!(content_hash_of(&perturbed(i)), base, "{name}");
    }
    for name in [
        "BOW_WINDUP_MAX_S",
        "BOW_WINDUP_INTERVAL_SHARE",
        "WAND_WINDUP_MAX_S",
        "WAND_WINDUP_INTERVAL_SHARE",
        "SNAP_RADIUS",
        "PULL_WINDOW",
        "MASK_SIGHT",
        "MASK_MOVE",
        "MASK_MELEE",
        "BARRIER_EPS",
        "FACING_EPS",
        "ARC_EPS",
        "PATH_TIE_EPS",
        "START_CENTER_SLACK",
    ] {
        find(name);
    }
}

#[test]
fn stagger_rule_moves_the_hash() {
    let base = content_hash();
    assert_ne!(content_hash_of_rules(REGISTRY, &[]), base);
    assert_ne!(
        content_hash_of_rules(REGISTRY, &[WeaponId::Sword, WeaponId::Axe]),
        base
    );
    assert_ne!(content_hash_of_rules(REGISTRY, &[WeaponId::Axe]), base);
    assert_eq!(content_hash_of_rules(REGISTRY, STAGGER_WEAPONS), base);
}

#[test]
fn fixed_map_geometry_and_pillar_data_move_the_content_hash() {
    use rh_sim::content::content_hash_of_map_definition;
    use rh_sim::mapgen::coliseum::{default_definition, PillarOrbit};
    let mut definition = default_definition();
    let base = content_hash();
    assert_eq!(
        content_hash_of_map_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
    definition.ring_road += 1;
    assert_ne!(
        content_hash_of_map_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
    definition = default_definition();
    let mut coordinates = definition.pillars[0].generators.to_vec();
    coordinates[0].0 += 1;
    let mut pillars = definition.pillars.to_vec();
    pillars[0] = PillarOrbit {
        turns: pillars[0].turns,
        generators: &coordinates,
    };
    definition.pillars = &pillars;
    assert_ne!(
        content_hash_of_map_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
}

#[test]
fn zone_partition_rules_move_the_content_hash() {
    use rh_sim::content::content_hash_of_zone_definition;
    let mut definition = rh_sim::mapgen::zones::default_definition();
    let base = content_hash();
    assert_eq!(
        content_hash_of_zone_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
    definition.cost_amp += 1;
    assert_ne!(
        content_hash_of_zone_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
    definition = rh_sim::mapgen::zones::default_definition();
    definition.annulus_lo = f64::from_bits(definition.annulus_lo.to_bits() ^ 1);
    assert_ne!(
        content_hash_of_zone_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
}

#[test]
fn camp_rules_move_the_content_hash() {
    use rh_sim::content::content_hash_of_camp_definition;
    let mut definition = rh_sim::mapgen::zones::camps::default_definition();
    let base = content_hash();
    assert_eq!(
        content_hash_of_camp_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
    definition.camp_gap += 1.0;
    assert_ne!(
        content_hash_of_camp_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
    definition = rh_sim::mapgen::zones::camps::default_definition();
    definition.halo_window += 1;
    assert_ne!(
        content_hash_of_camp_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
}

#[test]
fn attempt_prefix_rules_move_the_content_hash() {
    use rh_sim::content::content_hash_of_attempt_definition;
    let mut definition = rh_sim::mapgen::attempt::default_definition();
    let base = content_hash();
    assert_eq!(
        content_hash_of_attempt_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
    definition.layout_tries += 1;
    assert_ne!(
        content_hash_of_attempt_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
    definition = rh_sim::mapgen::attempt::default_definition();
    definition.retry_seed_stride += 1.0;
    assert_ne!(
        content_hash_of_attempt_definition(REGISTRY, STAGGER_WEAPONS, &definition),
        base
    );
}

#[test]
fn every_spawn_rule_moves_the_content_hash() {
    use rh_sim::content::content_hash_of_spawn_definition;
    use rh_sim::mapgen::spawns::{default_definition, SpawnDefinition};
    let base = content_hash();
    assert_eq!(
        content_hash_of_spawn_definition(REGISTRY, STAGGER_WEAPONS, &default_definition()),
        base
    );
    let mutations: &[fn(&mut SpawnDefinition)] = &[
        |d| d.separation += 1.0,
        |d| d.safe_separation += 1.0,
        |d| d.camp_pick += 1,
        |d| d.ring_lo += 1.0,
        |d| d.ring_hi += 1.0,
        |d| d.pick_target += 1,
        |d| d.pool_min += 1,
        |d| d.pool_zones += 1,
        |d| d.pick_band += 1.0,
        |d| d.tries += 1,
        |d| d.walk_ratio_max += 1.0,
        |d| d.hazard_walk_max += 1,
        |d| d.quantile_first += 1,
        |d| d.quantile_last += 1,
        |d| d.quantile_denominator += 1,
        |d| d.score_weight += 1,
        |d| d.early_extra += 1,
        |d| d.scan_margin += 1,
        |d| d.pool_halo_margin += 1,
        |d| d.pool5_margin += 1,
        |d| d.corner_open += 1,
        |d| d.landmark_road_margin += 1,
        |d| d.landmark_lane_margin += 1,
        |d| d.landmark_clearing_margin += 1,
        |d| d.style_road_margin += 1,
        |d| d.style_lane_margin += 1,
        |d| d.landmark_box_margin += 1,
    ];
    assert_eq!(mutations.len(), 27);
    let mut hashes = BTreeSet::new();
    for (index, mutate) in mutations.iter().enumerate() {
        let mut definition = default_definition();
        mutate(&mut definition);
        let hash = content_hash_of_spawn_definition(REGISTRY, STAGGER_WEAPONS, &definition);
        assert_ne!(
            hash, base,
            "spawn rule {index} omitted from content identity"
        );
        assert!(hashes.insert(hash), "spawn rule {index} collided");
    }
}

#[test]
fn every_bush_rule_moves_the_content_hash() {
    use rh_sim::content::content_hash_of_bush_definition;
    use rh_sim::mapgen::bushes::{default_definition, BushDefinition};
    let base = content_hash();
    assert_eq!(
        content_hash_of_bush_definition(REGISTRY, STAGGER_WEAPONS, &default_definition()),
        base
    );
    let mutations: &[fn(&mut BushDefinition)] = &[
        |d| d.stream += 1,
        |d| d.camp_stream_stride += 1,
        |d| d.patches_min += 1,
        |d| d.patches_max += 1,
        |d| d.tiles_min += 1,
        |d| d.tiles_max += 1,
        |d| d.near_min_d2 += 1,
        |d| d.near_max_d2 += 1,
        |d| d.centre_sep_d2 += 1,
        |d| d.scan_radius += 1,
        |d| d.tries_per_patch += 1,
    ];
    assert_eq!(mutations.len(), 11);
    let mut hashes = BTreeSet::new();
    for (index, mutate) in mutations.iter().enumerate() {
        let mut definition = default_definition();
        mutate(&mut definition);
        let hash = content_hash_of_bush_definition(REGISTRY, STAGGER_WEAPONS, &definition);
        assert_ne!(
            hash, base,
            "bush rule {index} omitted from content identity"
        );
        assert!(hashes.insert(hash), "bush rule {index} collided");
    }
}

#[test]
fn landmark_guard_rules_move_the_content_hash() {
    use rh_sim::content::content_hash_of_landmark_definition;
    use rh_sim::mapgen::landmarks::runtime::{default_definition, LandmarkDefinition};
    let base = content_hash();
    assert_eq!(
        content_hash_of_landmark_definition(REGISTRY, STAGGER_WEAPONS, &default_definition()),
        base
    );
    let mutations: &[fn(&mut LandmarkDefinition)] = &[
        |d| d.join_checks += 1,
        |d| d.footprint_percent += 1.0,
        |d| d.rim_tiles += 1.0,
    ];
    for (index, mutate) in mutations.iter().enumerate() {
        let mut definition = default_definition();
        mutate(&mut definition);
        assert_ne!(
            content_hash_of_landmark_definition(REGISTRY, STAGGER_WEAPONS, &definition),
            base,
            "landmark rule {index} omitted from content identity"
        );
    }
}

#[test]
fn landmark_search_rules_move_the_content_hash() {
    use rh_sim::content::content_hash_of_landmark_search_definition;
    use rh_sim::mapgen::landmarks::search::{default_definition, SearchDefinition};
    let base = content_hash();
    assert_eq!(
        content_hash_of_landmark_search_definition(
            REGISTRY,
            STAGGER_WEAPONS,
            &default_definition()
        ),
        base
    );
    let mutations: &[fn(&mut SearchDefinition)] =
        &[|d| d.default_tries += 1, |d| d.origin_stride += 1];
    let mut hashes = BTreeSet::new();
    for (index, mutate) in mutations.iter().enumerate() {
        let mut definition = default_definition();
        mutate(&mut definition);
        let hash =
            content_hash_of_landmark_search_definition(REGISTRY, STAGGER_WEAPONS, &definition);
        assert_ne!(
            hash, base,
            "landmark search rule {index} omitted from content identity"
        );
        assert!(hashes.insert(hash), "landmark search rule {index} collided");
    }
}

#[test]
fn landmark_support_rules_move_the_content_hash() {
    use rh_sim::content::content_hash_of_landmark_support_definition;
    use rh_sim::mapgen::landmarks::recipe_support::{default_definition, RecipeSupportDefinition};
    let base = content_hash();
    assert_eq!(
        content_hash_of_landmark_support_definition(
            REGISTRY,
            STAGGER_WEAPONS,
            &default_definition()
        ),
        base
    );
    let mutations: &[fn(&mut RecipeSupportDefinition)] = &[
        |d| d.ref_zone_tiles += 1.0,
        |d| d.landmarks_per_zone += 1,
        |d| d.landmark_stream += 1,
        |d| d.noise_stream_offset += 1,
        |d| d.door_min_offset += 1,
        |d| d.door_max_offset += 1,
    ];
    let mut hashes = BTreeSet::new();
    for (index, mutate) in mutations.iter().enumerate() {
        let mut definition = default_definition();
        mutate(&mut definition);
        let hash =
            content_hash_of_landmark_support_definition(REGISTRY, STAGGER_WEAPONS, &definition);
        assert_ne!(
            hash, base,
            "landmark support rule {index} omitted from content identity"
        );
        assert!(
            hashes.insert(hash),
            "landmark support rule {index} collided"
        );
    }
}

#[test]
fn signature_identity_and_dot_classification_move_the_content_hash() {
    use rh_sim::content::content_hash_of_signature_rules;
    use rh_sim::factions::SignatureKind;
    let rules = SignatureKind::ALL.map(|kind| (kind, kind.is_dot()));
    assert_eq!(
        rules,
        [
            (SignatureKind::Disease, true),
            (SignatureKind::Burn, true),
            (SignatureKind::Backlash, false),
            (SignatureKind::Mark, false)
        ]
    );
    let base = content_hash();
    assert_eq!(
        content_hash_of_signature_rules(REGISTRY, STAGGER_WEAPONS, &rules),
        base
    );
    for index in 0..rules.len() {
        let mut changed = rules;
        changed[index].1 = !changed[index].1;
        assert_ne!(
            content_hash_of_signature_rules(REGISTRY, STAGGER_WEAPONS, &changed),
            base
        );
    }
    assert_ne!(
        content_hash_of_signature_rules(REGISTRY, STAGGER_WEAPONS, &rules[..2]),
        base
    );
    let mut reordered = rules;
    reordered.swap(0, 1);
    assert_ne!(
        content_hash_of_signature_rules(REGISTRY, STAGGER_WEAPONS, &reordered),
        base
    );
}

#[test]
fn stagger_rule_is_registered_data() {
    assert_eq!(STAGGER_WEAPONS, &[WeaponId::Sword]);
    for w in WeaponId::ALL {
        assert_eq!(staggers(w), w == WeaponId::Sword, "{w:?}");
    }
}

/// Is `name`, declared in `file`, a number the registry does not account for? constants.rs declares only through content!
/// (REGISTRY itself is the macro's output); a hand-written const there would bypass the registry. Elsewhere a registered
/// name may not be declared at all: a second declaration of a registered number is a second, unhashed copy. An unregistered name needs an entry keyed by (file, name) in NON_GAMEPLAY or the folded tables.
fn is_stray(file: &str, name: &str, ty: &str, registered: &BTreeSet<&str>) -> bool {
    if file == "constants.rs" {
        return name != "REGISTRY";
    }
    if registered.contains(name) {
        return true;
    }
    !number_free(ty)
        && !NON_GAMEPLAY
            .iter()
            .any(|(f, n, _)| *f == file && *n == name)
        && !TABLES_FOLDED_BY_HASH
            .iter()
            .any(|(f, n, _)| *f == file && *n == name)
}

#[test]
fn every_const_in_the_source_tree_is_registered_or_explained() {
    let registered = registry_names();
    for (f, n, reason) in NON_GAMEPLAY {
        assert!(!reason.is_empty(), "{f}: {n} needs a reason");
        assert!(
            !registered.contains(n),
            "{n} is both registered and listed as not gameplay"
        );
    }
    let mut stray = Vec::new();
    let mut declared = BTreeSet::new();
    let mut found = 0;
    for (file, code) in sources() {
        for d in declared_consts(&code) {
            found += 1;
            if is_stray(&file, &d.name, &d.ty, &registered) {
                stray.push(format!("{file}: {} ({})", d.name, d.ty));
            }
            if !number_free(&d.ty) {
                declared.insert((file.clone(), d.name));
            }
        }
    }
    assert!(found > 0, "the scan found no consts at all");
    assert!(
        stray.is_empty(),
        "consts that are neither in the content! registry nor number-free nor in NON_GAMEPLAY (or registered names declared a second time): {stray:#?}\n\
         a gameplay number is one line in crates/rh-sim/src/constants.rs content!; anything else needs a reason in NON_GAMEPLAY"
    );
    // Exemptions may not go stale (a rename or a move) or become redundant (the type is number-free).
    for (f, n, _) in NON_GAMEPLAY.iter().chain(TABLES_FOLDED_BY_HASH) {
        assert!(
            declared.contains(&(f.to_string(), n.to_string())),
            "exemption {f}: {n} matches no number-bearing declaration; remove it"
        );
    }
}

/// A registered number declared a second time (as a module split might do), or a gameplay `const ALL` / `DX` in a file that
/// is not the listed one, is a stray whatever its value. The type decides what needs no entry at all.
#[test]
fn a_second_declaration_of_a_registered_name_is_a_stray() {
    let registered = registry_names();
    let d = |name: &str, ty: &str| Decl {
        name: name.into(),
        ty: ty.into(),
    };
    // The scan sees the declaration and its type...
    let code = "pub const PLAYER_RADIUS: f64 = 13.0;\nconst NOT_A_RULE_X: u8 = 1;\n\
                static H: [Link; 2] = [a, b];\nimpl<const N: usize, const M: bool> X {}\nstruct S<const CHECK: bool>;";
    assert_eq!(
        declared_consts(code),
        [
            d("PLAYER_RADIUS", "f64"),
            d("NOT_A_RULE_X", "u8"),
            d("H", "[Link;2]")
        ]
    );
    // ...and rejects it outside constants.rs, with the same value or another.
    assert!(registered.contains("PLAYER_RADIUS"));
    assert!(is_stray("observe.rs", "PLAYER_RADIUS", "f64", &registered));
    assert!(is_stray(
        "sim/combat.rs",
        "PLAYER_RADIUS",
        "f64",
        &registered
    ));
    assert!(is_stray(
        "constants.rs",
        "PLAYER_RADIUS",
        "f64",
        &registered
    ));
    // No external site is left: the numbers that once lived in pathfind.rs and map.rs are used by registry name only.
    assert!(is_stray("pathfind.rs", "SNAP_RADIUS", "f64", &registered));
    assert!(is_stray("map.rs", "MASK_MELEE", "u8", &registered));
    // Exemptions are per file.
    assert!(!is_stray("map.rs", "STEP_DX", "[i64;8]", &registered));
    assert!(is_stray("sim/combat.rs", "STEP_DX", "[i64;8]", &registered));
    assert!(is_stray("sim.rs", "ALL", "[u8;3]", &registered));
    assert!(!is_stray("content.rs", "ALL", "[FactionId;5]", &registered));
    assert!(is_stray("sim.rs", "NOT_A_RULE_X", "u8", &registered));
    // Number-free types need no entry; a number-bearing struct or numeric table still does.
    for ty in [
        "[Link;4]",
        "[Item<SystemFn>;24]",
        "[ActionRow;13]",
        "[HookRow;19]",
        "[Hook;19]",
        "Plan",
        "Gates",
        "&str",
        "&[&str]",
    ] {
        assert!(
            !is_stray("schedule.rs", "NEW_TABLE", ty, &registered),
            "{ty}"
        );
    }
    for ty in ["SomeStruct", "f64", "[f64;3]", "[u32;2]", "&[f64]", "PlanX"] {
        assert!(
            is_stray("schedule.rs", "NEW_TABLE", ty, &registered),
            "{ty}"
        );
    }
}

/// The numbers that were inline literals or site-local consts when the registry was introduced are all used by their
/// registry name now; a literal copy coming back would be an unhashed second source of the rule.
#[test]
fn the_formerly_inline_numbers_are_used_by_name() {
    let srcs = sources();
    for name in [
        "SNAP_RADIUS",
        "PULL_WINDOW",
        "MASK_SIGHT",
        "MASK_MOVE",
        "MASK_MELEE",
        "BARRIER_EPS",
        "FACING_EPS",
        "ARC_EPS",
        "PATH_TIE_EPS",
        "START_CENTER_SLACK",
    ] {
        assert!(
            srcs.iter()
                .any(|(f, c)| f != "constants.rs" && f != "content.rs" && uses_word(c, name)),
            "{name}: no use of the registry name outside the registry; was it inlined again?"
        );
    }
}
