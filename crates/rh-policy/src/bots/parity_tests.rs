//! Captured actual-source comparison for the human-likeness core: the tier/persona tables, the view constants, the map
//! solidity the click scatter tests, the seeded distributions, the click model and the humanizer's timed commands, against
//! parity/policy/bot-core.json (captured from the unmodified legacy brain in the pinned linux/amd64 Node 22.23.4 container
//! by tools/bot-fixtures/capture.mts).
//!
//! The hand and the cadence must reproduce the source exactly (reaction/step/timed delays, click scatter and picker
//! results, channel arbitration, the APM bucket, dedupe/re-send, misses and the stats counters). Floats are compared with a
//! 1e-9 relative tolerance: the source draws its normals with the platform Math.log, the port with a Newton ln over the
//! forked libm exp, so the streams can differ in the last ulp; every discrete decision and every command type/id is exact.
use crate::bots::clicks::{
    clamp_to_window, edge_toward, ground_click, ground_sigma, in_window, lock_candidates,
    lock_click, move_click, pick_target, BotMap, MoveClickKind, TargetCandidate,
};
use crate::bots::humanizer::{Context, Humanizer};
use crate::bots::random::{
    chance, ex_gaussian, exponential, gaussian, pick_option, softmax_index, uniform, Rng,
};
use crate::bots::types::*;
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../parity/policy/bot-core.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the captured bot-core corpus parses")
}

// ---------------------------------------------------------------------------------------------------- json helpers
fn arr(v: &Value) -> &Vec<Value> {
    v.as_array().expect("array")
}
fn opt<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    v.get(key)
}
fn obj<'a>(v: &'a Value, key: &str) -> &'a Value {
    v.get(key).unwrap_or_else(|| panic!("missing key {key}"))
}
fn num(v: &Value) -> f64 {
    v.as_f64().expect("number")
}
fn int(v: &Value) -> i64 {
    v.as_i64().expect("integer")
}
fn text(v: &Value) -> &str {
    v.as_str().expect("string")
}
fn opt_text(v: &Value) -> Option<String> {
    if v.is_null() {
        None
    } else {
        Some(text(v).to_string())
    }
}
fn close(a: f64, b: f64, label: &str) {
    assert!(
        (a - b).abs() <= 1e-9 * b.abs().max(1.),
        "{label}: port {a} source {b}"
    );
}
fn point(v: &Value) -> rh_sim::Vec2 {
    rh_sim::Vec2::new(num(obj(v, "x")), num(obj(v, "y")))
}

