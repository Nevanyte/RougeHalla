use crate::{angle_close, close, fid, Event, Sim, Value};

fn projectile_id(n: u32) -> String {
    super::combat::id36(n).replacen('c', "p", 1)
}
fn kind(k: rh_sim::ProjectileKind) -> &'static str {
    match k {
        rh_sim::ProjectileKind::Arrow => "arrow",
        rh_sim::ProjectileKind::Ball => "ball",
    }
}
pub(crate) fn end_reason(r: rh_sim::ProjectileEnd) -> &'static str {
    use rh_sim::ProjectileEnd::*;
    match r {
        Range => "range",
        Wall => "wall",
        Hit => "hit",
        Deleted => "deleted",
        Destroyed => "destroyed",
        Reflected => "reflected",
        Blocked => "blocked",
        Cleared => "cleared",
    }
}
pub(crate) fn launch(e: &Event) -> Option<Value> {
    let Event::ProjectileLaunched(p) = e else {
        return None;
    };
    let mut row = serde_json::json!({"id":projectile_id(p.id),"kind":kind(p.kind),"owner":fid(p.owner),"x":p.origin.x,"y":p.origin.y,"vx":p.velocity.x,"vy":p.velocity.y,"t":p.time,"range":p.range});
    if !p.reflected {
        row["ownerId"] = serde_json::json!(fid(p.owner));
    }
    if let Some(target) = p.target {
        row["targetId"] = serde_json::json!(fid(target));
    }
    Some(rounded(row))
}

/// Canonical form of a Rust event, matching the capture tool's `canonicalEvent` (GV feedback events are not compared:
/// GV is checked through the results).
pub(crate) fn canon(e: &Event, sim: &Sim) -> Option<Value> {
    use serde_json::json;
    Some(rounded(match e {
        Event::MobArmed { .. }
        | Event::CampCleared { .. }
        | Event::PotionNotice { .. }
        | Event::CannonNotice { .. } => return None, // Dedicated PvE/initial-loot source projections cover these.
        Event::ChestRefused { id, reason } => {
            json!({"kind":"toast","to":fid(*id),"text":reason.message()})
        }
        Event::Toast { to, text } => {
            json!({"kind":"toast","to":fid(*to),"text":text})
        }
        Event::ChestTaken { chest, by, pick } => {
            json!({"kind":"chestTaken","chest":super::combat::id36(*chest),"by":fid(*by),"option":pick})
        }
        Event::StatusApplied { id, kind, ms, by } => {
            json!({"kind":"status","id":fid(*id),"status":kind,"ms":ms,"by":by.map(fid).unwrap_or_default()})
        }
        Event::CastStarted {
            id,
            ability,
            ms,
            target,
            x,
            y,
        } => {
            json!({"kind":"cast","by":fid(*id),"ability":ability,"ms":ms,"target":target.map(fid),"x":x,"y":y})
        }
        Event::CastLanded {
            id,
            ability,
            target,
            x,
            y,
            to,
        } => {
            let mut v = json!({"kind":"castLand","by":fid(*id),"ability":ability,"target":target.map(fid),"x":x,"y":y});
            if let Some(to) = to {
                v["x2"] = json!(to.x);
                v["y2"] = json!(to.y);
            }
            v
        }
        Event::CastEnded {
            id,
            ability,
            reason,
        } => json!({"kind":"castEnd","by":fid(*id),"ability":ability,"reason":reason}),
        Event::AbilityHit {
            victim,
            by,
            ability,
            amount,
        } => {
            json!({"kind":"hit","id":fid(*victim),"by":by.map(fid).unwrap_or_default(),"ability":ability,"amount":amount,"weapon":null})
        }
        Event::MarkNotice { recipient, notice } => {
            json!({"kind":"toast","to":fid(*recipient),"text":notice.message()})
        }
        Event::SignatureHit {
            victim,
            by,
            sig,
            weapon,
            amount,
        } => {
            json!({"kind":"hit","id":fid(*victim),"by":fid(*by),"sig":sig.as_str(),"weapon":weapon.map(|w|w.as_str()),"amount":amount})
        }
        Event::Windup { by, weapon, a, ms } => {
            json!({"kind": "windup", "by": fid(*by), "weapon": weapon.as_str(), "a": a, "ms": ms})
        }
        Event::Swing {
            by,
            weapon,
            x,
            y,
            a,
        } => {
            json!({"kind": "swing", "by": fid(*by), "weapon": weapon.as_str(), "x": x, "y": y, "a": a})
        }
        Event::Hit {
            victim,
            by,
            amount,
            weapon,
            passive,
        } => {
            // `by` None is the legacy SUDDEN_DEATH_KILLER string ("sudden death"); `weapon` None is the legacy null
            // (ability / card damage chunks). The packet that ports sudden death fixes its weapon.
            let mut event = json!({"kind": "hit", "id": fid(*victim), "by": by.map_or_else(|| "sudden death".to_string(), fid), "amount": amount, "weapon": weapon.map(|w| w.as_str())});
            if *passive {
                event["passive"] = json!(true);
            }
            event
        }
        Event::Death { id, x, y, by } => {
            json!({"kind": "death", "id": fid(*id), "x": x, "y": y, "by": by.map(fid)})
        }
        Event::Victory { id, draw } => {
            json!({"kind": "victory", "id": id.map(fid), "name": id.and_then(|p| sim.player(p).map(|p| p.seat.name.as_str())), "draw": draw})
        }
        Event::RaidEnded => json!({"kind": "raidEnded"}),
        Event::Bounty { id, bounty } => {
            json!({"kind": "bounty", "id": fid(*id), "name": sim.player(*id).map(|p| p.seat.name.as_str()), "bounty": bounty})
        }
        Event::ProjectileLaunched(_) => return None, // compared in the complete launch stream
        Event::ProjectileEnded {
            launch: p,
            at,
            reason,
        } => {
            let mut row = json!({"id":projectile_id(p.id),"kind":"projEnd","proj":kind(p.kind),"x0":p.origin.x,"y0":p.origin.y,"t0":p.time,"x":at.x,"y":at.y,"reason":end_reason(*reason)});
            if !p.reflected {
                row["ownerId"] = json!(fid(p.owner));
            }
            row
        }
        Event::Block {
            id,
            by,
            weapon,
            passive,
        } => {
            let mut row =
                json!({"kind":"block", "id":fid(*id), "by":fid(*by), "weapon":weapon.as_str()});
            if *passive {
                row["passive"] = json!(true);
            }
            row
        }
        Event::PickupRefused { id, reason, .. } => {
            json!({"kind":"toast", "to":fid(*id), "text":reason.message()})
        }
        Event::Heal { id, amount } => json!({"kind":"heal","id":fid(*id),"amount":amount}),
        Event::AttackCancelled { id } => json!({"kind":"cancel","id":fid(*id)}),
        Event::Stagger { id } => json!({"kind": "stagger", "id": fid(*id)}),
        Event::RaidStarted => json!({"kind": "raidStarted"}),
        // The legacy scenario projection excludes arena lifecycle events. The dedicated arena
        // oracle compares these facts against its exercised Source captures.
        Event::PlanningStarted
        | Event::Plan { .. }
        | Event::Teleported
        | Event::Gv { .. }
        | Event::Resolved { .. } => return None,
    }))
}

