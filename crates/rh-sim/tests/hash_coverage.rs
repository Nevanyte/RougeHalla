//! State identity by construction (docs/CONTRACTS.md C-DET): the state hash is derived from the serialized state, so every
//! serialized leaf must change it. This test proves that on real matches instead of trusting a field list: it serializes a
//! checkpoint, perturbs every leaf one at a time (numbers one ulp or one unit, bools flipped, strings changed, sequences
//! shortened, optional values removed or filled), restores the perturbed checkpoint and demands a different `state_hash`.
//! The allowlist of unhashed leaves is EMPTY, with one deliberate exclusion that is asserted rather than skipped: only the
//! statics secrets (`statics.secrets`) are held out of the hash. `World.spawn_rng` (derived from `spawn_seed`) is hashed
//! on purpose, so the hash itself is server-private (see ADR 0007).
//!
//! A perturbation the restore refuses (a map whose shape no longer fits, a middle id that collides in the ordered store)
//! is validated input, not an unhashed leaf; each such pattern must be in `VALIDATED`.

use rh_sim::arenas::practice_arena;
use rh_sim::{
    validate, Command, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
};

/// A command through the one door in (C-INPUT): these tests only use valid ones.
fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid test command")
}
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

fn crowded_8() -> Sim {
    let factions = [
        FactionId::Holy,
        FactionId::Fire,
        FactionId::Frost,
        FactionId::Holy,
        FactionId::Fire,
        FactionId::Frost,
        FactionId::Holy,
        FactionId::Fire,
    ];
    let ps: Vec<Placement> = factions
        .iter()
        .enumerate()
        .map(|(i, &faction)| Placement {
            profile: format!("p{i}"),
            faction,
            bot: i % 3 == 2,
            at: Vec2::new(400.0 + 28.0 * (i % 4) as f64, 400.0 + 28.0 * (i / 4) as f64),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(9),
        &ps,
    )
}

fn drive(sim: &mut Sim, ticks: u32) {
    for t in 0..ticks {
        for i in 1..=8u32 {
            let a = (t as f64 * 0.05) + i as f64;
            let _ = sim.submit(PlayerId(i), cmd(RawCommand::Aim { a }));
            if t % 7 == 0 {
                let _ = sim.submit(PlayerId(i), cmd(RawCommand::Attack { a, t: None }));
            }
            if t % 7 == 3 {
                let _ = sim.submit(PlayerId(i), cmd(RawCommand::Release { a, t: None }));
            }
            if t % 11 == 5 {
                let _ = sim.submit(
                    PlayerId(i),
                    cmd(RawCommand::Move {
                        x: 300.0 + 40.0 * i as f64,
                        y: 500.0,
                        seq: Some((t % 200) as u8),
                    }),
                );
            }
        }
        sim.step();
    }
}

/// A lobby with named joiners, mid-lobby (a different phase and a roster of join names).
fn lobby_with_names() -> Sim {
    let mut s = Sim::new(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(21),
    );
    for (name, f) in [
        ("Ann", FactionId::Holy),
        ("Bo", FactionId::Fire),
        ("Cyrus The Long Named One", FactionId::Frost),
    ] {
        s.add_player(name, Some(f), false).unwrap();
    }
    s.add_player("bot-1", None, true).unwrap();
    for _ in 0..3 {
        s.step();
    }
    s
}

/// A leaver whose result waits between steps (`pending_events`), and a dropped connection.
fn lobby_after_leave() -> Sim {
    let mut s = lobby_with_names();
    s.mark_dropped(PlayerId(2), true);
    s.remove_player(PlayerId(3));
    s
}

/// Everyone nearly dead and in reach of a neighbour: kills, a winner and a finished run within the drive.
fn short_fuse() -> Sim {
    let ps: Vec<Placement> = (0..8)
        .map(|i| Placement {
            profile: format!("f{i}"),
            faction: [FactionId::Holy, FactionId::Fire, FactionId::Frost][i % 3],
            bot: i % 4 == 3,
            at: Vec2::new(400.0 + 20.0 * (i % 4) as f64, 400.0 + 20.0 * (i / 4) as f64),
            hp: Some(3.0),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(31),
        &ps,
    )
}

/// Commands accepted but not yet stepped: the input queues hold contents at hash time.
fn with_queued_inputs() -> Sim {
    let mut s = crowded_8();
    drive(&mut s, 25);
    for i in 1..=4u32 {
        let _ = s.submit(
            PlayerId(i),
            cmd(RawCommand::Move {
                x: 500.0 + i as f64,
                y: 450.0,
                seq: Some(i as u8),
            }),
        );
        let _ = s.submit(PlayerId(i), cmd(RawCommand::Aim { a: 0.25 * i as f64 }));
        let _ = s.submit(
            PlayerId(i),
            cmd(RawCommand::Attack {
                a: 0.5,
                t: Some(1.0),
            }),
        );
    }
    s
}

fn item_fight() -> Sim {
    let ps = (0..3)
        .map(|i| Placement {
            profile: format!("fighter{i}"),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(400.0 + 32.0 * i as f64, 400.0),
            hp: None,
            weapon0: Some(rh_sim::WeaponId::Axe),
            weapon1: Some(rh_sim::WeaponId::Shield),
        })
        .collect::<Vec<_>>();
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(2),
        &ps,
    );
    sim.seed_weapon_container(
        rh_sim::ContainerKind::Chest,
        ps[0].at,
        &[rh_sim::WeaponId::Wand, rh_sim::WeaponId::Bow],
    )
    .unwrap();
    sim.submit(PlayerId(1), cmd(RawCommand::Attack { a: 0.0, t: None }))
        .unwrap();
    sim.step();
    sim.submit(PlayerId(1), cmd(RawCommand::Swap { slot: Some(1) }))
        .unwrap();
    sim.submit(PlayerId(1), cmd(RawCommand::Pickup { container_id: 1 }))
        .unwrap();
    sim
}

fn locked_attack() -> Sim {
    let p = Placement {
        profile: "wand".into(),
        faction: FactionId::Holy,
        bot: false,
        at: Vec2::new(100., 272.),
        hp: None,
        weapon0: Some(rh_sim::WeaponId::Wand),
        weapon1: None,
    };
    let rival = Placement {
        profile: "rival".into(),
        at: Vec2::new(700., 272.),
        ..p.clone()
    };
    let distant = Placement {
        profile: "distant".into(),
        at: Vec2::new(1280., 272.),
        ..rival.clone()
    };
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(5),
        &[p, rival, distant],
    );
    sim.submit(
        PlayerId(1),
        cmd(RawCommand::AttackMove {
            x: 640.,
            y: 272.,
            seq: Some(5),
        }),
    )
    .unwrap();
    sim.step();
    assert_eq!(
        sim.player(PlayerId(1))
            .unwrap()
            .weapon
            .action
            .unwrap()
            .target,
        Some(PlayerId(2))
    );
    assert!(sim
        .player(PlayerId(1))
        .unwrap()
        .weapon
        .targeting
        .goal
        .is_some());
    sim
}

