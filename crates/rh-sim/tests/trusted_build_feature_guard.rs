//! P-SIM-BENCH-SEAM-1 guard (runs with or without the feature): the trusted rh-sim features (`trusted-build-setup`,
//! and `trusted-status-probes`, which turns it on) never reach a server build, and the trusted build API exists only
//! under its feature. Reads the workspace manifests, `src/lib.rs` and the two server build recipes as text.
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const TRUSTED: [&str; 2] = ["trusted-build-setup", "trusted-status-probes"];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Every workspace crate as (directory name, manifest text), in name order.
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

/// Each line of a manifest with the `[section]` header it sits under (comments dropped).
fn lines_by_section(text: &str) -> Vec<(String, String)> {
    let mut section = String::new();
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap().trim();
        if line.starts_with('[') {
            section = line.to_string();
        } else if !line.is_empty() {
            out.push((section.clone(), line.to_string()));
        }
    }
    out
}

/// A section that a `-p rh-server` build resolves: a dependency table other than dev-dependencies.
fn shipped_dependencies(section: &str) -> bool {
    section.ends_with("dependencies]") && !section.ends_with("dev-dependencies]")
}

/// The `[features]` entries of a manifest as (feature, the items it enables); a list may span lines.
fn features(text: &str) -> Vec<(String, Vec<String>)> {
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    let mut open = false;
    for (section, line) in lines_by_section(text) {
        if section != "[features]" {
            continue;
        }
        let rest = if open {
            line.as_str()
        } else {
            let (name, value) = line.split_once('=').expect("a feature line");
            out.push((name.trim().to_string(), Vec::new()));
            value
        };
        let items = &mut out.last_mut().unwrap().1;
        items.extend(
            rest.split(['[', ']', ','])
                .map(|s| s.trim().trim_matches('"'))
                .filter(|s| !s.is_empty())
                .map(str::to_string),
        );
        open = !rest.contains(']');
    }
    out
}

