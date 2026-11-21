//! P-ELITE-PICK-1 oracle (bots): a live fill bot (`HumanBot`) standing at an elite camp chest whose first pick is another
//! player's waits out the window through its own observation (`can_choose`), submitting no `Choose` and drawing no
//! refusal, then picks once the chest is first-come. Brief `docs/backlog/packets/P-ELITE-PICK-1.md`.
use rh_policy::bots::{HumanBot, PersonaId, TierId};
use rh_policy::{drive_seats_with, scripted::Idle, MatchStart, Seat};
use rh_sim::{
    Arena, EliteRule, Event, FactionId, Placement, PlayerId, RawCommand, Secrets, SightCache, Sim,
    SimConfig, Vec2,
};

/// The owner's window (5 s), in ms.
fn window_ms() -> f64 {
    5000.
}

fn seed1_arena() -> Arena {
    let file: rh_sim::mapdata::MapExport = serde_json::from_str(include_str!(
        "../../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .expect("seed1 map");
    file.validate().unwrap().into_arena().unwrap()
}

/// An elite camp of seed1 whose chest tile is open, and that tile's point.
fn elite_chest(arena: &Arena) -> (u16, Vec2) {
    let camps = &arena.map.layers().expect("seed1 layers").data().camps;
    camps
        .iter()
        .enumerate()
        .filter(|(_, c)| c.elite_spot >= 0)
        .map(|(i, c)| (i as u16, Vec2::new(c.chest.x, c.chest.y)))
        .find(|(_, at)| {
            !arena
                .map
                .is_solid((at.x / 32.).floor() as i64, (at.y / 32.).floor() as i64)
        })
        .expect("an elite camp with an open chest tile")
}

/// Player 1 (the killer, idle) and player 2 (the bot) at the chest of a Rework world whose chest holds player 1's window.
/// Returns the world, the chest id and the window's end.
fn scene() -> (Sim, u32, f64) {
    let arena = seed1_arena();
    let (camp, at) = elite_chest(&arena);
    let place = |name: &str, bot: bool, dx: f64| Placement {
        profile: name.into(),
        faction: FactionId::Holy,
        bot,
        at: Vec2::new(at.x + dx, at.y),
        hp: None,
        weapon0: None,
        weapon1: None,
    };
    let sim = Sim::reset_active(
        SimConfig {
            quests: false,
            pvp_rules: false,
            elites: EliteRule::Rework,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(7),
        &[place("killer", false, 0.), place("bot", true, 0.)],
    );
    let now = sim.server_time();
    let until = now + window_ms();
    let mut cp = serde_json::to_value(&sim).unwrap();
    let id = cp["world"]["entity_counter"].as_u64().unwrap() + 1;
    cp["world"]["entity_counter"] = id.into();
    cp["world"]["reward_chests"] = serde_json::json!([{
        "id": id,
        "at": {"x": at.x, "y": at.y},
        "expires_at": now + 15000.,
        "held_until_tick": sim.tick(),
        "options": [{"Card": "slowBurn"}, {"Card": "pocketSand"}, {"Card": "siphon"}],
        "taken": [null, null, null],
        "pickers": [],
        "camp": camp,
        "owner": null,
        "first_pick": {"killer": 1, "until": until},
    }]);
    let sim = Sim::restore(&cp).expect("a Rework camp chest holding its killer's window restores");
    (sim, id as u32, until)
}

#[test]
fn a_bot_waits_out_another_players_first_pick_then_picks() {
    let bot = PlayerId(2);
    for seed in 1..=4u64 {
        let (mut sim, chest, until) = scene();
        let start = MatchStart::of(&sim, bot, seed);
        let mut seats = [Seat::new(
            &start,
            Box::new(HumanBot::new(TierId::Normal, PersonaId::Opportunist)),
            Box::new(Idle),
        )];
        seats[0].bind_fx(&sim).unwrap();
        let chooses: Vec<rh_sim::Command> = (-1..=2)
            .map(|pick| {
                rh_sim::validate(RawCommand::Choose {
                    chest_id: Some(chest),
                    pick,
                })
                .unwrap()
            })
            .collect();
        let mut sight = SightCache::new();
        let mut events: Vec<Event> = vec![];
        let (mut early, mut refused, mut taken_at) = (0, 0, None);
        for _ in 0..280 {
            let now = sim.server_time();
            let mut sent = 0;
            drive_seats_with(&mut sim, &mut seats, &events, &mut sight, |who, c| {
                if who == bot && chooses.contains(&c) {
                    sent += 1;
                }
            });
            if now < until {
                assert!(
                    sim.player(PlayerId(1)).is_some_and(|p| p.standing()),
                    "seed {seed}: the killer stands through the window"
                );
                early += sent;
            }
            events = sim.step();
            for e in &events {
                match e {
                    Event::ChestRefused { id, .. } if *id == bot => refused += 1,
                    Event::ChestTaken { by, chest: c, .. } if *by == bot && *c == chest => {
                        taken_at.get_or_insert(sim.server_time());
                    }
                    _ => {}
                }
            }
        }
        assert_eq!(
            early, 0,
            "seed {seed}: the bot asked for another player's first pick"
        );
        assert_eq!(refused, 0, "seed {seed}: the bot drew a chest refusal");
        let taken_at =
            taken_at.unwrap_or_else(|| panic!("seed {seed}: the bot picked after the window"));
        assert!(
            taken_at >= until,
            "seed {seed}: picked at {taken_at}, window ends {until}"
        );
        assert!(seats[0].fault.is_none(), "seed {seed}");
    }
}