fn holy_engaged() -> Sim {
    let ps: Vec<_> = (0..3)
        .map(|i| Placement {
            profile: format!("h{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400.0 + 28.0 * i as f64, 320.0),
            hp: Some(500.0),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig {
            faction_mode: rh_sim::FactionMode::EngagementHoly,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(9),
        &ps,
    );
    for i in 1..=2 {
        sim.submit(PlayerId(i), cmd(RawCommand::Attack { a: 0.0, t: None }))
            .unwrap();
    }
    for _ in 0..4 {
        sim.step();
    }
    assert!(sim.players()[0].signature.engaged);
    sim
}

fn plague_window() -> Sim {
    let mut sim = holy_engaged();
    let mut cp = serde_json::to_value(&sim).unwrap();
    cp["statics"]["config"]["faction_mode"] = serde_json::json!("EngagementHolyPlague");
    cp["world"]["players"][0]["core"]["vitals"]["faction"] = serde_json::json!("Plague");
    sim = Sim::restore(cp).unwrap();
    sim.step();
    assert!(!sim.faction_runtime().dot.is_empty());
    sim
}

fn scenarios() -> Vec<(&'static str, Sim)> {
    let mut mid = crowded_8();
    drive(&mut mid, 40);
    let mut late = crowded_8();
    drive(&mut late, 700);
    let mut fuse = short_fuse();
    drive(&mut fuse, 400);
    vec![
        ("Plague window", plague_window()),
        ("Holy engaged", holy_engaged()),
        ("item fight", item_fight()),
        ("wand attack-move", locked_attack()),
        ("crowded_8 @40", mid),
        ("crowded_8 @700", late),
        ("short fuse @400", fuse),
        ("queued inputs", with_queued_inputs()),
        ("lobby with names", lobby_with_names()),
        ("lobby after a leave", lobby_after_leave()),
    ]
}

/// What a perturbation is: a scalar replaced, an array shortened by its last element, or an optional subtree removed.
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Leaf,
    Len,
    Subtree,
}

struct Item {
    path: Vec<String>,
    kind: Kind,
    value: Value,
}

/// What happened to the perturbations of one or more checkpoints.
#[derive(Default)]
struct Tally {
    leaves: usize,
    changed: usize,
    unhashed: Vec<String>,
    validated: Vec<String>,
    /// Patterns of the null leaves no candidate could fill, and of every leaf that was perturbed.
    null_left: Vec<String>,
    perturbed: Vec<String>,
    secrets_checked: usize,
}

fn path_of(p: &[String]) -> String {
    p.join(".")
}

/// `world.players.3.core.id` -> `world.players.*.core.id`.
fn pattern(p: &str) -> String {
    p.split('.')
        .map(|k| if k.parse::<usize>().is_ok() { "*" } else { k })
        .collect::<Vec<_>>()
        .join(".")
}

fn walk(v: &Value, path: &mut Vec<String>, out: &mut Vec<Item>) {
    fn push(out: &mut Vec<Item>, path: &[String], kind: Kind, value: Value) {
        out.push(Item {
            path: path.to_vec(),
            kind,
            value,
        })
    }
    match v {
        Value::Object(m) => {
            for (k, v) in m {
                path.push(k.clone());
                if v.is_object() || v.is_array() {
                    push(out, path, Kind::Subtree, v.clone());
                }
                walk(v, path, out);
                path.pop();
            }
        }
        Value::Array(a) => {
            if !a.is_empty() {
                path.push("#len".into());
                push(out, path, Kind::Len, Value::from(a.len()));
                path.pop();
            }
            for (i, v) in a.iter().enumerate() {
                path.push(i.to_string());
                if v.is_object() || v.is_array() {
                    push(out, path, Kind::Subtree, v.clone());
                }
                walk(v, path, out);
                path.pop();
            }
        }
        leaf => push(out, path, Kind::Leaf, leaf.clone()),
    }
}

/// Every non-null value of the checkpoints, by path pattern: the `Some` values a `None` leaf can be given.
fn harvest(v: &Value, path: &mut Vec<String>, pool: &mut BTreeMap<String, Vec<Value>>) {
    if !v.is_null() && !path.is_empty() {
        let e = pool.entry(pattern(&path_of(path))).or_default();
        if e.len() < 4 && !e.contains(v) {
            e.push(v.clone());
        }
    }
    match v {
        Value::Object(m) => {
            for (k, x) in m {
                path.push(k.clone());
                harvest(x, path, pool);
                path.pop();
            }
        }
        Value::Array(a) => {
            for (i, x) in a.iter().enumerate() {
                path.push(i.to_string());
                harvest(x, path, pool);
                path.pop();
            }
        }
        _ => {}
    }
}

fn at_mut<'a>(v: &'a mut Value, p: &[String]) -> &'a mut Value {
    let mut cur = v;
    for k in p {
        cur = match cur {
            Value::Object(m) => m.get_mut(k).unwrap(),
            Value::Array(a) => &mut a[k.parse::<usize>().unwrap()],
            _ => unreachable!(),
        };
    }
    cur
}