/// Every (crate, feature) that turns on a trusted rh-sim feature, directly or through other features (a fixpoint).
fn leading_features(manifests: &[(String, String)]) -> BTreeSet<(String, String)> {
    let mut lead: BTreeSet<(String, String)> = TRUSTED
        .iter()
        .map(|f| ("rh-sim".to_string(), f.to_string()))
        .collect();
    loop {
        let before = lead.len();
        for (krate, text) in manifests {
            for (name, items) in features(text) {
                let leads = items.iter().any(|item| match item.split_once('/') {
                    Some((dep, f)) => lead.contains(&(dep.trim_end_matches('?').into(), f.into())),
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

/// Every way the given manifests and server build recipes (name, text) let a server build turn on a trusted feature.
fn leaks(manifests: &[(String, String)], recipes: &[(String, String)]) -> Vec<String> {
    let mut out = Vec::new();
    let lead = leading_features(manifests);
    let server = manifests
        .iter()
        .find(|(c, _)| c == "rh-server")
        .map_or("", |(_, t)| t.as_str());
    for name in TRUSTED {
        if server.contains(name) {
            out.push(format!("rh-server's manifest names {name}"));
        }
    }
    for (krate, f) in &lead {
        if krate == "rh-server" {
            out.push(format!(
                "rh-server feature {f} turns on a trusted rh-sim feature"
            ));
        }
        if server.contains(&format!("{krate}/{f}")) {
            out.push(format!("rh-server's manifest turns on {krate}/{f}"));
        }
    }
    // No crate turns one on in a dependency a server build resolves: every crate rh-server depends on would carry it.
    for (krate, text) in manifests {
        for (section, line) in lines_by_section(text) {
            if !shipped_dependencies(&section) {
                continue;
            }
            for name in TRUSTED {
                if line.contains(name) {
                    out.push(format!("{krate} {section}: `{line}` turns on {name}"));
                }
            }
            for (dep, f) in &lead {
                let names_dep =
                    line.starts_with(&format!("{dep} ")) || line.starts_with(&format!("{dep}="));
                if names_dep && line.contains(&format!("\"{f}\"")) {
                    out.push(format!("{krate} {section}: `{line}` turns on {dep}/{f}"));
                }
            }
        }
    }
    // The server's build recipes pass no trusted feature on the command line.
    for (recipe, text) in recipes {
        if text.contains("trusted") {
            out.push(format!("{recipe} names a trusted feature"));
        }
        for (krate, f) in &lead {
            if text.contains(&format!("{krate}/{f}")) {
                out.push(format!("{recipe} turns on {krate}/{f}"));
            }
        }
    }
    out
}

#[test]
fn no_server_build_can_turn_on_a_trusted_feature() {
    let recipes: Vec<(String, String)> =
        ["hosting/Dockerfile", "hosting/scripts/fleet-local/build.sh"]
            .iter()
            .map(|r| {
                (
                    r.to_string(),
                    std::fs::read_to_string(root().join(r)).unwrap(),
                )
            })
            .collect();
    let found = leaks(&manifests(), &recipes);
    assert!(
        found.is_empty(),
        "a server build can turn on a trusted feature: {found:#?}"
    );
}

#[test]
fn the_guard_sees_a_leak_through_another_crates_feature() {
    let sim = "[features]\ntrusted-status-probes = [\n  \"schedule-trace\",\n  \"trusted-build-setup\",\n]\ntrusted-build-setup = []\n";
    let headless = "[dependencies]\nrh-sim = { path = \"../rh-sim\" }\n[features]\nelite-bench = [\"rh-sim/trusted-build-setup\"]\n[dev-dependencies]\nrh-sim = { path = \"../rh-sim\", features = [\"trusted-status-probes\"] }\n";
    let clean_server = "[features]\nbench = [\"rh-sim/bench\"]\n[dependencies]\nrh-headless = { path = \"../rh-headless\" }\n";
    let world = |server: &str| {
        vec![
            ("rh-headless".to_string(), headless.to_string()),
            ("rh-server".to_string(), server.to_string()),
            ("rh-sim".to_string(), sim.to_string()),
        ]
    };
    let none: Vec<(String, String)> = Vec::new();
    assert!(
        leaks(&world(clean_server), &none).is_empty(),
        "an opt-in rh-headless feature and a dev-dependency are not leaks"
    );
    for server in [
        "[features]\nbench = [\"rh-headless/elite-bench\"]\n",
        "[dependencies]\nrh-headless = { path = \"../rh-headless\", features = [\"elite-bench\"] }\n",
        "[dependencies]\nrh-sim = { path = \"../rh-sim\", features = [\"trusted-status-probes\"] }\n",
    ] {
        assert!(!leaks(&world(server), &none).is_empty(), "the guard sees {server:?}");
    }
    let leaky_headless =
        "[dependencies]\nrh-sim = { path = \"../rh-sim\", features = [\"trusted-build-setup\"] }\n";
    let mut shipped = world(clean_server);
    shipped[0].1 = leaky_headless.to_string();
    assert!(
        !leaks(&shipped, &none).is_empty(),
        "the guard sees a shipped dependency of another crate"
    );
    let recipe = vec![(
        "Dockerfile".to_string(),
        "cargo build -p rh-server --features rh-headless/elite-bench".to_string(),
    )];
    assert!(
        !leaks(&world(clean_server), &recipe).is_empty(),
        "the guard sees a recipe"
    );
}

#[test]
fn the_trusted_build_api_exists_only_under_its_feature() {
    let manifests = manifests();
    let sim = &manifests.iter().find(|(c, _)| c == "rh-sim").unwrap().1;
    let features = features(sim);
    let enables = |name: &str| {
        features
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, items)| items.clone())
            .unwrap_or_else(|| panic!("rh-sim declares feature {name}"))
    };
    assert!(
        enables("trusted-build-setup").is_empty(),
        "trusted-build-setup enables nothing else"
    );
    assert!(
        enables("trusted-status-probes").contains(&"trusted-build-setup".to_string()),
        "trusted-status-probes turns on trusted-build-setup: the gate and CI test rh-sim with it alone"
    );
    let lib = std::fs::read_to_string(root().join("crates/rh-sim/src/lib.rs")).unwrap();
    assert!(
        lib.contains("#[cfg(feature = \"trusted-build-setup\")]\npub mod trusted_build;\n"),
        "lib.rs declares the module under its feature"
    );
    assert_eq!(
        lib.matches("trusted_build").count(),
        1,
        "lib.rs names the module once (no re-export outside the feature)"
    );
}
