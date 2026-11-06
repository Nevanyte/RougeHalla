use super::*;
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AddValue {
    pub per: f64,
    pub cap: f64,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusApply {
    pub kind: StatusKind,
    pub source: StatusSource,
    pub ms: f64,
    pub ability: Option<AbilityId>,
    pub tag: Option<StatusTag>,
    pub value: Option<f64>,
    pub add: Option<AddValue>,
    pub data: Option<Payload>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Recipient {
    Player,
    Mob,
    QuestGiver,
}
pub fn admits(a: &StatusApply, recipient: Recipient, standing: bool) -> bool {
    standing
        && a.ms > 0.
        && recipient != Recipient::QuestGiver
        && (!a.kind.rule().players_only || recipient == Recipient::Player)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Applied {
    pub index: usize,
    pub fresh: bool,
}
/// Mutates only after admission and ledger-freeze handling by the scheduled runtime.
/// Its index is valid until the next table mutation; hooks receive a stable snapshot.
pub fn apply(rt: &mut StatusRuntime, now: f64, a: StatusApply) -> Applied {
    rt.initialized = true;
    let key = key(a.ability, a.tag.as_ref().map(StatusTag::as_str));
    let found = rt
        .instances
        .iter()
        .position(|st| st.kind == a.kind && st.source.id == a.source.id && st.key() == key);
    let index = found.unwrap_or(rt.instances.len());
    if found.is_none() {
        rt.instances.push(StatusInstance {
            kind: a.kind,
            source: a.source.clone(),
            ability: a.ability,
            tag: a.tag.clone(),
            started_at: now,
            until: 0.,
            value: 0.,
            reveal_from: None,
            taken: None,
            data: Payload::default(),
        });
    }
    let st = &mut rt.instances[index];
    let fresh = found.is_none() || st.until <= now;
    let base = a.value.unwrap_or(0.);
    let max = a.kind.rule().max_ms;
    if fresh {
        st.started_at = now;
        st.until = now + a.ms.min(max);
        st.value = a.add.map_or(base, |add| (base + add.per).min(add.cap));
        st.source = a.source;
        st.reveal_from = None;
        st.data.reveal_until = None;
        st.data.undefined_fields &= !1;
    } else {
        st.until = st.until.max(now + a.ms).min(now + max);
        st.value = a
            .add
            .map_or(st.value.max(base), |add| (st.value + add.per).min(add.cap));
    }
    if let Some(data) = a.data {
        st.data.merge(data)
    }
    rt.refresh_effects(now);
    Applied { index, fresh }
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub enum Selector {
    All,
    Expired {
        at: f64,
    },
    Kind(StatusKind),
    Source(Option<crate::PlayerId>),
    Field {
        kind: StatusKind,
        id: u32,
    },
    HiddenKey {
        source: Option<crate::PlayerId>,
        ability: Option<AbilityId>,
    },
    Cleanse {
        soft: bool,
        hard: bool,
    },
}
impl Selector {
    pub fn matches(self, st: &StatusInstance) -> bool {
        match self {
            Self::All => true,
            Self::Expired { at } => st.until <= at,
            Self::Kind(kind) => st.kind == kind,
            Self::Source(id) => st.source.id == id,
            Self::Field { kind, id } => st.kind == kind && st.data.field_id == Some(id),
            Self::HiddenKey { source, ability } => {
                st.kind == StatusKind::Hidden && st.source.id == source && st.ability == ability
            }
            Self::Cleanse { soft, hard } => match st.kind.rule().cleanse {
                CleanseClass::Soft => soft,
                CleanseClass::Hard => hard,
                CleanseClass::Never => false,
            },
        }
    }
}
/// Stable partition into caller-owned storage, avoiding a new temporary vector per tick.
pub fn remove_into(
    rt: &mut StatusRuntime,
    now: f64,
    selector: Selector,
    removed: &mut Vec<StatusInstance>,
) -> bool {
    let before = removed.len();
    let mut slow = false;
    let mut i = 0;
    while i < rt.instances.len() {
        if selector.matches(&rt.instances[i]) {
            let st = rt.instances.remove(i);
            slow |= st.kind == StatusKind::SlowAttack;
            removed.push(st);
        } else {
            i += 1
        }
    }
    if removed.len() != before {
        rt.refresh_effects(now)
    }
    slow
}
