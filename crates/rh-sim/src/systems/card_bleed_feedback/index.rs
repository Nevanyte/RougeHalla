//! Deterministic preallocated pair index for Card rows (P-CARD-BLEED-FEEDBACK-1).
//!
//! The design's index budget `I(N)` is an arena AVL envelope: each node carries the full raw key
//! `(victim, Option<by>)` and the stable ordinal of the row it names. Rotations change links only, never a
//! row's ordinal, and clearing keeps the node capacity. `None` is its own key byte, never a `PlayerId`
//! sentinel. Nodes are indices into one `Vec`: no per-entry heap nodes, no hashing, no resizing maps.
//!
//! The index is a derived acceleration table. It is never serialized or hashed: a restore rebuilds it from
//! the validated row order (see `CardBleedReport::rebuild_index`), which is why it may live in a `serde(skip)`
//! field or in the caller's cold-prepared scratch.

/// No node (an empty child link or an empty root).
pub(crate) const NO_NODE: u32 = u32::MAX;
/// The deepest arena AVL path a 32-bit row domain can produce (log2 of the maximum row capacity, with margin).
const MAX_HEIGHT: usize = 48;

#[derive(Clone, Copy, Debug)]
struct Node {
    /// The full raw key: victim id and the optional source id, kept separately so `None` cannot alias an id.
    victim: u32,
    by: Option<u32>,
    /// The stable row ordinal this node names (rows are append-only until the whole index is cleared).
    row: u32,
    left: u32,
    right: u32,
    height: u8,
}

impl Node {
    fn leaf(victim: u32, by: Option<u32>, row: u32) -> Self {
        Self {
            victim,
            by,
            row,
            left: NO_NODE,
            right: NO_NODE,
            height: 1,
        }
    }
}

/// What an insertion found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Inserted {
    /// The raw pair was already indexed: this is its stable row ordinal.
    Existing(u32),
    /// The raw pair was new and is now the row ordinal the caller passed.
    New,
}

/// A preallocated arena AVL tree from a full raw `(victim, Option<by>)` key to a stable row ordinal.
#[derive(Clone, Debug)]
pub(crate) struct PairIndex {
    nodes: Vec<Node>,
    root: u32,
}

impl Default for PairIndex {
    fn default() -> Self {
        Self {
            nodes: Vec::new(),
            root: NO_NODE,
        }
    }
}

impl PairIndex {
    pub(crate) fn new() -> Self {
        Self {
            nodes: Vec::new(),
            root: NO_NODE,
        }
    }

    /// Reserve room for `capacity` nodes in total, checked by the caller's budget math. Node links and row
    /// ordinals are `u32` with `NO_NODE = u32::MAX` reserved, so a capacity past the ordinal domain is refused
    /// before any allocation.
    pub(crate) fn reserve(&mut self, capacity: usize) -> Result<(), ()> {
        if capacity > u32::MAX as usize || self.nodes.len() > u32::MAX as usize {
            return Err(());
        }
        let extra = capacity.saturating_sub(self.nodes.len());
        self.nodes.try_reserve_exact(extra).map_err(|_| ())
    }

    #[cfg_attr(not(test), allow(dead_code))] // layout/allocation evidence accessor
    pub(crate) fn len(&self) -> usize {
        self.nodes.len()
    }

    #[cfg_attr(not(test), allow(dead_code))] // layout/allocation evidence accessor
    pub(crate) fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Drop every row link while keeping the arena capacity.
    pub(crate) fn reset(&mut self) {
        self.nodes.clear();
        self.root = NO_NODE;
    }

    /// Look up a raw pair; `None` when the pair has no row.
    #[cfg_attr(not(test), allow(dead_code))] // post-insert audit/tests only
    pub(crate) fn find(&self, victim: crate::PlayerId, by: Option<crate::PlayerId>) -> Option<u32> {
        let key = (victim.0, by.map(|p| p.0));
        let mut cur = self.root;
        while cur != NO_NODE {
            let node = &self.nodes[cur as usize];
            match (node.victim, node.by) {
                k if k == key => return Some(node.row),
                k if key < k => cur = node.left,
                _ => cur = node.right,
            }
        }
        None
    }

