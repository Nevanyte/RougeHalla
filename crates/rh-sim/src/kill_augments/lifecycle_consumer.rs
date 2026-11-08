//! Native consumer of the admitted P-TROPHY-WITNESS-1 lifecycle corpus ('parity/trophy-witness/lifecycle.json').
//!
//! This module is cfg(test)-only evidence: it replays each captured four-seat player-only/no-mobs world through the REAL
//! native simulation (real cards::grant, real grant_mob_stat, real validated Attack/Choose inputs and ordinary steps),
//! then compares the native frames against the declared source frames. The declared initial placements/grants/weapons/
//! wounds are labelled trusted setup, never ReplayInput; expected Trophy options/gains/takenBy/killStats are never installed.
//!
//! Known source divergence (reported, not fixed here): the native reward_chests::choose birth-hold guard is
//! 'held_until_tick > tick', while the source loot.bornThisTick refuses the birth tick AND the next tick ('born >= tick',
//! with holdBirth recording 'tick + 1'). Case 'birth-hold-owner-choose' therefore lets the owner pick one tick early. The
//! dependent later frames of that case are not asserted; the exact divergence is asserted instead (see
//! birth_hold_diverges_from_the_source_hold). The native observer's own can_choose ('held_until_tick < tick') already
//! agrees with the source, so the minimal production change would be to make choose use the same predicate.
use crate::events::Event;
use crate::kill_augments::KillStatKey;
use crate::reward_chests::OptionId;
use crate::state::Status;
use crate::{
    cards, input::validate, input::RawCommand, mapdata::MapExport, FactionId, PlayerId, Secrets,
    Sim, SimConfig, Vec2,
};
use std::collections::BTreeMap;

const CORPUS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../parity/trophy-witness/lifecycle.json"
);

fn corpus() -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(CORPUS).expect("admitted lifecycle corpus"))
        .expect("lifecycle corpus json")
}

fn case<'a>(doc: &'a serde_json::Value, name: &str) -> &'a serde_json::Value {
    doc["cases"]
        .as_array()
        .expect("captured cases")
        .iter()
        .find(|c| c["input"]["name"].as_str() == Some(name))
        .unwrap_or_else(|| panic!("captured case {name}"))
}

fn num(v: &serde_json::Value) -> f64 {
    v.as_f64().expect("a JSON number")
}

fn r6(v: f64) -> f64 {
    if v.is_finite() {
        (v * 1e6).round() / 1e6
    } else {
        v
    }
}

fn player_id(i: usize) -> PlayerId {
    PlayerId(i as u32 + 1)
}

fn source_label(index: usize) -> String {
    format!("p{index}")
}

/// The admitted source map for generateMap(1, 0, {decor:false}): the native-owned export of the same bytes the ability
/// source rig and the trophy capture used. Fixed evidence, not regenerated here.
fn arena() -> crate::Arena {
    let export: MapExport =
        serde_json::from_str(include_str!("../mapdata/fixtures/seed1.map.json"))
            .expect("native seed-1 map fixture");
    export
        .validate()
        .expect("admitted map")
        .into_arena()
        .expect("arena")
}

/// The declared source profile bound to the native switches it has. The corpus profile is four-seat player-only,
/// no-mobs, weapons-only (signatures off) with quests/training/dummies off and the source arena lifecycle.
fn config(input: &serde_json::Value) -> SimConfig {
    let c = &input["config"];
    assert_eq!(c["mobs"], false, "player-only/no-mobs profile");
    assert_eq!(c["signatures"], false, "signatures-off profile");
    assert_eq!(c["quests"], false, "quests-off profile");
    assert_eq!(c["pvpRules"], false, "source capture's pvpRules off");
    let training = c["training"].as_bool().expect("training switch");
    assert_eq!(c["dummies"], training, "dummies only in the training world");
    SimConfig {
        // The capture drives no ability or consumable producer; those modules are outside this slice.
        abilities: crate::abilities::Mode::Off,
        consumables: false,
        initial_loot: false,
        lifecycle: if training {
            crate::ArenaMode::Off
        } else {
            crate::ArenaMode::Source(crate::ArenaRules {
                plan_seconds: num(&c["planSeconds"]),
                first_patience_seconds: None,
                coliseum_schedule: None,
                patience_seconds: num(&c["patienceSeconds"]),
                patience_min_seconds: num(&c["patienceMinSeconds"]),
                sudden_death_seconds: num(&c["suddenDeathSeconds"]),
            })
        },
        min_players: c["minPlayers"].as_u64().expect("minPlayers") as usize,
        lobby_seconds: num(&c["lobbySeconds"]),
        fill_seconds: num(&c["fillSeconds"]),
        pvp_rules: c["pvpRules"].as_bool().expect("pvpRules"),
        quests: c["quests"].as_bool().expect("quests"),
        training,
        dummies: c["dummies"].as_bool().expect("dummies"),
        // No signature/faction passives and no mob runtime in this profile.
        faction_mode: crate::FactionMode::Off,
        mob_mode: crate::mob_runtime::MobMode::Off,
        ..Default::default()
    }
}

fn random_of(input: &serde_json::Value) -> u32 {
    input["seeds"]["random"]
        .as_u64()
        .expect("captured random seed") as u32
}

fn reward_salt(input: &serde_json::Value) -> [u32; 4] {
    let salt = input["seeds"]["rewardSalt"]
        .as_array()
        .expect("captured reward salt");
    std::array::from_fn(|i| salt[i].as_u64().expect("reward salt word") as u32)
}