// ------------------------------------------------------------------------------------------------- source tables
fn ex(v: &Value) -> ExGaussian {
    ExGaussian {
        mu: num(obj(v, "mu")),
        sigma: num(obj(v, "sigma")),
        tau: num(obj(v, "tau")),
        floor: num(obj(v, "floor")),
        cap: num(obj(v, "cap")),
    }
}
fn cadence(v: &Value) -> Cadence {
    Cadence {
        mean: num(obj(v, "mean")),
        jitter: num(obj(v, "jitter")),
    }
}
fn parse_tier(v: &Value) -> TierParams {
    TierParams {
        id: TierId::parse(text(obj(v, "id"))).expect("tier id"),
        reaction: ex(obj(v, "reaction")),
        step: ex(obj(v, "step")),
        daze: ex(obj(v, "daze")),
        refractory_ms: num(obj(v, "refractoryMs")),
        think_ms: cadence(obj(v, "thinkMs")),
        strategy_ms: cadence(obj(v, "strategyMs")),
        apm: num(obj(v, "apm")),
        burst: num(obj(v, "burst")),
        min_gap_ms: num(obj(v, "minGapMs")),
        move_scatter: MoveScatter {
            base: num(obj(obj(v, "moveScatter"), "base")),
            per_unit: num(obj(obj(v, "moveScatter"), "perUnit")),
        },
        target_scatter: TargetScatter {
            sigma: num(obj(obj(v, "targetScatter"), "sigma")),
            lag_s: num(obj(obj(v, "targetScatter"), "lagS")),
            slip_p: num(obj(obj(v, "targetScatter"), "slipP")),
            slip_mult: num(obj(obj(v, "targetScatter"), "slipMult")),
        },
        minimap_sigma: num(obj(v, "minimapSigma")),
        edge_click_p: num(obj(v, "edgeClickP")),
        timing_sigma_ms: num(obj(v, "timingSigmaMs")),
        hesitation: Hesitation {
            p: num(obj(obj(v, "hesitation"), "p")),
            min_ms: num(obj(obj(v, "hesitation"), "minMs")),
            max_ms: num(obj(obj(v, "hesitation"), "maxMs")),
        },
        softmax_t: num(obj(v, "softmaxT")),
        lapse_p: num(obj(v, "lapseP")),
        dodge_p: num(obj(v, "dodgeP")),
        juke_p: num(obj(v, "jukeP")),
        orbwalk: Orbwalk {
            p: num(obj(obj(v, "orbwalk"), "p")),
            step_u: num(obj(obj(v, "orbwalk"), "stepU")),
            angle_jitter: num(obj(obj(v, "orbwalk"), "angleJitter")),
        },
        knowledge: num(obj(v, "knowledge")),
        mob_share_noise: num(obj(v, "mobShareNoise")),
        route: Route {
            horizon: int(obj(obj(v, "route"), "horizon")) as u32,
            walk_paths: obj(obj(v, "route"), "walkPaths").as_bool().expect("bool"),
            reach: num(obj(obj(v, "route"), "reach")),
        },
        attention: Attention {
            central: num(obj(obj(v, "attention"), "central")),
            periphery_mult: num(obj(obj(v, "attention"), "peripheryMult")),
            engaged_mult: num(obj(obj(v, "attention"), "engagedMult")),
            reconsider_ms: num(obj(obj(v, "attention"), "reconsiderMs")),
        },
        memory_span_ms: num(obj(v, "memorySpanMs")),
        feint_read: num(obj(v, "feintRead")),
        appraisal: Appraisal {
            bias: num(obj(obj(v, "appraisal"), "bias")),
            lead: num(obj(obj(v, "appraisal"), "lead")),
            busy: num(obj(obj(v, "appraisal"), "busy")),
            hue: num(obj(obj(v, "appraisal"), "hue")),
            noise: num(obj(obj(v, "appraisal"), "noise")),
        },
        wary: num(obj(v, "wary")),
        caution: Caution {
            mob_share: num(obj(obj(v, "caution"), "mobShare")),
            elite_share: num(obj(obj(v, "caution"), "eliteShare")),
            start_hp: num(obj(obj(v, "caution"), "startHp")),
        },
    }
}
fn parse_persona(v: &Value) -> PersonaParams {
    PersonaParams {
        id: PersonaId::parse(text(obj(v, "id"))).expect("persona id"),
        pve: num(obj(v, "pve")),
        pvp: num(obj(v, "pvp")),
        loot: num(obj(v, "loot")),
        bounty: num(obj(v, "bounty")),
        third_party: num(obj(v, "thirdParty")),
        engage_edge: num(obj(v, "engageEdge")),
        bounty_caution: num(obj(v, "bountyCaution")),
        flee_hp: num(obj(v, "fleeHp")),
        reengage_hp: num(obj(v, "reengageHp")),
        kite: num(obj(v, "kite")),
        chase_give_up_ms: num(obj(v, "chaseGiveUpMs")),
        mob_kill_goal: num(obj(v, "mobKillGoal")),
        player_threat: num(obj(v, "playerThreat")),
        elite_appetite: num(obj(v, "eliteAppetite")),
        coliseum: num(obj(v, "coliseum")),
        risk: num(obj(v, "risk")),
    }
}

