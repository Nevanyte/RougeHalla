//! Source card catalog (80 definitions). Fold rows and hook payloads share this table.
use crate::stat_fold::{
    ConvertFrom, ConvertTo, EffectFlag, EffectKind, EffectRow, EffectStat, FlatStat, MultKey,
    StatKey, WhileCond, WhileRow,
};
use crate::FactionId;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[path = "catalog_data.rs"]
mod catalog_data;
use catalog_data::ROWS;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OnHitStatus {
    SlowMove,
    SlowAttack,
    AntiHeal,
    Dot,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TriggerOn {
    HpBelow,
    Kill,
    HitTaken,
    Hit,
    Block,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum VsTest {
    HpAbove,
    HpBelow,
    Slowed,
    Rooted,
    Streak,
    ThirdParty,
    HigherFeed,
    Elite,
    HigherPower,
    PlayerAbove,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ScaleSource {
    OwnMissingHp,
    CampsCleared,
    Streak,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TriggerAction {
    Splash {
        radius: f64,
    },
    Fortify {
        per: f64,
        cap: f64,
    },
    Status {
        to_self: bool,
        kind: OnHitStatus,
        ms: f64,
        value: Option<f64>,
    },
    Boost {
        attack_speed: f64,
        movement: f64,
        ms: f64,
    },
    Cooldown {
        ms: f64,
    },
    Return {
        share: f64,
        melee: bool,
    },
    Heal {
        share: f64,
        ignore_lockout: bool,
        ms: Option<f64>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CardEffect {
    Stat {
        stat: EffectStat,
        v: f64,
    },
    Flat {
        stat: FlatStat,
        v: f64,
    },
    Mult {
        key: MultKey,
        v: f64,
    },
    Flag(EffectFlag),
    Convert {
        from: ConvertFrom,
        to: ConvertTo,
        per: f64,
        cap: Option<f64>,
    },
    While {
        cond: WhileCond,
        arg: f64,
        stat: StatKey,
        v: f64,
        ms: Option<f64>,
    },
    OnHit {
        status: OnHitStatus,
        per: f64,
        cap: f64,
        ms: f64,
    },
    Vs {
        test: VsTest,
        arg: f64,
        v: f64,
    },
    Scale {
        src: ScaleSource,
        per: f64,
        step: f64,
        cap: Option<f64>,
    },
    Trigger {
        on: TriggerOn,
        arg: f64,
        once: bool,
        action: TriggerAction,
    },
}

/// Source card id. Wire and chest JSON use the catalog string, not the index.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct CardId(u8);

impl CardId {
    pub const OFFER: [CardId; 3] = [Self::SlowBurn, Self::PocketSand, Self::Siphon];

    pub const fn index(self) -> usize {
        self.0 as usize
    }

    pub const fn as_str(self) -> &'static str {
        Self::NAMES[self.index()]
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::NAMES
            .iter()
            .position(|name| *name == s)
            .map(|i| Self(i as u8))
    }

    pub const fn tier(self) -> u8 {
        ROWS[self.index()].tier
    }

    pub const fn unique(self) -> bool {
        ROWS[self.index()].unique
    }

    pub fn effects(self, faction: FactionId) -> &'static [CardEffect] {
        let row = &ROWS[self.index()];
        if faction == FactionId::Plague && !row.plague.is_empty() {
            row.plague
        } else {
            row.effects
        }
    }
}

impl Serialize for CardId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for CardId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let name = String::deserialize(deserializer)?;
        Self::parse(&name).ok_or_else(|| serde::de::Error::custom("unknown card"))
    }
}

pub fn has_flag(build: &super::Build, faction: FactionId, flag: EffectFlag) -> bool {
    build.cards().any(|id| {
        id.effects(faction)
            .iter()
            .any(|e| matches!(e, CardEffect::Flag(f) if *f == flag))
    })
}

pub fn triggers(
    build: &super::Build,
    faction: FactionId,
    on: TriggerOn,
) -> impl Iterator<Item = &CardEffect> {
    build.cards().flat_map(move |id| {
        id.effects(faction)
            .iter()
            .filter(move |e| matches!(e, CardEffect::Trigger { on: found, .. } if *found == on))
    })
}

pub fn on_hits(build: &super::Build, faction: FactionId) -> impl Iterator<Item = &CardEffect> {
    build.cards().flat_map(move |id| {
        id.effects(faction)
            .iter()
            .filter(|e| matches!(e, CardEffect::OnHit { .. }))
    })
}

/// Stack-only fold rows. Hook payloads stay on [`CardEffect`] and are not folded.
pub fn write_fold_rows<'a>(
    build: &super::Build,
    faction: FactionId,
    out: &'a mut [EffectRow<'static>],
) -> &'a [EffectRow<'static>] {
    let mut n = 0;
    for id in CardId::ALL {
        let count = build.count(id);
        if count == 0 {
            continue;
        }
        for _ in 0..count {
            for effect in id.effects(faction) {
                let kind = match *effect {
                    CardEffect::Stat { stat, v } => EffectKind::Stat { stat, v },
                    CardEffect::Flat { stat, v } => EffectKind::Flat { stat, v },
                    CardEffect::Mult { key, v } => EffectKind::Mult { key, v },
                    CardEffect::Flag(flag) => EffectKind::Flag { flag },
                    CardEffect::Convert { from, to, per, cap } => {
                        EffectKind::Convert { from, to, per, cap }
                    }
                    CardEffect::While {
                        cond,
                        arg,
                        stat,
                        v,
                        ms,
                    } => EffectKind::While(WhileRow {
                        cond,
                        arg,
                        stat,
                        v,
                        ms,
                    }),
                    CardEffect::OnHit { .. }
                    | CardEffect::Vs { .. }
                    | CardEffect::Scale { .. }
                    | CardEffect::Trigger { .. } => continue,
                };
                out[n] = EffectRow::new(kind);
                n += 1;
            }
        }
    }
    &out[..n]
}

