//! Trophy stat keys, reward ids and reward chests.

use super::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum TrophyStatKey {
    Ad = 0,
    Ap = 1,
    Damage = 2,
    Health = 3,
    AttackSpeed = 4,
    Armor = 5,
    Mr = 6,
    Speed = 7,
    Leech = 8,
}
impl TrophyStatKey {
    pub(crate) fn from_code(value: u8) -> Option<Self> {
        Some(match value {
            0 => Self::Ad,
            1 => Self::Ap,
            2 => Self::Damage,
            3 => Self::Health,
            4 => Self::AttackSpeed,
            5 => Self::Armor,
            6 => Self::Mr,
            7 => Self::Speed,
            8 => Self::Leech,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WireRewardId {
    /// `CardId::index()` order: the 80 catalog cards (0..=79, the same positions as WireBuild.cards), then the 14
    /// native cards (80..=93, `CardId::NATIVE`; protocol 19).
    Card(u8),
    /// Source order: ad,ap,armor,shield,maxHp,attackSpeed,moveSpeed,lifesteal.
    Boost(u8),
    /// Owner-only Trophy award. `gain` is the exact source binary64 value.
    Kill { key: TrophyStatKey, gain: f64 },
}
/// Card ids a reward option may carry: 80 catalog cards and 14 native cards (P-WIRE19-A).
const WIRE_CARD_IDS: u8 = 94;

impl WireRewardId {
    pub(super) fn valid(self) -> bool {
        match self {
            Self::Card(id) => id < WIRE_CARD_IDS,
            Self::Boost(id) => id < 8,
            Self::Kill { gain, .. } => gain.is_finite() && gain > 0.0,
        }
    }
    pub(super) fn encoded_len(self) -> usize {
        match self {
            Self::Card(_) | Self::Boost(_) => 2,
            Self::Kill { .. } => 10,
        }
    }
    pub(super) fn write(self, w: &mut Writer) {
        match self {
            Self::Card(id) => {
                w.u8(1);
                w.u8(id)
            }
            Self::Boost(id) => {
                w.u8(2);
                w.u8(id)
            }
            Self::Kill { key, gain } => {
                w.u8(3);
                w.u8(key as u8);
                w.f64(gain);
            }
        }
    }
    pub(super) fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let result = match r.u8()? {
            1 => Self::Card(r.u8()?),
            2 => Self::Boost(r.u8()?),
            3 => {
                let key =
                    TrophyStatKey::from_code(r.u8()?).ok_or(DecodeError::BadField("reward key"))?;
                Self::Kill {
                    key,
                    gain: r.f64()?,
                }
            }
            _ => return Err(DecodeError::BadField("reward kind")),
        };
        if result.valid() {
            Ok(result)
        } else {
            Err(match result {
                Self::Kill { .. } => DecodeError::BadField("reward gain"),
                _ => DecodeError::BadField("reward id"),
            })
        }
    }
}
impl WireRewardChest {
    pub(super) fn valid(&self) -> bool {
        self.expires_at.is_finite()
            && self.options.len() <= 3
            && self
                .options
                .iter()
                .all(|o| o.id.valid() && o.taken_by != Some(0))
            && self
                .first_pick
                .is_none_or(|f| f.until.is_finite() && f.until <= self.expires_at)
    }
    pub(super) fn len(&self) -> usize {
        varint_len(self.handle.get())
            + 16
            + self.first_pick.map_or(0, |_| 9)
            + self
                .options
                .iter()
                .map(|o| o.id.encoded_len() + 2 + o.taken_by.map_or(0, varint_len))
                .sum::<usize>()
    }
    pub(super) fn write(&self, w: &mut Writer) {
        w.varint(self.handle.get());
        w.u16(self.x);
        w.u16(self.y);
        w.f64(self.expires_at);
        w.u8(self.options.len() as u8);
        for o in &self.options {
            o.id.write(w);
            w.u8(u8::from(o.taken));
            w.opt(o.taken_by.as_ref(), |w, id| w.varint(*id));
        }
        w.u8(u8::from(self.picked));
        w.u8(u8::from(self.can_choose));
        w.opt(self.first_pick.as_ref(), |w, f| {
            w.f64(f.until);
            w.u8(u8::from(f.mine));
        });
    }
    pub(super) fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let handle =
            RewardChestHandle::new(r.varint()?).ok_or(DecodeError::BadField("chest handle"))?;
        let (x, y, expires_at, n) = (r.u16()?, r.u16()?, r.f64()?, r.u8()? as usize);
        if n > 3 {
            return Err(DecodeError::TooMany(n));
        }
        let mut options = Vec::with_capacity(n);
        for _ in 0..n {
            options.push(WireRewardOption {
                id: WireRewardId::read(r)?,
                taken: bool_flag(r)?,
                taken_by: r.opt(Reader::varint)?,
            });
        }
        let result = Self {
            handle,
            x,
            y,
            expires_at,
            options,
            picked: bool_flag(r)?,
            can_choose: bool_flag(r)?,
            first_pick: r.opt(|r| {
                Ok(WireFirstPick {
                    until: r.f64()?,
                    mine: bool_flag(r)?,
                })
            })?,
        };
        if result.valid() {
            Ok(result)
        } else {
            Err(DecodeError::BadField("reward chest"))
        }
    }
}
