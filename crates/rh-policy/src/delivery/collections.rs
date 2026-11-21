//! Reliable collection replacements built only from the already-filtered observation.
use rh_protocol::state::{
    WireBuildSummary, WireCampReward, WireMobBonusRow, WirePanelValue, WireWard, HUD_QUANTUM,
    MAX_SUMMARY_MOB_ROWS,
};
use rh_protocol::{
    EncodeError, PickupHandle, RewardChestHandle, ServerMsg, StateItem, WireArena, WireBuild,
    WireCamp, WireField, WireFocus, WireInventory, WirePlan, WirePlanOption, WireProjectile,
    WireProp, WirePropKind, WireProps, WireRewardChest, WireRewardId, WireRewardOption,
};
use rh_sim::observe::{HudStat, WardVerdict};
use rh_sim::{Inventory, Observation, PropKind};

#[cfg(test)]
#[path = "trade_tests.rs"]
mod trade_tests;

#[derive(Default)]
pub struct CollectionPublisher {
    sent: bool,
    inventory: Option<WireInventory>,
    props: Option<WireProps>,
    fields: Vec<WireField>,
    build: Option<WireBuild>,
    camps: Vec<WireCamp>,
    projectiles: Vec<WireProjectile>,
    plan: Option<WirePlan>,
    arena: Option<WireArena>,
    quests: Option<rh_protocol::WireQuestView>,
    trade: Option<rh_protocol::WireTradeView>,
    roster: Vec<rh_protocol::WireRosterRow>,
    summary: Option<WireBuildSummary>,
    /// P-WIRE19-B: the readout rows the client holds (empty from every Welcome).
    readouts: Vec<rh_protocol::WireReadout>,
    /// P-AUG-NATIVE-5: the quantized Marked Man rows the client holds (empty from every Welcome).
    marked: Vec<rh_protocol::WireMarked>,
    last_forced: Option<u32>,
    /// P-TICK-3-fix: the connection's ms per tick ([`CollectionPublisher::set_tick_ms`]), `None` for 50.
    tick_ms: Option<u32>,
}

pub struct PendingState {
    pub frame: Option<Vec<u8>>,
    items: Vec<StateItem>,
    tick: u32,
    forced: bool,
}

fn inventory(value: Inventory) -> WireInventory {
    WireInventory {
        active_slot: value.active_slot,
        slots: value.slots.map(|v| v.map(|w| w.code())),
        potion_small: value.potion_small,
        potion_large: value.potion_large,
        potions_healing: value.potions_healing,
        // Server ms, unchanged; a non-finite or negative clock is refused by the encoder, never clamped.
        healing_until: value.healing_until,
        speed_boost_until: value.speed_boost_until,
    }
}

/// P-AUG-NATIVE-5: the public Marked Man rows as State key 15 rows, each position as the client will decode it (the
/// actor quantization), so a sub-quantum move compares equal and is not resent. A position the wire cannot carry is
/// passed through unquantized, so the encoder refuses it (never clamped).
fn marked(observation: &Observation) -> Vec<rh_protocol::WireMarked> {
    use rh_protocol::quant::{dequantize_pos, pos_in_range, quantize_pos};
    let on_wire = |v: f64| {
        let v = v as f32;
        if pos_in_range(v) {
            dequantize_pos(quantize_pos(v))
        } else {
            v
        }
    };
    observation
        .marked
        .iter()
        .map(|row| rh_protocol::WireMarked {
            id: row.id.0,
            x: on_wire(row.x),
            y: on_wire(row.y),
        })
        .collect()
}

/// P-WIRE19-B: the viewer's own readout rows as State key 14 rows, value and max unchanged (the encoder refuses an
/// invalid row, never clamps it).
fn readouts(observation: &Observation) -> Vec<rh_protocol::WireReadout> {
    use rh_sim::cards::native::ReadoutKind;
    observation
        .readouts
        .iter()
        .map(|row| rh_protocol::WireReadout {
            card: u8::try_from(row.card.index()).expect("a card index fits u8"),
            kind: match row.kind {
                ReadoutKind::Counter => rh_protocol::state::READOUT_KIND_COUNTER,
                ReadoutKind::Meter => rh_protocol::state::READOUT_KIND_METER,
                ReadoutKind::Marks => rh_protocol::state::READOUT_KIND_MARKS,
            },
            value: row.value,
            max: row.max,
        })
        .collect()
}

