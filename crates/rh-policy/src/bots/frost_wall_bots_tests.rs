//! P-FROST-WALL-BOTS-1 oracle: bots aim Frost Wall as legacy's bots do.
//!
//! Legacy (unreleased commit `78dd8bd4`, `packages/server/src/bots/abilityPolicy.ts:54-58, :92-101, :113-141,
//! :164-174`): a rank with a `do: "wall"` effect is cast at `me + (enemy - me) * min(range, d * 0.7) / d` (no unit id)
//! when the nearest enemy player is chasing the bot from 56 to 260 u away (`peel`), or when the bot is in trouble
//! (`escape`: between it and the threat, else its foe); never to engage. Its own test
//! (`packages/server/test/abilityPolicy.test.ts:217-231`, `ME = (640, 320)`) is ported case by case below.
//!
//! Three layers: the shared rule on the policy's own situation (`decide_cast`, what both stacks call); the HumanBot seat
//! on staged observations (`component_commands`); both stacks as seats in a real sim whose Frost Wish is the wall (the
//! seat learns it from `MatchStart::frost_wish`, the room's public fact the Welcome gives every human). Guards: a
//! Freeze room, and the other Wishes, decide exactly as today. Loose-proof standard (owner direction 2026-11-10): the
//! numbers are legacy's; the seat-level checks allow the humanizer's ground scatter.
use crate::bots::bot::HumanBot;
use crate::bots::types::{PersonaId, TierId};
use crate::bots::wish::*;
use crate::bots::{brain_features, BrainBot};
use crate::{drive_seats, scripted, MatchStart, Policy, Seat};
use rh_sim::abilities::{blink, OwnerView};
use rh_sim::observe::{ActorView, SeenEvent, SelfView};
use rh_sim::status_runtime::AbilityId;
use rh_sim::{
    Arena, Event, FactionId, FrostWish, Observation, Phase, PlayerId, PublicCommand, RawCommand,
    Secrets, Sim, SimConfig, Status, TileMap, Vec2, WeaponId,
};
use std::sync::Arc;

// ---------------------------------------------------------------------------------------------------- the shared rule

/// Legacy's test position (`abilityPolicy.test.ts:30`).
const ME: (f64, f64) = (640., 320.);
/// Legacy's constants (`abilityPolicy.ts:55-58`), written out so the test does not trust the port's copies.
const PEEL_MAX: f64 = 260.;
const PEEL_MIN: f64 = 56.;
const SHARE: f64 = 0.7;

fn open_map() -> TileMap {
    let (w, h) = (48u32, 32u32);
    let mut tiles = vec![rh_sim::map::TILE_FLOOR; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                tiles[(y * w + x) as usize] = rh_sim::map::TILE_WALL;
            }
        }
    }
    TileMap::new(w, h, tiles).expect("open map")
}

/// The Frost Wall row a Wall room plays.
fn wall() -> &'static WishDef {
    wish_for(AbilityId::Freeze, FrostWish::Wall)
        .expect("Frost's Wish has a policy row in a Wall room")
}

/// Legacy `calm`: full hp, not hit, nobody near.
fn calm<'a>(map: &'a TileMap, ring: &'a blink::Ring) -> CastSituation<'a> {
    CastSituation {
        me: MeView {
            x: ME.0,
            y: ME.1,
            hp_frac: 1.,
            effects: 0,
            recently_hit: false,
        },
        foe: None,
        threat: None,
        map,
        ring,
        gates_locked: false,
    }
}

/// Legacy `threatAt(d)`: the nearest enemy player `d` u east, chasing, targetable, in sight.
fn threat_at(d: f64, chasing: bool) -> ThreatView {
    ThreatView {
        x: ME.0 + d,
        y: ME.1,
        d,
        chasing,
        id: Some("foe".into()),
        los: Some(true),
        targetable: Some(true),
    }
}

/// Legacy `foeAt(d)`: what the bot fights, `d` u east.
fn foe_at(d: f64) -> FoeView {
    FoeView {
        id: "foe".into(),
        x: ME.0 + d,
        y: ME.1,
        d,
        los: true,
        targetable: true,
        mob: false,
    }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-6
}

