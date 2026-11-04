//! Entities by id: [`Store`] keeps its items in ascending id order (which is join order, since ids are handed out
//! increasing and never reused), so a lookup by id is a binary search and an iteration is the legacy Map insertion order.
//! The slot (index) of an item is stable for as long as nobody is removed, so a system can keep dense per-slot working
//! lists (`Vec<u32>` ranks and bounties in [`crate::scratch::TickScratch`]) instead of searching `(id, value)` pairs.
//!
//! No hashing and no iteration-order surprise: the whole structure is a sorted `Vec`, serialized as the plain sequence a
//! `Vec` would be.

use crate::state::PlayerId;

/// The public id of any entity that fights (today a player; later mobs and summons share the id space).
pub type EntityId = PlayerId;

/// Something a [`Store`] holds: it knows its own id.
pub trait Keyed {
    fn key(&self) -> EntityId;
}

/// Items in strictly ascending id order.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(transparent)]
pub struct Store<T> {
    items: Vec<T>,
}

impl<T> Default for Store<T> {
    fn default() -> Self {
        Self { items: Vec::new() }
    }
}

impl<T: Keyed> Store<T> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_capacity(n: usize) -> Self {
        Self {
            items: Vec::with_capacity(n),
        }
    }

    /// The slot of `id`, if present: O(1) while ids are dense (nobody left), O(log n) otherwise. Ids strictly ascend, so an
    /// item with id `id` sits at a slot no later than `id - first id`: that slot is tried first (the whole answer for a
    /// store nobody has been removed from) and bounds the binary search when it misses.
    #[inline]
    pub fn idx(&self, id: EntityId) -> Option<usize> {
        let first = self.items.first()?.key();
        let at = (id.0.checked_sub(first.0)? as usize).min(self.items.len() - 1);
        if self.items[at].key() == id {
            return Some(at);
        }
        self.items[..at].binary_search_by_key(&id, Keyed::key).ok()
    }

    #[inline]
    pub fn get(&self, id: EntityId) -> Option<&T> {
        self.idx(id).map(|i| &self.items[i])
    }

    #[inline]
    pub fn get_mut(&mut self, id: EntityId) -> Option<&mut T> {
        let i = self.idx(id)?;
        Some(&mut self.items[i])
    }

    pub fn contains(&self, id: EntityId) -> bool {
        self.idx(id).is_some()
    }

    /// Appends an item whose id is greater than every id present (a join). Panics otherwise: an out-of-order insert would
    /// break every lookup, so it is never tolerated silently.
    pub fn push(&mut self, item: T) {
        assert!(
            self.items.last().is_none_or(|l| l.key() < item.key()),
            "entity ids must be appended in ascending order"
        );
        self.items.push(item);
    }

    /// Removes `id`, keeping the order of the rest (every later slot moves down by one).
    pub fn remove(&mut self, id: EntityId) -> Option<T> {
        let i = self.idx(id)?;
        Some(self.items.remove(i))
    }

    pub fn as_slice(&self) -> &[T] {
        &self.items
    }

    /// Mutable iteration in id order (the items cannot be reordered through it).
    pub fn iter_mut(&mut self) -> std::slice::IterMut<'_, T> {
        self.items.iter_mut()
    }
}

impl<T> std::ops::Deref for Store<T> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        &self.items
    }
}

impl<T> std::ops::Index<usize> for Store<T> {
    type Output = T;
    #[inline]
    fn index(&self, i: usize) -> &T {
        &self.items[i]
    }
}

impl<T> std::ops::IndexMut<usize> for Store<T> {
    #[inline]
    fn index_mut(&mut self, i: usize) -> &mut T {
        &mut self.items[i]
    }
}

impl<'a, T> IntoIterator for &'a Store<T> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;
    fn into_iter(self) -> Self::IntoIter {
        self.items.iter()
    }
}

impl<'a, T> IntoIterator for &'a mut Store<T> {
    type Item = &'a mut T;
    type IntoIter = std::slice::IterMut<'a, T>;
    fn into_iter(self) -> Self::IntoIter {
        self.items.iter_mut()
    }
}

impl<'de, T: Keyed + serde::Deserialize<'de>> serde::Deserialize<'de> for Store<T> {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let items = Vec::<T>::deserialize(d)?;
        if items.windows(2).any(|w| w[0].key() >= w[1].key()) {
            return Err(serde::de::Error::custom(
                "entity ids are not in strictly ascending order",
            ));
        }
        Ok(Self { items })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
    struct It(PlayerId, u8);
    impl Keyed for It {
        fn key(&self) -> EntityId {
            self.0
        }
    }

    #[test]
    fn lookups_follow_ids_and_removal_keeps_order() {
        let mut s = Store::new();
        for id in [1, 2, 5, 9] {
            s.push(It(PlayerId(id), id as u8));
        }
        assert_eq!(s.idx(PlayerId(5)), Some(2));
        assert_eq!(s.idx(PlayerId(4)), None);
        assert_eq!(s.get(PlayerId(9)).map(|i| i.1), Some(9));
        s.get_mut(PlayerId(2)).unwrap().1 = 7;
        assert_eq!(s.remove(PlayerId(2)).map(|i| i.1), Some(7));
        assert_eq!(s.idx(PlayerId(5)), Some(1));
        assert_eq!(
            s.iter().map(|i| i.0 .0).collect::<Vec<_>>(),
            [1, 5, 9],
            "iteration is id order"
        );
        assert!(s.remove(PlayerId(2)).is_none());
        // Below the first id, and past the last: absent, never a wrong slot.
        assert_eq!(s.idx(PlayerId(0)), None);
        assert_eq!(s.idx(PlayerId(100)), None);
        assert_eq!(Store::<It>::new().idx(PlayerId(1)), None);
    }

    #[test]
    fn every_id_of_a_sparse_store_finds_its_slot() {
        let ids = [3u32, 4, 8, 9, 10, 40, 41, 100];
        let mut s = Store::new();
        for id in ids {
            s.push(It(PlayerId(id), 0));
        }
        for probe in 0..120u32 {
            let want = ids.iter().position(|&i| i == probe);
            assert_eq!(s.idx(PlayerId(probe)), want, "id {probe}");
        }
    }

    #[test]
    #[should_panic(expected = "ascending")]
    fn an_out_of_order_push_is_refused() {
        let mut s = Store::new();
        s.push(It(PlayerId(3), 0));
        s.push(It(PlayerId(3), 0));
    }

    #[test]
    fn serializes_as_a_plain_sequence_and_refuses_a_disordered_one() {
        let mut s = Store::new();
        s.push(It(PlayerId(1), 1));
        s.push(It(PlayerId(4), 2));
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(
            v,
            serde_json::to_value(vec![It(PlayerId(1), 1), It(PlayerId(4), 2)]).unwrap()
        );
        assert_eq!(serde_json::from_value::<Store<It>>(v).unwrap(), s);
        let bad = serde_json::to_value(vec![It(PlayerId(4), 1), It(PlayerId(1), 2)]).unwrap();
        assert!(serde_json::from_value::<Store<It>>(bad).is_err());
    }
}