fn props(observation: &Observation) -> Result<WireProps, EncodeError> {
    let mut focus = None;
    let rows = observation
        .props
        .iter()
        .map(|row| {
            let handle = PickupHandle::new(row.handle.get()).expect("core nonzero handle");
            if row.cue.focused {
                focus = Some(WireFocus {
                    handle,
                    body_hint: row.cue.body_hint.map(|w| w.code()),
                });
            }
            Ok(WireProp {
                handle,
                x: row.cue.x,
                y: row.cue.y,
                kind: match &row.cue.kind {
                    PropKind::Ground(weapon) => WirePropKind::Ground(weapon.code()),
                    PropKind::Chest { open } => WirePropKind::Chest { open: *open },
                    PropKind::Body { label } => WirePropKind::Body {
                        label: label.to_string(),
                    },
                    PropKind::Cannon { ready_at } => WirePropKind::Cannon {
                        ready_at: *ready_at,
                    },
                    PropKind::Corpse { label } => WirePropKind::Corpse {
                        label: label.to_string(),
                    },
                    PropKind::WindEmblem => WirePropKind::WindEmblem,
                    PropKind::QuestItem { quest, fetch } => WirePropKind::QuestItem {
                        quest: rh_protocol::QuestHandle::new(quest.get())
                            .expect("native quest handle"),
                        fetch: *fetch,
                    },
                    PropKind::Heal { ready_at } => WirePropKind::Heal {
                        ready_at: *ready_at,
                    },
                },
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(WireProps { rows, focus })
}

/// Copies only the admitted observer view. No world quest/container/player IDs are read here.
fn quests(observation: &Observation) -> Result<Option<rh_protocol::WireQuestView>, EncodeError> {
    use rh_protocol::{
        QuestHandle, RosterId, WireQuestObjective, WireQuestParticipant, WireQuestPoint,
        WireQuestRow, WireQuestView, WireRosterEntry,
    };
    let Some(source) = observation.quests.as_ref() else {
        return Ok(None);
    };
    if source.rows.len() > rh_protocol::state::MAX_QUEST_ROWS
        || source.roster.len() > rh_protocol::state::MAX_QUEST_ROSTER
        || source.objectives.len() > rh_protocol::state::MAX_QUEST_OBJECTIVES
        || source.roster.iter().any(|row| row.label.len() > 255)
        || source.rows.iter().any(|row| {
            row.participants.len() > rh_protocol::state::MAX_QUEST_PARTICIPANTS
                || [
                    &row.name,
                    &row.giver_label,
                    &row.brief,
                    &row.objective,
                    &row.reward,
                ]
                .into_iter()
                .any(|text| text.len() > 255)
                || row.done_by.as_ref().is_some_and(|text| text.len() > 255)
                || row.def.is_empty()
                || row.def.len() > 16
        })
    {
        return Err(EncodeError::BadValue("quest view"));
    }
    let roster_id =
        |id: rh_sim::quest_view::RosterId| RosterId::new(id.get()).expect("native roster id");
    let quest_id = |id: rh_sim::quest_view::QuestHandle| {
        QuestHandle::new(id.get()).expect("native quest handle")
    };
    let point = |at: rh_sim::Vec2| WireQuestPoint { x: at.x, y: at.y };
    let view = WireQuestView {
        unknown_count: source.unknown_count,
        display_unknown_count: source.display_unknown_count,
        owner_roster: source.owner_roster.map(roster_id),
        roster: source
            .roster
            .iter()
            .map(|row| WireRosterEntry {
                id: roster_id(row.id),
                label: row.label.clone(),
            })
            .collect(),
        rows: source
            .rows
            .iter()
            .map(|row| WireQuestRow {
                handle: quest_id(row.handle),
                def: row.def.clone(),
                giver: point(row.giver),
                state: match row.state {
                    rh_sim::quest_view::RowState::Preview => 0,
                    rh_sim::quest_view::RowState::Open => 1,
                    rh_sim::quest_view::RowState::Done => 2,
                    rh_sim::quest_view::RowState::Expired => 3,
                },
                expires_at: row.expires_at,
                participants: row
                    .participants
                    .iter()
                    .map(|p| WireQuestParticipant {
                        id: roster_id(p.id),
                        accepted: p.accepted,
                        progress: p.progress,
                        visited: p.visited,
                    })
                    .collect(),
                carrier: row.carrier.map(roster_id),
                // P-WIRE17-MAP-2: the carrier's public actor id, already filtered by the observation (C-OBS).
                carrier_actor: row.carrier_actor.map(|id| id.0),
                done_by: row.done_by.clone(),
                can_accept: row.can_accept,
                owner_accepted: row.owner_accepted,
                owner_progress: row.owner_progress,
                owner_visited: row.owner_visited,
                owner_completed: row.owner_completed,
                owner_ready: row.owner_ready,
                name: row.name.clone(),
                giver_label: row.giver_label.clone(),
                brief: row.brief.clone(),
                objective: row.objective.clone(),
                reward: row.reward.clone(),
            })
            .collect(),
        objectives: source
            .objectives
            .iter()
            .map(|row| WireQuestObjective {
                quest: quest_id(row.quest),
                at: point(row.at),
            })
            .collect(),
    };
    view.check()?;
    Ok(Some(view))
}

/// Saved owner facts and point-visible merchant rows. The only dynamic display labels use the
/// existing native helper and this same prepared observation's exact selected inventory slot.
fn trade(observation: &Observation) -> Result<Option<rh_protocol::WireTradeView>, EncodeError> {
    use rh_protocol::{
        WireMerchant, WireTradeDelta, WireTradeKind, WireTradeOffer, WireTradeStat, WireTradeView,
    };
    use rh_sim::traders::{Kind, Stat};
    let Some(source) = observation.trade.as_ref() else {
        return Ok(None);
    };
    let inventory = observation
        .inventory
        .as_ref()
        .filter(|inventory| inventory.active_slot <= 1)
        .ok_or(EncodeError::BadValue("trade inventory"))?;
    // Check source bounds before cloning any untrusted restored label/vector. These are public
    // projection limits, not changes to native restore or the authoritative trade action.
    if source.offers.len() > rh_protocol::state::MAX_TRADE_OFFERS
        || source.stats.len() > rh_protocol::state::MAX_TRADE_STATS
        || source.merchants.len() > rh_protocol::state::MAX_TRADE_MERCHANTS
        || source
            .offers
            .iter()
            .any(|row| !row.valid() || row.label.len() > 255)
        || source.stats.iter().any(|(_, value)| !value.is_finite())
        || source
            .barter_ready_at
            .is_some_and(|value| !value.is_finite() || value < 0.)
        || source.merchants.iter().any(|row| {
            !row.at.x.is_finite()
                || !row.at.y.is_finite()
                || !(0.0..=f64::from(rh_protocol::quant::POS_MAX)).contains(&row.at.x)
                || !(0.0..=f64::from(rh_protocol::quant::POS_MAX)).contains(&row.at.y)
        })
    {
        return Err(EncodeError::BadValue("trade view"));
    }
    let stat = |value| match value {
        Stat::MaxHp => WireTradeStat::MaxHp,
        Stat::Ad => WireTradeStat::Ad,
        Stat::Ap => WireTradeStat::Ap,
        Stat::AttackSpeed => WireTradeStat::AttackSpeed,
        Stat::MoveSpeed => WireTradeStat::MoveSpeed,
        Stat::Armor => WireTradeStat::Armor,
        Stat::Shield => WireTradeStat::Shield,
    };
    let view = WireTradeView {
        trade_used: source.trade_used,
        offers: source
            .offers
            .iter()
            .map(|row| WireTradeOffer {
                cost: stat(row.cost),
                cost_value: row.cost_value,
                gain: stat(row.gain),
                gain_value: row.gain_value,
                label: row.label.clone(),
            })
            .collect(),
        stats: source
            .stats
            .iter()
            .map(|(key, value)| WireTradeDelta {
                stat: stat(*key),
                value: *value,
            })
            .collect(),
        barter_ready_at: source.barter_ready_at,
        merchants: source
            .merchants
            .iter()
            .map(|row| WireMerchant {
                kind: match row.kind {
                    Kind::Barter => WireTradeKind::Barter,
                    Kind::Stats => WireTradeKind::Stats,
                },
                x: row.at.x,
                y: row.at.y,
                name: row.kind.name().to_owned(),
            })
            .collect(),
        barter_labels: rh_sim::traders::barter_labels(
            inventory.slots[usize::from(inventory.active_slot)],
        ),
    };
    view.check()?;
    Ok(Some(view))
}

fn optional_f64_bits_equal(a: Option<f64>, b: Option<f64>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => a.to_bits() == b.to_bits(),
        _ => false,
    }
}

/// Native PartialEq intentionally treats signed zero as equal; this delivery baseline must not.
fn trade_bits_equal(
    a: Option<&rh_protocol::WireTradeView>,
    b: Option<&rh_protocol::WireTradeView>,
) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => {
            a.trade_used == b.trade_used
                && a.barter_labels == b.barter_labels
                && optional_f64_bits_equal(a.barter_ready_at, b.barter_ready_at)
                && a.offers.len() == b.offers.len()
                && a.offers.iter().zip(&b.offers).all(|(a, b)| {
                    a.cost == b.cost
                        && a.gain == b.gain
                        && a.cost_value.to_bits() == b.cost_value.to_bits()
                        && a.gain_value.to_bits() == b.gain_value.to_bits()
                        && a.label == b.label
                })
                && a.stats.len() == b.stats.len()
                && a.stats
                    .iter()
                    .zip(&b.stats)
                    .all(|(a, b)| a.stat == b.stat && a.value.to_bits() == b.value.to_bits())
                && a.merchants.len() == b.merchants.len()
                && a.merchants.iter().zip(&b.merchants).all(|(a, b)| {
                    a.kind == b.kind
                        && a.name == b.name
                        && a.x.to_bits() == b.x.to_bits()
                        && a.y.to_bits() == b.y.to_bits()
                })
        }
        _ => false,
    }
}

fn fields(observation: &Observation) -> Vec<WireField> {
    observation
        .fields
        .iter()
        .map(|f| WireField {
            kind: f.kind as u8,
            ability: f.ability as u8,
            owner: f.owner.map(|id| id.0),
            subject: f.subject.map(|id| id.0),
            x: f.x as f32,
            y: f.y as f32,
            x2: f.x2 as f32,
            y2: f.y2 as f32,
            r: f.r as f32,
            vx: f.vx as f32,
            vy: f.vy as f32,
            started_at: f.started_at,
            ends_at: f.ends_at,
            // P-FROST-WALL-2: a wall's tiles (the sim's barrier row); empty, so no allocation, for every other kind.
            tiles: f.tiles.clone(),
        })
        .collect()
}

fn rewards(observation: &Observation) -> Result<Vec<WireRewardChest>, EncodeError> {
    observation
        .reward_chests
        .iter()
        .map(|c| {
            let x = c.at.x as f32;
            let y = c.at.y as f32;
            if !rh_protocol::quant::pos_in_range(x) || !rh_protocol::quant::pos_in_range(y) {
                return Err(EncodeError::BadValue("reward position"));
            }
            Ok(WireRewardChest {
                handle: RewardChestHandle::new(c.handle.wire())
                    .expect("core nonzero reward handle"),
                x: rh_protocol::quant::quantize_pos(x),
                y: rh_protocol::quant::quantize_pos(y),
                expires_at: c.expires_at,
                options: c
                    .options
                    .iter()
                    .map(|o| WireRewardOption {
                        id: match o.id {
                            rh_sim::reward_chests::OptionId::Card(id) => {
                                WireRewardId::Card(id.index() as u8)
                            }
                            rh_sim::reward_chests::OptionId::Boost(id) => {
                                WireRewardId::Boost(id.index() as u8)
                            }
                            rh_sim::reward_chests::OptionId::Kill(augment) => WireRewardId::Kill {
                                key: match augment.key {
                                    rh_sim::kill_augments::KillStatKey::Ad => {
                                        rh_protocol::TrophyStatKey::Ad
                                    }
                                    rh_sim::kill_augments::KillStatKey::Ap => {
                                        rh_protocol::TrophyStatKey::Ap
                                    }
                                    rh_sim::kill_augments::KillStatKey::Damage => {
                                        rh_protocol::TrophyStatKey::Damage
                                    }
                                    rh_sim::kill_augments::KillStatKey::Health => {
                                        rh_protocol::TrophyStatKey::Health
                                    }
                                    rh_sim::kill_augments::KillStatKey::AttackSpeed => {
                                        rh_protocol::TrophyStatKey::AttackSpeed
                                    }
                                    rh_sim::kill_augments::KillStatKey::Armor => {
                                        rh_protocol::TrophyStatKey::Armor
                                    }
                                    rh_sim::kill_augments::KillStatKey::Mr => {
                                        rh_protocol::TrophyStatKey::Mr
                                    }
                                    rh_sim::kill_augments::KillStatKey::Speed => {
                                        rh_protocol::TrophyStatKey::Speed
                                    }
                                    rh_sim::kill_augments::KillStatKey::Leech => {
                                        rh_protocol::TrophyStatKey::Leech
                                    }
                                },
                                gain: augment.gain,
                            },
                        },
                        taken: o.taken,
                        taken_by: o.taken_by.map(|id| id.0),
                    })
                    .collect(),
                picked: c.picked,
                can_choose: c.can_choose,
                // P-WIRE19-A: the observed window as this viewer sees it (its end and its own `mine`).
                first_pick: c.first_pick.map(|f| rh_protocol::WireFirstPick {
                    until: f.until,
                    mine: f.mine,
                }),
            })
        })
        .collect()
}

/// The HUD stat code on the wire: the [`HudStat`] variant index (P-WIRE17-HUD-1).
fn hud_code(stat: HudStat) -> u8 {
    match stat {
        HudStat::Offense => 0,
        HudStat::SoulOffense => 1,
        HudStat::Damage => 2,
        HudStat::AttackSpeed => 3,
        HudStat::LifeSteal => 4,
        HudStat::Health => 5,
        HudStat::Defense => 6,
        HudStat::SoulDefense => 7,
        HudStat::MoveSpeed => 8,
    }
}

/// `round(v / HUD_QUANTUM)` (half away from zero) when finite and inside `[min, max]`; refused otherwise, never clamped.
fn quantize(v: f64, min: f64, max: f64, what: &'static str) -> Result<f64, EncodeError> {
    let q = (v / HUD_QUANTUM).round();
    if q.is_finite() && (min..=max).contains(&q) {
        Ok(q)
    } else {
        Err(EncodeError::BadValue(what))
    }
}

fn quantize_i32(v: f64, what: &'static str) -> Result<i32, EncodeError> {
    quantize(v, f64::from(i32::MIN), f64::from(i32::MAX), what).map(|q| q as i32)
}

/// The public camp rows plus, per row, the observation's camp HUD facts (reward content and this viewer's ward
/// verdict). A row without a HUD row carries neither.
fn camps(observation: &Observation) -> Result<Vec<WireCamp>, EncodeError> {
    observation
        .camps
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let hud = observation.camp_hud.get(i).copied().unwrap_or_default();
            let reward = match hud.reward {
                Some(r) => Some(WireCampReward {
                    stat: hud_code(r.stat),
                    amount: quantize(r.amount, 1., f64::from(u16::MAX), "camp reward")? as u16,
                }),
                None => None,
            };
            let ward = match hud.ward {
                WardVerdict::None => None,
                WardVerdict::Yours | WardVerdict::Other => Some(WireWard {
                    yours: hud.ward == WardVerdict::Yours,
                    expires_at: hud.ward_expires_at,
                }),
            };
            Ok(WireCamp {
                mob_type: c.mob_type as u8,
                elite: c.elite.map(|id| id as u8),
                alive: c.alive,
                state: c.state,
                cleared_at: c.cleared_at,
                respawn_at: c.respawn_at,
                reward,
                ward,
            })
        })
        .collect()
}

