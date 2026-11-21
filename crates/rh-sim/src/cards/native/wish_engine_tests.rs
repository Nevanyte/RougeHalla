//! P-AUG-NATIVE-3b oracle: Wish Engine (the workbook's percent table) through the real `WishCast` hook, its holder's
//! shorter Wish cooldown, and the Wish restore envelope that admits it.
//!
//! Loose proof (owner direction 2026-11-10; brief `docs/backlog/packets/P-AUG-NATIVE-3b.md`): each landed Wish adds
//! `CAP x row cooldown / CAP_MS` to the share (workbook Augments rows 68-76 with Augment_Tuning's cap 0.25: Fire 0.025,
//! Frost 0.0375, Plague 0.1, Holy 0.125, Sentenced 0.15), capped at 0.25; the next cast spends `1 - share` of the cooldown
//! (times Arcane Overload's factor); nobody else's cooldown moves; a holder's checkpoint at every cast, landing and
//! recast restores hash-exact and plays on; forged states are refused; Legacy and native-free Rework are unchanged.
use super::exemplars_tests::registered;
use crate::abilities::{definition_for, wish, OwnerView, Slot};
use crate::cards::runtime::WishSpend;
use crate::cards::CardId;
use crate::input::{validate, RawCommand};
use crate::map::TileMap;
use crate::{AugmentRule, FactionId, Placement, Secrets, Sim, SimConfig, Vec2};

fn factions() -> [FactionId; 5] {
    [
        FactionId::Fire,
        FactionId::Frost,
        FactionId::Plague,
        FactionId::Holy,
        FactionId::Sentenced,
    ]
}

fn num(name: &str) -> f64 {
    registered(name).unwrap_or_else(|| panic!("{name} is not a registered content row"))
}

// ---------------------------------------------------------------------------------------------------------------------
// Harness: two players in a walled room; player 1 (the Wisher, slot 0) casts its Wish whenever it is ready.
// ---------------------------------------------------------------------------------------------------------------------

