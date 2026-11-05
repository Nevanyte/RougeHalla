use crate::stat_fold::{
    ConvertFrom, ConvertTo, EffectFlag, EffectStat, FlatStat, MultKey, StatKey,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WhileCond {
    ChasingLock,
    HpBelow,
    AfterCast,
    NotShooting,
    Unarmed,
    FightTime,
}

impl WhileCond {
    pub fn source_order() -> [Self; 6] {
        [
            Self::ChasingLock,
            Self::HpBelow,
            Self::AfterCast,
            Self::NotShooting,
            Self::Unarmed,
            Self::FightTime,
        ]
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WhileRow {
    pub cond: WhileCond,
    pub arg: f64,
    pub stat: StatKey,
    pub v: f64,
    pub ms: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EffectKind {
    Stat {
        stat: EffectStat,
        v: f64,
    },
    Flat {
        stat: FlatStat,
        v: f64,
    },
    Vs,
    Scale,
    While(WhileRow),
    OnHit,
    Trigger,
    Convert {
        from: ConvertFrom,
        to: ConvertTo,
        per: f64,
        cap: Option<f64>,
    },
    Mult {
        key: MultKey,
        v: f64,
    },
    Flag {
        flag: EffectFlag,
    },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EffectRow<'a> {
    pub kind: EffectKind,
    pub requires: &'a [&'a str],
    pub needs_status: bool,
}

impl<'a> EffectRow<'a> {
    pub const fn new(kind: EffectKind) -> Self {
        Self {
            kind,
            requires: &[],
            needs_status: false,
        }
    }

    pub const fn with_requirements(mut self, requires: &'a [&'a str]) -> Self {
        self.requires = requires;
        self
    }

    pub const fn with_status_requirement(mut self) -> Self {
        self.needs_status = true;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowList {
    Effects,
    Farm,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RowLocation {
    pub list: RowList,
    pub index: usize,
}

impl RowLocation {
    pub const fn new(list: RowList, index: usize) -> Self {
        Self { list, index }
    }
}

pub fn requirements_met(row: &EffectRow<'_>, owns: Option<&dyn Fn(&str) -> bool>) -> bool {
    if row.requires.is_empty() {
        return true;
    }
    let Some(owns) = owns else {
        return false;
    };
    row.requires.iter().all(|id| owns(id))
}
