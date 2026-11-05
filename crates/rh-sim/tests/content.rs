//! The content registry contract (crates/rh-sim/src/constants.rs, docs in content.rs): every gameplay number is declared
//! once in the `content!` registry, `content_hash` folds all of it, and nothing escapes by living in another file.

use rh_sim::constants::{ContentVal, Entry, REGISTRY};
use rh_sim::content::{
    content_hash, content_hash_of, content_hash_of_rules, staggers, WeaponId, STAGGER_WEAPONS,
};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Every `const` / `static` in `crates/rh-sim/src` that is deliberately not a gameplay number, as (file, name, reason). The
/// file is part of the key: a gameplay `const DX` or `const ALL` added in some other file is not exempted by its name.
/// Adding to this list is a review decision: a number that can change an outcome belongs in the registry instead.
const NON_GAMEPLAY: &[(&str, &str, &str)] = &[
    ("map.rs", "TILE_FLOOR", "tile class code of the map encoding; the rule is carried by the MASK_* registry rows"),
    ("map.rs", "TILE_WALL", "tile class code of the map encoding; the rule is carried by the MASK_* registry rows"),
    ("map.rs", "TILE_LOW", "tile class code of the map encoding; the rule is carried by the MASK_* registry rows"),
    ("observe.rs", "OBSERVATION_VERSION", "observation layout version (a format, versioned on its own), not a rule"),
    ("replay.rs", "REPLAY_FORMAT", "replay file format string, not a rule"),
    ("hash.rs", "K", "mixing multiplier of the state hash (an observer, never read by the simulation)"),
    ("hash.rs", "CHECK", "const generic of the hashing serializer: layout validation on or off, not a rule"),
    ("math.rs", "PI", "mathematical constant"),
    ("pathfind.rs", "SQRT2", "mathematical constant"),
    ("pathfind.rs", "DX", "A* neighbour order table; structural to the algorithm and pinned by the pathfinding parity fixture (300 queries)"),
    ("pathfind.rs", "DY", "A* neighbour order table; structural to the algorithm and pinned by the pathfinding parity fixture (300 queries)"),
    ("checkpoint.rs", "COORD_MARGIN", "how far past the map edge a restored coordinate may be; a sanity bound on untrusted checkpoints, never read by the tick"),
    ("checkpoint.rs", "CHECKPOINT_FORMAT", "checkpoint format tag (a data format, versioned on its own), not a rule"),
    ("sight.rs", "SLOTS_PER_PAIR", "sizing of the derived sight memo (hit rate only, never a verdict); not a rule"),
    ("sight.rs", "MIN_ENTRIES", "sizing of the derived sight memo (hit rate only, never a verdict); not a rule"),
    ("sight.rs", "MAX_ENTRIES", "memory bound of the derived sight memo (hit rate only, never a verdict); not a rule"),
    ("sight.rs", "NO_KEY", "the sight memo's empty-entry key; not a rule"),
    ("sight.rs", "NO_VIEWER", "the memo's empty viewer-slot value; not a rule"),
    ("sight.rs", "EMPTY","the memo's empty-entry value; not a rule"),
    ("scratch.rs", "NONE", "empty marker of the dense per-slot working lists; an index sentinel, not a rule"),
    ("checkpoint.rs", "FIELDS", "serde field names of the checkpoint visitor; wire layout, not a rule"),
    ("map.rs", "STEP_DX", "A* neighbour offsets in the legacy expansion order; algorithm structure pinned by the pathfinding parity fixture (300 queries), not a tunable rule number"),
    ("map.rs", "STEP_DY", "A* neighbour offsets in the legacy expansion order; algorithm structure pinned by the pathfinding parity fixture (300 queries), not a tunable rule number"),
    ("pathfind.rs", "UNKNOWN", "memo cell state of the string-pull circle_clear cache; internal encoding, not a rule"),
    ("pathfind.rs", "CLEAR", "memo cell state of the string-pull circle_clear cache; internal encoding, not a rule"),
    ("pathfind.rs", "BLOCKED", "memo cell state of the string-pull circle_clear cache; internal encoding, not a rule"),
    ("rng.rs", "LEGACY_12", "test vector captured from the legacy generator"),
    ("rng.rs", "LEGACY_0", "test vector captured from the legacy generator"),
    ("schedule.rs", "PRODUCTION", "gate set of a compiled schedule plan (which legacy modules the world has); pinned by the schedule conformance test, not a tunable number"),
    ("schedule.rs", "CAPTURE", "gate set of a compiled schedule plan (which legacy modules the world has); pinned by the schedule conformance test, not a tunable number"),
    ("schedule.rs", "TRAINING", "gate set of a compiled schedule plan (which legacy modules the world has); pinned by the schedule conformance test, not a tunable number"),
    ("schedule.rs", "ALL", "the full gate set (every legacy module present); pinned by the schedule conformance test, not a tunable number"),
    ("schedule.rs", "CAP", "bound of the test-only schedule trace buffer; not a rule"),
    ("schedule.rs", "N", "const generic length of a compiled schedule list; not a rule"),
    ("schedule.rs", "PRODUCTION_PLAN", "compiled schedule plan; tick order is pinned by the schedule conformance test (C-TICK), not a tunable number"),
    ("schedule.rs", "CAPTURE_PLAN", "compiled schedule plan; tick order is pinned by the schedule conformance test (C-TICK), not a tunable number"),
    ("schedule.rs", "TRAINING_PLAN", "compiled schedule plan; tick order is pinned by the schedule conformance test (C-TICK), not a tunable number"),
    ("schedule.rs", "PHASES", "legacy tick/hook/action table in legacy order; pinned by the schedule conformance test (C-TICK), carries no gameplay number"),
    ("schedule.rs", "AFTER_WEAPONS", "legacy tick/hook/action table in legacy order; pinned by the schedule conformance test (C-TICK), carries no gameplay number"),
    ("schedule.rs", "BEFORE_DAMAGE", "legacy tick/hook/action table in legacy order; pinned by the schedule conformance test (C-TICK), carries no gameplay number"),
    ("schedule.rs", "SYSTEMS", "legacy tick/hook/action table in legacy order; pinned by the schedule conformance test (C-TICK), carries no gameplay number"),
    ("schedule.rs", "MOVE_MODIFIERS", "legacy tick/hook/action table in legacy order; pinned by the schedule conformance test (C-TICK), carries no gameplay number"),
    ("schedule.rs", "MOD_SOURCES", "legacy tick/hook/action table in legacy order; pinned by the schedule conformance test (C-TICK), carries no gameplay number"),
    ("schedule.rs", "ACTIONS", "legacy tick/hook/action table in legacy order; pinned by the schedule conformance test (C-TICK), carries no gameplay number"),
    ("schedule.rs", "DROP_BODY", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "TELEPORTED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "ATTACK_STARTED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "WEAPON_SWAPPED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "HURT", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "PLAYER_KILLED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "EXECUTE_DENIED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "RAID_STARTED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "RUN_ENDED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "MOB_KILLED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "ARENA_HURT", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "FIGHTER_OUT", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "STATUS_APPLIED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "STAGGERED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "PLANNING_STARTED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "CAMP_CLEARED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "HIT_LANDED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "BLOCKED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "OVERKILLED", "hook name of the schedule's hook table (legacy WorldHooks key); an identifier, not a rule"),
    ("schedule.rs", "HOOKS", "legacy tick/hook/action table in legacy order; pinned by the schedule conformance test (C-TICK), carries no gameplay number"),
];