/// Open the declared world. order_salt is the first draw of the captured main stream, exactly the source createWorld
/// order-salt draw; the declared initial frame placements/hp are then applied as labelled trusted setup (the source
/// capture's shuffled spawn assignment is not claimed: the source installs the loot module's constructor draws, which
/// this slice does not install).
fn open(input: &serde_json::Value) -> Sim {
    let random = random_of(input);
    let mut main = crate::rng::Mulberry32::new(random);
    let order_salt = main.next_u32();
    let secrets = Secrets {
        order_salt,
        spawn_seed: random,
        reward_salt: reward_salt(input),
    };
    let mut sim = Sim::new(config(input), arena(), secrets);
    let players = input["players"].as_array().expect("declared players");
    for (i, p) in players.iter().enumerate() {
        let faction =
            FactionId::parse(p["faction"].as_str().expect("faction")).expect("known faction");
        sim.add_player(&format!("name{i}"), Some(faction), false)
            .expect("the source roster joins the lobby");
    }
    sim.step();
    assert_eq!(sim.w.tick, 1, "the declared bootstrap tick");
    assert_eq!(
        sim.w.phase,
        crate::Phase::Active,
        "the lobby closes on step 1"
    );
    let initial = input["initial"].as_array().expect("declared initial frame");
    assert_eq!(
        initial.len(),
        players.len(),
        "one declared placement per seat"
    );
    for (i, spec) in initial.iter().enumerate() {
        let faction =
            FactionId::parse(spec["faction"].as_str().expect("faction")).expect("known faction");
        let (x, y) = (num(&spec["x"]), num(&spec["y"]));
        let hp = num(&spec["hp"]);
        let max_hp = num(&spec["maxHp"]);
        let t = sim.w.server_time;
        let p = &mut sim.w.players[i];
        assert_eq!(p.vitals.faction, faction, "declared seat faction");
        assert_eq!(r6(p.vitals.max_hp), r6(max_hp), "declared seat max hp");
        p.body.x = x;
        p.body.y = y;
        p.body.facing = 0.;
        p.motion.slip = None;
        p.body.history.reset(crate::state::Sample { t, x, y });
        p.vitals.hp = hp;
    }
    sim.take_events();
    sim
}

/// The source Trophy id -> owner index relation declared by the corpus frames (never used as a native id alias).
fn source_trophy_owners(case: &serde_json::Value) -> BTreeMap<String, usize> {
    let mut out = BTreeMap::new();
    for frame in case["frames"].as_array().expect("frames") {
        for t in frame["trophies"].as_array().expect("trophies") {
            if let (Some(id), Some(owner)) = (t["id"].as_str(), t["owner"].as_u64()) {
                out.entry(id.to_string()).or_insert(owner as usize);
            }
        }
    }
    out
}

/// Map a source Trophy id through the ACTUAL native birth/ownership relation: the newest reward container owned by the
/// killer the source frame declares. Never a raw source-id alias.
fn native_trophy_for(sim: &Sim, source_id: &str, owners: &BTreeMap<String, usize>) -> Option<u32> {
    let owner = *owners.get(source_id)?;
    sim.w
        .reward_chests
        .iter()
        .filter(|c| c.owner == Some(player_id(owner)))
        .max_by_key(|c| c.id)
        .map(|c| c.id)
}

fn apply_action(
    sim: &mut Sim,
    action: &serde_json::Value,
    owners: &BTreeMap<String, usize>,
    refusals: &mut Vec<String>,
) {
    let actor = action["actor"].as_u64().expect("action actor") as usize;
    let id = player_id(actor);
    match action["kind"].as_str().expect("action kind") {
        "grantCard" => {
            let card: cards::CardId =
                serde_json::from_value(action["card"].clone()).expect("declared card id");
            assert!(
                cards::grant(&sim.k, &mut sim.w, id, card),
                "real card grant {card:?}"
            );
        }
        "grantMobStat" => {
            let name = action["mobType"].as_str().expect("declared mob type");
            let amount = action["amount"].as_u64().expect("declared stack count");
            match crate::mob_catalog::MobTypeId::parse(name) {
                Some(mob) => {
                    assert_eq!(
                        crate::modifiers::grant_mob_stat(&sim.k, &mut sim.w, id, mob, amount),
                        amount,
                        "real mob-stat grant"
                    );
                }
                None => {
                    // The source producer was called with a role id ("brute"), not a mob type: the ACTUAL source
                    // grantMobStat returns 0 and stores nothing. Mirror that refusal instead of fabricating a stat.
                    refusals.push(format!("grantMobStat refused unknown type {name}"));
                }
            }
        }
        "weapon" => {
            let i = sim.w.idx(id).expect("weapon actor");
            let weapon = crate::content::WeaponId::parse(action["weapon"].as_str().unwrap())
                .expect("declared weapon");
            sim.w.players[i].weapon.weapon0 = Some(weapon);
            sim.w.players[i].weapon.weapon1 = None;
            sim.w.players[i].weapon.slot = 0;
        }
        "place" => {
            let i = sim.w.idx(id).expect("place actor");
            let x = num(&action["x"]);
            let y = num(&action["y"]);
            let t = sim.w.server_time;
            let p = &mut sim.w.players[i];
            p.body.x = x;
            p.body.y = y;
            p.body.facing = 0.;
            p.motion.slip = None;
            p.body.history.reset(crate::state::Sample { t, x, y });
        }
        "damage" => {
            // Trusted declared wound (the source capture's labelled setup producer), not an ordinary input.
            let i = sim.w.idx(id).expect("wound actor");
            let amount = num(&action["amount"]);
            assert!(amount.is_finite() && amount >= 0.);
            sim.w.players[i].vitals.hp = (sim.w.players[i].vitals.hp - amount).max(0.);
        }
        "input" => {
            let kind = action["type"].as_str().expect("input type");
            let payload = &action["payload"];
            let raw = match kind {
                "attack" => RawCommand::Attack {
                    a: num(&payload["a"]),
                    t: None,
                },
                "choose" => {
                    let source_id = payload["chest"].as_str().expect("source chest id");
                    // The source action names a source container id. Resolve it through the live native birth/ownership
                    // relation; a stale id whose trophy already expired has no live native chest and becomes the ordinary
                    // unresolved choose, exactly the source's "Chest gone" path (never a raw source-id alias).
                    let chest = native_trophy_for(sim, source_id, owners);
                    RawCommand::Choose {
                        chest_id: chest,
                        pick: payload["pick"].as_i64().unwrap() as i8,
                    }
                }
                other => panic!("unsupported captured input {other}"),
            };
            sim.submit(id, validate(raw).expect("valid captured command"))
                .expect("accepted captured command");
        }
        "leave" => sim.remove_player(id),
        other => panic!("unsupported captured action {other}"),
    }
}

