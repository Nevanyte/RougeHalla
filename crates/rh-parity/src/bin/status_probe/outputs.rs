//! Closed owned output schemas. Unported schema maps are retained as labelled source evidence,
//! never execution inputs; the native projection compares only its explicitly owned facts.
use super::*;
fn statuses(v: &V) -> R<()> {
    if *v == undef() {
        return Ok(());
    }
    for st in arr(v)? {
        status(st)?
    }
    Ok(())
}
fn text_or_null(v: &V) -> R<()> {
    if !v.is_null() {
        s(v)?;
    }
    Ok(())
}
fn reader(v: &V) -> R<()> {
    let flags = [
        "actionBlocked",
        "cannotMove",
        "castBlocked",
        "casting",
        "hidden",
        "rooted",
        "silenced",
        "slowed",
        "stunned",
        "untargetable",
        "untargetableAt",
        "untargetableId",
    ];
    let numbers = [
        "attackSlowFactor",
        "damageFactor",
        "dealtFactor",
        "healFactor",
        "moveMultiplier",
    ];
    let mut required = flags.to_vec();
    required.extend(numbers);
    required.extend(["effects", "statuses", "values"]);
    shape(v, &required, &[])?;
    for k in flags {
        boolean(&v[k])?
    }
    for k in numbers {
        n(&v[k])?;
    }
    uint(&v["effects"], 65535)?;
    statuses(&v["statuses"])?;
    let values = arr(&v["values"])?;
    if values.len() != rt::STATUS_KINDS.len() {
        return Err("reader kind inventory".into());
    }
    for (row, kind) in values.iter().zip(rt::STATUS_KINDS) {
        shape(row, &["kind", "value"], &[])?;
        equal(
            &row["kind"],
            &serde_json::to_value(kind).unwrap(),
            "reader kind order",
        )?;
        n(&row["value"])?;
    }
    Ok(())
}
pub(super) fn returned(op: &V, v: &V) -> R<()> {
    match s(&op["kind"])? {
        "read" => reader(v)?,
        "apply" => {
            if !v.is_null() {
                status(v)?
            }
        }
        "find" => {
            if *v != undef() {
                status(v)?
            }
        }
        "remove" | "cleanse" => {
            for st in arr(v)? {
                status(st)?
            }
        }
        "fieldAdd" => field(v, true)?,
        "fieldRemove" => {
            if !v.is_null() {
                field(v, true)?
            }
        }
        "fieldsRead" => pairs(v, |f| field(f, true))?,
        "fieldRemoveWhere" => {
            shape(v, &["removed", "visited"], &[])?;
            for f in arr(&v["removed"])? {
                field(f, true)?
            }
            for p in arr(&v["visited"])? {
                shape(p, &["id", "size"], &[])?;
                s(&p["id"])?;
                uint(&p["size"], u32::MAX.into())?;
            }
        }
        "input" | "onTrail" => boolean(v)?,
        "heal" | "floorHp" => {
            n(v)?;
        }
        "ledgerHit" | "deferHit" => {
            if *v != undef() {
                hit(v, true)?
            }
        }
        "step" => events(v)?,
        "clock" | "reveal" | "collect" | "drain" | "displace" | "actorPatch" | "runtimePatch"
        | "queueNested" | "removePlayer" | "updateAbilities" | "applyLedger" | "clearAll"
        | "clearFighter" | "clearLedger" | "onHook" | "statusDamage" | "abilityDotFx"
        | "runEnded" | "teleported" | "extraRows" | "mapReplace" | "farmSetup" => {
            equal(v, &undef(), "undefined helper result")?;
        }
        _ => return Err("unsupported returned operation".into()),
    }
    Ok(())
}
pub(super) fn events(v: &V) -> R<()> {
    for e in arr(v)? {
        match s(&e["type"])? {
            "fx" => {
                shape(e, &["type", "fx"], &[])?;
                let f = &e["fx"];
                match s(&f["kind"])? {
                    "status" => {
                        shape(f, &["kind", "id", "by", "status", "ms"], &[])?;
                        s(&f["id"])?;
                        text_or_null(&f["by"])?;
                        kind(&f["status"])?;
                        n(&f["ms"])?;
                    }
                    "castEnd" => {
                        shape(f, &["kind", "by", "ability", "reason"], &[])?;
                        s(&f["by"])?;
                        ability(&f["ability"])?;
                        choice(&f["reason"], &["interrupted", "cancelled"])?;
                    }
                    "hit" => {
                        shape(f, &["kind", "id", "by", "amount", "weapon"], &["ability"])?;
                        s(&f["id"])?;
                        s(&f["by"])?;
                        n(&f["amount"])?;
                        if !f["weapon"].is_null() {
                            weapon_id(&f["weapon"])?
                        }
                        if let Some(a) = f.get("ability") {
                            ability(a)?
                        }
                    }
                    "heal" => {
                        shape(f, &["kind", "id", "amount"], &[])?;
                        s(&f["id"])?;
                        n(&f["amount"])?;
                    }
                    "death" => {
                        shape(f, &["kind", "id", "by", "x", "y"], &[])?;
                        s(&f["id"])?;
                        text_or_null(&f["by"])?;
                        geometry(&f["x"])?;
                        geometry(&f["y"])?;
                    }
                    "windup" => {
                        shape(f, &["kind", "by", "weapon", "a", "ms"], &[])?;
                        s(&f["by"])?;
                        weapon_id(&f["weapon"])?;
                        n(&f["a"])?;
                        n(&f["ms"])?;
                    }
                    "swing" => {
                        shape(f, &["kind", "by", "weapon", "x", "y", "a"], &[])?;
                        s(&f["by"])?;
                        weapon_id(&f["weapon"])?;
                        geometry(&f["x"])?;
                        geometry(&f["y"])?;
                        n(&f["a"])?;
                    }
                    _ => return Err("unsupported source FX".into()),
                }
            }
            "gv" => {
                shape(e, &["type", "id", "amount", "reason"], &[])?;
                s(&e["id"])?;
                uint(&e["amount"], u32::MAX.into())?;
                choice(&e["reason"], &["kill", "bounty", "mob", "quest", "win"])?;
            }
            "resolved" => {
                shape(e, &["type", "id", "result"], &[])?;
                s(&e["id"])?;
                let r = &e["result"];
                shape(
                    r,
                    &[
                        "profile",
                        "outcome",
                        "durationSec",
                        "kills",
                        "killedBy",
                        "place",
                        "players",
                        "gv",
                        "winBonusWithheld",
                    ],
                    &[],
                )?;
                s(&r["profile"])?;
                choice(&r["outcome"], &["mia", "died", "won"])?;
                text_or_null(&r["killedBy"])?;
                boolean(&r["winBonusWithheld"])?;
                for k in ["durationSec", "kills", "place", "players"] {
                    uint(&r[k], u32::MAX.into())?;
                }
                shape(
                    &r["gv"],
                    &["bounty", "kills", "mobs", "quest", "total", "win"],
                    &[],
                )?;
                for x in r["gv"].as_object().unwrap().values() {
                    uint(x, u32::MAX.into())?;
                }
            }
            _ => return Err("unsupported source event".into()),
        }
    }
    Ok(())
}
fn actor(v: &V) -> R<()> {
    shape(v, &["kind", "id", "state", "statuses"], &[])?;
    choice(&v["kind"], &["player", "mob", "questGiver"])?;
    s(&v["id"])?;
    statuses(&v["statuses"])?;
    let state = &v["state"];
    let player = [
        "adBonus",
        "apBonus",
        "armorBonus",
        "asMult",
        "attackTarget",
        "barrier",
        "bot",
        "bounty",
        "brand",
        "build",
        "campClears",
        "corpseStacks",
        "displaceSeq",
        "drawStartedAt",
        "eReadyAt",
        "effects",
        "extra",
        "facing",
        "faction",
        "frostEliteGuard",
        "frostMoveMult",
        "gv",
        "healingUntil",
        "hp",
        "huntStacks",
        "huntTarget",
        "immuneUntil",
        "kills",
        "look",
        "markBy",
        "markTax",
        "markTier",
        "maxHp",
        "mobKills",
        "mobStats",
        "moveSeq",
        "name",
        "plagueZombieId",
        "planReady",
        "potionLarge",
        "potionSmall",
        "potionsHealing",
        "qReadyAt",
        "readyAt",
        "roamCharge",
        "roamReady",
        "sentence",
        "shieldBonus",
        "sig",
        "slot",
        "speedBoostUntil",
        "speedMult",
        "status",
        "tradeOffers",
        "tradeStats",
        "tradeUsed",
        "weapon0",
        "weapon1",
        "windupMult",
        "wishReadyAt",
        "x",
        "y",
    ];
    let mob = [
        "brand",
        "camp",
        "displaceSeq",
        "drawStartedAt",
        "effects",
        "facing",
        "faction",
        "hp",
        "kind",
        "markBy",
        "markTax",
        "markTier",
        "maxHp",
        "name",
        "ownerId",
        "readyAt",
        "sig",
        "slot",
        "status",
        "type",
        "weapon0",
        "weapon1",
        "x",
        "y",
    ];
    shape(
        state,
        if v["kind"] == "player" { &player } else { &mob },
        &[],
    )?;
    for (key, x) in state.as_object().unwrap() {
        match key.as_str() {
            "build" | "extra" | "mobStats" | "tradeStats" => {
                x.as_object().ok_or("source schema map")?;
                numeric_tree(x)?;
            }
            "tradeOffers" => {
                arr(x)?;
                numeric_tree(x)?;
            }
            "bot" | "frostEliteGuard" | "planReady" | "roamReady" | "tradeUsed" => boolean(x)?,
            "attackTarget" | "faction" | "huntTarget" | "markBy" | "name" | "plagueZombieId"
            | "status" | "weapon0" | "weapon1" | "kind" | "ownerId" | "type" => {
                s(x)?;
            }
            "x" | "y" => geometry(x)?,
            "displaceSeq" | "sig" => {
                uint(x, 255)?;
            }
            "effects" => {
                uint(x, 65535)?;
            }
            _ => {
                n(x)?;
            }
        }
    }
    Ok(())
}
pub(super) fn hooks(v: &V) -> R<()> {
    for h in arr(v)? {
        shape(h, &["name", "args"], &[])?;
        let a = arr(&h["args"])?;
        let name = s(&h["name"])?;
        let expected = match name {
            "statusApplied" | "castEnded" | "hurt" | "healed" | "arenaHurt" => 3,
            "attackStarted" => 1,
            "hitLanded" | "fighterOut" => 2,
            "teleported" | "runEnded" => 0,
            _ => return Err("unknown source hook".into()),
        };
        if a.len() != expected {
            return Err("hook argument count".into());
        }
        match name {
            "statusApplied" => {
                actor(&a[0])?;
                status(&a[1])?;
                boolean(&a[2])?;
            }
            "attackStarted" => actor(&a[0])?,
            "castEnded" => {
                actor(&a[0])?;
                ability(&a[1])?;
                choice(&a[2], &["interrupted", "cancelled", "landed"])?;
            }
            "hurt" | "healed" => {
                actor(&a[0])?;
                n(&a[1])?;
                if name == "hurt" {
                    n(&a[2])?;
                } else {
                    choice(&a[2], &["other", "lifesteal", "lastStand"])?;
                }
            }
            "hitLanded" => {
                hit(&a[0], true)?;
                n(&a[1])?;
            }
            "arenaHurt" => {
                s(&a[0])?;
                source(&a[1])?;
                n(&a[2])?;
            }
            "fighterOut" => {
                s(&a[0])?;
                choice(&a[1], &["down", "removed"])?;
            }
            _ => (),
        }
    }
    Ok(())
}
pub(super) fn callbacks(v: &V, v3: bool) -> R<()> {
    for c in arr(v)? {
        shape(
            c,
            &[
                "collecting",
                "hook",
                "operation",
                "returned",
                "statuses",
                "victim",
            ],
            &[],
        )?;
        boolean(&c["collecting"])?;
        choice(&c["hook"], &["hurt"])?;
        s(&c["victim"])?;
        operation(&c["operation"], true, v3)?;
        returned(&c["operation"], &c["returned"])?;
        statuses(&c["statuses"])?;
    }
    Ok(())
}
