//! Native port of the source bot's ownTimings component (packages/server/src/bots/brain/tactics/kite.ts):
//! the attack interval/windup the sim computes for the bot from its faction, weapon, asMult and windup mirror.
//! This is a pure timing component; it does not activate a fight, orb-walk, brain, policy seat or live dispatch.
use rh_sim::content::{mirror_timings, paced, WeaponId};
use rh_sim::FactionId;

use crate::bots::types::BotWeapon;

/// The source ownTimings result: both fields milliseconds, exact binary64 arithmetic.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OwnTimings {
    pub interval_ms: f64,
    pub windup_ms: f64,
}

fn weapon_of(weapon: BotWeapon) -> WeaponId {
    match weapon {
        BotWeapon::Sword => WeaponId::Sword,
        BotWeapon::Bow => WeaponId::Bow,
        BotWeapon::Wand => WeaponId::Wand,
        BotWeapon::Shield => WeaponId::Shield,
        BotWeapon::Axe => WeaponId::Axe,
        BotWeapon::Fists => WeaponId::Fists,
    }
}

/// The bot's own attack rhythm, or None while it has no faction. The caller owns missing owner/inventory/public-fact
/// refusal; this helper invents no eligibility, default faction, zero clocks or hidden facts. Fists means an
/// available empty hand (the explicit BotWeapon variant), never a missing-inventory fallback.
pub fn own_timings(
    faction: Option<FactionId>,
    weapon: BotWeapon,
    as_mult: f64,
    windup_mult: Option<f64>,
) -> Option<OwnTimings> {
    let faction = faction?;
    let paced = paced(faction);
    let scaled = mirror_timings(
        &paced,
        weapon_of(weapon),
        as_mult,
        windup_mult.unwrap_or(1.0),
        false,
    );
    Some(OwnTimings {
        interval_ms: scaled.interval * 1000.0,
        windup_ms: scaled.windup * 1000.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn corpus() -> Value {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../parity/policy/bot-fight/source.json"
        )))
        .unwrap()
    }

    fn num(v: &Value) -> f64 {
        v.as_f64().expect("finite source number")
    }

    fn exact(actual: f64, expected: &Value, at: &str) {
        assert_eq!(
            actual.to_bits(),
            num(expected).to_bits(),
            "{at}: native {actual:?} bits={:016x}, source {:?} bits={:016x}",
            actual.to_bits(),
            num(expected),
            num(expected).to_bits(),
        );
    }

    fn faction(name: &str) -> Option<FactionId> {
        Some(FactionId::parse(name).expect("admitted source faction"))
    }

    fn call(input: &Value, windup_override: Option<Option<f64>>) -> Option<OwnTimings> {
        let windup = match windup_override {
            Some(v) => v,
            None => input.get("windupMult").and_then(Value::as_f64),
        };
        own_timings(
            faction(input["faction"].as_str().unwrap()),
            BotWeapon::parse(input["weapon"].as_str().unwrap()).unwrap(),
            num(&input["asMult"]),
            windup,
        )
    }

    #[test]
    fn actual_source_90_timing_rows_match_exactly() {
        let corpus = corpus();
        let rows = corpus["timings"].as_array().unwrap();
        assert_eq!(rows.len(), 90, "source timing row count");
        let mut fists = 0;
        let mut default_windup = 0;
        for (i, row) in rows.iter().enumerate() {
            let actual = call(&row["input"], None).expect("faction timing row is Some");
            exact(
                actual.interval_ms,
                &row["result"]["intervalMs"],
                &format!("timings[{i}].intervalMs"),
            );
            exact(
                actual.windup_ms,
                &row["result"]["windupMs"],
                &format!("timings[{i}].windupMs"),
            );
            if row["input"]["weapon"] == "fists" {
                fists += 1;
                assert_eq!(
                    actual.windup_ms.to_bits(),
                    0.0f64.to_bits(),
                    "explicit Fists has the source's zero windup"
                );
            }
            if row["input"]["windupMult"].as_f64() == Some(1.0) {
                default_windup += 1;
                let defaulted =
                    call(&row["input"], Some(None)).expect("default windup row is Some");
                assert_eq!(
                    defaulted, actual,
                    "absent windup mirror defaults to the source's 1 on a real source row"
                );
            }
        }
        assert_eq!(fists, 15, "source 5 factions x 3 mirror pairs fists rows");
        assert!(
            default_windup > 0,
            "source rows with windupMult=1 provide the default control"
        );
    }

    #[test]
    fn six_no_faction_results_are_none() {
        let corpus = corpus();
        let rows = corpus["unavailableTiming"].as_array().unwrap();
        assert_eq!(rows.len(), 6, "source null no-faction row count");
        for (i, row) in rows.iter().enumerate() {
            assert!(row["result"].is_null(), "source row {i} is null");
            let weapon = BotWeapon::parse(row["weapon"].as_str().unwrap()).unwrap();
            assert_eq!(
                own_timings(None, weapon, 1.0, None),
                None,
                "no-faction row {i}"
            );
        }
    }

    #[test]
    fn explicit_fists_are_supported_and_never_missing_inventory() {
        let corpus = corpus();
        let fists_rows: Vec<_> = corpus["timings"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["input"]["weapon"] == "fists")
            .collect();
        assert_eq!(
            fists_rows.len(),
            15,
            "source Fists coverage 5 factions x 3 mirror pairs"
        );
        for row in fists_rows {
            let actual = call(&row["input"], None).expect("explicit Fists is supported");
            assert_eq!(actual.windup_ms.to_bits(), 0.0f64.to_bits(), "Fists windup");
            exact(
                actual.interval_ms,
                &row["result"]["intervalMs"],
                "fists.intervalMs",
            );
        }
        // The source's missingInventory diagnostic is invalid caller setup and is never a Fists fallback.
        // There is no API state here that can turn a missing array into BotWeapon::Fists.
    }
}
