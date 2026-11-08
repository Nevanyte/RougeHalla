//! The tournament CLI surface (source packages/server/src/bots/tournament/runTournament.ts): the parsed arguments, the
//! usage text, the deterministic plan they describe, and the JSON payload the source writes with --json. Pure: no clock
//! and no I/O (the binary does the writing and the one wall-clock measurement).
use crate::tournament::{
    default_workers, parse_lineup, DiedTo, FactionChoice, GameSummary, PersonaChoice, Report,
    TournamentPlan, FACTION_IDS, MAX_GAME_MS, PERSONA_IDS,
};
use rh_policy::bots::{PersonaId, TierId};
use rh_sim::content::FactionId;
use serde_json::{json, Map, Value};

/// The source CLI arguments (TournamentArgs).
#[derive(Clone, Debug, PartialEq)]
pub struct TournamentArgs {
    pub games: u32,
    pub workers: u32,
    pub tiers: Vec<TierId>,
    pub seed: u32,
    pub learn: bool,
    pub persona: Option<PersonaId>,
    pub faction: Option<FactionId>,
    pub json: Option<String>,
    pub max_minutes: f64,
    pub patience: Option<f64>,
    pub sudden: Option<f64>,
    pub latency_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub tune: Option<Value>,
    pub quiet: bool,
    pub help: bool,
    pub telemetry_dir: Option<String>,
}

/// The source USAGE text (the invocation line adapted to this binary).
pub const USAGE: &str = "usage: cargo run -p rh-headless --bin tournament -- [options]
  --games N        games to play (default 400)
  --workers N      worker threads (default min(cores - 1, 6); the ported runner plays in index order in this thread)
  --lineup L       one letter per seat, E(asy) N(ormal) H(ard), comma separated (default E,E,N,N,H,H; 2 to 8 seats)
  --seed N         the tournament seed (default 1): game seeds, factions and personas all derive from it
  --learn on|off   the bots' learning store (default on; the store is not ported yet, the flag is carried in the meta)
  --persona P      mix (default: rotated evenly), farmer, hunter, opportunist or cautious for every bot
  --faction F      mix (default: rotated evenly) or one faction id (fire, sentenced, plague, frost, holy) for every bot
  --json FILE      also write the plan, the report and the games there
  --max-minutes M  cut a game off after M simulated minutes (default 12)
  --patience S     patience seconds at a full lobby, scaling to 40% of it (default 120)
  --sudden S       sudden death seconds (default 30)
  --latency MS     --jitter MS   one-way latency of the bots' commands (default 30 and 8; not simulated by the ported runner)
  --telemetry DIR  also write every game's reduced summary NDJSON to DIR/runs-<day>.ndjson
  --tune JSON      a tuning diagnostic: patch the TIERS / PERSONAS tables (the ported runner refuses it: the tables are
                   compile-time constants, P-BOTS-6 remainder)
  --quiet          no progress on stderr
  --help";

fn number(flag: &str, raw: Option<String>, min: f64, integer: bool) -> Result<f64, String> {
    let shown = raw.clone().unwrap_or_default();
    let n = raw.and_then(|r| {
        let t = r.trim();
        if t.is_empty() {
            None
        } else {
            t.parse::<f64>().ok()
        }
    });
    match n {
        Some(n) if n.is_finite() && n >= min && (!integer || n.fract() == 0.) => Ok(n),
        _ => Err(format!(
            "{} needs {} of at least {min}, got \"{}\"",
            flag,
            if integer { "an integer" } else { "a number" },
            shown
        )),
    }
}

