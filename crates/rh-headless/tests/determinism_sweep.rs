use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const SHORT_CASE: &str = "practice-truncated-off";
static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

struct TestDir {
    root: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let sequence = NEXT_DIR.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "rh-determinism-sweep-{name}-{}-{nanos}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&root).expect("create test directory");
        Self { root }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn run(args: &[String]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_determinism_sweep"))
        .args(args)
        .output()
        .expect("run determinism_sweep")
}

fn diagnostics(output: &Output) -> String {
    format!(
        "status: {}\nstdout:\n{}\nstderr:\n{}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

fn assert_success(output: &Output) {
    assert!(output.status.success(), "{}", diagnostics(output));
}

fn assert_failure(output: &Output, expected: &[&str]) {
    assert!(!output.status.success(), "{}", diagnostics(output));
    let message = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
    .to_lowercase();
    assert!(
        !message.trim().is_empty(),
        "failure must include a diagnostic: {}",
        diagnostics(output)
    );
    if !expected.is_empty() {
        assert!(
            expected.iter().any(|needle| message.contains(needle)),
            "diagnostic did not contain any of {expected:?}: {}",
            diagnostics(output)
        );
    }
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| (*arg).to_owned()).collect()
}

fn valid_case(out: &Path) -> Vec<String> {
    vec![
        "case".to_owned(),
        "--scenario".to_owned(),
        SHORT_CASE.to_owned(),
        "--seed".to_owned(),
        "5".to_owned(),
        "--out".to_owned(),
        out.to_str().expect("UTF-8 output path").to_owned(),
    ]
}

fn field_after<'a>(json: &'a str, key: &str) -> &'a str {
    let needle = format!("\"{key}\":");
    let start = json
        .find(&needle)
        .unwrap_or_else(|| panic!("missing JSON field {key}: {json}"))
        + needle.len();
    &json[start..]
}

fn u64_field(json: &str, key: &str) -> u64 {
    let value = field_after(json, key);
    let end = value.find([',', '}', ']']).expect("JSON number terminator");
    value[..end]
        .parse()
        .unwrap_or_else(|_| panic!("JSON field {key} was not a u64: {json}"))
}

fn bool_field(json: &str, key: &str) -> bool {
    let value = field_after(json, key);
    if value.starts_with("true") {
        true
    } else if value.starts_with("false") {
        false
    } else {
        panic!("JSON field {key} was not a bool: {json}")
    }
}

fn results_json(manifest: &str) -> &str {
    let array = field_after(manifest, "results");
    assert!(
        array.starts_with('['),
        "results was not an array: {manifest}"
    );
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (index, ch) in array.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '[' => depth += 1,
            ']' => {
                depth = depth.checked_sub(1).expect("balanced results array");
                if depth == 0 {
                    return &array[..=index];
                }
            }
            _ => {}
        }
    }
    panic!("unterminated results array: {manifest}")
}

fn result_sections(manifest: &str) -> Vec<&str> {
    results_json(manifest).split("\"id\":").skip(1).collect()
}

fn totals_json(manifest: &str) -> &str {
    field_after(manifest, "totals")
}

