//! Full preflight: no Sim/Harness creation or gameplay mutation is allowed here.
use super::{equal, n, parse, rt, s, undef, Ids, R, V};
use serde::{
    de::{self, MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer,
};
use serde_json::{Map, Number, Value};
#[path = "outputs.rs"]
mod outputs;
pub(super) struct Unique(pub(super) Value);
impl<'de> Deserialize<'de> for Unique {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Unique;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("JSON with recursively unique object keys")
            }
            fn visit_unit<E: de::Error>(self) -> Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Unique, E> {
                Number::from_f64(v)
                    .map(|n| Unique(n.into()))
                    .ok_or_else(|| E::custom("nonfinite JSON number"))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_string<E: de::Error>(self, v: String) -> Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Unique, A::Error> {
                let mut out = Vec::new();
                while let Some(Unique(v)) = a.next_element::<Unique>()? {
                    out.push(v);
                }
                Ok(Unique(Value::Array(out)))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Unique, A::Error> {
                let mut out = Map::new();
                while let Some(key) = a.next_key::<String>()? {
                    if out.contains_key(&key) {
                        return Err(de::Error::custom("duplicate object key"));
                    }
                    out.insert(key, a.next_value::<Unique>()?.0);
                }
                Ok(Unique(Value::Object(out)))
            }
        }
        d.deserialize_any(V)
    }
}
// serde_json::from_slice::<Unique>(&bytes)?.0 rejects trailing data too.

