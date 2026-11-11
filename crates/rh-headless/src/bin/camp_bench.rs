//! Camp-clear bench (packet P-BALANCE-2): one fighter (a faction, a weapon, no cards) clears each camp kind of the
//! mob catalog on the seed1 map, under `LegacyCircle` and under `Archetypes` (mob spacing Auto, the live setting).
//! The fighter is the scripted seat `Brawler`, driven through the external-checkpoint seam (C-INPUT: commands only).
//! It measures; it changes no rule and no number, and exits 0 whenever it reported. See tools/balance-camps/README.md.
//!
//! `camp_bench [--seed N] [--quick] [--list] [--with-nospacing] [--max-ticks N] [--control-weapon-swap a=b]`
//! (the swap flag is a test-only negative control: cells labelled `a` are run with weapon `b`).
use rh_headless::{load_arena, Env};
use rh_policy::scripted::Brawler;
use rh_policy::{MatchStart, Policy};
use rh_sim::archetype::{HitboxMode, MobSpacing};
use rh_sim::events::Event;
use rh_sim::mob_catalog::{elites_of, normal_types_of};
use rh_sim::mob_runtime::MobMode;
use rh_sim::status_runtime::StatusKind;
use rh_sim::{
    abilities, terrain, Arena, ArenaMode, FactionId, FactionMode, Placement, PlayerId, Secrets,
    Sim, SimConfig, Vec2, WeaponId,
};
use serde::Serialize;
use std::sync::Arc;

/// The owner-approved relative band (plus or minus 10%, plan 2026-11-10) outside which a cell is listed.
const BAND: f64 = 0.10;
const MAP: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../rh-sim/src/mapdata/fixtures/seed1.map.json"
);
/// Start distance of the fighter from the camp (10 tiles, as the legacy `--map` mode of campDuel.ts).
const START_DIST: f64 = 320.;

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Legacy,
    Archetypes,
    NoSpacing,
}
impl Mode {
    fn label(self) -> &'static str {
        match self {
            Mode::Legacy => "legacy",
            Mode::Archetypes => "archetypes",
            Mode::NoSpacing => "archetypes-nospacing",
        }
    }
    fn knobs(self) -> (HitboxMode, MobSpacing) {
        match self {
            Mode::Legacy => (HitboxMode::LegacyCircle, MobSpacing::Auto),
            Mode::Archetypes => (HitboxMode::Archetypes, MobSpacing::Auto),
            Mode::NoSpacing => (HitboxMode::Archetypes, MobSpacing::Off),
        }
    }
}

#[derive(Serialize, Clone, Default)]
struct Cell {
    faction: String,
    weapon: String,
    kind: String,
    zone: String,
    elite: bool,
    mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    camp: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mobs: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    roster_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hp_start: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    outcome: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ticks_to_clear: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    damage_dealt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    damage_taken: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hp_remaining: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    healing_received: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chill_seconds: Option<f64>,
}

