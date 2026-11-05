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
    if v["format"] != "rh-fire-ledger-matrix/1" {
        return Err("unknown matrix format".into());
    }
    modules(&v["modules"])?;
    let cases = v["cases"].as_array().ok_or("missing cases")?;
    let expected_names = [
        "same-source-disease-execute",
        "mixed-hit-dot",
        "two-sources",
        "reverse-private-order",
        "partial-barrier",
        "full-barrier",
        "immunity",
        "overkill",
        "departed-source",
        "disabled-pvp",
        "zero-and-scaled",
        "distinct-victims",
    ];
    if cases.len() != expected_names.len() {
        return Err("incomplete matrix case inventory".into());
    }
    for (case, expected_name) in cases.iter().zip(expected_names) {
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
        if case["setup"]["name"].as_str() != Some(expected_name) {
            return Err(format!("expected matrix case {expected_name}"));
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../parity/fire/ledger-matrix.json"
        )))
        .unwrap()
    }

    #[test]
    fn matrix_requires_complete_ordered_case_inventory() {
        let original = fixture();
        matrix(&original).unwrap();
        for mutation in ["empty", "missing", "duplicate", "renamed", "reordered"] {
            let mut changed = original.clone();
            let cases = changed["cases"].as_array_mut().unwrap();
            match mutation {
                "empty" => cases.clear(),
                "missing" => { cases.pop(); }
                "duplicate" => cases[1] = cases[0].clone(),
                "renamed" => cases[0]["setup"]["name"] = Value::from("renamed"),
                "reordered" => cases.swap(0, 1),
                _ => unreachable!(),
            }
            assert!(matrix(&changed).is_err(), "accepted {mutation} inventory");
        }
    }
}
