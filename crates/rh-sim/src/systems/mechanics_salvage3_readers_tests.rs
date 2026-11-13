//! P-MECHANICS-SALVAGE-3 review note 1: the other readers of the public camp-clear mirror. Legacy's HUD build summary and
//! champion panel read `PlayerState.campClears` (the client schema), and the kill Trophy's leech score reads it through
//! `combatReadability` (`packages/shared/src/combatReadability.ts:102`, `:126-133`). Only `bruiserPassives` writes the
//! mirror (`packages/server/src/sim/bruiserPassives.ts:68`, `:108`), so a world without the Bruiser installer reads 0
//! whatever the canonical count holds (`systems::bruiser::camp_clears`). The first-playable profile (`MobMode::Pve` with
//! `FactionMode::EngagementHolyPlagueFire`, `Gates::MOB_BASIC_FACTIONS`) is such a world and is reachable
//! (`rh-server --first-playable`); the full faction profile with Frost installs the rows and keeps today's numbers.
use crate::build_summary::{build_summary, champion_panel, PanelCode};
use crate::constants::HOLY_CAMP_LIFESTEAL_PER_CLEAR;
use crate::map::TileMap;
use crate::mob_runtime::MobMode;
use crate::reward_chests::OptionId;
use crate::{Arena, FactionId, FactionMode, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

/// The Holy seat (first placement).
fn holy() -> PlayerId {
    PlayerId(1)
}
/// The killer seat (second placement).
fn killer() -> PlayerId {
    PlayerId(2)
}

/// The captured PvE map (`tests/fixtures/mob-pve-map.json`, as `systems/holy_demon_blood_tests.rs`): one Fire camp,
/// admitted by both profiles below.
fn arena() -> Arena {
    let data: crate::mapdata::GameMapData =
        serde_json::from_str(include_str!("../../tests/fixtures/mob-pve-map.json"))
            .expect("the captured map parses");
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

/// A Holy seat (p1) and a Fire killer (p2) in an active match of `faction_mode` over PvE mobs, the Holy seat holding
/// `clears` canonical camp clears. `installer` is the expected Bruiser gate of the profile.
fn world(faction_mode: FactionMode, installer: bool, clears: u16) -> Sim {
    let arena = arena();
    let placements: Vec<Placement> = [FactionId::Holy, FactionId::Fire]
        .iter()
        .zip(&arena.spawns)
        .map(|(&faction, &at)| Placement {
            profile: faction.as_str().into(),
            faction,
            bot: false,
            at,
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let config = SimConfig {
        quests: false,
        mob_mode: MobMode::Pve,
        faction_mode,
        ..Default::default()
    };
    let mut secrets = Secrets::from_seed(1);
    secrets.reward_salt = [1, 2, 3, 4];
    let mut sim = Sim::reset_active(config, arena, secrets, &placements);
    assert_eq!(
        crate::schedule::Gates::of(&sim.k).bruiser,
        installer,
        "{faction_mode:?}: the Bruiser installer gate"
    );
    let i = sim.w.idx(holy()).unwrap();
    sim.w.players[i].camps_cleared = clears;
    sim
}

/// The first-playable profile: camps, Holy, no Bruiser installer.
fn without_installer(clears: u16) -> Sim {
    world(FactionMode::EngagementHolyPlagueFire, false, clears)
}

/// The full faction profile (Frost present): the Bruiser installer runs.
fn with_installer(clears: u16) -> Sim {
    world(FactionMode::EngagementHolyPlagueFireFrost, true, clears)
}

/// The Holy seat's camp figures on the owner HUD: summary life steal, panel lifesteal, camp clears and camp leech.
fn hud(sim: &Sim) -> (f64, f64, f64, f64) {
    let s = build_summary(sim, holy()).expect("seated");
    let p = champion_panel(sim, holy()).expect("seated");
    (
        s.life_steal,
        p.get(PanelCode::HolyLifeSteal).expect("Holy lifesteal row"),
        p.get(PanelCode::HolyCampClears)
            .expect("Holy camp clears row"),
        p.get(PanelCode::HolyCampLeech)
            .expect("Holy camp leech row"),
    )
}

/// Kills the Holy seat by the killer through the real `playerKilled` chain and returns the killer's Trophy options
/// (empty when none dropped: a victim with no investment above the threshold drops nothing).
fn trophy_options(mut sim: Sim) -> Vec<OptionId> {
    assert!(sim.w.reward_chests.is_empty());
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut Vec::new(),
            fx: None,
        },
        crate::hooks::HookArgs::PlayerKilled {
            by: killer(),
            victim: holy(),
            outcome: crate::results::Outcome::Died,
        },
    );
    sim.w
        .reward_chests
        .iter()
        .filter(|c| c.owner == Some(killer()))
        .flat_map(|c| c.options.iter().flatten().copied())
        .collect()
}

fn has_leech(options: &[OptionId]) -> bool {
    options.iter().any(
        |o| matches!(o, OptionId::Kill(a) if a.key == crate::kill_augments::KillStatKey::Leech),
    )
}

/// Without the installer the owner HUD shows the figures of zero clears: legacy's `campClears` mirror is 0, so the
/// summary's life steal and the panel's Holy lifesteal carry no camp term, and the camp clears and camp leech rows read
/// 0. Worked: 3 canonical clears would add 3 x 0.005 = 0.015 to both lifesteal figures; legacy adds nothing.
#[test]
fn without_the_installer_the_owner_hud_shows_no_camp_lifesteal() {
    let three = hud(&without_installer(3));
    let none = hud(&without_installer(0));
    assert_eq!(
        three, none,
        "3 canonical clears vs none: (summary life steal, panel lifesteal, camp clears, camp leech)"
    );
    assert_eq!((three.2, three.3), (0., 0.));
}

/// Without the installer a Holy victim's Trophy reads no camp leech: legacy `investedStats` scores the leech from
/// `holyCampLifestealOf(campClears)` with the mirror at 0. Worked: 3 canonical clears would score 0.015 / 0.05 = 0.3
/// (above the 0.01 threshold) and put a Leech option in the Trophy; legacy's Trophy equals the one with no clears.
#[test]
fn without_the_installer_a_holy_victims_trophy_has_no_camp_leech() {
    let three = trophy_options(without_installer(3));
    let none = trophy_options(without_installer(0));
    assert_eq!(three, none, "the Trophy with 3 canonical clears vs none");
    assert!(!has_leech(&three), "no camp Leech option: {three:?}");
}

/// Guard: with the installer the mirror is the canonical count, so the HUD and the Trophy keep today's numbers: the
/// camp term is 3 x 0.005 = 0.015 in both lifesteal figures, the panel shows 3 clears, and the Trophy offers the Leech
/// the canonical reading rolls (`kill_augments::roll`).
#[test]
fn guard_with_the_installer_the_camp_readers_are_unchanged() {
    let sim = with_installer(3);
    let (summary_ls, panel_ls, clears, leech) = hud(&sim);
    let (summary_ls0, panel_ls0, clears0, leech0) = hud(&with_installer(0));
    let term = 3. * HOLY_CAMP_LIFESTEAL_PER_CLEAR;
    assert!(
        (summary_ls - summary_ls0 - term).abs() < 1e-12,
        "{summary_ls} vs {summary_ls0}"
    );
    assert!(
        (panel_ls - panel_ls0 - term).abs() < 1e-12,
        "{panel_ls} vs {panel_ls0}"
    );
    assert_eq!((clears, clears0), (3., 0.));
    assert!(
        (leech - term).abs() < 1e-12 && leech0 == 0.,
        "{leech} {leech0}"
    );

    let canonical: Vec<OptionId> = crate::kill_augments::roll(sim.player(holy()).unwrap())
        .into_iter()
        .map(OptionId::Kill)
        .collect();
    let options = trophy_options(sim);
    assert!(has_leech(&options), "the camp Leech option: {options:?}");
    assert_eq!(options, canonical, "the Trophy is today's canonical roll");
}