/// Candidate replacements for a scalar leaf (all tried until the restore accepts one): the natural neighbour first, `null`
/// last (it is accepted only by an optional field: a `Some` becoming `None`).
fn candidates(leaf: &Value, strings: &[String]) -> Vec<Value> {
    let mut v = match leaf {
        Value::Bool(b) => vec![Value::Bool(!b)],
        Value::Number(n) => {
            if n.is_f64() {
                let f = n.as_f64().unwrap();
                [
                    f64::from_bits(f.to_bits() + 1),
                    f64::from_bits(f.to_bits().wrapping_sub(1)),
                ]
                .into_iter()
                .filter(|x| x.is_finite() && x.to_bits() != f.to_bits())
                .map(|x| serde_json::json!(x))
                .collect()
            } else if let Some(u) = n.as_u64() {
                vec![
                    serde_json::json!(u + 1),
                    serde_json::json!(u.saturating_sub(1)),
                ]
            } else {
                let i = n.as_i64().unwrap();
                vec![serde_json::json!(i + 1), serde_json::json!(i - 1)]
            }
        }
        Value::String(s) => {
            // Free text first, then every other string in the checkpoint (a different enum variant).
            let mut v = vec![
                Value::String(format!("{s}x")),
                Value::String(format!("{s}x{s}")),
            ];
            v.extend(
                strings
                    .iter()
                    .filter(|o| *o != s)
                    .map(|o| Value::String(o.clone())),
            );
            v
        }
        _ => vec![],
    };
    v.push(Value::Null);
    v
}