pub fn visit_content(mut word: impl FnMut(u64)) {
    word(ROWS.len() as u64);
    for row in &ROWS {
        word(row.id.len() as u64);
        word(row.tier as u64);
        word(u64::from(row.unique));
        for effect in row.effects.iter().chain(row.plague.iter()) {
            visit_effect(effect, &mut word);
        }
    }
}

fn visit_effect(effect: &CardEffect, word: &mut impl FnMut(u64)) {
    match *effect {
        CardEffect::Stat { v, .. }
        | CardEffect::Flat { v, .. }
        | CardEffect::Mult { v, .. }
        | CardEffect::Vs { v, .. } => word(v.to_bits()),
        CardEffect::Flag(_) => word(1),
        CardEffect::Convert { per, cap, .. } => {
            word(per.to_bits());
            word(cap.unwrap_or(0.).to_bits());
        }
        CardEffect::While { arg, v, ms, .. } => {
            word(arg.to_bits());
            word(v.to_bits());
            word(ms.unwrap_or(0.).to_bits());
        }
        CardEffect::OnHit { per, cap, ms, .. } => {
            word(per.to_bits());
            word(cap.to_bits());
            word(ms.to_bits());
        }
        CardEffect::Scale { per, step, cap, .. } => {
            word(per.to_bits());
            word(step.to_bits());
            word(cap.unwrap_or(0.).to_bits());
        }
        CardEffect::Trigger { arg, action, .. } => {
            word(arg.to_bits());
            match action {
                TriggerAction::Splash { radius } => word(radius.to_bits()),
                TriggerAction::Fortify { per, cap } => {
                    word(per.to_bits());
                    word(cap.to_bits());
                }
                TriggerAction::Status { ms, value, .. } => {
                    word(ms.to_bits());
                    word(value.unwrap_or(0.).to_bits());
                }
                TriggerAction::Boost {
                    attack_speed,
                    movement,
                    ms,
                } => {
                    word(attack_speed.to_bits());
                    word(movement.to_bits());
                    word(ms.to_bits());
                }
                TriggerAction::Cooldown { ms } => word(ms.to_bits()),
                TriggerAction::Return { share, .. } => word(share.to_bits()),
                TriggerAction::Heal { share, ms, .. } => {
                    word(share.to_bits());
                    word(ms.unwrap_or(0.).to_bits());
                }
            }
        }
    }
}