/// First differing path; only known continuous fields receive the continuous tolerance.
/// Timing, ids, counts and every unknown field compare exactly.
pub(crate) fn first_difference(path: &str, a: &Value, b: &Value) -> Option<String> {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let key = path.rsplit('.').next().unwrap_or(path);
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            let same = match key {
                "a" => angle_close(x, y),
                "x" | "y" | "x0" | "y0" | "x2" | "y2" | "amount" | "vx" | "vy" | "range" => {
                    close(x, y)
                }
                _ => x == y,
            };
            (!same).then(|| format!("{path}: rust {a} vs legacy {b}"))
        }
        (Value::Object(x), Value::Object(y)) => {
            for k in x
                .keys()
                .chain(y.keys())
                .collect::<std::collections::BTreeSet<_>>()
            {
                let at = format!("{path}.{k}");
                match (x.get(k), y.get(k)) {
                    (Some(v), Some(w)) => {
                        if let Some(d) = first_difference(&at, v, w) {
                            return Some(d);
                        }
                    }
                    _ => {
                        return Some(format!(
                            "{at}: rust {:?} vs legacy {:?}",
                            x.get(k),
                            y.get(k)
                        ))
                    }
                }
            }
            None
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!(
                    "{path}.length: rust {} vs legacy {}",
                    x.len(),
                    y.len()
                ));
            }
            x.iter()
                .zip(y)
                .enumerate()
                .find_map(|(i, (v, w))| first_difference(&format!("{path}[{i}]"), v, w))
        }
        _ => (a != b).then(|| format!("{path}: rust {a} vs legacy {b}")),
    }
}

pub(super) fn rounded(value: Value) -> Value {
    match value {
        Value::Number(n) => serde_json::json!(((n.as_f64().unwrap() * 1e6) + 0.5).floor() / 1e6),
        Value::Array(v) => Value::Array(v.into_iter().map(rounded).collect()),
        Value::Object(v) => Value::Object(v.into_iter().map(|(k, v)| (k, rounded(v))).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn event_names_read_the_actual_rust_player_and_midrun_start_is_visible() {
        let fx = crate::load(&crate::fixtures_dir().join("fists_duel.json"));
        let mut sim = crate::build(&fx);
        sim.remove_player(crate::pid("p0"));
        // A missing player cannot have its fixture-derived name invented by the harness.
        assert_eq!(
            canon(
                &Event::Bounty {
                    id: crate::pid("p0"),
                    bounty: 3
                },
                &sim
            )
            .unwrap()["name"],
            Value::Null
        );
        assert_eq!(
            canon(&Event::RaidStarted, &sim).unwrap()["kind"],
            "raidStarted"
        );
        let sim = crate::build(&fx);
        assert_eq!(
            canon(
                &Event::Bounty {
                    id: crate::pid("p1"),
                    bounty: 3
                },
                &sim
            )
            .unwrap()["name"],
            sim.player(crate::pid("p1")).unwrap().seat.name
        );
    }
}
