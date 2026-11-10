//! ADR0024 P-HB-9 measurement (not a balance harness: there is no Rust duel/TTK harness yet, P-BALANCE-1): full-map bot
//! matches with the live `--runtime source-arena` SimConfig and the live fill bots (HumanBot), run on the same seeds in
//! both hitbox modes. Per mode it reports:
//!
//! * ranged shots and hits per shooter class (bot / mob), shooter look, intended target look and weapon. A shot's
//!   intended target is attributed at launch: the hostile fighter nearest the shot's bearing (within 0.5 rad and the
//!   weapon's range plus 40 u), on ground positions. A shot counts as a hit when it ends on a body (hit, reflected or
//!   blocked). The look is the archetype the fighter has under `Archetypes` (the same in both modes, for pairing);
//! * melee swings and swings that hit at least one body, per class and weapon;
//! * hits, player and mob deaths, damage per weapon and match length.
//!
//!   cargo run --release -p rh-headless --example hitbox_compare -- <map> <seed_from> <seed_to> [max_ticks] [modes]
//!
//! `modes` is `both` (default), `legacy` or `archetypes`. A panic or a hang (a match that neither ends nor reaches
//! `max_ticks`) is a failure of the run, so this doubles as the archetype-mode soak.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::archetype::{assign, HitboxMode, Identity, ARCHETYPES};
use rh_sim::events::Event;
use rh_sim::fighter::FighterAffiliation;
use rh_sim::math::{angle_between, atan2, hypot};
use rh_sim::{
    abilities, mob_runtime::MobMode, terrain, ArenaMode, FactionId, FactionMode, PlayerId,
    ProjectileEnd, SimConfig, Vec2, WeaponId,
};
use std::collections::{BTreeMap, HashMap};

pub fn live_config(hitboxes: HitboxMode) -> SimConfig {
    SimConfig {
        walk_hints: Some(true),
        regen: true,
        quests: true,
        hazards: terrain::Mode::All,
        abilities: abilities::Mode::Full,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        lifecycle: ArenaMode::Source(Default::default()),
        mob_mode: MobMode::Pve,
        initial_loot: true,
        consumables: true,
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        hitboxes,
        ..SimConfig::default()
    }
}

#[derive(Clone, Copy)]
struct Who {
    look: &'static str,
    mob: bool,
    zombie_of: Option<PlayerId>,
    faction: Option<FighterAffiliation>,
    pos: Vec2,
    alive: bool,
}

fn look(identity: Identity) -> &'static str {
    ARCHETYPES[assign(HitboxMode::Archetypes, identity).0 as usize].key
}

fn roster(sim: &rh_sim::Sim) -> HashMap<PlayerId, Who> {
    let mut out = HashMap::new();
    for p in sim.players() {
        out.insert(
            p.id,
            Who {
                look: look(Identity::Player(p.vitals.faction)),
                mob: false,
                zombie_of: None,
                faction: Some(p.vitals.faction),
                pos: p.pos(),
                alive: p.vitals.hp > 0.,
            },
        );
    }
    for m in sim.mobs() {
        let Some(identity) = m.identity() else {
            continue;
        };
        out.insert(
            m.core.id,
            Who {
                look: look(identity),
                mob: true,
                zombie_of: m.owner,
                faction: None,
                pos: m.core.pos(),
                alive: m.core.vitals.hp > 0.,
            },
        );
    }
    out
}

fn hostile(owner: PlayerId, a: &Who, b: &Who) -> bool {
    match (a.mob, b.mob) {
        (true, _) => !b.mob,
        (false, true) => b.zombie_of != Some(owner),
        (false, false) => a.faction != b.faction,
    }
}

#[derive(Default)]
struct Tally {
    shots: u64,
    hits: u64,
}