/// Patterns whose perturbation the restore may refuse, and why. Any other refusal fails the test.
const VALIDATED: &[(&str, &str)] = &[
    ("world.deferred.hits.*.execute","execute requires a signature-qualified entry"),
    ("world.deferred.hits.*.sig","signature entries require the explicit Plague producer mode"),
    ("world.factions.dot_since","flush clock is finite and no later than server time; gate-off runtime must be default"),
    ("world.players.*.core.signature.dot_paused_until","pause is finite and bounded by the maximum weapon windup; gate-off state is default"),
    ("world.players.*.core.signature.bits","only Disease/Execute bits exist in the Plague mode"),
    ("world.factions.dot.*.sig","only delayed Disease/Burn signatures are valid; Backlash is instantaneous"),
    ("world.factions.dot.*.by","private source identity belongs to retained roster and differs from victim"),
    ("world.factions.dot.*.victim","private victim identity belongs to retained roster and differs from source"),
    ("statics.config.faction_mode","nondefault signature state requires its partial foundation gate"),
    ("world.players.*.core.signature.target","signature targets name another actor in the roster"),
    ("world.players.*.core.signature.in_reach","reach requires a target and reach timestamp; gate-off state is default"),
    ("world.players.*.core.signature.engaged","engagement requires a target and reach timestamp; gate-off state is default"),
    ("world.players.*.core.signature.reach_at","finite past timestamp only; gate-off state is default"),
    ("world.players.*.core.signature.contact_at","targets require a finite contact timestamp; gate-off state is default"),
    ("world.players.*.core.signature.combat_at","finite past timestamp only; gate-off state is default"),
    ("world.players.*.core.signature.hp_frac","pre-ledger fraction must be finite; gate-off state is default"),

    ("world.players.*.resolved", "a live target lock requires an unresolved standing owner; resolved also changes the hash in unlocked matches"),
    ("world.players.*.status", "a live target lock requires a standing owner; status also changes the hash in unlocked matches"),
    ("world.players.*.core.weapon.weapon0", "a live target lock requires its active slot to hold a wand; carried weapons are separately perturbed in unlocked matches"),
    ("world.players.*.core.weapon.slot", "a live target lock cannot switch its active slot to fists; slot is separately perturbed in unlocked matches"),
    ("world.players.*.core.weapon.action.kind","kind must agree with the held weapon"),
    ("world.players.*.core.weapon.action.weapon","pending weapon must be the held one"),

    ("world.players.*.core.weapon.targeting.seen","a lock must exist to mark prior direct sight"),
    ("world.players.*.core.weapon.targeting.target","the holder must name another joined actor and retain a lock while seen"),

    ("world.players.*.vision.reveals.*.tick","vision samples are at least one refresh interval apart, in tick order"),
    ("world.phase","settled live flights belong only to an active world"),
    ("world.server_time","settled projectile clock equals the world clock"),
    ("world.projectiles.*.launch.kind", "flight kind and catalog speed agree"),
    ("world.projectiles.*.launch.id","run entity ids are allocated, distinct and monotone"),
    ("world.projectiles.*.launch.reflected", "reflected requires a return count and a shield arrow"),
    ("world.projectiles.*.reflections", "return count agrees with the launch"),
    ("world.projectiles.*.halved","only a ball can be intercepted by a sword"),
    ("world.projectiles.*.time","settled projectiles end exactly at the simulation clock"),
    ("world.item_counter", "item identities are bounded by twice the number of allocated containers"),
    ("world.containers.*.items.#len", "weapon item storage has two slots"),
    ("world.containers.*.opened", "only chests can be opened"),
    ("world.containers.*.id", "container ids are unique and cannot exceed the allocated counter"),
    ("world.containers.*.items.*.uid", "item ids must be unique, nonzero and allocated"),
    ("world.players.*.core.weapon.shreds.*.value", "axe stacks use discrete rule values"),
    (
        "statics.arena.map.w",
        "TileMap::new checks w*h == tiles.len()",
    ),
    (
        "statics.arena.map.h",
        "TileMap::new checks w*h == tiles.len()",
    ),
    (
        "statics.arena.map.tiles.#len",
        "TileMap::new checks w*h == tiles.len()",
    ),
    (
        "world.players.*.core.id",
        "a store is strictly ordered by id: a middle id moved by one collides (the last player's id is perturbed)",
    ),
    (
        "world.players.*.credit.last_hit.#len",
        "a tuple (attacker, time) has no shorter form",
    ),
    (
        "world.roster.names.*.*",
        "the roster is strictly ordered by id like the store, and below next_id: a neighbour's id collides",
    ),
    (
        "world.players.*.core.body.history.*.t",
        "samples are at least a tick apart and not after the clock (checkpoint.rs `check_world`)",
    ),
    (
        "world.roster.names.#len",
        "kills, joined and downs are bounded by the roster length (checkpoint.rs `check_world`)",
    ),
    (
        "world.roster.names.*.#len",
        "a roster entry is a (id, name) pair",
    ),
];