/// The cast is the wall's: a point with no unit id at `share` of the way from the bot to `(tx, ty)`.
fn assert_wall_at(got: Option<CastChoice>, tx: f64, ty: f64, what: &str) {
    let c = got.unwrap_or_else(|| panic!("{what}: the bot drops the wall"));
    assert_eq!(
        c.id, None,
        "{what}: a wall is a point cast, never a unit cast ({c:?})"
    );
    let (wx, wy) = (ME.0 + (tx - ME.0) * SHARE, ME.1 + (ty - ME.1) * SHARE);
    assert!(
        close(c.x, wx) && close(c.y, wy),
        "{what}: the wall goes 70% of the way to the enemy, at ({wx}, {wy}); got ({}, {})",
        c.x,
        c.y
    );
}

#[test]
fn frost_wall_the_row_a_wall_room_plays_is_legacys_frost_wall() {
    // 78dd8bd4 shared/abilities.ts:260-271: ai ["peel", "escape"], the Wish block set, a point target 450 / 64,
    // cast 250 ms, one effect `{ do: "wall", ms: 4000, length: 224 }`.
    let row = wall();
    assert_eq!(
        row.ai,
        &[AiIntent::Peel, AiIntent::Escape][..],
        "intent order"
    );
    assert_eq!(row.blocked_by, &[BlockedBy::Stun, BlockedBy::Silence][..]);
    assert!(!row.drops_lock);
    assert_eq!(row.rank.cast_ms, 250.);
    assert_eq!(
        row.rank.targeting,
        TargetRule::Point {
            range: 450.,
            min_range: 64.
        }
    );
    assert_eq!(
        row.rank.effects,
        &[PolicyEffect::Wall {
            ms: 4000.,
            length: 224.
        }][..]
    );
    // The sim's own wall agrees with the row the bots play.
    let sim = rh_sim::abilities::frost_wall_definition();
    assert_eq!(sim.cast_ms, row.rank.cast_ms);
    match sim.target {
        rh_sim::abilities::Target::Placed { range, min_range } => {
            assert_eq!((range, min_range), (450., 64.));
        }
        other => panic!("the sim's wall is a placed cast, got {other:?}"),
    }
    assert!(!hides_caster(row, 1));
}

#[test]
fn frost_wall_legacy_abilitypolicy_cases() {
    // abilityPolicy.test.ts:217-231, one assertion each.
    let map = open_map();
    let ring = blink::Ring::new(&map);
    let row = wall();
    let at = decide_cast(
        row,
        1,
        &CastSituation {
            threat: Some(threat_at(200., true)),
            ..calm(&map, &ring)
        },
    );
    assert_wall_at(at, ME.0 + 200., ME.1, "a chaser at 200");
    assert_eq!(
        decide_cast(
            row,
            1,
            &CastSituation {
                threat: Some(threat_at(200., false)),
                ..calm(&map, &ring)
            }
        ),
        None,
        "an enemy standing off at 200 draws no wall"
    );
    assert_eq!(
        decide_cast(
            row,
            1,
            &CastSituation {
                threat: Some(threat_at(PEEL_MIN - 1., true)),
                ..calm(&map, &ring)
            }
        ),
        None,
        "a chaser at 55 is on top of the bot: no wall"
    );
    assert_eq!(
        decide_cast(
            row,
            1,
            &CastSituation {
                threat: Some(threat_at(PEEL_MAX + 1., true)),
                ..calm(&map, &ring)
            }
        ),
        None,
        "a chaser at 261 is too far: no wall"
    );
    // In trouble (low and hit) it goes between the bot and the enemy too, chasing or not.
    let out = decide_cast(
        row,
        1,
        &CastSituation {
            me: MeView {
                hp_frac: 0.3,
                recently_hit: true,
                ..calm(&map, &ring).me
            },
            threat: Some(threat_at(150., false)),
            ..calm(&map, &ring)
        },
    );
    assert_wall_at(out, ME.0 + 150., ME.1, "escaping a threat at 150");
    // Never a unit cast, and nothing at peace: a foe with no threat.
    assert_eq!(
        decide_cast(
            row,
            1,
            &CastSituation {
                foe: Some(foe_at(200.)),
                ..calm(&map, &ring)
            }
        ),
        None,
        "a foe standing off draws no wall (engage is not a wall tag)"
    );
}