/// Parse the source CLI argv (source runTournament.ts parseArgs): --flag value and --flag=value, "--" skipped, the
/// source defaults, and the source error strings. Throws a plain message on anything it does not understand.
pub fn parse_args(argv: &[String], cores: usize) -> Result<TournamentArgs, String> {
    let mut a = TournamentArgs {
        games: 400,
        workers: default_workers(cores) as u32,
        tiers: parse_lineup("E,E,N,N,H,H")?,
        seed: 1,
        learn: true,
        persona: None,
        faction: None,
        json: None,
        max_minutes: MAX_GAME_MS / 60_000.,
        patience: None,
        sudden: None,
        latency_ms: None,
        jitter_ms: None,
        tune: None,
        quiet: false,
        help: false,
        telemetry_dir: None,
    };
    let mut args: Vec<String> = argv.to_vec();
    args.reverse();
    while let Some(raw) = args.pop() {
        if raw == "--" {
            continue;
        }
        let (flag, inline) = match raw.strip_prefix("--") {
            Some(rest) => match rest.find('=') {
                Some(eq) => (
                    format!("--{}", &rest[..eq]),
                    Some(rest[eq + 1..].to_owned()),
                ),
                None => (raw.clone(), None),
            },
            None => (raw.clone(), None),
        };
        let mut value = || -> Result<String, String> {
            if let Some(v) = &inline {
                return Ok(v.clone());
            }
            args.pop().ok_or_else(|| format!("{flag} needs a value"))
        };
        match flag.as_str() {
            "--games" => a.games = number(&flag, Some(value()?), 1., true)? as u32,
            "--workers" => a.workers = number(&flag, Some(value()?), 1., true)? as u32,
            "--lineup" => a.tiers = parse_lineup(&value()?)?,
            "--seed" => {
                a.seed = (number(&flag, Some(value()?), 0., true)? as u64 & 0xffff_ffff) as u32
            }
            "--learn" => {
                let v = value()?.to_lowercase();
                if v != "on" && v != "off" {
                    return Err(format!("--learn takes on or off, got \"{v}\""));
                }
                a.learn = v == "on";
            }
            "--persona" => {
                let v = value()?.to_lowercase();
                if v == "mix" {
                    a.persona = None;
                } else if let Some(p) = PERSONA_IDS.into_iter().find(|p| p.as_str() == v) {
                    a.persona = Some(p);
                } else {
                    return Err(format!(
                        "--persona takes mix or one of {}, got \"{v}\"",
                        PersonaId::ALL
                            .iter()
                            .map(|p| p.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ));
                }
            }
            "--faction" => {
                let v = value()?.to_lowercase();
                if v == "mix" {
                    a.faction = None;
                } else if let Some(f) = FACTION_IDS.into_iter().find(|f| f.as_str() == v) {
                    a.faction = Some(f);
                } else {
                    return Err(format!(
                        "--faction takes mix or one of {}, got \"{v}\"",
                        FactionId::ALL
                            .iter()
                            .map(|f| f.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ));
                }
            }
            "--json" => a.json = Some(value()?),
            "--max-minutes" => a.max_minutes = number(&flag, Some(value()?), 0.1, false)?,
            "--patience" => a.patience = Some(number(&flag, Some(value()?), 1., false)?),
            "--sudden" => a.sudden = Some(number(&flag, Some(value()?), 1., false)?),
            "--latency" => a.latency_ms = Some(number(&flag, Some(value()?), 0., false)?),
            "--jitter" => a.jitter_ms = Some(number(&flag, Some(value()?), 0., false)?),
            "--tune" => {
                let v = value()?;
                let text = if let Some(path) = v.strip_prefix('@') {
                    std::fs::read_to_string(path).map_err(|e| format!("--tune: {e}"))?
                } else {
                    v
                };
                a.tune = Some(serde_json::from_str(&text).map_err(|e| format!("--tune: {e}"))?);
            }
            "--quiet" => a.quiet = true,
            "--telemetry" | "--telemetry-dir" => a.telemetry_dir = Some(value()?),
            "--help" | "-h" => a.help = true,
            other => return Err(format!("unknown option \"{other}\"")),
        }
    }
    Ok(a)
}

/// The plan the arguments describe (source runTournament.ts planOf).
pub fn plan_of(args: &TournamentArgs) -> TournamentPlan {
    TournamentPlan {
        games: args.games,
        seed: args.seed,
        tiers: args.tiers.clone(),
        persona: args.persona.map_or(PersonaChoice::Mix, PersonaChoice::One),
        faction: args.faction.map_or(FactionChoice::Mix, FactionChoice::One),
        max_sim_ms: args.max_minutes * 60_000.,
        workers: args.workers,
        learn: args.learn,
        patience_seconds: args.patience,
        sudden_death_seconds: args.sudden,
        latency_ms: args.latency_ms,
        jitter_ms: args.jitter_ms,
        tune: args.tune.clone(),
        telemetry_dir: args.telemetry_dir.clone(),
    }
}

/// The lineup as the source prints and stores it (E,E,N,N,H,H).
pub fn lineup_text(tiers: &[TierId]) -> String {
    tiers
        .iter()
        .map(|t| t.as_str()[..1].to_uppercase())
        .collect::<Vec<_>>()
        .join(",")
}

fn js_num(x: f64) -> Value {
    if !x.is_finite() {
        return Value::Null;
    }
    if x.fract() == 0. {
        return json!(x as i64);
    }
    Value::Number(serde_json::Number::from_f64(x).unwrap_or_else(|| serde_json::Number::from(0)))
}
fn proportion_json(p: &crate::tournament::Proportion) -> Value {
    json!({"k": js_num(p.k), "n": js_num(p.n), "p": js_num(p.p), "lo": js_num(p.lo), "hi": js_num(p.hi)})
}
fn interval_json(m: &crate::tournament::MeanInterval) -> Value {
    json!({"n": js_num(m.n), "mean": js_num(m.mean), "lo": js_num(m.lo), "hi": js_num(m.hi)})
}
fn group_json(g: &crate::tournament::GroupAgg) -> Value {
    json!({"key": g.key, "botGames": js_num(g.bot_games), "winRate": proportion_json(&g.win_rate),
        "meanPlace": js_num(g.mean_place), "killsPerBot": js_num(g.kills_per_bot)})
}
/// The report in the source JSON shape (camelCase, NaN figures null).
pub fn report_json(r: &Report) -> Value {
    let tiers: Vec<Value> = r.tiers.iter().map(|t| json!({
        "tier": t.tier.as_str(),
        "botGames": js_num(t.bot_games),
        "wins": js_num(t.wins),
        "draws": js_num(t.draws),
        "capped": js_num(t.capped),
        "winRate": proportion_json(&t.win_rate),
        "shareOfWins": js_num(t.share_of_wins),
        "place": interval_json(&t.place),
        "killsPerBot": js_num(t.kills_per_bot),
        "deathsPerBot": js_num(t.deaths_per_bot),
        "damagePerBot": js_num(t.damage_per_bot),
        "mobDamagePerBot": js_num(t.mob_damage_per_bot),
        "mobKillsPerBot": js_num(t.mob_kills_per_bot),
        "gvPerBot": js_num(t.gv_per_bot),
        "aliveSeconds": js_num(t.alive_seconds),
        "neverFought": js_num(t.never_fought),
        "diedTo": {"bot": js_num(t.died_to.bot), "mob": js_num(t.died_to.mob), "arena": js_num(t.died_to.arena)},
        "reactions": t.reactions.iter().map(|x| json!({
            "kind": x.kind, "n": js_num(x.n), "p10": js_num(x.p10), "p50": js_num(x.p50),
            "p90": js_num(x.p90), "mean": js_num(x.mean), "table": js_num(x.table)})).collect::<Vec<_>>(),
        "pooled": {"n": js_num(t.pooled.n), "mean": js_num(t.pooled.mean), "table": js_num(t.pooled.table), "ratio": js_num(t.pooled.ratio)},
        "targetClicks": js_num(t.target_clicks),
        "missRate": js_num(t.miss_rate),
        "wrongRate": js_num(t.wrong_rate),
        "apmMean": js_num(t.apm_mean),
        "apmPeakMean": js_num(t.apm_peak_mean),
        "apmPeakMax": js_num(t.apm_peak_max),
        "apmLimit": js_num(t.apm_limit),
        "apmBreaches": js_num(t.apm_breaches),
        "dodgesPerBot": js_num(t.dodges_per_bot),
        "jukesPerBot": js_num(t.jukes_per_bot),
        "kiteCyclesPerBot": js_num(t.kite_cycles_per_bot),
        "hesitationsPerBot": js_num(t.hesitations_per_bot),
        "throttledPerBot": js_num(t.throttled_per_bot),
        "maxStallMs": js_num(t.max_stall_ms),
        "stalls": js_num(t.stalls),
    })).collect();
    json!({
        "games": js_num(r.games),
        "decided": js_num(r.decided),
        "draws": js_num(r.draws),
        "capped": js_num(r.capped),
        "duration": {"meanS": js_num(r.duration.mean_s), "p50S": js_num(r.duration.p50_s),
                     "minS": js_num(r.duration.min_s), "maxS": js_num(r.duration.max_s)},
        "firstDeathMedianS": js_num(r.first_death_median_s),
        "teleportShare": js_num(r.teleport_share),
        "suddenDeathShare": js_num(r.sudden_death_share),
        "refused": js_num(r.refused),
        "lost": js_num(r.lost),
        "errors": js_num(r.errors),
        "tiers": tiers,
        "personas": r.personas.iter().map(group_json).collect::<Vec<_>>(),
        "factions": r.factions.iter().map(group_json).collect::<Vec<_>>(),
    })
}
pub fn plan_json(plan: &TournamentPlan) -> Value {
    let mut m = Map::new();
    m.insert("games".into(), json!(plan.games));
    m.insert("seed".into(), json!(plan.seed));
    m.insert(
        "tiers".into(),
        json!(plan.tiers.iter().map(|t| t.as_str()).collect::<Vec<_>>()),
    );
    m.insert("persona".into(), json!(plan.persona.as_str()));
    m.insert("faction".into(), json!(plan.faction.as_str()));
    m.insert("learn".into(), json!(plan.learn));
    m.insert("maxSimMs".into(), js_num(plan.max_sim_ms));
    if plan.patience_seconds.is_some() || plan.sudden_death_seconds.is_some() {
        let mut config = Map::new();
        if let Some(p) = plan.patience_seconds {
            config.insert("patienceSeconds".into(), js_num(p));
            config.insert("patienceMinSeconds".into(), js_num(p * 0.4));
        }
        if let Some(s) = plan.sudden_death_seconds {
            config.insert("suddenDeathSeconds".into(), js_num(s));
        }
        m.insert("config".into(), Value::Object(config));
    }
    if let Some(l) = plan.latency_ms {
        m.insert("latencyMs".into(), js_num(l));
    }
    if let Some(j) = plan.jitter_ms {
        m.insert("jitterMs".into(), js_num(j));
    }
    if let Some(t) = &plan.tune {
        m.insert("tune".into(), t.clone());
    }
    if let Some(d) = &plan.telemetry_dir {
        m.insert("telemetryDir".into(), json!(d));
    }
    Value::Object(m)
}
fn bot_json(b: &crate::tournament::BotSummary) -> Value {
    let mut behaviour = Map::new();
    behaviour.insert(
        "commands".into(),
        Value::Object(
            b.behaviour
                .commands
                .iter()
                .map(|(k, n)| (k.clone(), json!(n)))
                .collect(),
        ),
    );
    behaviour.insert("commandsTotal".into(), json!(b.behaviour.commands_total));
    behaviour.insert(
        "reactions".into(),
        Value::Object(
            b.behaviour
                .reactions
                .iter()
                .map(|(k, list)| (k.clone(), json!(list)))
                .collect(),
        ),
    );
    for (key, value) in [
        ("targetClicks", b.behaviour.target_clicks),
        ("clickMissed", b.behaviour.click_missed),
        ("clickWrong", b.behaviour.click_wrong),
        ("hesitations", b.behaviour.hesitations),
        ("lapses", b.behaviour.lapses),
        ("throttled", b.behaviour.throttled),
        ("superseded", b.behaviour.superseded),
        ("apmPeak", b.behaviour.apm_peak),
    ] {
        behaviour.insert(key.into(), json!(value));
    }
    for (key, value) in [
        ("mobTargets", b.behaviour.mob_targets),
        ("mobDrops", b.behaviour.mob_drops),
        ("retreats", b.behaviour.retreats),
        ("mobFocusMs", b.behaviour.mob_focus_ms),
        ("grabs", b.behaviour.grabs),
        ("maxStallMs", b.behaviour.max_stall_ms),
        ("dodges", b.behaviour.dodges),
        ("jukes", b.behaviour.jukes),
        ("kiteCycles", b.behaviour.kite_cycles),
    ] {
        behaviour.insert(key.into(), value.map_or(Value::Null, |v| json!(v)));
    }
    behaviour.insert(
        "goals".into(),
        b.behaviour.goals.as_ref().map_or(Value::Null, |goals| {
            Value::Object(goals.iter().map(|(k, n)| (k.clone(), json!(n))).collect())
        }),
    );
    json!({
        "id": format!("bot{}", b.index),
        "name": format!("bot{}", b.index),
        "tier": b.seat.tier.as_str(),
        "persona": b.seat.persona.as_str(),
        "faction": b.seat.faction.as_str(),
        "place": js_num(b.place),
        "outcome": b.outcome.as_str(),
        "kills": js_num(b.kills),
        "mobKills": js_num(b.mob_kills),
        "damage": js_num(b.damage),
        "mobDamage": js_num(b.mob_damage),
        "deaths": js_num(b.deaths),
        "gv": js_num(b.gv),
        "diedAtMs": b.died_at_ms.map_or(Value::Null, js_num),
        "firstMobKillMs": b.first_mob_kill_ms.map_or(Value::Null, js_num),
        "tpHp": b.tp_hp.map_or(Value::Null, js_num),
        "diedTo": b.died_to.map_or(Value::Null, |d| match d { DiedTo::Bot => json!("bot"), DiedTo::Mob => json!("mob"), DiedTo::Arena => json!("arena") }),
        "behaviour": Value::Object(behaviour),
    })
}
fn game_json(g: &GameSummary) -> Value {
    json!({
        "seed": g.seed,
        "lineup": g.lineup.iter().map(|s| json!({"tier": s.tier.as_str(), "persona": s.persona.as_str(), "faction": s.faction.as_str()})).collect::<Vec<_>>(),
        "ended": g.ended,
        "winner": g.winner,
        "draw": g.draw,
        "durationMs": js_num(g.duration_ms),
        "ticks": g.ticks,
        "firstDeathMs": g.first_death_ms.map_or(Value::Null, js_num),
        "firstKillMs": g.first_kill_ms.map_or(Value::Null, js_num),
        "deathLog": g.death_log.iter().map(|(at, victim, killer)| json!([js_num(*at), victim, killer.map_or(Value::Null, |k| json!(k))])).collect::<Vec<_>>(),
        "firstHits": g.first_hits.iter().map(|(at, a, v, ahp, vhp, vbusy, abusy)| json!([js_num(*at), a, v, js_num(*ahp), js_num(*vhp), vbusy, abusy])).collect::<Vec<_>>(),
        "teleportMs": g.teleport_ms.map_or(Value::Null, js_num),
        "suddenDeathMs": g.sudden_death_ms.map_or(Value::Null, js_num),
        "bots": g.bots.iter().map(bot_json).collect::<Vec<_>>(),
        "manager": {"sent": g.manager.sent, "applied": g.manager.applied, "refused": g.manager.refused,
                    "lost": g.manager.lost, "frames": g.manager.frames, "errors": g.manager.errors},
    })
}

fn criterion_json(c: &crate::tournament::Criterion) -> Value {
    json!({"ok": c.ok, "text": c.text})
}

/// The source --json payload (source runTournament.ts main): the meta, the plan, the report, the criteria and the games. The ported
/// report/games are the reduced summaries (the telemetry columns and the source evaluate() pass criteria are the
/// P-BOTS-6 remainder); every ported field keeps its source name and JSON shape.
pub fn json_payload(
    plan: &TournamentPlan,
    report: &Report,
    games: &[GameSummary],
    wall_ms: Option<f64>,
    game_ms: Option<f64>,
) -> Value {
    let meta = json!({
        "lineup": lineup_text(&plan.tiers),
        "seed": plan.seed,
        "learn": plan.learn,
        "persona": plan.persona.as_str(),
        "faction": plan.faction.as_str(),
        "workers": plan.workers,
        "wallMs": wall_ms.map_or(Value::Null, js_num),
        "gameMs": game_ms.map_or(Value::Null, js_num),
    });
    json!({
        "meta": meta,
        "plan": plan_json(plan),
        "report": report_json(report),
        "criteria": crate::tournament::evaluate(report).iter().map(criterion_json).collect::<Vec<_>>(),
        "games": games.iter().map(game_json).collect::<Vec<_>>(),
    })
}

/// Write the telemetry NDJSON records to an open sink, propagating every write and flush error.
///
/// This is the real shared write path: the binary opens the telemetry file and calls this with it, so a failing sink
/// fails the run instead of the binary reporting success for records it did not write. The sink is generic so a failing
/// Writer exercises the propagation portably in tests (no /dev/full-style environment).
pub fn write_telemetry<W: std::io::Write>(out: &mut W, lines: &[String]) -> std::io::Result<()> {
    for line in lines {
        writeln!(out, "{line}")?;
    }
    out.flush()
}

/// A place to run a tournament from the CLI: the practice arena with the headless source defaults.
pub fn default_arena() -> rh_sim::Arena {
    rh_sim::arenas::practice_arena()
}

/// The default sim config for the CLI (the tournament module's headless config).
pub fn default_config() -> rh_sim::SimConfig {
    crate::tournament::default_sim_config()
}

/// The parsed arguments in the source TournamentArgs shape (the pinned CLI corpus compares this, never internals).
pub fn args_json(a: &TournamentArgs) -> Value {
    let mut m = Map::new();
    m.insert("games".into(), json!(a.games));
    m.insert("workers".into(), json!(a.workers));
    m.insert(
        "tiers".into(),
        json!(a.tiers.iter().map(|t| t.as_str()).collect::<Vec<_>>()),
    );
    m.insert("seed".into(), json!(a.seed));
    m.insert("learn".into(), json!(a.learn));
    m.insert(
        "persona".into(),
        json!(a
            .persona
            .map_or("mix".to_owned(), |p| p.as_str().to_owned())),
    );
    m.insert(
        "faction".into(),
        json!(a
            .faction
            .map_or("mix".to_owned(), |f| f.as_str().to_owned())),
    );
    m.insert(
        "json".into(),
        a.json.clone().map_or(Value::Null, Value::String),
    );
    m.insert("maxMinutes".into(), js_num(a.max_minutes));
    m.insert("patience".into(), a.patience.map_or(Value::Null, js_num));
    m.insert("sudden".into(), a.sudden.map_or(Value::Null, js_num));
    m.insert("latencyMs".into(), a.latency_ms.map_or(Value::Null, js_num));
    m.insert("jitterMs".into(), a.jitter_ms.map_or(Value::Null, js_num));
    m.insert("tune".into(), a.tune.clone().unwrap_or(Value::Null));
    m.insert("quiet".into(), json!(a.quiet));
    m.insert("help".into(), json!(a.help));
    m.insert(
        "telemetryDir".into(),
        a.telemetry_dir.clone().map_or(Value::Null, Value::String),
    );
    Value::Object(m)
}