/// `Some` values for optional leaves that no scripted match produces between steps (an item slot has no flow in the slice,
/// a swing is finished or cancelled by the step that ends it, a kill announcement is sent within its step).
fn seeds(pat: &str) -> Vec<Value> {
    match pat {
        "world.players.*.core.weapon.weapon0" | "world.players.*.core.weapon.weapon1" => {
            vec![serde_json::json!("Axe"), serde_json::json!("Bow")]
        }
        "world.players.*.core.weapon.action" => vec![serde_json::json!({
            "kind": "Swing", "weapon": "Fists", "started_at": 1.0, "lands_at": 2.0, "a": 0.5,
            "packet": {"raw": 1.0, "phys": 1.0, "magic": 0.0, "true_": 0.0}
        })],
        "world.players.*.core.weapon.targeting.goal" => {
            vec![serde_json::json!({"x":360.0,"y":272.0})]
        }
        "world.players.*.credit.announce" => vec![serde_json::json!([1.0, 1])],
        _ => vec![],
    }
}

fn perturb_all(sim: &Sim, pool: &BTreeMap<String, Vec<Value>>, tally: &mut Tally) {
    let base = serde_json::to_value(sim).unwrap();
    let h0 = sim.state_hash();
    assert_eq!(
        Sim::restore(&base)
            .expect("the checkpoint restores")
            .state_hash(),
        h0,
        "restore is hash-exact"
    );
    let mut items = Vec::new();
    walk(&base, &mut Vec::new(), &mut items);
    let strings: Vec<String> = {
        let mut s: Vec<String> = items
            .iter()
            .filter_map(|i| i.value.as_str().map(str::to_owned))
            .collect();
        // Enum variants that may not appear in the checkpoint (a string leaf is tried as each of them).
        for extra in [
            "Lobby",
            "Active",
            "Ended",
            "Alive",
            "Dead",
            "Mia",
            "Holy",
            "Fire",
            "Frost",
            "Sentenced",
            "Plague",
            "Fists",
            "Sword",
            "Bow",
            "Wand",
            "Shield",
            "Axe",
            "Swing",
            "Cast",
            "Draw",
            "Won",
            "Died",
            "Chest",
            "Ground",
            "Arrow",
            "Ball",
        ] {
            s.push(extra.into());
        }
        s.sort();
        s.dedup();
        s
    };
    for item in &items {
        let (path, leaf) = (&item.path, &item.value);
        if matches!(
            path.first().map(String::as_str),
            Some("format" | "content_hash" | "build")
        ) {
            continue; // the tag and the content/build header are checked by `restore`, not hashed
        }
        let p = path_of(path);
        let pat = pattern(&p);
        if item.kind != Kind::Subtree {
            tally.leaves += 1;
        }
        let secret = p.starts_with("statics.secrets");
        let tries: Vec<Value> = match item.kind {
            Kind::Leaf if pat == "world.players.*.core.weapon.armor_shred" => {
                vec![serde_json::json!(3.0), serde_json::json!(6.0)]
            }
            Kind::Leaf if pat == "world.players.*.core.weapon.shreds.*.value" => {
                vec![serde_json::json!(if leaf == &serde_json::json!(3.0) {
                    6.0
                } else {
                    3.0
                })]
            }
            Kind::Len | Kind::Subtree => vec![Value::Null],
            Kind::Leaf if pat == "world.players.*.bush.pending" && leaf.is_null() => {
                vec![serde_json::json!(
                    sim.tick() as f64 * rh_sim::constants::TICK_MS + 1000.0
                )]
            }
            Kind::Leaf if leaf.is_null() => {
                let mut v = pool.get(&pat).cloned().unwrap_or_default();
                v.extend(seeds(&pat));
                v.extend([serde_json::json!(1), serde_json::json!(1.5)]);
                v
            }
            Kind::Leaf if pat == "world.containers.*.kind" => {
                vec![serde_json::json!({"Body": 1}), serde_json::json!("Chest")]
            }
            Kind::Leaf => candidates(leaf, &strings),
        };
        // `bot_kills` may not exceed `kills` (checkpoint.rs `check_world`) and no scripted match has kills at this moment:
        // perturb it from a base where the fighter has some, and compare against that base's hash.
        let (base, h0) = if pat == "world.players.*.credit.bot_kills" {
            let mut b = base.clone();
            let mut at = path.clone();
            at.pop();
            *at_mut(&mut b, &[&at[..], &["kills".to_string()]].concat()) = 3.into();
            let h = Sim::restore(&b)
                .expect("kills within the roster restore")
                .state_hash();
            (b, h)
        } else {
            (base.clone(), h0)
        };
        let mut result = None;
        for cand in tries {
            if item.kind == Kind::Leaf && cand == *leaf {
                continue;
            }
            let mut v = base.clone();
            match item.kind {
                Kind::Len => {
                    // Shorten the array: drop its last element.
                    let arr = at_mut(&mut v, &path[..path.len() - 1]);
                    arr.as_array_mut().unwrap().pop();
                }
                _ => *at_mut(&mut v, path) = cand,
            }
            if let Ok(s) = Sim::restore(&v) {
                result = Some(s.state_hash());
                break;
            }
        }
        match (item.kind, result) {
            // A subtree is only perturbed where it is optional; a required one legitimately refuses to vanish.
            (Kind::Subtree, None) => {}
            (Kind::Subtree, Some(h)) => {
                assert_ne!(
                    h, h0,
                    "`{p}`: removing an optional subtree must change the hash"
                );
                tally.changed += 1;
                tally.perturbed.push(pat);
            }
            (_, None) if leaf.is_null() => tally.null_left.push(pat),
            (_, None) => {
                assert!(
                    VALIDATED.iter().any(|(v, _)| *v == pat),
                    "`{p}`: every perturbation was refused by the restore and `{pat}` is not a documented validated path"
                );
                tally.validated.push(pat);
            }
            (_, Some(h)) if secret => {
                assert_eq!(
                    h, h0,
                    "`{p}`: the secrets must stay out of the state hash (C-RNG)"
                );
                tally.secrets_checked += 1;
            }
            (_, Some(h)) if h != h0 => {
                tally.changed += 1;
                tally.perturbed.push(pat);
            }
            (_, Some(_)) => tally.unhashed.push(p),
        }
    }
}

