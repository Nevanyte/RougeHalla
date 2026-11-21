//! [`StateItem`]: encode, decode and the pre-encode check of one State key.

use super::*;

impl StateItem {
    pub fn key(&self) -> u32 {
        match self {
            Self::Inventory(_) => 1,
            Self::Props(_) => 2,
            Self::Fields(_) => 3,
            Self::RewardChests(_) => 4,
            Self::Build(_) => 5,
            Self::Camps(_) => 6,
            Self::Projectiles(_) => 7,
            Self::Plan(_) => 8,
            Self::Arena(_) => 9,
            Self::Quests(_) => 10,
            Self::Trade(_) => 11,
            Self::Roster(_) => 12,
            Self::BuildSummary(_) => 13,
            Self::Readouts(_) => 14,
            Self::Marked(_) => 15,
        }
    }
    pub(crate) fn encoded_len(&self) -> usize {
        varint_len(self.key())
            + match self {
                Self::Inventory(value) => {
                    1 + value.as_ref().map_or(0, |v| {
                        6 + [v.healing_until, v.speed_boost_until]
                            .iter()
                            .map(|c| 1 + usize::from(c.is_some()) * 8)
                            .sum::<usize>()
                    })
                }
                Self::Props(value) => value.len(),
                Self::Fields(value) => {
                    varint_len(value.len() as u32) + value.iter().map(WireField::len).sum::<usize>()
                }
                Self::RewardChests(value) => {
                    varint_len(value.len() as u32)
                        + value.iter().map(WireRewardChest::len).sum::<usize>()
                }
                Self::Build(value) => 1 + usize::from(value.is_some()) * 88,
                Self::Projectiles(value) => {
                    varint_len(value.len() as u32)
                        + value.iter().map(WireProjectile::len).sum::<usize>()
                }
                Self::Camps(value) => {
                    varint_len(value.len() as u32) + value.iter().map(WireCamp::len).sum::<usize>()
                }
                Self::Plan(value) => 1 + value.as_ref().map_or(0, WirePlan::len),
                Self::Arena(value) => 1 + value.as_ref().map_or(0, WireArena::len),
                Self::Quests(value) => 1 + value.as_ref().map_or(0, WireQuestView::encoded_len),
                Self::Trade(value) => 1 + value.as_ref().map_or(0, WireTradeView::encoded_len),
                Self::Roster(rows) => {
                    1 + rows
                        .iter()
                        .map(|row| varint_len(row.id) + 1 + 1 + row.name.len())
                        .sum::<usize>()
                }
                Self::BuildSummary(value) => 1 + value.as_ref().map_or(0, WireBuildSummary::len),
                Self::Readouts(rows) => 1 + rows.len() * WireReadout::LEN,
                Self::Marked(rows) => 1 + rows.iter().map(WireMarked::len).sum::<usize>(),
            }
    }
    pub(crate) fn check(&self) -> Result<(), EncodeError> {
        match self {
            Self::Inventory(Some(value)) => {
                if value.active_slot > 1 {
                    return Err(EncodeError::BadValue("active slot"));
                }
                if value.potion_small > 5 || value.potion_large > 5 || value.potions_healing > 3 {
                    return Err(EncodeError::BadValue("potion count"));
                }
                for slot in value.slots {
                    check_weapon(slot)?;
                }
                if ![value.healing_until, value.speed_boost_until]
                    .into_iter()
                    .flatten()
                    .all(inventory_clock_ok)
                {
                    return Err(EncodeError::BadValue("inventory clock"));
                }
            }
            Self::Inventory(None) => {}
            Self::Props(value) => value.check()?,
            Self::Fields(value) => {
                if value.len() > MAX_VISIBLE_FIELDS {
                    return Err(EncodeError::TooMany {
                        what: "fields",
                        n: value.len(),
                        max: MAX_VISIBLE_FIELDS,
                    });
                }
                for field in value {
                    field.check().map_err(EncodeError::BadValue)?;
                }
            }
            Self::RewardChests(value) => {
                if value.len() > MAX_REWARD_CHESTS {
                    return Err(EncodeError::TooMany {
                        what: "reward chests",
                        n: value.len(),
                        max: MAX_REWARD_CHESTS,
                    });
                }
                let mut previous = 0;
                for row in value {
                    if row.handle.get() <= previous || !row.valid() {
                        return Err(EncodeError::BadValue("reward chest"));
                    }
                    previous = row.handle.get();
                }
            }
            Self::Build(_) => {}
            Self::Projectiles(value) => {
                if value.len() > 512 {
                    return Err(EncodeError::TooMany {
                        what: "projectiles",
                        n: value.len(),
                        max: 512,
                    });
                }
                if !value.iter().all(WireProjectile::valid) {
                    return Err(EncodeError::BadValue("projectile"));
                }
            }
            Self::Camps(value) => {
                if value.len() > 512 {
                    return Err(EncodeError::TooMany {
                        what: "camps",
                        n: value.len(),
                        max: 512,
                    });
                }
                if !value.iter().all(WireCamp::valid) {
                    return Err(EncodeError::BadValue("camp"));
                }
            }
            Self::Plan(Some(value)) => {
                if !value.valid() {
                    return Err(EncodeError::BadValue("plan"));
                }
            }
            Self::Plan(None) | Self::Arena(None) => {}
            Self::Arena(Some(value)) => {
                if !value.valid() {
                    return Err(EncodeError::BadValue("arena"));
                }
            }
            Self::Quests(Some(value)) => value.check()?,
            Self::Quests(None) => {}
            Self::Trade(Some(value)) => value.check()?,
            Self::Trade(None) => {}
            Self::Roster(rows) => {
                if let Some(why) = roster_fault(rows) {
                    return Err(EncodeError::BadValue(why));
                }
            }
            Self::BuildSummary(None) => {}
            Self::BuildSummary(Some(value)) => {
                if value.mob_rows.len() > MAX_SUMMARY_MOB_ROWS {
                    return Err(EncodeError::TooMany {
                        what: "summary mob rows",
                        n: value.mob_rows.len(),
                        max: MAX_SUMMARY_MOB_ROWS,
                    });
                }
                if value.panel.len() > MAX_PANEL_VALUES {
                    return Err(EncodeError::TooMany {
                        what: "summary panel values",
                        n: value.panel.len(),
                        max: MAX_PANEL_VALUES,
                    });
                }
                if let Some(why) = value.fault() {
                    return Err(EncodeError::BadValue(why));
                }
            }
            Self::Readouts(rows) => {
                if rows.len() > MAX_READOUTS {
                    return Err(EncodeError::TooMany {
                        what: "readouts",
                        n: rows.len(),
                        max: MAX_READOUTS,
                    });
                }
                let mut previous = None;
                for row in rows {
                    row.fault(previous).map_err(EncodeError::BadValue)?;
                    previous = Some(row.card);
                }
            }
            Self::Marked(rows) => {
                if rows.len() > MAX_ROSTER {
                    return Err(EncodeError::TooMany {
                        what: "marked",
                        n: rows.len(),
                        max: MAX_ROSTER,
                    });
                }
                let mut previous = 0;
                for row in rows {
                    if let Some(why) = WireMarked::id_fault(row.id, previous) {
                        return Err(EncodeError::BadValue(why));
                    }
                    previous = row.id;
                    if !crate::quant::pos_in_range(row.x) || !crate::quant::pos_in_range(row.y) {
                        return Err(EncodeError::BadValue("position"));
                    }
                }
            }
        }
        Ok(())
    }
    pub(crate) fn write(&self, w: &mut Writer) {
        w.varint(self.key());
        match self {
            Self::Inventory(value) => {
                w.opt(value.as_ref(), |w, value| {
                    w.u8(value.active_slot);
                    for slot in value.slots {
                        write_weapon(w, slot);
                    }
                    w.u8(value.potion_small);
                    w.u8(value.potion_large);
                    w.u8(value.potions_healing);
                    w.opt(value.healing_until.as_ref(), |w, v| w.f64(*v));
                    w.opt(value.speed_boost_until.as_ref(), |w, v| w.f64(*v));
                });
            }
            Self::Props(value) => value.write(w),
            Self::Projectiles(value) => {
                w.varint(value.len() as u32);
                for row in value {
                    row.write(w);
                }
            }
            Self::Camps(value) => {
                w.varint(value.len() as u32);
                for row in value {
                    row.write(w);
                }
            }
            Self::Fields(value) => {
                w.varint(value.len() as u32);
                for field in value {
                    field.write(w);
                }
            }
            Self::RewardChests(value) => {
                w.varint(value.len() as u32);
                for row in value {
                    row.write(w)
                }
            }
            Self::Build(value) => w.opt(value.as_ref(), |w, v| {
                w.bytes(&v.cards);
                w.bytes(&v.boosts);
            }),
            Self::Plan(value) => w.opt(value.as_ref(), |w, v| v.write(w)),
            Self::Arena(value) => w.opt(value.as_ref(), |w, v| v.write(w)),
            Self::Quests(value) => {
                w.u8(u8::from(value.is_some()));
                if let Some(view) = value {
                    view.write(w);
                }
            }
            Self::Trade(value) => {
                w.u8(u8::from(value.is_some()));
                if let Some(view) = value {
                    view.write(w);
                }
            }
            Self::Roster(rows) => {
                w.u8(rows.len() as u8);
                for row in rows {
                    w.varint(row.id);
                    w.u8(if row.bot { ROSTER_FLAG_BOT } else { 0 });
                    w.str(&row.name);
                }
            }
            Self::BuildSummary(value) => w.opt(value.as_ref(), |w, v| v.write(w)),
            Self::Readouts(rows) => {
                w.u8(rows.len() as u8);
                for row in rows {
                    w.u8(row.card);
                    w.u8(row.kind);
                    w.f64(row.value);
                    w.f64(row.max);
                }
            }
            Self::Marked(rows) => {
                w.u8(rows.len() as u8);
                for row in rows {
                    w.varint(row.id);
                    w.u16(crate::quant::quantize_pos(row.x));
                    w.u16(crate::quant::quantize_pos(row.y));
                }
            }
        }
    }
    pub(crate) fn read(r: &mut Reader<'_>, key: u32) -> Result<Self, DecodeError> {
        Ok(match key {
            1 => Self::Inventory(r.opt(|r| {
                let active_slot = r.u8()?;
                if active_slot > 1 {
                    return Err(DecodeError::BadField("active slot"));
                }
                let slots = [read_weapon(r)?, read_weapon(r)?];
                let potion_small = r.u8()?;
                let potion_large = r.u8()?;
                let potions_healing = r.u8()?;
                if potion_small > 5 || potion_large > 5 || potions_healing > 3 {
                    return Err(DecodeError::BadField("potion count"));
                }
                // The counts are checked before the clocks are read (`state_bad_potion_count` keeps its reason).
                let healing_until = read_inventory_clock(r)?;
                let speed_boost_until = read_inventory_clock(r)?;
                Ok(WireInventory {
                    active_slot,
                    slots,
                    potion_small,
                    potion_large,
                    potions_healing,
                    healing_until,
                    speed_boost_until,
                })
            })?),
            2 => Self::Props(WireProps::read(r)?),
            3 => {
                let n = r.varint()? as usize;
                if n > MAX_VISIBLE_FIELDS {
                    return Err(DecodeError::TooMany(n));
                }
                let mut fields = Vec::with_capacity(n);
                for _ in 0..n {
                    fields.push(WireField::read(r)?);
                }
                Self::Fields(fields)
            }
            4 => {
                let n = r.varint()? as usize;
                if n > MAX_REWARD_CHESTS {
                    return Err(DecodeError::TooMany(n));
                }
                let mut rows = Vec::with_capacity(n);
                let mut previous = 0;
                for _ in 0..n {
                    let row = WireRewardChest::read(r)?;
                    if row.handle.get() <= previous {
                        return Err(DecodeError::BadField("chest handles"));
                    }
                    previous = row.handle.get();
                    rows.push(row);
                }
                Self::RewardChests(rows)
            }
            5 => Self::Build(r.opt(|r| {
                Ok(WireBuild {
                    cards: r.bytes(80)?.try_into().unwrap(),
                    boosts: r.bytes(8)?.try_into().unwrap(),
                })
            })?),
            6 => {
                let n = r.varint()? as usize;
                if n > 512 {
                    return Err(DecodeError::TooMany(n));
                }
                let mut rows = Vec::with_capacity(n);
                for _ in 0..n {
                    rows.push(WireCamp::read(r)?);
                }
                Self::Camps(rows)
            }
            7 => {
                let n = r.varint()? as usize;
                if n > 512 {
                    return Err(DecodeError::TooMany(n));
                }
                let mut rows = Vec::with_capacity(n);
                for _ in 0..n {
                    rows.push(WireProjectile::read(r)?);
                }
                Self::Projectiles(rows)
            }
            8 => Self::Plan(r.opt(WirePlan::read)?),
            9 => Self::Arena(r.opt(WireArena::read)?),
            10 => {
                let start = r.position();
                let value = match quest_bool(r)? {
                    false => None,
                    true => Some(WireQuestView::read(r)?),
                };
                let payload_len = r.position() - start;
                if payload_len > MAX_QUEST_VIEW_BYTES {
                    return Err(DecodeError::TooLarge(payload_len));
                }
                Self::Quests(value)
            }
            11 => {
                let start = r.position();
                let value = match trade_bool(r)? {
                    false => None,
                    true => Some(WireTradeView::read(r)?),
                };
                let payload_len = r.position() - start;
                if payload_len > MAX_TRADE_VIEW_BYTES {
                    return Err(DecodeError::TooLarge(payload_len));
                }
                Self::Trade(value)
            }
            12 => {
                let n = usize::from(r.u8()?);
                if n > MAX_ROSTER {
                    return Err(DecodeError::BadField("roster count"));
                }
                let mut rows = Vec::with_capacity(n);
                for _ in 0..n {
                    let id = r.varint()?;
                    let bot = match r.u8()? {
                        0 => false,
                        ROSTER_FLAG_BOT => true,
                        _ => return Err(DecodeError::BadField("roster flags")),
                    };
                    let name = r.str()?;
                    rows.push(WireRosterRow { id, bot, name });
                }
                if let Some(why) = roster_fault(&rows) {
                    return Err(DecodeError::BadField(why));
                }
                Self::Roster(rows)
            }
            13 => Self::BuildSummary(r.opt(WireBuildSummary::read)?),
            14 => {
                let n = usize::from(r.u8()?);
                if n > MAX_READOUTS {
                    return Err(DecodeError::BadField("readout count"));
                }
                let mut rows = Vec::with_capacity(n);
                let mut previous = None;
                for _ in 0..n {
                    let row = WireReadout {
                        card: r.u8()?,
                        kind: r.u8()?,
                        value: r.f64()?,
                        max: r.f64()?,
                    };
                    row.fault(previous).map_err(DecodeError::BadField)?;
                    previous = Some(row.card);
                    rows.push(row);
                }
                Self::Readouts(rows)
            }
            15 => {
                let n = usize::from(r.u8()?);
                if n > MAX_ROSTER {
                    return Err(DecodeError::BadField("marked count"));
                }
                let mut rows = Vec::with_capacity(n);
                let mut previous = 0;
                for _ in 0..n {
                    let id = r.varint()?;
                    if let Some(why) = WireMarked::id_fault(id, previous) {
                        return Err(DecodeError::BadField(why));
                    }
                    previous = id;
                    let x = crate::quant::dequantize_pos(r.u16()?);
                    let y = crate::quant::dequantize_pos(r.u16()?);
                    rows.push(WireMarked { id, x, y });
                }
                Self::Marked(rows)
            }
            _ => return Err(DecodeError::BadField("state key")),
        })
    }
}