/// The viewer's own GAINED strip (State key 13), quantized to [`HUD_QUANTUM`]. The observation already holds only the
/// viewer's summary (C-OBS); delivery compares this quantized value, so a sub-quantum change sends nothing.
fn summary(observation: &Observation) -> Result<Option<WireBuildSummary>, EncodeError> {
    let Some(view) = observation.summary.as_ref() else {
        return Ok(None);
    };
    if view.mob_rows.len() > MAX_SUMMARY_MOB_ROWS {
        return Err(EncodeError::TooMany {
            what: "summary mob rows",
            n: view.mob_rows.len(),
            max: MAX_SUMMARY_MOB_ROWS,
        });
    }
    let mut gains = [0; 9];
    for (q, v) in gains.iter_mut().zip(view.gains) {
        *q = quantize_i32(v, "summary gain")?;
    }
    let mob_rows = view
        .mob_rows
        .iter()
        .map(|row| {
            Ok(WireMobBonusRow {
                mob_type: row.mob as u8,
                stat: hud_code(row.stat),
                stacks: u32::try_from(row.stacks)
                    .map_err(|_| EncodeError::BadValue("summary stacks"))?,
                total: quantize_i32(row.total, "summary mob total")?,
            })
        })
        .collect::<Result<_, EncodeError>>()?;
    // P-WIRE17-HUD-2: the viewer's own champion panel, ascending by code; none observed sends an empty panel.
    let panel = observation
        .panel
        .iter()
        .flat_map(|p| p.iter())
        .map(|(code, v)| {
            Ok(WirePanelValue {
                code: code.code(),
                value: quantize_i32(v, "summary panel value")?,
            })
        })
        .collect::<Result<_, EncodeError>>()?;
    Ok(Some(WireBuildSummary {
        gains,
        mob_rows,
        panel,
    }))
}