    /// Insert `row` under the full raw key unless the pair is already indexed. Rows must be appended in
    /// ordinal order (the caller pushes row `n` before indexing row `n + 1`), so every row ordinal stays
    /// exactly its append position.
    pub(crate) fn insert(
        &mut self,
        victim: crate::PlayerId,
        by: Option<crate::PlayerId>,
        row: u32,
    ) -> Inserted {
        let key = (victim.0, by.map(|p| p.0));
        if self.root == NO_NODE {
            self.nodes.push(Node::leaf(key.0, key.1, row));
            self.root = 0;
            return Inserted::New;
        }
        let mut path = [(NO_NODE, false); MAX_HEIGHT];
        let mut depth = 0usize;
        let mut cur = self.root;
        loop {
            let node = &self.nodes[cur as usize];
            let node_key = (node.victim, node.by);
            if key == node_key {
                return Inserted::Existing(node.row);
            }
            debug_assert!(depth < MAX_HEIGHT, "arena AVL path exceeds its bound");
            let left = key < node_key;
            path[depth] = (cur, left);
            depth += 1;
            let next = if left { node.left } else { node.right };
            if next == NO_NODE {
                break;
            }
            cur = next;
        }
        let new = u32::try_from(self.nodes.len()).expect("index node capacity fits u32");
        self.nodes.push(Node::leaf(key.0, key.1, row));
        // Attach the new leaf to its parent.
        let (parent, left) = path[depth - 1];
        if left {
            self.nodes[parent as usize].left = new;
        } else {
            self.nodes[parent as usize].right = new;
        }
        // Walk back up: refresh heights and repair the first unbalanced node (one insertion makes at most
        // one subtree need a rotation), then keep refreshing ancestors' heights.
        let mut i = depth;
        while i > 0 {
            i -= 1;
            let (node, _) = path[i];
            let subtree = self.balance(node);
            if i == 0 {
                self.root = subtree;
            } else {
                let (parent, parent_left) = path[i - 1];
                if parent_left {
                    self.nodes[parent as usize].left = subtree;
                } else {
                    self.nodes[parent as usize].right = subtree;
                }
            }
        }
        Inserted::New
    }

    fn height(&self, node: u32) -> u8 {
        if node == NO_NODE {
            0
        } else {
            self.nodes[node as usize].height
        }
    }

    fn refresh(&mut self, node: u32) {
        let h = 1 + self
            .height(self.nodes[node as usize].left)
            .max(self.height(self.nodes[node as usize].right));
        self.nodes[node as usize].height = h;
    }

    fn balance_factor(&self, node: u32) -> i32 {
        let n = &self.nodes[node as usize];
        i32::from(self.height(n.left)) - i32::from(self.height(n.right))
    }

    /// Refresh `node`'s height and restore the AVL property at it; returns the subtree root.
    fn balance(&mut self, node: u32) -> u32 {
        self.refresh(node);
        let factor = self.balance_factor(node);
        if factor > 1 {
            let left = self.nodes[node as usize].left;
            if self.balance_factor(left) < 0 {
                let rotated = self.rotate_left(left);
                self.nodes[node as usize].left = rotated;
            }
            self.rotate_right(node)
        } else if factor < -1 {
            let right = self.nodes[node as usize].right;
            if self.balance_factor(right) > 0 {
                let rotated = self.rotate_right(right);
                self.nodes[node as usize].right = rotated;
            }
            self.rotate_left(node)
        } else {
            node
        }
    }

    fn rotate_left(&mut self, node: u32) -> u32 {
        let right = self.nodes[node as usize].right;
        debug_assert_ne!(right, NO_NODE);
        let middle = self.nodes[right as usize].left;
        self.nodes[node as usize].right = middle;
        self.nodes[right as usize].left = node;
        self.refresh(node);
        self.refresh(right);
        right
    }

