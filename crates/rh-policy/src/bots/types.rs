//! The legacy bot brain's contract subset (docs/BOTS.md 2-5; packages/server/src/bots/brain/types.ts): the tier
//! and persona tables, the view constants, the intent/stimulus/command shapes the humanizer times, and the fair percept
//! a human sees. Data only, no server types and no clock.
//!
//! Everything here is plain doubled data: the same tables the legacy brain reads, so the pinned-container corpus
//! (parity/policy/bot-core.json) can compare them value for value and a drift is a test failure, not a judgement call.
use rh_sim::Vec2;

/// The brain's clock: the percept's server time in milliseconds. The only time a policy sees.
pub type ServerMs = f64;
/// A fighter's key in the percept (a player id or an NPC id, as rendered for this brain).
pub type FighterId = String;

/// 900 projected px top to bottom every human sees (client view/viewport.ts REF_VIEW_H, pinned by the source test).
pub const BOT_VIEW_REF_H: f64 = 900.;
/// The window a bot is assumed to have: 16:9.
pub const BOT_VIEW_ASPECT: f64 = 16. / 9.;
/// The client's projection squash (shared/constants.ts Y_SCALE).
pub const Y_SCALE: f64 = 0.8;
/// Half the visible world horizontally: 800 world units each way.
pub const BOT_VIEW_HALF_W: f64 = (BOT_VIEW_REF_H * BOT_VIEW_ASPECT) / 2.;
/// Half the visible world vertically: 562.5 world units up and down.
pub const BOT_VIEW_HALF_H: f64 = BOT_VIEW_REF_H / Y_SCALE / 2.;
/// Other fighters' hp and barrier as read off a bar: steps of this share.
pub const HP_QUANT: f64 = 0.05;
/// Minimap dots: positions rounded to this (u), refreshed this often (the minimap repaints at 10 Hz).
pub const MINIMAP_QUANT: f64 = 16.;
pub const MINIMAP_REFRESH_MS: f64 = 100.;
/// The client's lock snap radius (shared/constants.ts TARGET_SNAP_RADIUS).
pub const TARGET_SNAP_RADIUS: f64 = 64.;
/// The declared client world size (shared/constants.ts WORLD_W/H = MAP_TILES_W/H x TILE): the bounds a hand's clicks are
/// clamped to, which the source uses instead of the loaded map's own dimensions.
pub const WORLD_W: f64 = 160. * 32.;
pub const WORLD_H: f64 = 160. * 32.;

/// PRIORITY (types.ts): reflex beats combat beats goal beats chore.
pub const PRIORITY_REFLEX: u8 = 0;
pub const PRIORITY_COMBAT: u8 = 1;
pub const PRIORITY_GOAL: u8 = 2;
pub const PRIORITY_CHORE: u8 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum TierId {
    Easy,
    Normal,
    Hard,
}
impl TierId {
    pub const ALL: [TierId; 3] = [TierId::Easy, TierId::Normal, TierId::Hard];
    pub fn as_str(self) -> &'static str {
        match self {
            TierId::Easy => "easy",
            TierId::Normal => "normal",
            TierId::Hard => "hard",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|t| t.as_str() == s)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum PersonaId {
    Farmer,
    Hunter,
    Opportunist,
    Cautious,
}
impl PersonaId {
    pub const ALL: [PersonaId; 4] = [
        PersonaId::Farmer,
        PersonaId::Hunter,
        PersonaId::Opportunist,
        PersonaId::Cautious,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            PersonaId::Farmer => "farmer",
            PersonaId::Hunter => "hunter",
            PersonaId::Opportunist => "opportunist",
            PersonaId::Cautious => "cautious",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.as_str() == s)
    }
}