/// Whether the client's summary (`sent`, what it holds) is stale for the observed `view`: presence, a row's mob, stat
/// or stacks changed, or any number moved at least one whole [`HUD_QUANTUM`] from the value the client holds. A
/// sub-quantum wobble (hp-dependent life steal) sends nothing even where it would round to the next step; the client's
/// value then stays within one quantum of the build.
/// P-WIRE17-HUD-2: the champion panel follows the same rule: a code added or removed, or a value moved a whole quantum.
fn summary_stale(
    sent: Option<&WireBuildSummary>,
    view: Option<&rh_sim::observe::SummaryView>,
    panel: Option<&rh_sim::build_summary::ChampionPanel>,
) -> bool {
    let (Some(sent), Some(view)) = (sent, view) else {
        return sent.is_some() != view.is_some();
    };
    let moved = |held: i32, v: f64| (v / HUD_QUANTUM - f64::from(held)).abs() >= 1.;
    let panel_len = panel.map_or(0, |p| p.iter().count());
    sent.panel.len() != panel_len
        || sent
            .panel
            .iter()
            .zip(panel.iter().flat_map(|p| p.iter()))
            .any(|(w, (code, v))| w.code != code.code() || moved(w.value, v))
        || sent.mob_rows.len() != view.mob_rows.len()
        || sent.gains.iter().zip(view.gains).any(|(q, v)| moved(*q, v))
        || sent.mob_rows.iter().zip(&view.mob_rows).any(|(w, r)| {
            w.mob_type != r.mob as u8
                || w.stat != hud_code(r.stat)
                || u64::from(w.stacks) != r.stacks
                || moved(w.total, r.total)
        })
}

