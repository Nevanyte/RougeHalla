//! Projections of run gear, ledger shred statuses and weapon containers.
use crate::{canon::first_difference, fid, Report};
use rh_sim::{ContainerKind, Sim, WeaponId};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Drop {
    weapon: String,
    at: Point,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Point {
    x: f64,
    y: f64,
}

pub(super) fn seed(sim: &mut Sim, setup: &serde_json::Map<String, Value>) -> Result<(), String> {
    for (key, value) in setup {
        if key != "containers" {
            return Err(format!("unported setup key {key}"));
        }
        let drops: Vec<Drop> = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
        for drop in drops {
            let weapon = WeaponId::parse(&drop.weapon)
                .ok_or_else(|| format!("unknown rack weapon {}", drop.weapon))?;
            sim.seed_weapon_container(
                ContainerKind::Ground,
                rh_sim::Vec2::new(drop.at.x, drop.at.y),
                &[weapon],
            )?;
        }
    }
    Ok(())
}

pub(super) fn id36(mut n: u32) -> String {
    let mut chars = Vec::new();
    while n > 0 {
        chars.push(char::from_digit(n % 36, 36).unwrap());
        n /= 36;
    }
    std::iter::once('c')
        .chain(chars.into_iter().rev())
        .collect()
}
fn containers(sim: &Sim) -> Vec<Value> {
    sim.containers().iter().map(|c| {
        let (kind,label)=match c.kind {
            ContainerKind::Ground => ("ground",match c.items[0].def {rh_sim::initial_world::ItemDef::Weapon(w)=>format!("{w:?}"), _=>unreachable!("ground loot is a weapon")}),
            ContainerKind::Chest => ("chest","Chest".to_string()),
            ContainerKind::Body(id) => ("body",sim.player_name(id).unwrap().to_string()),
            // Legacy container kind "consumable" carrying one windEmblem item.
            ContainerKind::WindEmblem => ("consumable","Wind emblem · walk over it".to_string()),
        };
        let items=c.items.iter().map(|i|json!({"def":i.def.as_str(),"uid":i.uid.to_string()})).collect::<Vec<_>>();
        // The shared legacy schema also supplies neutral fields for other container kinds
        // (cannons, reward chests and trophies). Assert every one on ordinary weapon loot.
        json!({"id":id36(c.id),"kind":kind,"label":label,"x":c.at.x,"y":c.at.y,"opened":c.opened,"items":items,
            "camp":0,"expiresAt":0,"options":[],"takenBy":[],"pickers":[],"readyAt":0,"targetX":0,"targetY":0,"owner":""})
    }).collect()
}
fn statuses(sim: &Sim) -> Vec<Value> {
    sim.players().iter().map(|p| {
        let statuses=p.statuses.instances.iter().map(|s| {
            let mut value = json!({"kind":s.kind,"source":{"id":s.source.id.map(fid).unwrap_or_default(),"name":s.source.name},"startedAt":s.started_at,"until":s.until,"value":s.value});
            let o = value.as_object_mut().unwrap();
            if let Some(a) = s.ability { o.insert("ability".into(), json!(a)); }
            if let Some(tag) = &s.tag { o.insert("tag".into(), json!(tag)); }
            if let Some(owner) = s.source.owner_id { o.get_mut("source").unwrap().as_object_mut().unwrap().insert("ownerId".into(), json!(fid(owner))); }
            macro_rules! field { ($name:literal,$v:expr) => { if let Some(v) = $v { o.insert($name.into(), json!(v)); } }; }
            field!("revealFrom",s.reveal_from); field!("revealUntil",s.data.reveal_until);
            field!("dealtMult",s.data.dealt_mult); field!("takenFromSourceMult",s.data.taken_from_source_mult);
            field!("moveMult",s.data.move_mult); field!("floorHp",s.data.floor_hp); field!("taken",s.taken); field!("healShare",s.data.heal_share);
            if let Some(id) = s.data.field_id { o.insert("fieldId".into(), json!(format!("fld{}",id36(id).trim_start_matches('c')))); }
            if let Some(shares) = s.data.shares {o.insert("shares".into(),json!({"phys":shares.phys,"magic":shares.magic,"true":shares.true_}));}
            value
        }).collect::<Vec<_>>();
        json!({"id":fid(p.id),"statuses":statuses})
    }).collect()
}
fn weapons(sim: &Sim) -> Vec<Value> {
    sim.players().iter().map(|p| {
        let w=&p.weapon;
        let action=w.action.map(|a| json!({"kind":match a.kind {
            rh_sim::state::ActionKind::Swing => "swing", rh_sim::state::ActionKind::Cast => "cast", rh_sim::state::ActionKind::Draw => "draw",
        },"weapon":a.weapon.as_str(),"a":a.a,"landsAt":a.lands_at}));
        let armor_bonus = p.modifiers.mirrors().armor_bonus;
        json!({"id":fid(p.id),"weapon0":w.weapon0.map_or("", WeaponId::as_str),"weapon1":w.weapon1.map_or("", WeaponId::as_str),
            "slot":w.slot,"drawStartedAt":w.draw_started_at,"staggerImmuneUntil":w.stagger_immune_until,"armorBonus":armor_bonus,"action":action})
    }).collect()
}
pub(super) fn compare(rep: &mut Report, sim: &Sim, t: &crate::FixTick, require_combat: bool) {
    for (name, stream, project) in [
        ("combat", &t.combat, weapons as fn(&Sim) -> Vec<Value>),
        ("statuses", &t.statuses, statuses),
        ("containers", &t.containers, containers),
    ] {
        if let Some(legacy) = stream {
            let ours = super::canon::rounded(Value::Array(project(sim)));
            if let Some(d) = first_difference(name, &ours, &Value::Array(legacy.clone())) {
                rep.fail(format!("tick {}: {d}", t.tick));
            }
        } else if require_combat {
            rep.fail(format!(
                "tick {}: missing combat packet stream {name}",
                t.tick
            ));
        }
    }
}

pub(super) fn compare_locks(rep: &mut Report, sim: &Sim, t: &crate::FixTick) {
    let Some(record) = &t.locks else {
        rep.fail(format!("tick {}: missing settled locks stream", t.tick));
        return;
    };
    let rows:Vec<_>=sim.players().iter().map(|p|{
        let w=&p.weapon;
        let lock=&w.targeting;
        let id=lock.target.map(fid);
        json!({"id":fid(p.id),"mirror":id.as_deref().unwrap_or(""),"lock":id,"seen":lock.seen,"lostAt":lock.lost_at.unwrap_or(0.0),
            "planAt":lock.plan_at,"searchAt":lock.search_at,"goal":lock.goal,"attackMove":lock.attack_move,
            "path":p.motion.path.as_slice(),"held":w.held,"pressedAt":w.pressed_at,"bufferedUntil":w.buffered_until,
            "a":w.aim,"aimAt":w.aim_at,"lagMs":w.lag_ms,"rootUntil":w.root_until,"pendingTarget":w.action.and_then(|a|a.target).map(fid),"moveSeq":p.motion.move_seq})
    }).collect();
    if let Some(d) = first_difference(
        "locks",
        &super::canon::rounded(Value::Array(rows)),
        &Value::Array(record.clone()),
    ) {
        rep.fail(format!("tick {}: {d}", t.tick));
    }
}