#[derive(Serialize)]
struct Metric {
    legacy: f64,
    archetypes: f64,
    rel_delta: Option<f64>,
}
#[derive(Serialize)]
struct Metrics {
    ticks_to_clear: Metric,
    damage_dealt: Metric,
    damage_taken: Metric,
    hp_remaining: Metric,
    healing_received: Metric,
    chill_seconds: Metric,
}
#[derive(Serialize)]
struct Comparison {
    faction: String,
    weapon: String,
    kind: String,
    outcomes: [&'static str; 2],
    metrics: Metrics,
}
#[derive(Serialize)]
struct OutOfBand {
    faction: String,
    weapon: String,
    kind: String,
    metric: &'static str,
}
#[derive(Serialize)]
struct Report {
    version: u32,
    seed: u64,
    quick: bool,
    list_only: bool,
    max_ticks: u32,
    band: f64,
    cells: Vec<Cell>,
    comparisons: Vec<Comparison>,
    out_of_band: Vec<OutOfBand>,
}

/// One camp kind: zone, catalog type id, elite.
struct Kind {
    zone: FactionId,
    id: rh_sim::mob_catalog::MobTypeId,
    elite: bool,
}

fn kinds(quick: bool) -> Vec<Kind> {
    let mut out = Vec::new();
    for zone in FactionId::ALL {
        if quick && zone != FactionId::ALL[0] {
            continue;
        }
        let normals: Vec<_> = normal_types_of(zone).map(|t| t.id).collect();
        let elites: Vec<_> = elites_of(zone).map(|t| t.id).collect();
        let n = if quick { 1 } else { usize::MAX };
        for id in normals.into_iter().take(n) {
            out.push(Kind {
                zone,
                id,
                elite: false,
            });
        }
        for id in elites.into_iter().take(n) {
            out.push(Kind {
                zone,
                id,
                elite: true,
            });
        }
    }
    out
}

fn config(mode: Mode) -> SimConfig {
    let (hitboxes, mob_spacing) = mode.knobs();
    SimConfig {
        mob_spacing,
        walk_hints: Some(true),
        regen: false,
        quests: false,
        hazards: terrain::Mode::All,
        abilities: abilities::Mode::Full,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        lifecycle: ArenaMode::Off,
        mob_mode: MobMode::Pve,
        initial_loot: true,
        consumables: false,
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        hitboxes,
        ..SimConfig::default()
    }
}

/// The camp chosen for a kind and where the fighter starts; identical in every mode and for every fighter.
struct Scene {
    camp: u32,
    mobs: u32,
    roster_type: String,
    start: Vec2,
}

fn floor_line(arena: &Arena, a: Vec2, b: Vec2) -> bool {
    let steps = 40;
    (0..=steps).all(|i| {
        let t = i as f64 / steps as f64;
        let x = a.x + (b.x - a.x) * t;
        let y = a.y + (b.y - a.y) * t;
        let (tx, ty) = (rh_sim::map::world_to_tile(x), rh_sim::map::world_to_tile(y));
        arena.map.is_floor(tx, ty)
    })
}

fn scene_for(probe: &Sim, arena: &Arena, kind: &Kind) -> Result<Scene, String> {
    let rosters = probe.camp_rosters();
    let camp = rosters
        .iter()
        .position(|r| {
            if kind.elite {
                r.elite == Some(kind.id)
            } else {
                r.mob_type == kind.id && r.elite.is_none()
            }
        })
        .ok_or_else(|| {
            format!(
                "seed rolls no {} camp of {}",
                if kind.elite { "elite" } else { "normal" },
                kind.id.as_str()
            )
        })? as u32;
    let members: Vec<Vec2> = probe
        .mobs()
        .iter()
        .filter(|m| m.camp == camp && m.zombie.is_none())
        .map(|m| m.core.pos())
        .collect();
    if members.is_empty() {
        return Err(format!(
            "camp {camp} of {} has no mobs at start",
            kind.id.as_str()
        ));
    }
    let n = members.len() as f64;
    let centre = Vec2::new(
        members.iter().map(|p| p.x).sum::<f64>() / n,
        members.iter().map(|p| p.y).sum::<f64>() / n,
    );
    // Deterministic floor point: the first of 16 bearings, then shorter distances, with a straight floor line to the camp.
    for dist in [START_DIST, 256., 192., 128.] {
        for k in 0..16 {
            let a = k as f64 * std::f64::consts::TAU / 16.;
            let p = Vec2::new(centre.x + a.cos() * dist, centre.y + a.sin() * dist);
            if floor_line(arena, p, centre) {
                return Ok(Scene {
                    camp,
                    mobs: members.len() as u32,
                    roster_type: rosters[camp as usize].mob_type.as_str().to_string(),
                    start: p,
                });
            }
        }
    }
    Err(format!("no floor start point near camp {camp}"))
}

fn build(arena: &Arc<Arena>, mode: Mode, seed: u64, placement: &[Placement]) -> Sim {
    Sim::reset_active(
        config(mode),
        arena.clone(),
        Secrets::from_seed(seed),
        placement,
    )
}

struct Measured {
    outcome: &'static str,
    ticks: u32,
    dealt: f64,
    taken: f64,
    hp_left: f64,
    healed: f64,
    chill: f64,
    hp_start: f64,
}

fn fight(
    arena: &Arc<Arena>,
    mode: Mode,
    seed: u64,
    faction: FactionId,
    weapon: WeaponId,
    scene: &Scene,
    max_ticks: u32,
) -> Measured {
    let placement = [Placement {
        profile: "fighter".into(),
        faction,
        bot: false,
        at: scene.start,
        hp: None,
        weapon0: Some(weapon),
        weapon1: None,
    }];
    let sim = build(arena, mode, seed, &placement);
    let me: PlayerId = sim.players()[0].id;
    let hp_start = sim.players()[0].vitals.hp;
    let mut brawler = Brawler::new(1);
    brawler.reset(&MatchStart::of(&sim, me, seed));
    let (mut env, mut obs) = Env::from_external_checkpoint(sim, max_ticks).expect("checkpoint");
    let mut m = Measured {
        outcome: "truncated",
        ticks: max_ticks,
        dealt: 0.,
        taken: 0.,
        hp_left: hp_start,
        healed: 0.,
        chill: 0.,
        hp_start,
    };
    for tick in 1..=max_ticks {
        let cmds = brawler.decide(&obs[0]);
        let out = env.step(&[cmds]);
        for e in &out.events {
            match e {
                Event::Hit {
                    victim, by, amount, ..
                }
                | Event::AbilityHit {
                    victim, by, amount, ..
                } => tally(&mut m, me, *victim, *by, *amount),
                Event::SignatureHit {
                    victim, by, amount, ..
                } => tally(&mut m, me, *victim, Some(*by), *amount),
                Event::CardBleedHit { victim, by, amount } => {
                    if let rh_sim::events::CardBleedAmount::Finite(a) = amount {
                        tally(&mut m, me, *victim, *by, *a)
                    }
                }
                Event::Heal { id, amount } if *id == me => m.healed += amount,
                Event::StatusApplied { kind, ms, by, .. } if *by == Some(me) => {
                    if matches!(
                        kind,
                        StatusKind::SlowMove | StatusKind::Root | StatusKind::Stun
                    ) {
                        m.chill += ms / 1000.;
                    }
                }
                _ => {}
            }
        }
        m.chill += 0.05
            * env
                .sim
                .mobs()
                .iter()
                .filter(|b| b.core.signature.chill < 1. && b.core.signature.chillers.contains(&me))
                .count() as f64;
        obs = out.observations;
        m.ticks = tick;
        let hp = env.sim.player(me).map_or(0., |p| p.vitals.hp);
        m.hp_left = hp.max(0.);
        if hp <= 0. {
            m.outcome = "died";
            m.hp_left = 0.;
            break;
        }
        let alive = env.sim.camp_rosters()[scene.camp as usize].alive;
        let any = env.sim.mobs().iter().any(|b| {
            b.camp == scene.camp && b.zombie.is_none() && b.status == rh_sim::state::Status::Alive
        });
        if alive == 0 && !any {
            m.outcome = "cleared";
            break;
        }
    }
    // Burn damage is reported in batches (SignatureHit every few ticks), so damage dealt to the fighter that has not
    // been reported yet at the end of the run is real but unlisted. The hp ledger is the floor: hp lost plus healing.
    m.taken = m.taken.max(m.hp_start - m.hp_left + m.healed);
    m
}

fn tally(m: &mut Measured, me: PlayerId, victim: PlayerId, by: Option<PlayerId>, amount: f64) {
    if victim == me {
        m.taken += amount;
    } else if by == Some(me) {
        m.dealt += amount;
    }
}

fn rel(l: f64, a: f64) -> Option<f64> {
    if l == 0. {
        (a == 0.).then_some(0.)
    } else {
        Some((a - l) / l)
    }
}
fn metric(l: f64, a: f64) -> Metric {
    Metric {
        legacy: l,
        archetypes: a,
        rel_delta: rel(l, a),
    }
}
fn values(c: &Cell) -> [f64; 6] {
    [
        c.ticks_to_clear.unwrap_or(0) as f64,
        c.damage_dealt.unwrap_or(0.),
        c.damage_taken.unwrap_or(0.),
        c.hp_remaining.unwrap_or(0.),
        c.healing_received.unwrap_or(0.),
        c.chill_seconds.unwrap_or(0.),
    ]
}
const METRICS: [&str; 6] = [
    "ticks_to_clear",
    "damage_dealt",
    "damage_taken",
    "hp_remaining",
    "healing_received",
    "chill_seconds",
];

fn fail(msg: &str) -> ! {
    eprintln!("camp_bench: {msg}");
    std::process::exit(2)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |n: &str| args.iter().any(|a| a == n);
    let value = |n: &str| {
        args.iter().position(|a| a == n).map(|i| {
            args.get(i + 1)
                .cloned()
                .unwrap_or_else(|| fail(&format!("{n} needs a value")))
        })
    };
    let seed: u64 = value("--seed").map_or(1, |v| v.parse().unwrap_or_else(|_| fail("bad --seed")));
    let max_ticks: u32 = value("--max-ticks").map_or(1800, |v| {
        v.parse().unwrap_or_else(|_| fail("bad --max-ticks"))
    });
    let (quick, list_only, nospacing) = (flag("--quick"), flag("--list"), flag("--with-nospacing"));
    let swap: Option<(WeaponId, WeaponId)> = value("--control-weapon-swap").map(|v| {
        let (a, b) = v
            .split_once('=')
            .unwrap_or_else(|| fail("--control-weapon-swap a=b"));
        let w = |s: &str| {
            WeaponId::ALL
                .into_iter()
                .find(|w| w.as_str() == s)
                .unwrap_or_else(|| fail("unknown weapon"))
        };
        (w(a), w(b))
    });

    let factions: Vec<FactionId> = FactionId::ALL
        .into_iter()
        .filter(|f| !quick || matches!(f, FactionId::Frost | FactionId::Holy))
        .collect();
    let weapons: Vec<WeaponId> = WeaponId::ALL
        .into_iter()
        .filter(|w| !quick || matches!(w, WeaponId::Sword | WeaponId::Wand))
        .collect();
    let kinds = kinds(quick);
    let mut modes = vec![Mode::Legacy, Mode::Archetypes];
    if nospacing {
        modes.push(Mode::NoSpacing);
    }

    let arena = Arc::new(load_arena(MAP).unwrap_or_else(|e| fail(&e)));
    // One probe world per seed picks the camps; every mode and fighter then fights the same camp from the same point.
    let scenes: Vec<Option<Scene>> = if list_only {
        kinds.iter().map(|_| None).collect()
    } else {
        let probe = build(
            &arena,
            Mode::Legacy,
            seed,
            &[Placement {
                profile: "probe".into(),
                faction: FactionId::Frost,
                bot: false,
                at: arena.centre(),
                hp: None,
                weapon0: None,
                weapon1: None,
            }],
        );
        kinds
            .iter()
            .map(|k| Some(scene_for(&probe, &arena, k).unwrap_or_else(|e| fail(&e))))
            .collect()
    };

    let mut cells = Vec::new();
    let mut comparisons = Vec::new();
    let mut out_of_band = Vec::new();
    for &f in &factions {
        for &w in &weapons {
            let wielded = match swap {
                Some((from, to)) if from == w => to,
                _ => w,
            };
            for (k, scene) in kinds.iter().zip(&scenes) {
                let mut row = Vec::new();
                for &mode in &modes {
                    let mut c = Cell {
                        faction: f.as_str().into(),
                        weapon: w.as_str().into(),
                        kind: k.id.as_str().into(),
                        zone: k.zone.as_str().into(),
                        elite: k.elite,
                        mode: mode.label().into(),
                        ..Cell::default()
                    };
                    if let Some(scene) = scene {
                        let m = fight(&arena, mode, seed, f, wielded, scene, max_ticks);
                        c.camp = Some(scene.camp);
                        c.mobs = Some(scene.mobs);
                        c.roster_type = Some(scene.roster_type.clone());
                        c.hp_start = Some(m.hp_start);
                        c.outcome = Some(m.outcome);
                        c.ticks_to_clear = Some(m.ticks);
                        c.damage_dealt = Some(m.dealt);
                        c.damage_taken = Some(m.taken);
                        c.hp_remaining = Some(m.hp_left);
                        c.healing_received = Some(m.healed);
                        c.chill_seconds = Some(m.chill);
                    }
                    row.push(c);
                }
                if scene.is_some() {
                    let (l, a) = (&row[0], &row[1]);
                    let (lv, av) = (values(l), values(a));
                    let id = |metric| OutOfBand {
                        faction: l.faction.clone(),
                        weapon: l.weapon.clone(),
                        kind: l.kind.clone(),
                        metric,
                    };
                    if l.outcome != a.outcome {
                        out_of_band.push(id("outcome"));
                    }
                    for (i, name) in METRICS.iter().enumerate() {
                        if rel(lv[i], av[i]).is_none_or(|d| d.abs() > BAND) {
                            out_of_band.push(id(name));
                        }
                    }
                    comparisons.push(Comparison {
                        faction: l.faction.clone(),
                        weapon: l.weapon.clone(),
                        kind: l.kind.clone(),
                        outcomes: [l.outcome.unwrap_or(""), a.outcome.unwrap_or("")],
                        metrics: Metrics {
                            ticks_to_clear: metric(lv[0], av[0]),
                            damage_dealt: metric(lv[1], av[1]),
                            damage_taken: metric(lv[2], av[2]),
                            hp_remaining: metric(lv[3], av[3]),
                            healing_received: metric(lv[4], av[4]),
                            chill_seconds: metric(lv[5], av[5]),
                        },
                    });
                }
                cells.extend(row);
            }
        }
    }
    let report = Report {
        version: 1,
        seed,
        quick,
        list_only,
        max_ticks,
        band: BAND,
        cells,
        comparisons,
        out_of_band,
    };
    println!(
        "{}",
        serde_json::to_string(&report).expect("report serialises")
    );
}
