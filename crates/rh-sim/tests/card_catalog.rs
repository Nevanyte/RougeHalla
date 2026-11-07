//! P-CARDS-1: the generated 80-card table against the accepted source corpus (differential, independent of the emitter).
use rh_sim::cards::{
    BaseStatId, BlockReason, CardId, CardKind, CardRow, MechanicTag, ScaleSrc, Side, TriggerAction,
    TriggerOn, VsTest, WhyCode,
};
use rh_sim::stat_fold::{
    ConvertFrom, ConvertTo, EffectFlag, EffectKind, EffectStat, FlatStat, MultKey, StatKey,
    WhileCond,
};
use rh_sim::status_runtime::StatusKind;
use rh_sim::FactionId;
use serde_json::{json, Value as V};

fn corpus() -> V {
    serde_json::from_str(include_str!("../../../parity/card-catalog/source.json")).unwrap()
}

fn base_name(b: BaseStatId) -> &'static str {
    match b {
        BaseStatId::Ad => "ad",
        BaseStatId::Ap => "ap",
        BaseStatId::Haste => "haste",
        BaseStatId::Vitality => "vitality",
        BaseStatId::Armor => "armor",
        BaseStatId::Mr => "mr",
        BaseStatId::Leech => "leech",
        BaseStatId::Fleet => "fleet",
    }
}
fn kind_name(k: CardKind) -> &'static str {
    match k {
        CardKind::Base => "base",
        CardKind::Conditional => "conditional",
        CardKind::Augment => "augment",
    }
}
fn tag_name(t: MechanicTag) -> &'static str {
    match t {
        MechanicTag::Physical => "physical",
        MechanicTag::Magic => "magic",
        MechanicTag::True_ => "true",
        MechanicTag::Dot => "dot",
        MechanicTag::OnHit => "onHit",
        MechanicTag::Returned => "returned",
        MechanicTag::Slow => "slow",
        MechanicTag::Heal => "heal",
        MechanicTag::Block => "block",
        MechanicTag::Ramping => "ramping",
        MechanicTag::Execute => "execute",
        MechanicTag::Crit => "crit",
        MechanicTag::Area => "area",
        MechanicTag::Wish => "wish",
    }
}
fn stat_name(s: EffectStat) -> &'static str {
    match s {
        EffectStat::MaxHp => "maxHp",
        EffectStat::AttackSpeed => "attackSpeed",
        EffectStat::MoveSpeed => "moveSpeed",
        EffectStat::Damage => "damage",
        EffectStat::Windup => "windup",
        EffectStat::Lifesteal => "lifesteal",
        EffectStat::MarkRate => "markRate",
        EffectStat::HealTaken => "healTaken",
        EffectStat::DamageTaken => "damageTaken",
        EffectStat::Cooldown => "cooldown",
        EffectStat::ExecuteBand => "executeBand",
        EffectStat::SlowResist => "slowResist",
        EffectStat::LifestealMult => "lifestealMult",
        EffectStat::LifestealDot => "lifestealDot",
        EffectStat::CritChance => "critChance",
        EffectStat::HealBarrier => "healBarrier",
    }
}
fn key_name(k: StatKey) -> &'static str {
    match k {
        StatKey::MaxHp => "maxHp",
        StatKey::AttackSpeed => "attackSpeed",
        StatKey::MoveSpeed => "moveSpeed",
        StatKey::Damage => "damage",
        StatKey::Windup => "windup",
        StatKey::Lifesteal => "lifesteal",
        StatKey::MarkRate => "markRate",
        StatKey::HealTaken => "healTaken",
        StatKey::DamageTaken => "damageTaken",
        StatKey::Cooldown => "cooldown",
        StatKey::ExecuteBand => "executeBand",
        StatKey::SlowResist => "slowResist",
        StatKey::LifestealMult => "lifestealMult",
        StatKey::LifestealDot => "lifestealDot",
        StatKey::CritChance => "critChance",
        StatKey::HealBarrier => "healBarrier",
        StatKey::Armor => "armor",
        StatKey::Shield => "shield",
        StatKey::Ad => "ad",
        StatKey::Ap => "ap",
    }
}
fn flat_name(f: FlatStat) -> &'static str {
    match f {
        FlatStat::Armor => "armor",
        FlatStat::Shield => "shield",
        FlatStat::Ad => "ad",
        FlatStat::Ap => "ap",
    }
}
fn mult_name(m: MultKey) -> &'static str {
    match m {
        MultKey::AsPost => "asPost",
        MultKey::Hit => "hit",
        MultKey::Dot => "dot",
        MultKey::Returned => "returned",
        MultKey::Ap => "ap",
        MultKey::WishCooldown => "wishCooldown",
        MultKey::HpRace => "hpRace",
        MultKey::Linger => "linger",
    }
}
fn flag_name(f: EffectFlag) -> &'static str {
    match f {
        EffectFlag::LockSecondSlot => "lockSecondSlot",
        EffectFlag::NoCrit => "noCrit",
        EffectFlag::DotCrit => "dotCrit",
        EffectFlag::PlagueDotCritConversion => "plagueDotCritConversion",
        EffectFlag::Gambler => "gambler",
        EffectFlag::ThirdCharm => "thirdCharm",
        EffectFlag::EyeForAnEye => "eyeForAnEye",
        EffectFlag::TwiceUnarmed => "twiceUnarmed",
        EffectFlag::BlockHits => "blockHits",
        EffectFlag::PlantFeet => "plantFeet",
        EffectFlag::Festering => "festering",
        EffectFlag::HeavierSentence => "heavierSentence",
        EffectFlag::SwiftJudgment => "swiftJudgment",
        EffectFlag::GallowsPatience => "gallowsPatience",
        EffectFlag::NoCommutation => "noCommutation",
        EffectFlag::FinalVerdict => "finalVerdict",
    }
}
fn cond_name(c: WhileCond) -> &'static str {
    match c {
        WhileCond::ChasingLock => "chasingLock",
        WhileCond::HpBelow => "hpBelow",
        WhileCond::AfterCast => "afterCast",
        WhileCond::NotShooting => "notShooting",
        WhileCond::Unarmed => "unarmed",
        WhileCond::FightTime => "fightTime",
    }
}
fn from_name(f: ConvertFrom) -> &'static str {
    match f {
        ConvertFrom::Ad => "ad",
        ConvertFrom::MaxHp => "maxHp",
        ConvertFrom::BonusAttackSpeed => "bonusAttackSpeed",
        ConvertFrom::BonusMoveSpeed => "bonusMoveSpeed",
    }
}
fn to_name(t: ConvertTo) -> &'static str {
    match t {
        ConvertTo::AttackSpeed => "attackSpeed",
        ConvertTo::MoveSpeed => "moveSpeed",
        ConvertTo::Damage => "damage",
        ConvertTo::Windup => "windup",
        ConvertTo::Lifesteal => "lifesteal",
        ConvertTo::MarkRate => "markRate",
        ConvertTo::HealTaken => "healTaken",
        ConvertTo::DamageTaken => "damageTaken",
        ConvertTo::Cooldown => "cooldown",
        ConvertTo::ExecuteBand => "executeBand",
        ConvertTo::SlowResist => "slowResist",
        ConvertTo::LifestealMult => "lifestealMult",
        ConvertTo::LifestealDot => "lifestealDot",
        ConvertTo::CritChance => "critChance",
        ConvertTo::HealBarrier => "healBarrier",
        ConvertTo::Armor => "armor",
        ConvertTo::Shield => "shield",
        ConvertTo::Ad => "ad",
        ConvertTo::Ap => "ap",
    }
}
fn status_name(s: StatusKind) -> &'static str {
    match s {
        StatusKind::Dot => "dot",
        StatusKind::SlowMove => "slowMove",
        StatusKind::Stun => "stun",
        StatusKind::Hidden => "hidden",
        StatusKind::Haste => "haste",
        StatusKind::Zoned => "zoned",
        StatusKind::DeathFloor => "deathFloor",
        _ => "other",
    }
}
fn side_name(s: Side) -> &'static str {
    match s {
        Side::Self_ => "self",
        Side::Target => "target",
    }
}
fn vs_name(v: VsTest) -> &'static str {
    match v {
        VsTest::Elite => "elite",
        VsTest::HigherPower => "higherPower",
        VsTest::Slowed => "slowed",
        VsTest::Streak => "streak",
        VsTest::ThirdParty => "thirdParty",
        VsTest::HpBelow => "hpBelow",
        VsTest::PlayerAbove => "playerAbove",
    }
}
fn scale_name(s: ScaleSrc) -> &'static str {
    match s {
        ScaleSrc::CampsCleared => "campsCleared",
        ScaleSrc::Streak => "streak",
    }
}
fn on_name(o: TriggerOn) -> &'static str {
    match o {
        TriggerOn::Kill => "kill",
        TriggerOn::Block => "block",
        TriggerOn::HitTaken => "hitTaken",
        TriggerOn::Hit => "hit",
        TriggerOn::HpBelow => "hpBelow",
    }
}

