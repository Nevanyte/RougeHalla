use crate::constants::{AXE_SHRED_CAP, AXE_SHRED_MS};
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[repr(u8)]
pub enum StatusKind {
    Stun,
    Root,
    Silence,
    SlowMove,
    SlowAttack,
    AntiHeal,
    Dot,
    Invulnerable,
    Untargetable,
    Hidden,
    Zoned,
    DeathFloor,
    Haste,
    Shred,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Combine {
    Any,
    Sum,
    Max,
    Product,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CleanseClass {
    Soft,
    Hard,
    Never,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StatusRule {
    pub max_ms: f64,
    pub combine: Combine,
    pub cap: Option<f64>,
    pub cleanse: CleanseClass,
    pub bit: u16,
    pub players_only: bool,
}
pub const STATUS_KINDS: [StatusKind; 14] = [
    StatusKind::Stun,
    StatusKind::Root,
    StatusKind::Silence,
    StatusKind::SlowMove,
    StatusKind::SlowAttack,
    StatusKind::AntiHeal,
    StatusKind::Dot,
    StatusKind::Invulnerable,
    StatusKind::Untargetable,
    StatusKind::Hidden,
    StatusKind::Zoned,
    StatusKind::DeathFloor,
    StatusKind::Haste,
    StatusKind::Shred,
];
const fn rule(
    max_ms: f64,
    combine: Combine,
    cap: Option<f64>,
    cleanse: CleanseClass,
    bit: u16,
    players_only: bool,
) -> StatusRule {
    StatusRule {
        max_ms,
        combine,
        cap,
        cleanse,
        bit,
        players_only,
    }
}
pub const STATUS_RULES: [StatusRule; 14] = {
    use CleanseClass::*;
    use Combine::*;
    [
        rule(3000., Any, None, Hard, 1, false),
        rule(3000., Any, None, Hard, 2, false),
        rule(3000., Any, None, Hard, 4, false),
        rule(5000., Sum, Some(0.6), Soft, 8, false),
        rule(5000., Sum, Some(0.5), Soft, 16, false),
        rule(6000., Sum, Some(0.6), Soft, 32, false),
        rule(10000., Sum, None, Soft, 64, false),
        rule(3000., Any, None, Never, 0, true),
        rule(10000., Any, None, Never, 128, false),
        rule(10000., Any, None, Never, 256, true),
        rule(8000., Product, None, Never, 512, false),
        rule(6000., Any, None, Never, 1024, true),
        rule(8000., Max, Some(0.5), Never, 2048, false),
        rule(AXE_SHRED_MS, Sum, Some(AXE_SHRED_CAP), Soft, 0, false),
    ]
};
pub const HIDDEN_REVEAL_MS: f64 = 500.;
pub const EFFECT_CASTING: u16 = 4096;
impl StatusKind {
    pub const fn rule(self) -> &'static StatusRule {
        &STATUS_RULES[self as usize]
    }
}
/// The table used by execution is also the content identity's sole status-policy source.
pub fn visit_content(mut word: impl FnMut(u64)) {
    for kind in STATUS_KINDS {
        let r = kind.rule();
        word(kind as u64);
        word(r.max_ms.to_bits());
        word(r.combine as u64);
        word(r.cap.is_some() as u64);
        if let Some(cap) = r.cap {
            word(cap.to_bits())
        }
        word(r.cleanse as u64);
        word(r.bit as u64);
        word(r.players_only as u64);
    }
    word(HIDDEN_REVEAL_MS.to_bits());
    word(EFFECT_CASTING as u64);
}

pub fn visit_extra_content(mut word: impl FnMut(u64)) {
    for kind in [
        super::FieldKind::Zone,
        super::FieldKind::Cloud,
        super::FieldKind::Trail,
    ] {
        word(kind as u64);
    }
    for v in [super::HASTE_BASE_FLOOR, super::DEATH_FLOOR_DEFAULT_HP] {
        word(v.to_bits());
    }
    for v in [
        super::stats::LIFESTEAL_MAX,
        super::stats::HOLY_LEECH_ROW_MULT,
    ] {
        word(v.to_bits());
    }
    word(super::stats::CRIT_EPSILON.to_bits());
    word(super::stats::CRIT_MULT.to_bits());
    word(super::stats::CRIT_CHANCE_MAX.to_bits());
    for id in super::AbilityId::ALL {
        word(id as u64);
        word(id.as_str().len() as u64);
        for byte in id.as_str().bytes() {
            word(u64::from(byte));
        }
        let p = super::rank_one_field_policy(id);
        word(p.exit_stun_ms.is_some() as u64);
        if let Some(v) = p.exit_stun_ms {
            word(v.to_bits())
        }
        word(p.burn.is_some() as u64);
        if let Some((dps, ms)) = p.burn {
            word(dps.to_bits());
            word(ms.to_bits())
        }
    }
    // The ordinary axe producer uses this exact source key for status identity.
    let axe_tag = super::StatusTag::Axe;
    word(axe_tag.as_str().len() as u64);
    for byte in axe_tag.as_str().bytes() {
        word(u64::from(byte));
    }
}
