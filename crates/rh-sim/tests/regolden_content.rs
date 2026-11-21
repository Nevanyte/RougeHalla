//! P-CONTENT-REGOLDEN-1 oracle: `scripts/regolden-content.sh` finds, names and refreshes every pinned copy of the content
//! hash. The hash moves three times in the augment and elite rework; this is the one command that moves every copy.
//!
//! Script contract (see docs/backlog/packets/P-CONTENT-REGOLDEN-1.md):
//! * `--check [--root DIR] [--hash HEX]`: exit 0 when all six copies hold the hash, else exit 1 and print one
//!   `STALE <repo-relative path>` line per stale copy. `--hash` replaces the cargo computation (the tests pass the
//!   hash `rh_sim` computes in-process, so no nested cargo run is needed). A malformed `--hash` exits 2.
//! * `[--root DIR] [--hash HEX] [--text-only] [--dry-run]` (no `--check`): rewrite the four text copies under DIR keeping
//!   their formatting byte for byte; unless `--text-only`, run the documented commands of the two protected copies.
//!   `--dry-run` edits nothing and prints `WOULD EDIT <path>` / `WOULD RUN <command>` lines.
use rh_sim::content::content_hash;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const SCRIPT: &str = "scripts/regolden-content.sh";
const GOLDEN_RS: &str = "crates/rh-sim/tests/content.rs";
const TAPE: &str = "parity/abilities/hash-tape.json";
const ARCHETYPES: &str = "protocol/fixtures/archetypes_v1.json";
const CHECK_MJS: &str = "tools/unity-browser-reload-proof/check.mjs";
const COMPANION_MJS: &str = "tools/unity-browser-reload-proof/normal-companion.mjs";
const BAKED: &str = "client-unity/UnityProject/Assets/Scripts/BakedContent.cs";
const TEXT_COPIES: [&str; 4] = [GOLDEN_RS, CHECK_MJS, COMPANION_MJS, BAKED];
const PROTECTED_COPIES: [&str; 2] = [TAPE, ARCHETYPES];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn all_copies() -> Vec<&'static str> {
    TEXT_COPIES
        .iter()
        .chain(&PROTECTED_COPIES)
        .copied()
        .collect()
}

fn hex(h: u64) -> String {
    format!("{h:016x}")
}

fn underscored(h: &str) -> String {
    format!("{}_{}_{}_{}", &h[0..4], &h[4..8], &h[8..12], &h[12..16])
}

fn run(root: Option<&Path>, args: &[&str]) -> Output {
    let mut cmd = Command::new("bash");
    cmd.arg(repo().join(SCRIPT)).current_dir(repo());
    if let Some(root) = root {
        cmd.arg("--root").arg(root);
    }
    cmd.args(args)
        .output()
        .unwrap_or_else(|e| panic!("cannot run {SCRIPT}: {e}"))
}

fn text(o: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&o.stdout),
        String::from_utf8_lossy(&o.stderr)
    )
}

fn stale_lines(o: &Output) -> Vec<String> {
    let mut v: Vec<String> = text(o)
        .lines()
        .filter_map(|l| l.strip_prefix("STALE ").map(|p| p.trim().to_string()))
        .collect();
    v.sort();
    v
}

/// A temporary root holding only the six pinned copies, at their repo-relative paths.
fn temp_root(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("rh-regolden-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    for rel in all_copies() {
        let to = root.join(rel);
        std::fs::create_dir_all(to.parent().unwrap()).unwrap();
        std::fs::copy(repo().join(rel), &to).unwrap_or_else(|e| panic!("copy {rel}: {e}"));
    }
    root
}

/// Rewrites every spelling of the current hash in `rel` under `root` to a stale value.
fn stale(root: &Path, rel: &str) {
    let now = hex(content_hash());
    let old = hex(content_hash() ^ 1);
    let path = root.join(rel);
    let body = std::fs::read_to_string(&path).unwrap();
    let new = body
        .replace(&underscored(&now), &underscored(&old))
        .replace(&now, &old);
    assert_ne!(
        body, new,
        "{rel} holds no spelling of the current hash {now}"
    );
    std::fs::write(&path, new).unwrap();
}

fn bytes(root: &Path, rel: &str) -> Vec<u8> {
    std::fs::read(root.join(rel)).unwrap()
}