/// Source numbers may be written as integers; compare exact f64 values, not their JSON spelling.
fn json_eq(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Object(x), V::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| json_eq(v, w)))
        }
        (V::Array(x), V::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(v, w)| json_eq(v, w))
        }
        (V::Number(x), V::Number(y)) => {
            x.as_f64().unwrap().to_bits() == y.as_f64().unwrap().to_bits()
        }
        _ => a == b,
    }
}

fn project(row: &CardRow) -> V {
    match row {
        CardRow::Fold(EffectKind::Stat { stat, v }) => {
            json!({"k":"stat","stat":stat_name(*stat),"v":v})
        }
        CardRow::Fold(EffectKind::Flat { stat, v }) => {
            json!({"k":"flat","stat":flat_name(*stat),"v":v})
        }
        CardRow::Fold(EffectKind::Mult { key, v }) => {
            json!({"k":"mult","key":mult_name(*key),"v":v})
        }
        CardRow::Fold(EffectKind::Flag { flag }) => json!({"k":"flag","flag":flag_name(*flag)}),
        CardRow::Fold(EffectKind::Convert { from, to, per, cap }) => {
            let mut o = json!({"k":"convert","from":from_name(*from),"to":to_name(*to),"per":per});
            if let Some(cap) = cap {
                o["cap"] = json!(cap);
            }
            o
        }
        CardRow::Fold(EffectKind::While(w)) => {
            let mut o = json!({"k":"while","cond":cond_name(w.cond),"arg":w.arg,"stat":key_name(w.stat),"v":w.v});
            if let Some(ms) = w.ms {
                o["ms"] = json!(ms);
            }
            o
        }
        CardRow::Vs(v) => json!({"k":"vs","test":vs_name(v.test),"arg":v.arg,"v":v.v}),
        CardRow::Scale(s) => {
            json!({"k":"scale","src":scale_name(s.src),"per":s.per,"step":s.step,"cap":s.cap})
        }
        CardRow::OnHit(o) => {
            let mut v = json!({"k":"onHit","status":status_name(o.status),"per":o.per,"ms":o.ms});
            if let Some(cap) = o.cap {
                v["cap"] = json!(cap);
            }
            v
        }
        CardRow::Trigger(t) => {
            let action = match t.action {
                TriggerAction::Splash { radius } => json!({"do":"splash","radius":radius}),
                TriggerAction::Fortify { per, cap } => json!({"do":"fortify","per":per,"cap":cap}),
                TriggerAction::Status {
                    to,
                    status,
                    ms,
                    value,
                } => {
                    let mut o = json!({"do":"status","to":side_name(to),"status":status_name(status),"ms":ms});
                    if let Some(value) = value {
                        o["value"] = json!(value);
                    }
                    o
                }
                TriggerAction::Boost { as_, move_, ms } => {
                    json!({"do":"boost","as":as_,"move":move_,"ms":ms})
                }
                TriggerAction::Cooldown { ms } => json!({"do":"cooldown","ms":ms}),
                TriggerAction::Return { melee, share } => {
                    json!({"do":"return","melee":melee,"share":share})
                }
                TriggerAction::Heal {
                    share,
                    ms,
                    ignore_lockout,
                } => {
                    let mut o = json!({"do":"heal","share":share,"ignoreLockout":ignore_lockout});
                    if let Some(ms) = ms {
                        o["ms"] = json!(ms);
                    }
                    o
                }
            };
            let mut o = json!({"k":"trigger","on":on_name(t.on),"arg":t.arg,"do":action});
            if t.once {
                o["once"] = json!(true);
            }
            o
        }
        _ => json!("unprojected"),
    }
}