    fn rotate_right(&mut self, node: u32) -> u32 {
        let left = self.nodes[node as usize].left;
        debug_assert_ne!(left, NO_NODE);
        let middle = self.nodes[left as usize].right;
        self.nodes[node as usize].left = middle;
        self.nodes[left as usize].right = node;
        self.refresh(node);
        self.refresh(left);
        left
    }

    /// The maximum root-to-leaf node depth (1 for a single node, 0 for empty). Measured by the layout gate.
    #[cfg_attr(not(test), allow(dead_code))] // layout/allocation evidence accessor
    pub(crate) fn height_of(&self) -> usize {
        if self.root == NO_NODE {
            0
        } else {
            usize::from(self.nodes[self.root as usize].height)
        }
    }

    /// The arena's prepared node capacity (allocated slots, not rows).
    #[cfg_attr(not(test), allow(dead_code))] // layout/allocation evidence accessor
    pub(crate) fn capacity(&self) -> usize {
        self.nodes.capacity()
    }
}

/// Measured arena-node size for the layout evidence (the planning allowance is not a measurement).
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn node_size() -> usize {
    std::mem::size_of::<Node>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PlayerId, PlayerId as Id};

    #[test]
    fn keys_are_full_pairs_and_none_never_aliases_an_id() {
        let mut index = PairIndex::new();
        assert_eq!(index.insert(Id(3), None, 0), Inserted::New);
        assert_eq!(index.insert(Id(3), Some(Id(1)), 1), Inserted::New);
        assert_eq!(index.insert(Id(3), Some(Id(0)), 2), Inserted::New);
        assert_eq!(index.find(Id(3), None), Some(0));
        assert_eq!(index.find(Id(3), Some(Id(1))), Some(1));
        assert_eq!(index.find(Id(3), Some(Id(0))), Some(2));
        assert_eq!(index.find(Id(3), Some(Id(2))), None);
        assert_eq!(index.insert(Id(3), None, 9), Inserted::Existing(0));
        assert_eq!(index.len(), 3);
    }

    #[test]
    fn ascending_descending_and_permuted_inserts_find_the_same_rows_and_bound_height() {
        for order in 0..3 {
            let mut index = PairIndex::new();
            let mut keys = Vec::new();
            for n in 0..512u32 {
                keys.push((Id(1 + (n * 37) % 61), Some(Id(n % 7))));
            }
            match order {
                0 => keys.sort(),
                1 => keys.sort_by(|a, b| b.cmp(a)),
                _ => keys.sort_by_key(|(v, b)| (v.0.wrapping_mul(2654435761), b.map(|p| p.0))),
            }
            for (row, &(victim, by)) in keys.iter().enumerate() {
                if let Inserted::Existing(previous) = index.insert(victim, by, row as u32) {
                    // A pair can repeat across the generated keys; its first row wins.
                    assert!(previous < row as u32);
                }
            }
            for (victim, by) in keys {
                assert!(index.find(victim, by).is_some());
            }
            assert!(index.height_of() <= 16, "AVL height {}", index.height_of());
        }
    }

    #[test]
    fn reset_retains_the_arena_and_reinserts_row_ordinals() {
        let mut index = PairIndex::new();
        index.reserve(64).unwrap();
        let capacity = index.capacity();
        for n in 0..32u32 {
            assert_eq!(index.insert(Id(n), None, n), Inserted::New);
        }
        assert_eq!(index.len(), 32);
        index.reset();
        assert!(index.is_empty());
        assert_eq!(index.capacity(), capacity);
        assert_eq!(index.find(PlayerId(4), None), None);
        assert_eq!(index.insert(Id(4), None, 0), Inserted::New);
        assert_eq!(index.find(Id(4), None), Some(0));
    }
}