fn room() -> crate::Arena {
    let (w, h) = (40usize, 24usize);
    let rows: Vec<String> = (0..h)
        .map(|y| {
            (0..w)
                .map(|x| {
                    if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    let map = TileMap::from_rows(&rows).expect("room");
    let spawns = [
        (112., 112.),
        (400., 112.),
        (800., 112.),
        (112., 624.),
        (800., 624.),
    ]
    .iter()
    .map(|&(x, y)| Vec2::new(x, y))
    .collect();
    crate::Arena { map, spawns }
}

/// Player 1 (`wisher`) at (300, 320) holding `cards`, player 2 (`other`) at (632, 320) holding `other_cards`.
pub(super) fn world_of(
    augments: AugmentRule,
    wisher: FactionId,
    cards: &[CardId],
    other: FactionId,
    other_cards: &[CardId],
) -> Sim {
    let placements: Vec<Placement> = [(wisher, 300.), (other, 632.)]
        .iter()
        .map(|&(faction, x)| Placement {
            profile: faction.as_str().into(),
            faction,
            bot: false,
            at: Vec2::new(x, 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let config = SimConfig {
        quests: false,
        pvp_rules: false,
        abilities: crate::abilities::Mode::Full,
        wish_lock_ms: 0.,
        augments,
        ..Default::default()
    };
    let secrets = Secrets {
        order_salt: 7,
        spawn_seed: 0,
        reward_salt: [1, 2, 3, 4],
    };
    let mut s = Sim::reset_active(config, room(), secrets, &placements);
    for (i, list) in [cards, other_cards].into_iter().enumerate() {
        for card in list {
            give(&mut s, i, *card);
        }
    }
    s
}

pub(super) fn world(wisher: FactionId, cards: &[CardId]) -> Sim {
    world_of(AugmentRule::Rework, wisher, cards, FactionId::Fire, &[])
}

pub(super) fn give(s: &mut Sim, i: usize, card: CardId) {
    let id = s.w.players[i].id;
    assert!(
        crate::cards::grant(&s.k, &mut s.w, id, card),
        "{id:?} takes {card:?}"
    );
}

/// Wish Engine's share held by player `i` (0 when it does not hold the card).
pub(super) fn share(s: &Sim, i: usize) -> f64 {
    s.w.players[i]
        .build
        .native()
        .slot(CardId::WishEngine)
        .filter(|x| x.count > 0)
        .map_or(0., |x| x.counter)
}

pub(super) fn spend(s: &Sim, i: usize) -> Option<WishSpend> {
    s.w.players[i].card_runtime.and_then(|r| r.wish_cast)
}

pub(super) fn in_flight(s: &Sim, i: usize) -> bool {
    s.w.players[i].core.statuses.cast.is_some()
}

/// The cooldown of the Wish row player `i`'s world casts, before any multiplier.
pub(super) fn row_cooldown(s: &Sim, i: usize) -> f64 {
    definition_for(&s.k.config, wish(s.w.players[i].faction())).cooldown_ms
}

/// The workbook's step for a row cooldown: `cap x cooldown / (minutes to cap x 60 s)`.
pub(super) fn step_of(row: f64) -> f64 {
    num("REWORK_WISH_ENGINE_CAP") * row / num("REWORK_WISH_ENGINE_CAP_MS")
}

/// The share after `n` landed casts: `min(CAP, n x step)`, bit-exact (a grid, so Fire's tenth cast reaches the cap
/// exactly; repeated addition would leave it at 0.24999999999999997).
fn share_after(row: f64, n: usize) -> f64 {
    num("REWORK_WISH_ENGINE_CAP").min(n as f64 * step_of(row))
}

/// The Wish command player `i` sends when its Wish is ready and nothing is in flight (`None` otherwise). Unit Wishes
/// target the other player; Blaze blinks 150 up or down; the rest are cast on the caster.
pub(super) fn wish_raw(s: &Sim, i: usize) -> Option<RawCommand> {
    let p = &s.w.players[i];
    if in_flight(s, i) || p.stocks.wish_ready_at > s.w.server_time {
        return None;
    }
    let other = &s.w.players[1 - i];
    let (x, y, id) = match p.faction() {
        FactionId::Frost | FactionId::Sentenced => (other.pos().x, other.pos().y, Some(other.id)),
        FactionId::Fire => {
            let y = p.pos().y;
            (p.pos().x, if y < 384. { y + 150. } else { y - 150. }, None)
        }
        _ => (p.pos().x, p.pos().y, None),
    };
    Some(RawCommand::Cast {
        slot: Slot::Wish,
        x,
        y,
        id,
        t: None,
        seq: None,
    })
}

/// A world stepped in lockstep with checkpoints restored from it: each follower must keep the main world's state hash on
/// every tick it rides along (restore hash-exact, then play on equal, the casters' commands included).
struct Lockstep {
    main: Sim,
    casters: &'static [usize],
    followers: Vec<(Sim, u32, String)>,
    taken: u32,
}

impl Lockstep {
    fn new(main: Sim, casters: &'static [usize]) -> Self {
        Self {
            main,
            casters,
            followers: Vec::new(),
            taken: 0,
        }
    }

    fn step(&mut self) {
        for &i in self.casters {
            let id = self.main.w.players[i].id;
            for (f, _, what) in &mut self.followers {
                let (a, b) = (wish_raw(&self.main, i), wish_raw(f, i));
                assert_eq!(a.is_some(), b.is_some(), "{what}: the same Wish readiness");
                if let Some(raw) = b {
                    let _ = f.submit(id, validate(raw).expect("valid"));
                }
            }
            if let Some(raw) = wish_raw(&self.main, i) {
                let _ = self.main.submit(id, validate(raw).expect("valid"));
            }
        }
        self.main.step();
        let hash = self.main.state_hash();
        for (f, left, what) in &mut self.followers {
            f.step();
            assert_eq!(
                f.state_hash(),
                hash,
                "{what}: plays on equal ({left} ticks left)"
            );
            *left -= 1;
        }
        self.followers.retain(|(_, left, _)| *left > 0);
    }

    /// Restores a checkpoint of the main world now (it must be admitted and hash-exact) and lets it ride `follow` ticks.
    fn checkpoint(&mut self, follow: u32, what: String) {
        let cp = serde_json::to_value(&self.main).unwrap();
        let r = Sim::restore(cp).unwrap_or_else(|e| panic!("{what}: checkpoint refused: {e:?}"));
        assert_eq!(
            r.state_hash(),
            self.main.state_hash(),
            "{what}: restore is hash-exact"
        );
        self.taken += 1;
        self.followers.push((r, follow, what));
    }
}

/// One Wish of player 1 as the harness saw it.
#[derive(Debug)]
struct Cast {
    share_before: f64,
    view_recharge_ms: f64,
    spend: WishSpend,
    full_at: Option<f64>,
    ready_at: f64,
    share_after: f64,
}

/// Plays player 1's Wish `casts` times (each as soon as it is ready). With `checkpoints`, restores a checkpoint after
/// each acceptance and each landing, and on the tick within two ticks of each recast (a holder's clocks leave the tick
/// lattice), each riding along until past the next landing.
fn play(ls: &mut Lockstep, casts: usize, checkpoints: bool, at: &str) -> Vec<Cast> {
    let mut out = Vec::new();
    let mut guard = 0u32;
    while out.len() < casts {
        guard += 1;
        assert!(guard < 20_000, "{at}: the Wish never got ready");
        let now = ls.main.w.server_time;
        if wish_raw(&ls.main, 0).is_none() {
            let ready_at = ls.main.w.players[0].stocks.wish_ready_at;
            let left = ready_at - now;
            if checkpoints
                && left > crate::constants::TICK_MS
                && left <= 2. * crate::constants::TICK_MS
            {
                ls.checkpoint(24, format!("{at}: two ticks before cast {}", out.len()));
            }
            ls.step();
            continue;
        }
        let share_before = share(&ls.main, 0);
        let view_recharge_ms =
            OwnerView::of(&ls.main.w.players[0], now, ls.main.k.config.training).recharge_ms;
        let before = spend(&ls.main, 0);
        ls.step();
        let sp = spend(&ls.main, 0).expect("a spend");
        assert!(Some(sp) != before, "{at}: cast {} accepted", out.len());
        if checkpoints {
            ls.checkpoint(16, format!("{at}: cast {} accepted", out.len()));
        }
        let mut flight = 0;
        while in_flight(&ls.main, 0) {
            ls.step();
            flight += 1;
            assert!(flight < 40, "{at}: cast {} never landed", out.len());
        }
        if checkpoints {
            ls.checkpoint(16, format!("{at}: cast {} landed", out.len()));
        }
        let p = &ls.main.w.players[0];
        out.push(Cast {
            share_before,
            view_recharge_ms,
            spend: sp,
            full_at: p.stocks.wish_full_at,
            ready_at: p.stocks.wish_ready_at,
            share_after: share(&ls.main, 0),
        });
    }
    out
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. The numbers, through the real hook.
// ---------------------------------------------------------------------------------------------------------------------

/// Each landed Wish adds the workbook's step (cap 0.25 x row cooldown / 5 min) to the share, up to 0.25; the next cast
/// spends `1 - share` of the cooldown, its clock says so, and the owner view shows that cooldown before the cast.
#[test]
fn wish_engine_steps_by_the_workbook_table_per_landed_wish_and_shortens_the_next_cooldown() {
    assert_eq!(registered("REWORK_WISH_ENGINE_CAP"), Some(0.25));
    assert_eq!(registered("REWORK_WISH_ENGINE_CAP_MS"), Some(300_000.));
    // Workbook Augments rows 72-76 (steps at cap 0.2: 0.02, 0.03, 0.08, 0.1, 0.12), scaled to Augment_Tuning's 0.25.
    let workbook = [
        (FactionId::Fire, 0.025, 10),
        (FactionId::Frost, 0.0375, 7),
        (FactionId::Plague, 0.1, 3),
        (FactionId::Holy, 0.125, 2),
        (FactionId::Sentenced, 0.15, 2),
    ];
    for (faction, want_step, casts_to_cap) in workbook {
        let at = format!("{faction:?}");
        let mut ls = Lockstep::new(world(faction, &[CardId::WishEngine]), &[0]);
        let row = row_cooldown(&ls.main, 0);
        assert!((step_of(row) - want_step).abs() < 1e-12, "{at}: step");
        let casts = play(&mut ls, casts_to_cap + 1, false, &at);
        for (n, c) in casts.iter().enumerate() {
            let want_before = share_after(row, n);
            assert!(
                (c.share_before - want_before).abs() < 1e-9,
                "{at}: share before cast {n} is {}, want {want_before}",
                c.share_before
            );
            assert!(
                (c.share_after - share_after(row, n + 1)).abs() < 1e-9,
                "{at}: cast {n} landed and stepped the share to {}",
                c.share_after
            );
            let want_cd = row * (1. - want_before);
            assert!(
                (c.spend.cooldown_ms - want_cd).abs() <= 1.,
                "{at}: cast {n} spent {} ms, want about {want_cd}",
                c.spend.cooldown_ms
            );
            assert_eq!(
                c.view_recharge_ms, c.spend.cooldown_ms,
                "{at}: the owner view showed the cooldown cast {n} spent"
            );
            if faction != FactionId::Fire {
                assert_eq!(
                    c.full_at,
                    Some(c.spend.at + c.spend.cooldown_ms),
                    "{at}: {n}"
                );
                assert_eq!(c.ready_at, c.spend.at + c.spend.cooldown_ms, "{at}: {n}");
            }
        }
        let cap = num("REWORK_WISH_ENGINE_CAP");
        assert!(
            casts[casts_to_cap - 1].share_after == cap && casts[casts_to_cap - 2].share_after < cap,
            "{at}: the cap is reached on cast {casts_to_cap}, not before"
        );
        let last = casts.last().unwrap();
        assert!(
            (last.spend.cooldown_ms - 0.75 * row).abs() <= 1.,
            "{at}: at the cap the Wish costs three quarters of {row} ms, not {}",
            last.spend.cooldown_ms
        );
    }
}

/// Arcane Overload's factor and the share multiply: a Rework holder of both spends `1.5 x (1 - share)` of the row.
#[test]
fn arcane_overload_and_wish_engine_multiply() {
    let factor = num("REWORK_ARCANE_OVERLOAD_WISH_COOLDOWN");
    for faction in [FactionId::Frost, FactionId::Holy] {
        let at = format!("{faction:?}");
        let mut ls = Lockstep::new(
            world(faction, &[CardId::WishEngine, CardId::ArcaneOverload]),
            &[0],
        );
        let row = row_cooldown(&ls.main, 0);
        for (n, c) in play(&mut ls, 3, false, &at).iter().enumerate() {
            let want = row * factor * (1. - share_after(row, n));
            assert!(
                (c.spend.cooldown_ms - want).abs() <= 1.,
                "{at}: cast {n} spent {}, want about {want}",
                c.spend.cooldown_ms
            );
            assert_eq!(
                c.view_recharge_ms, c.spend.cooldown_ms,
                "{at}: owner view {n}"
            );
        }
    }
}

/// Nobody else's cooldown moves: a caster holding another native card (so the `WishCast` hook fires for it) spends the
/// row's full cooldown every time, and a Wish Engine holder who does not cast earns nothing from the other's casts.
#[test]
fn only_the_holder_s_own_landed_wishes_shorten_only_its_own_cooldown() {
    for faction in factions() {
        let at = format!("{faction:?}");
        let s = world_of(
            AugmentRule::Rework,
            faction,
            &[CardId::Pathfinder],
            FactionId::Holy,
            &[CardId::WishEngine],
        );
        let mut ls = Lockstep::new(s, &[0]);
        let row = row_cooldown(&ls.main, 0);
        for (n, c) in play(&mut ls, 3, false, &at).iter().enumerate() {
            assert_eq!(c.spend.cooldown_ms, row, "{at}: cast {n} of a non-holder");
            assert_eq!(
                c.view_recharge_ms, row,
                "{at}: owner view {n} of a non-holder"
            );
        }
        assert_eq!(
            share(&ls.main, 1),
            0.,
            "{at}: the idle holder earned nothing"
        );
    }
    // The positive control of the same harness: the holder casting does step (red until the handler exists).
    let mut ls = Lockstep::new(world(FactionId::Holy, &[CardId::WishEngine]), &[0]);
    let casts = play(&mut ls, 1, false, "Holy control");
    assert!(casts[0].share_after > 0., "the casting holder steps");
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Restore: every cast, landing and recast of a holder; Wishful Thinking and Arcane Overload across a step.
// ---------------------------------------------------------------------------------------------------------------------

/// Every faction plays its holder to the cap and one cast past it; a checkpoint after each acceptance (mid-cast for
/// Frost, Plague and Sentenced), each landing (the share just stepped, the spend cast under the previous one) and two
/// ticks before each recast restores hash-exact and plays on equal through the next cast. Fire casts its two charges
/// back to back, so its full clock holds two different cooldowns.
#[test]
fn a_holder_checkpointed_at_every_cast_landing_and_recast_restores_and_plays_on() {
    let casts_to_cap = [10, 7, 3, 2, 2];
    for (faction, n) in factions().into_iter().zip(casts_to_cap) {
        let at = format!("{faction:?}");
        let mut ls = Lockstep::new(world(faction, &[CardId::WishEngine]), &[0]);
        let row = row_cooldown(&ls.main, 0);
        let casts = play(&mut ls, n + 1, true, &at);
        for _ in 0..30 {
            ls.step();
        }
        assert!(
            ls.followers.is_empty(),
            "{at}: every follower rode to its end"
        );
        let shortened = casts.iter().filter(|c| c.spend.cooldown_ms < row).count();
        assert!(
            shortened >= n,
            "{at}: {shortened} of the checkpointed spends were shortened, want at least {n}"
        );
        assert!(
            ls.taken as usize >= 2 * (n + 1) + n / 2,
            "{at}: {} checkpoints",
            ls.taken
        );
    }
}

/// A Frost holder with Wishful Thinking cuts its first (long) Wish by the full 20% budget, then recasts at the shorter
/// cooldown inside the same 60 s window: the window's trims exceed the new spend's budget (they were cut under the
/// longer one). With Arcane Overload granted between the casts instead, the recast's cooldown carries both levers. Every
/// tick from the recast to past its landing, and two ticks before the next recast, restores and plays on.
#[test]
fn a_recast_after_wishful_cuts_or_an_overload_grant_restores_across_the_step() {
    for overload in [false, true] {
        let at = format!("overload={overload}");
        let cards: &[CardId] = if overload {
            &[CardId::WishEngine]
        } else {
            &[CardId::WishEngine, CardId::WishfulThinking]
        };
        let mut ls = Lockstep::new(world(FactionId::Frost, cards), &[0]);
        let row = row_cooldown(&ls.main, 0);
        let first = play(&mut ls, 1, false, &at)[0].spend;
        assert_eq!(
            first.cooldown_ms, row,
            "{at}: the first cast spends the full row"
        );
        if overload {
            give(&mut ls.main, 0, CardId::ArcaneOverload);
        } else {
            for _ in 0..3 {
                let now = ls.main.w.server_time;
                let numbers = ls.main.k.cards.numbers();
                let p = &mut ls.main.w.players[0];
                let sp = p.card_runtime.and_then(|r| r.wish_cast);
                crate::cards::wishful_thinking(
                    numbers,
                    5,
                    1000.,
                    now,
                    &mut p.stocks,
                    sp,
                    &mut p.card_trims,
                );
                ls.step();
            }
        }
        while wish_raw(&ls.main, 0).is_none() {
            ls.step();
        }
        // The recast: a checkpoint on every tick from its acceptance to four ticks past its landing.
        ls.step();
        let second = spend(&ls.main, 0).expect("recast");
        assert!(second.at > first.at, "{at}: recast");
        for t in 0..12 {
            ls.checkpoint(12, format!("{at}: recast tick {t}"));
            ls.step();
        }
        let factor = if overload {
            num("REWORK_ARCANE_OVERLOAD_WISH_COOLDOWN")
        } else {
            1.
        };
        let want = row * factor * (1. - share_after(row, 1));
        assert!(
            (second.cooldown_ms - want).abs() <= 1.,
            "{at}: the recast spent {}, want about {want}",
            second.cooldown_ms
        );
        if !overload {
            let numbers = ls.main.k.cards.numbers();
            let cut: f64 = ls.main.w.players[0].card_trims.iter().map(|t| t.ms).sum();
            assert!(
                cut > numbers.wishful_budget(second.cooldown_ms),
                "{at}: the window holds {cut} ms of cuts, more than the recast's own budget"
            );
        }
        play(&mut ls, 1, true, &at);
        for _ in 0..30 {
            ls.step();
        }
        assert!(
            ls.followers.is_empty(),
            "{at}: every follower rode to its end"
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Forged states.
// ---------------------------------------------------------------------------------------------------------------------

/// From a Frost holder two casts in (the second spent at one step, the share now two steps), each forgery below is
/// refused and the unforged control restores. One more state, taken while a third cast is in flight, is forged too.
#[test]
fn forged_wish_engine_states_are_refused() {
    let mut ls = Lockstep::new(world(FactionId::Frost, &[CardId::WishEngine]), &[0]);
    let row = row_cooldown(&ls.main, 0);
    let step = step_of(row);
    let casts = play(&mut ls, 2, false, "forge");
    for _ in 0..10 {
        ls.step();
    }
    let sp = casts[1].spend;
    assert!(
        (sp.cooldown_ms - row * (1. - step)).abs() <= 1.,
        "the second cast spent one step's cooldown, not {}",
        sp.cooldown_ms
    );
    assert!(
        (share(&ls.main, 0) - share_after(row, 2)).abs() < 1e-12,
        "two landed casts"
    );
    let base = serde_json::to_value(&ls.main).unwrap();
    let refused = |what: &str, base: &serde_json::Value, forge: &dyn Fn(&mut Sim)| {
        let mut f = Sim::restore(base.clone()).expect("the unforged control restores");
        forge(&mut f);
        let cp = serde_json::to_value(&f).unwrap();
        assert!(Sim::restore(cp).is_err(), "{what}: a forged state restored");
    };
    let set_counter = |v: f64| {
        move |f: &mut Sim| {
            f.w.players[0]
                .build
                .native
                .slot_mut(CardId::WishEngine)
                .unwrap()
                .counter = v;
        }
    };
    let set_spend = |cd: f64| {
        move |f: &mut Sim| {
            let p = &mut f.w.players[0];
            let s = p.card_runtime.as_mut().unwrap().wish_cast.as_mut().unwrap();
            s.cooldown_ms = cd;
            let end = s.at + cd;
            p.stocks.wish_full_at = Some(end);
            p.stocks.wish_ready_at = end;
        }
    };
    let three = share_after(row, 3);
    refused(
        "a counter off its faction's lattice",
        &base,
        &set_counter(1.5 * step),
    );
    refused(
        "a counter two steps above the spend's share",
        &base,
        &set_counter(three),
    );
    refused(
        "a spend at a share above the counter",
        &base,
        &set_spend(crate::math::js_round(row * (1. - three))),
    );
    refused("a non-holder's shortened spend", &base, &|f: &mut Sim| {
        f.w.players[0].build.set(CardId::WishEngine, 0)
    });
    refused("clocks under the spend's own", &base, &|f: &mut Sim| {
        let p = &mut f.w.players[0];
        let end = sp.at + sp.cooldown_ms - 1000.;
        p.stocks.wish_full_at = Some(end);
        p.stocks.wish_ready_at = end;
    });
    // In flight: the third cast's spend forged to a share the holder has not reached.
    while wish_raw(&ls.main, 0).is_none() {
        ls.step();
    }
    ls.step();
    assert!(in_flight(&ls.main, 0), "the third cast is in flight");
    let flight = serde_json::to_value(&ls.main).unwrap();
    Sim::restore(flight.clone()).expect("the in-flight control restores");
    refused(
        "an in-flight spend at a share not reached",
        &flight,
        &set_spend(crate::math::js_round(row * (1. - three))),
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Readout and pool.
// ---------------------------------------------------------------------------------------------------------------------

/// The holder's readout shows its share against the cap (own rows only); the zone pool offers Wish Engine to anyone.
#[test]
fn wish_engine_reads_out_its_share_and_joins_the_zone_pool() {
    let mut ls = Lockstep::new(world(FactionId::Holy, &[CardId::WishEngine]), &[0]);
    play(&mut ls, 1, false, "readout");
    let rows: Vec<_> = super::readouts(&ls.main, ls.main.w.players[0].id)
        .rows()
        .iter()
        .map(|r| (r.card, r.kind, r.value, r.max))
        .collect();
    assert_eq!(
        rows,
        [(
            CardId::WishEngine,
            super::ReadoutKind::Counter,
            0.125,
            num("REWORK_WISH_ENGINE_CAP")
        )]
    );
    assert!(super::readouts(&ls.main, ls.main.w.players[1].id)
        .rows()
        .is_empty());
    assert!(
        super::zone::POOL.contains(&(CardId::WishEngine, crate::reward_chests::Offer::Any)),
        "the zone pool offers Wish Engine to any faction"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Legacy and native-free Rework are unchanged.
// ---------------------------------------------------------------------------------------------------------------------

fn fnv(words: impl IntoIterator<Item = u64>) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for w in words {
        for b in w.to_le_bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    h
}

/// Fire (Wishful Thinking, and Pathfinder in Rework so the `WishCast` hook fires) and Frost (Arcane Overload from tick
/// 300) cast their Wishes whenever ready for 2400 ticks: the state hash every 50 ticks and the final world's text.
fn digest(augments: AugmentRule) -> (u64, u64) {
    let fire_cards: &[CardId] = if augments == AugmentRule::Rework {
        &[CardId::WishfulThinking, CardId::Pathfinder]
    } else {
        &[CardId::WishfulThinking]
    };
    let s = world_of(augments, FactionId::Fire, fire_cards, FactionId::Frost, &[]);
    let mut ls = Lockstep::new(s, &[0, 1]);
    let mut hashes = Vec::new();
    for t in 0..2400u32 {
        if t == 300 {
            give(&mut ls.main, 1, CardId::ArcaneOverload);
        }
        ls.step();
        if t % 50 == 49 {
            hashes.push(ls.main.state_hash());
        }
    }
    assert!(
        spend(&ls.main, 0).is_some() && spend(&ls.main, 1).is_some(),
        "both cast"
    );
    let text = serde_json::to_string(&ls.main.w).unwrap();
    (fnv(hashes), fnv(text.bytes().map(u64::from)))
}

#[test]
fn legacy_and_rework_without_wish_engine_play_as_on_the_base() {
    // Recorded on `packet/P-AUG-NATIVE-3b` at the stub commit (no Wish Engine behaviour: the base's).
    let legacy: (u64, u64) = (557807947671313187, 13382606214435028896);
    let rework: (u64, u64) = (10009499299823935763, 13403526707108067106);
    assert_eq!(digest(AugmentRule::Legacy), legacy, "Legacy");
    assert_eq!(
        digest(AugmentRule::Rework),
        rework,
        "Rework without Wish Engine"
    );
}