#[test]
fn frost_wall_the_peel_window_is_inclusive_and_the_wall_lies_between_the_bot_and_the_chaser() {
    let map = open_map();
    let ring = blink::Ring::new(&map);
    let row = wall();
    for d in [PEEL_MIN, 91., 140., PEEL_MAX] {
        let got = decide_cast(
            row,
            1,
            &CastSituation {
                threat: Some(threat_at(d, true)),
                ..calm(&map, &ring)
            },
        );
        // 56..=91 aims inside the wall's 64 u minimum range: legacy aims there anyway and the sim clamps.
        assert_wall_at(got, ME.0 + d, ME.1, &format!("a chaser at {d}"));
    }
    // A chaser up and to the right (3-4-5): the point is on the segment, 70% of the way.
    let (dx, dy) = (120., -160.);
    let diagonal = ThreatView {
        x: ME.0 + dx,
        y: ME.1 + dy,
        d: 200.,
        ..threat_at(200., true)
    };
    let got = decide_cast(
        row,
        1,
        &CastSituation {
            threat: Some(diagonal),
            ..calm(&map, &ring)
        },
    );
    assert_wall_at(
        got.clone(),
        ME.0 + dx,
        ME.1 + dy,
        "a diagonal chaser at 200",
    );
    let c = got.expect("cast");
    let t = ((c.x - ME.0) * dx + (c.y - ME.1) * dy) / (dx * dx + dy * dy);
    assert!(t > 0. && t < 1., "between the bot and the chaser: t = {t}");
    // The wall reads no line of sight (shots and sight pass over it anyway) and no unit id.
    let blind = ThreatView {
        los: Some(false),
        id: None,
        ..threat_at(180., true)
    };
    assert_wall_at(
        decide_cast(
            row,
            1,
            &CastSituation {
                threat: Some(blind),
                ..calm(&map, &ring)
            },
        ),
        ME.0 + 180.,
        ME.1,
        "a chaser out of sight",
    );
    // An untargetable chaser is not peeled (`t.targetable === false`); an unknown flag is.
    let untargetable = ThreatView {
        targetable: Some(false),
        ..threat_at(180., true)
    };
    assert_eq!(
        decide_cast(
            row,
            1,
            &CastSituation {
                threat: Some(untargetable),
                ..calm(&map, &ring)
            }
        ),
        None,
        "an untargetable chaser"
    );
    let unknown = ThreatView {
        targetable: None,
        ..threat_at(180., true)
    };
    assert_wall_at(
        decide_cast(
            row,
            1,
            &CastSituation {
                threat: Some(unknown),
                ..calm(&map, &ring)
            },
        ),
        ME.0 + 180.,
        ME.1,
        "a chaser with no targetable flag",
    );
}

#[test]
fn frost_wall_escape_walls_off_the_threat_or_the_foe_inside_the_window_only() {
    let map = open_map();
    let ring = blink::Ring::new(&map);
    let row = wall();
    let low = |hp_frac: f64, recently_hit: bool| MeView {
        hp_frac,
        recently_hit,
        ..calm(&map, &ring).me
    };
    // Threatened (hp < 0.5, a threat under 260): a threat standing off at 200 is walled off.
    assert_wall_at(
        decide_cast(
            row,
            1,
            &CastSituation {
                me: low(0.4, false),
                threat: Some(threat_at(200., false)),
                ..calm(&map, &ring)
            },
        ),
        ME.0 + 200.,
        ME.1,
        "threatened at 200",
    );
    // Hit and low with nobody in view: the wall goes toward what it fights, a mob included (`s.threat ?? s.foe`).
    let mob = FoeView {
        mob: true,
        ..foe_at(100.)
    };
    assert_wall_at(
        decide_cast(
            row,
            1,
            &CastSituation {
                me: low(0.3, true),
                foe: Some(mob),
                ..calm(&map, &ring)
            },
        ),
        ME.0 + 100.,
        ME.1,
        "escaping the mob it fights",
    );
    // The escape distance is measured, not read off the threat (`Math.hypot(from - me)`): a threat row carrying a
    // stale `d` of 999 standing 150 u east is walled off at 105.
    let stale = ThreatView {
        d: 999.,
        ..threat_at(150., false)
    };
    assert_wall_at(
        decide_cast(
            row,
            1,
            &CastSituation {
                me: low(0.3, true),
                threat: Some(stale),
                ..calm(&map, &ring)
            },
        ),
        ME.0 + 150.,
        ME.1,
        "escape measures the distance",
    );
    // Outside the window an escape draws no wall, and never falls through to a blink heading.
    for d in [40., 300.] {
        assert_eq!(
            decide_cast(
                row,
                1,
                &CastSituation {
                    me: low(0.3, true),
                    threat: Some(threat_at(d, true)),
                    ..calm(&map, &ring)
                }
            ),
            None,
            "escaping a threat at {d}"
        );
    }
    // Not in trouble and not chased: nothing.
    assert_eq!(
        decide_cast(
            row,
            1,
            &CastSituation {
                me: low(0.6, true),
                threat: Some(threat_at(150., false)),
                ..calm(&map, &ring)
            }
        ),
        None
    );
}

