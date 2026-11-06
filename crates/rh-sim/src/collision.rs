//! Two immutable collision geometries share the admitted static gameplay metadata.
use crate::TileMap;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum Variant {
    #[default]
    Open,
    Locked,
}
impl Variant {
    pub(crate) fn of(locked: bool) -> Self {
        if locked {
            Self::Locked
        } else {
            Self::Open
        }
    }
}
#[derive(Clone, Copy)]
pub(crate) struct View<'a> {
    pub(crate) open: &'a TileMap,
    pub(crate) locked: &'a TileMap,
    pub(crate) variant: Variant,
}
impl<'a> View<'a> {
    pub(crate) fn at(self, variant: Variant) -> &'a TileMap {
        match variant {
            Variant::Open => self.open,
            Variant::Locked => self.locked,
        }
    }
    pub(crate) fn current(self) -> &'a TileMap {
        self.at(self.variant)
    }
}
impl std::ops::Deref for View<'_> {
    type Target = TileMap;
    fn deref(&self) -> &TileMap {
        self.current()
    }
}
// Bare maps are permitted only by isolated legacy leaf tests. Production visibility
// callers must supply both historical variants.
#[cfg(test)]
impl<'a> From<&'a TileMap> for View<'a> {
    fn from(map: &'a TileMap) -> Self {
        Self {
            open: map,
            locked: map,
            variant: Variant::Open,
        }
    }
}

#[cfg(test)]
#[path = "collision_tests.rs"]
pub(crate) mod tests;

pub(crate) fn visit_content(mut word: impl FnMut(u64)) {
    word(u64::from(crate::map::TILE_WALL));
    word(Variant::Open as u64);
    word(Variant::Locked as u64);
    word(crate::vision::max_samples() as u64);
}