/// Rules that are tables rather than scalar rows: they are folded by `content_hash` directly (see content.rs). As
/// (file, name, reason).
const TABLES_FOLDED_BY_HASH: &[(&str, &str, &str)] = &[
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

/// Names declared as `const NAME` or `static NAME` (upper case identifiers; `const fn` and `$name` do not match).
fn declared_consts(code: &str) -> Vec<String> {
    let mut out = Vec::new();
    for kw in ["const ", "static "] {
        let mut from = 0;
        while let Some(i) = code[from..].find(kw) {
            let at = from + i;
            from = at + kw.len();
            if code[..at].chars().next_back().is_some_and(is_ident) {
                continue;
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
                out.push(name);
            }
        }
    }
    out
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
const GOLDEN_CONTENT_HASH: u64 = 0xf47c_30e6_c8ca_3493;

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
fn stagger_rule_is_registered_data() {
    assert_eq!(STAGGER_WEAPONS, &[WeaponId::Sword]);
    for w in WeaponId::ALL {
        assert_eq!(staggers(w), w == WeaponId::Sword, "{w:?}");
    }
}

/// Is `name`, declared in `file`, a number the registry does not account for? constants.rs declares only through content!
/// (REGISTRY itself is the macro's output); a hand-written const there would bypass the registry. Elsewhere a registered
/// name may not be declared at all: a second declaration of a registered number is a second, unhashed copy. An unregistered name needs an entry keyed by (file, name) in NON_GAMEPLAY or the folded tables.
fn is_stray(file: &str, name: &str, registered: &BTreeSet<&str>) -> bool {
    if file == "constants.rs" {
        return name != "REGISTRY";
    }
    if registered.contains(name) {
        return true;
    }
    !NON_GAMEPLAY
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
    let mut found = 0;
    for (file, code) in sources() {
        for name in declared_consts(&code) {
            found += 1;
            if is_stray(&file, &name, &registered) {
                stray.push(format!("{file}: {name}"));
            }
        }
    }
    assert!(found > 0, "the scan found no consts at all");
    assert!(
        stray.is_empty(),
        "consts that are neither in the content! registry nor in NON_GAMEPLAY (or registered names declared a second time): {stray:#?}\n\
         a gameplay number is one line in crates/rh-sim/src/constants.rs content!; anything else needs a reason in NON_GAMEPLAY"
    );
}

/// A registered number declared a second time (as a module split might do), or a gameplay `const ALL` / `DX` in a file that
/// is not the listed one, is a stray whatever its value.
#[test]
fn a_second_declaration_of_a_registered_name_is_a_stray() {
    let registered = registry_names();
    // The scan sees the declaration...
    let code = "pub const PLAYER_RADIUS: f64 = 13.0;\nconst NOT_A_RULE_X: u8 = 1;";
    assert_eq!(declared_consts(code), ["PLAYER_RADIUS", "NOT_A_RULE_X"]);
    // ...and rejects it outside constants.rs, with the same value or another.
    assert!(registered.contains("PLAYER_RADIUS"));
    assert!(is_stray("observe.rs", "PLAYER_RADIUS", &registered));
    assert!(is_stray("sim/combat.rs", "PLAYER_RADIUS", &registered));
    assert!(is_stray("constants.rs", "PLAYER_RADIUS", &registered));
    // No external site is left: the numbers that once lived in pathfind.rs and map.rs are used by registry name only.
    assert!(is_stray("pathfind.rs", "SNAP_RADIUS", &registered));
    assert!(is_stray("map.rs", "MASK_MELEE", &registered));
    // Exemptions are per file.
    assert!(!is_stray("pathfind.rs", "DX", &registered));
    assert!(is_stray("sim/combat.rs", "DX", &registered));
    assert!(is_stray("sim.rs", "ALL", &registered));
    assert!(!is_stray("content.rs", "ALL", &registered));
    assert!(is_stray("sim.rs", "NOT_A_RULE_X", &registered));
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