#[test]
fn frost_wall_blocking_bits_and_the_easy_tier() {
    // abilityPolicy.test.ts:50-60 run for the wall: `trouble(0)` casts; a stun, a silence or a cast in progress refuse.
    let map = open_map();
    let ring = blink::Ring::new(&map);
    let row = wall();
    let trouble = |effects: u16| CastSituation {
        me: MeView {
            hp_frac: 0.2,
            recently_hit: true,
            effects,
            ..calm(&map, &ring).me
        },
        threat: Some(threat_at(100., true)),
        foe: Some(foe_at(100.)),
        ..calm(&map, &ring)
    };
    assert_wall_at(
        decide_cast(row, 1, &trouble(0)),
        ME.0 + 100.,
        ME.1,
        "in trouble",
    );
    for bits in [EFFECT_STUNNED, EFFECT_SILENCED, EFFECT_CASTING] {
        assert_eq!(
            decide_cast(row, 1, &trouble(bits)),
            None,
            "blocked by {bits}"
        );
    }
    assert!(
        decide_cast(row, 1, &trouble(EFFECT_ROOTED)).is_some(),
        "a root does not block a Wish"
    );
    // wishes.ts:161-165 playedDef: Easy keeps the escape tag only, so it walls to escape and never to peel.
    let easy = played_ai(row, TierId::Easy).expect("Easy keeps the wall's escape tag");
    assert_eq!(easy, &[AiIntent::Escape][..]);
    assert_eq!(
        decide_cast_with(
            row,
            easy,
            1,
            &CastSituation {
                threat: Some(threat_at(200., true)),
                ..calm(&map, &ring)
            }
        ),
        None,
        "Easy does not peel"
    );
    assert_wall_at(
        decide_cast_with(row, easy, 1, &trouble(0)),
        ME.0 + 100.,
        ME.1,
        "Easy escapes",
    );
    assert_eq!(played_ai(row, TierId::Hard), Some(row.ai));
}

#[test]
fn guard_frost_wall_a_freeze_room_and_the_other_wishes_keep_their_rows_and_decisions() {
    let map = open_map();
    let ring = blink::Ring::new(&map);
    for id in AbilityId::ALL {
        let today = wish_by_id(id).expect("a catalog row");
        assert!(
            std::ptr::eq(wish_for(id, FrostWish::Freeze).expect("row"), today),
            "{id:?}: a Freeze room plays the catalog row"
        );
        if id != AbilityId::Freeze {
            assert!(
                std::ptr::eq(wish_for(id, FrostWish::Wall).expect("row"), today),
                "{id:?}: only Frost's Wish changes in a Wall room"
            );
        }
    }
    assert_eq!(WISHES.len(), 5, "the catalog keeps its five rows");
    // Freeze, on the wall's own cases, decides as it does today: a unit cast on the chaser, an engage on the foe.
    let freeze = wish_for(AbilityId::Freeze, FrostWish::Freeze).expect("row");
    let peel = decide_cast(
        freeze,
        1,
        &CastSituation {
            threat: Some(threat_at(120., true)),
            ..calm(&map, &ring)
        },
    );
    assert_eq!(
        peel,
        Some(CastChoice {
            x: ME.0 + 120.,
            y: ME.1,
            id: Some("foe".into())
        })
    );
    let engage = decide_cast(
        freeze,
        1,
        &CastSituation {
            foe: Some(foe_at(200.)),
            ..calm(&map, &ring)
        },
    );
    assert_eq!(
        engage,
        Some(CastChoice {
            x: ME.0 + 200.,
            y: ME.1,
            id: Some("foe".into())
        })
    );
    assert_eq!(
        decide_cast(
            freeze,
            1,
            &CastSituation {
                threat: Some(threat_at(200., true)),
                ..calm(&map, &ring)
            }
        ),
        None,
        "Freeze does not peel a chaser beyond 150"
    );
}