fn projectiles(observation: &Observation) -> Vec<WireProjectile> {
    observation
        .projectiles
        .iter()
        .map(|p| WireProjectile {
            height: p.height,
            kind: match p.kind {
                rh_sim::ProjectileKind::Arrow => 0,
                rh_sim::ProjectileKind::Ball => 1,
            },
            x: p.x,
            y: p.y,
            facing: p.facing,
            owner: p.owner.map(|id| id.0),
        })
        .collect()
}

/// The viewer's own source planning deal. The observation already resolved every option fact against the admitted map;
/// the wire only quantizes the two spawn positions like remote actors (never a private stream, index or path).
fn plan(observation: &Observation) -> Result<Option<WirePlan>, EncodeError> {
    let Some(view) = observation.plan.as_ref() else {
        return Ok(None);
    };
    let pick = |v: i8| (v >= 0).then_some(v as u8);
    let index = |v: i32| (v >= 0).then_some(v as u32);
    let mut options: [Option<WirePlanOption>; 2] = [None, None];
    for (slot, option) in view.options.iter().enumerate() {
        let Some(option) = option else { continue };
        let (x, y) = (option.at.x as f32, option.at.y as f32);
        if !rh_protocol::quant::pos_in_range(x) || !rh_protocol::quant::pos_in_range(y) {
            return Err(EncodeError::BadValue("plan position"));
        }
        let walk_seconds = match option.walk_seconds {
            Some(value) => {
                let value = value as f32;
                if !value.is_finite() || value < 0. {
                    return Err(EncodeError::BadValue("plan walk seconds"));
                }
                Some(value)
            }
            None => None,
        };
        options[slot] = Some(WirePlanOption {
            index: option.index,
            x: rh_protocol::quant::quantize_pos(x),
            y: rh_protocol::quant::quantize_pos(y),
            zone: option.zone.code(),
            walk_seconds,
        });
    }
    Ok(Some(WirePlan {
        ends_at: view.plan.ends_at,
        spawns: [index(view.plan.spawns[0]), index(view.plan.spawns[1])],
        taken: view.plan.taken,
        pick: pick(view.plan.pick),
        boons: view.plan.boons.clone(),
        boon: pick(view.plan.boon),
        ready: view.ready,
        options,
    }))
}