#[derive(Default)]
struct Mode {
    matches: u64,
    ticks: u64,
    terminated: u64,
    truncated: u64,
    hit_events: u64,
    player_deaths: u64,
    mob_deaths: u64,
    // (class, shooter look, target look, weapon)
    ranged: BTreeMap<(&'static str, &'static str, &'static str, &'static str), Tally>,
    // (class, weapon)
    ranged_total: BTreeMap<(&'static str, &'static str), Tally>,
    melee: BTreeMap<(&'static str, &'static str), Tally>,
    damage: BTreeMap<&'static str, f64>,
    // (class, weapon, homing, end reason) for misses and hits, to see why a shot class misses
    ends: BTreeMap<(&'static str, &'static str, bool, String), u64>,
}

fn weapon_name(w: WeaponId) -> &'static str {
    match w {
        WeaponId::Sword => "sword",
        WeaponId::Bow => "bow",
        WeaponId::Wand => "wand",
        WeaponId::Shield => "shield",
        WeaponId::Axe => "axe",
        WeaponId::Fists => "fists",
        #[allow(unreachable_patterns)]
        _ => "other",
    }
}

fn run(arena: &rh_sim::Arena, mode: HitboxMode, seed: u64, max_ticks: u32, out: &mut Mode) {
    let agents = (0..8)
        .map(|i| AgentSpec {
            profile: format!("bot{i}"),
            faction: FactionId::ALL[(i + seed as usize) % 5],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(rh_policy::bots::HumanBot::new(
                    rh_policy::bots::TierId::ALL[(i + seed as usize) % 3],
                    rh_policy::bots::PersonaId::ALL[i % 4],
                )),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena: arena.clone(),
            sim: live_config(mode),
            max_ticks,
            record: false,
        },
        agents,
        seed,
    );
    // projectile id -> (class, shooter look, target look, weapon)
    let mut pending: HashMap<u32, (&'static str, &'static str, &'static str, &'static str)> =
        HashMap::new();
    let mut homing: HashMap<u32, bool> = HashMap::new();
    let mut ticks = 0u64;
    let progress = loop {
        let p = env.advance(&[]);
        ticks += 1;
        let events = env.last_events();
        let mut who: Option<HashMap<PlayerId, Who>> = None;
        let mut swings: Vec<(PlayerId, WeaponId)> = Vec::new();
        for e in events {
            match e {
                Event::ProjectileLaunched(l) if !l.reflected => {
                    let r = who.get_or_insert_with(|| roster(&env.sim));
                    let Some(shooter) = r.get(&l.owner).copied() else {
                        continue;
                    };
                    let bearing = atan2(l.velocity.y, l.velocity.x);
                    let mut best: Option<(f64, f64, &'static str)> = None;
                    for (&id, t) in r.iter() {
                        if id == l.owner || !t.alive || !hostile(l.owner, &shooter, t) {
                            continue;
                        }
                        let (dx, dy) = (t.pos.x - l.origin.x, t.pos.y - l.origin.y);
                        let d = hypot(dx, dy);
                        if d > l.range + 40. || d < 1e-6 {
                            continue;
                        }
                        let dev = angle_between(atan2(dy, dx), bearing);
                        if dev <= 0.5 && best.is_none_or(|b| (dev, d) < (b.0, b.1)) {
                            best = Some((dev, d, t.look));
                        }
                    }
                    let weapon = if l.kind == rh_sim::ProjectileKind::Arrow {
                        "bow"
                    } else {
                        "wand"
                    };
                    homing.insert(l.id, l.target.is_some());
                    pending.insert(
                        l.id,
                        (
                            if shooter.mob { "mob" } else { "bot" },
                            shooter.look,
                            best.map_or("?", |b| b.2),
                            weapon,
                        ),
                    );
                }
                Event::ProjectileEnded { launch, reason, .. } => {
                    if let Some(key) = pending.remove(&launch.id) {
                        let h = homing.remove(&launch.id).unwrap_or(false);
                        *out.ends
                            .entry((key.0, key.3, h, format!("{reason:?}")))
                            .or_default() += 1;
                        let hit = matches!(
                            reason,
                            ProjectileEnd::Hit | ProjectileEnd::Reflected | ProjectileEnd::Blocked
                        );
                        for t in [
                            out.ranged.entry(key).or_default(),
                            out.ranged_total.entry((key.0, key.3)).or_default(),
                        ] {
                            t.shots += 1;
                            t.hits += hit as u64;
                        }
                    }
                }
                Event::Swing { by, weapon, .. } => swings.push((*by, *weapon)),
                Event::Hit {
                    by, amount, weapon, ..
                } => {
                    out.hit_events += 1;
                    if let (Some(_), Some(w)) = (by, weapon) {
                        *out.damage.entry(weapon_name(*w)).or_default() += amount;
                    }
                }
                Event::Death { id, .. } => {
                    if env.sim.players().iter().any(|p| p.id == *id) {
                        out.player_deaths += 1;
                    } else {
                        out.mob_deaths += 1;
                    }
                }
                _ => {}
            }
        }
        if !swings.is_empty() {
            let mob_ids: Vec<PlayerId> = env.sim.mobs().iter().map(|m| m.core.id).collect();
            for (by, weapon) in swings {
                let landed = events.iter().any(|e| {
                    matches!(e, Event::Hit { by: Some(b), weapon: Some(w), passive: false, .. } if *b == by && *w == weapon)
                        || matches!(e, Event::Block { by: b, weapon: w, passive: false, .. } if *b == by && *w == weapon)
                });
                let class = if mob_ids.contains(&by) { "mob" } else { "bot" };
                let t = out.melee.entry((class, weapon_name(weapon))).or_default();
                t.shots += 1;
                t.hits += landed as u64;
            }
        }
        if p.terminated || p.truncated {
            break p;
        }
    };
    out.matches += 1;
    out.ticks += ticks;
    out.terminated += progress.terminated as u64;
    out.truncated += progress.truncated as u64;
}

fn rate(t: &Tally) -> f64 {
    if t.shots == 0 {
        0.
    } else {
        t.hits as f64 / t.shots as f64
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let arena = rh_headless::load_arena(&a[1]).unwrap();
    let (from, to): (u64, u64) = (a[2].parse().unwrap(), a[3].parse().unwrap());
    let max_ticks: u32 = a.get(4).map_or(12_000, |v| v.parse().unwrap());
    let modes: Vec<HitboxMode> = match a.get(5).map(String::as_str) {
        None | Some("both") => vec![HitboxMode::LegacyCircle, HitboxMode::Archetypes],
        Some("legacy") => vec![HitboxMode::LegacyCircle],
        Some("archetypes") => vec![HitboxMode::Archetypes],
        Some(other) => panic!("modes must be both, legacy or archetypes, not {other:?}"),
    };
    let mut results = Vec::new();
    for &mode in &modes {
        let mut m = Mode::default();
        for seed in from..to {
            run(&arena, mode, seed, max_ticks, &mut m);
        }
        results.push((mode, m));
    }
    for (mode, m) in &results {
        println!(
            "== {mode:?}: matches {} terminated {} truncated {} ticks {} (mean {:.0}) hits {} playerDeaths {} mobDeaths {}",
            m.matches,
            m.terminated,
            m.truncated,
            m.ticks,
            m.ticks as f64 / m.matches.max(1) as f64,
            m.hit_events,
            m.player_deaths,
            m.mob_deaths
        );
        for ((class, w), t) in &m.ranged_total {
            println!(
                "ranged {class:<4} {w:<6} shots {:>6} hits {:>6} rate {:.3}",
                t.shots,
                t.hits,
                rate(t)
            );
        }
        for ((class, w), t) in &m.melee {
            println!(
                "melee  {class:<4} {w:<6} swings {:>6} landed {:>6} rate {:.3}",
                t.shots,
                t.hits,
                rate(t)
            );
        }
        for ((class, w, h, why), n) in &m.ends {
            println!("end    {class:<4} {w:<6} homing {h:<5} {why:<10} {n}");
        }
        for (w, d) in &m.damage {
            println!("damage {w:<6} {d:.0}");
        }
        for ((class, s, t, w), x) in &m.ranged {
            println!(
                "pair {class:<4} {s:<20} -> {t:<20} {w:<5} shots {:>5} hits {:>5} rate {:.3}",
                x.shots,
                x.hits,
                rate(x)
            );
        }
    }
}
