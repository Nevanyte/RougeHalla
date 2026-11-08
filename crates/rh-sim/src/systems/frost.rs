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
/// The source attack-chill result: resistSlow(min source chill, victim slowResist).
pub(crate) fn resisted_attack_chill(min_chill: f64, resist: f64) -> f64 {
    crate::status_runtime::resist_slow(min_chill, resist)
}

/// The source movement result: resistSlow(min(near, ranged), victim slowResist) then the source quantization.
pub(crate) fn resisted_move_mult(raw: f64, resist: f64) -> f64 {
    let m = crate::status_runtime::resist_slow(raw, resist);
    (m * FROST_MOVE_QUANTIZATION + 0.5).floor() / FROST_MOVE_QUANTIZATION
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
    // Source afterWeapons walks every standing combatant: an attack that started this tick counted its carried remainder
    // at full speed, so take the chill back off. The instant attackStarted hook above stays player-only on purpose (source
    // factions.ts explicitly filters c.kind !== "player"); NPCs are corrected here instead.
    for i in 0..cx.w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(i);
        if !cx.w.standing(ix) || !cx.s.attack_started[i] {
            continue;
        }
        let p = cx.w.core_mut(ix);
        if p.signature.chill >= 1. {
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
        // The source archer is a Frost PLAYER; the victim is any admitted actor (players and basic regional NPCs).
        let Some(by) =
            h.by.and_then(|id| w.player(id))
                .filter(|p| p.standing() && p.vitals.faction == FactionId::Frost)
        else {
            continue;
        };
        let _ = by;
        if let Some(i) = w.fighter_idx(h.victim).filter(|&i| w.standing(i)) {
            w.core_mut(i).signature.ranged_chill_until =
                Some(w.server_time + FROST_RANGED_CHILL_MS);
        }
    }
}
fn add(chillers: &mut [Option<PlayerId>; MAX_PLAYERS], count: &mut usize, source: PlayerId) {
    if *count < MAX_PLAYERS && !chillers[..*count].contains(&Some(source)) {
        chillers[*count] = Some(source);
        *count += 1;
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
    // Source updateChill walks standingCombatants (players and basic regional NPCs). Chiller sources remain roster PLAYER
    // ids: only a player's Frost structural chill is admitted; Frost/Sentenced NPC sources stay out of scope.
    let fighters = w.fighter_count();
    for i in 0..fighters {
        let ix = crate::fighter::FighterIx::of_slot(i);
        if !w.standing(ix) {
            continue;
        }
        let victim_id = w.core(ix).id;
        // Rebuild this victim's chiller list in source order without a per-tick allocation: source updateChill adds the
        // forward edge while walking actors in fighter order, and the reverse edge when that walk reaches the victim.
        let mut chillers = [None; MAX_PLAYERS];
        let mut count = 0usize;
        let mut near_frost = false;
        let mut chill: f64 = 1.;
        for j in 0..fighters {
            let jx = crate::fighter::FighterIx::of_slot(j);
            if !w.standing(jx) {
                continue;
            }
            let actor = w.core(jx);
            let actor_is_frost_player = w.is_player(jx) && actor.vitals.faction == FactionId::Frost;
            if actor_is_frost_player
                && actor.signature.engaged
                && actor.signature.target == Some(victim_id)
                && actor.id != victim_id
            {
                add(&mut chillers, &mut count, actor.id);
            }
            if j == i && actor.signature.engaged {
                if let Some(target) = actor.signature.target {
                    let tix = w.fighter_idx(target);
                    if let Some(tix) = tix {
                        let t = w.core(tix);
                        if w.is_player(tix)
                            && w.standing(tix)
                            && t.vitals.faction == FactionId::Frost
                            && target != victim_id
                        {
                            add(&mut chillers, &mut count, target);
                        }
                    }
                }
            }
        }
        let core = w.core(ix);
        for source in chillers[..count].iter().flatten() {
            if near(w, core, *source) {
                near_frost = true;
            }
            if let Some(p) = w.player(*source) {
                chill = chill.min(crate::modifiers::frost_chill(p));
            }
        }
        // Iron Will: the victim's folded slow_resist weakens the cut by the resisted share, exactly like the source's
        // resistSlow(m, slowResistOf(victim)).
        let resist = crate::modifiers::view(core).slow_resist;
        let chill = resisted_attack_chill(chill, resist);
        let p = w.core_mut(ix);
        let f = &mut p.signature;
        f.chill = chill;
        f.chillers = chillers;
        f.chiller_count = count as u8;
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
        // Same source order: the victim's resistance applies to the combined near/ranged result before quantization.
        f.frost_move_mult = resisted_move_mult(near_mult.min(ranged_mult), resist);
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
pub(crate) fn movement_modifier(
    w: &World,
    p: &FighterCore,
    _dt: f64,
    _: crate::status_runtime::StatView,
) -> f64 {
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
        // Reachable chill values are the image of resist_slow over the source range [1 - FROST_SLOW - frost_cap,
        // 1 - FROST_SLOW] and a resistance in [0, 1]: the union is the same lower bound up to 1 (a full resistance
        // leaves no cut), so partly resisted values above the unresisted ceiling are legitimate. A restore may also
        // happen after the victim's folded resistance changed, so the cached value is not required to equal a fresh
        // recomputation from the current stats.
        || !(f.chill == 1.
            || ((1. - FROST_SLOW - crate::modifiers::DEFINITION.frost_cap)..=1.).contains(&f.chill))
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
                quests: false,
                consumables: true,
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
                    roam_armed: false,
                });
                p.weapon.draw_started_at = 9000.;
            }
            assert_eq!(
                movement_modifier(&s.w, &s.w.players[1].core, TICK_MS, Default::default()),
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
                movement_modifier(&s.w, &s.w.players[i].core, TICK_MS, Default::default()),
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
            ("chill", json!(0.479)),
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
                TICK_MS,
                Default::default()
            ),
            0.7
        );
        // Ranged handoff returns the retained min, then the exact expiry rechecks live sources.
        restored.w.server_time = 1250.;
        assert_eq!(
            movement_modifier(
                &restored.w,
                &restored.player(PlayerId(2)).unwrap().core,
                TICK_MS,
                Default::default()
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
        let mut f = s.w.players[1].signature.clone();
        f.chill = 1. - FROST_SLOW;
        edits.push(f);
        f = s.w.players[1].signature.clone();
        f.chillers[0] = Some(PlayerId(1));
        edits.push(f);
        f = s.w.players[1].signature.clone();
        f.chiller_count = 1;
        edits.push(f);
        f = s.w.players[1].signature.clone();
        f.exposure_started_at = Some(0.);
        edits.push(f);
        f = s.w.players[1].signature.clone();
        f.last_near_at = Some(50.);
        edits.push(f);
        f = s.w.players[1].signature.clone();
        f.ranged_chill_until = Some(1200.);
        edits.push(f);
        f = s.w.players[1].signature.clone();
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
                    stats: crate::status_runtime::stats::Inputs::default(),
                    #[cfg(feature = "trusted-status-probes")]
                    probe: None,
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
                        terrain: false,
                        dot: false,
                        ability: None,
                        arena: false,
                        source: None,
                        critical: false,
                        critical_mult: None,
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

    fn grant_iron_will(s: &mut Sim, slot: usize) {
        s.w.players[slot].build =
            crate::cards::Build::from_counts([(crate::cards::CardId::IronWill, 1)]);
        crate::modifiers::recompute(&s.k, &mut s.w, crate::fighter::FighterIx::of_slot(slot));
        crate::modifiers::sync_max_hp(&mut s.w.players[slot]);
    }
    fn engage(s: &mut Sim, a: usize, b: usize) {
        let now = s.w.server_time;
        for (i, j) in [(a, b), (b, a)] {
            let f = &mut s.w.players[i].signature;
            f.target = Some(PlayerId(j as u32 + 1));
            f.engaged = true;
            f.in_reach = true;
            f.contact_at = Some(now);
            f.reach_at = Some(now);
        }
    }
    fn landed(victim: u32, by: u32) -> LandedHit {
        LandedHit {
            critical: false,
            cut: 1.,
            ability: None,
            dot: false,
            sig: None,
            weapon: Some(WeaponId::Bow),
            victim: PlayerId(victim),
            by: Some(PlayerId(by)),
            amount: 100.,
            race: 1.,
        }
    }
    /// Source updateChill: the victim's folded slow_resist (Iron Will 0.4) weakens the attack chill and the combined
    /// near/ranged movement result before quantization. The no-card values must stay the existing ones.
    #[test]
    fn iron_will_weakens_attack_chill_and_near_movement() {
        let mut baseline = scene();
        baseline.w.server_time = 10_000.;
        engage(&mut baseline, 0, 1);
        after_damage(&mut baseline.w);
        let f = &baseline.w.players[1].signature;
        assert_eq!(f.chill, 1. - FROST_SLOW);
        assert_eq!(f.frost_move_mult, CHILL_MOVE_MULT);
        assert_ne!(f.bits & SIG_CHILLED, 0);

        let mut s = scene();
        grant_iron_will(&mut s, 1);
        assert_eq!(
            crate::modifiers::view(&s.w.players[1].core).slow_resist,
            0.4
        );
        s.w.server_time = 10_000.;
        engage(&mut s, 0, 1);
        after_damage(&mut s.w);
        let f = &s.w.players[1].signature;
        let expected = crate::status_runtime::resist_slow(1. - FROST_SLOW, 0.4);
        assert!((f.chill - expected).abs() < 1e-15);
        assert!(
            (f.chill - 0.808).abs() < 1e-12,
            "source witness attack 0.68->0.808: {}",
            f.chill
        );
        assert_eq!(f.chillers[0], Some(PlayerId(1)));
        assert!(
            (f.frost_move_mult - 0.82).abs() < 1e-12,
            "source witness near 0.70->0.82: {}",
            f.frost_move_mult
        );
        assert_ne!(f.bits & SIG_CHILLED, 0);
    }
    #[test]
    fn iron_will_weakens_ranged_movement_and_overlap_and_source_card_is_neutral() {
        let mut baseline = scene();
        baseline.w.server_time = 10_000.;
        ranged_hits(&mut baseline.w, &[landed(2, 1)]);
        after_damage(&mut baseline.w);
        assert_eq!(
            baseline.w.players[1].signature.frost_move_mult,
            FROST_RANGED_CHILL_MULT
        );

        let mut s = scene();
        grant_iron_will(&mut s, 1);
        s.w.server_time = 10_000.;
        ranged_hits(&mut s.w, &[landed(2, 1)]);
        after_damage(&mut s.w);
        assert!(
            (s.w.players[1].signature.frost_move_mult - 0.91).abs() < 1e-12,
            "source witness ranged 0.85->0.91: {}",
            s.w.players[1].signature.frost_move_mult
        );
        // Overlap (near and ranged in the same tick) resists the source minimum, never the larger term.
        let mut o = scene();
        grant_iron_will(&mut o, 1);
        o.w.server_time = 10_000.;
        engage(&mut o, 0, 1);
        ranged_hits(&mut o.w, &[landed(2, 1)]);
        after_damage(&mut o.w);
        assert!((o.w.players[1].signature.frost_move_mult - 0.82).abs() < 1e-12);

        // Iron Will on the Frost source does not change the chill it produces.
        let mut source_card = scene();
        grant_iron_will(&mut source_card, 0);
        source_card.w.server_time = 10_000.;
        engage(&mut source_card, 0, 1);
        after_damage(&mut source_card.w);
        assert_eq!(source_card.w.players[1].signature.chill, 1. - FROST_SLOW);
    }
    #[test]
    fn resisted_chill_stretches_buffered_melee_and_bow_draw_clocks() {
        let mut s = scene();
        grant_iron_will(&mut s, 1);
        s.w.server_time = 10_000.;
        engage(&mut s, 0, 1);
        let m = crate::status_runtime::resist_slow(1. - FROST_SLOW, 0.4);
        let p = &mut s.w.players[1];
        // 100 ms left is above m*dt for m about 0.808: the kept time grows by (1-m)*dt each chilled tick.
        p.weapon.ready_at = 10_100.;
        p.weapon.buffered_until = 10_100.;
        p.weapon.action = Some(crate::state::PendingAction {
            kind: ActionKind::Draw,
            weapon: WeaponId::Bow,
            target: None,
            started_at: 9_900.,
            lands_at: 10_100.,
            a: 0.,
            packet: crate::state::Packet {
                raw: 1.,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            roam_armed: false,
        });
        p.weapon.draw_started_at = 9_900.;
        after_damage(&mut s.w);
        let p = &s.w.players[1];
        assert!((p.signature.chill - m).abs() < 1e-15);
        let expected_ready = 10_100. + (1. - m) * TICK_MS;
        assert!((p.weapon.ready_at - expected_ready).abs() < 1e-12);
        assert!((p.weapon.buffered_until - expected_ready).abs() < 1e-12);
        let a = p.weapon.action.expect("draw survives");
        assert!((a.lands_at - expected_ready).abs() < 1e-12);
        assert!((a.started_at - (9_900. + (1. - m) * TICK_MS)).abs() < 1e-12);
        assert!((p.weapon.draw_started_at - a.started_at).abs() < 1e-12);
    }
    #[test]
    fn resisted_chill_state_restores_continues_and_replays() {
        let mut s = scene();
        grant_iron_will(&mut s, 1);
        s.w.server_time = 10_000.;
        engage(&mut s, 0, 1);
        after_damage(&mut s.w);
        let partial = s.w.players[1].signature.chill;
        assert!(partial > 1. - FROST_SLOW && partial < 1.);
        let checkpoint = serde_json::to_value(&s).unwrap();
        let mut a =
            Sim::restore(checkpoint.clone()).expect("a reachable partly resisted chill restores");
        let mut b = Sim::restore(checkpoint).unwrap();
        assert_eq!(a.player(PlayerId(2)).unwrap().signature.chill, partial);
        for _ in 0..20 {
            for sim in [&mut a, &mut b] {
                sim.w.server_time += TICK_MS;
                engage(sim, 0, 1);
                after_damage(&mut sim.w);
            }
            assert_eq!(a.state_hash(), b.state_hash(), "continue replay");
            a = Sim::restore(serde_json::to_value(&a).unwrap())
                .expect("restore each continued tick");
        }
        // A cached resisted chill may predate a resistance change (the restore must not demand a fresh recomputation).
        let before_change = serde_json::to_value(&s).unwrap();
        s.w.players[1].build = crate::cards::Build::default();
        crate::modifiers::recompute(&s.k, &mut s.w, crate::fighter::FighterIx::of_slot(1));
        assert_eq!(crate::modifiers::view(&s.w.players[1].core).slow_resist, 0.);
        Sim::restore(before_change)
            .expect("a cached resisted chill survives a later resistance change");
    }

    // ---- P-FROST-RESISTANCE-1 pinned source witnesses (actual-source corpus; no out-of-scope parity test file) ----
    const FR_CORPUS: &str = include_str!("../../../../parity/frost-resistance/source.json");
    fn fr_corpus() -> Value {
        serde_json::from_str(FR_CORPUS).expect("the Frost-resistance source corpus parses")
    }
    fn fr_cases() -> Vec<Value> {
        fr_corpus()["cases"].as_array().expect("cases").to_vec()
    }
    fn fr_case(name: &str) -> Value {
        fr_cases()
            .into_iter()
            .find(|c| c["name"] == name)
            .unwrap_or_else(|| panic!("missing captured case {name}"))
    }
    fn fr_num(v: &Value, key: &str) -> f64 {
        v[key]
            .as_f64()
            .unwrap_or_else(|| panic!("{key} is not a number: {v}"))
    }
    fn fr_find_witness(case: &Value, tick: u64) -> Option<Value> {
        case["witnesses"]
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["tick"].as_u64() == Some(tick))
            .cloned()
    }
    fn fr_witness(case: &Value, tick: u64, id: &str) -> Value {
        let w = fr_find_witness(case, tick)
            .unwrap_or_else(|| panic!("{}: missing witness tick {tick}", case["name"]));
        w["frost"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["id"] == id)
            .unwrap_or_else(|| panic!("{}: missing {id} at tick {tick}", case["name"]))
            .clone()
    }
    fn fr_close(actual: f64, expected: f64, label: &str) {
        assert!(
            (actual - expected).abs() < 1e-12,
            "{label}: {actual} != {expected}"
        );
    }
    /// Source updateChill: Iron Will weakens the attack chill and the near/ranged movement result by the resisted
    /// share, before movement quantization. The witnesses come from the pinned actual-source capture (real grantCard
    /// folding and real client-message producers); they are evidence, not injected expectations.
    #[test]
    fn source_witnesses_show_the_resisted_slower_cuts() {
        let c = fr_corpus();
        assert_eq!(c["format"], "rh-frost-resistance-source/1");
        let p = &c["provenance"];
        assert_eq!(p["node"], "v22.23.4");
        assert_eq!(p["platform"], "linux");
        assert_eq!(p["arch"], "x64");
        assert_eq!(p["fixedStepMs"], 50);
        assert_eq!(
            p["image"],
            "node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292"
        );
        for key in ["tool", "packageLock"] {
            let h = p[key].as_str().unwrap();
            assert_eq!(h.len(), 64, "{key} pins a sha256");
            assert!(h.chars().all(|ch| ch.is_ascii_hexdigit()), "{key} hex");
        }
        for (path, h) in p["sourceFiles"].as_object().unwrap() {
            let h = h.as_str().unwrap();
            assert_eq!(h.len(), 64, "{path} pins a sha256");
            assert!(h.chars().all(|ch| ch.is_ascii_hexdigit()), "{path} hex");
        }
        assert_eq!(fr_cases().len(), 13);
        assert_eq!(crate::constants::FROST_SLOW, 0.32);
        assert_eq!(crate::constants::CHILL_MOVE_MULT, 0.7);
        assert_eq!(crate::constants::FROST_RANGED_CHILL_MULT, 0.85);

        let base_attack = fr_witness(&fr_case("attack-baseline"), 5, "p1");
        fr_close(
            fr_num(&base_attack, "chill"),
            1. - crate::constants::FROST_SLOW,
            "baseline attack chill",
        );
        fr_close(
            fr_num(&base_attack, "move"),
            crate::constants::CHILL_MOVE_MULT,
            "baseline near move",
        );
        assert_eq!(fr_num(&base_attack, "slowResist"), 0.);
        let card_attack = fr_witness(&fr_case("attack-iron-will-victim"), 5, "p1");
        assert_eq!(fr_num(&card_attack, "slowResist"), 0.4);
        fr_close(
            fr_num(&card_attack, "chill"),
            crate::status_runtime::resist_slow(fr_num(&base_attack, "chill"), 0.4),
            "resisted attack chill",
        );
        fr_close(
            fr_num(&card_attack, "chill"),
            0.808,
            "source witness 0.68->0.808",
        );
        fr_close(
            fr_num(&card_attack, "move"),
            0.82,
            "source witness near 0.70->0.82",
        );
        let source_card = fr_witness(&fr_case("attack-iron-will-source"), 5, "p1");
        fr_close(
            fr_num(&source_card, "chill"),
            fr_num(&base_attack, "chill"),
            "source card neutrality",
        );
        let base_ranged = fr_witness(&fr_case("ranged-baseline"), 30, "p1");
        fr_close(
            fr_num(&base_ranged, "move"),
            crate::constants::FROST_RANGED_CHILL_MULT,
            "baseline ranged move",
        );
        let card_ranged = fr_witness(&fr_case("ranged-iron-will"), 30, "p1");
        fr_close(
            fr_num(&card_ranged, "move"),
            crate::status_runtime::resist_slow(fr_num(&base_ranged, "move"), 0.4),
            "resisted ranged move",
        );
        fr_close(
            fr_num(&card_ranged, "move"),
            0.91,
            "source witness 0.85->0.91",
        );
    }
    /// Thaw via the no-card counterpart, departed-source/reset, both clock families and a real mid-run grantCard.
    #[test]
    fn source_thaw_departure_clock_and_resistance_change_witnesses_hold() {
        let card_thaw = fr_case("near-thaw-reset-iron-will");
        let base_thaw = fr_case("near-thaw-reset-baseline");
        for tick in [20u64, 30, 60, 100] {
            let card = fr_witness(&card_thaw, tick, "p1");
            let base = fr_witness(&base_thaw, tick, "p1");
            export_close_resisted(&card, &base, "resisted thaw movement");
            fr_close(fr_num(&base, "chill"), 0.68, "baseline thaw chill");
            fr_close(
                fr_num(&card, "chill"),
                crate::status_runtime::resist_slow(fr_num(&base, "chill"), 0.4),
                "resisted thaw chill",
            );
        }
        let departed = fr_witness(&card_thaw, 112, "p1");
        fr_close(
            fr_num(&departed, "chill"),
            1.,
            "source departure ends the chill",
        );
        assert_eq!(departed["chillers"].as_array().unwrap().len(), 0);
        let reset = fr_witness(&card_thaw, 196, "p1");
        assert!(
            reset["exposureStartedAt"].is_null(),
            "thaw reset clears episode start"
        );
        assert!(
            reset["lastNearAt"].is_null(),
            "thaw reset clears the last-near mark"
        );

        // Melee: the buffered window compares the same pre-tick state (the unresisted case later starts its next
        // attack later, so only the buffer witnesses are directly comparable).
        let melee_card = fr_case("clocks-buffered-melee-iron-will");
        let melee_base = fr_case("clocks-buffered-melee-baseline");
        let mut buffered_pairs = 0;
        for tick in [11u64, 12] {
            let Some(cw) = fr_find_witness(&melee_card, tick) else {
                continue;
            };
            let bw = fr_find_witness(&melee_base, tick).expect("baseline witness");
            let card = cw["frost"]
                .as_array()
                .unwrap()
                .iter()
                .find(|f| f["id"] == "p1")
                .unwrap()
                .clone();
            let base = bw["frost"]
                .as_array()
                .unwrap()
                .iter()
                .find(|f| f["id"] == "p1")
                .unwrap()
                .clone();
            if fr_num(&card, "bufferedUntil") > 0. && fr_num(&base, "bufferedUntil") > 0. {
                buffered_pairs += 1;
                assert!(
                    fr_num(&card, "bufferedUntil") < fr_num(&base, "bufferedUntil"),
                    "buffered melee: resisted chill stretches the buffer less"
                );
                assert!(
                    fr_num(&card, "readyAt") < fr_num(&base, "readyAt"),
                    "buffered melee: resisted chill stretches readyAt less"
                );
            }
        }
        assert_eq!(buffered_pairs, 2);
        // Bow: each witness that still carries the live draw action.
        let draw_card = fr_case("clocks-bow-draw-iron-will");
        let draw_base = fr_case("clocks-bow-draw-baseline");
        let mut draw_pairs = 0;
        for tick in [20u64, 60, 80] {
            let Some(cw) = fr_find_witness(&draw_card, tick) else {
                continue;
            };
            let bw = fr_find_witness(&draw_base, tick).expect("baseline witness");
            let card = cw["frost"]
                .as_array()
                .unwrap()
                .iter()
                .find(|f| f["id"] == "p1")
                .unwrap()
                .clone();
            let base = bw["frost"]
                .as_array()
                .unwrap()
                .iter()
                .find(|f| f["id"] == "p1")
                .unwrap()
                .clone();
            if let (Some(cl), Some(bl)) = (
                card["action"]["landsAt"].as_f64(),
                base["action"]["landsAt"].as_f64(),
            ) {
                if fr_num(&card, "chill") > fr_num(&base, "chill") {
                    draw_pairs += 1;
                    assert!(cl < bl, "bow draw: resisted chill delays the draw less");
                    assert!(
                        fr_num(&card, "drawStartedAt") < fr_num(&base, "drawStartedAt"),
                        "bow draw: the draw start is stretched less"
                    );
                }
            }
        }
        assert_eq!(draw_pairs, 3);

        // Real mid-run grantCard: the cached chill moves to the resisted value on the next tick.
        let change = fr_case("resistance-change-mid-run");
        let before_change = fr_witness(&change, 12, "p1");
        fr_close(
            fr_num(&before_change, "chill"),
            0.68,
            "unresisted before the grant",
        );
        assert_eq!(fr_num(&before_change, "slowResist"), 0.);
        let after_change = fr_witness(&change, 13, "p1");
        assert_eq!(fr_num(&after_change, "slowResist"), 0.4);
        fr_close(
            fr_num(&after_change, "chill"),
            crate::status_runtime::resist_slow(fr_num(&before_change, "chill"), 0.4),
            "the mid-run grant re-chills at the resisted value",
        );
        fr_close(
            fr_num(&after_change, "move"),
            0.82,
            "resisted movement after the change",
        );
    }
    fn export_close_resisted(card: &Value, base: &Value, label: &str) {
        // The source movement quantization is an inline literal: a test-only helper const would be scanned by the
        // content audit as a new crate-level number.
        let expected =
            (crate::status_runtime::resist_slow(fr_num(base, "move"), 0.4) * 1000. + 0.5).floor()
                / 1000.;
        fr_close(fr_num(card, "move"), expected, label);
    }

    // ---- P-FROST-NPC-RECIPIENTS-1: actual-source basic-NPC recipient timeline parity ----
    use crate::{mob_runtime::MobMode, validate, Arena, RawCommand, TileMap};
    const FR_NPC_FIXTURE: &str = include_str!("../../../../parity/frost-npc/source.json");
    fn fr_npc_arena(zone: &str) -> Arena {
        fn build(zone: &str) -> Arena {
            let mut map: Value =
                serde_json::from_str(include_str!("../../tests/fixtures/mob-pve-map.json"))
                    .unwrap();
            if zone != "fire" {
                let other = map["regions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .position(|r| r["id"] == zone)
                    .unwrap();
                map["regions"][0]["id"] = zone.into();
                map["regions"][other]["id"] = "fire".into();
                for camp in map["regions"][0]["mobCamps"].as_array_mut().unwrap() {
                    camp["id"] = format!("{zone}-1").into();
                    camp["region"] = zone.into();
                    camp["weapon"] = match zone {
                        "plague" => "bow",
                        "holy" => "wand",
                        _ => "sword",
                    }
                    .into();
                }
                for p in map["spawnPool"].as_array_mut().unwrap() {
                    if p["zone"] == "fire" {
                        p["zone"] = zone.into();
                    } else if p["zone"] == zone {
                        p["zone"] = "fire".into();
                    }
                }
                map["camps"][0]["zone"] = zone.into();
                map["camps"][0]["id"] = format!("{zone}-1").into();
                for v in map["regionGrid"].as_array_mut().unwrap() {
                    let n = v.as_u64().unwrap();
                    if n == 1 {
                        *v = (other + 1).into();
                    } else if n == other as u64 + 1 {
                        *v = 1.into();
                    }
                }
                map["regions"].as_array_mut().unwrap().swap(0, other);
                map["spawns"] = serde_json::Value::Array(
                    map["regions"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .flat_map(|r| r["spawns"].as_array().unwrap().iter().cloned())
                        .collect(),
                );
            }
            let data: crate::mapdata::GameMapData = serde_json::from_value(map).unwrap();
            let (w, h, tiles, layers) = crate::mapdata::MapExport {
                format: "rh-map/2".into(),
                legacy_map_hash_u32: 0,
                map: data,
            }
            .validate()
            .unwrap()
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
        build(zone)
    }
    fn fr_npc_id(s: &str, seats: usize) -> PlayerId {
        if let Some(n) = s.strip_prefix('p') {
            PlayerId(n.parse::<u32>().unwrap() + 1)
        } else {
            PlayerId(
                seats as u32 + u32::from_str_radix(s.strip_prefix("mob").unwrap(), 36).unwrap(),
            )
        }
    }
    fn fr_npc_close(a: f64, b: f64, label: &str) {
        assert!(
            (a - b).abs() <= 1e-9 * b.abs().max(1.),
            "{label}: native {a} source {b}"
        );
    }
    fn fr_npc_sim(case: &Value) -> (Sim, usize) {
        let input = &case["input"];
        let players = input["players"].as_array().unwrap();
        let placements: Vec<_> = players
            .iter()
            .enumerate()
            .map(|(i, p)| Placement {
                profile: format!("name{i}"),
                faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
                bot: false,
                at: Vec2::new(p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()),
                hp: p["hp"].as_f64(),
                weapon0: WeaponId::parse(p["weapon"].as_str().unwrap()),
                weapon1: None,
            })
            .collect();
        let mut secrets = Secrets::from_seed(1);
        secrets.spawn_seed = 12;
        secrets.reward_salt = [1, 2, 3, 4];
        let sim = Sim::reset_active(
            SimConfig {
                quests: false,
                consumables: true,
                mob_mode: MobMode::Pve,
                faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrost,
                ..Default::default()
            },
            fr_npc_arena(input["zone"].as_str().unwrap()),
            secrets,
            &placements,
        );
        (sim, placements.len())
    }
    fn fr_npc_apply(sim: &mut Sim, commands: &[Value], seats: usize) {
        for c in commands {
            let raw = match c["kind"].as_str().unwrap() {
                "attack" => RawCommand::Attack {
                    a: c["a"].as_f64().unwrap(),
                    t: None,
                },
                "release" => RawCommand::Release {
                    a: c["a"].as_f64().unwrap(),
                    t: None,
                },
                "target" => RawCommand::Target {
                    id: fr_npc_id(c["id"].as_str().unwrap(), seats),
                },
                "move" => RawCommand::Move {
                    x: c["x"].as_f64().unwrap(),
                    y: c["y"].as_f64().unwrap(),
                    seq: None,
                },
                other => panic!("unadmitted command {other}"),
            };
            let id = fr_npc_id(c["actor"].as_str().unwrap(), seats);
            let cmd = validate(raw).unwrap();
            sim.submit(id, cmd).unwrap();
        }
    }
    fn fr_npc_compare_frame(sim: &Sim, frame: &Value, seats: usize, name: &str) {
        let f = &frame["output"];
        let phase = match f["phase"].as_str().unwrap() {
            "active" => crate::Phase::Active,
            "planning" => crate::Phase::Planning,
            "ended" => crate::Phase::Ended,
            other => panic!("phase {other}"),
        };
        assert_eq!(sim.phase(), phase, "{name} phase");
        assert_eq!(
            sim.tick() as u64,
            f["tick"].as_u64().unwrap(),
            "{name} tick"
        );
        let mobs = f["mobs"].as_array().unwrap();
        assert_eq!(sim.mobs().len(), mobs.len(), "{name} mob count");
        for row in f["signatures"].as_array().unwrap() {
            let id = fr_npc_id(row[0].as_str().unwrap(), seats);
            let Some(p) = sim.w.actor(id) else { continue };
            let e = &row[1];
            let s = &p.signature;
            fr_npc_close(
                s.chill,
                e["chill"].as_f64().unwrap(),
                &format!("{name} chill {}", id.0),
            );
            let chillers: Vec<PlayerId> = e["chillers"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| fr_npc_id(v.as_str().unwrap(), seats))
                .collect();
            let actual: Vec<PlayerId> = s.chillers[..usize::from(s.chiller_count)]
                .iter()
                .flatten()
                .copied()
                .collect();
            assert_eq!(actual, chillers, "{name} chillers {}", id.0);
            for (actual, expected, key) in [
                (
                    s.exposure_started_at,
                    &e["chillExposureStartedAt"],
                    "exposureStartedAt",
                ),
                (s.last_near_at, &e["chillLastNearAt"], "chillLastNearAt"),
                (s.ranged_chill_until, &e["rangedChillUntil"], "rangedUntil"),
            ] {
                match expected.as_f64() {
                    Some(v) => fr_npc_close(
                        actual.unwrap_or(f64::NAN),
                        v,
                        &format!("{name} {key} {}", id.0),
                    ),
                    None => assert!(actual.is_none(), "{name} {key} {}", id.0),
                }
            }
            fr_npc_close(
                s.frost_move_mult,
                e["frostMoveMult"].as_f64().unwrap(),
                &format!("{name} move {}", id.0),
            );
        }
        for (m, e) in sim.mobs().iter().zip(mobs) {
            let id = fr_npc_id(e["id"].as_str().unwrap(), seats);
            assert_eq!(m.core.id, id, "{name} mob id");
            let st = &e["state"];
            let w = &e["weapon"];
            fr_npc_close(
                m.core.weapon.ready_at,
                st["readyAt"].as_f64().unwrap(),
                &format!("{name} npc ready {}", id.0),
            );
            fr_npc_close(
                m.core.weapon.buffered_until,
                w["bufferedUntil"].as_f64().unwrap(),
                &format!("{name} npc buffered {}", id.0),
            );
            fr_npc_close(
                m.core.weapon.draw_started_at,
                st["drawStartedAt"].as_f64().unwrap(),
                &format!("{name} npc drawStarted {}", id.0),
            );
            match w["action"].is_null() {
                true => assert!(m.core.weapon.action.is_none(), "{name} npc action none"),
                false => {
                    let a = m.core.weapon.action.expect("npc action");
                    let ea = &w["action"];
                    let kind = match a.kind {
                        ActionKind::Swing => "swing",
                        ActionKind::Cast => "cast",
                        ActionKind::Draw => "draw",
                    };
                    assert_eq!(kind, ea["kind"].as_str().unwrap(), "{name} npc action kind");
                    fr_npc_close(
                        a.started_at,
                        ea["startedAt"].as_f64().unwrap(),
                        &format!("{name} npc action start {}", id.0),
                    );
                    fr_npc_close(
                        a.lands_at,
                        ea["landsAt"].as_f64().unwrap(),
                        &format!("{name} npc action lands {}", id.0),
                    );
                }
            }
        }
    }
    #[test]
    fn actual_source_player_frost_chills_basic_npcs_with_strict_restore() {
        let corpus: Value = serde_json::from_str(FR_NPC_FIXTURE).unwrap();
        assert_eq!(corpus["format"], "rh-frost-npc-source/1");
        assert_eq!(corpus["provenance"]["node"], "v22.23.4");
        assert_eq!(corpus["provenance"]["platform"], "linux");
        assert_eq!(corpus["provenance"]["arch"], "x64");
        let cases = corpus["cases"].as_array().unwrap();
        assert_eq!(cases.len(), 3);
        let mut chilled_seen = 0;
        let mut ranged_seen = 0;
        for case in cases {
            let name = case["input"]["name"].as_str().unwrap();
            let (mut sim, seats) = fr_npc_sim(case);
            let control = name.contains("control");
            let mut npc_chilled = false;
            let mut npc_ranged = false;
            for frame in case["frames"].as_array().unwrap() {
                if let Some(commands) = frame["commands"].as_array() {
                    fr_npc_apply(&mut sim, commands, seats);
                }
                sim.step();
                fr_npc_compare_frame(&sim, frame, seats, name);
                for m in sim.mobs() {
                    let s = &m.core.signature;
                    if s.chill < 1. {
                        npc_chilled = true;
                        assert!(!control, "{name}: the no-Frost control cannot chill an NPC");
                        assert_eq!(
                            s.chillers[0],
                            Some(PlayerId(1)),
                            "{name}: the Frost player is the chiller"
                        );
                    }
                    if s.ranged_chill_until.is_some() {
                        npc_ranged = true;
                    }
                    if control {
                        assert_eq!(s.chill, 1., "{name}: no-Frost control chill unchanged");
                        assert_eq!(
                            s.frost_move_mult, 1.,
                            "{name}: no-Frost control movement unchanged"
                        );
                        assert!(
                            s.ranged_chill_until.is_none(),
                            "{name}: no-Frost control ranged unchanged"
                        );
                        assert_eq!(s.chiller_count, 0, "{name}: no-Frost control no sources");
                    }
                }
                // Strict restore/continue: restore the actual chilled NPC state after every source frame and keep
                // replaying the next source frame from the restored Sim.
                sim = Sim::restore(serde_json::to_value(&sim).unwrap())
                    .unwrap_or_else(|e| panic!("{name}: chilled NPC state restores: {e}"));
            }
            if !control {
                assert!(
                    npc_chilled,
                    "{name}: the Frost player's chill reached a basic NPC"
                );
            }
            if name.contains("ranged") {
                assert!(
                    npc_ranged,
                    "{name}: a basic NPC carried the ranged chill window"
                );
                ranged_seen += 1;
            }
            if !control {
                chilled_seen += 1;
            }
            // Replay strictness: a restored copy continues three source-free steps identically.
            let mut terminal = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
            for _ in 0..3 {
                sim.step();
                terminal.step();
                assert_eq!(
                    sim.state_hash(),
                    terminal.state_hash(),
                    "{name}: continue replay"
                );
            }
        }
        assert_eq!(chilled_seen, 2);
        assert_eq!(ranged_seen, 1);
        // Malformed chilled-NPC private state is still refused by the existing basic-NPC validator.
        let case = &cases[0];
        let (mut sim, _) = fr_npc_sim(case);
        let mut npc_id = None;
        for frame in case["frames"].as_array().unwrap().iter().take(20) {
            if let Some(commands) = frame["commands"].as_array() {
                fr_npc_apply(&mut sim, commands, 2);
            }
            sim.step();
            for m in sim.mobs() {
                if m.core.signature.chill < 1. {
                    npc_id = Some(m.core.id);
                }
            }
        }
        let npc_id = npc_id.expect("a chilled NPC exists for the malformed cases");
        let slot = sim.w.fighter_idx(npc_id).unwrap().slot();
        let mob = slot - sim.players().len();
        let signature =
            |v: &serde_json::Value| v["world"]["mobs"][mob]["core"]["signature"].clone();
        let mut bad = serde_json::to_value(&sim).unwrap();
        bad["world"]["mobs"][mob]["core"]["signature"]["chill"] = json!(0.4);
        assert!(
            Sim::restore(bad).is_err(),
            "chill below the reachable resisted image is refused"
        );
        let mut bad = serde_json::to_value(&sim).unwrap();
        bad["world"]["mobs"][mob]["core"]["signature"]["chillers"] =
            json!([999, null, null, null, null, null, null, null]);
        assert!(
            Sim::restore(bad).is_err(),
            "a non-roster NPC chiller source is refused"
        );
        let mut bad = serde_json::to_value(&sim).unwrap();
        bad["world"]["mobs"][mob]["core"]["signature"]["ap_hits"]["target"] = json!(999);
        assert!(
            Sim::restore(bad).is_err(),
            "forged NPC AP provenance is refused"
        );
        // The chilled NPC keeps its basic gear and zero Mark/AP state: the prior basic-NPC checks still hold.
        let live = &sim.mobs()[mob];
        assert_eq!(live.core.signature.mark, Default::default());
        assert_eq!(live.core.signature.ap_hits, Default::default());
        let restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
        assert_eq!(
            restored.mobs()[mob].core.signature.chill,
            live.core.signature.chill
        );
        assert_eq!(
            restored.mobs()[mob].core.weapon.weapon0,
            live.core.weapon.weapon0
        );
        let _ = signature;
    }

    #[test]
    fn instant_attack_started_hook_is_player_only_and_npc_timing_corrects_in_after_weapons() {
        let corpus: Value = serde_json::from_str(FR_NPC_FIXTURE).unwrap();
        let (mut sim, _) = fr_npc_sim(&corpus["cases"][0]);
        sim.s.reserve_actors(sim.w.fighter_count());
        let npc_id = sim.mobs()[0].core.id;
        let npc_ix = sim.w.fighter_idx(npc_id).unwrap();
        let player_ix = crate::fighter::FighterIx::of_slot(0);
        let now = sim.w.server_time;
        let chill = 1. - FROST_SLOW;
        let packet = crate::state::Packet {
            raw: 1.,
            phys: 1.,
            magic: 0.,
            true_: 0.,
        };
        let action = |lands| crate::state::PendingAction {
            kind: ActionKind::Swing,
            weapon: WeaponId::Sword,
            target: None,
            started_at: now - 100.,
            lands_at: lands,
            a: 0.,
            packet,
            roam_armed: false,
        };
        let mut events = Vec::new();
        // The instant attackStarted hook is source player-only: an instant NPC swing is NOT corrected there.
        {
            let p = sim.w.core_mut(npc_ix);
            p.signature.chill = chill;
            p.weapon.ready_at = 1000.;
            p.weapon.action = Some(action(now));
        }
        let before = sim.w.core(npc_ix).weapon.ready_at;
        {
            let mut hx = crate::hooks::Hx {
                stats: Default::default(),
                fx: None,
                k: &sim.k,
                w: &mut sim.w,
                ev: &mut events,
            };
            crate::systems::frost::attack_started(
                &mut hx,
                &crate::hooks::HookArgs::AttackStarted(npc_id),
            );
        }
        assert_eq!(
            sim.w.core(npc_ix).weapon.ready_at,
            before,
            "the instant attackStarted hook must stay player-only (source filters c.kind !== player)"
        );
        // afterWeapons is where the source corrects an NPC attack started this tick.
        sim.s.attack_started[npc_ix.slot()] = true;
        {
            let mut ev = Vec::new();
            let mut cx = Cx {
                stats: Default::default(),
                #[cfg(feature = "trusted-status-probes")]
                probe: None,
                k: &sim.k,
                w: &mut sim.w,
                s: &mut sim.s,
                ev: &mut ev,
                pf: &mut sim.pf,
            };
            after_weapons(&mut cx);
        }
        let expected = before + (1. - chill) * 100.;
        fr_npc_close(
            sim.w.core(npc_ix).weapon.ready_at,
            expected,
            "NPC afterWeapons clock correction",
        );
        // Player control: the same instant swing IS corrected by the hook (proving the distinction is intentional).
        {
            let p = sim.w.core_mut(player_ix);
            p.signature.chill = chill;
            p.weapon.ready_at = 1000.;
            p.weapon.action = Some(action(now));
            p.signature.target = Some(npc_id);
            p.signature.engaged = true;
        }
        let before = sim.w.core(player_ix).weapon.ready_at;
        {
            let mut hx = crate::hooks::Hx {
                stats: Default::default(),
                fx: None,
                k: &sim.k,
                w: &mut sim.w,
                ev: &mut events,
            };
            crate::systems::frost::attack_started(
                &mut hx,
                &crate::hooks::HookArgs::AttackStarted(PlayerId(1)),
            );
        }
        let corrected = sim.w.core(player_ix).weapon.ready_at;
        fr_npc_close(
            corrected,
            before + (1. - chill) * 100.,
            "player instant-hook correction",
        );
        assert!(corrected > before);
    }
}