fn operation_shape(v: &V) -> R<()> {
    let (required, optional): (&[&str], &[&str]) = match s(&v["kind"])? {
        "apply" => (&["apply", "id", "kind"], &["linkField"]),
        "read" => (&["id", "kind"], &["at"]),
        "remove" => (&["id", "kind", "selector"], &[]),
        "cleanse" => (&["classes", "id", "kind"], &[]),
        "clock" => (&["at", "kind"], &[]),
        "find" => (&["id", "kind", "statusKind"], &["sourceId"]),
        "reveal" => (&["id", "kind", "until"], &[]),
        "collect" => (&["kind", "value"], &[]),
        "drain" => (&["kind"], &[]),
        "actorPatch" => (&["id", "kind", "patch"], &[]),
        "runtimePatch" => (&["id", "kind", "patch"], &[]),
        "displace" => (&["id", "kind", "to"], &[]),
        "queueNested" => (&["id", "kind"], &[]),
        "input" => (&["id", "kind", "message", "type"], &[]),
        "step" => (&["kind", "ms"], &[]),
        "removePlayer" => (&["id", "kind"], &[]),
        "extraRows" => (&["id", "kind", "rows"], &[]),
        "mapReplace" => (&["kind", "rows"], &[]),
        "farmSetup" => (&["kind", "id", "counts"], &[]),
        "heal" => (&["amount", "id", "kind"], &["options"]),
        "ledgerHit" => (&["hit", "kind"], &[]),
        "deferHit" => (&["hit", "kind"], &[]),
        "applyLedger" => (&["kind"], &[]),
        "clearLedger" => (&["kind"], &[]),
        "fieldAdd" => (&["field", "kind"], &["alias"]),
        "fieldRemove" => (&["kind"], &["alias", "id"]),
        "fieldsRead" => (&["kind"], &[]),
        "fieldRemoveWhere" => (&["kind", "selector"], &[]),
        "onTrail" => (&["alias", "kind", "point"], &[]),
        "updateAbilities" => (&["kind"], &[]),
        "statusDamage" => (&["dtMs", "kind"], &[]),
        "abilityDotFx" => (&["kind"], &[]),
        "clearFighter" => (&["cause", "id", "kind"], &[]),
        "clearAll" => (&["cause", "kind"], &[]),
        "runEnded" => (&["kind"], &[]),
        "teleported" => (&["kind"], &[]),
        "floorHp" => (&["before", "id", "kind", "total"], &[]),
        "onHook" => (&["hook", "kind", "operations", "victim"], &[]),
        _ => return Err("unsupported operation".into()),
    };
    shape(v, required, optional)
}
fn shape(v: &V, required: &[&str], optional: &[&str]) -> R<()> {
    let o = v.as_object().ok_or("object required")?;
    for k in required {
        if !o.contains_key(*k) {
            return Err(format!("missing required {k}"));
        }
    }
    for k in o.keys() {
        if !required.contains(&k.as_str()) && !optional.contains(&k.as_str()) {
            return Err(format!("unknown key {k}"));
        }
    }
    Ok(())
}
fn arr(v: &V) -> R<&Vec<V>> {
    v.as_array().ok_or("array required".into())
}
fn boolean(v: &V) -> R<()> {
    v.as_bool().map(|_| ()).ok_or("boolean required".into())
}
fn uint(v: &V, max: u64) -> R<u64> {
    v.as_u64()
        .filter(|x| *x <= max)
        .ok_or("checked unsigned integer required".into())
}
fn choice(v: &V, values: &[&str]) -> R<()> {
    if values.contains(&s(v)?) {
        Ok(())
    } else {
        Err("unsupported enum".into())
    }
}
fn geometry(v: &V) -> R<()> {
    if rt::geometry_scalar_is_safe(n(v)?) {
        Ok(())
    } else {
        Err("overflowing geometry".into())
    }
}
fn point(v: &V) -> R<()> {
    shape(v, &["x", "y"], &[])?;
    geometry(&v["x"])?;
    geometry(&v["y"])?;
    Ok(())
}
fn points(v: &V) -> R<()> {
    for p in arr(v)? {
        point(p)?
    }
    Ok(())
}
fn history(v: &V) -> R<()> {
    for p in arr(v)? {
        shape(p, &["t", "x", "y"], &[])?;
        n(&p["t"])?;
        geometry(&p["x"])?;
        geometry(&p["y"])?;
    }
    Ok(())
}
fn maybe_point(v: &V) -> R<()> {
    if !v.is_null() {
        point(v)?
    }
    Ok(())
}
fn source(v: &V) -> R<()> {
    shape(v, &["id", "name"], &["ownerId"])?;
    s(&v["id"])?;
    s(&v["name"])?;
    if let Some(x) = v.get("ownerId") {
        if s(x)?.is_empty() {
            return Err(
                "empty optional owner identity is outside the native snapshot domain".into(),
            );
        }
    }
    Ok(())
}
fn sentinel(v: &V) -> R<()> {
    if v.is_object() {
        shape(v, &["$number"], &[])?;
        choice(&v["$number"], &["NaN", "Infinity", "-Infinity"])
    } else {
        n(v).map(|_| ())
    }
}
fn shares(v: &V) -> R<()> {
    shape(v, &["phys", "magic", "true"], &[])?;
    for k in ["phys", "magic", "true"] {
        n(&v[k])?;
    }
    Ok(())
}
fn packet(v: &V) -> R<()> {
    shape(v, &["raw", "phys", "magic", "true"], &["crit", "mult"])?;
    for k in ["raw", "phys", "magic", "true"] {
        n(&v[k])?;
    }
    if let Some(x) = v.get("crit") {
        boolean(x)?
    }
    if let Some(x) = v.get("mult") {
        n(x)?;
    }
    Ok(())
}
fn kind(v: &V) -> R<()> {
    parse::<rt::StatusKind>(v).map(|_| ())
}
fn ability(v: &V) -> R<()> {
    parse::<rt::AbilityId>(v).map(|_| ())
}
fn weapon_id(v: &V) -> R<()> {
    choice(v, &["fists", "sword", "axe", "shield", "bow", "wand"])
}
fn cast(v: &V) -> R<()> {
    if v.is_null() || *v == undef() {
        return Ok(());
    }
    shape(
        v,
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
        &["prevFullAt"],
    )?;
    ability(&v["ability"])?;
    choice(&v["slot"], &["wish", "q", "e"])?;
    for k in ["rank", "startedAt", "landsAt", "prevReadyAt", "lagMs"] {
        n(&v[k])?;
    }
    if let Some(x) = v.get("prevFullAt") {
        n(x)?;
    }
    if !v["target"].is_null() {
        s(&v["target"])?;
    }
    point(&v["point"])?;
    maybe_point(&v["landing"])
}
fn action(v: &V) -> R<()> {
    if v.is_null() {
        return Ok(());
    }
    shape(
        v,
        &["kind", "weapon", "startedAt", "landsAt", "a", "packet"],
        &["origin", "target", "rangeMult"],
    )?;
    choice(&v["kind"], &["swing", "cast", "draw"])?;
    weapon_id(&v["weapon"])?;
    packet(&v["packet"])?;
    for k in ["startedAt", "landsAt", "a"] {
        n(&v[k])?;
    }
    if let Some(x) = v.get("origin") {
        point(x)?
    }
    if let Some(x) = v.get("target") {
        if *x != undef() {
            s(x)?;
        }
    }
    if let Some(x) = v.get("rangeMult") {
        n(x)?;
    }
    Ok(())
}
const WEAPON: &[&str] = &[
    "action",
    "rootUntil",
    "staggerImmuneUntil",
    "held",
    "pressedAt",
    "bufferedUntil",
    "aim",
    "aimAt",
    "lagMs",
    "lock",
    "lockSeen",
    "lockLosLostAt",
    "lockPlanAt",
    "lockGoal",
    "lockSearchAt",
    "attackMoveGoal",
    "lastShotAt",
];
fn weapon(v: &V, partial: bool) -> R<()> {
    shape(
        v,
        if partial { &[] } else { WEAPON },
        if partial { WEAPON } else { &[] },
    )?;
    for (k, x) in v.as_object().unwrap() {
        match k.as_str() {
            "action" => action(x)?,
            "held" | "lockSeen" => boolean(x)?,
            "lock" => {
                if !x.is_null() {
                    s(x)?;
                }
            }
            "lockGoal" | "attackMoveGoal" => maybe_point(x)?,
            "lockPlanAt" | "lockSearchAt" | "lastShotAt" => sentinel(x)?,
            _ => {
                n(x)?;
            }
        }
    }
    Ok(())
}
fn slip(v: &V) -> R<()> {
    if v.is_null() || *v == undef() {
        return Ok(());
    }
    shape(
        v,
        &["vx", "vy", "ax", "ay", "path", "replanAt"],
        &[
            "stuckX",
            "stuckY",
            "stuckN",
            "stuckBest",
            "stuckAt",
            "gripUntil",
        ],
    )?;
    for (k, x) in v.as_object().unwrap() {
        match k.as_str() {
            "path" => {
                if !x.is_null() {
                    points(x)?
                }
            }
            "replanAt" => sentinel(x)?,
            "vx" | "vy" | "ax" | "ay" | "stuckX" | "stuckY" => geometry(x)?,
            _ => {
                n(x)?;
            }
        }
    }
    Ok(())
}
fn actor_patch(v: &V) -> R<()> {
    shape(
        v,
        &[],
        &[
            "status",
            "hp",
            "maxHp",
            "barrier",
            "x",
            "y",
            "weapon0",
            "displaceSeq",
            "sig",
            "immuneUntil",
        ],
    )?;
    for (k, x) in v.as_object().unwrap() {
        match k.as_str() {
            "status" => choice(x, &["alive", "dead"])?,
            "x" | "y" => geometry(x)?,
            "weapon0" => {
                if *x != "" {
                    weapon_id(x)?
                }
            }
            "displaceSeq" | "sig" => {
                uint(x, 255)?;
            }
            _ => {
                n(x)?;
            }
        }
    }
    Ok(())
}
fn runtime_patch(v: &V) -> R<()> {
    shape(
        v,
        &[],
        &["weapon", "path", "history", "slip", "down", "cast"],
    )?;
    for (k, x) in v.as_object().unwrap() {
        match k.as_str() {
            "weapon" => weapon(x, true)?,
            "path" => points(x)?,
            "history" => history(x)?,
            "slip" => slip(x)?,
            "cast" => cast(x)?,
            "down" => {
                shape(x, &["outcome"], &[])?;
                choice(&x["outcome"], &["died"])?
            }
            _ => unreachable!(),
        }
    }
    Ok(())
}
fn status(v: &V) -> R<()> {
    shape(
        v,
        &["kind", "source", "startedAt", "until", "value"],
        &[
            "ability",
            "tag",
            "revealFrom",
            "revealUntil",
            "fieldId",
            "dealtMult",
            "takenFromSourceMult",
            "moveMult",
            "floorHp",
            "healShare",
            "shares",
            "taken",
        ],
    )?;
    kind(&v["kind"])?;
    source(&v["source"])?;
    for (k, x) in v.as_object().unwrap() {
        match k.as_str() {
            "kind" | "source" => (),
            "ability" => ability(x)?,
            "tag" => {
                s(x)?;
            }
            _ if *x == undef() => (),
            "fieldId" => {
                s(x)?;
            }
            "shares" => shares(x)?,
            _ => {
                n(x)?;
            }
        }
    }
    Ok(())
}
fn field(v: &V, id: bool) -> R<()> {
    let mut required = vec![
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
    ];
    if id {
        required.push("id")
    };
    shape(v, &required, &["exitStunMs"])?;
    choice(&v["kind"], &["zone", "cloud", "trail"])?;
    ability(&v["ability"])?;
    source(&v["owner"])?;
    if !v["subject"].is_null() {
        s(&v["subject"])?;
    }
    if id {
        s(&v["id"])?;
    }
    for k in ["x", "y", "x2", "y2", "r", "vx", "vy"] {
        geometry(&v[k])?;
    }
    for k in ["startedAt", "endsAt"] {
        n(&v[k])?;
    }
    if let Some(x) = v.get("exitStunMs") {
        n(x)?;
    }
    Ok(())
}
fn hit(v: &V, scale: bool) -> R<()> {
    let mut req = vec!["by", "victim", "packet", "weapon", "stagger"];
    if scale {
        req.push("scale")
    }
    shape(v, &req, &["scale", "ability", "dot", "arena", "sig"])?;
    source(&v["by"])?;
    s(&v["victim"])?;
    packet(&v["packet"])?;
    if !v["weapon"].is_null() {
        weapon_id(&v["weapon"])?
    }
    boolean(&v["stagger"])?;
    for k in ["dot", "arena"] {
        if let Some(x) = v.get(k) {
            boolean(x)?
        }
    }
    if let Some(x) = v.get("ability") {
        ability(x)?
    }
    if let Some(x) = v.get("sig") {
        choice(x, &["burn", "disease", "backlash", "mark"])?
    }
    if let Some(x) = v.get("scale") {
        n(x)?;
    }
    Ok(())
}
fn pairs(v: &V, f: impl Fn(&V) -> R<()>) -> R<()> {
    let mut seen = std::collections::BTreeSet::new();
    for p in arr(v)? {
        let p = arr(p)?;
        if p.len() != 2 {
            return Err("pair length".into());
        }
        if !seen.insert(s(&p[0])?) {
            return Err("duplicate pair key".into());
        }
        f(&p[1])?;
    }
    Ok(())
}
fn random(v: &V) -> R<()> {
    shape(v, &["random", "rewardRandom", "questRandom"], &[])?;
    for stream in v.as_object().unwrap().values() {
        shape(stream, &["draws", "next"], &[])?;
        uint(&stream["draws"], 9_007_199_254_740_991)?;
        let next = arr(&stream["next"])?;
        if next.len() != 4 {
            return Err("RNG continuation length".into());
        }
        for x in next {
            if !(0.0..1.0).contains(&n(x)?) {
                return Err("RNG range".into());
            }
        }
    }
    Ok(())
}
fn runtime(v: &V, v3: bool) -> R<()> {
    shape(
        v,
        &[
            "clock",
            "entityCounter",
            "marks",
            "fighters",
            "abilities",
            "events",
            "ledger",
            "landed",
            "deferred",
            "collecting",
            "payouts",
            "callbackOperations",
            "random",
        ],
        if v3 {
            &["collision", "modifierInputs"]
        } else {
            &[]
        },
    )?;
    if v3 {
        super::boundary_v3::validate_projection(v)?;
    }
    shape(&v["clock"], &["tick", "serverTime", "phase"], &[])?;
    uint(&v["clock"]["tick"], u32::MAX.into())?;
    n(&v["clock"]["serverTime"])?;
    choice(&v["clock"]["phase"], &["active", "lobby", "ending"])?;
    uint(&v["entityCounter"], u32::MAX.into())?;
    boolean(&v["collecting"])?;
    random(&v["random"])?;
    let mut ids = std::collections::BTreeSet::new();
    for p in arr(&v["fighters"])? {
        shape(
            p,
            &[
                "id",
                "role",
                "standing",
                "name",
                "hp",
                "maxHp",
                "barrier",
                "immuneUntil",
                "effects",
                "sig",
                "mirrors",
                "statuses",
                "weapon",
                "cast",
                "body",
                "cards",
            ],
            &[],
        )?;
        if !ids.insert(s(&p["id"])?) {
            return Err("duplicate fighter".into());
        }
        s(&p["name"])?;
        choice(&p["role"], &["player", "mob", "questGiver"])?;
        boolean(&p["standing"])?;
        for k in ["hp", "maxHp", "barrier", "immuneUntil"] {
            n(&p[k])?;
        }
        uint(&p["effects"], 65535)?;
        uint(&p["sig"], 255)?;
        shape(
            &p["mirrors"],
            &[
                "adBonus",
                "apBonus",
                "armorBonus",
                "asMult",
                "shieldBonus",
                "speedMult",
                "windupMult",
            ],
            &[],
        )?;
        for x in p["mirrors"].as_object().unwrap().values() {
            n(x)?;
        }
        if p["statuses"] != undef() {
            for st in arr(&p["statuses"])? {
                status(st)?
            }
        }
        shape(&p["weapon"], &["readyAt", "state"], &[])?;
        n(&p["weapon"]["readyAt"])?;
        weapon(&p["weapon"]["state"], false)?;
        cast(&p["cast"])?;
        let b = &p["body"];
        shape(
            b,
            &["x", "y", "facing", "displaceSeq", "path", "history", "slip"],
            &[],
        )?;
        geometry(&b["x"])?;
        geometry(&b["y"])?;
        n(&b["facing"])?;
        uint(&b["displaceSeq"], 255)?;
        points(&b["path"])?;
        history(&b["history"])?;
        slip(&b["slip"])?;
        let c = &p["cards"];
        if *c != undef() {
            shape(c, &["critAccDot", "dotRollTick", "dotCrit"], &[])?;
            n(&c["critAccDot"])?;
            if c["dotRollTick"]
                .as_i64()
                .is_none_or(|n| n < -1 || n > i64::from(u32::MAX))
            {
                return Err("dot tick range".into());
            }
            boolean(&c["dotCrit"])?;
        }
    }
    let a = &v["abilities"];
    if !a.is_null() {
        shape(
            a,
            &["fields", "mirrors", "dot", "dotSince", "teleportedAt"],
            &[],
        )?;
        pairs(&a["fields"], |v| field(v, true))?;
        pairs(&a["mirrors"], |m| {
            shape(
                m,
                &[
                    "kind",
                    "ability",
                    "x",
                    "y",
                    "x2",
                    "y2",
                    "r",
                    "vx",
                    "vy",
                    "owner",
                    "subject",
                    "startedAt",
                    "endsAt",
                ],
                &[],
            )?;
            uint(&m["kind"], 2)?;
            uint(&m["ability"], 4)?;
            s(&m["owner"])?;
            s(&m["subject"])?;
            for k in ["x", "y", "x2", "y2", "r", "vx", "vy"] {
                geometry(&m[k])?;
            }
            for k in ["startedAt", "endsAt"] {
                n(&m[k])?;
            }
            Ok(())
        })?;
        pairs(&a["dot"], |d| {
            shape(d, &["victim", "by", "ability", "amount"], &[])?;
            s(&d["victim"])?;
            s(&d["by"])?;
            ability(&d["ability"])?;
            n(&d["amount"])?;
            Ok(())
        })?;
        n(&a["dotSince"])?;
        if a["teleportedAt"] != undef() {
            n(&a["teleportedAt"])?;
        }
    }
    for k in ["ledger", "deferred"] {
        for h in arr(&v[k])? {
            hit(h, true)?
        }
    }
    for h in arr(&v["landed"])? {
        shape(
            h,
            &["victim", "by", "amount", "weapon"],
            &[
                "sig", "ability", "dot", "race", "cut", "crit", "passive", "derived",
            ],
        )?;
        s(&h["victim"])?;
        s(&h["by"])?;
        n(&h["amount"])?;
        if !h["weapon"].is_null() {
            weapon_id(&h["weapon"])?
        }
        for k in ["race", "cut"] {
            if let Some(x) = h.get(k) {
                n(x)?;
            }
        }
        for k in ["dot", "crit", "passive", "derived"] {
            if let Some(x) = h.get(k) {
                boolean(x)?
            }
        }
        if let Some(x) = h.get("ability") {
            ability(x)?
        }
        if let Some(x) = h.get("sig") {
            if *x != undef() {
                choice(x, &["burn", "disease", "backlash", "mark"])?
            }
        }
    }
    for p in arr(&v["payouts"])? {
        shape(p, &["$function"], &[])?;
        s(&p["$function"])?;
    }
    outputs::events(&v["events"])?;
    outputs::callbacks(&v["callbackOperations"], v3)?;
    if v["marks"] != undef() {
        shape(&v["marks"], &["suppressed", "denies", "taxed"], &[])?;
        pairs(&v["marks"]["suppressed"], |x| n(x).map(|_| ()))?;
        pairs(&v["marks"]["taxed"], |x| s(x).map(|_| ()))?;
        pairs(&v["marks"]["denies"], |x| {
            for x in arr(x)? {
                s(x)?;
            }
            Ok(())
        })?;
    }
    Ok(())
}
fn numeric_tree(v: &V) -> R<()> {
    match v {
        V::Number(_) => {
            n(v)?;
        }
        V::Array(xs) => {
            for x in xs {
                numeric_tree(x)?
            }
        }
        V::Object(o) => {
            if o.contains_key("$undefined") {
                if *v != undef() {
                    return Err("undefined sentinel".into());
                }
            } else if o.contains_key("$number") {
                sentinel(v)?
            } else if o.contains_key("$function") {
                shape(v, &["$function"], &[])?;
                s(&v["$function"])?;
            } else {
                for x in o.values() {
                    numeric_tree(x)?
                }
            }
        }
        _ => (),
    }
    Ok(())
}
fn snapshot(v: &V, v3: bool) -> R<()> {
    shape(
        v,
        &[
            "runtime",
            "clock",
            "modifiers",
            "callbackOperations",
            "fieldAliases",
            "world",
            "itemUid",
            "aliases",
            "random",
        ],
        &[],
    )?;
    numeric_tree(v)?;
    runtime(&v["runtime"], v3)?;
    equal(&v["clock"], &v["runtime"]["clock"], "snapshot clock")?;
    equal(&v["random"], &v["runtime"]["random"], "snapshot RNG")?;
    equal(
        &v["callbackOperations"],
        &v["runtime"]["callbackOperations"],
        "snapshot callbacks",
    )?;
    Ok(())
}
fn setup(v: &V) -> R<()> {
    shape(
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
        &[],
    )?;
    uint(&v["seed"], u32::MAX.into())?;
    uint(&v["randomSeed"], u32::MAX.into())?;
    for k in ["rewardSalt", "questSalt"] {
        let salt = arr(&v[k])?;
        if salt.len() != 4 {
            return Err("salt length".into());
        }
        for x in salt {
            uint(x, u32::MAX.into())?;
        }
    }
    if v["newItemUid"] != "incrementing-decimal-from-zero" {
        return Err("item uid source".into());
    }
    let c = &v["config"];
    shape(
        c,
        &[
            "minPlayers",
            "lobbySeconds",
            "fillSeconds",
            "patienceSeconds",
            "patienceMinSeconds",
            "suddenDeathSeconds",
            "pvpRules",
        ],
        &[],
    )?;
    uint(&c["minPlayers"], rh_sim::constants::MAX_PLAYERS as u64)?;
    boolean(&c["pvpRules"])?;
    for k in [
        "lobbySeconds",
        "fillSeconds",
        "patienceSeconds",
        "patienceMinSeconds",
        "suddenDeathSeconds",
    ] {
        if n(&c[k])? < 0. {
            return Err("negative config time".into());
        }
    }
    // These source owners are not part of this packet; admit the captured long-window setup only.
    for k in [
        "patienceSeconds",
        "patienceMinSeconds",
        "suddenDeathSeconds",
    ] {
        if c[k] != 3600 {
            return Err("unsupported source lifecycle window".into());
        }
    }
    let m = &v["modules"];
    shape(m, &["assembler", "signatures", "walkHints"], &[])?;
    if m["assembler"] != "createGameWorld" {
        return Err("assembler".into());
    }
    boolean(&m["signatures"])?;
    boolean(&m["walkHints"])?;
    if m["walkHints"] != false {
        return Err("walkHints setup outside captured factory domain".into());
    }
    let rows = arr(&v["mapRows"])?;
    if rows.len() != 20 {
        return Err("map height".into());
    }
    for row in rows {
        let row = s(row)?;
        if row.len() != 40 || !row.bytes().all(|b| b == b'.' || b == b'#') {
            return Err("map row".into());
        }
    }
    shape(&v["clock"], &["serverTime", "tick"], &[])?;
    clock_time(&v["clock"]["serverTime"])?;
    uint(&v["clock"]["tick"], u32::MAX.into())?;
    let ps = arr(&v["players"])?;
    if ps.len() != 3 {
        return Err("player setup cardinality".into());
    }
    for (p, id) in ps.iter().zip(["alice", "bob", "carol"]) {
        shape(p, &["id", "name", "faction", "patch", "runtime"], &[])?;
        if p["id"] != id || p["faction"] != "fire" {
            return Err("player setup identity".into());
        }
        s(&p["name"])?;
        shape(&p["patch"], &["x", "y", "immuneUntil", "weapon0"], &[])?;
        actor_patch(&p["patch"])?;
        shape(&p["runtime"], &["path", "history"], &[])?;
        runtime_patch(&p["runtime"])?;
    }
    let t = &v["trusted"];
    shape(
        t,
        &[],
        &[
            "actorOverrides",
            "runtimeOverrides",
            "roles",
            "splitMap",
            "signatures",
            "pvpRules",
            "markSuppressed",
        ],
    )?;
    for k in ["roles", "splitMap", "signatures", "pvpRules"] {
        if let Some(x) = t.get(k) {
            boolean(x)?
        }
    }
    for (k, runtime) in [("actorOverrides", false), ("runtimeOverrides", true)] {
        if let Some(x) = t.get(k) {
            for (id, patch) in x.as_object().ok_or("override object")? {
                if !["alice", "bob", "carol"].contains(&id.as_str()) {
                    return Err("override actor".into());
                }
                if runtime {
                    shape(patch, &[], &["down", "cast"])?;
                    runtime_patch(patch)?
                } else {
                    actor_patch(patch)?
                }
            }
        }
    }
    if let Some(x) = t.get("markSuppressed") {
        pairs(x, |x| n(x).map(|_| ()))?
    }
    Ok(())
}
fn clock_time(v: &V) -> R<()> {
    let x = n(v)?;
    if !(0.0..=(f64::from(u32::MAX) * rh_sim::constants::TICK_MS)).contains(&x) {
        return Err("clock outside native tick domain".into());
    }
    Ok(())
}
fn operation(v: &V, nested: bool, v3: bool) -> R<()> {
    operation_shape(v)?;
    let k = s(&v["kind"])?;
    if !v3 && matches!(k, "mapReplace" | "farmSetup") {
        return Err("v3 operation outside v3".into());
    }
    if nested
        && ![
            "apply",
            "remove",
            "cleanse",
            "displace",
            "deferHit",
            "queueNested",
        ]
        .contains(&k)
    {
        return Err("unsupported nested recipe".into());
    }
    if let Some(id) = v.get("id") {
        s(id)?;
    }
    for key in ["alias", "linkField", "sourceId"] {
        if let Some(x) = v.get(key) {
            s(x)?;
        }
    }
    let mut ids = Ids::default();
    match k {
        "apply" => {
            let a = &v["apply"];
            shape(
                a,
                &["kind", "source", "ms"],
                &["ability", "tag", "value", "add", "data", "quiet"],
            )?;
            source(&a["source"])?;
            if let Some(x) = a.get("add") {
                shape(x, &["per", "cap"], &[])?;
            }
            ids.apply(a)?;
        }
        "find" => {
            kind(&v["statusKind"])?;
        }
        "read" => {
            if let Some(x) = v.get("at") {
                n(x)?;
            }
        }
        "remove" | "cleanse" => {
            super::selector(v, &mut ids)?;
            if k == "remove" {
                let x = &v["selector"];
                let req = match s(&x["kind"])? {
                    "all" => vec!["kind"],
                    "status" => vec!["kind", "statusKind"],
                    "source" => vec!["kind", "sourceId"],
                    _ => return Err("selector".into()),
                };
                shape(x, &req, &[])?;
            }
        }
        "clock" => clock_time(&v["at"])?,
        "reveal" => {
            n(&v["until"])?;
        }
        "collect" => boolean(&v["value"])?,
        "actorPatch" => actor_patch(&v["patch"])?,
        "runtimePatch" => {
            shape(&v["patch"], &[], &["path", "slip", "weapon"])?;
            runtime_patch(&v["patch"])?;
        }
        "displace" => point(&v["to"])?,
        "step" => {
            if n(&v["ms"])? != rh_sim::constants::TICK_MS {
                return Err("step must use fixed tick".into());
            }
        }
        "input" => {
            choice(&v["type"], &["attack", "release", "move"])?;
            let m = &v["message"];
            if v["type"] == "attack" || v["type"] == "release" {
                shape(m, &[], &["a", "t", "lagMs"])?;
                for k in ["a", "lagMs"] {
                    if let Some(x) = m.get(k) {
                        n(x)?;
                    }
                }
                if let Some(x) = m.get("t") {
                    if !x.is_null() {
                        s(x)?;
                    }
                }
            } else {
                shape(m, &["x", "y"], &["seq"])?;
                geometry(&m["x"])?;
                geometry(&m["y"])?;
                if let Some(x) = m.get("seq") {
                    uint(x, 255)?;
                }
            }
        }
        "extraRows" => {
            super::boundary_v3::rows(&v["rows"])?;
        }
        "mapReplace" => {
            super::boundary_v3::map(&v["rows"])?;
        }
        "farmSetup" => {
            super::boundary_v3::counts(&v["counts"])?;
        }
        "heal" => {
            n(&v["amount"])?;
            if let Some(o) = v.get("options") {
                shape(o, &[], &["lifesteal", "ignoreLockout", "source"])?;
                for (k, x) in o.as_object().unwrap() {
                    if k == "source" {
                        s(x)?;
                    } else {
                        boolean(x)?
                    }
                }
            }
        }
        "ledgerHit" | "deferHit" => {
            hit(&v["hit"], false)?;
            ids.hit(&v["hit"])?;
        }
        "fieldAdd" => {
            field(&v["field"], false)?;
            ids.field_input(&v["field"])?;
        }
        "fieldRemove" => {
            if v.get("alias").is_some() == v.get("id").is_some() {
                return Err("exactly one field reference required".into());
            }
        }
        "fieldRemoveWhere" => {
            let x = &v["selector"];
            match s(&x["kind"])? {
                "all" => shape(x, &["kind"], &["size"])?,
                "owner" => {
                    shape(x, &["kind", "ownerId"], &["size"])?;
                    s(&x["ownerId"])?;
                }
                _ => return Err("field selector".into()),
            }
            if let Some(x) = x.get("size") {
                uint(x, 9_007_199_254_740_991)?;
            }
        }
        "onTrail" => point(&v["point"])?,
        "statusDamage" => {
            n(&v["dtMs"])?;
        }
        "clearFighter" => choice(&v["cause"], &["down", "removed"])?,
        "clearAll" => choice(&v["cause"], &["teleport", "runEnd"])?,
        "floorHp" => {
            n(&v["before"])?;
            n(&v["total"])?;
        }
        "onHook" => {
            if nested {
                return Err("recursive recipe".into());
            }
            choice(&v["hook"], &["hurt"])?;
            s(&v["victim"])?;
            let ops = arr(&v["operations"])?;
            if ops.is_empty() || ops.len() > 8 {
                return Err("recipe size".into());
            }
            for op in ops {
                operation(op, true, v3)?;
                super::reaction(op, &mut ids)?;
            }
        }
        "drain" | "queueNested" | "removePlayer" | "applyLedger" | "clearLedger" | "fieldsRead"
        | "updateAbilities" | "abilityDotFx" | "runEnded" | "teleported" => (),
        _ => return Err("unsupported operation".into()),
    }
    Ok(())
}
// Pure declared-input reference pass. Source snapshot identities are never used to admit inputs.
fn references(case: &V) -> R<()> {
    use std::collections::BTreeSet;
    let input = &case["setup"]["input"];
    let mut allocated: BTreeSet<String> = arr(&input["players"])?
        .iter()
        .map(|p| s(&p["id"]).map(str::to_owned))
        .collect::<R<_>>()?;
    if input["trusted"]["roles"] == true {
        allocated.extend(["mob-role".into(), "quest-role".into()]);
    }
    let mut live = allocated.clone();
    let mut aliases = BTreeSet::new();
    fn op(
        v: &V,
        allocated: &BTreeSet<String>,
        live: &mut BTreeSet<String>,
        aliases: &mut BTreeSet<String>,
    ) -> R<()> {
        let kind = s(&v["kind"])?;
        if kind != "fieldRemove" {
            if let Some(id) = v.get("id") {
                let id = s(id)?;
                if !allocated.contains(id) {
                    return Err("undeclared actor target".into());
                }
                if !matches!(kind, "removePlayer" | "clearFighter") && !live.contains(id) {
                    return Err("departed direct actor target".into());
                }
            }
        }
        if kind == "fieldAdd" {
            if let Some(subject) = v["field"].get("subject").filter(|s| !s.is_null()) {
                if !allocated.contains(s(subject)?) {
                    return Err("undeclared field subject".into());
                }
            }
            if let Some(alias) = v.get("alias") {
                if !aliases.insert(s(alias)?.to_owned()) {
                    return Err("duplicate field alias".into());
                }
            }
        } else if let Some(alias) = v.get("alias") {
            if !aliases.contains(s(alias)?) {
                return Err("undeclared field alias".into());
            }
        }
        if let Some(alias) = v.get("linkField") {
            if !aliases.contains(s(alias)?) {
                return Err("undeclared linked field".into());
            }
        }
        if matches!(kind, "ledgerHit" | "deferHit") && !allocated.contains(s(&v["hit"]["victim"])?)
        {
            return Err("undeclared damage victim".into());
        }
        if kind == "onHook" {
            if !allocated.contains(s(&v["victim"])?) {
                return Err("undeclared hook victim".into());
            }
            for child in arr(&v["operations"])? {
                op(child, allocated, &mut live.clone(), &mut aliases.clone())?;
            }
        }
        if kind == "removePlayer" {
            live.remove(s(&v["id"])?);
        }
        Ok(())
    }
    for v in arr(&case["operations"])? {
        op(v, &allocated, &mut live, &mut aliases)?;
    }
    Ok(())
}
pub(super) fn fixture(v: &V) -> R<()> {
    let v3 = v["slice"] == "review-boundaries/3";
    shape(
        v,
        &["format", "slice", "provenance", "shared", "rules", "cases"],
        if v3 { &["policies"] } else { &[] },
    )?;
    if v3 {
        equal(
            &v["policies"],
            &serde_json::json!({"farmLifesteal":{"mobType":"rotMonk","effect":{"k":"stat","stat":"lifesteal","v":super::boundary_v3::FARM_COEFFICIENT},"countMax":super::boundary_v3::COUNT_MAX}}),
            "trusted farm policy",
        )?;
    }
    if v["format"] != "rh-status-probes/1" {
        return Err("format".into());
    }
    let metadata: V = serde_json::from_str(include_str!(
        "../../../../../parity/status/source-metadata.json"
    ))
    .map_err(|e| e.to_string())?;
    let expected = metadata.get(s(&v["slice"])?).ok_or("unknown slice")?;
    equal(
        &v["provenance"],
        &expected["provenance"],
        "bound source provenance",
    )?;
    let cases = arr(&v["cases"])?;
    let names: Vec<_> = cases.iter().map(|c| c["name"].clone()).collect();
    equal(
        &serde_json::json!(names),
        &expected["cases"],
        "ordered case inventory",
    )?;
    let rules:Vec<_>=rt::STATUS_KINDS.iter().map(|kind|{let r=kind.rule();let mut row=serde_json::json!({"kind":kind,"maxMs":r.max_ms,"combine":r.combine,"cleanse":r.cleanse,"bit":r.bit});if let Some(cap)=r.cap{row["cap"]=serde_json::json!(cap)}
if r.players_only{row["playersOnly"]=serde_json::json!(true)}row}).collect();
    equal(
        &serde_json::json!(rules),
        &v["rules"],
        "native ordered rules",
    )?;
    let blaze = rt::rank_one_field_policy(rt::AbilityId::Blaze)
        .burn
        .unwrap();
    let trial = rt::rank_one_field_policy(rt::AbilityId::Trial)
        .exit_stun_ms
        .unwrap();
    equal(
        &serde_json::json!({"tickMs":rh_sim::constants::TICK_MS,"effectCasting":rt::EFFECT_CASTING,"hiddenRevealMs":rt::HIDDEN_REVEAL_MS,"dotFxMs":rh_sim::constants::DOT_FX_MS,"fieldFallback":{"blaze":{"dps":blaze.0,"dotMs":blaze.1},"trial":{"exitStunMs":trial}}}),
        &v["shared"],
        "native shared policy",
    )?;
    for c in cases {
        shape(
            c,
            &[
                "name",
                "classification",
                "boundary",
                "setup",
                "operations",
                "steps",
                "observerFullStateEquality",
                "observerReturnEquality",
                "sourceRandomContinuationEquality",
            ],
            &[],
        )?;
        choice(&c["classification"], &["trusted-helper", "ordinary-input"])?;
        if s(&c["boundary"])?.is_empty() {
            return Err("empty boundary".into());
        }
        for k in [
            "observerFullStateEquality",
            "observerReturnEquality",
            "sourceRandomContinuationEquality",
        ] {
            if c[k] != true {
                return Err("source assurance".into());
            }
        }
        shape(&c["setup"], &["input", "initial"], &[])?;
        setup(&c["setup"]["input"])?;
        references(c)?;
        for (k, value) in expected["factoryRandomInput"]
            .as_object()
            .ok_or("factory metadata")?
        {
            equal(
                &c["setup"]["input"][k],
                value,
                "captured factory random input",
            )?;
        }
        snapshot(&c["setup"]["initial"], v3)?;
        let ops = arr(&c["operations"])?;
        let steps = arr(&c["steps"])?;
        if ops.is_empty() || ops.len() != steps.len() {
            return Err("step inventory".into());
        }
        for (op, step) in ops.iter().zip(steps) {
            operation(op, false, v3)?;
            shape(
                step,
                &["operation", "before", "returned", "after", "hooks"],
                &[],
            )?;
            equal(op, &step["operation"], "operation identity")?;
            snapshot(&step["before"], v3)?;
            snapshot(&step["after"], v3)?;
            outputs::returned(op, &step["returned"])?;
            outputs::hooks(&step["hooks"])?;
        }
    }
    Ok(())
}