#[test]
fn the_generated_catalog_matches_the_source_corpus() {
    let corpus = corpus();
    let cases: Vec<&V> = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["family"] == "catalog")
        .collect();
    assert_eq!(cases.len(), 80, "catalog case count");
    assert_eq!(CardId::ALL.len(), 80, "enum count");
    for (i, case) in cases.iter().enumerate() {
        let want = &case["expected"]["definition"];
        let id = CardId::ALL[i];
        assert_eq!(id.as_str(), want["id"].as_str().unwrap(), "id order {i}");
        let got = id.definition();
        assert_eq!(
            kind_name(got.kind),
            want["kind"].as_str().unwrap(),
            "kind {}",
            id.as_str()
        );
        assert_eq!(
            usize::from(got.tier),
            want["tier"].as_u64().unwrap() as usize,
            "tier {}",
            id.as_str()
        );
        assert_eq!(
            got.base.map(base_name),
            want.get("base").and_then(|v| v.as_str()),
            "base {}",
            id.as_str()
        );
        assert_eq!(
            got.requires.map(base_name),
            want.get("requires").and_then(|v| v.as_str()),
            "requires {}",
            id.as_str()
        );
        assert_eq!(
            got.unique,
            want["unique"].as_bool().unwrap(),
            "unique {}",
            id.as_str()
        );
        assert_eq!(
            got.ready,
            want["ready"].as_str() == Some("a"),
            "ready {}",
            id.as_str()
        );
        assert_eq!(
            got.title,
            want["title"].as_str().unwrap(),
            "title {}",
            id.as_str()
        );
        assert_eq!(
            got.text,
            want["text"].as_str().unwrap(),
            "text {}",
            id.as_str()
        );
        let tags: Vec<&str> = got.tags.iter().map(|t| tag_name(*t)).collect();
        let want_tags: Vec<&str> = want["tags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_str().unwrap())
            .collect();
        assert_eq!(tags, want_tags, "tags {}", id.as_str());
        let want_rows = want["effects"].as_array().unwrap();
        assert_eq!(got.rows.len(), want_rows.len(), "row count {}", id.as_str());
        for (j, (row, w)) in got.rows.iter().zip(want_rows).enumerate() {
            let projected = project(row);
            assert!(
                json_eq(&projected, w),
                "row {j} of {}: generated {projected} vs source {w}",
                id.as_str()
            );
        }
        // Faction selections: the default for undefined/unknown, the override for a real faction.
        for s in case["expected"]["selections"].as_array().unwrap() {
            let faction = match s["faction"].as_str() {
                Some("fire") => Some(FactionId::Fire),
                Some("sentenced") => Some(FactionId::Sentenced),
                Some("plague") => Some(FactionId::Plague),
                Some("frost") => Some(FactionId::Frost),
                Some("holy") => Some(FactionId::Holy),
                _ => None,
            };
            let (text, rows) = match faction {
                Some(f) => got.selection(f),
                None => (got.text, got.rows),
            };
            assert_eq!(
                text,
                s["text"].as_str().unwrap(),
                "selection text {}",
                id.as_str()
            );
            let want_rows = s["rows"].as_array().unwrap();
            assert_eq!(
                rows.len(),
                want_rows.len(),
                "selection row count {}",
                id.as_str()
            );
            for (row, w) in rows.iter().zip(want_rows) {
                let projected = project(row);
                assert!(
                    json_eq(&projected, w),
                    "selection row of {}: generated {projected} vs source {w}",
                    id.as_str()
                );
            }
        }
    }
}

