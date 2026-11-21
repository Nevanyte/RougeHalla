//! Unit tests of the director, with the helpers the sibling test files share (`director`, `director_with`, `store`, `hello`, `settle`).

use super::*;
use crate::persist::MemoryStore;
use crate::room::Roster;

mod admission;
mod bots;
mod drain;
mod leases;
mod lobby;
mod results;
mod tick_rate;

fn entry(phase: Phase, seated: usize, reserved: usize) -> RoomEntry {
    RoomEntry {
        tx: mpsc::channel(1).0,
        phase,
        seated,
        reserved,
        public: PublicRoom::default(),
    }
}

fn id(n: u8) -> MatchId {
    let mut b = [0u8; 16];
    b[15] = n;
    b
}

fn rooms(entries: &[(u8, Phase, usize, usize)]) -> HashMap<MatchId, RoomEntry> {
    entries
        .iter()
        .map(|&(n, p, s, r)| (id(n), entry(p, s, r)))
        .collect()
}

fn director_with(store: MemoryStore) -> Arc<Director> {
    let sim = SimConfig {
        walk_hints: None,
        hitboxes: Default::default(),
        mob_spacing: Default::default(),
        regen_in_combat: rh_sim::RegenInCombat::Legacy,
        camp_buffs: rh_sim::CampBuffRule::Legacy,
        frost_wish: rh_sim::FrostWish::Freeze,
        augments: rh_sim::AugmentRule::Legacy,
        elites: rh_sim::EliteRule::Legacy,
        regen: false,
        training: false,
        dummies: false,
        consumables: true,
        abilities: rh_sim::abilities::Mode::Off,
        wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
        hazards: rh_sim::terrain::Mode::Off,
        lifecycle: rh_sim::ArenaMode::Off,
        mob_mode: rh_sim::mob_runtime::MobMode::Off,
        initial_loot: false,
        min_players: 2,
        lobby_seconds: 30.0,
        fill_seconds: 0.0,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
        quests: false,
        tick_ms: 50,
    };

    let map = rh_sim::TileMap::from_rows(&["####", "#..#", "#..#", "####"]).unwrap();
    let arena = Arena {
        map,
        spawns: vec![rh_sim::Vec2::new(48.0, 48.0)],
    };
    Director::new(
        DirectorConfig::new(sim, arena),
        Arc::new(Persistence::Memory(Box::new(store))),
        Arc::new(Auth::Dev),
        Arc::new(Lifecycle::default()),
    )
}

fn director() -> Arc<Director> {
    director_with(MemoryStore::default())
}

fn store(d: &Director) -> &MemoryStore {
    match &*d.persistence {
        Persistence::Memory(m) => m,
        #[allow(unreachable_patterns)]
        _ => unreachable!(),
    }
}

fn hello(profile: &str) -> Hello {
    Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        profile: profile.into(),
        ticket: Vec::new(),
        faction: None,
        resume: None,
    }
}

/// A lobby whose task is gone (its inbox is closed) but whose `Closed` report has not been handled yet.
fn dead_lobby(d: &Director, m: MatchId, seated: usize) {
    let (tx, rx) = mpsc::channel(1);
    drop(rx);
    d.inner.lock().unwrap().rooms.insert(
        m,
        RoomEntry {
            tx,
            phase: Phase::Lobby,
            seated,
            reserved: 0,
            public: PublicRoom::default(),
        },
    );
}

fn seat(gen: u64, match_id: MatchId, fence: i64, state: SeatState) -> ProfileSeat {
    ProfileSeat {
        renewal: None,
        gen,
        match_id,
        fence,
        state,
        result_due: false,
        writes: 0,
        lease: LeaseState::Held,
    }
}

fn entry_of(d: &Director, key: &str) -> Option<ProfileSeat> {
    d.inner
        .lock()
        .unwrap()
        .profiles
        .get(&ProfileKey::from(key))
        .cloned()
}

fn some_result(profile: &str) -> rh_sim::RunResult {
    rh_sim::RunResult {
        faction: None,
        weapon: None,
        outcome: rh_sim::Outcome::Mia,
        profile: profile.into(),
        duration_sec: 1,
        kills: 0,
        killed_by: None,
        killed_by_bot: false,
        place: 2,
        players: 2,
        gv: Default::default(),
        win_bonus_withheld: false,
        win_bonus_why: None,
    }
}

/// Lets the report loop (and anything else runnable) drain.
async fn settle() {
    for _ in 0..8 {
        tokio::task::yield_now().await;
    }
}