// ------------------------------------------------------------------------------------- the HumanBot seat, staged frames

const BOT: PlayerId = PlayerId(7);
const ENEMY: PlayerId = PlayerId(8);
const BOT_AT: (f64, f64) = (400., 400.);

fn staged_arena() -> Arena {
    let mut tiles = vec![rh_sim::map::TILE_WALL; 32 * 32];
    for y in 1..31 {
        for x in 1..31 {
            tiles[(y * 32 + x) as usize] = rh_sim::map::TILE_FLOOR;
        }
    }
    Arena {
        map: TileMap::new(32, 32, tiles).expect("hand-built map"),
        spawns: vec![Vec2::new(BOT_AT.0, BOT_AT.1)],
    }
}

fn staged_start(frost_wish: FrostWish) -> MatchStart {
    MatchStart {
        me: BOT,
        seed: 11,
        arena: Arc::new(staged_arena()),
        content_hash: rh_sim::content::content_hash(),
        observation_version: rh_sim::OBSERVATION_VERSION,
        tick_ms: rh_sim::constants::TICK_MS,
        frost_wish,
    }
}

/// The Frost bot's own observation: its Wish slot (the sim's code is Freeze's in either room), hp, and one enemy
/// player at `enemy`, which hit it this frame when `hit`.
fn staged(now: f64, hp: f64, enemy: (f64, f64), hit: bool) -> Observation {
    let ability = AbilityId::Freeze;
    let max_charges = rh_sim::abilities::definition(ability).charges;
    let mut o = Observation {
        version: rh_sim::OBSERVATION_VERSION,
        tick: 1,
        server_time: now,
        phase: Phase::Active,
        ..Observation::default()
    };
    o.inventory = Some(rh_sim::Inventory {
        active_slot: 0,
        potion_small: 0,
        potion_large: 0,
        potions_healing: 0,
        slots: [None, None],
        healing_until: None,
        speed_boost_until: None,
    });
    o.owner_combat = Some(rh_sim::OwnerCombatView {
        lock: rh_sim::OwnerLockView::Clear,
        draw_started_at: 0,
        ready_at: 0,
        as_milli: 1000.,
        windup_milli: 1000.,
        speed_milli: 1000.,
    });
    o.me = Some(SelfView {
        archetype: Default::default(),
        wish: Some(OwnerView {
            ability,
            ready_at: 0.,
            full_at: None,
            max_charges,
            recharge_ms: rh_sim::abilities::cooldown(ability, false, None),
            charges: max_charges,
            next_charge_at: None,
            cast: None,
        }),
        effects: 0,
        displace_seq: 0,
        mark_tier: 0,
        brand: 0,
        mark_by: None,
        mark_tax: 0,
        sig: 0,
        attack_target: None,
        hunt_target: None,
        hunt_stacks: 0,
        corpse_stacks: 0,
        plague_zombie: None,
        id: BOT,
        faction: FactionId::Frost,
        x: BOT_AT.0,
        y: BOT_AT.1,
        facing: 0.,
        hp,
        max_hp: 1000.,
        barrier: 0.,
        barrier_ring_step: 0,
        status: Status::Alive,
        weapon: WeaponId::Fists,
        ready_in_ms: 0.,
        kills: 0,
        bounty: 0,
        gv: 0,
        move_seq: 0,
        facts: Default::default(),
    });
    o.visible.push(ActorView {
        archetype: Default::default(),
        kind: rh_sim::observe::ActorKind::Player,
        owner: None,
        mob_type: None,
        effects: 0,
        displace_seq: 0,
        mark_tier: 0,
        brand: 0,
        mark_by: None,
        mark_tax: 0,
        sig: 0,
        id: ENEMY,
        faction: FactionId::Fire.into(),
        x: enemy.0,
        y: enemy.1,
        facing: 0.,
        hp_frac: 1.,
        barrier_frac: 0.,
        barrier_ring_step: 0,
        status: Status::Alive,
        weapon: Some(WeaponId::Sword),
        bounty: 0,
        facts: Default::default(),
    });
    if hit {
        o.events.push(SeenEvent::Hit {
            victim: BOT,
            by: Some(ENEMY),
            amount: 40.,
            passive: false,
            critical: false,
        });
    }
    o
}

