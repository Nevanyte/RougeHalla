//! Lazy player card memory. Casts keep one spend record here; hooks extend the same owner.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Runtime {
    pub wish_cast: Option<WishSpend>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<Memory>,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WishSpend {
    pub at: f64,
    pub cooldown_ms: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Memory {
    pub crit_acc: f64,
    pub crit_acc_dot: f64,
    pub dot_roll_tick: i32,
    pub dot_crit: bool,
    pub streak: Option<Streak>,
    pub still_x: f64,
    pub still_y: f64,
    pub still_known: bool,
    pub still_since: f64,
    pub prevented: f64,
    pub tank_hp: f64,
    pub boost_until: f64,
    pub boost_as: f64,
    pub boost_move: f64,
    pub trims: [Trim; 16],
    pub trim_len: u8,
    pub fired_once: bool,
}
impl Default for Memory {
    fn default() -> Self {
        Self {
            crit_acc: 0.,
            crit_acc_dot: 0.,
            dot_roll_tick: -1,
            dot_crit: false,
            streak: None,
            still_x: 0.,
            still_y: 0.,
            still_known: false,
            still_since: 0.,
            prevented: 0.,
            tank_hp: 0.,
            boost_until: 0.,
            boost_as: 1.,
            boost_move: 1.,
            trims: [Trim { at: 0., ms: 0. }; 16],
            trim_len: 0,
            fired_once: false,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Streak {
    pub target: crate::PlayerId,
    pub count: u32,
    pub last: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trim {
    pub at: f64,
    pub ms: f64,
}
pub(crate) fn memory_mut(p: &mut crate::state::Player) -> &mut Memory {
    p.card_runtime
        .get_or_insert_with(Runtime::default)
        .memory
        .get_or_insert_with(Memory::default)
}
pub(crate) fn reset_all(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    if *args == crate::hooks::HookArgs::RaidStarted {
        for p in &mut hx.w.players {
            p.card_runtime = None;
        }
    }
}