pub(crate) fn check_items(items: &[StateItem]) -> Result<(), EncodeError> {
    if items.len() > MAX_STATE_KEYS {
        return Err(EncodeError::TooMany {
            what: "state keys",
            n: items.len(),
            max: MAX_STATE_KEYS,
        });
    }
    let mut previous = 0;
    for item in items {
        if item.key() <= previous {
            return Err(EncodeError::BadValue("state key order"));
        }
        previous = item.key();
        item.check()?;
    }
    let props = items.iter().find_map(|item| match item {
        StateItem::Props(value) => Some(value),
        _ => None,
    });
    let quests_item = items.iter().find_map(|item| match item {
        StateItem::Quests(value) => Some(value),
        _ => None,
    });
    if let (Some(props), Some(quests)) = (props, quests_item) {
        validate_quest_props(props, quests.as_ref())?;
    }
    Ok(())
}

pub(crate) fn read_items(r: &mut Reader<'_>) -> Result<Vec<StateItem>, DecodeError> {
    let n = r.varint()? as usize;
    if n > MAX_STATE_KEYS {
        return Err(DecodeError::TooMany(n));
    }
    let mut items = Vec::with_capacity(n);
    let mut previous = 0;
    for _ in 0..n {
        let key = r.varint()?;
        if key <= previous {
            return Err(DecodeError::BadField("state key order"));
        }
        previous = key;
        items.push(StateItem::read(r, key)?);
    }
    let props = items.iter().find_map(|item| match item {
        StateItem::Props(value) => Some(value),
        _ => None,
    });
    let quests_item = items.iter().find_map(|item| match item {
        StateItem::Quests(value) => Some(value),
        _ => None,
    });
    if let (Some(props), Some(quests)) = (props, quests_item) {
        validate_quest_props(props, quests.as_ref())
            .map_err(|_| DecodeError::BadField("quest prop reference"))?;
    }
    Ok(items)
}