// ------------------------------------------------------------------------------------------------- source percepts
fn parse_percept(v: &Value) -> Percept {
    let me = obj(v, "self");
    let weapons = arr(obj(me, "weapons"));
    let weapon = |v: &Value| opt_text(v).map(|w| BotWeapon::parse(&w).expect("weapon"));
    Percept {
        now: num(obj(v, "now")),
        self_view: SelfView {
            id: text(obj(me, "id")).to_string(),
            x: num(obj(me, "x")),
            y: num(obj(me, "y")),
            facing: num(obj(me, "facing")),
            status: text(obj(me, "status")).to_string(),
            hp: num(obj(me, "hp")),
            max_hp: num(obj(me, "maxHp")),
            weapons: [weapon(&weapons[0]), weapon(&weapons[1])],
            slot: int(obj(me, "slot")) as u8,
            attack_target: opt_text(obj(me, "attackTarget")),
            ready_at: num(obj(me, "readyAt")),
        },
        hud: HudView {
            phase: text(obj(obj(v, "hud"), "phase")).to_string(),
            gates_locked: obj(obj(v, "hud"), "gatesLocked").as_bool().unwrap_or(false),
        },
        fighters: arr(obj(v, "fighters"))
            .iter()
            .map(|f| FighterView {
                id: text(obj(f, "id")).to_string(),
                x: num(obj(f, "x")),
                y: num(obj(f, "y")),
                vx: num(obj(f, "vx")),
                vy: num(obj(f, "vy")),
                status: text(obj(f, "status")).to_string(),
                targetable: obj(f, "targetable").as_bool().unwrap_or(false),
            })
            .collect(),
        mobs: arr(obj(v, "mobs"))
            .iter()
            .map(|m| MobView {
                id: text(obj(m, "id")).to_string(),
                x: num(obj(m, "x")),
                y: num(obj(m, "y")),
                vx: num(obj(m, "vx")),
                vy: num(obj(m, "vy")),
                status: text(obj(m, "status")).to_string(),
                kind: text(obj(m, "kind")).to_string(),
            })
            .collect(),
        containers: arr(obj(v, "containers"))
            .iter()
            .map(|c| ContainerView {
                id: text(obj(c, "id")).to_string(),
                kind: text(obj(c, "kind")).to_string(),
                x: num(obj(c, "x")),
                y: num(obj(c, "y")),
                interactable: obj(c, "interactable").as_bool().unwrap_or(false),
            })
            .collect(),
        extras: PerceptExtras {
            chests: obj(v, "extras")
                .get("chests")
                .filter(|c| !c.is_null())
                .map(|chests| {
                    arr(chests)
                        .iter()
                        .map(|c| RewardChestView {
                            id: text(obj(c, "id")).to_string(),
                            x: num(obj(c, "x")),
                            y: num(obj(c, "y")),
                            expires_at: num(obj(c, "expiresAt")),
                            options: obj(c, "options")
                                .as_array()
                                .map(|opts| opts.iter().map(|o| text(o).to_string()).collect()),
                        })
                        .collect()
                }),
        },
    }
}

fn parse_stimulus(v: &Value) -> Stimulus {
    Stimulus {
        kind: StimulusKind::parse(text(obj(v, "kind"))).expect("stimulus kind"),
        at: num(obj(v, "at")),
        subject: opt_text(obj(v, "subject")),
        central: obj(v, "central").as_bool().expect("central"),
        value: opt(v, "value").and_then(Value::as_f64),
    }
}
fn parse_timing(v: &Value) -> IntentTiming {
    match text(obj(v, "kind")) {
        "react" => IntentTiming::React {
            stimulus: parse_stimulus(obj(v, "stimulus")),
        },
        "step" => IntentTiming::Step {},
        "timed" => IntentTiming::Timed {
            due: num(obj(v, "due")),
        },
        other => panic!("timing {other}"),
    }
}
fn parse_intent(v: &Value) -> Intent {
    let kind = text(obj(v, "kind"));
    let body = match kind {
        "lock" => IntentBody::Lock {
            target: text(obj(v, "target")).to_string(),
            at: point(obj(v, "at")),
        },
        "move" => IntentBody::Move {
            to: point(obj(v, "to")),
        },
        "stop" => IntentBody::Stop {},
        "swap" => IntentBody::Swap {
            slot: int(obj(v, "slot")) as u8,
        },
        "pickup" => IntentBody::Pickup {
            container: text(obj(v, "container")).to_string(),
        },
        "cast" => IntentBody::Cast {
            slot: text(obj(v, "slot")).to_string(),
            x: num(obj(v, "x")),
            y: num(obj(v, "y")),
            target: opt(v, "target").and_then(Value::as_str).map(str::to_string),
            at: opt(v, "at").map(point),
            snap_radius: opt(v, "snapRadius").and_then(Value::as_f64),
        },
        "plan" => IntentBody::Plan {
            msg: PlanMsg {
                spawn: opt(obj(v, "msg"), "spawn")
                    .and_then(Value::as_u64)
                    .map(|s| s as u8),
                boon: opt(obj(v, "msg"), "boon")
                    .and_then(Value::as_u64)
                    .map(|s| s as u8),
                ready: opt(obj(v, "msg"), "ready").and_then(Value::as_bool),
            },
        },
        "choose" => IntentBody::Choose {
            msg: ChooseMsg {
                chest: text(obj(obj(v, "msg"), "chest")).to_string(),
                pick: int(obj(obj(v, "msg"), "pick")) as i8,
                replace: opt(obj(v, "msg"), "replace")
                    .and_then(Value::as_u64)
                    .map(|r| r as u8),
            },
        },
        other => panic!("intent {other}"),
    };
    Intent {
        body,
        priority: int(obj(v, "priority")) as u8,
        timing: parse_timing(obj(v, "timing")),
        why: obj(v, "why").as_str().unwrap_or("").to_string(),
    }
}

