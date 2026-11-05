//! Power-zero player Frost. Prior chill belongs to weapons/production; post-ledger chill to the next tick.
use super::{signatures::LandedHit, Cx};
use crate::{
    constants::*,
    fighter::FighterCore,
    hooks::{HookArgs, Hx},
    state::{ActionKind, World},
    FactionId, PlayerId, WeaponId,
};

pub(crate) fn stretch_until(until: f64, now: f64, dt: f64, m: f64) -> f64 {
    let left = until - now;
    if !(left > 0. && m < 1. && m > 0.) {
        return until;
    }
    if left < m * dt {
        now + left / m
    } else {
        until + (1. - m) * dt
    }
}
pub(crate) fn move_multiplier(exposure: f64) -> f64 {
    if exposure <= CHILL_MOVE_HOLD_MS {
        return CHILL_MOVE_MULT;
    }
    let thaw = ((exposure - CHILL_MOVE_HOLD_MS) / CHILL_MOVE_THAW_MS).min(1.);
    CHILL_MOVE_MULT + (1. - CHILL_MOVE_MULT) * thaw
}
pub(crate) fn attack_started(hx: &mut Hx, args: &HookArgs) {
    if !hx.k.config.faction_mode.frost() {
        return;
    }
    let HookArgs::AttackStarted(id) = *args else {
        return;
    };
    let now = hx.w.server_time;
    let Some(i) = hx.w.idx(id) else { return };
    let p = &mut hx.w.players[i];
    if let Some(a) = p
        .weapon
        .action
        .filter(|a| a.kind == ActionKind::Swing && a.lands_at <= now)
    {
        if p.signature.chill < 1. {
            p.weapon.ready_at += (1. - p.signature.chill) * (now - a.started_at).max(0.);
        }
    }
}
pub(crate) fn after_weapons(cx: &mut Cx) {
    let now = cx.w.server_time;
    for (i, p) in cx.w.players.iter_mut().enumerate() {
        if !p.standing() || !cx.s.attack_started[i] || p.signature.chill >= 1. {
            continue;
        }
        if let Some(mut a) = p.weapon.action {
            let back = (1. - p.signature.chill) * (now - a.started_at).max(0.);
            p.weapon.ready_at += back;
            if a.kind == ActionKind::Draw {
                a.started_at += back;
                a.lands_at += back;
                p.weapon.draw_started_at = a.started_at;
            }
            p.weapon.action = Some(a);
        }
    }
}
pub(crate) fn ranged_hits(w: &mut World, hits: &[LandedHit]) {
    for h in hits {
        if h.sig.is_some() || !matches!(h.weapon, Some(WeaponId::Bow | WeaponId::Wand)) {
            continue;
        }
        let Some(by) =
            h.by.and_then(|id| w.player(id))
                .filter(|p| p.standing() && p.vitals.faction == FactionId::Frost)
        else {
            continue;
        };
        let _ = by;
        if let Some(i) = w.idx(h.victim).filter(|&i| w.players[i].standing()) {
            w.players[i].signature.ranged_chill_until = Some(w.server_time + FROST_RANGED_CHILL_MS);
        }
    }
}
fn add(
    sources: &mut [[Option<PlayerId>; MAX_PLAYERS]; MAX_PLAYERS],
    counts: &mut [usize; MAX_PLAYERS],
    victim: usize,
    source: PlayerId,
) {
    if !sources[victim][..counts[victim]].contains(&Some(source)) {
        sources[victim][counts[victim]] = Some(source);
        counts[victim] += 1;
    }
}
fn near(w: &World, p: &FighterCore, id: PlayerId) -> bool {
    w.player(id).is_some_and(|f| {
        f.standing()
            && crate::math::hypot(f.body.x - p.body.x, f.body.y - p.body.y) <= CHILL_MOVE_RADIUS
    })
}
pub(crate) fn after_damage(w: &mut World) {
    let now = w.server_time;
    let mut sources = [[None; MAX_PLAYERS]; MAX_PLAYERS];
    let mut counts = [0; MAX_PLAYERS];
    for (i, p) in w.players.iter().enumerate().filter(|(_, p)| p.standing()) {
        let Some(ti) = p
            .signature
            .target
            .filter(|_| p.signature.engaged)
            .and_then(|id| w.idx(id))
            .filter(|&ti| w.players[ti].standing())
        else {
            continue;
        };
        let t = &w.players[ti];
        if p.vitals.faction == FactionId::Frost && p.id != t.id {
            add(&mut sources, &mut counts, ti, p.id);
        }
        if t.vitals.faction == FactionId::Frost && p.id != t.id {
            add(&mut sources, &mut counts, i, t.id);
        }
    }
    for i in 0..w.players.len() {
        if !w.players[i].standing() {
            continue;
        }
        let near_frost = sources[i][..counts[i]]
            .iter()
            .flatten()
            .any(|&id| near(w, &w.players[i].core, id));
        let p = &mut w.players[i].core;
        let f = &mut p.signature;
        f.chill = if counts[i] > 0 { 1. - FROST_SLOW } else { 1. };
        f.chillers = sources[i];
        f.chiller_count = counts[i] as u8;
        if near_frost {
            if f.exposure_started_at.is_none()
                || f.last_near_at
                    .is_some_and(|t| now - t >= CHILL_MOVE_RESET_MS)
            {
                f.exposure_started_at = Some(now);
            }
            f.last_near_at = Some(now);
        } else if f
            .last_near_at
            .is_some_and(|t| now - t >= CHILL_MOVE_RESET_MS)
        {
            f.exposure_started_at = None;
            f.last_near_at = None;
        }
        let near_mult = if near_frost {
            move_multiplier(now - f.exposure_started_at.expect("near episode"))
        } else {
            1.
        };
        let ranged_mult = if f.ranged_chill_until.is_some_and(|t| now < t) {
            FROST_RANGED_CHILL_MULT
        } else {
            1.
        };
        let raw = near_mult.min(ranged_mult);
        f.frost_move_mult = (raw * FROST_MOVE_QUANTIZATION + 0.5).floor() / FROST_MOVE_QUANTIZATION;
        if f.chill < 1. {
            f.bits |= SIG_CHILLED;
            p.weapon.ready_at = stretch_until(p.weapon.ready_at, now, TICK_MS, f.chill);
            p.weapon.buffered_until = stretch_until(p.weapon.buffered_until, now, TICK_MS, f.chill);
            if let Some(mut a) = p.weapon.action.filter(|a| a.kind == ActionKind::Draw) {
                let lands = stretch_until(a.lands_at, now, TICK_MS, f.chill);
                a.started_at += lands - a.lands_at;
                a.lands_at = lands;
                p.weapon.draw_started_at = a.started_at;
                p.weapon.action = Some(a);
            }
        }
    }
}
pub(crate) fn movement_modifier(w: &World, p: &FighterCore, _dt: f64) -> f64 {
    let f = &p.signature;
    if f.frost_move_mult >= 1. {
        return 1.;
    }
    if f.ranged_chill_until.is_some_and(|t| w.server_time < t)
        || f.chillers[..usize::from(f.chiller_count)]
            .iter()
            .flatten()
            .any(|&id| near(w, p, id))
    {
        f.frost_move_mult
    } else {
        1.
    }
}

