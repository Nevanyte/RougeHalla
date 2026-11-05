use super::*;
impl Runtime<'_> {
    pub(super) fn log_write(&mut self, i: usize) {
        if self.tx_on {
            self.log.push(Write {
                tile: i,
                class: self.state.tiles[i],
                kind: self.state.terrain[i],
                wrote: self.state.wrote[i],
            });
        }
    }
    fn mark(&self) -> TxMark {
        TxMark {
            len: self.log.len(),
            walls: self.counters.walls,
            lows: self.counters.lows,
        }
    }
    fn rollback(&mut self, m: TxMark) {
        for e in self.log[m.len..].iter().rev() {
            self.state.tiles[e.tile] = e.class;
            self.state.terrain[e.tile] = e.kind;
            self.state.wrote[e.tile] = e.wrote;
        }
        self.log.truncate(m.len);
        self.counters.walls = m.walls;
        self.counters.lows = m.lows;
    }
    fn give_back(&mut self, k: usize) {
        let e = self.log[k];
        let cur = self.state.tiles[e.tile];
        if cur == TILE_WALL {
            self.counters.walls -= 1;
            if e.class == TILE_LOW && e.wrote != 0 {
                self.counters.lows += 1;
            }
        } else if cur == TILE_LOW && e.class == TILE_FLOOR {
            self.counters.lows -= 1;
        }
        self.state.tiles[e.tile] = e.class;
        self.state.terrain[e.tile] = e.kind;
        self.state.wrote[e.tile] = e.wrote;
    }
    fn piece_size(&mut self, i: usize, cap: usize) -> usize {
        let (w, h) = (self.state.w, self.state.h);
        let cls = self.state.tiles[i];
        let stamp = self.state.scratch.stamp();
        let (mut head, mut tail) = (0, 1);
        self.state.scratch.qa[0] = i as i32;
        self.state.scratch.mark[i] = stamp as i32;
        while head < tail && tail < cap {
            let cur = self.state.scratch.qa[head] as usize;
            head += 1;
            let (x, y) = ((cur % w) as i32, (cur / w) as i32);
            for q in 0..8 {
                if tail >= cap {
                    break;
                }
                let Some(j) = at(w, h, x + RING_DX[q], y + RING_DY[q]) else {
                    continue;
                };
                if i64::from(self.state.scratch.mark[j]) == stamp || self.state.tiles[j] != cls {
                    continue;
                }
                self.state.scratch.mark[j] = stamp as i32;
                self.state.scratch.qa[tail] = j as i32;
                tail += 1;
            }
        }
        tail
    }
    fn put(&mut self, spec: &FeatureSpec, b: usize, entry: &mut [Option<usize>]) -> bool {
        let before = self.log.len();
        if !self.block(spec.blocks[b].0, spec.blocks[b].1) {
            return false;
        }
        entry[b] = Some(before);
        true
    }
    /// Typed malformed-domain refusal precedes every write, join spend, scratch stamp and counter change.
    /// Ordinary guard refusal is Ok(None), and deliberately retains joins/refusals after rollback.
    pub fn place_feature(&mut self, spec: &FeatureSpec) -> Result<Option<PlacedFeature>, Error> {
        if self.tx_on
            || spec
                .groups
                .as_ref()
                .is_some_and(|g| g.len() != spec.blocks.len())
            || spec.blocks.len() > MAX_CELLS
            || spec.floor.as_ref().is_some_and(|a| a.len() > MAX_CELLS)
            || spec
                .min_piece
                .is_some_and(|v| v == 0 || v as usize > MAX_CELLS)
            || spec.min_share_permille.is_some_and(|v| v > 1_000_000)
            || spec.min_groups.is_some_and(|v| v as usize > MAX_CELLS)
        {
            return Err(Error::Feature);
        }
        if self.state.features.len() >= u16::MAX as usize {
            return Err(Error::Capacity);
        }
        self.tx_on = true;
        let start = self.mark();
        let mut entry = vec![None; spec.blocks.len()];
        let mut ok = true;
        match spec.mode {
            Mode::Whole => {
                for b in 0..spec.blocks.len() {
                    if !self.put(spec, b, &mut entry) {
                        ok = false;
                        break;
                    }
                }
            }
            Mode::Trim => {
                for b in 0..spec.blocks.len() {
                    self.put(spec, b, &mut entry);
                }
            }
            Mode::Groups => {
                let defaults;
                let groups = if let Some(g) = &spec.groups {
                    g
                } else {
                    defaults = vec![0; spec.blocks.len()];
                    &defaults
                };
                let mut order = Vec::new();
                for &g in groups {
                    if !order.contains(&g) {
                        order.push(g);
                    }
                }
                let mut standing = 0;
                for g in order {
                    let m = self.mark();
                    let mut whole = true;
                    for (b, &bg) in groups.iter().enumerate() {
                        if bg == g && !self.put(spec, b, &mut entry) {
                            whole = false;
                            break;
                        }
                    }
                    if whole {
                        standing += 1;
                    } else {
                        self.rollback(m);
                        for (b, &bg) in groups.iter().enumerate() {
                            if bg == g {
                                entry[b] = None;
                            }
                        }
                    }
                }
                ok = standing >= spec.min_groups.unwrap_or(self.rules.min_groups);
            }
        }
        if ok && spec.mode == Mode::Trim {
            let min_piece = spec.min_piece.unwrap_or(self.rules.min_piece) as usize;
            let mut back = Vec::new();
            for b in 0..spec.blocks.len() {
                if entry[b].is_none() {
                    continue;
                }
                let i = spec.blocks[b].0 as usize;
                if self.state.tiles[i] == TILE_FLOOR || self.piece_size(i, min_piece) >= min_piece {
                    continue;
                }
                let stamp = self.state.scratch.epoch;
                for (c, e) in entry.iter().enumerate() {
                    let t = spec.blocks[c].0;
                    if e.is_some()
                        && self.index(t).is_some_and(|j| {
                            i64::from(self.state.scratch.mark[j]) == stamp
                                && self.state.tiles[j] != TILE_FLOOR
                        })
                    {
                        back.push(c);
                    }
                }
                for &c in back.iter().rev() {
                    self.give_back(entry[c].expect("standing"));
                    entry[c] = None;
                }
                back.clear();
            }
            let stands = entry
                .iter()
                .enumerate()
                .filter(|(b, e)| {
                    e.is_some() && self.state.tiles[spec.blocks[*b].0 as usize] != TILE_FLOOR
                })
                .count();
            ok = stands as u64 * 1000
                >= u64::from(
                    spec.min_share_permille
                        .unwrap_or(self.rules.min_share_permille),
                ) * spec.blocks.len() as u64;
        }
        let mut written = Vec::new();
        if ok {
            let stamp = self.state.scratch.stamp();
            for (b, e) in entry.iter().enumerate() {
                if e.is_none() {
                    continue;
                }
                let t = spec.blocks[b].0;
                let i = t as usize;
                if self.state.tiles[i] == TILE_FLOOR
                    || i64::from(self.state.scratch.mark[i]) == stamp
                {
                    continue;
                }
                self.state.scratch.mark[i] = stamp as i32;
                written.push(t);
            }
        }
        let mut floor = Vec::new();
        if ok {
            if let Some(list) = &spec.floor {
                let stamp = self.state.scratch.stamp();
                for &f in list {
                    let Some(i) = self.index(f) else {
                        continue;
                    };
                    if self.input.geometry.mask[i] == 0
                        || self.state.tiles[i] != TILE_FLOOR
                        || self.state.feature_owner[i] != 0
                        || i64::from(self.state.scratch.mark[i]) == stamp
                    {
                        continue;
                    }
                    self.state.scratch.mark[i] = stamp as i32;
                    floor.push(f);
                }
            }
        }
        self.tx_on = false;
        if !ok || written.len() + floor.len() == 0 {
            self.rollback(start);
            return Ok(None);
        }
        self.log.clear();
        let id = self.state.features.len();
        let (mut x0, mut y0, mut x1, mut y1) = (self.state.w, self.state.h, 0, 0);
        for &t in written.iter().chain(&floor) {
            let i = t as usize;
            self.state.feature_owner[i] = (id + 1) as u16;
            let (x, y) = (i % self.state.w, i / self.state.w);
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
        self.state.features.push(MapFeature {
            kind: spec.kind,
            variant: spec.variant.clone().unwrap_or_default(),
            zone: self.input.geometry.info.faction,
            jobs: spec.jobs.clone(),
            ax: spec.anchor[0],
            ay: spec.anchor[1],
            p: spec.params.clone().unwrap_or_default(),
            bbox: TileRect {
                x: x0 as i32,
                y: y0 as i32,
                w: (x1 - x0 + 1) as u32,
                h: (y1 - y0 + 1) as u32,
            },
            tiles: (written.len() + floor.len()) as u32,
        });
        self.counters.features_added += 1;
        Ok(Some(PlacedFeature {
            id,
            refused: spec.blocks.len() - written.len(),
            written,
        }))
    }
}