fn report(name: &str, t: &Tally) {
    eprintln!(
        "{name}: {} leaves, {} perturbations changed the hash, {} unhashed, {} validated-refused, {} null left, {} secret leaves held out",
        t.leaves,
        t.changed,
        t.unhashed.len(),
        t.validated.len(),
        t.null_left.len(),
        t.secrets_checked
    );
}

fn pool_of(sims: &[(&str, Sim)]) -> BTreeMap<String, Vec<Value>> {
    let mut pool = BTreeMap::new();
    for (_, s) in sims {
        harvest(
            &serde_json::to_value(s).unwrap(),
            &mut Vec::new(),
            &mut pool,
        );
    }
    pool
}

#[test]
fn every_serialized_leaf_of_a_match_changes_the_state_hash() {
    let sims = scenarios();
    let pool = pool_of(&sims);
    let mut all = Tally::default();
    for (name, sim) in &sims {
        let mut t = Tally::default();
        perturb_all(sim, &pool, &mut t);
        report(name, &t);
        all.leaves += t.leaves;
        all.changed += t.changed;
        all.unhashed
            .extend(t.unhashed.iter().map(|p| format!("{name}: {p}")));
        all.null_left.extend(t.null_left);
        all.perturbed.extend(t.perturbed);
    }
    assert!(
        all.leaves > 5000,
        "real matches have many leaves: {}",
        all.leaves
    );
    assert!(
        all.unhashed.is_empty(),
        "serialized leaves the state hash does not see: {:#?}",
        all.unhashed
    );
    // A certified map supplies the optional layers. Exercise that root on its matching
    // collision map; independently perturbing every one of its 25,600 tiles is unnecessary.
    let file: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap();
    let layered = Sim::new(
        SimConfig::default(),
        file.validate().unwrap().into_arena().unwrap(),
        Secrets::from_seed(1),
    );
    let mut cp = serde_json::to_value(&layered).unwrap();
    let path = ["statics", "arena", "map", "layers"].map(String::from);
    let layers = at_mut(&mut cp, &path);
    assert!(layers.is_object());
    *layers = Value::Null;
    assert_ne!(
        Sim::restore(&cp).unwrap().state_hash(),
        layered.state_hash()
    );
    all.perturbed.push(path_of(&path));
    // An optional leaf that is `None` in a scenario must be perturbed as a `Some` in at least one scenario.
    let perturbed: BTreeSet<&String> = all.perturbed.iter().collect();
    let never: BTreeSet<&String> = all
        .null_left
        .iter()
        .filter(|p| !perturbed.contains(p))
        .collect();
    assert!(
        never.is_empty(),
        "optional leaves no scenario ever perturbed (extend a scenario so they are Some): {never:#?}"
    );
    eprintln!(
        "TOTAL: {} leaves, {} perturbations changed the hash, {} unhashed",
        all.leaves,
        all.changed,
        all.unhashed.len()
    );
}