fn phase_str(phase: crate::Phase) -> &'static str {
    match phase {
        crate::Phase::Lobby => "lobby",
        crate::Phase::Planning => "planning",
        crate::Phase::Active => "active",
        crate::Phase::Ended => "ended",
    }
}

fn status_str(status: Status) -> &'static str {
    match status {
        Status::Lobby => "lobby",
        Status::Alive => "alive",
        Status::Dead => "dead",
        Status::Mia => "mia",
    }
}

/// The native store name a KillStats row folds under (the actual production mapping, read from rows).
fn store_name(kind: crate::stat_fold::EffectKind) -> Option<(&'static str, f64)> {
    use crate::stat_fold::{EffectKind, EffectStat, FlatStat};
    Some(match kind {
        EffectKind::Flat {
            stat: FlatStat::Ad,
            v,
        } => ("ad", v),
        EffectKind::Flat {
            stat: FlatStat::Ap,
            v,
        } => ("ap", v),
        EffectKind::Flat {
            stat: FlatStat::Armor,
            v,
        } => ("armor", v),
        EffectKind::Flat {
            stat: FlatStat::Shield,
            v,
        } => ("shield", v),
        EffectKind::Stat {
            stat: EffectStat::Damage,
            v,
        } => ("damage", v),
        EffectKind::Stat {
            stat: EffectStat::MaxHp,
            v,
        } => ("maxHp", v),
        EffectKind::Stat {
            stat: EffectStat::AttackSpeed,
            v,
        } => ("attackSpeed", v),
        EffectKind::Stat {
            stat: EffectStat::MoveSpeed,
            v,
        } => ("moveSpeed", v),
        EffectKind::Stat {
            stat: EffectStat::Lifesteal,
            v,
        } => ("lifesteal", v),
        _ => return None,
    })
}

fn kill_stats_view(p: &crate::state::Player) -> BTreeMap<String, f64> {
    let (rows, n) = p.kill_stats.rows();
    let mut out = BTreeMap::new();
    for row in &rows[..n] {
        let (name, v) = store_name(row.kind).expect("a kill-stat fold row");
        out.insert(name.to_string(), r6(v));
    }
    out
}

fn build_view(p: &crate::state::Player) -> BTreeMap<String, u32> {
    let build = &p.build;
    let mut out = BTreeMap::new();
    for card in build.cards() {
        let n = u32::from(build.count(card));
        if n > 0 {
            out.insert(card.as_str().to_string(), n);
        }
    }
    out
}

fn mob_stats_view(p: &crate::state::Player) -> BTreeMap<String, f64> {
    let farm = &p.farm;
    let mut out = BTreeMap::new();
    for mob in crate::mob_catalog::MobTypeId::ALL {
        let n = farm.count(mob);
        if n > 0 {
            out.insert(mob.as_str().to_string(), n as f64);
        }
    }
    out
}

fn json_map_f64(v: &serde_json::Value) -> BTreeMap<String, f64> {
    v.as_object()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), r6(num(v)))).collect())
        .unwrap_or_default()
}

fn json_map_u32(v: &serde_json::Value) -> BTreeMap<String, u32> {
    v.as_object()
        .map(|m| {
            m.iter()
                .map(|(k, v)| (k.clone(), v.as_u64().expect("a count") as u32))
                .collect()
        })
        .unwrap_or_default()
}

fn check(cond: bool, msg: impl FnOnce() -> String) -> Result<(), String> {
    if cond {
        Ok(())
    } else {
        Err(msg())
    }
}

