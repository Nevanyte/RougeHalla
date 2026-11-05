// Test-only strict shapes for the two standalone actual-source proof formats.
use serde_json::Value;
fn keys(v: &Value, required: &[&str], optional: &[&str]) -> Result<(), String> {
    let o = v.as_object().ok_or("expected object")?;
    if let Some(k) = o
        .keys()
        .find(|k| !required.contains(&k.as_str()) && !optional.contains(&k.as_str()))
    {
        return Err(format!("unknown proof key {k}"));
    }
    if let Some(k) = required.iter().find(|k| !o.contains_key(**k)) {
        return Err(format!("missing proof key {k}"));
    }
    Ok(())
}
fn rows(v: &Value, required: &[&str]) -> Result<(), String> {
    for row in v.as_array().ok_or("expected proof array")? {
        keys(row, required, &[])?;
    }
    Ok(())
}
fn modules(v: &Value) -> Result<(), String> {
    let actual: Vec<_> = v
        .as_array()
        .ok_or("missing modules")?
        .iter()
        .map(Value::as_str)
        .collect();
    let expected = [
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
        "mods",
    ];
    if actual != expected.map(Some) {
        return Err("different proof installation".into());
    }
    Ok(())
}
pub fn matrix(v: &Value) -> Result<(), String> {
    keys(v, &["format", "modules", "cases"], &[])?;
    if v["format"] != "rh-plague-ledger-matrix/1" {
        return Err("unknown matrix format".into());
    }
    modules(&v["modules"])?;
    for case in v["cases"].as_array().ok_or("missing cases")? {
        keys(
            case,
            &["setup", "hooks", "landed", "players", "buckets"],
            &[],
        )?;
        keys(
            &case["setup"],
            &["name", "entries"],
            &["barrier", "immune", "hp", "depart", "pvp"],
        )?;
        rows(
            &case["setup"]["entries"],
            &["by", "raw", "execute", "scale", "sig", "weapon", "victim"],
        )?;
        rows(&case["hooks"], &["victim", "by", "amount", "sig"])?;
        rows(
            &case["landed"],
            &["victim", "by", "amount", "weapon", "sig"],
        )?;
        rows(&case["players"], &["id", "hp", "barrier", "status"])?;
        rows(
            &case["buckets"],
            &["victim", "by", "sig", "weapon", "amount"],
        )?;
    }
    Ok(())
}
pub fn hidden(v: &Value) -> Result<(), String> {
    keys(v, &["format", "setup", "a", "b"], &[])?;
    if v["format"] != "rh-plague-hidden-history/1" {
        return Err("unknown history format".into());
    }
    keys(
        &v["setup"],
        &[
            "map",
            "randomSeed",
            "modules",
            "moveTick",
            "move",
            "attack",
            "initialVictimHp",
            "players",
            "weapons",
            "release",
            "eligible",
        ],
        &[],
    )?;
    modules(&v["setup"]["modules"])?;
    keys(&v["setup"]["map"], &["w", "h", "kind", "seed"], &[])?;
    keys(&v["setup"]["move"], &["x", "y"], &[])?;
    rows(&v["setup"]["players"], &["id", "faction", "x", "y"])?;
    for side in ["a", "b"] {
        keys(&v[side], &["bootstrap", "rows"], &[])?;
        rows(&v[side]["bootstrap"], &["id", "x", "y"])?;
        for row in v[side]["rows"].as_array().ok_or("missing history rows")? {
            keys(
                row,
                &[
                    "tick",
                    "x",
                    "visible",
                    "sourceVisible",
                    "hp",
                    "sig",
                    "landed",
                    "chunks",
                ],
                &[],
            )?;
            rows(&row["landed"], &["victim", "by", "amount", "weapon", "sig"])?;
            rows(
                &row["chunks"],
                &["kind", "id", "by", "amount", "weapon", "sig"],
            )?;
        }
    }
    Ok(())
}
#[test]
fn proof_schema_rejects_missing_extra_and_changed_installation() {
    let a: Value = serde_json::from_str(include_str!(
        "../../../../parity/plague/hidden-history.json"
    ))
    .unwrap();
    let b: Value =
        serde_json::from_str(include_str!("../../../../parity/plague/ledger-matrix.json")).unwrap();
    hidden(&a).unwrap();
    matrix(&b).unwrap();
    let mut bad = a.clone();
    bad["a"]["rows"][0]["uncompared"] = true.into();
    assert!(hidden(&bad).is_err());
    let mut bad = a;
    bad["setup"]["modules"][0] = "other".into();
    assert!(hidden(&bad).is_err());
    let mut bad = b.clone();
    bad["cases"][0]["landed"][0]["uncompared"] = true.into();
    assert!(matrix(&bad).is_err());
    let mut bad = b;
    bad["cases"][0].as_object_mut().unwrap().remove("hooks");
    assert!(matrix(&bad).is_err());
}