// ------------------------------------------------------------------------------------------------------------- tests
#[test]
fn bot_core_tier_and_persona_tables_match_source() {
    let f = fixture();
    let tables = obj(&f, "tables");
    for (i, id) in arr(obj(tables, "tierIds")).iter().enumerate() {
        let want = parse_tier(obj(obj(tables, "tiers"), text(id)));
        assert_eq!(want, TIERS[i], "tier {}", text(id));
    }
    for (i, id) in arr(obj(tables, "personaIds")).iter().enumerate() {
        let want = parse_persona(obj(obj(tables, "personas"), text(id)));
        assert_eq!(want, PERSONAS[i], "persona {}", text(id));
    }
    let view = obj(tables, "botView");
    close(BOT_VIEW_HALF_W, num(obj(view, "halfW")), "BOT_VIEW.halfW");
    close(BOT_VIEW_HALF_H, num(obj(view, "halfH")), "BOT_VIEW.halfH");
    assert_eq!(HP_QUANT, num(obj(tables, "hpQuant")));
    assert_eq!(MINIMAP_QUANT, num(obj(tables, "minimapQuant")));
    assert_eq!(MINIMAP_REFRESH_MS, num(obj(tables, "minimapRefreshMs")));
    assert_eq!(TARGET_SNAP_RADIUS, num(obj(tables, "targetSnapRadius")));
    let rules = obj(tables, "humanizerRules");
    assert_eq!(
        HUMANIZER_RULES.replace_after_ms,
        num(obj(rules, "replaceAfterMs"))
    );
    assert_eq!(HUMANIZER_RULES.starve_ms, num(obj(rules, "starveMs")));
    assert_eq!(
        HUMANIZER_RULES.lock_resend_ms,
        num(obj(rules, "lockResendMs"))
    );
    assert_eq!(HUMANIZER_RULES.repeat_ms, num(obj(rules, "repeatMs")));
    assert_eq!(HUMANIZER_RULES.same_point_u, num(obj(rules, "samePointU")));
    assert_eq!(HUMANIZER_RULES.reading_mult, num(obj(rules, "readingMult")));
    assert_eq!(
        HUMANIZER_RULES.reaction_samples as u64,
        int(obj(rules, "reactionSamples")) as u64
    );
    assert_eq!(
        HUMANIZER_RULES.apm_window_ms,
        num(obj(rules, "apmWindowMs"))
    );
    let priority = obj(tables, "priority");
    assert_eq!(PRIORITY_REFLEX as u64, int(obj(priority, "reflex")) as u64);
    assert_eq!(PRIORITY_COMBAT as u64, int(obj(priority, "combat")) as u64);
    assert_eq!(PRIORITY_GOAL as u64, int(obj(priority, "goal")) as u64);
    assert_eq!(PRIORITY_CHORE as u64, int(obj(priority, "chore")) as u64);
}

fn fixture_map(f: &Value) -> BotMap {
    let m = obj(obj(f, "inputs"), "map");
    let tiles: Vec<u8> = arr(obj(m, "tiles")).iter().map(|t| int(t) as u8).collect();
    BotMap::new(int(obj(m, "w")), int(obj(m, "h")), tiles)
}

#[test]
fn bot_core_map_solidity_matches_source() {
    let f = fixture();
    let map = fixture_map(&f);
    let solid = obj(&f, "solid");
    for p in arr(obj(solid, "points")) {
        let x = num(obj(p, "x"));
        let y = num(obj(p, "y"));
        let want = obj(p, "solid").as_bool().expect("bool");
        assert_eq!(map.is_solid_at(x, y), want, "solid at ({x}, {y})");
    }
}

fn percepts(f: &Value) -> Value {
    obj(obj(f, "inputs"), "percepts").clone()
}
fn named<'a>(list: &'a Value, name: &str) -> &'a Value {
    arr(list)
        .iter()
        .find(|c| text(obj(c, "name")) == name)
        .unwrap_or_else(|| panic!("case {name}"))
}