/// Compare one native frame with the declared source frame. Every field the source recorded is compared; the source
/// hook-only rewardOffered/rewardChosen probes are checked against the native container / ChestTaken event that the same
/// facts would produce (the probe itself is not a native producer).
fn compare_frame(sim: &Sim, frame: &serde_json::Value, events: &[Event]) -> Result<(), String> {
    let label = frame["label"].as_str().unwrap_or("?");
    let ctx = || format!("frame {label} tick {}", frame["tick"]);
    check(sim.w.tick == frame["tick"].as_u64().unwrap() as u32, || {
        format!("{}: tick {} != {}", ctx(), sim.w.tick, frame["tick"])
    })?;
    check(r6(sim.w.server_time) == r6(num(&frame["time"])), || {
        format!(
            "{}: time {} != {}",
            ctx(),
            sim.w.server_time,
            num(&frame["time"])
        )
    })?;
    check(
        phase_str(sim.w.phase) == frame["phase"].as_str().unwrap(),
        || {
            format!(
                "{}: phase {} != {}",
                ctx(),
                phase_str(sim.w.phase),
                frame["phase"]
            )
        },
    )?;

    let source_players = frame["players"].as_array().expect("players");
    for (i, want) in source_players.iter().enumerate() {
        let pid = player_id(i);
        let got = sim.w.player(pid);
        if want.is_null() {
            check(got.is_none(), || {
                format!(
                    "{}: players[{i}] expected removed, native still present",
                    ctx()
                )
            })?;
            continue;
        }
        let got = got.ok_or_else(|| format!("{}: players[{i}] missing natively", ctx()))?;
        let prefix = || format!("{}: players[{i}]", ctx());
        check(
            got.vitals.faction.as_str() == want["faction"].as_str().unwrap(),
            || {
                format!(
                    "{} faction {} != {}",
                    prefix(),
                    got.vitals.faction.as_str(),
                    want["faction"]
                )
            },
        )?;
        check(
            r6(got.body.x) == r6(num(&want["x"])) && r6(got.body.y) == r6(num(&want["y"])),
            || {
                format!(
                    "{} position ({}, {}) != ({}, {})",
                    prefix(),
                    got.body.x,
                    got.body.y,
                    want["x"],
                    want["y"]
                )
            },
        )?;
        check(r6(got.vitals.hp) == r6(num(&want["hp"])), || {
            format!("{} hp {} != {}", prefix(), got.vitals.hp, want["hp"])
        })?;
        check(r6(got.vitals.max_hp) == r6(num(&want["maxHp"])), || {
            format!(
                "{} maxHp {} != {}",
                prefix(),
                got.vitals.max_hp,
                want["maxHp"]
            )
        })?;
        check(
            status_str(got.status) == want["status"].as_str().unwrap(),
            || {
                format!(
                    "{} status {} != {}",
                    prefix(),
                    status_str(got.status),
                    want["status"]
                )
            },
        )?;
        let weapon0 = got.weapon.weapon0.map(|w| w.as_str()).unwrap_or("");
        let weapon1 = got.weapon.weapon1.map(|w| w.as_str()).unwrap_or("");
        check(weapon0 == want["weapon0"].as_str().unwrap(), || {
            format!("{} weapon0 {weapon0} != {}", prefix(), want["weapon0"])
        })?;
        check(weapon1 == want["weapon1"].as_str().unwrap(), || {
            format!("{} weapon1 {weapon1} != {}", prefix(), want["weapon1"])
        })?;
        check(
            u64::from(got.weapon.slot) == want["slot"].as_u64().unwrap(),
            || format!("{} slot {} != {}", prefix(), got.weapon.slot, want["slot"]),
        )?;
        let build = build_view(got);
        let want_build = json_map_u32(&want["build"]);
        check(build == want_build, || {
            format!("{} build {build:?} != {want_build:?}", prefix())
        })?;
        let kill = kill_stats_view(got);
        let want_kill = json_map_f64(&want["killStats"]);
        check(kill == want_kill, || {
            format!("{} killStats {kill:?} != {want_kill:?}", prefix())
        })?;
        let mobs = mob_stats_view(got);
        let want_mobs = json_map_f64(&want["mobStats"]);
        check(mobs == want_mobs, || {
            format!("{} mobStats {mobs:?} != {want_mobs:?}", prefix())
        })?;
        check(
            u64::from(got.camps_cleared) == want["campClears"].as_u64().unwrap(),
            || {
                format!(
                    "{} campClears {} != {}",
                    prefix(),
                    got.camps_cleared,
                    want["campClears"]
                )
            },
        )?;
    }
    check(
        sim.w.players.len() == source_players.iter().filter(|p| !p.is_null()).count(),
        || format!("{}: native seat count differs", ctx()),
    )?;

    // Trophies: the actual native owner-bound reward containers, compared to the source container facts.
    let want_trophies = frame["trophies"].as_array().expect("trophies");
    let native_trophies: Vec<_> = sim
        .w
        .reward_chests
        .iter()
        .filter(|c| c.owner.is_some())
        .collect();
    check(native_trophies.len() == want_trophies.len(), || {
        format!(
            "{}: native trophy count {} != {}",
            ctx(),
            native_trophies.len(),
            want_trophies.len()
        )
    })?;
    for (j, want) in want_trophies.iter().enumerate() {
        let got = native_trophies[j];
        let prefix = || format!("{}: trophies[{j}]", ctx());
        let owner = want["owner"].as_u64().expect("trophy owner") as usize;
        check(got.owner == Some(player_id(owner)), || {
            format!("{} owner {:?} != p{owner}", prefix(), got.owner)
        })?;
        check(
            r6(got.at.x) == r6(num(&want["x"])) && r6(got.at.y) == r6(num(&want["y"])),
            || {
                format!(
                    "{} at ({}, {}) != ({}, {})",
                    prefix(),
                    got.at.x,
                    got.at.y,
                    want["x"],
                    want["y"]
                )
            },
        )?;
        check(r6(got.expires_at) == r6(num(&want["expiresAt"])), || {
            format!(
                "{} expiresAt {} != {}",
                prefix(),
                got.expires_at,
                want["expiresAt"]
            )
        })?;
        let options: Vec<String> = got
            .options
            .iter()
            .flatten()
            .map(|o| o.as_str().into_owned())
            .collect();
        let want_options: Vec<String> = want["options"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        check(options == want_options, || {
            format!("{} options {options:?} != {want_options:?}", prefix())
        })?;
        check(want["kind"] == "reward", || format!("{} kind", prefix()))?;
        check(want["label"] == "Trophy", || format!("{} label", prefix()))?;
        // Birth/ownership relation: at birth the container sits at the killer's feet.
        if frame["tick"] == 2 && want["takenBy"][0] == "" {
            let killer = sim
                .w
                .player(player_id(owner))
                .ok_or_else(|| format!("{} killer missing", prefix()))?;
            check(got.at == killer.pos(), || {
                format!("{} not at the killer's feet", prefix())
            })?;
        }
        let want_taken: Vec<String> = want["takenBy"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        let taken: Vec<String> = got
            .taken
            .iter()
            .take(want_taken.len())
            .map(|t| t.map_or_else(String::new, |id| source_label(id.0 as usize - 1)))
            .collect();
        check(taken == want_taken, || {
            format!("{} takenBy {taken:?} != {want_taken:?}", prefix())
        })?;
        let want_pickers: Vec<String> = want["pickers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        let pickers: Vec<String> = got
            .pickers
            .iter()
            .map(|id| source_label(id.0 as usize - 1))
            .collect();
        check(pickers == want_pickers, || {
            format!("{} pickers {pickers:?} != {want_pickers:?}", prefix())
        })?;
        check(want["items"] == 0, || format!("{} items", prefix()))?;
    }

    // Hit amounts: the native ledger Hit events (fx) against the source fx hits.
    let mut hits: Vec<(usize, usize, f64)> = Vec::new();
    for e in events {
        if let Event::Hit {
            victim,
            by: Some(by),
            amount,
            ..
        } = e
        {
            hits.push(((victim.0 - 1) as usize, (by.0 - 1) as usize, r6(*amount)));
        }
    }
    let want_hits: Vec<(usize, usize, f64)> = frame["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| {
            (
                h["victim"].as_u64().unwrap() as usize,
                h["by"].as_u64().unwrap() as usize,
                r6(num(&h["amount"])),
            )
        })
        .collect();
    check(hits == want_hits, || {
        format!("{}: hits {hits:?} != {want_hits:?}", ctx())
    })?;

    // Refusals: the native chest refusal reasons word-for-word against the source toasts. Every source toast in this
    // corpus is a chest refusal.
    let refusals: Vec<(usize, String)> = events
        .iter()
        .filter_map(|e| match e {
            Event::ChestRefused { id, reason } => {
                Some(((id.0 - 1) as usize, reason.message().into_owned()))
            }
            _ => None,
        })
        .collect();
    let want_toasts: Vec<(usize, String)> = frame["toasts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| {
            (
                t["to"].as_u64().unwrap() as usize,
                t["text"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    check(refusals == want_toasts, || {
        format!("{}: refusals {refusals:?} != toasts {want_toasts:?}", ctx())
    })?;

    // Source hook-only probes: compare the facts they observed against the native container / taken event.
    let taken: Vec<(usize, i8)> = events
        .iter()
        .filter_map(|e| match e {
            Event::ChestTaken { by, pick, .. } => Some(((by.0 - 1) as usize, *pick)),
            _ => None,
        })
        .collect();
    let mut want_taken_events: Vec<(usize, i8)> = Vec::new();
    for hook in frame["hooks"].as_array().unwrap() {
        let prefix = || format!("{}: hook {}", ctx(), hook["hook"]);
        match hook["hook"].as_str().unwrap() {
            "rewardOffered" => {
                check(hook["probe"] == "hook-only", || {
                    format!("{} probe", prefix())
                })?;
                check(hook["camp"] == -1, || format!("{} camp", prefix()))?;
                let owner = hook["box"]["owner"].as_u64().unwrap() as usize;
                check(
                    hook["eligible"].as_array().unwrap() == &vec![serde_json::json!(owner as u64)],
                    || format!("{} eligible", prefix()),
                )?;
                let want_box = &hook["box"];
                let native = native_trophies
                    .iter()
                    .find(|c| c.owner == Some(player_id(owner)))
                    .ok_or_else(|| format!("{} no native trophy", prefix()))?;
                check(
                    r6(native.at.x) == r6(num(&want_box["x"]))
                        && r6(native.at.y) == r6(num(&want_box["y"])),
                    || format!("{} box position", prefix()),
                )?;
                check(
                    r6(native.expires_at) == r6(num(&want_box["expiresAt"])),
                    || format!("{} box expiry", prefix()),
                )?;
                let options: Vec<String> = native
                    .options
                    .iter()
                    .flatten()
                    .map(|o| o.as_str().into_owned())
                    .collect();
                let want_options: Vec<String> = want_box["options"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap().to_string())
                    .collect();
                check(options == want_options, || {
                    format!("{} box options", prefix())
                })?;
            }
            "rewardChosen" => {
                check(hook["probe"] == "hook-only", || {
                    format!("{} probe", prefix())
                })?;
                want_taken_events.push((
                    hook["by"].as_u64().unwrap() as usize,
                    hook["option"].as_i64().unwrap() as i8,
                ));
            }
            other => return Err(format!("{}: unknown source hook {other}", ctx())),
        }
    }
    check(taken == want_taken_events, || {
        format!(
            "{}: taken events {taken:?} != hooks {want_taken_events:?}",
            ctx()
        )
    })?;
    Ok(())
}

/// Drive a case through the declared action stream, comparing every frame. stop_before limits the comparison to a prefix
/// of frames (used only for the reported birth-hold divergence in case 0). Returns the final sim.
fn drive(case: &serde_json::Value, stop_before: Option<usize>) -> Result<Sim, String> {
    let input = &case["input"];
    let mut sim = open(input);
    let owners = source_trophy_owners(case);
    let actions = case["actions"].as_array().expect("actions");
    let frames = case["frames"].as_array().expect("frames");
    let mut refusals = Vec::new();
    let mut ai = 0usize;
    let mut events = Vec::new();
    for (fi, frame) in frames.iter().enumerate() {
        if stop_before.is_some_and(|stop| fi >= stop) {
            break;
        }
        let want_actions = frame["actionCount"].as_u64().unwrap() as usize;
        while ai < want_actions {
            let action = &actions[ai];
            while sim.w.tick < action["tick"].as_u64().unwrap() as u32 {
                events.extend(sim.step());
            }
            apply_action(&mut sim, action, &owners, &mut refusals);
            ai += 1;
        }
        while sim.w.tick < frame["tick"].as_u64().unwrap() as u32 {
            events.extend(sim.step());
        }
        compare_frame(&sim, frame, &events)?;
        events.clear();
    }
    Ok(sim)
}

/// Every case except the birth-hold-dependent tail of case 0 reproduces its declared frames.
#[test]
fn captured_lifecycle_frames_reproduce_natively() {
    let doc = corpus();
    assert_eq!(doc["format"], "rh-trophy-lifecycle-source/1");
    let cases = doc["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 6, "six admitted lifecycle cases");
    for (i, case) in cases.iter().enumerate() {
        let name = case["input"]["name"].as_str().unwrap();
        // Case 0's owner pick at tick 3 is one tick early natively (reported divergence); its prefix through the kill
        // tick is still compared, and the divergence itself is asserted by the next test.
        let stop = (name == "birth-hold-owner-choose").then_some(3);
        let sim = drive(case, stop).unwrap_or_else(|e| panic!("case {i} {name}: {e}"));
        let frames = case["frames"].as_array().unwrap();
        let last = stop.unwrap_or(frames.len()) - 1;
        assert_eq!(sim.w.tick, frames[last]["tick"].as_u64().unwrap() as u32);
    }
}

/// The reported source divergence, with the exact native/source facts: the native choose accepts the owner pick on the
/// tick after birth while the source bornThisTick still refuses it ("Chest gone"). No later case frame is asserted
/// because every one of them depends on the grant/takenBy state this early pick changes.
#[test]
fn birth_hold_diverges_from_the_source_hold() {
    let doc = corpus();
    let case = case(&doc, "birth-hold-owner-choose");
    let mut sim = open(&case["input"]);
    let owners = source_trophy_owners(case);
    let actions = case["actions"].as_array().unwrap();
    let frames = case["frames"].as_array().unwrap();
    let mut refusals = Vec::new();
    let mut events = Vec::new();
    let mut ai = 0usize;
    // Drive to the birth-hold choose exactly as the capture did: kill tick, then the owner choose at tick 2.
    for frame in frames.iter().take(4) {
        let want_actions = frame["actionCount"].as_u64().unwrap() as usize;
        while ai < want_actions {
            let action = &actions[ai];
            apply_action(&mut sim, action, &owners, &mut refusals);
            ai += 1;
        }
        while sim.w.tick < frame["tick"].as_u64().unwrap() as u32 {
            events.extend(sim.step());
        }
        events.clear();
    }
    let source_frame = frames
        .iter()
        .find(|f| f["label"] == "birth-hold-refused")
        .unwrap();
    let want_toasts: Vec<&str> = source_frame["toasts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["text"].as_str().unwrap())
        .collect();
    assert_eq!(
        want_toasts,
        vec!["Chest gone"],
        "the source refused the birth hold"
    );
    let err = compare_frame(&sim, source_frame, &events)
        .expect_err("native must diverge from the source birth hold");
    assert!(
        err.contains("players[0] killStats"),
        "the divergence begins with the grant the source frame does not have: {err}"
    );
    assert!(
        !events
            .iter()
            .any(|e| matches!(e, Event::ChestRefused { .. })),
        "the native choose produced no refusal"
    );
    // The same early pick is why the later frames differ: the native container already records the pick and grant.
    let chest = native_trophy_for(&sim, "c1b", &owners).expect("born native trophy");
    let c = sim.w.reward_chests.iter().find(|c| c.id == chest).unwrap();
    assert_eq!(
        c.taken[0],
        Some(PlayerId(1)),
        "native accepted the early owner pick"
    );
    assert_eq!(sim.w.players[0].kill_stats.get(KillStatKey::Ad), 16.5);
    eprintln!(
        "P-TROPHY-NATIVE-CONSUMER-1 divergence: native choose held_until_tick={} > tick={} allows the pick at tick {}; \
         source loot.bornThisTick refuses tick {} too. Dependent frames owner-chosen/repeat-pick/skip not asserted.",
        c.held_until_tick, sim.w.tick, sim.w.tick, sim.w.tick
    );
    // The native observer already models the source hold: its can_choose only becomes true at tick 4.
    let mut observer = crate::reward_chests::RewardChestObserver::new(PlayerId(1));
    let mut rows = Vec::new();
    let mut build = None;
    let _ = observer
        .prepare_into(&sim, &mut rows, &mut build)
        .expect("observable trophy");
    let row = rows
        .iter()
        .find(|r| r.options.iter().any(|o| matches!(o.id, OptionId::Kill(_))));
    assert!(
        row.is_none_or(|r| !r.can_choose),
        "observer already enforces the source hold"
    );
}

/// Case 1's owner/stranger/range lifecycle, compared frame by frame, with the actual native profile.
#[test]
fn owner_stranger_and_range_refusals_reproduce() {
    let doc = corpus();
    let case = case(&doc, "owner-stranger-range");
    let sim = drive(case, None).expect("owner/stranger/range frames");
    assert_eq!(sim.w.tick, 6);
    assert_eq!(sim.w.players[0].kill_stats.get(KillStatKey::Ap), 16.5);
}

/// The expiry-boundary case: a pick one step before expiry succeeds, the container expires at the boundary, and the
/// post-expiry choose is refused "Chest gone".
#[test]
fn expiry_boundary_reproduces() {
    let doc = corpus();
    let case = case(&doc, "expiry-boundary");
    let sim = drive(case, None).expect("expiry frames");
    assert!(sim.w.reward_chests.is_empty(), "the trophy expired");
    assert_eq!(sim.w.players[0].kill_stats.get(KillStatKey::Ad), 16.5);
}

/// The exclusion cases: empty victim, training world and a real leave (MIA) drop no Trophy, on the declared profile.
#[test]
fn empty_training_and_mia_exclusions_reproduce() {
    let doc = corpus();
    for name in ["empty-investment", "training-exclusion", "mia-exclusion"] {
        let case = case(&doc, name);
        let sim = drive(case, None).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(sim.w.reward_chests.is_empty(), "{name}: no trophy");
    }
}

fn placements_of(input: &serde_json::Value) -> Vec<crate::Placement> {
    input["initial"]
        .as_array()
        .expect("declared initial frame")
        .iter()
        .enumerate()
        .map(|(i, p)| crate::Placement {
            profile: format!("name{i}"),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(num(&p["x"]), num(&p["y"])),
            hp: Some(num(&p["hp"])),
            weapon0: None,
            weapon1: None,
        })
        .collect()
}

/// Run frames [start_frame, end_frame) (the earlier frames are already applied).
fn run_frames(mut sim: Sim, case: &serde_json::Value, start_frame: usize, end_frame: usize) -> Sim {
    let owners = source_trophy_owners(case);
    let actions = case["actions"].as_array().expect("actions");
    let frames = case["frames"].as_array().expect("frames");
    let mut ai = if start_frame == 0 {
        0
    } else {
        frames[start_frame - 1]["actionCount"].as_u64().unwrap() as usize
    };
    let mut refusals = Vec::new();
    let mut events = Vec::new();
    for (fi, frame) in frames
        .iter()
        .enumerate()
        .skip(start_frame)
        .take(end_frame - start_frame)
    {
        let want_actions = frame["actionCount"].as_u64().unwrap() as usize;
        while ai < want_actions {
            let action = &actions[ai];
            while sim.w.tick < action["tick"].as_u64().unwrap() as u32 {
                events.extend(sim.step());
            }
            apply_action(&mut sim, action, &owners, &mut refusals);
            ai += 1;
        }
        while sim.w.tick < frame["tick"].as_u64().unwrap() as u32 {
            events.extend(sim.step());
        }
        compare_frame(&sim, frame, &events).unwrap_or_else(|e| panic!("frame {fi}: {e}"));
        events.clear();
    }
    sim
}

/// Drive a case only through the named frame (inclusive), comparing that prefix.
fn drive_to(case: &serde_json::Value, last_label: &str) -> Sim {
    let frames = case["frames"].as_array().expect("frames");
    let last = frames
        .iter()
        .position(|f| f["label"].as_str() == Some(last_label))
        .unwrap_or_else(|| panic!("frame {last_label}"));
    drive(case, Some(last + 1)).unwrap_or_else(|e| panic!("to {last_label}: {e}"))
}

fn checkpoint(sim: &Sim) -> String {
    serde_json::to_string(sim).expect("checkpoint serialize")
}

fn restore(text: &str) -> Sim {
    let mut de = serde_json::Deserializer::from_str(text);
    Sim::restore(&mut de).expect("checkpoint restore")
}

/// Restore/continue before the owner pick and after it, through the expiry boundary: a restored sim reproduces the same
/// frames, kill stats, taken state and final state hash as the uninterrupted run.
#[test]
fn checkpoint_restore_before_and_after_pick_and_at_expiry() {
    let doc = corpus();
    let case = case(&doc, "expiry-boundary");
    let frames = case["frames"].as_array().unwrap();
    let before = drive_to(case, "before-expiry");
    let cp_before = checkpoint(&before);
    let mut a = restore(&cp_before);
    let mut b = restore(&cp_before);
    assert_eq!(a.state_hash(), b.state_hash());
    // Frame 3 is boundary-pick: run A (restored) through it and checkpoint immediately after the pick.
    a = run_frames(a, case, 3, 4);
    assert_eq!(a.w.tick, 601);
    assert_eq!(a.w.players[0].kill_stats.get(KillStatKey::Ad), 16.5);
    let cp_after = checkpoint(&a);
    let mut c = restore(&cp_after);
    // B continues from the earlier checkpoint through the same pick; it must equal the restored A.
    b = run_frames(b, case, 3, 4);
    assert_eq!(
        a.state_hash(),
        b.state_hash(),
        "before-pick restore/continue"
    );
    // A and C both continue through the at-expiry and expired-gone frames (restored after the pick).
    a = run_frames(a, case, 4, frames.len());
    c = run_frames(c, case, 4, frames.len());
    assert_eq!(
        a.state_hash(),
        c.state_hash(),
        "after-pick restore/continue"
    );
    assert!(a.w.reward_chests.is_empty(), "expired after restore");
    assert_eq!(a.w.players[0].kill_stats.get(KillStatKey::Ad), 16.5);
    assert_eq!(
        frames.last().unwrap()["label"].as_str().unwrap(),
        "expired-gone"
    );
}

/// Case 1's range/owner continuation also survives a checkpoint round-trip after the stranger refusal.
#[test]
fn checkpoint_restore_continuation_matches_owner_range_case() {
    let doc = corpus();
    let case = case(&doc, "owner-stranger-range");
    let before = drive_to(case, "stranger-refused");
    let text = checkpoint(&before);
    let mut a = restore(&text);
    let mut b = restore(&text);
    a = run_frames(a, case, 4, 6);
    b = run_frames(b, case, 4, 6);
    assert_eq!(a.w.tick, 6);
    assert_eq!(a.state_hash(), b.state_hash());
    assert_eq!(a.w.players[0].kill_stats.get(KillStatKey::Ap), 16.5);
}

/// Replay accounting: the actual Recorder records the owner's Choose as a ReplayInput::Command and its state hash; a
/// checkpoint restored before that tick and fed the same recorded input reproduces the hash and the source frame.
/// Trusted initial grants/wounds/placements are setup, NOT ReplayInput: the replay format has no grant/wound variant, so
/// this proves the command-stream accounting only (no full run_replay claim is made).
#[test]
fn recorder_replay_input_reproduces_the_choose_command() {
    use crate::replay::{apply_input, Recorder, ReplayInput, ReplayStart};
    let doc = corpus();
    let case = case(&doc, "expiry-boundary");
    let input = &case["input"];
    let mut live = drive_to(case, "before-expiry");
    let before = checkpoint(&live);
    let owners = source_trophy_owners(case);
    let actions = case["actions"].as_array().unwrap();
    let frames = case["frames"].as_array().unwrap();
    let pick_frame = frames
        .iter()
        .position(|f| f["label"] == "boundary-pick")
        .unwrap();
    let choose_action = &actions[frames[pick_frame - 1]["actionCount"].as_u64().unwrap() as usize];
    assert_eq!(choose_action["kind"], "input");
    let chest = native_trophy_for(&live, "c1b", &owners).expect("live trophy before the pick");
    let command = validate(RawCommand::Choose {
        chest_id: Some(chest),
        pick: 0,
    })
    .expect("valid owner choose");
    let mut recorder = Recorder::new(
        &live,
        config(input),
        ReplayStart::Active {
            placements: placements_of(input),
        },
    );
    recorder.record(ReplayInput::Command {
        player: PlayerId(1),
        cmd: command,
    });
    live.submit(PlayerId(1), command).unwrap();
    let live_events = live.step();
    recorder.stepped(&live);
    assert_eq!(recorder.replay.ticks.len(), 1);
    assert_eq!(recorder.replay.ticks[0].tick, 601);
    assert_eq!(
        recorder.replay.ticks[0].inputs,
        vec![ReplayInput::Command {
            player: PlayerId(1),
            cmd: command
        }]
    );
    let mut replayed = restore(&before);
    apply_input(&mut replayed, &recorder.replay.ticks[0].inputs[0]);
    let replayed_events = replayed.step();
    assert_eq!(
        replayed.state_hash(),
        recorder.replay.hashes[0],
        "recorded command reproduces the live state hash"
    );
    let frame = frames
        .iter()
        .find(|f| f["label"] == "boundary-pick")
        .unwrap();
    compare_frame(&replayed, frame, &replayed_events).expect("replayed frame");
    let _ = &live_events;
}

/// The existing policy/observer offer binding: the default native observer stages the Trophy row as one complete row; the
/// current human presentation admission (the closure that rejects any kill-augment row) omits the whole row before any
/// handle binding, exactly as the shipped adapter does. The guard is exercised, never bypassed or removed.
#[test]
fn observer_offer_binding_respects_the_human_wire_guard() {
    use crate::{ItemObserver, Observation, PublicCommand};
    let doc = corpus();
    let case = case(&doc, "birth-hold-owner-choose");
    let sim = drive_to(case, "kill-tick");
    assert_eq!(sim.w.tick, 2);
    // Default native observer: one complete Trophy row, not chooseable during the birth hold.
    let mut native = ItemObserver::new(PlayerId(1));
    let mut out = Observation::default();
    let _ = native
        .prepare_with_seen_rewards_where(&sim, &[], &[], &mut out, None, |_| true)
        .expect("default observation");
    let row = out
        .reward_chests
        .iter()
        .find(|r| r.options.iter().any(|o| matches!(o.id, OptionId::Kill(_))))
        .expect("the native observer retains the Trophy row");
    assert_eq!(row.options[0].id.as_str(), "kill:ad:16.5");
    assert!(!row.can_choose, "birth hold is visible to the observer");
    // Current human wire admission: a whole kill-augment row is omitted before bindings.
    let mut human = ItemObserver::new(PlayerId(1));
    let mut guarded = Observation::default();
    let _ = human
        .prepare_with_seen_rewards_where(&sim, &[], &[], &mut guarded, None, |options| {
            options.iter().all(|o| !matches!(o.id, OptionId::Kill(_)))
        })
        .expect("guarded observation");
    assert!(
        guarded.reward_chests.is_empty(),
        "the human guard omits the entire Trophy row"
    );
    let no_binding = human
        .resolve(
            &sim,
            PublicCommand::Choose {
                handle: crate::reward_chests::RewardChestHandle::from_wire(1).unwrap(),
                pick: 0,
            },
        )
        .expect("an unresolved handle is an ordinary miss");
    assert_eq!(
        no_binding,
        validate(RawCommand::Choose {
            chest_id: None,
            pick: 0
        })
        .unwrap(),
        "an omitted row grants no handle binding"
    );
}

/// Compiled semantic controls: the frame comparator reports ACTUAL consumer mismatches for a wrong owner, a wrong birth-hold
/// taken state and wrong grant arithmetic; a provenance-only corpus mutation is not a kill; the restored corpus passes.
#[test]
fn lifecycle_semantic_controls_require_a_frame_difference() {
    let doc = corpus();
    let range_case = case(&doc, "owner-stranger-range");
    let frames = range_case["frames"].as_array().unwrap();
    let frame_at = |label: &str| frames.iter().find(|f| f["label"] == label).unwrap();
    let hold_sim = drive_to(range_case, "birth-hold-cleared");
    let hold_frame = frame_at("birth-hold-cleared");
    // Wrong owner: the native trophy is owned by p0; the mutated frame says p1.
    let mut wrong_owner = hold_frame.clone();
    wrong_owner["trophies"][0]["owner"] = serde_json::json!(1);
    let err =
        compare_frame(&hold_sim, &wrong_owner, &[]).expect_err("wrong owner must be reported");
    assert!(err.contains("owner"), "{err}");
    eprintln!("control wrong-owner -> {err}");
    // Wrong birth hold: the native chest is still unpicked at tick 3; the mutated frame records an early pick.
    let mut wrong_hold = hold_frame.clone();
    wrong_hold["trophies"][0]["takenBy"][0] = serde_json::json!("p2");
    wrong_hold["trophies"][0]["pickers"] = serde_json::json!(["p2"]);
    let err = compare_frame(&hold_sim, &wrong_hold, &[])
        .expect_err("wrong held/taken state must be reported");
    assert!(err.contains("takenBy"), "{err}");
    eprintln!("control wrong-birth-hold -> {err}");
    // Wrong grant arithmetic: the native owner pick folds 16.5 AD; the mutated frame says 33.
    let expiry_case = case(&doc, "expiry-boundary");
    let expiry_at = drive_to(expiry_case, "at-expiry");
    let expiry_frame = expiry_case["frames"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["label"] == "at-expiry")
        .unwrap();
    let mut wrong_grant = expiry_frame.clone();
    wrong_grant["players"][0]["killStats"]["ad"] = serde_json::json!(33.0);
    let err = compare_frame(&expiry_at, &wrong_grant, &[])
        .expect_err("wrong grant amount must be reported");
    assert!(err.contains("killStats"), "{err}");
    eprintln!("control wrong-grant -> {err}");
    // Provenance-only: a corpus provenance mutation is not a frame difference.
    let mut provenance_only = doc.clone();
    provenance_only["provenance"]["sourceSha256"]["packages/shared/src/killAugments.ts"] =
        serde_json::json!("0000000000000000000000000000000000000000000000000000000000000000");
    let clean_case = case(&provenance_only, "owner-stranger-range");
    drive(clean_case, None).expect("provenance-only mutation is not a semantic kill");
    // Restore the control: the unchanged frames pass against the same native states.
    compare_frame(&hold_sim, hold_frame, &[]).expect("restored birth-hold frame");
    compare_frame(&expiry_at, expiry_frame, &[]).expect("restored expiry grant frame");
}

/// The native observer already models the source two-tick birth hold even though choose does not: false at ticks 2 and 3,
/// true at tick 4.
#[test]
fn observer_can_choose_follows_the_source_hold() {
    use crate::{ItemObserver, Observation};
    let doc = corpus();
    let case = case(&doc, "birth-hold-owner-choose");
    let mut sim = drive_to(case, "kill-tick");
    let can_choose = |sim: &Sim| {
        let mut observer = ItemObserver::new(PlayerId(1));
        let mut out = Observation::default();
        let _ = observer
            .prepare_with_seen_rewards_where(sim, &[], &[], &mut out, None, |_| true)
            .expect("observation");
        out.reward_chests
            .iter()
            .find(|r| r.options.iter().any(|o| matches!(o.id, OptionId::Kill(_))))
            .map(|r| r.can_choose)
    };
    assert_eq!(can_choose(&sim), Some(false), "birth tick tick 2");
    let _ = sim.step();
    assert_eq!(can_choose(&sim), Some(false), "tick 3 still held (source)");
    let _ = sim.step();
    assert_eq!(can_choose(&sim), Some(true), "tick 4 first takeable");
}