fn humanbot(frost_wish: FrostWish) -> HumanBot {
    let mut bot = HumanBot::new(TierId::Normal, PersonaId::Hunter);
    bot.reset(&staged_start(frost_wish));
    bot
}

/// Three seconds of frames at 20 Hz; `enemy_at(i)` is where the enemy stands in frame `i`.
fn wish_casts(
    mut bot: HumanBot,
    hp: f64,
    hit: bool,
    enemy_at: impl Fn(u32) -> (f64, f64),
) -> Vec<(f64, f64, Option<PlayerId>)> {
    let mut out = Vec::new();
    for i in 0..60u32 {
        let obs = staged(1_000. + f64::from(i) * 50., hp, enemy_at(i), hit);
        for c in bot.component_commands(&obs) {
            if let PublicCommand::Cast {
                slot: rh_sim::abilities::Slot::Wish,
                x,
                y,
                id,
                ..
            } = c
            {
                out.push((x, y, id));
            }
        }
    }
    out
}

/// One ground click's scatter allowance (the humanizer's `ground_click`; legacy's hand scatters a point cast too).
const SCATTER: f64 = 32.;

#[test]
fn frost_wall_a_humanbot_in_a_wall_room_drops_the_wall_between_itself_and_the_enemy_on_it() {
    // An enemy 130 u east that hit the bot just now is "chasing" (wishes.ts:110-112: hit within 1.5 s and within
    // 150 u), the bot is not in trouble (hp 0.9): legacy's peel drops the wall at 0.7 * 130 = 91 u east.
    let casts = wish_casts(humanbot(FrostWish::Wall), 900., true, |_| {
        (BOT_AT.0 + 130., BOT_AT.1)
    });
    let &(x, y, id) = casts
        .first()
        .unwrap_or_else(|| panic!("the seat casts its Wish: {casts:?}"));
    assert_eq!(
        id, None,
        "a wall is a ground cast, not a unit cast: {casts:?}"
    );
    let want = (BOT_AT.0 + 0.7 * 130., BOT_AT.1);
    assert!(
        ((x - want.0).powi(2) + (y - want.1).powi(2)).sqrt() <= SCATTER,
        "the wall goes 70% of the way to the enemy, near {want:?}: got ({x}, {y})"
    );
    assert!(
        x > BOT_AT.0 && x < BOT_AT.0 + 130.,
        "between the bot and the enemy: x = {x}"
    );
}

#[test]
fn frost_wall_a_humanbot_walls_an_enemy_walking_at_it() {
    // The enemy walks at the bot from 300 u at a walking pace (8.5 u a tick), never hitting it: chasing by its observed
    // motion (the seat's own successive positions), not by memory. It stops 70 u short.
    let enemy = |i: u32| (BOT_AT.0 + (300. - 8.5 * f64::from(i)).max(70.), BOT_AT.1);
    let casts = wish_casts(humanbot(FrostWish::Wall), 1000., false, enemy);
    let &(x, y, id) = casts
        .first()
        .unwrap_or_else(|| panic!("the seat walls the chaser: {casts:?}"));
    assert_eq!(id, None, "{casts:?}");
    assert!(
        (y - BOT_AT.1).abs() <= SCATTER,
        "on the line to the chaser: y = {y}"
    );
    let reach = x - BOT_AT.0;
    assert!(
        (0.7 * 56. - SCATTER..=0.7 * 260. + SCATTER).contains(&reach),
        "70% of a distance in the peel window (56..=260): {reach}"
    );
}

#[test]
fn frost_wall_a_humanbot_does_not_wall_an_enemy_standing_off() {
    // An enemy standing still 200 u away, no hits, full hp: not chasing, no trouble. Freeze would engage it; the wall has
    // no engage tag, so nothing is cast.
    let casts = wish_casts(humanbot(FrostWish::Wall), 1000., false, |_| {
        (BOT_AT.0 + 200., BOT_AT.1)
    });
    assert!(
        casts.is_empty(),
        "no wall at an enemy standing off: {casts:?}"
    );
}