#[test]
fn bot_core_distributions_match_source() {
    let f = fixture();
    let inputs = obj(&f, "inputs");
    let outputs = obj(&f, "rng");
    for case in arr(obj(inputs, "rngCases")) {
        let name = text(obj(case, "name"));
        let expected = named(outputs, name);
        let draws = arr(obj(expected, "draws"));
        let seed = int(obj(case, "seed")) as u32;
        let mut rng = Rng::new(seed);
        match text(obj(case, "kind")) {
            "uniform" => {
                let lo = num(obj(case, "lo"));
                let hi = num(obj(case, "hi"));
                for (i, want) in draws.iter().enumerate() {
                    close(
                        uniform(&mut rng, lo, hi),
                        num(want),
                        &format!("{name} draw {i}"),
                    );
                }
            }
            "chance" => {
                let p = num(obj(case, "p"));
                for (i, want) in draws.iter().enumerate() {
                    assert_eq!(
                        chance(&mut rng, p),
                        want.as_bool().unwrap(),
                        "{name} draw {i}"
                    );
                }
            }
            "gaussian" => {
                let mu = num(obj(case, "mu"));
                let sigma = num(obj(case, "sigma"));
                for (i, want) in draws.iter().enumerate() {
                    close(
                        gaussian(&mut rng, mu, sigma),
                        num(want),
                        &format!("{name} draw {i}"),
                    );
                }
            }
            "exponential" => {
                let mean = num(obj(case, "mean"));
                for (i, want) in draws.iter().enumerate() {
                    close(
                        exponential(&mut rng, mean),
                        num(want),
                        &format!("{name} draw {i}"),
                    );
                }
            }
            "exGaussian" => {
                let d = ex(obj(case, "ex"));
                for (i, want) in draws.iter().enumerate() {
                    close(
                        ex_gaussian(&mut rng, &d),
                        num(want),
                        &format!("{name} draw {i}"),
                    );
                }
            }
            "softmaxIndex" => {
                let utilities: Vec<f64> = arr(obj(case, "utilities")).iter().map(num).collect();
                let t = num(obj(case, "temperature"));
                for (i, want) in draws.iter().enumerate() {
                    assert_eq!(
                        softmax_index(&mut rng, &utilities, t),
                        int(want) as i32,
                        "{name} draw {i}"
                    );
                }
            }
            "pickOption" => {
                let utilities: Vec<f64> = arr(obj(case, "utilities")).iter().map(num).collect();
                let t = num(obj(case, "temperature"));
                let p = num(obj(case, "lapseP"));
                let lapse_seed = int(obj(case, "lapseSeed")) as u32;
                for (i, want) in draws.iter().enumerate() {
                    let mut lapse = Rng::new(lapse_seed);
                    let (index, lapsed) = pick_option(&mut rng, &mut lapse, &utilities, t, p);
                    assert_eq!(
                        index,
                        int(obj(want, "index")) as i32,
                        "{name} draw {i} index"
                    );
                    assert_eq!(
                        lapsed,
                        obj(want, "lapsed").as_bool().unwrap(),
                        "{name} draw {i} lapsed"
                    );
                }
            }
            other => panic!("rng case {other}"),
        }
    }
}

fn check_point(got: rh_sim::Vec2, want: &Value, label: &str) {
    close(got.x, num(obj(want, "x")), &format!("{label} x"));
    close(got.y, num(obj(want, "y")), &format!("{label} y"));
}

