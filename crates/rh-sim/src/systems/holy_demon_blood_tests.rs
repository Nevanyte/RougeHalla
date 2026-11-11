//! Captured actual-source Holy Demon Blood comparison (P-HOLY-DEMON-BLOOD-1): a Holy player's lifesteal gains
//! `holyCampLifestealOf(campClears)` = 0.005 per eligible camp clear (packages/shared/src/championPassives.ts:6-9,
//! packages/shared/src/constants.ts:81), added to the earned farm rows (packages/server/src/sim/factions.ts:895-896), so it
//! sits outside LS_CAP and LIFESTEAL_MAX and is multiplied by Bloodthirst's lifestealMult (packages/shared/src/mods.ts:380-382).
//!
//! Corpus: «parity/holy-demon-blood/source.json», captured from the unmodified source by
//! «tools/holy-demon-blood-fixtures/capture.sh» (pinned linux/amd64 Node 22.23.4 image; declared map byte-identical to
//! «crates/rh-sim/tests/fixtures/mob-pve-map.json»). Operations are source exports (deferHit, grantCard, step) and
//! trusted placements (player hp, mob hp, PlayerRuntime.campsCleared). Never regenerated from Rust.
//!
//! The legacy public mirror `PlayerState.campClears` is not compared: it lags the private count only between a trusted
//! placement and the next step (bruiserPassives.ts:62-70 syncs it in afterWeapons and in the campCleared chain); the
//! private `campsCleared` is compared on every frame.
use crate::mob_runtime::MobMode;
use crate::{
    Arena, FactionId, FactionMode, Placement, PlayerId, Secrets, Sim, SimConfig, TileMap, Vec2,
    WeaponId,
};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../parity/holy-demon-blood/source.json");
const MAP: &str = include_str!("../../tests/fixtures/mob-pve-map.json");
/// `rh_parity::TOL`: the corpus's 1e-6 rounding plus one step.
const TOL: f64 = 2e-6;

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the captured Holy Demon Blood corpus parses")
}

fn arena() -> Arena {
    let data: crate::mapdata::GameMapData =
        serde_json::from_str(MAP).expect("the captured map parses");
    let (w, h, tiles, layers) = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    }
    .validate()
    .expect("the captured map is an admitted rh-map/2 export")
    .into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    }
}

fn make_sim(f: &Value) -> Sim {
    let placements: Vec<Placement> = f["case"]["start"]["players"]
        .as_array()
        .expect("declared players")
        .iter()
        .map(|p| Placement {
            profile: p["id"].as_str().unwrap().into(),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()),
            hp: None,
            weapon0: WeaponId::parse(p["weapon"].as_str().unwrap()),
            weapon1: None,
        })
        .collect();
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = 12;
    secrets.reward_salt = [1, 2, 3, 4];
    Sim::reset_active(
        SimConfig {
            mob_mode: MobMode::Pve,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrost,
            ..Default::default()
        },
        arena(),
        secrets,
        &placements,
    )
}

fn player_id(name: &str) -> PlayerId {
    PlayerId(name[1..].parse::<u32>().unwrap() + 1)
}

/// The native id of a declared camp mob: the corpus lists the camp's members in birth order; so does the native store.
fn mob_id(sim: &Sim, f: &Value, name: &str) -> PlayerId {
    let at = f["case"]["mobs"]
        .as_array()
        .unwrap()
        .iter()
        .position(|m| m == name)
        .unwrap_or_else(|| panic!("undeclared mob {name}"));
    sim.w
        .mobs
        .iter()
        .filter(|m| m.mob_type.is_some())
        .nth(at)
        .map(|m| m.core.id)
        .expect("the captured map spawns its three-member camp")
}

fn close(native: f64, source: f64, label: &str) {
    assert!(
        (native - source).abs() <= TOL,
        "{label}: native {native} source {source} (diff {})",
        native - source
    );
}

fn check_frame(sim: &Sim, f: &Value, want: &Value, label: &str) {
    assert_eq!(
        (sim.server_time() / 50.) as u64,
        want["tick"].as_u64().unwrap(),
        "{label}: tick"
    );
    for p in want["players"].as_array().unwrap() {
        let id = p["id"].as_str().unwrap();
        let native = sim.w.player(player_id(id)).expect("declared player");
        close(
            native.vitals.hp,
            p["hp"].as_f64().unwrap(),
            &format!("{label}: {id} hp"),
        );
        assert_eq!(
            u64::from(native.camps_cleared),
            p["campsCleared"].as_u64().unwrap(),
            "{label}: {id} campsCleared"
        );
    }
    for m in want["mobs"].as_array().unwrap() {
        let name = m["id"].as_str().unwrap();
        let native = sim.w.mobs.get(mob_id(sim, f, name));
        let alive = m["status"] == "alive";
        match native {
            Some(mob) => {
                assert_eq!(
                    mob.status == crate::state::Status::Alive,
                    alive,
                    "{label}: {name} status"
                );
                close(
                    mob.core.vitals.hp,
                    m["hp"].as_f64().unwrap(),
                    &format!("{label}: {name} hp"),
                );
            }
            None => assert!(
                !alive,
                "{label}: {name} is gone natively but alive in the source"
            ),
        }
    }
}