#[test]
fn guard_frost_wall_a_humanbot_in_a_freeze_room_casts_freeze_as_today() {
    let casts = wish_casts(humanbot(FrostWish::Freeze), 900., true, |_| {
        (BOT_AT.0 + 130., BOT_AT.1)
    });
    assert!(
        casts.iter().any(|c| c.2 == Some(ENEMY)),
        "Freeze is a unit cast on the chaser: {casts:?}"
    );
    assert!(casts.iter().all(|c| c.2.is_some()), "{casts:?}");
}

#[test]
fn guard_frost_wall_match_start_carries_the_rooms_frost_wish() {
    assert_eq!(
        crate::POLICY_CONTRACT_VERSION,
        25,
        "MatchStart carries the room's Frost Wish (P-FROST-WALL-BOTS-1)"
    );
    let arena = staged_arena();
    let placements = [rh_sim::Placement {
        profile: "p0".into(),
        faction: FactionId::Frost,
        bot: true,
        at: Vec2::new(BOT_AT.0, BOT_AT.1),
        hp: None,
        weapon0: None,
        weapon1: None,
    }];
    for wish in [FrostWish::Freeze, FrostWish::Wall] {
        let sim = Sim::reset_active(
            SimConfig {
                frost_wish: wish,
                ..SimConfig::default()
            },
            arena.clone(),
            Secrets::from_seed(1),
            &placements,
        );
        let id = sim.players()[0].id;
        assert_eq!(MatchStart::of(&sim, id, 3).frost_wish, wish);
    }
}

// -------------------------------------------------------------------------------- both stacks as seats in a real sim