/// The public source arena lifecycle view (None for the Off profile, so the key is cleared after a lifecycle change).
fn arena(observation: &Observation) -> Option<WireArena> {
    observation.arena.as_ref().map(|a| WireArena {
        lobby_ends_at: a.lobby_ends_at,
        plan_ends_at: a.plan_ends_at,
        raid_started_at: a.raid_started_at,
        patience_ends_at: a.patience_ends_at,
        in_coliseum: a.in_coliseum,
        gates_locked: a.gates_locked,
        sudden_death_at: a.sudden_death_at,
        started_with: a.started_with,
        // Past u8 saturates to 255, which the encoder refuses (`BadValue("arena")`): never clamped or wrapped to a legal
        // minimum.
        min_players: u8::try_from(a.min_players).unwrap_or(u8::MAX),
    })
}

impl CollectionPublisher {
    /// A new connection to the same room: every baseline is dropped, the rate is kept.
    pub fn reconnect(&mut self) {
        let tick_ms = self.tick_ms;
        *self = Self::default();
        self.tick_ms = tick_ms;
    }

    /// The connection's ms per tick ([`rh_protocol::TICK_MS`] unless set).
    pub fn tick_ms(&self) -> u32 {
        self.tick_ms.unwrap_or(rh_protocol::TICK_MS)
    }