#[test]
fn check_passes_on_the_current_tree() {
    let h = hex(content_hash());
    let o = run(None, &["--check", "--hash", &h]);
    assert!(
        o.status.success(),
        "regolden-content.sh --check reports stale copies on a tree whose hash is {h}:\n{}",
        text(&o)
    );
    assert!(stale_lines(&o).is_empty(), "{}", text(&o));
}

#[test]
fn check_names_exactly_the_one_stale_copy_for_each_of_the_six() {
    let h = hex(content_hash());
    for rel in all_copies() {
        let root = temp_root("one");
        stale(&root, rel);
        let o = run(Some(&root), &["--check", "--hash", &h]);
        assert_eq!(
            o.status.code(),
            Some(1),
            "--check must exit 1 when {rel} is stale:\n{}",
            text(&o)
        );
        assert_eq!(
            stale_lines(&o),
            vec![rel.to_string()],
            "--check must name {rel} and nothing else:\n{}",
            text(&o)
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}

#[test]
fn check_on_the_untouched_copy_set_passes_and_names_nothing() {
    let root = temp_root("clean");
    let o = run(Some(&root), &["--check", "--hash", &hex(content_hash())]);
    assert!(o.status.success(), "{}", text(&o));
    assert!(stale_lines(&o).is_empty(), "{}", text(&o));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn text_only_regen_restores_the_four_text_copies_byte_for_byte_and_leaves_protected_ones_alone() {
    let h = hex(content_hash());
    let root = temp_root("regen");
    let want: Vec<(&str, Vec<u8>)> = all_copies()
        .into_iter()
        .map(|r| (r, bytes(&root, r)))
        .collect();
    for rel in all_copies() {
        stale(&root, rel);
    }
    let staled: Vec<Vec<u8>> = all_copies().iter().map(|r| bytes(&root, r)).collect();
    let o = run(Some(&root), &["--hash", &h, "--text-only"]);
    assert!(o.status.success(), "regen failed:\n{}", text(&o));
    for (i, (rel, original)) in want.iter().enumerate() {
        if TEXT_COPIES.contains(rel) {
            assert_eq!(
                &bytes(&root, rel),
                original,
                "{rel} is not restored byte for byte (formatting must survive)"
            );
        } else {
            assert_eq!(
                bytes(&root, rel),
                staled[i],
                "{rel} is protected: only its documented command may rewrite it, never --text-only"
            );
        }
    }
    let o = run(Some(&root), &["--check", "--hash", &h]);
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    let mut protected: Vec<String> = PROTECTED_COPIES.iter().map(|s| s.to_string()).collect();
    protected.sort();
    assert_eq!(
        stale_lines(&o),
        protected,
        "after --text-only exactly the protected copies stay stale"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn dry_run_names_the_documented_commands_and_edits_nothing() {
    let root = temp_root("dry");
    for rel in all_copies() {
        stale(&root, rel);
    }
    let before: Vec<Vec<u8>> = all_copies().iter().map(|r| bytes(&root, r)).collect();
    let o = run(Some(&root), &["--hash", &hex(content_hash()), "--dry-run"]);
    assert!(o.status.success(), "{}", text(&o));
    let out = text(&o);
    let after: Vec<Vec<u8>> = all_copies().iter().map(|r| bytes(&root, r)).collect();
    assert_eq!(before, after, "--dry-run edited a file");
    for rel in TEXT_COPIES {
        assert!(
            out.lines()
                .any(|l| l.starts_with("WOULD EDIT") && l.contains(rel)),
            "--dry-run does not name {rel}:\n{out}"
        );
    }
    // The two protected copies are refreshed by their own commands only (hitbox_fixtures.rs header; the
    // `record_ability_hash_tape` test in abilities/source_tests/hash_tape.rs).
    assert!(
        out.lines()
            .any(|l| l.starts_with("WOULD RUN") && l.contains("hitbox-fixtures")),
        "no documented command for {ARCHETYPES}:\n{out}"
    );
    assert!(
        out.lines()
            .any(|l| l.starts_with("WOULD RUN") && l.contains("record_ability_hash_tape")),
        "no documented command for {TAPE}:\n{out}"
    );
    for rel in PROTECTED_COPIES {
        assert!(
            !out.lines()
                .any(|l| l.starts_with("WOULD EDIT") && l.contains(rel)),
            "{rel} is protected; it must not be hand-edited:\n{out}"
        );
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_malformed_hash_is_refused() {
    let root = temp_root("bad");
    // Built at run time: a literal copy of the hash in this file would itself be a seventh pinned copy.
    let prefixed = format!("0x{}", hex(content_hash()));
    let short = hex(content_hash())[..8].to_string();
    for bad in ["zzzz", short.as_str(), prefixed.as_str()] {
        let o = run(Some(&root), &["--check", "--hash", bad]);
        assert_eq!(o.status.code(), Some(2), "--hash {bad}: {}", text(&o));
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn only_the_six_known_files_name_the_current_hash() {
    // The list in the packet is complete and stays so: a seventh copy (like frost_wall_content.rs's former value pin)
    // would break on every move. Docs are history and are not scanned.
    let now = hex(content_hash());
    let needles = [now.clone(), underscored(&now)];
    let roots = [
        "crates",
        "tools",
        "protocol",
        "parity",
        "scripts",
        "client-unity/RoguehallaNet",
        "client-unity/RoguehallaNet.Tests",
        "client-unity/UnityProject/Assets",
    ];
    let exts = [
        "rs", "mjs", "js", "cjs", "cs", "json", "sh", "py", "ts", "mts", "toml",
    ];
    let mut hits = Vec::new();
    for r in roots {
        scan(&repo().join(r), &repo(), &exts, &needles, &mut hits);
    }
    hits.sort();
    let mut want: Vec<String> = all_copies().iter().map(|s| s.to_string()).collect();
    want.sort();
    assert_eq!(
        hits, want,
        "files naming the current content hash {now} (retire value pins; only the six pinned copies may)"
    );
}

fn scan(dir: &Path, base: &Path, exts: &[&str], needles: &[String], hits: &mut Vec<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            if !matches!(
                name.as_str(),
                "target" | "node_modules" | ".git" | "Library" | "Temp"
            ) {
                scan(&p, base, exts, needles, hits);
            }
        } else if p
            .extension()
            .and_then(|x| x.to_str())
            .is_some_and(|x| exts.contains(&x))
        {
            if let Ok(body) = std::fs::read_to_string(&p) {
                if needles.iter().any(|n| body.contains(n.as_str())) {
                    let rel = p.strip_prefix(base).unwrap_or(&p);
                    hits.push(rel.to_string_lossy().replace("/../", "/"));
                }
            }
        }
    }
}

#[test]
fn the_wall_test_keeps_no_value_pin_of_its_own() {
    let body =
        std::fs::read_to_string(repo().join("crates/rh-sim/tests/frost_wall_content.rs")).unwrap();
    assert!(
        !body.contains("WALL_CONTENT_HASH"),
        "frost_wall_content.rs still pins the hash value (WALL_CONTENT_HASH); retire it as c9606e6eb retired the tape \
         digest: the copies are checked against tests/content.rs's GOLDEN_CONTENT_HASH, which the script rewrites"
    );
}

#[test]
fn the_command_is_documented_where_a_contributor_looks() {
    let contributing = std::fs::read_to_string(repo().join("CONTRIBUTING.md")).unwrap();
    assert!(
        contributing.contains("scripts/regolden-content.sh"),
        "CONTRIBUTING.md does not document scripts/regolden-content.sh"
    );
    let guide = std::fs::read_to_string(repo().join("docs/agent/AUGMENT_REWORK.md"))
        .expect("docs/agent/AUGMENT_REWORK.md exists (create it if P-AUG-RULES-1 has not)");
    assert!(
        guide.contains("scripts/regolden-content.sh"),
        "docs/agent/AUGMENT_REWORK.md has no section on scripts/regolden-content.sh"
    );
}

/// The implementer's manual proof, not run by the gate (it runs cargo, the 63-case tape and the fixture writer):
/// regeneration on a consistent tree changes no file and leaves `--check` green.
#[test]
#[ignore = "runs cargo and rewrites protected copies in place; run by hand: cargo test -p rh-sim --test regolden_content -- --ignored"]
fn regeneration_on_a_consistent_tree_is_idempotent() {
    let status = || {
        let o = Command::new("git")
            .arg("-C")
            .arg(repo())
            .args(["status", "--porcelain"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&o.stdout).to_string()
    };
    let before = status();
    let o = run(None, &[]);
    assert!(o.status.success(), "regen failed:\n{}", text(&o));
    assert_eq!(before, status(), "regen changed files on a consistent tree");
    let o = run(None, &["--check"]);
    assert!(o.status.success(), "{}", text(&o));
}