fn apply_op(sim: &mut Sim, f: &Value, op: &Value) {
    match op["op"].as_str().unwrap() {
        "hp" => {
            let i = sim
                .w
                .idx(player_id(op["player"].as_str().unwrap()))
                .unwrap();
            sim.w.players[i].vitals.hp = op["hp"].as_f64().unwrap();
        }
        "mob_hp" => {
            let id = mob_id(sim, f, op["mob"].as_str().unwrap());
            sim.w.mobs.get_mut(id).unwrap().core.vitals.hp = op["hp"].as_f64().unwrap();
        }
        "clears" => {
            let i = sim
                .w
                .idx(player_id(op["player"].as_str().unwrap()))
                .unwrap();
            sim.w.players[i].camps_cleared = op["n"].as_u64().unwrap() as u16;
        }
        "card" => {
            let name = op["card"].as_str().unwrap();
            let card = crate::cards::CardId::ALL
                .into_iter()
                .find(|c| c.as_str() == name)
                .unwrap_or_else(|| panic!("card {name}"));
            assert!(crate::cards::grant(
                &sim.k,
                &mut sim.w,
                player_id(op["player"].as_str().unwrap()),
                card
            ));
        }
        "defer" => {
            let victim_name = op["victim"].as_str().unwrap();
            let victim = if victim_name.starts_with('p') {
                player_id(victim_name)
            } else {
                mob_id(sim, f, victim_name)
            };
            let mut entry = crate::systems::bruiser::contact_entry(
                victim,
                player_id(op["by"].as_str().unwrap()),
                None,
            );
            entry.packet.raw = op["raw"].as_f64().unwrap();
            sim.w.deferred.defer_hit(entry);
        }
        "step" => {
            sim.step();
        }
        other => panic!("unknown declared operation {other}"),
    }
}

fn replay(f: &Value, name: &str) {
    let case = f["case"]["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == name)
        .unwrap_or_else(|| panic!("case {name}"));
    let ops = case["ops"].as_array().unwrap();
    let frames = case["frames"].as_array().unwrap();
    assert_eq!(
        frames.len(),
        ops.len() + 1,
        "{name}: one frame per operation"
    );
    let mut sim = make_sim(f);
    check_frame(&sim, f, &frames[0], &format!("{name} start"));
    for (i, op) in ops.iter().enumerate() {
        apply_op(&mut sim, f, op);
        check_frame(
            &sim,
            f,
            &frames[i + 1],
            &format!("{name} op {i} {}", op["op"].as_str().unwrap()),
        );
    }
}

/// The corpus covers every case below, and nothing else: a dropped or renamed case cannot leave the comparison silently.
#[test]
fn the_corpus_holds_exactly_the_compared_cases() {
    let f = fixture();
    assert_eq!(f["format"], "rh-holy-demon-blood-source/1");
    let names: Vec<&str> = f["case"]["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "holy_zero_clears",
            "holy_one_clear",
            "holy_twenty_clears",
            "holy_sixty_clears_past_lifesteal_max",
            "frost_twenty_clears_control",
            "holy_bloodthirst_zero_clears",
            "holy_bloodthirst_twenty_clears",
            "holy_real_clear_same_tick",
        ]
    );
}

// Controls: zero clears, or a non-Holy player with clears. These match before and after the port.
#[test]
fn holy_with_zero_clears_heals_its_own_share_only() {
    replay(&fixture(), "holy_zero_clears");
}

#[test]
fn a_frost_with_twenty_clears_gains_no_lifesteal() {
    replay(&fixture(), "frost_twenty_clears_control");
}

#[test]
fn holy_bloodthirst_with_zero_clears_matches() {
    replay(&fixture(), "holy_bloodthirst_zero_clears");
}

// The passive: each fails until the camp term is folded into the farm rows.
#[test]
fn one_clear_adds_half_a_percent_of_the_damage() {
    replay(&fixture(), "holy_one_clear");
}

#[test]
fn twenty_clears_add_ten_percent_outside_ls_cap() {
    replay(&fixture(), "holy_twenty_clears");
}

#[test]
fn sixty_clears_carry_the_share_past_lifesteal_max() {
    replay(&fixture(), "holy_sixty_clears_past_lifesteal_max");
}

#[test]
fn bloodthirst_doubles_the_camp_term() {
    replay(&fixture(), "holy_bloodthirst_twenty_clears");
}

#[test]
fn a_clear_paid_in_the_pass_feeds_the_same_ticks_lifesteal() {
    replay(&fixture(), "holy_real_clear_same_tick");
}
