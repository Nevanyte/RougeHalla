//! Narrow checked reader for the complete declared source Percept used by the private Memory folds.
//! This is declared method data, not a native BotVision/Observation or public intake proof.
use super::super::data::MethodValue;
use crate::bots::view::Features;
use rh_sim::{FactionId, Vec2, WeaponId};

#[derive(Clone, Debug)]
pub(crate) struct PerceptSelf {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub status: String,
    pub hp: f64,
    pub max_hp: f64,
    pub attack_target: Option<String>,
    pub move_seq: f64,
}

#[derive(Clone, Debug)]
pub(crate) struct PerceptFighter {
    pub id: String,
    pub name: String,
    pub bot: bool,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub status: String,
    pub hp_frac: f64,
    pub faction: Option<FactionId>,
    pub in_hand: Option<WeaponId>,
    pub draw_started_at: f64,
    pub bounty: f64,
    pub vx: f64,
    pub vy: f64,
}

#[derive(Clone, Debug)]
pub(crate) struct PerceptMob {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub type_: Option<String>,
    pub faction: Option<FactionId>,
    pub x: f64,
    pub y: f64,
    pub status: String,
    pub hp_frac: f64,
    pub in_hand: Option<WeaponId>,
}

#[derive(Clone, Debug)]
pub(crate) struct PerceptMinimapMob {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub faction: Option<FactionId>,
    pub elite: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct PerceptMinimap {
    pub t: f64,
    pub mobs: Vec<PerceptMinimapMob>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PerceptWeapon {
    Undefined,
    Null,
    Weapon(WeaponId),
}

#[derive(Clone, Debug)]
pub(crate) struct PerceptContainer {
    pub id: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub closed: bool,
    pub weapon: PerceptWeapon,
}

#[derive(Clone, Debug)]
pub(crate) struct PerceptProjectile {
    pub id: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub x0: f64,
    pub y0: f64,
    pub t0: f64,
    pub range: f64,
    pub from: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) enum PerceptEvent {
    Windup {
        by: String,
        weapon: WeaponId,
        a: f64,
        ms: f64,
    },
    Swing {
        by: String,
        weapon: WeaponId,
        a: f64,
    },
    Hit {
        id: String,
        by: Option<String>,
        amount: f64,
        weapon: Option<WeaponId>,
    },
    Block {
        id: String,
        by: Option<String>,
        weapon: Option<WeaponId>,
    },
    Stagger {
        id: String,
    },
    Cancel {
        id: String,
    },
    ProjEnd {
        id: String,
    },
    Death {
        id: String,
        name: String,
        by: Option<String>,
        mob: bool,
    },
    Heal {
        id: String,
    },
    Teleport,
    Bounty {
        id: String,
        name: String,
        bounty: f64,
    },
    Victory {
        id: Option<String>,
        name: Option<String>,
        draw: bool,
    },
    Toast {
        text: String,
    },
    Result,
    Private {
        type_: String,
    },
    Ext {
        fx: String,
        data: MethodValue,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct PerceptEventRow {
    pub t: f64,
    pub at: Option<Vec2>,
    pub kind: PerceptEvent,
}

#[derive(Clone, Debug)]
pub(crate) struct PerceptCampView {
    pub id: String,
    pub state: u8,
}

#[derive(Clone, Debug)]
pub(crate) struct PerceptChest {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub picked: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct PerceptPlan {
    pub ends_at: f64,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct PerceptExtras {
    pub camps: Vec<PerceptCampView>,
    pub chests: Vec<PerceptChest>,
    pub plan: Option<PerceptPlan>,
}

#[derive(Clone, Debug)]
pub(crate) struct MemoryPercept {
    pub now: f64,
    pub view_t: f64,
    pub self_: PerceptSelf,
    pub hud_in_coliseum: bool,
    pub fighters: Vec<PerceptFighter>,
    pub mobs: Vec<PerceptMob>,
    pub containers: Vec<PerceptContainer>,
    pub projectiles: Vec<PerceptProjectile>,
    pub minimap: PerceptMinimap,
    pub events: Vec<PerceptEventRow>,
    pub extras: PerceptExtras,
    pub features: Features,
}

#[cfg(test)]
mod reader;
#[cfg(test)]
pub(crate) use reader::{read_features, read_game_map, read_npc_declared_map, read_percept};