#[test]
fn bot_core_clicks_match_source() {
    let f = fixture();
    let inputs = obj(&f, "inputs");
    let percepts = percepts(&f);
    let map = fixture_map(&f);
    let outputs = obj(&f, "clicks");
    for case in arr(obj(inputs, "clickCases")) {
        let name = text(obj(case, "name"));
        let out = obj(named(outputs, name), "output");
        match text(obj(case, "fn")) {
            "pickTarget" => {
                let cursor = point(obj(case, "cursor"));
                let candidates: Vec<TargetCandidate> = arr(obj(case, "candidates"))
                    .iter()
                    .map(|c| TargetCandidate {
                        id: text(obj(c, "id")).to_string(),
                        x: num(obj(c, "x")),
                        y: num(obj(c, "y")),
                    })
                    .collect();
                let got = pick_target(cursor, &candidates, TARGET_SNAP_RADIUS);
                assert_eq!(got, opt_text(obj(out, "picked")), "{name}");
            }
            "lockCandidates" => {
                let mut p = parse_percept(obj(&percepts, text(obj(case, "percept"))));
                if case.get("gates").and_then(Value::as_bool).unwrap_or(false) {
                    p.hud.gates_locked = true;
                }
                let got = lock_candidates(&p);
                let want = arr(obj(out, "candidates"));
                assert_eq!(got.len(), want.len(), "{name} candidates");
                for (g, w) in got.iter().zip(want) {
                    assert_eq!(g.id, text(obj(w, "id")), "{name} candidate id");
                    close(g.x, num(obj(w, "x")), &format!("{name} candidate x"));
                    close(g.y, num(obj(w, "y")), &format!("{name} candidate y"));
                }
            }
            "inWindow" => {
                let self_at = point(obj(case, "self"));
                for (i, want) in arr(obj(out, "inWindow")).iter().enumerate() {
                    let pt = point(&arr(obj(case, "points"))[i]);
                    assert_eq!(
                        in_window(self_at, pt),
                        want.as_bool().unwrap(),
                        "{name} {i}"
                    );
                }
            }
            "clampToWindow" => {
                let got =
                    clamp_to_window(&map, point(obj(case, "self")), point(obj(case, "point")));
                check_point(got, obj(out, "point"), name);
            }
            "edgeToward" => {
                let got = edge_toward(&map, point(obj(case, "self")), point(obj(case, "to")));
                check_point(got, obj(out, "point"), name);
            }
            "groundSigma" => {
                let tier = TierParams::by_id(TierId::parse(text(obj(case, "tier"))).unwrap());
                let got = ground_sigma(tier, point(obj(case, "self")), point(obj(case, "pt")));
                close(got, num(obj(out, "sigma")), name);
            }
            "groundClick" => {
                let tier = TierParams::by_id(TierId::parse(text(obj(case, "tier"))).unwrap());
                let mut motor = Rng::new(int(obj(case, "seed")) as u32);
                let got = ground_click(
                    &mut motor,
                    tier,
                    &map,
                    point(obj(case, "self")),
                    point(obj(case, "pt")),
                );
                check_point(got, obj(out, "point"), name);
            }
            "moveClick" => {
                let tier = TierParams::by_id(TierId::parse(text(obj(case, "tier"))).unwrap());
                let mut motor = Rng::new(int(obj(case, "seed")) as u32);
                let got = move_click(
                    &mut motor,
                    tier,
                    &map,
                    point(obj(case, "self")),
                    point(obj(case, "to")),
                );
                check_point(got.to, obj(out, "to"), name);
                let kind = match got.kind {
                    MoveClickKind::Ground => "ground",
                    MoveClickKind::Edge => "edge",
                    MoveClickKind::Minimap => "minimap",
                };
                assert_eq!(kind, text(obj(out, "kind")), "{name} kind");
            }
            "lockClick" => {
                let tier = TierParams::by_id(TierId::parse(text(obj(case, "tier"))).unwrap());
                let p = parse_percept(obj(&percepts, text(obj(case, "percept"))));
                let mut motor = Rng::new(int(obj(case, "motorSeed")) as u32);
                let mut lapse = Rng::new(int(obj(case, "lapseSeed")) as u32);
                let target = LockTarget {
                    id: text(obj(obj(case, "target"), "id")).to_string(),
                    at: point(obj(obj(case, "target"), "at")),
                };
                let got = lock_click(
                    &mut motor,
                    &mut lapse,
                    tier,
                    &p,
                    &target,
                    TARGET_SNAP_RADIUS,
                );
                check_point(got.cursor, obj(out, "cursor"), name);
                assert_eq!(got.picked, opt_text(obj(out, "picked")), "{name} picked");
                assert_eq!(
                    got.slipped,
                    obj(out, "slipped").as_bool().unwrap(),
                    "{name} slipped"
                );
            }
            other => panic!("click fn {other}"),
        }
    }
}

fn check_optional_u8(got: Option<u8>, want: &Value, label: &str) {
    match (got, want.as_u64()) {
        (None, None) => {}
        (Some(g), Some(w)) => assert_eq!(g as u64, w, "{label}"),
        (g, w) => panic!("{label}: port {g:?} source {w:?}"),
    }
}