fn seed1_arena() -> Arena {
    let file: rh_sim::mapdata::MapExport = serde_json::from_str(include_str!(
        "../../../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .expect("seed1 map");
    file.validate().unwrap().into_arena().unwrap()
}

/// The first open floor patch of the map, row-major: 16 tiles wide and 9 tall, so a chaser can walk 300 u at the bot
/// along a row and a 7-tile wall fits square across it.
fn open_patch(map: &TileMap) -> Vec2 {
    let (w, h) = map.world_size();
    let (tw, th) = ((w / 32.) as i64, (h / 32.) as i64);
    for ty in 4..th - 5 {
        for tx in 1..tw - 17 {
            if (tx..tx + 16).all(|x| (ty - 4..=ty + 4).all(|y| map.is_floor(x, y))) {
                return Vec2::new(
                    rh_sim::map::tile_to_world_center(tx),
                    rh_sim::map::tile_to_world_center(ty),
                );
            }
        }
    }
    panic!("the map has an open patch")
}

/// A Wish cast the Frost seat proposed: its unit target, its aim, where the Frost seat and the enemy stood, and whether
/// the sim started a cast on that tick (the command went through `validate` + `submit`).
#[derive(Debug, Clone, Copy)]
struct SeenCast {
    target: Option<PlayerId>,
    aim: Vec2,
    frost: Vec2,
    enemy: Vec2,
    started: bool,
}

/// A Frost seat of `kind` and an enemy driven by hand that walks at it from 300 u, in a source-arena world whose Frost
/// Wish is `wish`; the Frost seat's Wish casts over 300 ticks (15 s).
fn seated(kind: &str, wish: FrostWish) -> Vec<SeenCast> {
    let arena = seed1_arena();
    let at = open_patch(&arena.map);
    let config = SimConfig {
        abilities: rh_sim::abilities::Mode::Full,
        lifecycle: rh_sim::ArenaMode::Source(rh_sim::ArenaRules {
            plan_seconds: 0.,
            ..Default::default()
        }),
        wish_lock_ms: 0.,
        frost_wish: wish,
        ..SimConfig::default()
    };
    let placements: Vec<rh_sim::Placement> = [
        (FactionId::Frost, at),
        (FactionId::Fire, Vec2::new(at.x + 300., at.y)),
    ]
    .into_iter()
    .enumerate()
    .map(|(i, (faction, at))| rh_sim::Placement {
        profile: format!("p{i}"),
        faction,
        bot: true,
        at,
        hp: None,
        weapon0: None,
        weapon1: None,
    })
    .collect();
    let mut sim = Sim::reset_active(
        config.clone(),
        arena.clone(),
        Secrets::from_seed(5),
        &placements,
    );
    let frost = sim.players()[0].id;
    let enemy = sim.players()[1].id;
    let policy: Box<dyn Policy> = match kind {
        "human" => Box::new(HumanBot::new(TierId::Hard, PersonaId::Hunter)),
        _ => Box::new(BrainBot::new(
            TierId::Hard,
            PersonaId::Hunter,
            brain_features(&config, &arena),
        )),
    };
    let mut seats = vec![Seat::new(
        &MatchStart::of(&sim, frost, 21),
        policy,
        Box::new(scripted::Idle),
    )];
    seats[0].bind_fx(&sim).unwrap();
    let mut events = Vec::new();
    let mut out = Vec::new();
    for tick in 0..300u32 {
        drive_seats(&mut sim, &mut seats, &events);
        let f = sim.player(frost).expect("frost").pos();
        // What the seat proposed this tick (its own validated command buffer), where both stood when it did.
        for c in &seats[0].cmds {
            if let PublicCommand::Cast {
                slot: rh_sim::abilities::Slot::Wish,
                x,
                y,
                id,
                ..
            } = c
            {
                eprintln!("tick {tick}: the Frost seat casts at ({x}, {y}), unit {id:?}");
                out.push(SeenCast {
                    target: *id,
                    aim: Vec2::new(*x, *y),
                    frost: f,
                    enemy: sim.player(enemy).expect("enemy").pos(),
                    started: false,
                });
            }
        }
        if let Ok(cmd) = rh_sim::validate(RawCommand::Move {
            x: f.x,
            y: f.y,
            seq: None,
        }) {
            let _ = sim.submit(enemy, cmd);
        }
        events.clear();
        sim.step_into(&mut events);
        let started = events
            .iter()
            .any(|e| matches!(e, Event::CastStarted { id, .. } if *id == frost));
        if started {
            if let Some(last) = out.last_mut() {
                last.started = true;
            }
        }
    }
    assert_eq!(seats[0].fault, None, "{kind}: the seat never faults");
    out
}

/// The cast is a wall dropped between the Frost seat and the enemy walking at it: a ground cast, its aim near the line
/// from the seat to the enemy (within a scatter), on the seat's side of the enemy or just past it (the enemy kept walking
/// during the bot's reaction time), at most 70% of the peel window's far end (plus a scatter) from the seat.
fn assert_peel_wall(kind: &str, casts: &[SeenCast]) {
    let c = *casts
        .first()
        .unwrap_or_else(|| panic!("{kind}: the Frost seat casts its Wish at the chaser"));
    assert_eq!(c.target, None, "{kind}: a wall, not a unit cast: {c:?}");
    assert!(c.started, "{kind}: the sim starts the cast: {c:?}");
    let (dx, dy) = (c.enemy.x - c.frost.x, c.enemy.y - c.frost.y);
    let len2 = dx * dx + dy * dy;
    let (ax, ay) = (c.aim.x - c.frost.x, c.aim.y - c.frost.y);
    let t = (ax * dx + ay * dy) / len2;
    let off = (ax * dy - ay * dx).abs() / len2.sqrt();
    let reach = (ax * ax + ay * ay).sqrt();
    assert!(
        t > 0. && t < 1.5,
        "{kind}: the aim lies toward the enemy (t = {t}): {c:?}"
    );
    assert!(
        off <= 48.,
        "{kind}: the aim is on the line to the enemy ({off} off): {c:?}"
    );
    assert!(
        reach <= 0.7 * 260. + 48.,
        "{kind}: inside 70% of the window ({reach}): {c:?}"
    );
}

#[test]
fn frost_wall_a_humanbot_seat_walls_a_chaser_in_a_wall_room() {
    assert_peel_wall("HumanBot", &seated("human", FrostWish::Wall));
}

#[test]
fn frost_wall_a_brain_seat_walls_a_chaser_in_a_wall_room() {
    assert_peel_wall("Brain", &seated("brain", FrostWish::Wall));
}

#[test]
fn guard_frost_wall_both_seats_freeze_the_chaser_in_a_freeze_room() {
    for kind in ["human", "brain"] {
        let casts = seated(kind, FrostWish::Freeze);
        let c = casts
            .first()
            .unwrap_or_else(|| panic!("{kind}: the Frost seat casts Freeze at the chaser"));
        assert!(c.target.is_some(), "{kind}: Freeze is a unit cast: {c:?}");
        assert!(c.started, "{kind}: the sim starts the cast: {c:?}");
    }
}