/// Check trusted persistent state; departed sources remain valid roster names until recomputation.
pub(crate) fn validate_signature(
    enabled: bool,
    w: &World,
    id: PlayerId,
    f: &crate::fighter::Signature,
) -> Result<(), String> {
    let count = usize::from(f.chiller_count);
    let identity = f.chill == 1.
        && count == 0
        && f.chillers.iter().all(Option::is_none)
        && f.exposure_started_at.is_none()
        && f.last_near_at.is_none()
        && f.ranged_chill_until.is_none()
        && f.frost_move_mult == 1.
        && f.bits & SIG_CHILLED == 0;
    let valid_time = |t: f64| (0. ..=w.server_time).contains(&t);
    if (!enabled && !identity)
        || count > MAX_PLAYERS
        || !(f.chill == 1. || f.chill == 1. - FROST_SLOW)
        || !f.frost_move_mult.is_finite()
        || !(CHILL_MOVE_MULT..=1.).contains(&f.frost_move_mult)
        || (f.frost_move_mult * FROST_MOVE_QUANTIZATION).round() / FROST_MOVE_QUANTIZATION
            != f.frost_move_mult
        || f.exposure_started_at.is_some() != f.last_near_at.is_some()
        || [f.exposure_started_at, f.last_near_at]
            .into_iter()
            .flatten()
            .any(|t| !valid_time(t))
        || f.exposure_started_at
            .zip(f.last_near_at)
            .is_some_and(|(a, b)| a > b)
        || f.ranged_chill_until
            .is_some_and(|t| !(0. ..=w.server_time + FROST_RANGED_CHILL_MS).contains(&t))
    {
        return Err(format!("invalid Frost state for player {}", id.0));
    }
    for (i, source) in f.chillers.iter().enumerate() {
        if i < count {
            let Some(source) = source else {
                return Err("missing Frost source".into());
            };
            if *source == id
                || w.roster.name(*source).is_none()
                || f.chillers[..i].contains(&Some(*source))
            {
                return Err("invalid Frost source".into());
            }
        } else if source.is_some() {
            return Err("noncanonical Frost sources".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{arenas::practice_arena, Placement, Secrets, Sim, SimConfig, Vec2};
    use serde_json::{json, Value};
    fn scene() -> Sim {
        Sim::reset_active(
            SimConfig {
                faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrost,
                ..Default::default()
            },
            practice_arena(),
            Secrets::from_seed(12),
            &(0..4)
                .map(|i| Placement {
                    profile: format!("p{i}"),
                    faction: if i == 0 || i == 2 {
                        FactionId::Frost
                    } else {
                        FactionId::Holy
                    },
                    bot: false,
                    at: Vec2::new(400. + if i == 1 { 75. } else { 0. }, 320.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                })
                .collect::<Vec<_>>(),
        )
    }
    fn numbers(v: &mut Value) {
        match v {
            Value::Number(n) => *v = json!(n.as_f64().unwrap()),
            Value::Array(a) => a.iter_mut().for_each(numbers),
            Value::Object(o) => o.values_mut().for_each(numbers),
            _ => {}
        }
    }
    fn keys(v: &Value, expected: &[&str]) {
        let mut actual = v
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        actual.sort();
        let mut expected = expected.to_vec();
        expected.sort();
        assert_eq!(actual, expected);
    }
    #[test]
    fn exact_actual_export_helper_boundaries() {
        let v: Value =
            serde_json::from_str(include_str!("../../../../parity/frost/helpers.json")).unwrap();
        keys(&v, &["format", "provenance", "reset", "stretch", "thaw"]);
        assert_eq!(v["format"], "rh-frost-actual-export-probes/1");
        assert_eq!(v["reset"], CHILL_MOVE_RESET_MS);
        keys(
            &v["provenance"],
            &["node", "platform", "arch", "kind", "exports", "modules"],
        );
        assert_eq!(v["provenance"]["node"], "v22.23.4");
        assert_eq!(v["provenance"]["platform"], "linux");
        assert_eq!(v["provenance"]["arch"], "x64");
        assert_eq!(
            v["provenance"]["kind"],
            "direct actual exported helpers; no ordinary gameplay intake"
        );
        assert_eq!(
            v["provenance"]["exports"],
            json!([
                "packages/server/src/sim/factions.ts::stretchUntil",
                "packages/shared/src/signatures.ts::frostMoveMultiplier"
            ])
        );
        check_modules(&v["provenance"]["modules"]);
        assert_eq!(v["stretch"].as_array().unwrap().len(), 150);
        assert_eq!(v["thaw"].as_array().unwrap().len(), 13);
        for c in v["stretch"].as_array().unwrap() {
            keys(c, &["until", "now", "dt", "m", "result"]);
            let n = |k: &str| c[k].as_f64().unwrap();
            assert_eq!(
                stretch_until(n("until"), n("now"), n("dt"), n("m")),
                n("result"),
                "{c}"
            );
        }
        for c in v["thaw"].as_array().unwrap() {
            keys(c, &["exposure", "result"]);
            assert_eq!(
                move_multiplier(c["exposure"].as_f64().unwrap()),
                c["result"].as_f64().unwrap()
            );
        }
    }
    fn check_modules(v: &Value) {
        assert_eq!(
            *v,
            json!([
                "loot",
                "weapons",
                "targeting",
                "projectiles",
                "factions",
                "mobs",
                "buffs",
                "feed",
                "camps",
                "chests",
                "killAugments",
                "mobLife",
                "mobAI",
                "terrainEffects",
                "regen",
                "abilities",
                "quests",
                "vision",
                "campHeal",
                "traders",
                "cardHooks",
                "mods"
            ])
        );
    }
    #[test]
    fn actual_installed_source_private_runtime_matrix() {
        let v: Value =
            serde_json::from_str(include_str!("../../../../parity/frost/runtime-matrix.json"))
                .unwrap();
        keys(&v, &["format", "modules", "kind", "cases"]);
        assert_eq!(v["format"], "rh-frost-runtime-matrix/1");
        check_modules(&v["modules"]);
        assert_eq!(v["kind"],"trusted private setup; actual installed afterDamage and movement modifier; not gameplay intake");
        assert_eq!(v["cases"].as_array().unwrap().len(), 21);
        for case in v["cases"].as_array().unwrap() {
            keys(case, &["setup", "beforeMove", "liveMove", "result"]);
            let c = &case["setup"];
            let mut s = scene();
            s.w.server_time = 10000.;
            s.w.tick = 200;
            s.w.players[1].body.x = 400. + c["distance"].as_f64().unwrap_or(75.);
            let edges = c.get("edges").cloned().unwrap_or(json!([[0, 1]]));
            for e in edges.as_array().unwrap() {
                let a = e[0].as_u64().unwrap() as usize;
                let b = e[1].as_u64().unwrap() as u32;
                let f = &mut s.w.players[a].signature;
                f.target = Some(PlayerId(b + 1));
                f.engaged = true;
                f.in_reach = true;
                f.contact_at = Some(10000.);
                f.reach_at = Some(10000.);
            }
            let p = &mut s.w.players[1];
            let f = &mut p.signature;
            f.chill = 1. - FROST_SLOW;
            f.chillers[0] = Some(PlayerId(1));
            f.chiller_count = 1;
            f.frost_move_mult = 0.7;
            if let Some(exposure) = c["exposure"].as_f64() {
                f.exposure_started_at = Some(10000. - exposure);
                f.last_near_at = Some(10000. - c["lastAgo"].as_f64().unwrap_or(0.));
            }
            if let Some(left) = c["rangedLeft"].as_f64() {
                f.ranged_chill_until = Some(10000. + left);
            }
            p.weapon.ready_at = 10000. + c["readyLeft"].as_f64().unwrap_or(100.);
            p.weapon.buffered_until = 10000. + c["bufferLeft"].as_f64().unwrap_or(100.);
            if let Some(left) = c["drawLeft"].as_f64() {
                p.weapon.action = Some(crate::state::PendingAction {
                    kind: ActionKind::Draw,
                    weapon: WeaponId::Bow,
                    target: None,
                    started_at: 9000.,
                    lands_at: 10000. + left,
                    a: 0.,
                    packet: crate::state::Packet {
                        raw: 1.,
                        phys: 1.,
                        magic: 0.,
                        true_: 0.,
                    },
                });
                p.weapon.draw_started_at = 9000.;
            }
            assert_eq!(
                movement_modifier(&s.w, &s.w.players[1].core, TICK_MS),
                case["beforeMove"].as_f64().unwrap()
            );
            if let Some(i) = c["depart"].as_u64() {
                s.remove_player(PlayerId(i as u32 + 1));
            }
            if let Some(i) = c["dead"].as_u64() {
                s.w.players[i as usize].status = crate::Status::Dead;
            }
            let i = s.w.idx(PlayerId(2)).unwrap();
            assert_eq!(
                movement_modifier(&s.w, &s.w.players[i].core, TICK_MS),
                case["liveMove"].as_f64().unwrap()
            );
            after_damage(&mut s.w);
            let p = &s.w.players[i];
            let f = &p.signature;
            let mut actual = json!({"chill":f.chill,"chillers":f.chillers[..usize::from(f.chiller_count)].iter().flatten().map(|id|format!("p{}",id.0-1)).collect::<Vec<_>>(),"exposureStartedAt":f.exposure_started_at,"lastNearAt":f.last_near_at,"rangedUntil":f.ranged_chill_until,"move":f.frost_move_mult,"readyAt":p.weapon.ready_at,"bufferedUntil":p.weapon.buffered_until,"drawStartedAt":p.weapon.draw_started_at,"action":p.weapon.action.map(|a|json!({"kind":"draw","startedAt":a.started_at,"landsAt":a.lands_at})),"bits":f.bits});
            let mut expected = case["result"].clone();
            numbers(&mut expected);
            numbers(&mut actual);
            assert_eq!(actual, expected, "{c}");
        }
    }
    #[test]
    fn checkpoint_refuses_each_frost_invariant_and_preserves_departed_ids() {
        let mut s = scene();
        let f = &mut s.w.players[1].signature;
        f.chill = 1. - FROST_SLOW;
        f.chillers[0] = Some(PlayerId(1));
        f.chiller_count = 1;
        f.exposure_started_at = Some(0.);
        f.last_near_at = Some(50.);
        f.ranged_chill_until = Some(1250.);
        f.frost_move_mult = 0.7;
        f.bits = SIG_CHILLED;
        let base = serde_json::to_value(&s).unwrap();
        Sim::restore(base.clone()).unwrap();
        let mutations = [
            ("chill", json!(0.68)),
            ("chiller_count", json!(9)),
            (
                "chillers",
                json!([1, 1, null, null, null, null, null, null]),
            ),
            (
                "chillers",
                json!([2, null, null, null, null, null, null, null]),
            ),
            (
                "chillers",
                json!([999, null, null, null, null, null, null, null]),
            ),
            (
                "chillers",
                json!([null, null, null, null, null, null, null, null]),
            ),
            (
                "chillers",
                json!([1, null, null, null, null, null, null, 3]),
            ),
            ("exposure_started_at", json!(null)),
            ("exposure_started_at", json!(-1)),
            ("exposure_started_at", json!(51)),
            ("last_near_at", json!(51)),
            ("last_near_at", json!(null)),
            ("ranged_chill_until", json!(1300.01)),
            ("ranged_chill_until", json!(-1)),
            ("frost_move_mult", json!(0.699)),
            ("frost_move_mult", json!(1.001)),
            ("frost_move_mult", json!(0.7001)),
        ];
        for (key, value) in mutations {
            let mut cp = base.clone();
            cp["world"]["players"][1]["core"]["signature"][key] = value;
            assert!(Sim::restore(cp).is_err(), "accepted {key}");
        }
        for mode in [
            "Off",
            "EngagementHoly",
            "EngagementHolyPlague",
            "EngagementHolyPlagueFire",
        ] {
            let mut cp = base.clone();
            cp["statics"]["config"]["faction_mode"] = json!(mode);
            assert!(Sim::restore(cp).is_err(), "legacy {mode}");
        }
        s.remove_player(PlayerId(1));
        let mut restored = Sim::restore(serde_json::to_value(&s).unwrap()).unwrap();
        assert_eq!(
            restored.player(PlayerId(2)).unwrap().signature.chillers[0],
            Some(PlayerId(1))
        );
        assert_eq!(
            movement_modifier(
                &restored.w,
                &restored.player(PlayerId(2)).unwrap().core,
                TICK_MS
            ),
            0.7
        );
        // Ranged handoff returns the retained min, then the exact expiry rechecks live sources.
        restored.w.server_time = 1250.;
        assert_eq!(
            movement_modifier(
                &restored.w,
                &restored.player(PlayerId(2)).unwrap().core,
                TICK_MS
            ),
            1.
        );
    }
    #[test]
    fn every_private_frost_leaf_is_hashed_but_never_observed() {
        let mut s = scene();
        let before = crate::observe(&s, PlayerId(2), &[]);
        let public = crate::public_snapshot(&s);
        let baseline = s.state_hash();
        let mut edits = Vec::new();
        let mut f = s.w.players[1].signature;
        f.chill = 1. - FROST_SLOW;
        edits.push(f);
        f = s.w.players[1].signature;
        f.chillers[0] = Some(PlayerId(1));
        edits.push(f);
        f = s.w.players[1].signature;
        f.chiller_count = 1;
        edits.push(f);
        f = s.w.players[1].signature;
        f.exposure_started_at = Some(0.);
        edits.push(f);
        f = s.w.players[1].signature;
        f.last_near_at = Some(50.);
        edits.push(f);
        f = s.w.players[1].signature;
        f.ranged_chill_until = Some(1200.);
        edits.push(f);
        f = s.w.players[1].signature;
        f.frost_move_mult = 0.7;
        edits.push(f);
        for f in edits {
            s.w.players[1].signature = f;
            assert_ne!(s.state_hash(), baseline);
            assert_eq!(crate::observe(&s, PlayerId(2), &[]), before);
            assert_eq!(crate::public_snapshot(&s), public);
        }
        let cp = serde_json::to_value(&s).unwrap().to_string();
        assert!(!cp.contains("attack_started"));
        // A public chilled bit is intentional, while its IDs and episode history stay private.
        s.w.players[1].signature.bits = SIG_CHILLED;
        assert_eq!(
            crate::observe(&s, PlayerId(2), &[]).me.unwrap().sig,
            SIG_CHILLED
        );
    }

    #[test]
    fn ranged_refresh_reads_post_ledger_survivors_and_positive_landed_damage() {
        let v: Value =
            serde_json::from_str(include_str!("../../../../parity/frost/ranged-ledger.json"))
                .unwrap();
        keys(&v, &["format", "modules", "kind", "cases"]);
        assert_eq!(v["format"], "rh-frost-ranged-ledger/1");
        check_modules(&v["modules"]);
        assert_eq!(v["kind"],"trusted direct ledger setup; actual recordHit/applyLedger/installed afterDamage; not gameplay intake");
        assert_eq!(v["cases"].as_array().unwrap().len(), 15);
        for case in v["cases"].as_array().unwrap() {
            keys(case, &["setup", "landed", "until"]);
            let c = &case["setup"];
            let mut s = scene();
            s.w.players[2].vitals.faction = FactionId::Holy;
            s.w.players[2].vitals.max_hp = crate::content::faction(FactionId::Holy).hp;
            s.w.server_time = 100.;
            s.w.tick = 2;
            for i in 0..4 {
                s.w.players[i].body.x = 400. + i as f64 * 200.;
            }
            s.w.players[2].vitals.hp = c["hp"].as_f64().unwrap_or(1000.);
            s.w.players[2].vitals.barrier = c["barrier"].as_f64().unwrap_or(0.);
            s.w.players[2].vitals.immune_until = c["immune"].as_f64().unwrap_or(0.);
            s.w.players[0].vitals.hp = c["shooterHp"].as_f64().unwrap_or(1000.);
            s.w.players[2].signature.ranged_chill_until = c["until"].as_f64();
            if let Some(i) = c["depart"].as_u64() {
                s.remove_player(PlayerId(i as u32 + 1));
            }
            let mut events = Vec::new();
            {
                let mut cx = Cx {
                    k: &s.k,
                    w: &mut s.w,
                    s: &mut s.s,
                    ev: &mut events,
                    pf: &mut s.pf,
                };
                super::super::settle::mark_tick_start(&mut cx);
                super::super::ledger::open(&mut cx);
                cx.s.rank.resize(cx.w.players.len(), 0);
                let mut hit = |victim, by, weapon, raw, sig| {
                    cx.s.ledger.push(super::super::ledger::Entry {
                        victim: PlayerId(victim),
                        by: Some(PlayerId(by)),
                        packet: crate::state::Packet {
                            raw,
                            phys: 1.,
                            magic: 0.,
                            true_: 0.,
                        },
                        weapon: Some(weapon),
                        stagger: false,
                        projectile: None,
                        scale: 1.,
                        derived: false,
                        passive: false,
                        sig,
                        execute: false,
                    })
                };
                hit(
                    3,
                    1,
                    WeaponId::parse(c["weapon"].as_str().unwrap()).unwrap(),
                    c["raw"].as_f64().unwrap_or(1000.),
                    c["sig"]
                        .as_str()
                        .map(|_| crate::factions::SignatureKind::Burn),
                );
                if c["killShooter"] == true {
                    hit(1, 4, WeaponId::Sword, 1000., None);
                }
                if c["killVictim"] == true {
                    hit(3, 4, WeaponId::Sword, 1000., None);
                }
                super::super::ledger::apply(&mut cx);
                ranged_hits(cx.w, &cx.s.landed);
            }
            let actual=json!(s.s.landed.iter().map(|h|json!({"victim":format!("p{}",h.victim.0-1),"by":h.by.map(|id|format!("p{}",id.0-1)),"amount":h.amount,"sig":h.sig.map(|s|s.as_str()),"weapon":h.weapon.map(|w|w.as_str())})).collect::<Vec<_>>());
            let mut expected = case["landed"].clone();
            numbers(&mut expected);
            assert_eq!(actual, expected, "{c}");
            assert_eq!(
                s.w.player(PlayerId(3))
                    .and_then(|p| p.signature.ranged_chill_until),
                case["until"].as_f64(),
                "{c}"
            );
        }
    }
}