/// The checkpoint of a sim with a hit queued for the next tick (`world.deferred`), written as JSON because the queue has
/// no producer in the slice yet. Its leaves are perturbed like any other.
#[test]
fn a_deferred_queue_and_every_roster_name_are_hashed() {
    let mut sim = crowded_8();
    drive(&mut sim, 10);
    let mut cp = serde_json::to_value(&sim).unwrap();
    cp["world"]["deferred"]["hits"] = serde_json::json!([{
        "victim": 2, "by": 1,
        "sig": null,"execute": false,
            "packet": {"raw": 5.0, "phys": 4.0, "magic": 1.0, "true_": 0.0},
        "weapon": "Fists", "stagger": true, "scale": 1.0, "derived":false, "projectile":null
    }]);
    let queued = Sim::restore(&cp).expect("a checkpoint with a queued hit restores");
    assert_ne!(
        queued.state_hash(),
        sim.state_hash(),
        "a queued hit is state"
    );
    let mut t = Tally::default();
    perturb_all(&queued, &BTreeMap::new(), &mut t);
    report("queued hit", &t);
    assert!(t.unhashed.is_empty(), "{:?}", t.unhashed);
    assert!(
        t.changed > 0
            && t.validated
                .iter()
                .filter(|p| p.contains("deferred"))
                .all(|p| p.ends_with("execute") || p.ends_with("sig")),
        "the queued hit's own leaves were perturbed and hashed"
    );
    // The new optional signature and execute qualification are independently hash-covered
    // on a valid qualified queue; the Off queue above must refuse them.
    cp["statics"]["config"]["faction_mode"] = serde_json::json!("EngagementHolyPlague");
    cp["world"]["deferred"]["hits"][0]["sig"] = serde_json::json!("Disease");
    cp["world"]["deferred"]["hits"][0]["execute"] = serde_json::json!(false);
    let qualified = Sim::restore(&cp).unwrap();
    let mut q = Tally::default();
    perturb_all(&qualified, &BTreeMap::new(), &mut q);
    assert!(q.unhashed.is_empty());
    assert!(q.perturbed.iter().any(|p| p == "world.deferred.hits.*.sig"));
    assert!(q
        .perturbed
        .iter()
        .any(|p| p == "world.deferred.hits.*.execute"));
    // The roster (the join names) is deliberately covered: a name is outcome (killed_by, the winner).
    let mut renamed = serde_json::to_value(&sim).unwrap();
    renamed["world"]["roster"]["names"][0][1] = "someone else".into();
    assert_ne!(
        Sim::restore(&renamed).unwrap().state_hash(),
        sim.state_hash(),
        "a roster name is hashed"
    );
}