fn check_command(cmd: &Command, e: &Value, label: &str) {
    assert_eq!(
        cmd.command_type().as_str(),
        text(obj(e, "type")),
        "{label} type"
    );
    let msg = obj(e, "msg");
    match cmd {
        Command::Move { x, y } => {
            close(*x, num(obj(msg, "x")), &format!("{label} x"));
            close(*y, num(obj(msg, "y")), &format!("{label} y"));
        }
        Command::Stop {} => {}
        Command::Target { id } => assert_eq!(id, text(obj(msg, "id")), "{label} id"),
        Command::Attack { a } | Command::Release { a } => {
            close(*a, num(obj(msg, "a")), &format!("{label} a"))
        }
        Command::Swap { slot } => {
            assert_eq!(*slot as u64, int(obj(msg, "slot")) as u64, "{label} slot")
        }
        Command::Pickup { container_id } => {
            assert_eq!(
                container_id,
                text(obj(msg, "containerId")),
                "{label} container"
            )
        }
        Command::Cast { slot, x, y, id } => {
            assert_eq!(slot, text(obj(msg, "slot")), "{label} slot");
            close(*x, num(obj(msg, "x")), &format!("{label} x"));
            close(*y, num(obj(msg, "y")), &format!("{label} y"));
            match (id, msg.get("id")) {
                (None, None) => {}
                (Some(g), Some(w)) => assert_eq!(g, text(w), "{label} id"),
                (g, w) => panic!("{label}: port {g:?} source {w:?}"),
            }
        }
        Command::Plan { spawn, boon, ready } => {
            check_optional_u8(
                *spawn,
                &msg.get("spawn").cloned().unwrap_or(Value::Null),
                &format!("{label} spawn"),
            );
            check_optional_u8(
                *boon,
                &msg.get("boon").cloned().unwrap_or(Value::Null),
                &format!("{label} boon"),
            );
            assert_eq!(
                *ready,
                msg.get("ready").and_then(Value::as_bool),
                "{label} ready"
            );
        }
        Command::Choose {
            chest,
            pick,
            replace,
        } => {
            assert_eq!(chest, text(obj(msg, "chest")), "{label} chest");
            assert_eq!(*pick as i64, int(obj(msg, "pick")), "{label} pick");
            check_optional_u8(
                *replace,
                &msg.get("replace").cloned().unwrap_or(Value::Null),
                &format!("{label} replace"),
            );
        }
    }
}

fn check_stimulus(got: &Option<Stimulus>, want: &Value, label: &str) {
    match (got, want.is_null()) {
        (None, true) => {}
        (Some(g), false) => {
            assert_eq!(g.kind.as_str(), text(obj(want, "kind")), "{label} kind");
            close(g.at, num(obj(want, "at")), &format!("{label} at"));
            assert_eq!(g.subject, opt_text(obj(want, "subject")), "{label} subject");
        }
        (g, _) => panic!("{label}: port {g:?} source {want}"),
    }
}

fn check_commands(got: &[TimedCommand], want: &Value, label: &str) {
    let want = arr(want);
    assert_eq!(got.len(), want.len(), "{label} command count: {got:?}");
    for (i, (g, w)) in got.iter().zip(want).enumerate() {
        let label = format!("{label} command {i}");
        close(g.at, num(obj(w, "at")), &format!("{label} at"));
        check_command(&g.cmd, obj(w, "cmd"), &label);
        assert_eq!(g.intent.as_str(), text(obj(w, "intent")), "{label} intent");
        assert_eq!(
            g.priority as u64,
            int(obj(w, "priority")) as u64,
            "{label} priority"
        );
        check_stimulus(&g.stimulus, obj(w, "stimulus"), &label);
    }
}