/// An ex-Gaussian delay (ms): N(mu, sigma) + Exp(tau), mean mu + tau.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ExGaussian {
    pub mu: f64,
    pub sigma: f64,
    pub tau: f64,
    pub floor: f64,
    pub cap: f64,
}
impl ExGaussian {
    /// The mean before floor and cap: what the tier tables quote.
    pub fn mean(&self) -> f64 {
        self.mu + self.tau
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cadence {
    pub mean: f64,
    pub jitter: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MoveScatter {
    pub base: f64,
    pub per_unit: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TargetScatter {
    pub sigma: f64,
    pub lag_s: f64,
    pub slip_p: f64,
    pub slip_mult: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hesitation {
    pub p: f64,
    pub min_ms: f64,
    pub max_ms: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Orbwalk {
    pub p: f64,
    pub step_u: f64,
    pub angle_jitter: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Route {
    pub horizon: u32,
    pub walk_paths: bool,
    pub reach: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Attention {
    pub central: f64,
    pub periphery_mult: f64,
    pub engaged_mult: f64,
    pub reconsider_ms: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Appraisal {
    pub bias: f64,
    pub lead: f64,
    pub busy: f64,
    pub hue: f64,
    pub noise: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Caution {
    pub mob_share: f64,
    pub elite_share: f64,
    pub start_hp: f64,
}

/// TierParams (types.ts 2.2): execution. Perception, timing, accuracy, knowledge and route quality.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TierParams {
    pub id: TierId,
    pub reaction: ExGaussian,
    pub step: ExGaussian,
    pub daze: ExGaussian,
    pub refractory_ms: f64,
    pub think_ms: Cadence,
    pub strategy_ms: Cadence,
    pub apm: f64,
    pub burst: f64,
    pub min_gap_ms: f64,
    pub move_scatter: MoveScatter,
    pub target_scatter: TargetScatter,
    pub minimap_sigma: f64,
    pub edge_click_p: f64,
    pub timing_sigma_ms: f64,
    pub hesitation: Hesitation,
    pub softmax_t: f64,
    pub lapse_p: f64,
    pub dodge_p: f64,
    pub juke_p: f64,
    pub orbwalk: Orbwalk,
    pub knowledge: f64,
    pub mob_share_noise: f64,
    pub route: Route,
    pub attention: Attention,
    pub memory_span_ms: f64,
    pub feint_read: f64,
    pub appraisal: Appraisal,
    pub wary: f64,
    pub caution: Caution,
}

/// TIERS (types.ts): exactly the legacy design numbers.
pub const TIERS: [TierParams; 3] = [
    TierParams {
        id: TierId::Easy,
        reaction: ExGaussian {
            mu: 330.,
            sigma: 60.,
            tau: 120.,
            floor: 230.,
            cap: 1400.,
        },
        step: ExGaussian {
            mu: 150.,
            sigma: 40.,
            tau: 50.,
            floor: 90.,
            cap: 700.,
        },
        daze: ExGaussian {
            mu: 700.,
            sigma: 150.,
            tau: 300.,
            floor: 400.,
            cap: 2500.,
        },
        refractory_ms: 180.,
        think_ms: Cadence {
            mean: 300.,
            jitter: 100.,
        },
        strategy_ms: Cadence {
            mean: 2000.,
            jitter: 600.,
        },
        apm: 60.,
        burst: 3.,
        min_gap_ms: 160.,
        move_scatter: MoveScatter {
            base: 14.,
            per_unit: 0.04,
        },
        target_scatter: TargetScatter {
            sigma: 26.,
            lag_s: 0.09,
            slip_p: 0.04,
            slip_mult: 3.,
        },
        minimap_sigma: 40.,
        edge_click_p: 0.7,
        timing_sigma_ms: 160.,
        hesitation: Hesitation {
            p: 0.12,
            min_ms: 400.,
            max_ms: 1200.,
        },
        softmax_t: 0.25,
        lapse_p: 0.08,
        dodge_p: 0.15,
        juke_p: 0.,
        orbwalk: Orbwalk {
            p: 0.,
            step_u: 120.,
            angle_jitter: 0.6,
        },
        knowledge: 0.4,
        mob_share_noise: 0.15,
        route: Route {
            horizon: 3,
            walk_paths: false,
            reach: 500.,
        },
        attention: Attention {
            central: 0.6,
            periphery_mult: 1.4,
            engaged_mult: 1.6,
            reconsider_ms: 2500.,
        },
        memory_span_ms: 25_000.,
        feint_read: 0.,
        appraisal: Appraisal {
            bias: 0.3,
            lead: 2.,
            busy: 0.3,
            hue: 1.1,
            noise: 0.9,
        },
        wary: 0.,
        caution: Caution {
            mob_share: 0.3,
            elite_share: 0.3,
            start_hp: 0.3,
        },
    },
    TierParams {
        id: TierId::Normal,
        reaction: ExGaussian {
            mu: 210.,
            sigma: 40.,
            tau: 70.,
            floor: 170.,
            cap: 900.,
        },
        step: ExGaussian {
            mu: 100.,
            sigma: 25.,
            tau: 30.,
            floor: 70.,
            cap: 500.,
        },
        daze: ExGaussian {
            mu: 500.,
            sigma: 100.,
            tau: 200.,
            floor: 300.,
            cap: 1800.,
        },
        refractory_ms: 140.,
        think_ms: Cadence {
            mean: 200.,
            jitter: 60.,
        },
        strategy_ms: Cadence {
            mean: 1500.,
            jitter: 400.,
        },
        apm: 110.,
        burst: 4.,
        min_gap_ms: 110.,
        move_scatter: MoveScatter {
            base: 9.,
            per_unit: 0.025,
        },
        target_scatter: TargetScatter {
            sigma: 18.,
            lag_s: 0.06,
            slip_p: 0.02,
            slip_mult: 3.,
        },
        minimap_sigma: 28.,
        edge_click_p: 0.5,
        timing_sigma_ms: 100.,
        hesitation: Hesitation {
            p: 0.07,
            min_ms: 250.,
            max_ms: 800.,
        },
        softmax_t: 0.12,
        lapse_p: 0.04,
        dodge_p: 0.4,
        juke_p: 0.2,
        orbwalk: Orbwalk {
            p: 0.5,
            step_u: 140.,
            angle_jitter: 0.4,
        },
        knowledge: 0.7,
        mob_share_noise: 0.08,
        route: Route {
            horizon: 6,
            walk_paths: true,
            reach: 700.,
        },
        attention: Attention {
            central: 0.65,
            periphery_mult: 1.3,
            engaged_mult: 1.4,
            reconsider_ms: 2000.,
        },
        memory_span_ms: 35_000.,
        feint_read: 0.1,
        appraisal: Appraisal {
            bias: 0.3,
            lead: 3.4,
            busy: 0.5,
            hue: 0.6,
            noise: 0.45,
        },
        wary: 300.,
        caution: Caution {
            mob_share: 0.6,
            elite_share: 0.8,
            start_hp: 0.6,
        },
    },
    TierParams {
        id: TierId::Hard,
        reaction: ExGaussian {
            mu: 160.,
            sigma: 25.,
            tau: 40.,
            floor: 140.,
            cap: 700.,
        },
        step: ExGaussian {
            mu: 70.,
            sigma: 15.,
            tau: 20.,
            floor: 55.,
            cap: 400.,
        },
        daze: ExGaussian {
            mu: 350.,
            sigma: 80.,
            tau: 150.,
            floor: 220.,
            cap: 1400.,
        },
        refractory_ms: 120.,
        think_ms: Cadence {
            mean: 150.,
            jitter: 40.,
        },
        strategy_ms: Cadence {
            mean: 1200.,
            jitter: 300.,
        },
        apm: 170.,
        burst: 5.,
        min_gap_ms: 80.,
        move_scatter: MoveScatter {
            base: 6.,
            per_unit: 0.015,
        },
        target_scatter: TargetScatter {
            sigma: 12.,
            lag_s: 0.035,
            slip_p: 0.01,
            slip_mult: 3.,
        },
        minimap_sigma: 20.,
        edge_click_p: 0.3,
        timing_sigma_ms: 60.,
        hesitation: Hesitation {
            p: 0.04,
            min_ms: 150.,
            max_ms: 500.,
        },
        softmax_t: 0.06,
        lapse_p: 0.02,
        dodge_p: 0.65,
        juke_p: 0.45,
        orbwalk: Orbwalk {
            p: 0.85,
            step_u: 160.,
            angle_jitter: 0.26,
        },
        knowledge: 0.95,
        mob_share_noise: 0.03,
        route: Route {
            horizon: 10,
            walk_paths: true,
            reach: 900.,
        },
        attention: Attention {
            central: 0.7,
            periphery_mult: 1.25,
            engaged_mult: 1.3,
            reconsider_ms: 1500.,
        },
        memory_span_ms: 45_000.,
        feint_read: 0.2,
        appraisal: Appraisal {
            bias: -0.3,
            lead: 4.5,
            busy: 0.7,
            hue: 0.25,
            noise: 0.15,
        },
        wary: 450.,
        caution: Caution {
            mob_share: 0.7,
            elite_share: 1.1,
            start_hp: 0.7,
        },
    },
];

impl TierParams {
    pub fn by_id(id: TierId) -> &'static Self {
        &TIERS[match id {
            TierId::Easy => 0,
            TierId::Normal => 1,
            TierId::Hard => 2,
        }]
    }
}

/// PersonaParams (types.ts 5): preference. The weights and thresholds, never multiplied with the tier.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PersonaParams {
    pub id: PersonaId,
    pub pve: f64,
    pub pvp: f64,
    pub loot: f64,
    pub bounty: f64,
    pub third_party: f64,
    pub engage_edge: f64,
    pub bounty_caution: f64,
    pub flee_hp: f64,
    pub reengage_hp: f64,
    pub kite: f64,
    pub chase_give_up_ms: f64,
    pub mob_kill_goal: f64,
    pub player_threat: f64,
    pub elite_appetite: f64,
    pub coliseum: f64,
    pub risk: f64,
}

/// PERSONAS (types.ts): exactly the legacy design numbers.
pub const PERSONAS: [PersonaParams; 4] = [
    PersonaParams {
        id: PersonaId::Farmer,
        pve: 1.,
        pvp: 0.15,
        loot: 0.7,
        bounty: 0.1,
        third_party: 0.2,
        engage_edge: 2.6,
        bounty_caution: 0.5,
        flee_hp: 0.4,
        reengage_hp: 0.75,
        kite: 0.4,
        chase_give_up_ms: 4000.,
        mob_kill_goal: 999.,
        player_threat: 140.,
        elite_appetite: 0.8,
        coliseum: 0.3,
        risk: 0.3,
    },
    PersonaParams {
        id: PersonaId::Hunter,
        pve: 0.5,
        pvp: 1.,
        loot: 0.3,
        bounty: 1.,
        third_party: 0.5,
        engage_edge: 0.6,
        bounty_caution: 0.,
        flee_hp: 0.2,
        reengage_hp: 0.5,
        kite: 0.2,
        chase_give_up_ms: 9000.,
        mob_kill_goal: 40.,
        player_threat: 300.,
        elite_appetite: 0.3,
        coliseum: 1.,
        risk: 0.85,
    },
    PersonaParams {
        id: PersonaId::Opportunist,
        pve: 0.85,
        pvp: 0.4,
        loot: 1.,
        bounty: 0.6,
        third_party: 1.,
        engage_edge: 1.9,
        bounty_caution: 0.3,
        flee_hp: 0.35,
        reengage_hp: 0.7,
        kite: 0.5,
        chase_give_up_ms: 5000.,
        mob_kill_goal: 999.,
        player_threat: 200.,
        elite_appetite: 0.5,
        coliseum: 0.5,
        risk: 0.6,
    },
    PersonaParams {
        id: PersonaId::Cautious,
        pve: 0.7,
        pvp: 0.2,
        loot: 0.5,
        bounty: 0.1,
        third_party: 0.4,
        engage_edge: 2.8,
        bounty_caution: 0.6,
        flee_hp: 0.55,
        reengage_hp: 0.9,
        kite: 1.,
        chase_give_up_ms: 3000.,
        mob_kill_goal: 999.,
        player_threat: 160.,
        elite_appetite: 0.4,
        coliseum: 0.2,
        risk: 0.15,
    },
];

impl PersonaParams {
    pub fn by_id(id: PersonaId) -> &'static Self {
        &PERSONAS[match id {
            PersonaId::Farmer => 0,
            PersonaId::Hunter => 1,
            PersonaId::Opportunist => 2,
            PersonaId::Cautious => 3,
        }]
    }
}

/// The humanizer's numeric rules (humanizer.ts HUMANIZER_RULES, docs/BOTS.md 2.5/4).
pub const HUMANIZER_RULES: HumanizerRules = HumanizerRules {
    replace_after_ms: 500.,
    starve_ms: 1500.,
    lock_resend_ms: 300.,
    repeat_ms: 1500.,
    same_point_u: 6.,
    reading_mult: 1.5,
    reaction_samples: 256,
    apm_window_ms: 60_000.,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HumanizerRules {
    pub replace_after_ms: f64,
    pub starve_ms: f64,
    pub lock_resend_ms: f64,
    pub repeat_ms: f64,
    pub same_point_u: f64,
    pub reading_mult: f64,
    pub reaction_samples: usize,
    pub apm_window_ms: f64,
}

/// The humanizer's channels (types.ts IntentChannel).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum IntentChannel {
    Order,
    Swap,
    Pickup,
    Cast,
    Menu,
}
pub const CHANNEL_ORDER: [IntentChannel; 5] = [
    IntentChannel::Order,
    IntentChannel::Swap,
    IntentChannel::Pickup,
    IntentChannel::Cast,
    IntentChannel::Menu,
];

/// The command type an intent turns into (types.ts CommandType, the humanizer's stats key).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum CommandType {
    Move,
    Stop,
    Target,
    Attack,
    Release,
    Swap,
    Pickup,
    Cast,
    Plan,
    Choose,
}
pub const COMMAND_TYPES: [CommandType; 10] = [
    CommandType::Move,
    CommandType::Stop,
    CommandType::Target,
    CommandType::Attack,
    CommandType::Release,
    CommandType::Swap,
    CommandType::Pickup,
    CommandType::Cast,
    CommandType::Plan,
    CommandType::Choose,
];
impl CommandType {
    pub fn as_str(self) -> &'static str {
        match self {
            CommandType::Move => "move",
            CommandType::Stop => "stop",
            CommandType::Target => "target",
            CommandType::Attack => "attack",
            CommandType::Release => "release",
            CommandType::Swap => "swap",
            CommandType::Pickup => "pickup",
            CommandType::Cast => "cast",
            CommandType::Plan => "plan",
            CommandType::Choose => "choose",
        }
    }
}

/// A weapon as the legacy brain spells it (shared/weapons.ts WEAPON_IDS).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BotWeapon {
    Sword,
    Bow,
    Wand,
    Shield,
    Axe,
    Fists,
}
impl BotWeapon {
    pub fn as_str(self) -> &'static str {
        match self {
            BotWeapon::Sword => "sword",
            BotWeapon::Bow => "bow",
            BotWeapon::Wand => "wand",
            BotWeapon::Shield => "shield",
            BotWeapon::Axe => "axe",
            BotWeapon::Fists => "fists",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        [
            BotWeapon::Sword,
            BotWeapon::Bow,
            BotWeapon::Wand,
            BotWeapon::Shield,
            BotWeapon::Axe,
            BotWeapon::Fists,
        ]
        .into_iter()
        .find(|w| w.as_str() == s)
    }
}

/// Something new in the percept that a human would react to (types.ts StimulusKind).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum StimulusKind {
    NewThreat,
    FoeSwapped,
    Incoming,
    WindupAtMe,
    DrawAtMe,
    HpLoss,
    LowHp,
    LockLost,
    TargetDown,
    OrderFailed,
    ClickMissed,
    Arrived,
    Teleport,
    Announcement,
    CastSeen,
    ChestUp,
    PlanOffer,
}
impl StimulusKind {
    pub const ALL: [StimulusKind; 17] = [
        StimulusKind::NewThreat,
        StimulusKind::FoeSwapped,
        StimulusKind::Incoming,
        StimulusKind::WindupAtMe,
        StimulusKind::DrawAtMe,
        StimulusKind::HpLoss,
        StimulusKind::LowHp,
        StimulusKind::LockLost,
        StimulusKind::TargetDown,
        StimulusKind::OrderFailed,
        StimulusKind::ClickMissed,
        StimulusKind::Arrived,
        StimulusKind::Teleport,
        StimulusKind::Announcement,
        StimulusKind::CastSeen,
        StimulusKind::ChestUp,
        StimulusKind::PlanOffer,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            StimulusKind::NewThreat => "newThreat",
            StimulusKind::FoeSwapped => "foeSwapped",
            StimulusKind::Incoming => "incoming",
            StimulusKind::WindupAtMe => "windupAtMe",
            StimulusKind::DrawAtMe => "drawAtMe",
            StimulusKind::HpLoss => "hpLoss",
            StimulusKind::LowHp => "lowHp",
            StimulusKind::LockLost => "lockLost",
            StimulusKind::TargetDown => "targetDown",
            StimulusKind::OrderFailed => "orderFailed",
            StimulusKind::ClickMissed => "clickMissed",
            StimulusKind::Arrived => "arrived",
            StimulusKind::Teleport => "teleport",
            StimulusKind::Announcement => "announcement",
            StimulusKind::CastSeen => "castSeen",
            StimulusKind::ChestUp => "chestUp",
            StimulusKind::PlanOffer => "planOffer",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s)
    }
    pub fn is_reading(self) -> bool {
        matches!(
            self,
            StimulusKind::Announcement | StimulusKind::ChestUp | StimulusKind::PlanOffer
        )
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Stimulus {
    pub kind: StimulusKind,
    pub at: ServerMs,
    pub subject: Option<String>,
    pub central: bool,
    pub value: Option<f64>,
}

/// How the humanizer times an intent (types.ts IntentTiming).
#[derive(Clone, Debug, PartialEq)]
pub enum IntentTiming {
    React { stimulus: Stimulus },
    Step {},
    Timed { due: ServerMs },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum IntentKind {
    Lock,
    Move,
    Stop,
    Swap,
    Pickup,
    Cast,
    Plan,
    Choose,
}
impl IntentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            IntentKind::Lock => "lock",
            IntentKind::Move => "move",
            IntentKind::Stop => "stop",
            IntentKind::Swap => "swap",
            IntentKind::Pickup => "pickup",
            IntentKind::Cast => "cast",
            IntentKind::Plan => "plan",
            IntentKind::Choose => "choose",
        }
    }
    pub fn channel(self) -> IntentChannel {
        match self {
            IntentKind::Lock | IntentKind::Move | IntentKind::Stop => IntentChannel::Order,
            IntentKind::Swap => IntentChannel::Swap,
            IntentKind::Pickup => IntentChannel::Pickup,
            IntentKind::Cast => IntentChannel::Cast,
            IntentKind::Plan | IntentKind::Choose => IntentChannel::Menu,
        }
    }
    pub fn command_type(self) -> CommandType {
        match self {
            IntentKind::Lock => CommandType::Target,
            IntentKind::Move => CommandType::Move,
            IntentKind::Stop => CommandType::Stop,
            IntentKind::Swap => CommandType::Swap,
            IntentKind::Pickup => CommandType::Pickup,
            IntentKind::Cast => CommandType::Cast,
            IntentKind::Plan => CommandType::Plan,
            IntentKind::Choose => CommandType::Choose,
        }
    }
}

/// IntentBody (types.ts) with its kind tag, flattened into Intent like the source object.
#[derive(Clone, Debug, PartialEq)]
pub enum IntentBody {
    Lock {
        target: FighterId,
        at: Vec2,
    },
    Move {
        to: Vec2,
    },
    Stop {},
    Swap {
        slot: u8,
    },
    Pickup {
        container: String,
    },
    Cast {
        slot: String,
        x: f64,
        y: f64,
        target: Option<FighterId>,
        at: Option<Vec2>,
        snap_radius: Option<f64>,
    },
    Plan {
        msg: PlanMsg,
    },
    Choose {
        msg: ChooseMsg,
    },
}
impl IntentBody {
    pub fn kind(&self) -> IntentKind {
        match self {
            IntentBody::Lock { .. } => IntentKind::Lock,
            IntentBody::Move { .. } => IntentKind::Move,
            IntentBody::Stop {} => IntentKind::Stop,
            IntentBody::Swap { .. } => IntentKind::Swap,
            IntentBody::Pickup { .. } => IntentKind::Pickup,
            IntentBody::Cast { .. } => IntentKind::Cast,
            IntentBody::Plan { .. } => IntentKind::Plan,
            IntentBody::Choose { .. } => IntentKind::Choose,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct PlanMsg {
    pub spawn: Option<u8>,
    pub boon: Option<u8>,
    pub ready: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct ChooseMsg {
    pub chest: String,
    pub pick: i8,
    pub replace: Option<u8>,
}

/// One thing a tactics layer asks the hand to do, with how it is timed (types.ts Intent).
#[derive(Clone, Debug, PartialEq)]
pub struct Intent {
    pub body: IntentBody,
    pub priority: u8,
    pub timing: IntentTiming,
    pub why: String,
}
impl Intent {
    pub fn kind(&self) -> IntentKind {
        self.body.kind()
    }
}

/// The messages the humanizer emits (types.ts Command).
#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    Move {
        x: f64,
        y: f64,
    },
    Stop {},
    Target {
        id: FighterId,
    },
    Attack {
        a: f64,
    },
    Release {
        a: f64,
    },
    Swap {
        slot: u8,
    },
    Pickup {
        container_id: String,
    },
    Cast {
        slot: String,
        x: f64,
        y: f64,
        id: Option<FighterId>,
    },
    Plan {
        spawn: Option<u8>,
        boon: Option<u8>,
        ready: Option<bool>,
    },
    Choose {
        chest: String,
        pick: i8,
        replace: Option<u8>,
    },
}
impl Command {
    pub fn command_type(&self) -> CommandType {
        match self {
            Command::Move { .. } => CommandType::Move,
            Command::Stop {} => CommandType::Stop,
            Command::Target { .. } => CommandType::Target,
            Command::Attack { .. } => CommandType::Attack,
            Command::Release { .. } => CommandType::Release,
            Command::Swap { .. } => CommandType::Swap,
            Command::Pickup { .. } => CommandType::Pickup,
            Command::Cast { .. } => CommandType::Cast,
            Command::Plan { .. } => CommandType::Plan,
            Command::Choose { .. } => CommandType::Choose,
        }
    }
}

/// A command at the click time it would have been sent (types.ts TimedCommand).
#[derive(Clone, Debug, PartialEq)]
pub struct TimedCommand {
    pub at: ServerMs,
    pub cmd: Command,
    pub intent: IntentKind,
    pub priority: u8,
    pub stimulus: Option<Stimulus>,
}

/// What a lock click is aimed at: the fighter's key and where it was drawn (its percept position).
#[derive(Clone, Debug, PartialEq)]
pub struct LockTarget {
    pub id: FighterId,
    pub at: Vec2,
}

/// A lock click that picked nobody: nothing was sent, and the brain will notice no ring appeared.
#[derive(Clone, Debug, PartialEq)]
pub struct ClickMiss {
    pub target: FighterId,
    pub at: ServerMs,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct SelfView {
    pub id: FighterId,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub status: String,
    pub hp: f64,
    pub max_hp: f64,
    pub weapons: [Option<BotWeapon>; 2],
    pub slot: u8,
    pub attack_target: Option<FighterId>,
    pub ready_at: ServerMs,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct HudView {
    pub phase: String,
    pub gates_locked: bool,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct FighterView {
    pub id: FighterId,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub status: String,
    pub targetable: bool,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct MobView {
    pub id: FighterId,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub status: String,
    pub kind: String,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct ContainerView {
    pub id: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub interactable: bool,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct RewardChestView {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub expires_at: f64,
    pub options: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct PerceptExtras {
    pub chests: Option<Vec<RewardChestView>>,
}

/// Everything the hand may know about the present (Percept, narrowed to what it reads). Plain data: no state handle,
/// no hidden field.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Percept {
    pub now: ServerMs,
    pub self_view: SelfView,
    pub hud: HudView,
    pub fighters: Vec<FighterView>,
    pub mobs: Vec<MobView>,
    pub containers: Vec<ContainerView>,
    pub extras: PerceptExtras,
}
impl Percept {
    pub fn weapon_in_hand(&self) -> BotWeapon {
        self.self_view.weapons[usize::from(self.self_view.slot.min(1))].unwrap_or(BotWeapon::Fists)
    }
}