#[test]
fn in_flight_projectile_leaves_are_hashed_or_validated() {
    for weapon in [rh_sim::WeaponId::Bow, rh_sim::WeaponId::Wand] {
        let p = Placement {
            profile: "shooter".into(),
            faction: FactionId::Holy,
            at: Vec2::new(100., 272.),
            hp: None,
            weapon0: Some(weapon),
            weapon1: None,
            bot: false,
        };
        let target = Placement {
            profile: "target".into(),
            at: Vec2::new(980., 272.),
            ..p.clone()
        };
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(3),
            &[
                p,
                target.clone(),
                Placement {
                    profile: "third".into(),
                    ..target.clone()
                },
                Placement {
                    profile: "fourth".into(),
                    ..target
                },
            ],
        );
        sim.submit(PlayerId(1), cmd(RawCommand::Attack { a: 0., t: None }))
            .unwrap();
        while !sim
            .step()
            .iter()
            .any(|e| matches!(e, rh_sim::Event::ProjectileLaunched(_)))
        {}
        sim.step();
        let mut tally = Tally::default();
        perturb_all(&sim, &BTreeMap::new(), &mut tally);
        report("in flight", &tally);
        assert!(tally.unhashed.is_empty(), "{:?}", tally.unhashed);
        assert!(tally
            .perturbed
            .iter()
            .any(|p| p == "world.projectiles.*.packet.raw"));
        assert!(tally
            .perturbed
            .iter()
            .any(|p| p == "world.projectiles.*.launch.origin.x"));
    }
}

#[test]
fn the_layout_check_accepts_real_matches() {
    for sim in [
        {
            let mut s = crowded_8();
            drive(&mut s, 300);
            s
        },
        lobby_after_leave(),
    ] {
        assert_eq!(
            sim.check_layout(),
            Ok(()),
            "no non-finite float, skipped or flattened field anywhere in a checkpoint"
        );
    }
}

/// A `#[serde(skip)]` field is outside the checkpoint AND the hash (by construction it cannot be in one and not the
/// other), so every one is a decision. This pins the complete list; adding one means editing it here, with its reason.
#[test]
fn the_serde_skips_are_exactly_the_documented_ones() {
    let documented: &[(&str, usize, &str)] = &[
        (
            "map.rs",
            3,
            "TileMap: derived tables (components, A* step mask, padded tile grid), rebuilt by TileMap::new while decoding",
        ),
        (
            "state.rs",
            2,
            "World: the same-tick payout queue (empty at every step boundary) and the schedule trace (tests only)",
        ),
        (
            "statics.rs",
            1,
            "MatchStatic: the digest, derived from the stored fields while decoding",
        ),
    ];
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut found: BTreeMap<String, usize> = BTreeMap::new();
    let mut stack = vec![dir.clone()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "rs") {
                let n = std::fs::read_to_string(&p)
                    .unwrap()
                    .lines()
                    .filter(|l| is_serde_skip(l))
                    .count();
                if n > 0 {
                    found.insert(p.strip_prefix(&dir).unwrap().display().to_string(), n);
                }
            }
        }
    }
    let want: BTreeMap<String, usize> = documented
        .iter()
        .map(|(f, n, _)| (f.to_string(), *n))
        .collect();
    assert_eq!(
        found, want,
        "a `#[serde(skip...)]` was added or removed: it is outside the checkpoint and the state hash; document it here"
    );
}

/// A serde attribute line that skips a field in any spelling (`skip`, `skip, default`, `skip_serializing`, ...), but not
/// `skip_serializing_if` (refused separately by `Sim::check_layout`).
fn is_serde_skip(line: &str) -> bool {
    let t = line.trim_start();
    if !t.starts_with("#[serde(") {
        return false;
    }
    let body = t.split(")]").next().unwrap_or(t);
    body.split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .any(|w| w == "skip" || w == "skip_serializing" || w == "skip_deserializing")
}
