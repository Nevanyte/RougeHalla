//! Strict test-only decoder shared by the core and durable adapter proofs.
#![allow(dead_code)] // Each consumer checks its own boundary; the combined gates cover every field.
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Capture {
    pub format: String,
    pub source: String,
    pub cases: Vec<Case>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Case {
    pub input: Input,
    pub result: Option<LegacyResult>,
    pub record: Option<Record>,
    pub banks: Vec<u32>,
    pub stats: Value,
    pub progress: Value,
    pub gv: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub name: String,
    pub faction: Option<String>,
    pub weapon0: Option<String>,
    pub weapon1: Option<String>,
    pub slot: u8,
    pub swap: bool,
    pub finish: String,
    pub qualified: bool,
    pub bot: bool,
    pub training: bool,
    pub earned: u32,
}
#[derive(Deserialize, serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyResult {
    pub outcome: String,
    pub profile: String,
    pub duration_sec: u32,
    pub kills: u32,
    pub killed_by: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub killed_by_bot: bool,
    pub place: u32,
    pub players: u32,
    pub gv: Gv,
    pub win_bonus_withheld: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub win_bonus_why: Option<String>,
}
#[derive(Deserialize, serde::Serialize, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Gv {
    pub kills: u32,
    pub mobs: u32,
    pub bounty: u32,
    pub quest: u32,
    pub win: u32,
    pub total: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    pub outcome: String,
    pub kills: u32,
    pub gv: u32,
    pub bounty: u32,
    pub faction: Option<String>,
    pub weapon: Option<String>,
    pub win_qualified: bool,
}
pub fn capture() -> Capture {
    let capture: Capture = serde_json::from_str(include_str!("ending-metadata.json")).unwrap();
    assert_eq!(capture.format, "rh-ending-metadata/1");
    assert_eq!(capture.cases.len(), 15);
    capture
}