fn read_nonempty(path: &Path) -> Vec<u8> {
    let bytes = fs::read(path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    assert!(!bytes.is_empty(), "{} was empty", path.display());
    bytes
}

#[test]
fn shortest_case_writes_nonempty_verified_artifacts_and_real_work() {
    let temp = TestDir::new("shortest");
    let out = temp.path("out");
    let output = run(&valid_case(&out));
    assert_success(&output);

    let manifest = read_nonempty(&out.join("manifest.json"));
    read_nonempty(&out.join("provenance.json"));
    read_nonempty(&out.join("replay.json"));
    let manifest = String::from_utf8(manifest).expect("UTF-8 manifest");
    assert!(manifest.ends_with('\n'), "manifest must end with a newline");

    let results = result_sections(&manifest);
    assert_eq!(results.len(), 1, "case must produce exactly one result");
    let result = results[0];
    assert!(result.starts_with("\"practice-truncated-off\""));
    assert_eq!(u64_field(result, "seed"), 5);
    assert_eq!(u64_field(result, "ticks"), 10);
    assert_eq!(u64_field(result, "replay_steps"), 10);
    assert!(!bool_field(result, "terminated"));
    assert!(bool_field(result, "truncated"));
    for counter in ["fresh_ticks", "fresh_compared_ticks", "replay_steps"] {
        assert!(u64_field(result, counter) > 0, "{counter} did no work");
    }

    let totals = totals_json(&manifest);
    assert_eq!(u64_field(totals, "scenarios"), 1);
    assert_eq!(u64_field(totals, "ticks"), 10);
    assert_eq!(u64_field(totals, "replay_steps"), 10);
    for counter in [
        "fresh_ticks",
        "fresh_compared_ticks",
        "checkpoint_restores",
        "continuation_ticks",
    ] {
        assert!(u64_field(totals, counter) > 0, "{counter} did no work");
    }
}

#[test]
fn repeated_cases_have_byte_identical_manifests_and_replays() {
    let temp = TestDir::new("repeat");
    let first = temp.path("first");
    let second = temp.path("second");

    let first_output = run(&valid_case(&first));
    assert_success(&first_output);
    let second_output = run(&valid_case(&second));
    assert_success(&second_output);

    for artifact in ["manifest.json", "replay.json"] {
        let left = read_nonempty(&first.join(artifact));
        let right = read_nonempty(&second.join(artifact));
        assert_eq!(left, right, "repeated {artifact} bytes differed");
    }
}

#[test]
fn ci_does_nonzero_work_and_accounts_for_terminal_and_truncated_cases() {
    let temp = TestDir::new("ci");
    let out = temp.path("out");
    let output = run(&strings(&[
        "ci",
        "--out",
        out.to_str().expect("UTF-8 output path"),
    ]));
    assert_success(&output);

    let manifest = read_nonempty(&out.join("manifest.json"));
    read_nonempty(&out.join("provenance.json"));
    read_nonempty(&out.join("replay.json"));
    let manifest = String::from_utf8(manifest).expect("UTF-8 manifest");
    let results = result_sections(&manifest);
    assert!(results.len() > 1, "CI inventory was not a real suite");

    let mut terminal = 0usize;
    let mut truncated = 0usize;
    let mut ticks = 0u64;
    let mut events = 0u64;
    let mut fresh_ticks = 0u64;
    let mut fresh_compared_ticks = 0u64;
    let mut replay_steps = 0u64;
    for result in results.iter().copied() {
        let result_ticks = u64_field(result, "ticks");
        assert!(result_ticks > 0, "scenario performed zero ticks: {result}");
        assert_eq!(u64_field(result, "replay_steps"), result_ticks);
        match (
            bool_field(result, "terminated"),
            bool_field(result, "truncated"),
        ) {
            (true, false) => terminal += 1,
            (false, true) => truncated += 1,
            _ => panic!("scenario had invalid stop accounting: {result}"),
        }
        ticks += result_ticks;
        events += u64_field(result, "events");
        fresh_ticks += u64_field(result, "fresh_ticks");
        fresh_compared_ticks += u64_field(result, "fresh_compared_ticks");
        replay_steps += u64_field(result, "replay_steps");
    }
    assert!(terminal > 0, "CI included no genuine terminal case");
    assert!(truncated > 0, "CI included no deliberately truncated case");

    let totals = totals_json(&manifest);
    assert_eq!(u64_field(totals, "scenarios"), results.len() as u64);
    for (key, expected) in [
        ("ticks", ticks),
        ("events", events),
        ("fresh_ticks", fresh_ticks),
        ("fresh_compared_ticks", fresh_compared_ticks),
        ("replay_steps", replay_steps),
    ] {
        assert_eq!(u64_field(totals, key), expected, "wrong total for {key}");
    }
    for counter in [
        "ticks",
        "fresh_ticks",
        "fresh_compared_ticks",
        "replay_steps",
        "checkpoint_restores",
        "continuation_ticks",
    ] {
        assert!(u64_field(totals, counter) > 0, "{counter} did no work");
    }
}

#[test]
fn malformed_command_lines_fail_informatively() {
    let temp = TestDir::new("invalid-cli");
    let cases: Vec<(&str, Vec<&str>, &[&str])> = vec![
        ("no arguments", vec![], &[]),
        (
            "unknown subcommand",
            vec!["unknown", "--out", "OUT"],
            &["unknown", "command", "usage"],
        ),
        (
            "ci missing out",
            vec!["ci"],
            &["out", "missing", "required"],
        ),
        (
            "soak missing out",
            vec!["soak"],
            &["out", "missing", "required"],
        ),
        (
            "case missing scenario",
            vec!["case", "--seed", "5", "--out", "OUT"],
            &["scenario", "missing", "required"],
        ),
        (
            "case missing seed",
            vec!["case", "--scenario", SHORT_CASE, "--out", "OUT"],
            &["seed", "missing", "required"],
        ),
        (
            "case missing out",
            vec!["case", "--scenario", SHORT_CASE, "--seed", "5"],
            &["out", "missing", "required"],
        ),
        (
            "scenario missing value",
            vec!["case", "--scenario"],
            &["scenario", "value", "missing", "required"],
        ),
        (
            "seed missing value",
            vec!["case", "--scenario", SHORT_CASE, "--seed"],
            &["seed", "value", "missing", "required"],
        ),
        (
            "out missing value",
            vec!["case", "--scenario", SHORT_CASE, "--seed", "5", "--out"],
            &["out", "value", "missing", "required"],
        ),
        (
            "unknown option",
            vec![
                "case",
                "--scenario",
                SHORT_CASE,
                "--seed",
                "5",
                "--out",
                "OUT",
                "--unknown",
            ],
            &["unknown", "unexpected"],
        ),
        (
            "duplicate scenario",
            vec![
                "case",
                "--scenario",
                SHORT_CASE,
                "--scenario",
                SHORT_CASE,
                "--seed",
                "5",
                "--out",
                "OUT",
            ],
            &["duplicate", "scenario"],
        ),
        (
            "duplicate seed",
            vec![
                "case",
                "--scenario",
                SHORT_CASE,
                "--seed",
                "5",
                "--seed",
                "5",
                "--out",
                "OUT",
            ],
            &["duplicate", "seed"],
        ),
        (
            "duplicate out",
            vec![
                "case",
                "--scenario",
                SHORT_CASE,
                "--seed",
                "5",
                "--out",
                "OUT",
                "--out",
                "OUT",
            ],
            &["duplicate", "out"],
        ),
        (
            "extra positional",
            vec![
                "case",
                "--scenario",
                SHORT_CASE,
                "--seed",
                "5",
                "--out",
                "OUT",
                "extra",
            ],
            &["extra", "unexpected", "unknown"],
        ),
        (
            "unknown scenario",
            vec![
                "case",
                "--scenario",
                "not-a-scenario",
                "--seed",
                "5",
                "--out",
                "OUT",
            ],
            &["not-a-scenario", "unknown", "scenario"],
        ),
        (
            "non-numeric seed",
            vec![
                "case",
                "--scenario",
                SHORT_CASE,
                "--seed",
                "five",
                "--out",
                "OUT",
            ],
            &["seed", "invalid", "u64"],
        ),
        (
            "negative seed",
            vec![
                "case",
                "--scenario",
                SHORT_CASE,
                "--seed",
                "-1",
                "--out",
                "OUT",
            ],
            &["seed", "invalid", "u64"],
        ),
        (
            "overflowing seed",
            vec![
                "case",
                "--scenario",
                SHORT_CASE,
                "--seed",
                "18446744073709551616",
                "--out",
                "OUT",
            ],
            &["seed", "invalid", "u64"],
        ),
    ];

    for (index, (name, template, expected)) in cases.into_iter().enumerate() {
        let out = temp.path(&format!("out-{index}"));
        let out = out.to_str().expect("UTF-8 output path");
        let args = template
            .iter()
            .map(|arg| if *arg == "OUT" { out } else { *arg })
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let output = run(&args);
        assert!(
            !output.status.success(),
            "{name} unexpectedly succeeded: {}",
            diagnostics(&output)
        );
        assert_failure(&output, expected);
    }
}

#[test]
fn nonempty_output_directory_fails_informatively() {
    let temp = TestDir::new("nonempty-output");
    let out = temp.path("out");
    fs::create_dir(&out).expect("create output directory");
    fs::write(out.join("occupied"), "keep me").expect("populate output directory");

    let output = run(&valid_case(&out));
    assert_failure(&output, &["empty", "occupied", "exists"]);
    assert_eq!(
        fs::read_to_string(out.join("occupied")).expect("existing file was removed"),
        "keep me"
    );
}
