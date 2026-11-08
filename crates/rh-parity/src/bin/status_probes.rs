//! Explicit source-helper comparison. Never reads expected output into native setup.
use rh_sim::{
    status_runtime::{self as rt, probe::*},
    Event, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2,
};
use serde_json::{json, Value as V};
use std::{collections::BTreeMap, fs};
type R<T> = Result<T, String>;
#[path = "status_probe/admission.rs"]
mod admission;
#[path = "status_probe/boundary_v3.rs"]
mod boundary_v3;
fn keys(v: &V, allowed: &[&str]) -> R<()> {
    let o = v.as_object().ok_or("expected object")?;
    for k in o.keys() {
        if !allowed.contains(&k.as_str()) {
            return Err(format!("unknown input key {k}"));
        }
    }
    Ok(())
}
fn s(v: &V) -> R<&str> {
    v.as_str().ok_or("expected string".into())
}
fn n(v: &V) -> R<f64> {
    v.as_f64()
        .filter(|v| v.is_finite())
        .ok_or("expected finite number".into())
}
fn parse<T: serde::de::DeserializeOwned>(v: &V) -> R<T> {
    serde_json::from_value(v.clone()).map_err(|e| e.to_string())
}
fn undef() -> V {
    json!({"$undefined":true})
}
fn equal(a: &V, b: &V, path: &str) -> R<()> {
    if let (Some(a), Some(b)) = (a.as_f64(), b.as_f64()) {
        if a == b {
            return Ok(());
        }
    }
    match (a, b) {
        (V::Array(a), V::Array(b)) if a.len() == b.len() => {
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                equal(a, b, &format!("{path}/{i}"))?
            }
            Ok(())
        }
        (V::Object(a), V::Object(b)) if a.keys().eq(b.keys()) => {
            for (k, a) in a {
                equal(a, &b[k], &format!("{path}/{k}"))?
            }
            Ok(())
        }
        _ if a == b => Ok(()),
        _ => Err(format!("{path}: native {a} != source {b}")),
    }
}
#[derive(Clone, Default)]
struct Ids {
    actors: Vec<String>,
    fields: Vec<String>,
    aliases: BTreeMap<String, u32>,
    modifiers: BTreeMap<u32, boundary_v3::Modifiers>,
}
impl Ids {
    fn id(&mut self, v: &V) -> R<Option<PlayerId>> {
        let v = s(v)?;
        if v.is_empty() {
            return Ok(None);
        };
        if let Some(i) = self.actors.iter().position(|a| a == v) {
            Ok(Some(PlayerId(i as u32 + 1)))
        } else {
            self.actors.push(v.into());
            Ok(Some(PlayerId(self.actors.len() as u32)))
        }
    }
    fn player(&mut self, v: &V) -> R<PlayerId> {
        self.id(v)?.ok_or("empty actor".into())
    }
    fn name(&self, id: Option<PlayerId>) -> &str {
        id.map_or("", |id| self.actors[(id.0 - 1) as usize].as_str())
    }
    fn field(&mut self, v: &V) -> R<u32> {
        let v = s(v)?;
        if let Some(i) = self.fields.iter().position(|a| a == v) {
            Ok(i as u32 + 1)
        } else {
            self.fields.push(v.into());
            Ok(self.fields.len() as u32)
        }
    }
    fn source(&mut self, v: &V) -> R<rt::StatusSource> {
        keys(v, &["id", "name", "ownerId"])?;
        Ok(rt::StatusSource {
            id: self.id(&v["id"])?,
            name: s(&v["name"])?.into(),
            owner_id: v.get("ownerId").map(|v| self.id(v)).transpose()?.flatten(),
        })
    }
    fn source_out(&self, v: &rt::StatusSource) -> V {
        let mut out = json!({"id":self.name(v.id),"name":v.name});
        if let Some(id) = v.owner_id {
            out["ownerId"] = json!(self.name(Some(id)));
        }
        out
    }
    fn apply(&mut self, v: &V) -> R<(rt::StatusApply, bool)> {
        keys(
            v,
            &[
                "source", "kind", "ms", "ability", "tag", "value", "add", "data", "quiet",
            ],
        )?;
        let data = v.get("data").map(|v| self.payload(v)).transpose()?;
        Ok((
            rt::StatusApply {
                source: self.source(&v["source"])?,
                kind: parse(&v["kind"])?,
                ms: n(&v["ms"])?,
                ability: v.get("ability").map(parse).transpose()?,
                tag: v
                    .get("tag")
                    .map(|v| s(v).map(rt::StatusTag::from))
                    .transpose()?,
                value: v.get("value").map(n).transpose()?,
                add: v.get("add").map(parse).transpose()?,
                data,
            },
            v.get("quiet")
                .map(|v| v.as_bool().ok_or("quiet boolean"))
                .transpose()?
                .unwrap_or(false),
        ))
    }
    fn payload(&mut self, v: &V) -> R<rt::Payload> {
        keys(
            v,
            &[
                "revealUntil",
                "fieldId",
                "dealtMult",
                "takenFromSourceMult",
                "moveMult",
                "floorHp",
                "healShare",
                "shares",
            ],
        )?;
        let mut p = rt::Payload::default();
        for (k, v) in v.as_object().unwrap() {
            let bit = match k.as_str() {
                "revealUntil" => 1,
                "fieldId" => 2,
                "dealtMult" => 4,
                "takenFromSourceMult" => 8,
                "moveMult" => 16,
                "floorHp" => 32,
                "healShare" => 64,
                "shares" => 128,
                _ => unreachable!(),
            };
            if *v == undef() {
                p.undefined_fields |= bit;
                continue;
            }
            match k.as_str() {
                "revealUntil" => p.reveal_until = Some(n(v)?),
                "fieldId" => p.field_id = Some(self.field(v)?),
                "dealtMult" => p.dealt_mult = Some(n(v)?),
                "takenFromSourceMult" => p.taken_from_source_mult = Some(n(v)?),
                "moveMult" => p.move_mult = Some(n(v)?),
                "floorHp" => p.floor_hp = Some(n(v)?),
                "healShare" => p.heal_share = Some(n(v)?),
                "shares" => {
                    keys(v, &["phys", "magic", "true"])?;
                    p.shares = Some(rh_sim::content::DamageShares {
                        phys: n(&v["phys"])?,
                        magic: n(&v["magic"])?,
                        true_: n(&v["true"])?,
                    })
                }
                _ => unreachable!(),
            }
        }
        Ok(p)
    }
    fn field_input(&mut self, v: &V) -> R<rt::Field> {
        keys(
            v,
            &[
                "kind",
                "ability",
                "owner",
                "subject",
                "x",
                "y",
                "x2",
                "y2",
                "r",
                "vx",
                "vy",
                "startedAt",
                "endsAt",
                "exitStunMs",
            ],
        )?;
        Ok(rt::Field {
            id: 0,
            kind: parse(&v["kind"])?,
            ability: parse(&v["ability"])?,
            owner: self.source(&v["owner"])?,
            subject: if v["subject"].is_null() {
                None
            } else {
                self.id(&v["subject"])?
            },
            x: n(&v["x"])?,
            y: n(&v["y"])?,
            x2: n(&v["x2"])?,
            y2: n(&v["y2"])?,
            r: n(&v["r"])?,
            vx: n(&v["vx"])?,
            vy: n(&v["vy"])?,
            started_at: n(&v["startedAt"])?,
            ends_at: n(&v["endsAt"])?,
            exit_stun_ms: v.get("exitStunMs").map(n).transpose()?,
        })
    }
    fn field_out(&self, f: &rt::Field) -> V {
        let mut out = json!({"id":self.fields[(f.id-1)as usize],"kind":f.kind,"ability":f.ability,"owner":self.source_out(&f.owner),"subject":f.subject.map(|id|self.name(Some(id))),"x":f.x,"y":f.y,"x2":f.x2,"y2":f.y2,"r":f.r,"vx":f.vx,"vy":f.vy,"startedAt":f.started_at,"endsAt":f.ends_at});
        if let Some(ms) = f.exit_stun_ms {
            out["exitStunMs"] = json!(ms)
        }
        out
    }
    fn fields_out(&self, a: Option<&rt::AbilityRuntime>) -> V {
        json!(a
            .map(|a| a
                .fields
                .iter()
                .map(|f| json!([self.fields[(f.id - 1) as usize], self.field_out(f)]))
                .collect::<Vec<_>>())
            .unwrap_or_default())
    }
    fn ability_out(&self, a: Option<&rt::AbilityRuntime>) -> V {
        let Some(a) = a else { return V::Null };
        json!({"fields":self.fields_out(Some(a)),"mirrors":a.fields.iter().map(|f|json!([self.fields[(f.id-1)as usize],{"kind":f.kind as u8,"ability":f.ability as u8,"x":f.x,"y":f.y,"x2":f.x2,"y2":f.y2,"r":f.r,"vx":f.vx,"vy":f.vy,"owner":self.name(f.owner.id),"subject":self.name(f.subject),"startedAt":f.started_at,"endsAt":f.ends_at}])).collect::<Vec<_>>(),"dotSince":a.dot_since,"teleportedAt":a.teleported_at.map_or_else(undef,|v|json!(v)),"dot":a.dot.iter().map(|d|json!([format!("{}|{}|{}",self.name(Some(d.victim)),self.name(d.by),d.ability.as_str()),{"victim":self.name(Some(d.victim)),"by":self.name(d.by),"ability":d.ability,"amount":d.amount}])).collect::<Vec<_>>()})
    }
    fn hit(&mut self, v: &V) -> R<ProbeHit> {
        keys(
            v,
            &[
                "by", "victim", "packet", "weapon", "stagger", "dot", "ability", "arena", "sig",
            ],
        )?;
        let p = &v["packet"];
        keys(p, &["raw", "phys", "magic", "true", "crit", "mult"])?;
        Ok(ProbeHit {
            sig: v
                .get("sig")
                .map(|v| match s(v)? {
                    "burn" => Ok(rh_sim::factions::SignatureKind::Burn),
                    "disease" => Ok(rh_sim::factions::SignatureKind::Disease),
                    _ => Err("unsupported signature helper".to_owned()),
                })
                .transpose()?,
            source: self.source(&v["by"])?,
            victim: self.player(&v["victim"])?,
            packet: rh_sim::state::Packet {
                raw: n(&p["raw"])?,
                phys: n(&p["phys"])?,
                magic: n(&p["magic"])?,
                true_: n(&p["true"])?,
            },
            weapon: if v["weapon"].is_null() {
                None
            } else {
                Some(rh_sim::WeaponId::parse(s(&v["weapon"])?).ok_or("weapon")?)
            },
            stagger: v["stagger"].as_bool().ok_or("stagger")?,
            dot: v
                .get("dot")
                .map(|v| v.as_bool().ok_or("dot"))
                .transpose()?
                .unwrap_or(false),
            ability: v.get("ability").map(parse).transpose()?,
            arena: v
                .get("arena")
                .map(|v| v.as_bool().ok_or("arena"))
                .transpose()?
                .unwrap_or(false),
            critical: p
                .get("crit")
                .map(|v| v.as_bool().ok_or("crit"))
                .transpose()?
                .unwrap_or(false),
            critical_mult: p.get("mult").map(n).transpose()?,
        })
    }
    fn hit_out(&self, h: &ProbeHit) -> V {
        let mut out = json!({"by":self.source_out(&h.source),"victim":self.name(Some(h.victim)),"packet":{"raw":h.packet.raw,"phys":h.packet.phys,"magic":h.packet.magic,"true":h.packet.true_},"weapon":h.weapon.map(|w|w.as_str()),"stagger":h.stagger,"scale":1});
        if let Some(sig) = h.sig {
            out["sig"] = json!(sig.as_str())
        }
        if h.dot {
            out["dot"] = json!(true)
        }
        if h.arena {
            out["arena"] = json!(true)
        }
        if let Some(a) = h.ability {
            out["ability"] = json!(a)
        }
        if h.critical {
            out["packet"]["crit"] = json!(true)
        }
        if let Some(v) = h.critical_mult {
            out["packet"]["mult"] = json!(v)
        }
        out
    }
    fn status(&self, st: &rt::StatusInstance) -> V {
        let mut out = json!({"kind":st.kind,"source":self.source_out(&st.source),"startedAt":st.started_at,"until":st.until,"value":st.value});
        if let Some(a) = st.ability {
            out["ability"] = json!(a)
        }
        if let Some(t) = &st.tag {
            out["tag"] = json!(t.as_str())
        }
        if let Some(v) = st.reveal_from {
            out["revealFrom"] = json!(v)
        }
        if let Some(v) = st.taken {
            out["taken"] = json!(v)
        }
        let p = &st.data;
        for (k, bit, v) in [
            ("revealUntil", 1, p.reveal_until.map(|v| json!(v))),
            (
                "fieldId",
                2,
                p.field_id.map(|i| json!(self.fields[(i - 1) as usize])),
            ),
            ("dealtMult", 4, p.dealt_mult.map(|v| json!(v))),
            (
                "takenFromSourceMult",
                8,
                p.taken_from_source_mult.map(|v| json!(v)),
            ),
            ("moveMult", 16, p.move_mult.map(|v| json!(v))),
            ("floorHp", 32, p.floor_hp.map(|v| json!(v))),
            ("healShare", 64, p.heal_share.map(|v| json!(v))),
            (
                "shares",
                128,
                p.shares
                    .map(|v| json!({"phys":v.phys,"magic":v.magic,"true":v.true_})),
            ),
        ] {
            if let Some(v) = v {
                out[k] = v
            } else if p.undefined_fields & bit != 0 {
                out[k] = undef()
            }
        }
        out
    }
}
fn negative_infinity() -> V {
    json!({"$number":"-Infinity"})
}
fn weapon(ids: &Ids, p: &rh_sim::state::Player) -> V {
    let w = &p.weapon;
    let t = &w.targeting;
    let action=w.action.map(|a|json!({"kind":format!("{:?}",a.kind).to_lowercase(),"weapon":a.weapon.as_str(),"a":a.a,"startedAt":a.started_at,"landsAt":a.lands_at,"target":a.target.map_or_else(undef,|id|json!(ids.name(Some(id)))),"packet":{"raw":a.packet.raw,"phys":a.packet.phys,"magic":a.packet.magic,"true":a.packet.true_}}));
    json!({"readyAt":w.ready_at,"state":{"action":action,"aim":w.aim,"aimAt":w.aim_at,"attackMoveGoal":t.attack_move,"bufferedUntil":w.buffered_until,"held":w.held,"lagMs":w.lag_ms,"lock":t.target.map(|id|ids.name(Some(id))),"lockGoal":t.goal,"lockLosLostAt":t.lost_at.unwrap_or(0.),"lockPlanAt":t.plan_at.map_or_else(negative_infinity,|v|json!(v)),"lockSearchAt":t.search_at.map_or_else(negative_infinity,|v|json!(v)),"lockSeen":t.seen,"pressedAt":w.pressed_at,"rootUntil":w.root_until,"staggerImmuneUntil":w.stagger_immune_until}})
}
fn actors(ids: &Ids, snap: &Snapshot) -> V {
    json!(snap.players.iter().map(|p|json!({"id":ids.name(Some(p.id)),"role":"player","name":p.seat.profile,"sig":p.signature.bits,"standing":p.standing(),"hp":p.vitals.hp,"maxHp":p.vitals.max_hp,"barrier":p.vitals.barrier,"immuneUntil":p.vitals.immune_until,"effects":p.statuses.effects,"asMult":rh_sim::stat_fold::decode_mult(p.modifiers.attack_rate_wire()),"body":body(p),"armorBonus":p.modifiers.mirrors().armor_bonus,"weapon":weapon(ids,p),"cast":p.statuses.cast.map(|c|json!({"ability":c.ability,"startedAt":c.started_at,"landsAt":c.lands_at})),"cards":({let c=p.card_dot_crit.unwrap_or_default();json!({"critAccDot":c.accumulator,"dotRollTick":c.roll_tick.map_or(-1,|v|v as i64),"dotCrit":c.critical})}),"statuses":if p.statuses.initialized{json!(p.statuses.instances.iter().map(|s|ids.status(s)).collect::<Vec<_>>())}else{undef()}})).collect::<Vec<_>>())
}
fn body(p: &rh_sim::state::Player) -> V {
    let slip = p.motion.slip.as_ref().map(|s| {
        let mut v = json!({"vx":s.vx,"vy":s.vy,"ax":s.ax,"ay":s.ay,"path":s.path});
        for (k, n) in [
            ("replanAt", s.replan_at),
            ("stuckX", s.stuck_x),
            ("stuckY", s.stuck_y),
            ("stuckN", s.stuck_n),
            ("stuckBest", s.stuck_best),
            ("stuckAt", s.stuck_at),
            ("gripUntil", s.grip_until),
        ] {
            if let Some(n) = n {
                v[k] = json!(n)
            }
        }
        v
    });
    json!({"x":p.body.x,"y":p.body.y,"facing":p.body.facing,"displaceSeq":p.motion.displace_seq,"path":p.motion.path.as_slice(),"history":p.body.history.as_slice(),"slip":slip})
}
fn expected_actors(v: &V) -> R<V> {
    Ok(json!(v.as_array().ok_or("fighters array")?.iter().map(|p|json!({"id":p["id"],"role":p["role"],"name":p["name"],"sig":p["sig"],"standing":p["standing"],"hp":p["hp"],"maxHp":p["maxHp"],"barrier":p["barrier"],"immuneUntil":p["immuneUntil"],"effects":p["effects"],"asMult":p["mirrors"]["asMult"],"body":p["body"],"armorBonus":p["mirrors"]["armorBonus"],"weapon":({let mut w=p["weapon"].clone();if let Some(o)=w["state"].as_object_mut(){o.remove("lastShotAt");}w}),"cards":if p["cards"]==undef(){json!({"critAccDot":0,"dotRollTick":-1,"dotCrit":false})}else{p["cards"].clone()},"cast":if p["cast"].is_null(){V::Null}else{json!({"ability":p["cast"]["ability"],"startedAt":p["cast"]["startedAt"],"landsAt":p["cast"]["landsAt"]})},"statuses":p["statuses"]})).collect::<Vec<_>>()))
}
fn events(ids: &Ids, snap: &Snapshot) -> R<V> {
    Ok(json!(snap.events.iter().map(|e|match e{Event::StatusApplied{id,kind,ms,by}=>Ok(json!({"type":"fx","fx":{"kind":"status","id":ids.name(Some(*id)),"status":kind,"ms":ms,"by":by.map(|id|ids.name(Some(id)))}})),Event::CastEnded{id,ability,reason}=>Ok(json!({"type":"fx","fx":{"kind":"castEnd","by":ids.name(Some(*id)),"ability":ability,"reason":reason}})),Event::Hit{victim,by,amount,weapon,..}=>Ok(json!({"type":"fx","fx":{"kind":"hit","id":ids.name(Some(*victim)),"by":ids.name(*by),"amount":amount,"weapon":weapon.map(|w|w.as_str())}})),
 Event::Heal{id,amount}=>Ok(json!({"type":"fx","fx":{"kind":"heal","id":ids.name(Some(*id)),"amount":amount}})),
 Event::AbilityHit{victim,by,ability,amount}=>Ok(json!({"type":"fx","fx":{"kind":"hit","id":ids.name(Some(*victim)),"by":ids.name(*by),"amount":amount,"weapon":null,"ability":ability}})),
 Event::Resolved{id,result,..}=>Ok(json!({"type":"resolved","id":ids.name(Some(*id)),"result":{"profile":result.profile,"outcome":format!("{:?}",result.outcome).to_lowercase(),"durationSec":result.duration_sec,"kills":result.kills,"killedBy":result.killed_by,"place":result.place,"players":result.players,"gv":result.gv,"winBonusWithheld":result.win_bonus_withheld}})),
 Event::Windup{by,weapon,a,ms}=>Ok(json!({"type":"fx","fx":{"kind":"windup","by":ids.name(Some(*by)),"weapon":weapon.as_str(),"a":a,"ms":ms}})),
 Event::Swing{by,weapon,x,y,a}=>Ok(json!({"type":"fx","fx":{"kind":"swing","by":ids.name(Some(*by)),"weapon":weapon.as_str(),"x":x,"y":y,"a":a}})),
 Event::Death{id,x,y,by}=>Ok(json!({"type":"fx","fx":{"kind":"death","id":ids.name(Some(*id)),"by":by.map(|id|ids.name(Some(id))),"x":x,"y":y}})),
 Event::Gv{id,amount,reason}=>Ok(json!({"type":"gv","id":ids.name(Some(*id)),"amount":amount,"reason":format!("{reason:?}").to_lowercase()})),
 e=>Err(format!("unmapped event {e:?}"))}).collect::<R<Vec<_>>>()?))
}
fn check_state(ids: &Ids, snap: &Snapshot, source: &V, label: &str) -> R<()> {
    let e = &source["runtime"];
    equal(
        &actors(ids, snap),
        &expected_actors(&e["fighters"])?,
        &format!("{label}/fighters"),
    )?;
    let suppressed: Vec<_> = snap
        .suppressed
        .iter()
        .map(|(id, value)| json!([ids.name(Some(*id)), value]))
        .collect();
    equal(
        &json!(suppressed),
        &if e["marks"] == undef() {
            json!([])
        } else {
            e["marks"]["suppressed"].clone()
        },
        &format!("{label}/mark suppression"),
    )?;
    equal(&json!(snap.time), &e["clock"]["serverTime"], label)?;
    equal(&json!(snap.tick), &e["clock"]["tick"], label)?;
    equal(&json!(snap.collecting), &e["collecting"], label)?;
    equal(
        &json!(snap.payouts),
        &json!(e["payouts"].as_array().ok_or("payouts")?.len()),
        label,
    )?;
    equal(
        &events(ids, snap)?,
        &e["events"],
        &format!("{label}/events"),
    )?;
    equal(
        &json!(snap.entity_counter),
        &e["entityCounter"],
        &format!("{label}/entityCounter"),
    )?;
    let callbacks:Vec<_>=snap.callbacks.iter().map(|c|json!({"hook":"hurt","victim":ids.name(Some(c.victim)),"operation":c.operation,"collecting":c.collecting,"statuses":c.statuses.iter().map(|s|ids.status(s)).collect::<Vec<_>>(),"returned":match &c.returned{CallbackReturn::Undefined=>undef(),CallbackReturn::Status(st)=>st.as_ref().map_or(V::Null,|s|ids.status(s)),CallbackReturn::Statuses(st)=>json!(st.iter().map(|s|ids.status(s)).collect::<Vec<_>>()),CallbackReturn::Hit(h)=>ids.hit_out(h)}})).collect();
    let expected_callbacks = e["callbackOperations"]
        .as_array()
        .ok_or("callback operations")?
        .iter()
        .map(|c| {
            let mut c = c.clone();
            c["operation"] = serde_json::to_value(reaction(&c["operation"], &mut ids.clone())?)
                .map_err(|e| e.to_string())?;
            Ok(c)
        })
        .collect::<R<Vec<_>>>()?;
    equal(
        &json!(callbacks),
        &json!(expected_callbacks),
        &format!("{label}/callbacks"),
    )?;
    let landed:Vec<_>=snap.landed.iter().map(|h|{let mut v=json!({"by":ids.name(h.by),"victim":ids.name(Some(h.victim)),"amount":h.amount,"weapon":h.weapon.map(|w|w.as_str()),"sig":h.sig.map_or_else(undef,|s|json!(format!("{s:?}").to_lowercase()))});if h.dot{v["dot"]=json!(true)}
if h.critical{v["crit"]=json!(true)}
if let Some(a)=h.ability{v["ability"]=json!(a)}
if h.cut!=1.{v["cut"]=json!(h.cut)}v}).collect();
    equal(&json!(landed), &e["landed"], &format!("{label}/landed"))?;
    let ability = if e["abilities"].is_null() {
        V::Null
    } else {
        json!({"fields":e["abilities"]["fields"],"mirrors":e["abilities"]["mirrors"],"dot":e["abilities"]["dot"],"dotSince":e["abilities"]["dotSince"],"teleportedAt":e["abilities"]["teleportedAt"]})
    };
    equal(
        &ids.ability_out(snap.abilities.as_ref()),
        &ability,
        &format!("{label}/abilities"),
    )?;
    equal(
        &json!(snap
            .ledger
            .iter()
            .map(|h| ids.hit_out(h))
            .collect::<Vec<_>>()),
        &json!(e["ledger"]
            .as_array()
            .ok_or("ledger")?
            .iter()
            .map(normalized_hit)
            .collect::<Vec<_>>()),
        &format!("{label}/ledger"),
    )?;
    equal(
        &json!(snap
            .deferred
            .iter()
            .map(|h| ids.hit_out(h))
            .collect::<Vec<_>>()),
        &json!(e["deferred"]
            .as_array()
            .ok_or("deferred")?
            .iter()
            .map(normalized_hit)
            .collect::<Vec<_>>()),
        &format!("{label}/deferred"),
    )?;
    Ok(())
}
fn reads(ids: &Ids, snap: &Snapshot, id: PlayerId, at: Option<f64>, view: rt::StatView) -> R<V> {
    let p = snap
        .players
        .iter()
        .find(|p| p.id == id)
        .ok_or("read actor")?;
    let bob = snap.players.get(1).ok_or("bob")?;
    read_table(
        ids,
        &p.statuses,
        snap.time,
        (&bob.statuses.instances, Some(bob.id)),
        p.signature.bits & 1 != 0,
        at,
        view,
    )
}
fn read_table(
    ids: &Ids,
    rt: &rt::StatusRuntime,
    now: f64,
    attacker: (&[rt::StatusInstance], Option<PlayerId>),
    frost_chilled: bool,
    at: Option<f64>,
    view: rt::StatView,
) -> R<V> {
    let (attacker, by) = attacker;
    let list = &rt.instances;
    let target = rt::untargetable(list, now);
    Ok(
        json!({"statuses":list.iter().map(|s|ids.status(s)).collect::<Vec<_>>(),"values":rt::STATUS_KINDS.map(|kind|json!({"kind":kind,"value":rt::value(list,kind,now)})),"stunned":rt::has(list,rt::StatusKind::Stun,now),"rooted":rt::has(list,rt::StatusKind::Root,now),"silenced":rt::has(list,rt::StatusKind::Silence,now),"slowed":rt::slowed(list,now,frost_chilled),"hidden":rt::hidden(list,now),"untargetable":target,"untargetableId":target,"untargetableAt":rt::untargetable(list,at.unwrap_or(now)),"casting":rt::is_casting(rt.cast),"cannotMove":rt::cannot_move(rt,now),"actionBlocked":rt::action_blocked(rt,now),"castBlocked":rt::cast_blocked(rt,now,rt::CancelCauses{stun:true,silence:true,root:true,stagger:false}),"effects":rt::effects_of(list,rt.cast,now),"healFactor":rt::heal_factor(list,now),"attackSlowFactor":rt::attack_slow_factor(list,now,view.slow_resist),"moveMultiplier":rt::move_multiplier(rt,now,view.slow_resist,view.buff_move),"dealtFactor":rt::dealt_factor(list,now),"damageFactor":rt::damage_factor(attacker,list,by,now)}),
    )
}
fn hook_actor(ids: &Ids, p: &rh_sim::state::Player) -> V {
    json!({"id":ids.name(Some(p.id)),"hp":p.vitals.hp,"effects":p.statuses.effects,"asMult":p.modifiers.attack_rate_wire(),"immuneUntil":p.vitals.immune_until,"statuses":if p.statuses.initialized{json!(p.statuses.instances.iter().map(|s|ids.status(s)).collect::<Vec<_>>())}else{undef()}})
}
fn hooks(ids: &Ids, list: &[HookRecord]) -> R<V> {
    Ok(json!(list.iter().map(|r|match r{HookRecord::StatusApplied{actor,status,fresh}=>Ok(json!({"name":"statusApplied","actor":hook_actor(ids,actor),"status":ids.status(status),"fresh":fresh})),HookRecord::AttackStarted{actor}=>Ok(json!({"name":"attackStarted","actor":hook_actor(ids,actor)})),HookRecord::CastEnded{actor,ability,reason}=>Ok(json!({"name":"castEnded","actor":hook_actor(ids,actor),"ability":ability,"reason":reason})),HookRecord::Hurt{actor,amount,before}=>Ok(json!({"name":"hurt","actor":hook_actor(ids,actor),"amount":amount,"before":before})),
 HookRecord::CastAccepted{..}|HookRecord::CastLanded{..}=>Err("full producer hook outside isolated status harness".into()),
 HookRecord::Staggered{..}=>Err("full producer hook outside isolated status harness".into()),
 // The regional mob lifecycle hooks never fire in the isolated status harness (it has no mobs or camps).
 HookRecord::MobKilled{..}|HookRecord::CampCleared{..}=>Err("full producer hook outside isolated status harness".into()),
 HookRecord::HitLanded{hit,amount}=>Ok(json!({"name":"hitLanded","hit":ids.hit_out(hit),"amount":amount})),
 HookRecord::ArenaHurt{victim,by,source,amount}=>Ok(json!({"name":"arenaHurt","victim":ids.name(Some(*victim)),"by":source.as_ref().map(|s|ids.source_out(s)).unwrap_or(json!({"id":ids.name(*by),"name":""})),"amount":amount})),
 HookRecord::Healed{actor,amount,source}=>Ok(json!({"name":"healed","actor":hook_actor(ids,actor),"amount":amount,"source":match source{HealSource::Lifesteal=>"lifesteal",HealSource::DeathFloor=>"lastStand",_=>"other"}})),
 HookRecord::FighterOut{id,removed}=>Ok(json!({"name":"fighterOut","id":ids.name(Some(*id)),"cause":if *removed{"removed"}else{"down"}})),HookRecord::Teleported=>Ok(json!({"name":"teleported"})),HookRecord::RunEnded=>Ok(json!({"name":"runEnded"})),
}).collect::<R<Vec<_>>>()?))
}
fn expected_hooks(v: &V) -> R<V> {
    Ok(json!(v.as_array().ok_or("hooks array")?.iter().map(|h|{let a=&h["args"][0];let actor=json!({"id":a["id"],"hp":a["state"]["hp"],"effects":a["state"]["effects"],"asMult":a["state"]["asMult"],"immuneUntil":a["state"]["immuneUntil"],"statuses":a["statuses"]});match h["name"].as_str(){Some("statusApplied")=>Ok(json!({"name":"statusApplied","actor":actor,"status":h["args"][1],"fresh":h["args"][2]})),Some("attackStarted")=>Ok(json!({"name":"attackStarted","actor":actor})),Some("castEnded")=>Ok(json!({"name":"castEnded","actor":actor,"ability":h["args"][1],"reason":h["args"][2]})),Some("hurt")=>Ok(json!({"name":"hurt","actor":actor,"amount":h["args"][1],"before":h["args"][2]})),
 Some("hitLanded")=>Ok(json!({"name":"hitLanded","hit":normalized_hit(&h["args"][0]),"amount":h["args"][1]})),
 Some("arenaHurt")=>Ok(json!({"name":"arenaHurt","victim":h["args"][0],"by":h["args"][1],"amount":h["args"][2]})),
 Some("healed")=>Ok(json!({"name":"healed","actor":actor,"amount":h["args"][1],"source":h["args"][2]})),
 Some("fighterOut")=>Ok(json!({"name":"fighterOut","id":h["args"][0],"cause":h["args"][1]})),Some("teleported")=>Ok(json!({"name":"teleported"})),Some("runEnded")=>Ok(json!({"name":"runEnded"})),
 _=>Err("unmapped source hook".into())}}).collect::<R<Vec<_>>>()?))
}
fn build(v: &V, ids: &mut Ids) -> R<Harness> {
    keys(
        v,
        &[
            "seed",
            "randomSeed",
            "rewardSalt",
            "questSalt",
            "newItemUid",
            "config",
            "modules",
            "mapRows",
            "players",
            "clock",
            "trusted",
        ],
    )?;
    let mut placements = Vec::new();
    for p in v["players"].as_array().ok_or("players")? {
        keys(p, &["id", "name", "faction", "patch", "runtime"])?;
        let id = ids.player(&p["id"])?;
        if id.0 != placements.len() as u32 + 1 {
            return Err("duplicate player".into());
        }
        if p["faction"] != "fire" {
            return Err("fixture faction".into());
        }
        let patch = &p["patch"];
        keys(patch, &["x", "y", "immuneUntil", "weapon0"])?;
        placements.push(Placement {
            profile: s(&p["name"])?.into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(n(&patch["x"])?, n(&patch["y"])?),
            hp: None,
            weapon0: if patch["weapon0"] == "" {
                None
            } else {
                Some(rh_sim::WeaponId::parse(s(&patch["weapon0"])?).ok_or("weapon0")?)
            },
            weapon1: None,
        });
    }
    let map = rh_sim::TileMap::from_rows(&parse::<Vec<String>>(&v["mapRows"])?)
        .map_err(|e| e.to_string())?;
    let sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: true,
            min_players: usize::try_from(v["config"]["minPlayers"].as_u64().ok_or("minPlayers")?)
                .map_err(|_| "minPlayers overflow")?,
            lobby_seconds: n(&v["config"]["lobbySeconds"])?,
            fill_seconds: n(&v["config"]["fillSeconds"])?,
            pvp_rules: v["config"]["pvpRules"].as_bool().ok_or("pvpRules")?,
            faction_mode: if v["modules"]["signatures"] == true {
                rh_sim::FactionMode::EngagementHolyPlagueFireFrostSentenced
            } else {
                rh_sim::FactionMode::Off
            },
            ..Default::default()
        },
        rh_sim::sim::Arena {
            map,
            spawns: placements.iter().map(|p| p.at).collect(),
        },
        Secrets::from_seed(v["seed"].as_u64().ok_or("seed")?),
        &placements,
    );
    let mut h = Harness::new(sim);
    h.execute(Operation::Clock {
        at: n(&v["clock"]["serverTime"])?,
        tick: u32::try_from(v["clock"]["tick"].as_u64().ok_or("tick")?)
            .map_err(|_| "tick overflow")?,
    })?;
    for p in v["players"].as_array().unwrap() {
        h.execute(Operation::Actor {
            id: ids.player(&p["id"])?,
            patch: ActorPatch {
                immune_until: Some(n(&p["patch"]["immuneUntil"])?),
                history: Some(parse(&p["runtime"]["history"])?),
                path: Some(parse(&p["runtime"]["path"])?),
                ..Default::default()
            },
        })?;
    }
    keys(
        &v["trusted"],
        &[
            "actorOverrides",
            "runtimeOverrides",
            "signatures",
            "pvpRules",
            "splitMap",
            "markSuppressed",
        ],
    )?;
    for (group, runtime) in [("actorOverrides", false), ("runtimeOverrides", true)] {
        if let Some(patches) = v["trusted"].get(group) {
            for (id, patch) in patches.as_object().ok_or("patches")? {
                let id = ids.player(&json!(id))?;
                h.execute(Operation::Actor {
                    id,
                    patch: {
                        let mut out = actor_patch_current(patch, runtime, &h, id)?;
                        if let Some(at) = out.position {
                            out.history = Some(vec![rh_sim::state::Sample {
                                t: n(&v["clock"]["serverTime"])?,
                                x: at.x,
                                y: at.y,
                            }]);
                        }
                        out
                    },
                })?;
            }
        }
    }
    if let Some(rows) = v["trusted"].get("markSuppressed") {
        for row in rows.as_array().ok_or("mark rows")? {
            let row = row
                .as_array()
                .filter(|r| r.len() == 2)
                .ok_or("mark tuple")?;
            let id = ids.player(&row[0])?;
            let mut view = h.stat_view(id);
            view.mark_suppression = Some(n(&row[1])?);
            h.set_stats(id, view);
        }
    }
    Ok(h)
}
fn actor_patch(v: &V, runtime: bool) -> R<ActorPatch> {
    let mut p = ActorPatch::default();
    if runtime {
        keys(v, &["down", "cast"])?;
        if let Some(d) = v.get("down") {
            keys(d, &["outcome"])?;
            p.down = Some(Some(match s(&d["outcome"])? {
                "died" => rh_sim::results::Outcome::Died,
                _ => return Err("down outcome".into()),
            }))
        }
        if let Some(c) = v.get("cast") {
            keys(
                c,
                &[
                    "ability",
                    "rank",
                    "slot",
                    "startedAt",
                    "landsAt",
                    "target",
                    "point",
                    "landing",
                    "prevReadyAt",
                    "lagMs",
                ],
            )?;
            p.cast = Some(Some(rt::CastFact {
                producer: None,
                ability: parse(&c["ability"])?,
                started_at: n(&c["startedAt"])?,
                lands_at: n(&c["landsAt"])?,
                cancelled_by: rt::CancelCauses {
                    stun: true,
                    silence: true,
                    root: false,
                    stagger: false,
                },
            }));
        }
    } else {
        keys(
            v,
            &[
                "hp",
                "maxHp",
                "barrier",
                "immuneUntil",
                "status",
                "weapon0",
                "x",
                "y",
                "sig",
                "displaceSeq",
            ],
        )?;
        p.hp = v.get("hp").map(n).transpose()?;
        p.max_hp = v.get("maxHp").map(n).transpose()?;
        p.barrier = v.get("barrier").map(n).transpose()?;
        p.immune_until = v.get("immuneUntil").map(n).transpose()?;
        p.status = v
            .get("status")
            .map(|v| match s(v)? {
                "dead" => Ok(rh_sim::Status::Dead),
                "alive" => Ok(rh_sim::Status::Alive),
                _ => Err("actor status".to_owned()),
            })
            .transpose()?;
        p.displace_seq = v
            .get("displaceSeq")
            .map(|v| {
                v.as_u64()
                    .and_then(|n| u8::try_from(n).ok())
                    .ok_or("displaceSeq".to_owned())
            })
            .transpose()?;
        p.signature_bits = v
            .get("sig")
            .map(|v| {
                v.as_u64()
                    .and_then(|n| u8::try_from(n).ok())
                    .ok_or("sig".to_owned())
            })
            .transpose()?;
        if let Some(w) = v.get("weapon0") {
            p.weapon0 = Some(if s(w)?.is_empty() {
                None
            } else {
                Some(rh_sim::WeaponId::parse(s(w)?).ok_or("weapon")?)
            });
        }
        if v.get("x").is_some() && v.get("y").is_some() {
            p.position = Some(Vec2::new(n(&v["x"])?, n(&v["y"])?));
        } else if v.get("x").is_some() || v.get("y").is_some() {
            return Err("partial position patch requires current actor".into());
        }
    }
    Ok(p)
}
fn normalized_hit(v: &V) -> V {
    let mut v = v.clone();
    if v["arena"] == false {
        v.as_object_mut().unwrap().remove("arena");
    }
    v
}
fn actor_patch_current(v: &V, runtime: bool, h: &Harness, id: PlayerId) -> R<ActorPatch> {
    let mut v = v.clone();
    if !runtime && (v.get("x").is_some() || v.get("y").is_some()) {
        let snap = h.snapshot();
        let p = snap
            .players
            .iter()
            .find(|p| p.id == id)
            .ok_or("actor patch")?;
        if v.get("x").is_none() {
            v["x"] = json!(p.body.x)
        }
        if v.get("y").is_none() {
            v["y"] = json!(p.body.y)
        }
    }
    actor_patch(&v, runtime)
}
fn point(v: &V) -> R<Vec2> {
    keys(v, &["x", "y"])?;
    Ok(Vec2::new(n(&v["x"])?, n(&v["y"])?))
}
fn points(v: &V) -> R<Vec<Vec2>> {
    v.as_array().ok_or("points")?.iter().map(point).collect()
}
fn nested_source(ids: &mut Ids) -> R<rt::StatusSource> {
    ids.source(&json!({"id":"bob","name":"BOB"}))
}
fn selector(op: &V, ids: &mut Ids) -> R<rt::Selector> {
    match s(&op["kind"])? {
        "cleanse" => {
            keys(op, &["kind", "id", "classes"])?;
            let c = parse::<Vec<String>>(&op["classes"])?;
            if c.iter()
                .any(|c| !["soft", "hard", "never"].contains(&c.as_str()))
            {
                return Err("cleanse class".into());
            }
            Ok(rt::Selector::Cleanse {
                soft: c.iter().any(|c| c == "soft"),
                hard: c.iter().any(|c| c == "hard"),
            })
        }
        "remove" => {
            keys(op, &["kind", "id", "selector"])?;
            let s0 = &op["selector"];
            keys(s0, &["kind", "statusKind", "sourceId"])?;
            match s(&s0["kind"])? {
                "all" => Ok(rt::Selector::All),
                "status" => Ok(rt::Selector::Kind(parse(&s0["statusKind"])?)),
                "source" => Ok(rt::Selector::Source(ids.id(&s0["sourceId"])?)),
                _ => Err("selector".into()),
            }
        }
        _ => Err("selector operation".into()),
    }
}
fn reaction(op: &V, ids: &mut Ids) -> R<Reaction> {
    let kind = s(&op["kind"])?;
    if kind == "deferHit" {
        keys(op, &["kind", "hit"])?;
        return Ok(Reaction::DeferHit(ids.hit(&op["hit"])?));
    }
    let id = ids.player(&op["id"])?;
    match kind {
        "apply" => {
            keys(op, &["kind", "id", "apply"])?;
            let (apply, quiet) = ids.apply(&op["apply"])?;
            Ok(Reaction::Apply { id, apply, quiet })
        }
        "remove" | "cleanse" => Ok(Reaction::Remove {
            id,
            selector: selector(op, ids)?,
        }),
        "displace" => {
            keys(op, &["kind", "id", "to"])?;
            Ok(Reaction::Displace {
                id,
                to: point(&op["to"])?,
            })
        }
        "queueNested" => {
            keys(op, &["kind", "id"])?;
            Ok(Reaction::Nested {
                id,
                source: nested_source(ids)?,
            })
        }
        _ => Err("unsupported reaction".into()),
    }
}
fn execute(h: &mut Harness, ids: &mut Ids, op: &V) -> R<V> {
    let kind = s(&op["kind"])?;
    let id = op.get("id").map(|v| ids.player(v)).transpose()?;
    let out = match kind {
        "read" => {
            keys(op, &["kind", "id", "at"])?;
            return reads(
                ids,
                &h.snapshot(),
                id.ok_or("id")?,
                op.get("at").map(n).transpose()?,
                h.stat_view(id.ok_or("id")?),
            );
        }
        "find" => {
            keys(op, &["kind", "id", "statusKind", "sourceId"])?;
            let snap = h.snapshot();
            let p = snap
                .players
                .iter()
                .find(|p| Some(p.id) == id)
                .ok_or("find player")?;
            return Ok(rt::find(
                &p.statuses.instances,
                parse(&op["statusKind"])?,
                op.get("sourceId").map(|v| ids.id(v)).transpose()?,
            )
            .map_or_else(undef, |s| ids.status(s)));
        }
        "apply" => {
            keys(op, &["kind", "id", "apply", "linkField"])?;
            let (mut apply, quiet) = ids.apply(&op["apply"])?;
            if let Some(alias) = op.get("linkField") {
                apply.data.get_or_insert_with(Default::default).field_id =
                    Some(*ids.aliases.get(s(alias)?).ok_or("field alias")?);
            }
            h.execute(Operation::Apply {
                id: id.ok_or("id")?,
                apply,
                quiet,
            })?
        }
        "clock" => {
            keys(op, &["kind", "at"])?;
            h.execute(Operation::Clock {
                at: n(&op["at"])?,
                tick: h.snapshot().tick,
            })?
        }
        "remove" => {
            keys(op, &["kind", "id", "selector"])?;
            keys(&op["selector"], &["kind", "statusKind"])?;
            let selector = match s(&op["selector"]["kind"])? {
                "all" => rt::Selector::All,
                "status" => rt::Selector::Kind(parse(&op["selector"]["statusKind"])?),
                _ => return Err("selector".into()),
            };
            h.execute(Operation::Remove {
                id: id.ok_or("id")?,
                selector,
            })?
        }
        "cleanse" => {
            keys(op, &["kind", "id", "classes"])?;
            let classes = parse::<Vec<String>>(&op["classes"])?;
            if classes
                .iter()
                .any(|c| c != "soft" && c != "hard" && c != "never")
            {
                return Err("cleanse class".into());
            }
            h.execute(Operation::Remove {
                id: id.ok_or("id")?,
                selector: rt::Selector::Cleanse {
                    soft: classes.iter().any(|c| c == "soft"),
                    hard: classes.iter().any(|c| c == "hard"),
                },
            })?
        }
        "reveal" => {
            keys(op, &["kind", "id", "until"])?;
            h.execute(Operation::Reveal {
                id: id.ok_or("id")?,
                until: n(&op["until"])?,
            })?
        }
        "collect" => {
            keys(op, &["kind", "value"])?;
            h.execute(Operation::Collect(
                op["value"].as_bool().ok_or("collect bool")?,
            ))?
        }
        "actorPatch" => {
            keys(op, &["kind", "id", "patch"])?;
            h.execute(Operation::Actor {
                id: id.ok_or("id")?,
                patch: actor_patch_current(&op["patch"], false, h, id.ok_or("id")?)?,
            })?
        }
        "displace" => {
            keys(op, &["kind", "id", "to"])?;
            keys(&op["to"], &["x", "y"])?;
            h.execute(Operation::Displace {
                id: id.ok_or("id")?,
                to: parse(&op["to"])?,
            })?
        }
        "input" => {
            keys(op, &["kind", "id", "type", "message"])?;
            keys(&op["message"], &["a", "t"])?;
            let a = n(&op["message"]["a"])?;
            let t = op["message"].get("t").map(n).transpose()?;
            let raw = match s(&op["type"])? {
                "attack" => rh_sim::RawCommand::Attack { a, t },
                "release" => rh_sim::RawCommand::Release { a, t },
                _ => return Err("input kind".into()),
            };
            h.execute(Operation::Input {
                id: id.ok_or("id")?,
                raw,
            })?;
            return Ok(json!(true));
        }
        "step" => {
            keys(op, &["kind", "ms"])?;
            if n(&op["ms"])? != rh_sim::constants::TICK_MS {
                return Err("step delta".into());
            }
            h.execute(Operation::Step)?
        }
        "fieldsRead" => {
            keys(op, &["kind"])?;
            return Ok(ids.fields_out(h.snapshot().abilities.as_ref()));
        }
        "fieldAdd" => {
            keys(op, &["kind", "alias", "field"])?;
            let f = ids.field_input(&op["field"])?;
            let r = h.execute(Operation::AddField(f))?;
            if let Returned::Field(Some(f)) = &r {
                let mapped = ids.field(&json!(format!("fld{}", f.id)))?;
                if mapped != f.id {
                    return Err("field identity collision".into());
                }
                if ids.aliases.insert(s(&op["alias"])?.into(), f.id).is_some() {
                    return Err("duplicate alias".into());
                }
            }
            r
        }
        "fieldRemove" => {
            keys(op, &["kind", "alias"])?;
            let id = *ids.aliases.get(s(&op["alias"])?).ok_or("field alias")?;
            h.execute(Operation::RemoveField(id))?
        }
        "fieldRemoveWhere" => {
            keys(op, &["kind", "selector"])?;
            keys(&op["selector"], &["kind", "size"])?;
            if op["selector"]["kind"] != "all" {
                return Err("field selector".into());
            }
            let len = h
                .snapshot()
                .abilities
                .as_ref()
                .map_or(0, |a| a.fields.len());
            let expected = op["selector"]["size"].as_u64().ok_or("predicate size")?;
            let predicate = (len as u64) == expected;
            let out = if predicate {
                match h.execute(Operation::RemoveFields(rt::FieldSelector::All))? {
                    Returned::Fields(v) => v,
                    _ => unreachable!(),
                }
            } else {
                Vec::new()
            };
            return Ok(
                json!({"removed":out.iter().map(|f|ids.field_out(f)).collect::<Vec<_>>(),"visited":(0..len).map(|i|json!({"id":ids.fields[i],"size":len})).collect::<Vec<_>>()}),
            );
        }
        "onTrail" => {
            keys(op, &["kind", "alias", "point"])?;
            keys(&op["point"], &["x", "y"])?;
            let id = *ids.aliases.get(s(&op["alias"])?).ok_or("field alias")?;
            let snap = h.snapshot();
            let f = snap
                .abilities
                .as_ref()
                .and_then(|a| a.fields.iter().find(|f| f.id == id))
                .ok_or("trail")?;
            return Ok(json!(rt::on_trail(
                f,
                Vec2::new(n(&op["point"]["x"])?, n(&op["point"]["y"])?)
            )));
        }
        "updateAbilities" => {
            keys(op, &["kind"])?;
            h.execute(Operation::UpdateAbilities)?
        }
        "ledgerHit" => {
            keys(op, &["kind", "hit"])?;
            let hit = ids.hit(&op["hit"])?;
            h.execute(Operation::Hit(hit.clone()))?;
            let mut out = op["hit"].clone();
            out["scale"] = json!(1);
            return Ok(out);
        }
        "applyLedger" => {
            keys(op, &["kind"])?;
            h.execute(Operation::ApplyLedger)?
        }
        "clearLedger" => {
            keys(op, &["kind"])?;
            h.execute(Operation::ClearLedger)?
        }
        "statusDamage" => {
            keys(op, &["kind", "dtMs"])?;
            h.execute(Operation::StatusDamage {
                dt_ms: n(&op["dtMs"])?,
            })?
        }
        "abilityDotFx" => {
            keys(op, &["kind"])?;
            h.execute(Operation::AbilityDotFx)?
        }
        "clearAll" => {
            keys(op, &["kind", "cause"])?;
            h.execute(match s(&op["cause"])? {
                "teleport" => Operation::ClearAll { teleport: true },
                "runEnd" => Operation::ClearAll { teleport: false },
                _ => return Err("clear cause".into()),
            })?
        }
        "runEnded" => {
            keys(op, &["kind"])?;
            h.execute(Operation::RunEnded)?
        }
        "heal" => {
            keys(op, &["kind", "id", "amount", "options"])?;
            let mut source = HealSource::Ordinary;
            if let Some(o) = op.get("options") {
                keys(o, &["lifesteal", "ignoreLockout", "source"])?;
                if o["lifesteal"] == true {
                    source = HealSource::Lifesteal
                } else if o["source"] == "lastStand" {
                    source = HealSource::DeathFloor
                } else if o["ignoreLockout"] == true {
                    source = HealSource::IgnoreLockout
                }
            }
            h.execute(Operation::Heal {
                id: id.ok_or("id")?,
                amount: n(&op["amount"])?,
                source,
            })?
        }
        "removePlayer" => {
            keys(op, &["kind", "id"])?;
            h.execute(Operation::RemovePlayer(id.ok_or("id")?))?
        }
        "extraRows" => {
            keys(op, &["kind", "id", "rows"])?;
            let id = id.ok_or("id")?;
            let m = ids.modifiers.entry(id.0).or_default();
            m.rows = boundary_v3::rows(&op["rows"])?;
            h.set_stats(id, m.view());
            return Ok(undef());
        }
        "farmSetup" => {
            keys(op, &["kind", "id", "counts"])?;
            let id = id.ok_or("id")?;
            let m = ids.modifiers.entry(id.0).or_default();
            m.counts = boundary_v3::counts(&op["counts"])?;
            h.set_stats(id, m.view());
            return Ok(undef());
        }
        "mapReplace" => {
            keys(op, &["kind", "rows"])?;
            h.execute(Operation::ReplaceMap(boundary_v3::map(&op["rows"])?))?
        }
        "runtimePatch" => {
            keys(op, &["kind", "id", "patch"])?;
            let id = id.ok_or("id")?;
            let v = &op["patch"];
            keys(v, &["path", "slip", "weapon"])?;
            let mut patch = ActorPatch::default();
            if let Some(path) = v.get("path") {
                patch.path = Some(points(path)?);
            }
            if let Some(s) = v.get("slip") {
                keys(
                    s,
                    &[
                        "vx",
                        "vy",
                        "ax",
                        "ay",
                        "path",
                        "replanAt",
                        "stuckX",
                        "stuckY",
                        "stuckN",
                        "stuckBest",
                        "stuckAt",
                        "gripUntil",
                    ],
                )?;
                patch.slip = Some(Some(rh_sim::fighter::SlipState {
                    vx: n(&s["vx"])?,
                    vy: n(&s["vy"])?,
                    ax: n(&s["ax"])?,
                    ay: n(&s["ay"])?,
                    // Frozen status witnesses only carry null here; a non-null array
                    // needs the terrain adapter's explicit source-reference identity.
                    path: if s["path"].is_null() {
                        None
                    } else {
                        return Err("non-null slip path identity requires terrain adapter".into());
                    },
                    replan_at: s.get("replanAt").map(n).transpose()?,
                    stuck_x: s.get("stuckX").map(n).transpose()?,
                    stuck_y: s.get("stuckY").map(n).transpose()?,
                    stuck_n: s.get("stuckN").map(n).transpose()?,
                    stuck_best: s.get("stuckBest").map(n).transpose()?,
                    stuck_at: s.get("stuckAt").map(n).transpose()?,
                    grip_until: s.get("gripUntil").map(n).transpose()?,
                }));
            }
            if let Some(w) = v.get("weapon") {
                keys(
                    w,
                    &[
                        "lock",
                        "lockSeen",
                        "lockLosLostAt",
                        "lockPlanAt",
                        "lockGoal",
                        "lockSearchAt",
                    ],
                )?;
                let mut t = h
                    .snapshot()
                    .players
                    .iter()
                    .find(|p| p.id == id)
                    .ok_or("actor")?
                    .weapon
                    .targeting;
                if let Some(v) = w.get("lock") {
                    t.target = ids.id(v)?;
                }
                if let Some(v) = w.get("lockSeen") {
                    t.seen = v.as_bool().ok_or("seen")?;
                }
                if let Some(v) = w.get("lockLosLostAt") {
                    t.lost_at = Some(n(v)?);
                }
                if let Some(v) = w.get("lockPlanAt") {
                    t.plan_at = Some(n(v)?);
                }
                if let Some(v) = w.get("lockSearchAt") {
                    t.search_at = Some(n(v)?);
                }
                if let Some(v) = w.get("lockGoal") {
                    t.goal = if v.is_null() { None } else { Some(point(v)?) };
                }
                patch.targeting = Some(t);
            }
            h.execute(Operation::Actor { id, patch })?
        }
        "queueNested" => {
            keys(op, &["kind", "id"])?;
            h.execute(Operation::Nested {
                id: id.ok_or("id")?,
                source: nested_source(ids)?,
            })?
        }
        "onHook" => {
            keys(op, &["kind", "hook", "victim", "operations"])?;
            if op["hook"] != "hurt" {
                return Err("hook recipe".into());
            }
            let ops = op["operations"].as_array().ok_or("reaction operations")?;
            if ops.len() > 8 {
                return Err("reaction size".into());
            }
            let operations = ops
                .iter()
                .map(|op| reaction(op, ids))
                .collect::<R<Vec<_>>>()?;
            let victim = Some(ids.player(&op["victim"])?);
            h.set_recipe(HurtRecipe { victim, operations });
            return Ok(undef());
        }
        "drain" => {
            keys(op, &["kind"])?;
            h.execute(Operation::Drain)?
        }
        _ => return Err(format!("unsupported operation {kind}")),
    };
    Ok(match out {
        Returned::Undefined => undef(),
        Returned::Status(s) => s.map_or(V::Null, |s| ids.status(&s)),
        Returned::Statuses(v) => json!(v.iter().map(|s| ids.status(s)).collect::<Vec<_>>()),
        Returned::Amount(v) => json!(v),
        Returned::Field(f) => f.map_or(V::Null, |f| ids.field_out(&f)),
        Returned::Fields(v) => json!(v.iter().map(|f| ids.field_out(f)).collect::<Vec<_>>()),
        Returned::Events(ev) => {
            let mut snap = h.snapshot();
            snap.events = ev;
            events(ids, &snap)?
        }
    })
}
/// Source-backed leaf role proof only. These are not native mob actors and never enter Sim/headless.
fn role_case(case: &V) -> R<()> {
    let input = &case["setup"]["input"];
    if input["trusted"] != json!({"roles":true}) {
        return Err("role helper setup".into());
    }
    let now = n(&input["clock"]["serverTime"])?;
    let mut ids = Ids::default();
    for p in input["players"].as_array().ok_or("players")? {
        ids.player(&p["id"])?;
    }
    let mut tables = [rt::StatusRuntime::default(), rt::StatusRuntime::default()];
    let steps = case["steps"].as_array().ok_or("steps")?;
    let ops = case["operations"].as_array().ok_or("operations")?;
    if steps.len() != 30 || ops.len() != steps.len() {
        return Err("role inventory".into());
    }
    for (index, step) in steps.iter().enumerate() {
        let op = &step["operation"];
        equal(op, &ops[index], "role operation")?;
        let slot = match s(&op["id"])? {
            "mob-role" => 0,
            "quest-role" => 1,
            _ => return Err("role recipient".into()),
        };
        let role = if slot == 0 {
            rt::Recipient::Mob
        } else {
            rt::Recipient::QuestGiver
        };
        let check = |tables: &[rt::StatusRuntime; 2], state: &V| -> R<()> {
            for (i, table) in tables.iter().enumerate() {
                let actor = &state["runtime"]["fighters"][3 + i];
                equal(&json!(table.effects), &actor["effects"], "role effects")?;
                let statuses = if table.initialized {
                    json!(table
                        .instances
                        .iter()
                        .map(|s| ids.status(s))
                        .collect::<Vec<_>>())
                } else {
                    undef()
                };
                equal(&statuses, &actor["statuses"], "role statuses")?;
            }
            Ok(())
        };
        check(&tables, &step["before"])?;
        let mut expected_hooks = Vec::new();
        let returned = match s(&op["kind"])? {
            "apply" => {
                keys(op, &["kind", "id", "apply"])?;
                let (apply, _) = ids.apply(&op["apply"])?;
                if rt::admits(&apply, role, true) {
                    let applied = rt::apply(&mut tables[slot], now, apply);
                    let st = ids.status(&tables[slot].instances[applied.index]);
                    expected_hooks.push(json!({"name":"statusApplied","role":"mob","status":st,"fresh":applied.fresh}));
                    st
                } else {
                    V::Null
                }
            }
            "read" => {
                keys(op, &["kind", "id"])?;
                read_table(
                    &ids,
                    &tables[slot],
                    now,
                    (&[], Some(PlayerId(2))),
                    false,
                    None,
                    rt::StatView::default(),
                )?
            }
            _ => return Err("role operation kind".into()),
        };
        equal(&returned, &step["returned"], "role return")?;
        let source_hooks=step["hooks"].as_array().ok_or("hooks")?.iter().map(|h|json!({"name":h["name"],"role":h["args"][0]["kind"],"status":h["args"][1],"fresh":h["args"][2]})).collect::<Vec<_>>();
        equal(
            &json!(expected_hooks),
            &json!(source_hooks),
            "role ordered hook facts",
        )?;
        for (i, table) in tables.iter().enumerate() {
            let actor = &step["after"]["runtime"]["fighters"][3 + i];
            equal(
                &json!(table.effects),
                &actor["effects"],
                "role after effects",
            )?;
            equal(
                &if table.initialized {
                    json!(table
                        .instances
                        .iter()
                        .map(|s| ids.status(s))
                        .collect::<Vec<_>>())
                } else {
                    undef()
                },
                &actor["statuses"],
                "role after statuses",
            )?;
        }
    }
    Ok(())
}
fn run(path: &str, only: Option<&str>) -> R<(usize, usize)> {
    let root =
        serde_json::from_slice::<admission::Unique>(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?
            .0;
    admission::fixture(&root)?;
    keys(
        &root,
        &[
            "format",
            "slice",
            "provenance",
            "shared",
            "rules",
            "cases",
            "policies",
        ],
    )?;
    if root["format"] != "rh-status-probes/1" {
        return Err("format".into());
    }
    let cases = root["cases"].as_array().ok_or("cases")?;
    let mut seen = BTreeMap::new();
    let mut count = 0;
    let mut leaf = 0;
    for case in cases {
        let name = s(&case["name"])?;
        if seen.insert(name, ()).is_some() {
            return Err("duplicate case".into());
        }
        if only.is_some_and(|only| name != only) {
            continue;
        }
        let result = (|| {
            keys(
                case,
                &[
                    "name",
                    "classification",
                    "boundary",
                    "operations",
                    "setup",
                    "steps",
                    "observerFullStateEquality",
                    "observerReturnEquality",
                    "sourceRandomContinuationEquality",
                ],
            )?;
            for flag in [
                "observerFullStateEquality",
                "observerReturnEquality",
                "sourceRandomContinuationEquality",
            ] {
                if case[flag] != true {
                    return Err(format!("source assurance {flag}"));
                }
            }
            if name == "mob-and-quest-roles" {
                return role_case(case);
            }
            let mut ids = Ids::default();
            let mut h = build(&case["setup"]["input"], &mut ids)?;
            check_state(&ids, &h.snapshot(), &case["setup"]["initial"], "initial")?;
            boundary_v3::compare(&ids, &h, &case["setup"]["initial"], "initial")?;
            let steps = case["steps"].as_array().ok_or("steps")?;
            if steps.len() != case["operations"].as_array().ok_or("operations")?.len() {
                return Err("step count".into());
            }
            for (i, step) in steps.iter().enumerate() {
                keys(step, &["operation", "before", "returned", "after", "hooks"])?;
                equal(
                    &step["operation"],
                    &case["operations"][i],
                    "operation provenance",
                )?;
                check_state(&ids, &h.snapshot(), &step["before"], &format!("{i}/before"))?;
                boundary_v3::compare(&ids, &h, &step["before"], &format!("{i}/before"))?;
                let before_native = h.snapshot();
                let hook_start = before_native.hooks.len();
                let result = execute(&mut h, &mut ids, &step["operation"])?;
                equal(&result, &step["returned"], &format!("{i}/return"))?;
                equal(
                    &step["before"]["runtime"]["random"],
                    &step["after"]["runtime"]["random"],
                    "source zero-draw continuation",
                )?;
                if before_native.spawn_rng != h.snapshot().spawn_rng {
                    return Err("native unexpected RNG draw".into());
                }
                check_state(&ids, &h.snapshot(), &step["after"], &format!("{i}/after"))?;
                boundary_v3::compare(&ids, &h, &step["after"], &format!("{i}/after"))?;
                equal(
                    &hooks(&ids, &h.snapshot().hooks[hook_start..])?,
                    &expected_hooks(&step["hooks"])?,
                    &format!("{i}/hooks"),
                )?;
            }
            Ok(())
        })();
        result.map_err(|e| format!("{name}: {e}"))?;
        if name == "mob-and-quest-roles" {
            leaf += 1
        } else {
            count += 1
        }
    }
    if count + leaf == 0 {
        return Err("no matching cases".into());
    }
    Ok((count, leaf))
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    if !(2..=3).contains(&args.len()) || args.get(2).is_some_and(|s| s.starts_with('-')) {
        eprintln!("usage: status-probes fixture.json [case]");
        std::process::exit(2)
    }
    match run(&args[1], args.get(2).map(String::as_str)) {
        Ok((sim, leaf)) => {
            println!("{sim} Sim status source cases and {leaf} separate role leaf proofs passed")
        }
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1)
        }
    }
}
