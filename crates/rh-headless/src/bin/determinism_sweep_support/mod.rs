mod sha256;

use rh_headless::digest::{fold_all, OutcomeDigest};
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::scripted::Brawler;
use rh_sim::checkpoint::CHECKPOINT_FORMAT;
use rh_sim::replay::{apply_input, run_replay, Replay, ReplayInput, BUILD_ID, REPLAY_FORMAT};
use rh_sim::{FactionId, FactionMode, Sim, SimConfig, OBSERVATION_VERSION};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;
use std::time::Instant;

const INVENTORY_FORMAT: &str = "rh-determinism-inventory/1";
const MANIFEST_FORMAT: &str = "rh-determinism-manifest/1";
const FOLD_FORMAT: &str = "rh-determinism-fold/1";
const PROVENANCE_FORMAT: &str = "rh-determinism-provenance/1";
const MAP_PATH: &str = "crates/rh-sim/src/mapdata/fixtures/seed1.map.json";
const INVENTORY_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tools/determinism/inventory-v1.json"
));

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Inventory {
    format: String,
    ci: Vec<ScenarioSpec>,
    soak: Vec<ScenarioSpec>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ScenarioSpec {
    id: String,
    seed: u64,
    arena: ArenaSpec,
    players: Vec<PlayerSpec>,
    sim: SimSpec,
    max_ticks: u32,
    checkpoint_steps: Vec<u32>,
    expected_stop: ExpectedStop,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
enum ArenaSpec {
    Name(String),
    File { file: MapFileSpec },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MapFileSpec {
    path: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PlayerSpec {
    profile: String,
    faction: FactionId,
    policy: String,
    cadence: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SimSpec {
    min_players: usize,
    lobby_seconds: f64,
    fill_seconds: f64,
    pvp_rules: bool,
    weapon_specials: bool,
    faction_mode: FactionMode,
}

impl From<&SimSpec> for SimConfig {
    fn from(spec: &SimSpec) -> Self {
        Self {
            walk_hints: None,
            hitboxes: Default::default(),
            mob_spacing: Default::default(),
            regen: false,
            min_players: spec.min_players,
            lobby_seconds: spec.lobby_seconds,
            fill_seconds: spec.fill_seconds,
            pvp_rules: spec.pvp_rules,
            weapon_specials: spec.weapon_specials,
            faction_mode: spec.faction_mode,
            mob_mode: rh_sim::mob_runtime::MobMode::Off,
            initial_loot: false,
            consumables: true,
            hazards: rh_sim::terrain::Mode::Off,
            abilities: rh_sim::abilities::Mode::Off,
            wish_lock_ms: 45_000.,
            lifecycle: rh_sim::ArenaMode::Off,
            quests: false,
            training: false,
            dummies: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ExpectedStop {
    Terminal,
    Truncated,
}

#[derive(Debug)]
struct SweepError {
    scenario: Option<String>,
    seed: Option<u64>,
    tick: Option<u32>,
    component: String,
    message: String,
}

impl SweepError {
    fn new(component: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            scenario: None,
            seed: None,
            tick: None,
            component: component.into(),
            message: message.into(),
        }
    }

    fn at(
        spec: &ScenarioSpec,
        tick: Option<u32>,
        component: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            scenario: Some(spec.id.clone()),
            seed: Some(spec.seed),
            tick,
            component: component.into(),
            message: message.into(),
        }
    }
}

impl fmt::Display for SweepError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(scenario) = &self.scenario {
            write!(f, "scenario {scenario}")?;
            if let Some(seed) = self.seed {
                write!(f, " seed {seed}")?;
            }
            if let Some(tick) = self.tick {
                write!(f, " tick {tick}")?;
            }
            write!(f, ": ")?;
        }
        write!(f, "{}: {}", self.component, self.message)
    }
}

#[derive(Serialize)]
struct Failure {
    format: &'static str,
    scenario: Option<String>,
    seed: Option<u64>,
    tick: Option<u32>,
    component: String,
    message: String,
    reproduction: String,
}

#[derive(Debug)]
enum Preset {
    Ci,
    Soak,
    Case { scenario: String, seed: u64 },
}

#[derive(Debug)]
struct Cli {
    preset: Preset,
    out: PathBuf,
    command: String,
}

fn posix_shell_escape(argument: &str) -> String {
    format!("'{}'", argument.replace('\'', "'\\''"))
}

fn posix_shell_command(args: &[String]) -> String {
    args.iter()
        .map(|argument| posix_shell_escape(argument))
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_cli(args: &[String]) -> Result<Cli, SweepError> {
    if args.len() < 2 {
        return Err(SweepError::new(
            "cli",
            "usage: determinism_sweep ci|soak --out DIR, or determinism_sweep case --scenario ID --seed U64 --out DIR",
        ));
    }
    let command = posix_shell_command(args);
    let mode = args[1].as_str();
    let rest = &args[2..];
    let mut scenario = None;
    let mut seed = None;
    let mut out = None;
    let allowed_case = mode == "case";
    if !matches!(mode, "ci" | "soak" | "case") {
        return Err(SweepError::new("cli", format!("unknown command {mode:?}")));
    }
    let mut i = 0;
    while i < rest.len() {
        let flag = rest[i].as_str();
        if !matches!(flag, "--out" | "--scenario" | "--seed") {
            return Err(SweepError::new("cli", format!("unknown argument {flag:?}")));
        }
        if (!allowed_case && flag != "--out") || (allowed_case && flag == "--out" && out.is_some())
        {
            return Err(SweepError::new(
                "cli",
                format!("argument {flag} is not allowed here or was duplicated"),
            ));
        }
        let value = rest
            .get(i + 1)
            .ok_or_else(|| SweepError::new("cli", format!("missing value for {flag}")))?;
        if value.starts_with("--") {
            return Err(SweepError::new("cli", format!("missing value for {flag}")));
        }
        match flag {
            "--out" => {
                if out.is_some() {
                    return Err(SweepError::new("cli", "duplicate --out"));
                }
                if value.is_empty() {
                    return Err(SweepError::new("cli", "--out must not be empty"));
                }
                out = Some(PathBuf::from(value));
            }
            "--scenario" => {
                if scenario.is_some() {
                    return Err(SweepError::new("cli", "duplicate --scenario"));
                }
                if value.is_empty() {
                    return Err(SweepError::new("cli", "--scenario must not be empty"));
                }
                scenario = Some(value.clone());
            }
            "--seed" => {
                if seed.is_some() {
                    return Err(SweepError::new("cli", "duplicate --seed"));
                }
                if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
                    return Err(SweepError::new(
                        "cli",
                        "--seed must be an unsigned decimal integer",
                    ));
                }
                seed = Some(
                    value
                        .parse::<u64>()
                        .map_err(|_| SweepError::new("cli", "--seed is outside the u64 range"))?,
                );
            }
            _ => unreachable!(),
        }
        i += 2;
    }
    let out = out.ok_or_else(|| SweepError::new("cli", "missing --out"))?;
    let preset = match mode {
        "ci" => Preset::Ci,
        "soak" => Preset::Soak,
        "case" => Preset::Case {
            scenario: scenario.ok_or_else(|| SweepError::new("cli", "missing --scenario"))?,
            seed: seed.ok_or_else(|| SweepError::new("cli", "missing --seed"))?,
        },
        _ => unreachable!(),
    };
    Ok(Cli {
        preset,
        out,
        command,
    })
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("the repository root exists")
}

fn prepare_out(path: &Path) -> Result<(), SweepError> {
    if path.exists() {
        if !path.is_dir() {
            return Err(SweepError::new("output", "--out is not a directory"));
        }
        let mut entries = path
            .read_dir()
            .map_err(|e| SweepError::new("output", format!("{}: {e}", path.display())))?;
        if entries.next().is_some() {
            return Err(SweepError::new(
                "output",
                "--out must name a new or empty directory",
            ));
        }
        Ok(())
    } else {
        std::fs::create_dir_all(path)
            .map_err(|e| SweepError::new("output", format!("{}: {e}", path.display())))
    }
}

fn load_inventory() -> Result<Inventory, SweepError> {
    let inventory: Inventory = serde_json::from_str(INVENTORY_JSON)
        .map_err(|e| SweepError::new("inventory", format!("invalid inventory JSON: {e}")))?;
    validate_inventory(&inventory)?;
    Ok(inventory)
}

fn validate_inventory(inventory: &Inventory) -> Result<(), SweepError> {
    if inventory.format != INVENTORY_FORMAT {
        return Err(SweepError::new("inventory", "wrong inventory format"));
    }
    if inventory.ci.is_empty() || inventory.soak.is_empty() {
        return Err(SweepError::new(
            "inventory",
            "inventory presets must be nonempty",
        ));
    }
    validate_scenarios(&inventory.ci, "ci")?;
    validate_scenarios(&inventory.soak, "soak")?;
    if inventory.soak.len() < inventory.ci.len()
        || inventory.soak[..inventory.ci.len()] != inventory.ci
    {
        return Err(SweepError::new(
            "inventory",
            "soak must begin with the CI inventory verbatim",
        ));
    }
    let required = inventory
        .ci
        .iter()
        .find(|s| s.id == "practice-truncated-off")
        .ok_or_else(|| SweepError::new("inventory", "missing practice-truncated-off"))?;
    if required.seed != 5
        || required.arena != ArenaSpec::Name("practice".into())
        || required.players.len() != 4
        || required.sim.faction_mode != FactionMode::Off
        || required.max_ticks != 10
        || required.expected_stop != ExpectedStop::Truncated
    {
        return Err(SweepError::new(
            "inventory",
            "practice-truncated-off does not match its required short-case definition",
        ));
    }
    if !inventory.ci.iter().any(|s| {
        s.expected_stop == ExpectedStop::Terminal && s.arena == ArenaSpec::Name("practice".into())
    }) {
        return Err(SweepError::new(
            "inventory",
            "CI lacks a terminal practice case",
        ));
    }
    if !inventory.ci.iter().any(|s| {
        s.arena
            == ArenaSpec::File {
                file: MapFileSpec {
                    path: MAP_PATH.into(),
                },
            }
    }) {
        return Err(SweepError::new(
            "inventory",
            "CI lacks the admitted map case",
        ));
    }
    if !inventory
        .ci
        .iter()
        .any(|s| s.sim.faction_mode == FactionMode::EngagementHolyPlagueFireFrostSentenced)
    {
        return Err(SweepError::new(
            "inventory",
            "CI lacks the explicit all-current-factions case",
        ));
    }
    Ok(())
}

fn validate_scenarios(scenarios: &[ScenarioSpec], preset: &str) -> Result<(), SweepError> {
    let mut ids = BTreeSet::new();
    for spec in scenarios {
        if spec.id.is_empty() || !ids.insert(&spec.id) {
            return Err(SweepError::new(
                "inventory",
                format!("{preset}: empty or duplicate scenario id {:?}", spec.id),
            ));
        }
        if spec.players.is_empty() || spec.max_ticks == 0 || spec.checkpoint_steps.is_empty() {
            return Err(SweepError::at(
                spec,
                None,
                "inventory",
                "players, max_ticks and checkpoint_steps must be nonzero/nonempty",
            ));
        }
        if spec.checkpoint_steps.windows(2).any(|w| w[0] >= w[1])
            || spec
                .checkpoint_steps
                .last()
                .is_some_and(|&step| step >= spec.max_ticks)
        {
            return Err(SweepError::at(
                spec,
                None,
                "inventory",
                "checkpoint_steps must be sorted, unique and below max_ticks",
            ));
        }
        match &spec.arena {
            ArenaSpec::Name(name) if name == "practice" => {}
            ArenaSpec::File { file } if file.path == MAP_PATH => {}
            _ => {
                return Err(SweepError::at(
                    spec,
                    None,
                    "inventory",
                    "arena is not an admitted practice/map input",
                ))
            }
        }
        for player in &spec.players {
            if player.profile.is_empty() || player.policy != "brawler" || player.cadence == 0 {
                return Err(SweepError::at(
                    spec,
                    None,
                    "inventory",
                    "player specs require a profile, brawler policy and nonzero cadence",
                ));
            }
        }
    }
    Ok(())
}

fn agents(spec: &ScenarioSpec) -> Vec<AgentSpec> {
    spec.players
        .iter()
        .map(|p| AgentSpec {
            profile: p.profile.clone(),
            faction: p.faction,
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Brawler::new(p.cadence)),
            },
        })
        .collect()
}

fn hex64(value: u64) -> String {
    format!("{value:016x}")
}

fn encode_events(events: &[rh_sim::Event]) -> Result<Vec<Vec<u8>>, serde_json::Error> {
    events.iter().map(serde_json::to_vec).collect()
}

fn event_tick_digest(tick: u32, events: &[Vec<u8>]) -> u64 {
    let mut digest = OutcomeDigest::new();
    digest.word(u64::from(tick));
    for event in events {
        digest.word(event.len() as u64);
        for chunk in event.chunks(8) {
            let mut word = [0u8; 8];
            word[..chunk.len()].copy_from_slice(chunk);
            digest.word(u64::from_le_bytes(word));
        }
    }
    digest.value()
}

#[derive(Clone, Debug, PartialEq)]
struct TickEvidence {
    tick: u32,
    hash: u64,
    events: Vec<Vec<u8>>,
}

fn check_tick(
    expected: &TickEvidence,
    tick: u32,
    hash: u64,
    events: &[Vec<u8>],
) -> Result<(), String> {
    if expected.tick != tick {
        return Err(format!("expected tick {}, got {tick}", expected.tick));
    }
    if expected.hash != hash {
        return Err(format!(
            "state hash expected {}, got {}",
            hex64(expected.hash),
            hex64(hash)
        ));
    }
    if expected.events != events {
        return Err("ordered event JSON differs".into());
    }
    Ok(())
}

#[derive(Serialize)]
struct Engine {
    content_hash: String,
    build: String,
    replay_format: String,
    checkpoint_format: String,
    observation_version: u16,
    policy_contract_version: u16,
}

#[derive(Serialize)]
struct ManifestInventory {
    format: String,
    preset: String,
    scenarios: Vec<ScenarioSpec>,
}

#[derive(Serialize)]
struct MapInput {
    path: String,
    sha256: String,
}

#[derive(Serialize)]
struct ResultRow {
    id: String,
    seed: u64,
    ticks: u64,
    terminated: bool,
    truncated: bool,
    events: u64,
    final_state_hash: String,
    state_hash_fold: String,
    event_fold: String,
    fresh_ticks: u64,
    fresh_compared_ticks: u64,
    replay_steps: u64,
    checkpoints: Vec<CheckpointRow>,
}

#[derive(Serialize)]
struct CheckpointRow {
    step: u32,
    tick: u32,
    continuation_ticks: u64,
    state_hash_fold: String,
    event_fold: String,
}

#[derive(Default, Serialize)]
struct Totals {
    scenarios: u64,
    ticks: u64,
    events: u64,
    fresh_ticks: u64,
    fresh_compared_ticks: u64,
    replay_steps: u64,
    checkpoint_restores: u64,
    continuation_ticks: u64,
}

#[derive(Serialize)]
struct Artifact {
    kind: String,
    scenario: String,
    path: String,
    bytes: u64,
    steps: u64,
    sha256: String,
}

#[derive(Serialize)]
struct Manifest {
    format: &'static str,
    fold_format: &'static str,
    inventory: ManifestInventory,
    engine: Engine,
    map_inputs: Vec<MapInput>,
    results: Vec<ResultRow>,
    totals: Totals,
    artifacts: Vec<Artifact>,
}

#[derive(Serialize)]
struct Provenance {
    format: &'static str,
    commit: String,
    dirty: bool,
    rustc_vv: String,
    cargo_version: String,
    target_triple: String,
    execution_arch: String,
    os: String,
    native: bool,
    profile: String,
    command: String,
    elapsed_ms: u64,
}

fn process_output(program: &str, args: &[&str]) -> Result<String, SweepError> {
    let output = ProcessCommand::new(program)
        .args(args)
        .current_dir(repo_root())
        .output()
        .map_err(|e| SweepError::new("provenance", format!("could not run {program}: {e}")))?;
    if !output.status.success() {
        return Err(SweepError::new(
            "provenance",
            format!("{program} {} failed", args.join(" ")),
        ));
    }
    String::from_utf8(output.stdout)
        .map_err(|e| SweepError::new("provenance", format!("{program} output was not UTF-8: {e}")))
}

fn parse_execution_arch(raw: &str) -> Result<String, SweepError> {
    let value = raw.trim();
    if value.is_empty() || value.split_whitespace().count() != 1 {
        return Err(SweepError::new(
            "provenance",
            "uname -m returned an empty or ambiguous architecture",
        ));
    }
    match value {
        "arm64" | "aarch64" => Ok("aarch64".into()),
        "amd64" | "x86_64" => Ok("x86_64".into()),
        _ => Err(SweepError::new(
            "provenance",
            format!("unsupported uname -m architecture {value:?}"),
        )),
    }
}

fn native_execution(target_triple: &str, execution_arch: &str, os: &str) -> bool {
    let target_arch = target_triple.split('-').next().unwrap_or_default();
    let target_os_matches = match os {
        "linux" => target_triple.contains("-linux-"),
        "macos" => target_triple.contains("-darwin"),
        "windows" => target_triple.contains("-windows-"),
        _ => false,
    };
    target_arch == execution_arch && target_os_matches
}

fn provenance(command: String, started: Instant) -> Result<Provenance, SweepError> {
    let commit = process_output("git", &["rev-parse", "HEAD"])?
        .trim()
        .to_owned();
    let dirty = !process_output("git", &["status", "--porcelain"])?
        .trim()
        .is_empty();
    let rustc_vv = process_output("rustc", &["-vV"])?;
    let cargo_version = process_output("cargo", &["--version"])?.trim().to_owned();
    let target_triple = rustc_vv
        .lines()
        .find_map(|line| line.strip_prefix("host: "))
        .ok_or_else(|| SweepError::new("provenance", "rustc -vV has no host line"))?
        .to_owned();
    let execution_arch = parse_execution_arch(&process_output("uname", &["-m"])?)?;
    let os = std::env::consts::OS.to_owned();
    let native = native_execution(&target_triple, &execution_arch, &os);
    Ok(Provenance {
        format: PROVENANCE_FORMAT,
        commit,
        dirty,
        rustc_vv,
        cargo_version,
        target_triple,
        execution_arch,
        os,
        native,
        profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
        .into(),
        command,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

fn canonical_json<T: Serialize>(value: &T) -> Result<Vec<u8>, SweepError> {
    let mut bytes = serde_json::to_vec(value)
        .map_err(|e| SweepError::new("json", format!("could not serialize JSON: {e}")))?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), SweepError> {
    let bytes = canonical_json(value)?;
    std::fs::write(path, bytes)
        .map_err(|e| SweepError::new("output", format!("{}: {e}", path.display())))
}

struct ScenarioOutput {
    result: ResultRow,
    replay_bytes: Vec<u8>,
    replay_steps: u64,
}

fn run_scenario(spec: &ScenarioSpec) -> Result<ScenarioOutput, SweepError> {
    let arena = match &spec.arena {
        ArenaSpec::Name(name) if name == "practice" => rh_sim::arenas::practice_arena(),
        ArenaSpec::File { file } => {
            let path = repo_root().join(&file.path);
            rh_headless::load_arena(&path.to_string_lossy())
                .map_err(|e| SweepError::at(spec, None, "map", e))?
        }
        _ => return Err(SweepError::at(spec, None, "map", "unadmitted arena")),
    };
    let config = || EnvConfig {
        arena: arena.clone(),
        sim: SimConfig::from(&spec.sim),
        max_ticks: spec.max_ticks,
        record: true,
    };
    let mut first = Env::new(config(), agents(spec), spec.seed);
    let mut second = Env::new(
        EnvConfig {
            record: false,
            ..config()
        },
        agents(spec),
        spec.seed,
    );
    let checkpoint_steps: BTreeSet<u32> = spec.checkpoint_steps.iter().copied().collect();
    let mut evidence = Vec::new();
    let mut checkpoints = BTreeMap::new();
    let progress = loop {
        let a = first.advance(&[]);
        let a_events = encode_events(first.last_events())
            .map_err(|e| SweepError::at(spec, Some(a.tick), "event-json", e.to_string()))?;
        let a_hash = first.sim.state_hash();
        let b = second.advance(&[]);
        if a != b {
            return Err(SweepError::at(
                spec,
                Some(a.tick),
                "fresh-progress",
                format!("fresh instances progressed differently: {a:?} versus {b:?}"),
            ));
        }
        let b_events = encode_events(second.last_events())
            .map_err(|e| SweepError::at(spec, Some(b.tick), "event-json", e.to_string()))?;
        let row = TickEvidence {
            tick: a.tick,
            hash: a_hash,
            events: a_events,
        };
        check_tick(&row, b.tick, second.sim.state_hash(), &b_events)
            .map_err(|e| SweepError::at(spec, Some(a.tick), "fresh", e))?;
        let step = evidence.len() as u32;
        if checkpoint_steps.contains(&step) {
            let bytes = serde_json::to_vec(&first.sim).map_err(|e| {
                SweepError::at(spec, Some(a.tick), "checkpoint-json", e.to_string())
            })?;
            checkpoints.insert(step, bytes);
        }
        evidence.push(row);
        if a.terminated || a.truncated {
            break a;
        }
        if evidence.len() > spec.max_ticks as usize {
            return Err(SweepError::at(
                spec,
                Some(a.tick),
                "progress",
                "the environment exceeded max_ticks without stopping",
            ));
        }
    };
    match spec.expected_stop {
        ExpectedStop::Terminal if !progress.terminated || progress.truncated => {
            return Err(SweepError::at(
                spec,
                Some(progress.tick),
                "stop",
                "expected genuine terminal stop",
            ))
        }
        ExpectedStop::Truncated if !progress.truncated || progress.terminated => {
            return Err(SweepError::at(
                spec,
                Some(progress.tick),
                "stop",
                "expected deliberate truncation",
            ))
        }
        _ => {}
    }
    if evidence.len() > spec.max_ticks as usize {
        return Err(SweepError::at(
            spec,
            Some(progress.tick),
            "stop",
            "too many ticks",
        ));
    }
    if checkpoints.len() != checkpoint_steps.len() {
        return Err(SweepError::at(
            spec,
            Some(progress.tick),
            "checkpoint",
            "the scenario ended before all requested checkpoints",
        ));
    }

    let replay = first
        .into_replay()
        .ok_or_else(|| SweepError::at(spec, None, "replay", "recording was not enabled"))?;
    let replay_bytes = serde_json::to_vec(&replay)
        .map_err(|e| SweepError::at(spec, None, "replay-json", e.to_string()))?;
    let replay: Replay = serde_json::from_slice(&replay_bytes)
        .map_err(|e| SweepError::at(spec, None, "replay-json", e.to_string()))?;
    validate_replay(&replay, &evidence)
        .map_err(|e| SweepError::at(spec, None, "replay-structure", e))?;
    let (replayed_sim, replayed_events) = run_replay(&replay).map_err(|e| {
        let tick = match e {
            rh_sim::replay::ReplayError::Diverged { step, .. } => Some(step as u32 + 1),
            _ => None,
        };
        SweepError::at(spec, tick, "run-replay", format!("{e:?}"))
    })?;
    if replayed_sim.state_hash() != progress_hash(&evidence) {
        return Err(SweepError::at(
            spec,
            Some(progress.tick),
            "run-replay",
            "final state hash differs",
        ));
    }
    compare_replay_events(&evidence, &replayed_events)
        .map_err(|(tick, message)| SweepError::at(spec, Some(tick), "replay-events", message))?;

    let checkpoint_rows = restore_continuations(spec, &checkpoints, &evidence, &replay)?;
    let events = evidence.iter().map(|tick| tick.events.len() as u64).sum();
    let ticks = evidence.len() as u64;
    let state_hash_fold = fold_all(evidence.iter().map(|tick| tick.hash));
    let event_fold = fold_all(
        evidence
            .iter()
            .map(|tick| event_tick_digest(tick.tick, &tick.events)),
    );
    let result = ResultRow {
        id: spec.id.clone(),
        seed: spec.seed,
        ticks,
        terminated: progress.terminated,
        truncated: progress.truncated,
        events,
        final_state_hash: hex64(progress_hash(&evidence)),
        state_hash_fold: hex64(state_hash_fold),
        event_fold: hex64(event_fold),
        fresh_ticks: ticks * 2,
        fresh_compared_ticks: ticks,
        replay_steps: replay.hashes.len() as u64,
        checkpoints: checkpoint_rows,
    };
    let mut replay_file = replay_bytes;
    replay_file.push(b'\n');
    Ok(ScenarioOutput {
        result,
        replay_bytes: replay_file,
        replay_steps: replay.hashes.len() as u64,
    })
}

fn progress_hash(evidence: &[TickEvidence]) -> u64 {
    evidence.last().map_or(0, |tick| tick.hash)
}

fn validate_replay(replay: &Replay, evidence: &[TickEvidence]) -> Result<(), String> {
    if evidence.is_empty() || replay.hashes.len() != evidence.len() {
        return Err(format!(
            "expected {} recorded steps, got {}",
            evidence.len(),
            replay.hashes.len()
        ));
    }
    for (expected, &actual) in evidence.iter().zip(&replay.hashes) {
        if expected.hash != actual {
            return Err(format!("recorded hash differs at tick {}", expected.tick));
        }
    }
    let first_tick = evidence[0].tick;
    let last_tick = evidence[evidence.len() - 1].tick;
    let mut previous = first_tick.saturating_sub(1);
    for tick in &replay.ticks {
        if tick.tick < first_tick || tick.tick <= previous || tick.tick > last_tick {
            return Err(format!(
                "replay input tick {} is out of order or out of range",
                tick.tick
            ));
        }
        if tick.inputs.is_empty() {
            return Err(format!("replay input tick {} is empty", tick.tick));
        }
        previous = tick.tick;
    }
    let mut next = 0;
    for expected in evidence {
        if replay
            .ticks
            .get(next)
            .is_some_and(|tick| tick.tick == expected.tick)
        {
            next += 1;
        }
    }
    if next != replay.ticks.len() {
        return Err("not every recorded input tick would be consumed".into());
    }
    Ok(())
}

fn compare_replay_events(
    evidence: &[TickEvidence],
    actual: &[rh_sim::Event],
) -> Result<(), (u32, String)> {
    let mut actual = actual.iter();
    for expected_tick in evidence {
        for expected in &expected_tick.events {
            let event = actual.next().ok_or_else(|| {
                (
                    expected_tick.tick,
                    "flattened replay events ended early".to_owned(),
                )
            })?;
            let encoded =
                serde_json::to_vec(event).map_err(|e| (expected_tick.tick, e.to_string()))?;
            if &encoded != expected {
                return Err((
                    expected_tick.tick,
                    "flattened ordered replay event JSON differs".into(),
                ));
            }
        }
    }
    if actual.next().is_some() {
        return Err((
            evidence.last().map_or(0, |tick| tick.tick),
            "flattened replay contains extra events".into(),
        ));
    }
    Ok(())
}

fn restore_continuations(
    spec: &ScenarioSpec,
    checkpoints: &BTreeMap<u32, Vec<u8>>,
    evidence: &[TickEvidence],
    replay: &Replay,
) -> Result<Vec<CheckpointRow>, SweepError> {
    let mut rows = Vec::new();
    for (&step, bytes) in checkpoints {
        let expected_checkpoint = &evidence[step as usize];
        let mut sim =
            Sim::restore(&mut serde_json::Deserializer::from_slice(bytes)).map_err(|e| {
                SweepError::at(
                    spec,
                    Some(expected_checkpoint.tick),
                    "checkpoint-restore",
                    e.to_string(),
                )
            })?;
        if sim.tick() != expected_checkpoint.tick || sim.state_hash() != expected_checkpoint.hash {
            return Err(SweepError::at(
                spec,
                Some(expected_checkpoint.tick),
                "checkpoint-restore",
                "restored state hash or tick differs",
            ));
        }
        let suffix = &evidence[step as usize + 1..];
        let mut next_input = replay
            .ticks
            .iter()
            .position(|tick| tick.tick > expected_checkpoint.tick)
            .unwrap_or(replay.ticks.len());
        let mut hashes = Vec::with_capacity(suffix.len());
        let mut event_digests = Vec::with_capacity(suffix.len());
        for expected in suffix {
            let target = sim.tick() + 1;
            if target != expected.tick {
                return Err(SweepError::at(
                    spec,
                    Some(target),
                    "continuation",
                    format!(
                        "expected tick {}, restored stream is at {target}",
                        expected.tick
                    ),
                ));
            }
            if let Some(recorded) = replay.ticks.get(next_input) {
                if recorded.tick < target {
                    return Err(SweepError::at(
                        spec,
                        Some(target),
                        "continuation",
                        "an earlier recorded input tick was not consumed",
                    ));
                }
                if recorded.tick == target {
                    for input in &recorded.inputs {
                        apply_replay_input(&mut sim, input);
                    }
                    next_input += 1;
                }
            }
            let events = sim.step();
            let events = encode_events(&events).map_err(|e| {
                SweepError::at(spec, Some(target), "continuation-json", e.to_string())
            })?;
            let hash = sim.state_hash();
            check_tick(expected, target, hash, &events)
                .map_err(|e| SweepError::at(spec, Some(target), "continuation", e))?;
            hashes.push(hash);
            event_digests.push(event_tick_digest(target, &events));
        }
        if next_input != replay.ticks.len() {
            return Err(SweepError::at(
                spec,
                Some(expected_checkpoint.tick),
                "continuation",
                "not every subsequent recorded ReplayInput tick was consumed",
            ));
        }
        rows.push(CheckpointRow {
            step,
            tick: expected_checkpoint.tick,
            continuation_ticks: suffix.len() as u64,
            state_hash_fold: hex64(fold_all(hashes)),
            event_fold: hex64(fold_all(event_digests)),
        });
    }
    Ok(rows)
}

fn apply_replay_input(sim: &mut Sim, input: &ReplayInput) {
    apply_input(sim, input);
}

fn selected_scenarios(
    cli: &Cli,
    inventory: &Inventory,
) -> Result<(String, Vec<ScenarioSpec>), SweepError> {
    match &cli.preset {
        Preset::Ci => Ok(("ci".into(), inventory.ci.clone())),
        Preset::Soak => Ok(("soak".into(), inventory.soak.clone())),
        Preset::Case { scenario, seed } => {
            let spec = inventory
                .ci
                .iter()
                .chain(&inventory.soak)
                .find(|spec| &spec.id == scenario && spec.seed == *seed)
                .ok_or_else(|| {
                    SweepError::new(
                        "inventory",
                        format!("unknown scenario/seed pair {scenario:?}/{seed}"),
                    )
                })?
                .clone();
            Ok(("case".into(), vec![spec]))
        }
    }
}

fn map_inputs(scenarios: &[ScenarioSpec]) -> Result<Vec<MapInput>, SweepError> {
    let mut paths = BTreeSet::new();
    for spec in scenarios {
        if let ArenaSpec::File { file } = &spec.arena {
            paths.insert(file.path.clone());
        }
    }
    paths
        .into_iter()
        .map(|path| {
            let bytes = std::fs::read(repo_root().join(&path))
                .map_err(|e| SweepError::new("map", format!("{path}: {e}")))?;
            Ok(MapInput {
                path,
                sha256: sha256::hex(&bytes),
            })
        })
        .collect()
}

fn execute(cli: &Cli, started: Instant) -> Result<(), SweepError> {
    let inventory = load_inventory()?;
    let (preset, scenarios) = selected_scenarios(cli, &inventory)?;
    if scenarios.is_empty() {
        return Err(SweepError::new("inventory", "selected zero scenarios"));
    }
    let map_inputs = map_inputs(&scenarios)?;
    let mut results = Vec::with_capacity(scenarios.len());
    let mut totals = Totals {
        scenarios: scenarios.len() as u64,
        ..Totals::default()
    };
    let mut artifacts = Vec::new();
    for (index, spec) in scenarios.iter().enumerate() {
        let output = run_scenario(spec)?;
        totals.ticks += output.result.ticks;
        totals.events += output.result.events;
        totals.fresh_ticks += output.result.fresh_ticks;
        totals.fresh_compared_ticks += output.result.fresh_compared_ticks;
        totals.replay_steps += output.result.replay_steps;
        totals.checkpoint_restores += output.result.checkpoints.len() as u64;
        totals.continuation_ticks += output
            .result
            .checkpoints
            .iter()
            .map(|checkpoint| checkpoint.continuation_ticks)
            .sum::<u64>();
        if index == 0 {
            let path = cli.out.join("replay.json");
            std::fs::write(&path, &output.replay_bytes).map_err(|e| {
                SweepError::at(spec, None, "output", format!("{}: {e}", path.display()))
            })?;
            artifacts.push(Artifact {
                kind: "replay".into(),
                scenario: spec.id.clone(),
                path: "replay.json".into(),
                bytes: output.replay_bytes.len() as u64,
                steps: output.replay_steps,
                sha256: sha256::hex(&output.replay_bytes),
            });
        }
        results.push(output.result);
    }
    let manifest = Manifest {
        format: MANIFEST_FORMAT,
        fold_format: FOLD_FORMAT,
        inventory: ManifestInventory {
            format: INVENTORY_FORMAT.into(),
            preset,
            scenarios,
        },
        engine: Engine {
            content_hash: hex64(rh_sim::content::content_hash()),
            build: BUILD_ID.into(),
            replay_format: REPLAY_FORMAT.into(),
            checkpoint_format: CHECKPOINT_FORMAT.into(),
            observation_version: OBSERVATION_VERSION,
            policy_contract_version: rh_policy::POLICY_CONTRACT_VERSION,
        },
        map_inputs,
        results,
        totals,
        artifacts,
    };
    write_json(&cli.out.join("manifest.json"), &manifest)?;
    let provenance = provenance(cli.command.clone(), started)?;
    write_json(&cli.out.join("provenance.json"), &provenance)?;
    println!(
        "verified {} scenarios, {} ticks, {} checkpoint restores in {} ms",
        manifest.totals.scenarios,
        manifest.totals.ticks,
        manifest.totals.checkpoint_restores,
        provenance.elapsed_ms
    );
    Ok(())
}

pub fn main_entry() -> Result<(), String> {
    run_entry().map_err(|error| error.to_string())
}

fn run_entry() -> Result<(), SweepError> {
    let started = Instant::now();
    let args: Vec<String> = std::env::args_os()
        .map(|arg| {
            arg.into_string()
                .map_err(|_| SweepError::new("cli", "arguments must be valid UTF-8"))
        })
        .collect::<Result<_, _>>()?;
    let cli = parse_cli(&args)?;
    prepare_out(&cli.out)?;
    if let Err(error) = execute(&cli, started) {
        let reproduction = match (&error.scenario, error.seed) {
            (Some(scenario), Some(seed)) => format!(
                "determinism_sweep case --scenario {scenario} --seed {seed} --out {}",
                cli.out.join("reproduction").display()
            ),
            _ => cli.command.clone(),
        };
        let failure = Failure {
            format: "rh-determinism-failure/1",
            scenario: error.scenario.clone(),
            seed: error.seed,
            tick: error.tick,
            component: error.component.clone(),
            message: error.message.clone(),
            reproduction,
        };
        if let Err(write_error) = write_json(&cli.out.join("failure.json"), &failure) {
            return Err(SweepError::new(
                "failure-output",
                format!("{error}; additionally could not write failure.json: {write_error}"),
            ));
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rh_sim::{Event, PlayerId, WeaponId};

    fn hit(amount: f64) -> Vec<u8> {
        serde_json::to_vec(&Event::Hit {
            victim: PlayerId(1),
            by: Some(PlayerId(2)),
            amount,
            weapon: Some(WeaponId::Fists),
            passive: false,
            critical: false,
        })
        .unwrap()
    }

    fn evidence() -> TickEvidence {
        TickEvidence {
            tick: 7,
            hash: 0x1234,
            events: vec![hit(10.0), serde_json::to_vec(&Event::RaidEnded).unwrap()],
        }
    }

    #[test]
    fn runtime_architecture_probe_and_native_comparison_are_strict() {
        assert_eq!(parse_execution_arch("arm64\n").unwrap(), "aarch64");
        assert_eq!(parse_execution_arch("aarch64\n").unwrap(), "aarch64");
        assert_eq!(parse_execution_arch("x86_64\n").unwrap(), "x86_64");
        assert_eq!(parse_execution_arch("amd64\n").unwrap(), "x86_64");
        for invalid in ["", "arm64 extra", "arm64\nx86_64\n", "unknown"] {
            assert!(
                parse_execution_arch(invalid).is_err(),
                "accepted {invalid:?}"
            );
        }
        assert!(native_execution(
            "aarch64-unknown-linux-gnu",
            "aarch64",
            "linux"
        ));
        assert!(native_execution("aarch64-apple-darwin", "aarch64", "macos"));
        assert!(!native_execution(
            "aarch64-unknown-linux-gnu",
            "x86_64",
            "linux"
        ));
        assert!(!native_execution(
            "aarch64-unknown-linux-gnu",
            "aarch64",
            "macos"
        ));
        assert!(!native_execution(
            "aarch64-unknown-linux-gnu",
            "aarch64",
            "plan9"
        ));
    }

    #[test]
    fn posix_shell_commands_preserve_spaces_quotes_and_empty_arguments() {
        assert_eq!(posix_shell_escape(""), "''");
        assert_eq!(posix_shell_escape("plain"), "'plain'");
        assert_eq!(posix_shell_escape("two words"), "'two words'");
        assert_eq!(posix_shell_escape("a'b"), "'a'\\''b'");
        assert_eq!(posix_shell_escape("line\nbreak"), "'line\nbreak'");
        assert_eq!(posix_shell_escape("雪"), "'雪'");
        let args = ["bin path", "", "a'b", "line\nbreak"].map(str::to_owned);
        assert_eq!(
            posix_shell_command(&args),
            "'bin path' '' 'a'\\''b' 'line\nbreak'"
        );
    }

    #[test]
    fn unchanged_tick_control_passes() {
        let expected = evidence();
        check_tick(&expected, expected.tick, expected.hash, &expected.events).unwrap();
    }

    #[test]
    fn changed_tick_hash_is_rejected() {
        let expected = evidence();
        let error = check_tick(
            &expected,
            expected.tick,
            expected.hash ^ 1,
            &expected.events,
        )
        .unwrap_err();
        assert!(error.contains("state hash"));
    }

    #[test]
    fn reordered_and_one_ulp_changed_events_are_rejected() {
        let expected = evidence();
        let mut reordered = expected.events.clone();
        reordered.swap(0, 1);
        assert!(check_tick(&expected, expected.tick, expected.hash, &reordered).is_err());
        assert_ne!(
            event_tick_digest(expected.tick, &expected.events),
            event_tick_digest(expected.tick, &reordered)
        );
        let mut changed = expected.events.clone();
        changed[0] = hit(f64::from_bits(10.0f64.to_bits() + 1));
        assert!(check_tick(&expected, expected.tick, expected.hash, &changed).is_err());
        assert_ne!(
            event_tick_digest(expected.tick, &expected.events),
            event_tick_digest(expected.tick, &changed)
        );
    }

    fn short_replay() -> (Replay, Vec<TickEvidence>) {
        let spec = ScenarioSpec {
            id: "test".into(),
            seed: 5,
            arena: ArenaSpec::Name("practice".into()),
            players: (0..2)
                .map(|i| PlayerSpec {
                    profile: format!("p{i}"),
                    faction: FactionId::ALL[i],
                    policy: "brawler".into(),
                    cadence: 2,
                })
                .collect(),
            sim: SimSpec {
                min_players: 2,
                lobby_seconds: 30.0,
                fill_seconds: 5.0,
                pvp_rules: true,
                weapon_specials: true,
                faction_mode: FactionMode::Off,
            },
            max_ticks: 4,
            checkpoint_steps: vec![1],
            expected_stop: ExpectedStop::Truncated,
        };
        let mut env = Env::new(
            EnvConfig {
                arena: rh_sim::arenas::practice_arena(),
                sim: SimConfig::from(&spec.sim),
                max_ticks: 4,
                record: true,
            },
            agents(&spec),
            spec.seed,
        );
        let mut evidence = Vec::new();
        for _ in 0..4 {
            env.advance(&[]);
            evidence.push(TickEvidence {
                tick: env.sim.tick(),
                hash: env.sim.state_hash(),
                events: encode_events(env.last_events()).unwrap(),
            });
        }
        (env.into_replay().unwrap(), evidence)
    }

    #[test]
    fn valid_replay_control_passes_and_truncated_evidence_fails() {
        let (replay, evidence) = short_replay();
        validate_replay(&replay, &evidence).unwrap();
        let mut truncated = replay;
        truncated.hashes.pop();
        let error = validate_replay(&truncated, &evidence).unwrap_err();
        assert!(error.contains("recorded steps"));
        let mut unconsumed = truncated;
        unconsumed.hashes = evidence.iter().map(|tick| tick.hash).collect();
        unconsumed.ticks.push(rh_sim::replay::ReplayTick {
            tick: 4,
            inputs: vec![ReplayInput::Leave {
                player: PlayerId(1),
            }],
        });
        if unconsumed.ticks.len() > 1 && unconsumed.ticks[unconsumed.ticks.len() - 2].tick == 4 {
            let last = unconsumed.ticks.pop().unwrap();
            unconsumed
                .ticks
                .last_mut()
                .unwrap()
                .inputs
                .extend(last.inputs);
        }
        assert!(validate_replay(&unconsumed, &evidence).is_ok());
        unconsumed.ticks.push(rh_sim::replay::ReplayTick {
            tick: 2,
            inputs: vec![ReplayInput::Leave {
                player: PlayerId(1),
            }],
        });
        assert!(validate_replay(&unconsumed, &evidence).is_err());
    }
}
