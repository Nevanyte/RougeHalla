//! P-ELITE-BENCH-1 guard, the second half (folded in from the P-SIM-BENCH-SEAM-1 review): the leak paths
//! `trusted_build_feature_guard.rs` does not read. It must also catch
//!   1. a trusted feature switched on through a `default = [...]` feature list (in rh-sim, or in a crate such as
//!      rh-headless whose `default` pulls in an `elite-bench`-style feature: rh-server depends on rh-headless with
//!      default features);
//!   2. a dotted dependency table (`[dependencies.rh-sim]` with its own `features = [...]`), including a list that
//!      spans lines;
//!   3. the workspace root manifest naming a trusted feature (`[workspace.dependencies]`);
//!   4. the resolved graph: `cargo tree -p rh-server -e normal,build,features --target all` names no trusted feature.
//!      It runs `--locked` (exactly the lock file's versions) but not `--offline`: a CI job that built only the sim
//!      crates has not downloaded rh-server's graph for every target (P-CI-GREEN-8), so cargo may fetch it. Where the
//!      registry already holds it (the gate), nothing is fetched.
//!
//! Each text rule has a negative test on a doctored manifest string. Runs with or without the feature.
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

const TRUSTED: [&str; 2] = ["trusted-build-setup", "trusted-status-probes"];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn manifests() -> Vec<(String, String)> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(root().join("crates")).unwrap() {
        let dir = entry.unwrap().path();
        let manifest = dir.join("Cargo.toml");
        if manifest.is_file() {
            let name = dir.file_name().unwrap().to_string_lossy().to_string();
            out.push((name, std::fs::read_to_string(manifest).unwrap()));
        }
    }
    out.sort();
    out
}

/// A manifest as (section header, the section's lines joined by newlines), comments dropped, in file order.
fn sections(text: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = vec![(String::new(), String::new())];
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap().trim();
        if line.starts_with('[') {
            out.push((line.to_string(), String::new()));
        } else if !line.is_empty() {
            let body = &mut out.last_mut().unwrap().1;
            body.push_str(line);
            body.push('\n');
        }
    }
    out
}

/// The items of the `[features]` entry `name` (a list may span lines).
fn feature_items(text: &str, name: &str) -> Vec<String> {
    let body = sections(text)
        .into_iter()
        .find(|(h, _)| h == "[features]")
        .map(|(_, b)| b)
        .unwrap_or_default();
    let mut items = Vec::new();
    let mut inside = false;
    for line in body.lines() {
        let rest = if inside {
            line
        } else if let Some((key, value)) = line.split_once('=') {
            if key.trim() != name {
                continue;
            }
            value
        } else {
            continue;
        };
        items.extend(
            rest.split(['[', ']', ','])
                .map(|s| s.trim().trim_matches('"'))
                .filter(|s| !s.is_empty())
                .map(str::to_string),
        );
        inside = !rest.contains(']');
        if !inside {
            break;
        }
    }
    items
}