fn why_code_name(c: WhyCode) -> &'static str {
    match c {
        WhyCode::New => "new",
        WhyCode::Deepens => "deepens",
        WhyCode::Synergy => "synergy",
        WhyCode::Augment => "augment",
    }
}

fn reason_name(r: BlockReason) -> &'static str {
    match r {
        BlockReason::Owned => "owned",
        BlockReason::Needs => "needs",
    }
}

#[test]
fn eligibility_cases_match_the_catalog() {
    let corpus = corpus();
    let mut n = 0;
    for case in corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["family"] == "eligibility")
    {
        let id_str = case["input"]["id"].as_str().unwrap();
        let id = CardId::ALL
            .into_iter()
            .find(|id| id.as_str() == id_str)
            .unwrap_or_else(|| panic!("unknown id {id_str}"));
        let def = id.definition();
        let faction = match case["input"]["viewFaction"].as_str() {
            Some("fire") => FactionId::Fire,
            Some("sentenced") => FactionId::Sentenced,
            Some("plague") => FactionId::Plague,
            Some("frost") => FactionId::Frost,
            Some("holy") => FactionId::Holy,
            other => panic!("unknown view faction {other:?}"),
        };
        let (text, _) = def.selection(faction);
        let builds = case["input"]["builds"].as_array().unwrap();
        let entries = case["expected"].as_array().unwrap();
        assert_eq!(entries.len(), builds.len(), "entry count {id_str}");
        for (build, e) in builds.iter().zip(entries) {
            let v = &e["view"];
            assert_eq!(v["id"].as_str().unwrap(), id.as_str(), "view id {id_str}");
            assert_eq!(
                v["title"].as_str().unwrap(),
                def.title,
                "view title {id_str}"
            );
            assert_eq!(
                usize::from(def.tier),
                v["tier"].as_u64().unwrap() as usize,
                "view tier {id_str}"
            );
            assert_eq!(
                v["kind"].as_str().unwrap(),
                kind_name(def.kind),
                "view kind {id_str}"
            );
            assert_eq!(v["text"].as_str().unwrap(), text, "view text {id_str}");
            let tags: Vec<&str> = def.tags.iter().map(|t| tag_name(*t)).collect();
            let want_tags: Vec<&str> = v["tags"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t.as_str().unwrap())
                .collect();
            assert_eq!(tags, want_tags, "view tags {id_str}");
            assert_eq!(
                v["base"].as_str().map(str::to_string),
                def.base.map(|b| base_name(b).to_string()),
                "view base {id_str}"
            );
            let held = build.get(id_str).and_then(|c| c.as_u64()).unwrap_or(0);
            assert_eq!(e["count"].as_u64().unwrap(), held, "count {id_str}");
            assert_eq!(v["held"].as_u64().unwrap(), held, "held {id_str}");
            let has_required = def.requires.map_or(false, |req| {
                build.as_object().unwrap().keys().any(|k| {
                    CardId::ALL
                        .into_iter()
                        .any(|c| c.as_str() == k.as_str() && c.definition().base == Some(req))
                })
            });
            let why = def.why(held > 0, has_required);
            let mut why_json = json!({"code": why_code_name(why.code), "text": why.text()});
            if let Some(base) = why.base {
                why_json["base"] = json!(base_name(base));
            }
            if let Some(has) = why.has {
                why_json["has"] = json!(has);
            }
            assert!(
                json_eq(&why_json, &v["why"]),
                "why {id_str}: generated {why_json} vs source {}",
                v["why"]
            );
            match (&v["blocked"], def.blocked(held > 0, has_required)) {
                (V::Null, None) => {}
                (V::Object(_), Some(blocked)) => {
                    let blocked_json =
                        json!({"reason": reason_name(blocked.reason), "text": blocked.text()});
                    assert!(
                        json_eq(&blocked_json, &v["blocked"]),
                        "blocked {id_str}: generated {blocked_json} vs source {}",
                        v["blocked"]
                    );
                }
                (want, got) => panic!("blocked {id_str}: source {want} vs generated {got:?}"),
            }
            let mut owned: Vec<String> = build
                .as_object()
                .unwrap()
                .keys()
                .filter(|k| build.get(*k).and_then(|c| c.as_u64()).unwrap_or(0) > 0)
                .cloned()
                .collect();
            owned.sort();
            let owned_defs = e["owned"].as_array().unwrap();
            let mut want_owned: Vec<String> = owned_defs
                .iter()
                .map(|o| o["def"]["id"].as_str().unwrap().to_string())
                .collect();
            want_owned.sort();
            assert_eq!(owned, want_owned, "owned {id_str}");
            let power: u64 = owned_defs
                .iter()
                .map(|o| {
                    u64::from(o["def"]["tier"].as_u64().unwrap() as u8)
                        * o["count"].as_u64().unwrap()
                })
                .sum();
            assert_eq!(e["power"].as_u64().unwrap(), power, "power {id_str}");
        }
        n += 1;
    }
    assert_eq!(n, 80, "eligibility case count");
}
