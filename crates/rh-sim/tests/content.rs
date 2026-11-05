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
const GOLDEN_CONTENT_HASH: u64 = 0xb0b7_1697_09bd_0a83;

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