fn feature_names(text: &str) -> Vec<String> {
    sections(text)
        .into_iter()
        .filter(|(h, _)| h == "[features]")
        .flat_map(|(_, b)| {
            b.lines()
                .filter_map(|l| {
                    let (k, _) = l.split_once('=')?;
                    let k = k.trim();
                    (!k.is_empty() && !k.contains(['"', ' ']) && !k.starts_with('"'))
                        .then(|| k.to_string())
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Every (crate, feature) that turns on a trusted rh-sim feature, directly or through other features.
fn leading(manifests: &[(String, String)]) -> BTreeSet<(String, String)> {
    let mut lead: BTreeSet<(String, String)> = TRUSTED
        .iter()
        .map(|f| ("rh-sim".to_string(), f.to_string()))
        .collect();
    loop {
        let before = lead.len();
        for (krate, text) in manifests {
            for name in feature_names(text) {
                let leads =
                    feature_items(text, &name)
                        .iter()
                        .any(|item| match item.split_once('/') {
                            Some((dep, f)) => {
                                lead.contains(&(dep.trim_end_matches('?').into(), f.into()))
                            }
                            None => lead.contains(&(krate.clone(), item.clone())),
                        });
                if leads {
                    lead.insert((krate.clone(), name));
                }
            }
        }
        if lead.len() == before {
            return lead;
        }
    }
}

/// The dependency a dotted dependency table header names (`[dependencies.rh-sim]`,
/// `[target.'cfg(unix)'.build-dependencies.rh-sim]`), when it is not a dev-dependency table.
fn dotted_shipped_dependency(header: &str) -> Option<String> {
    let inner = header.trim_start_matches('[').trim_end_matches(']');
    for table in ["dependencies.", "build-dependencies."] {
        if let Some(i) = inner.find(table) {
            let before = &inner[..i];
            if before.is_empty() || before.ends_with('.') {
                return Some(inner[i + table.len()..].trim_matches('"').to_string());
            }
        }
    }
    None
}

/// The leaks of `leaks()` in `trusted_build_feature_guard.rs` are not repeated here; these are the paths it misses.
fn extra_leaks(manifests: &[(String, String)], workspace_root: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lead = leading(manifests);
    for (krate, text) in manifests {
        // 1. A `default` list that reaches a trusted feature: every dependent resolves default features.
        for item in feature_items(text, "default") {
            let reaches = match item.split_once('/') {
                Some((dep, f)) => lead.contains(&(dep.trim_end_matches('?').into(), f.into())),
                None => {
                    lead.contains(&(krate.clone(), item.clone()))
                        || TRUSTED.contains(&item.as_str())
                }
            };
            if reaches {
                out.push(format!("{krate}: default feature list enables `{item}`, which turns on a trusted feature"));
            }
        }
        // 2. A dotted dependency table (the whole table, so a features list spanning lines is read).
        for (header, body) in sections(text) {
            let Some(dep) = dotted_shipped_dependency(&header) else {
                continue;
            };
            for name in TRUSTED {
                if body.contains(name) {
                    out.push(format!("{krate} {header}: names {name}"));
                }
            }
            for (k, f) in &lead {
                if *k == dep && body.contains(&format!("\"{f}\"")) {
                    out.push(format!("{krate} {header}: turns on {dep}/{f}"));
                }
            }
        }
    }
    // 3. The workspace root manifest names no trusted feature (`[workspace.dependencies]` would reach every member).
    for name in TRUSTED {
        if workspace_root.contains(name) {
            out.push(format!("the workspace Cargo.toml names {name}"));
        }
    }
    for (k, f) in &lead {
        if k != "rh-sim" && workspace_root.contains(&format!("\"{f}\"")) {
            out.push(format!("the workspace Cargo.toml turns on {k}/{f}"));
        }
    }
    out
}

#[test]
fn no_default_feature_or_dotted_table_or_workspace_entry_reaches_a_trusted_feature() {
    let root_manifest = std::fs::read_to_string(root().join("Cargo.toml")).unwrap();
    let found = extra_leaks(&manifests(), &root_manifest);
    assert!(
        found.is_empty(),
        "a server build can turn on a trusted feature: {found:#?}"
    );
}

#[test]
fn the_guard_sees_a_default_feature_list_that_reaches_a_trusted_feature() {
    let sim =
        "[features]\ntrusted-build-setup = []\ntrusted-status-probes = [\"trusted-build-setup\"]\n";
    let headless = |features: &str| {
        vec![
            (
                "rh-headless".to_string(),
                format!("[features]\nelite-bench = [\"rh-sim/trusted-build-setup\"]\n{features}"),
            ),
            ("rh-sim".to_string(), sim.to_string()),
        ]
    };
    assert!(
        extra_leaks(&headless("bench = []\n"), "").is_empty(),
        "an opt-in feature that is not in default is not a leak"
    );
    for default in [
        "default = [\"elite-bench\"]\n",
        "default = [\n  \"bench\",\n  \"elite-bench\",\n]\nbench = []\n",
        "default = [\"rh-sim/trusted-build-setup\"]\n",
    ] {
        assert!(
            !extra_leaks(&headless(default), "").is_empty(),
            "the guard sees {default:?}"
        );
    }
    // rh-sim's own default list.
    let sim_default = vec![(
        "rh-sim".to_string(),
        format!("{sim}default = [\"trusted-build-setup\"]\n"),
    )];
    assert!(!extra_leaks(&sim_default, "").is_empty());
}

#[test]
fn the_guard_sees_a_dotted_dependency_table() {
    let sim = "[features]\ntrusted-build-setup = []\n".to_string();
    let headless = "[features]\nelite-bench = [\"rh-sim/trusted-build-setup\"]\n".to_string();
    let with_server = |server: &str| {
        vec![
            ("rh-headless".to_string(), headless.clone()),
            ("rh-server".to_string(), server.to_string()),
            ("rh-sim".to_string(), sim.clone()),
        ]
    };
    let clean = "[dependencies.rh-sim]\npath = \"../rh-sim\"\n[dev-dependencies.rh-sim]\npath = \"../rh-sim\"\nfeatures = [\"trusted-build-setup\"]\n";
    assert!(
        extra_leaks(&with_server(clean), "").is_empty(),
        "a dev-dependency table is not shipped"
    );
    for server in [
        "[dependencies.rh-sim]\npath = \"../rh-sim\"\nfeatures = [\"trusted-build-setup\"]\n",
        "[dependencies.rh-sim]\npath = \"../rh-sim\"\nfeatures = [\n  \"bench\",\n  \"trusted-build-setup\",\n]\n",
        "[dependencies.rh-headless]\npath = \"../rh-headless\"\nfeatures = [\"elite-bench\"]\n",
        "[build-dependencies.rh-headless]\npath = \"../rh-headless\"\nfeatures = [\"elite-bench\"]\n",
        "[target.'cfg(unix)'.dependencies.rh-headless]\nfeatures = [\"elite-bench\"]\n",
    ] {
        assert!(
            !extra_leaks(&with_server(server), "").is_empty(),
            "the guard sees {server:?}"
        );
    }
}

#[test]
fn the_guard_sees_a_workspace_root_entry() {
    let world = vec![(
        "rh-sim".to_string(),
        "[features]\ntrusted-build-setup = []\n".to_string(),
    )];
    assert!(extra_leaks(&world, "[workspace]\nmembers = [\"crates/*\"]\n").is_empty());
    assert!(!extra_leaks(
        &world,
        "[workspace.dependencies]\nrh-sim = { path = \"crates/rh-sim\", features = [\"trusted-build-setup\"] }\n"
    )
    .is_empty());
}

/// The trusted feature names a `cargo tree` line carries as a whole feature (`rh-sim feature "trusted-build-setup"`).
fn trusted_in_tree(tree: &str) -> Vec<String> {
    tree.lines()
        .filter(|l| {
            TRUSTED
                .iter()
                .any(|t| l.contains(&format!("feature \"{t}\"")))
        })
        .map(|l| l.trim().to_string())
        .collect()
}

#[test]
fn the_resolved_server_graph_names_no_trusted_feature() {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let out = Command::new(cargo)
        .args([
            "tree",
            "--locked",
            "-p",
            "rh-server",
            "-e",
            "normal,build,features",
            "--target",
            "all",
        ])
        .current_dir(root())
        .output()
        .expect("cargo tree starts");
    assert!(
        out.status.success(),
        "cargo tree runs locked: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let tree = String::from_utf8(out.stdout).unwrap();
    assert!(
        tree.contains("rh-sim feature \"default\""),
        "the tree is the real resolved graph (it lists rh-sim's features), not an empty answer"
    );
    let found = trusted_in_tree(&tree);
    assert!(
        found.is_empty(),
        "a trusted feature is in rh-server's resolved graph: {found:#?}"
    );
}

#[test]
fn the_tree_check_sees_a_trusted_feature_line() {
    let leaky =
        "rh-server v0.1.0\n├── rh-sim feature \"trusted-build-setup\"\n│   └── rh-sim v0.1.0\n";
    assert_eq!(trusted_in_tree(leaky).len(), 1);
    let clean = "├── untrusted feature \"default\"\n│   └── untrusted v0.9.0\n└── rh-sim feature \"bench\"\n";
    assert!(
        trusted_in_tree(clean).is_empty(),
        "an unrelated crate whose name ends in `trusted` is not a hit"
    );
}