    /// Sets the connection's rate, where its Welcome is sent; another than 50 or 25 ms is refused, changing nothing.
    pub fn set_tick_ms(&mut self, tick_ms: u32) -> Result<(), EncodeError> {
        self.tick_ms = Some(rh_protocol::checked_tick_ms(tick_ms)?);
        Ok(())
    }

    /// The same throttle controls capability renewal and the matching forced replacement: one per 1000 ms at the rate.
    pub fn resync_due(&self, tick: u32, requested: bool) -> bool {
        requested
            && self.last_forced.is_none_or(|last| {
                tick.saturating_sub(last)
                    >= rh_protocol::delta::min_forced_full_ticks(self.tick_ms())
            })
    }

    /// No public counters or committed collection baselines change until enqueue succeeds.
    pub fn prepare(
        &self,
        observation: &Observation,
        props_changed: bool,
        rewards_changed: bool,
        resync_requested: bool,
    ) -> Result<PendingState, EncodeError> {
        let forced = self.resync_due(observation.tick, resync_requested);
        let full = !self.sent || forced;
        let next_inventory = observation.inventory.map(inventory);
        let next_fields = fields(observation);
        let next_camps = camps(observation)?;
        let next_summary = summary(observation)?;
        let next_projectiles = projectiles(observation);
        let next_build = observation.build.map(|v| WireBuild {
            cards: v.cards.0,
            boosts: v.boosts,
        });
        let next_plan = plan(observation)?;
        let next_arena = arena(observation);
        let next_quests = quests(observation)?;
        let next_trade = trade(observation)?;
        let next_props = if full || props_changed {
            Some(props(observation)?)
        } else {
            None
        };
        // Validate the reconstructed client candidate. Unchanged props reuse the committed
        // baseline without cloning every visible prop and label each tick.
        rh_protocol::validate_quest_props(
            next_props
                .as_ref()
                .or(self.props.as_ref())
                .expect("full state supplies a prop baseline"),
            next_quests.as_ref(),
        )?;
        let mut items = Vec::new();
        if full || next_inventory != self.inventory {
            items.push(StateItem::Inventory(next_inventory));
        }
        if let Some(next_props) = next_props {
            items.push(StateItem::Props(next_props));
        }
        if full || next_fields != self.fields {
            items.push(StateItem::Fields(next_fields));
        }
        if full || rewards_changed {
            items.push(StateItem::RewardChests(rewards(observation)?));
        }
        if full || next_build != self.build {
            items.push(StateItem::Build(next_build));
        }
        if full || next_camps != self.camps {
            items.push(StateItem::Camps(next_camps));
        }
        if full || next_projectiles != self.projectiles {
            items.push(StateItem::Projectiles(next_projectiles));
        }
        if full || next_plan != self.plan {
            items.push(StateItem::Plan(next_plan));
        }
        if full || next_arena != self.arena {
            items.push(StateItem::Arena(next_arena));
        }
        if full || next_quests != self.quests {
            items.push(StateItem::Quests(next_quests));
        }
        if full || !trade_bits_equal(next_trade.as_ref(), self.trade.as_ref()) {
            items.push(StateItem::Trade(next_trade));
        }
        if full || !super::projection::roster_equal(&self.roster, &observation.roster) {
            items.push(StateItem::Roster(super::projection::wire_roster(
                &observation.roster,
            )));
        }
        if full
            || summary_stale(
                self.summary.as_ref(),
                observation.summary.as_ref(),
                observation.panel.as_ref(),
            )
        {
            items.push(StateItem::BuildSummary(next_summary));
        }
        // Key 14 is optional: sent only when the rows differ from what the client holds (empty from every Welcome),
        // so a viewer without rows never receives it, not even in a full or forced State.
        let next_readouts = readouts(observation);
        if next_readouts != self.readouts || (full && !next_readouts.is_empty()) {
            items.push(StateItem::Readouts(next_readouts));
        }
        // Key 15 (P-AUG-NATIVE-5) follows key 14's rule: the public Marked Man rows, sent only when the quantized rows
        // differ from what the client holds, so a world without a holder never sends it.
        let next_marked = marked(observation);
        if next_marked != self.marked || (full && !next_marked.is_empty()) {
            items.push(StateItem::Marked(next_marked));
        }
        let (frame, items) = if items.is_empty() {
            (None, items)
        } else {
            let message = ServerMsg::State {
                tick: observation.tick,
                items,
            };
            let frame = message.try_encode()?;
            let ServerMsg::State { items, .. } = message else {
                unreachable!()
            };
            (Some(frame), items)
        };
        Ok(PendingState {
            frame,
            items,
            tick: observation.tick,
            forced,
        })
    }
}

impl PendingState {
    pub fn commit(self, publisher: &mut CollectionPublisher) -> bool {
        for item in self.items {
            match item {
                StateItem::Inventory(v) => publisher.inventory = v,
                StateItem::Props(v) => publisher.props = Some(v),
                StateItem::Fields(v) => publisher.fields = v,
                StateItem::Build(v) => publisher.build = v,
                StateItem::Camps(v) => publisher.camps = v,
                StateItem::Projectiles(v) => publisher.projectiles = v,
                StateItem::Plan(v) => publisher.plan = v,
                StateItem::Arena(v) => publisher.arena = v,
                StateItem::Quests(v) => publisher.quests = v,
                StateItem::Trade(v) => publisher.trade = v,
                StateItem::Roster(v) => publisher.roster = v,
                StateItem::RewardChests(_) => {}
                StateItem::BuildSummary(v) => publisher.summary = v,
                StateItem::Readouts(v) => publisher.readouts = v,
                StateItem::Marked(v) => publisher.marked = v,
            }
        }
        publisher.sent = true;
        if self.forced {
            publisher.last_forced = Some(self.tick);
        }
        self.forced
    }
}

#[cfg(test)]
mod tests;