fn check_stats(stats: &crate::bots::humanizer::HumanizerStats, want: &Value, label: &str) {
    for ty in COMMAND_TYPES {
        let n = want
            .get("commands")
            .and_then(|c| c.get(ty.as_str()))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        assert_eq!(stats.command(ty), n, "{label} commands.{}", ty.as_str());
    }
    let reactions = obj(want, "reactions");
    for (kind, times) in reactions.as_object().expect("reactions object") {
        let k = StimulusKind::parse(kind).expect("reaction kind");
        let got = stats
            .reactions
            .get(&k)
            .unwrap_or_else(|| panic!("{label} reaction {kind}"));
        let want = arr(times);
        assert_eq!(got.len(), want.len(), "{label} reaction {kind} count");
        for (g, w) in got.iter().zip(want) {
            close(*g, num(w), &format!("{label} reaction {kind}"));
        }
    }
    assert_eq!(
        stats.target_clicks,
        int(obj(want, "targetClicks")) as u64,
        "{label} targetClicks"
    );
    assert_eq!(
        stats.click_missed,
        int(obj(want, "clickMissed")) as u64,
        "{label} clickMissed"
    );
    assert_eq!(
        stats.click_wrong,
        int(obj(want, "clickWrong")) as u64,
        "{label} clickWrong"
    );
    assert_eq!(
        stats.hesitations,
        int(obj(want, "hesitations")) as u64,
        "{label} hesitations"
    );
    assert_eq!(
        stats.lapses,
        int(obj(want, "lapses")) as u64,
        "{label} lapses"
    );
    assert_eq!(
        stats.throttled,
        int(obj(want, "throttled")) as u64,
        "{label} throttled"
    );
    assert_eq!(
        stats.superseded,
        int(obj(want, "superseded")) as u64,
        "{label} superseded"
    );
    assert_eq!(
        stats.apm_peak,
        int(obj(want, "apmPeak")) as u64,
        "{label} apmPeak"
    );
}

#[test]
fn bot_core_humanizer_matches_source() {
    let f = fixture();
    let inputs = obj(&f, "inputs");
    let percepts = percepts(&f);
    let map = fixture_map(&f);
    let cases = obj(inputs, "humanizerCases");
    for expected_case in arr(obj(&f, "humanizer")) {
        let name = text(obj(expected_case, "name"));
        let input = named(cases, name);
        let tier = TierParams::by_id(TierId::parse(text(obj(input, "tier"))).unwrap());
        let mut p = parse_percept(obj(&percepts, text(obj(input, "percept"))));
        let mut motor = Rng::new(int(obj(input, "motorSeed")) as u32);
        let mut lapse = Rng::new(int(obj(input, "lapseSeed")) as u32);
        let engaged = obj(input, "engaged").as_bool().unwrap_or(false);
        let frame_start = num(obj(input, "frameStart"));
        let frame_step = num(obj(input, "frameStep"));
        let frame_count = int(obj(input, "frameCount")) as usize;
        let declared = arr(obj(expected_case, "frames"));
        assert_eq!(declared.len(), frame_count, "{name} frame count");
        let mut humanizer = Humanizer::new(tier, map.clone());
        for i in 0..frame_count {
            let now = frame_start + frame_step * i as f64;
            let spec = obj(input, "frames")
                .as_array()
                .and_then(|frames| frames.iter().find(|fr| num(obj(fr, "now")) == now));
            p.now = now;
            if let Some(spec) = spec {
                if let Some(patch) = opt(spec, "patch").and_then(Value::as_object) {
                    if let Some(me) = patch.get("self").and_then(Value::as_object) {
                        if let Some(status) = me.get("status").and_then(Value::as_str) {
                            p.self_view.status = status.to_string();
                        }
                    }
                }
            }
            let intents: Vec<Intent> = spec
                .map(|spec| {
                    opt(spec, "intents")
                        .and_then(Value::as_array)
                        .map(|list| list.iter().map(parse_intent).collect())
                        .unwrap_or_default()
                })
                .unwrap_or_default();
            let released = {
                let mut ctx = Context {
                    p: &p,
                    engaged,
                    motor: &mut motor,
                    lapse: &mut lapse,
                };
                humanizer.submit(&intents, &mut ctx);
                humanizer.release(&mut ctx)
            };
            let misses = humanizer.drain_misses();
            let want = &declared[i];
            assert_eq!(num(obj(want, "now")), now, "{name} frame {i} now");
            check_commands(
                &released,
                obj(want, "commands"),
                &format!("{name} frame {i}"),
            );
            let want_misses = arr(obj(want, "misses"));
            assert_eq!(misses.len(), want_misses.len(), "{name} frame {i} misses");
            for (g, w) in misses.iter().zip(want_misses) {
                assert_eq!(g.target, text(obj(w, "target")), "{name} miss target");
                close(g.at, num(obj(w, "at")), &format!("{name} miss at"));
            }
        }
        check_stats(humanizer.stats(), obj(expected_case, "stats"), name);
    }
}
