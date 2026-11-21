//! Full producers and isolated trusted status facts have disjoint admission domains.
use super::*;
// Retained source clocks cannot prove the full history. These are necessary stock
// equations: opening lock, or a prior accepted fixed-step cast plus its cooldown.
// `tick_ms`: the match's step (`SimConfig::tick_ms`); every accepted cast and cut lies on its grid.
fn prior_clock(
    prior: f64,
    initial: f64,
    first_cast: f64,
    accepted: f64,
    cooldown: f64,
    tick_ms: f64,
) -> bool {
    prior <= accepted
        && (prior == initial
            || (prior >= first_cast + cooldown && (prior - cooldown) % tick_ms == 0.))
}
/// `prior_clock` for a clock an earlier cast may have produced under any of the Wish cooldowns `earlier` (the accepted
/// cast's `WishEnvelope::earlier`): a grant between the casts can have lengthened it, a Wish Engine step shortened it. With
/// `trims` (the world's numbers, when the player owns Wishful Thinking) the earlier cast's clock may also have been
/// cut, down to its floor `at + wishful_floor_share * cooldown`; millisecond cuts (the legacy rule) keep it on the tick
/// lattice, a share rule's cuts do not.
fn prior_clock_any(
    prior: f64,
    initial: f64,
    first_cast: f64,
    accepted: f64,
    earlier: &[f64],
    trims: Option<&crate::cards::CardNumbers>,
    tick_ms: f64,
) -> bool {
    earlier.iter().any(|&cd| match trims {
        None => prior_clock(prior, initial, first_cast, accepted, cd, tick_ms),
        Some(n) => {
            prior <= accepted
                && (prior == initial
                    || (prior >= first_cast + n.wishful_floor_share * cd
                        && (share_rule(n) || prior % tick_ms == 0.)))
        }
    })
}
/// Wishful Thinking cuts shares of the cast's cooldown (Rework), not the card row's milliseconds (legacy).
fn share_rule(n: &crate::cards::CardNumbers) -> bool {
    n.wishful_hit_share > 0. || n.wishful_budget_share > 0.
}
/// The lattice charge clocks stay on: the match's step (`tick_ms`) and every Wish cooldown a spend can have had
/// (`WishEnvelope::every`).
fn charge_clock_lattice(cooldowns: &[f64], tick_ms: f64) -> f64 {
    let mut a = tick_ms;
    for &cooldown in cooldowns {
        let mut b = cooldown;
        while b != 0. {
            (a, b) = (b, a % b);
        }
    }
    a
}

/// The Wish cooldowns a spend of this player's Wish can carry (P-AUG-NATIVE-3b): the world's Wish row's cooldown
/// (`cooldown_for`, the one the producer spends) under each lever, no multiplier (a cast before the build held a
/// `WishCooldown` card) or the build's multiplier now, and, for a Wish Engine holder, each share of its row's lattice
/// (`WishEngineGrid`): `cd(lever, n) = cooldown_for(.., Some(lever x (1 - share(n))))`, as `wish_mult` spends it. A build
/// only grows, exactly one card, unique, carries a `WishCooldown` row, a factor of at least 1, and the share only grows,
/// one lattice point per landed cast (`wish_lever_tests`): an earlier cast had a lever no longer and a share no larger
/// than a later one's, so it may have had a longer or a shorter cooldown. The stored spend keeps the cooldown it was
/// cast with (a grant between two casts changes the multiplier now, not the spend), and every (lever, share) pair spends
/// a distinct cooldown (`wish_lever_tests`), so the pair is read off the spend: no per-cast record. A non-holder's only
/// share is 0, and its envelope is the two cooldowns, `cd <= spend`, of the levers alone.
struct WishEnvelope {
    ability: AbilityId,
    levers: [f64; 2],
    grid: Option<WishEngineGrid>,
    share: f64,
}

/// A spend's place in its `WishEnvelope`: the lever (0 none, 1 the multiplier now) and the share's lattice index.
#[derive(Clone, Copy)]
struct SpendPair {
    lever: usize,
    n: u32,
}

/// The pair the equations read when a player has no spend (the clocks are then the opening lock).
fn no_spend() -> SpendPair {
    SpendPair { lever: 1, n: 0 }
}

impl WishEnvelope {
    fn of(k: &crate::statics::MatchStatic, p: &crate::state::Player) -> Self {
        let ability = wish(p.faction());
        let grid = if p.build.owns(crate::cards::CardId::WishEngine) {
            WishEngineGrid::of(definition_for(&k.config, ability).cooldown_ms)
        } else {
            None
        };
        Self {
            ability,
            levers: [1., p.modifiers.wish_cooldown_mult()],
            grid,
            share: crate::cards::native::wish_engine_share(&p.build),
        }
    }
    fn top(&self) -> u32 {
        self.grid.map_or(0, WishEngineGrid::top)
    }
    fn share_at(&self, n: u32) -> f64 {
        self.grid.map_or(0., |g| g.share(n))
    }
    /// The cooldown a cast spends under `lever` at lattice share `n` (for share 0 under no lever, the row's own).
    fn cd(&self, k: &crate::statics::MatchStatic, lever: usize, n: u32) -> f64 {
        cooldown_for(
            &k.config,
            self.ability,
            Some(self.levers[lever] * (1. - self.share_at(n))),
        )
    }
    /// The pair a spend of `cooldown_ms` was cast at. The share it spent is the share now (the cast has not landed: in
    /// flight, cancelled, fizzled or refunded) or, with `landed`, the lattice point before it (the landing stepped it).
    fn pair_of(
        &self,
        k: &crate::statics::MatchStatic,
        cooldown_ms: f64,
        landed: bool,
    ) -> Option<SpendPair> {
        let top = self.top();
        (0..=top).find_map(|n| {
            let at = self.share == self.share_at(n)
                || (landed && self.share == self.share_at((n + 1).min(top)));
            if !at {
                return None;
            }
            (0..2)
                .find(|&lever| self.cd(k, lever, n) == cooldown_ms)
                .map(|lever| SpendPair { lever, n })
        })
    }
    /// The cooldowns a cast before a spend at `pair` can have had: a share no larger, a lever no longer (its share-0
    /// cooldown at most the spend's lever's). For a non-holder, the levers' cooldowns up to the spend's own.
    fn earlier(&self, k: &crate::statics::MatchStatic, pair: SpendPair) -> Vec<f64> {
        let ceiling = self.cd(k, pair.lever, 0);
        let mut out = Vec::new();
        for lever in 0..2 {
            if self.cd(k, lever, 0) <= ceiling {
                out.extend((0..=pair.n).map(|n| self.cd(k, lever, n)));
            }
        }
        out
    }
    /// Every cooldown of a share no larger than the spend's, under either lever (the charge lattice, the shortest
    /// interval a previous cast can have had). For a non-holder, the levers' two.
    fn every(&self, k: &crate::statics::MatchStatic, pair: SpendPair) -> Vec<f64> {
        (0..2)
            .flat_map(|lever| (0..=pair.n).map(move |n| (lever, n)))
            .map(|(lever, n)| self.cd(k, lever, n))
            .collect()
    }
}

/// The card producer's trace: Wishful Thinking records each cut (source cards.trims) in the source window. The
/// clocks a cut leaves cannot be replayed from the last spend alone, so the necessary equations use this bounded trace.
/// `budget` is the world table's window budget for the longest cooldown a trim in the window can have been cut under
/// (`CardNumbers::wishful_budget` of the spend's lever at share 0, `WishEnvelope::earlier`'s largest): under a share
/// rule a share of it, so it bounds the earlier casts' trims too. For a non-holder that is the spend's own cooldown.
fn trim_trace_coherent(
    p: &crate::state::Player,
    numbers: &crate::cards::CardNumbers,
    budget: f64,
    now: f64,
    raid_started_at: f64,
    tick_ms: f64,
) -> bool {
    let window = numbers.wishful_window_ms;
    let mut in_window = 0.;
    for t in &p.card_trims {
        if !t.at.is_finite()
            || !t.ms.is_finite()
            || t.at < raid_started_at
            || t.at > now
            || t.at % tick_ms != 0.
            || !(t.ms > 0. && t.ms <= budget)
        {
            return false;
        }
        if now - t.at < window {
            in_window += t.ms;
        }
    }
    in_window <= budget
}

/// The source caps a window's cuts at the budget, so no clock can be further than one budget per elapsed window under
/// its untrimmed spend value (a necessary bound, not an exact replay).
fn max_trim_cut(numbers: &crate::cards::CardNumbers, budget: f64, elapsed: f64) -> f64 {
    budget * (1. + elapsed.max(0.) / numbers.wishful_window_ms)
}

/// Every row it reads is the world's own (`definition_for`, `cooldown_for`), the one the producer cast and spent with.
pub(crate) fn validate(
    k: &crate::statics::MatchStatic,
    w: &crate::state::World,
) -> Result<(), String> {
    let tick_ms = k.tick_ms();
    if !k.config.wish_lock_ms.is_finite()
        || k.config.wish_lock_ms < 0.
        || k.config.wish_lock_ms > f64::from(u32::MAX) * tick_ms
    {
        return Err("invalid Wish lock".into());
    }
    let initial = if k.config.training {
        0.
    } else {
        w.raid_started_at + k.config.wish_lock_ms
    };
    let first_cast = (w.raid_started_at + tick_ms).max(initial);
    let full = k.config.abilities == Mode::Full;
    if full {
        super::effect_checkpoint::validate(w)?;
    }
    for p in &w.players {
        crate::cards::fight_clock::validate(k, w, p)?;
        let stocks = p.stocks;
        let envelope = WishEnvelope::of(k, p);
        let spend_pair = p
            .card_runtime
            .and_then(|cards| cards.wish_cast)
            .and_then(|spend| envelope.pair_of(k, spend.cooldown_ms, true));
        if let Some(spend) = p.card_runtime.and_then(|cards| cards.wish_cast) {
            if !full {
                return Err("card Wish memory in Off mode".into());
            }
            if !(first_cast..=w.server_time).contains(&spend.at)
                || spend.at % tick_ms != 0.
                || !spend.cooldown_ms.is_finite()
                || spend.cooldown_ms <= 0.
                || spend.cooldown_ms.fract() != 0.
                || spend_pair.is_none()
            {
                return Err("invalid card Wish spend".into());
            }
        }
        if !full && stocks != Stocks::default() {
            return Err("Wish stocks in Off mode".into());
        }
        if ![
            Some(stocks.wish_ready_at),
            Some(stocks.q_ready_at),
            Some(stocks.e_ready_at),
            stocks.wish_full_at,
        ]
        .into_iter()
        .flatten()
        .all(|v| v.is_finite() && v >= 0. && v <= f64::from(u32::MAX) * tick_ms)
        {
            return Err("invalid Wish stock clock".into());
        }
        if full {
            let begun = w.raid_started_at > 0.;
            if !begun {
                if stocks != Stocks::default()
                    || p.card_runtime.and_then(|cards| cards.wish_cast).is_some()
                {
                    return Err("Wish state before raid start".into());
                }
            } else {
                let Some(full_at) = stocks.wish_full_at else {
                    return Err("missing initialized Wish stock".into());
                };
                let has_spend = p.card_runtime.and_then(|c| c.wish_cast).is_some();
                if !has_spend && (stocks.wish_ready_at != initial || full_at != initial) {
                    return Err("unproduced Wish stock clocks".into());
                }
                let def = definition_for(&k.config, wish(p.faction()));
                // The spend's own cooldown (checked above to be one a cast can have had); the multiplier now may be
                // a later grant's. Without a spend the clocks are the opening lock and no equation reads it.
                let pair = spend_pair.unwrap_or_else(no_spend);
                let recharge = p.card_runtime.and_then(|c| c.wish_cast).map_or_else(
                    || envelope.cd(k, no_spend().lever, 0),
                    |spend| spend.cooldown_ms,
                );
                let earlier = envelope.earlier(k, pair);
                let every = envelope.every(k, pair);
                // The shortest cooldown the cast before this spend can have had, and the longest (a holder's earlier
                // casts spent at a smaller share; for a non-holder it is the spend's own).
                let prior_min = every.iter().copied().fold(f64::INFINITY, f64::min);
                let prior_max = earlier.iter().copied().fold(recharge, f64::max);
                let lattice = charge_clock_lattice(&every, tick_ms);
                let numbers = k.cards.numbers();
                let budget = numbers.wishful_budget(recharge);
                // A card-owned Wishful Thinking trim is a second producer of the same clocks: the source stores only
                // its window trace, so the untrimmed equations are replaced by that trace plus bounded necessary ones.
                let wishful = p.build.owns(crate::cards::CardId::WishfulThinking);
                let trimmed = has_spend && !p.card_trims.is_empty() && wishful;
                if trimmed {
                    let window_budget = numbers.wishful_budget(prior_max);
                    if !trim_trace_coherent(
                        p,
                        numbers,
                        window_budget,
                        w.server_time,
                        w.raid_started_at,
                        tick_ms,
                    ) {
                        return Err("incoherent card Wish trim trace".into());
                    }
                    if stocks.wish_ready_at > full_at
                        || (def.charges == 1 && stocks.wish_ready_at != full_at)
                    {
                        return Err("incoherent Wish charge clocks".into());
                    }
                } else if stocks.wish_ready_at > full_at
                    || (stocks.wish_ready_at != full_at
                        && (def.charges != 2
                            || stocks.wish_ready_at != (full_at - recharge).max(0.)))
                {
                    return Err("incoherent Wish charge clocks".into());
                }
                if has_spend && (full_at < initial || stocks.wish_ready_at < initial) {
                    return Err("Wish clocks precede opening lock".into());
                }
                if let Some(spend) = p.card_runtime.and_then(|c| c.wish_cast) {
                    let spent = if def.charges == 1 {
                        full_at == spend.at + recharge && stocks.wish_ready_at == full_at
                    } else {
                        // A charge was available at acceptance: the previous full clock lay at most one recharge
                        // ahead, the previous cast's, at most `prior_max`. The new interval follows spendCharge.
                        // The previous interval was the previous cast's cooldown, at least `prior_min`; the last
                        // bound replays one earlier cast and holds only when no cast had a shorter cooldown.
                        (spend.at + recharge..=spend.at + (prior_max + recharge)).contains(&full_at)
                            && stocks.wish_ready_at == (full_at - recharge).max(0.)
                            && full_at % lattice == 0.
                            && (full_at == spend.at + recharge
                                || (spend.at >= first_cast + tick_ms
                                    && full_at >= first_cast + prior_min + recharge
                                    && (prior_min < recharge
                                        || spend.at >= first_cast + recharge
                                        || full_at <= spend.at - tick_ms + (prior_max + recharge))))
                    };
                    // The card producer: a cut only lowers the untrimmed spend clock, never above it, and the
                    // per-window budget bounds how far (a necessary equation, not an exact replay of the cuts).
                    // Millisecond cuts (the legacy rule) keep the clocks on the tick lattice; a share rule's cuts are
                    // shares of the cooldown, off it.
                    let max_cut = max_trim_cut(numbers, budget, w.server_time - spend.at);
                    let on_lattice = share_rule(numbers)
                        || (full_at % lattice == 0. && stocks.wish_ready_at % tick_ms == 0.);
                    let trimmed_spend = trimmed
                        && (if def.charges == 1 {
                            full_at <= spend.at + recharge
                                && full_at >= spend.at + recharge - max_cut
                        } else {
                            (spend.at + recharge - max_cut..=spend.at + (prior_max + recharge))
                                .contains(&full_at)
                                && stocks.wish_ready_at + recharge >= full_at
                        })
                        && on_lattice;
                    let refunded = def.cast_ms > 0.
                        && stocks.wish_ready_at == full_at
                        && full_at <= spend.at
                        && prior_clock_any(
                            full_at,
                            initial,
                            first_cast,
                            spend.at,
                            &earlier,
                            wishful.then_some(numbers),
                            tick_ms,
                        )
                        && w.abilities
                            .as_ref()
                            .and_then(|a| a.teleported_at)
                            // Later teleports replace this source-global clock. It proves a
                            // subsequent teleport exists, not which teleport refunded the cast.
                            .is_some_and(|at| at >= spend.at);
                    if !spent && !refunded && !trimmed_spend {
                        return Err(
                            "Wish stock clocks lack a completed spend, teleport refund or card trim".into(),
                        );
                    }
                }
            }
        }
        if stocks.q_ready_at != 0. || stocks.e_ready_at != 0. {
            return Err("unequipped skill stock".into());
        }
    }
    for slot in 0..w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        let p = w.core(ix);
        let Some(c) = p.statuses.cast else {
            continue;
        };
        let Some(d) = c.producer else {
            if full {
                return Err("bare cast in full producer mode".into());
            }
            continue;
        };
        if !full || !w.is_player(ix) {
            return Err("Wish producer outside player full mode".into());
        }
        // The row this world cast (`definition_for`): under `frost_wish = Wall` Frost's Wish is the placed Frost Wall,
        // whose producer holds no unit target; the catalog's Freeze row would refuse it as forged provenance.
        let def = definition_for(&k.config, c.ability);
        let stocks = w.players[ix.slot()].stocks;
        if c.ability != wish(w.players[ix.slot()].faction())
            || d.slot != Slot::Wish
            || d.rank != 1
            || c.cancelled_by != CANCELLED_BY
            || c.lands_at != c.started_at + def.cast_ms
            || def.cast_ms == 0.
        {
            return Err("incoherent Wish producer definition".into());
        }
        if ![d.point.x, d.point.y]
            .into_iter()
            .all(crate::status_runtime::geometry_scalar_is_safe)
            || !(0. ..=crate::constants::WORLD_W).contains(&d.point.x)
            || !(0. ..=crate::constants::WORLD_H).contains(&d.point.y)
            || !(tick_ms..=crate::constants::MAX_REWIND_MS).contains(&d.lag_ms)
        {
            return Err("invalid Wish point or lag".into());
        }
        if matches!(def.target, Target::Unit(_)) != d.target.is_some()
            || d.target.is_some_and(|id| id == p.id || !w.known_actor(id))
        {
            return Err("invalid Wish target provenance".into());
        }
        // The cast's spend carries the cooldown it was accepted with; a grant while the cast is in flight changes
        // only the multiplier now, and the cast has not landed, so a holder's share is still the one it spent at
        // (`WishEnvelope`).
        let player = &w.players[ix.slot()];
        let envelope = WishEnvelope::of(k, player);
        let spend = player.card_runtime.and_then(|c| c.wish_cast).and_then(|s| {
            if s.at == c.started_at {
                envelope
                    .pair_of(k, s.cooldown_ms, false)
                    .map(|pair| (s, pair))
            } else {
                None
            }
        });
        let recharge = spend.map_or_else(
            || envelope.cd(k, no_spend().lever, 0),
            |(s, _)| s.cooldown_ms,
        );
        let earlier = envelope.earlier(k, spend.map_or_else(no_spend, |(_, pair)| pair));
        // Wishful Thinking may have cut the clock this cast replaced, and may cut this cast's clocks while it is in
        // flight (a hit landing before it does).
        let numbers = k.cards.numbers();
        let wishful = player.build.owns(crate::cards::CardId::WishfulThinking);
        if !d.previous_ready_at.is_finite()
            || d.previous_ready_at < 0.
            || d.previous_ready_at > c.started_at
            || d.previous_full_at != Some(d.previous_ready_at)
            || !prior_clock_any(
                d.previous_ready_at,
                initial,
                first_cast,
                c.started_at,
                &earlier,
                wishful.then_some(numbers),
                tick_ms,
            )
        {
            return Err("invalid Wish rollback clock".into());
        }
        let (full_at, ready_at) = spend_charge(
            if def.charges > 1 {
                d.previous_full_at.unwrap_or(0.)
            } else {
                0.
            },
            c.started_at,
            def.charges,
            recharge,
        );
        if spend.is_none() {
            return Err("cast lacks canonical card spend".into());
        }
        let spent = stocks.wish_full_at == Some(full_at) && stocks.wish_ready_at == ready_at;
        // The player loop above already bounded these trimmed clocks by the trace and the budget; here they only lie
        // within one in-flight window's cut under the spend's clocks.
        let trimmed = wishful
            && !player.card_trims.is_empty()
            && stocks.wish_full_at.is_some_and(|f| {
                let max_cut = max_trim_cut(
                    numbers,
                    numbers.wishful_budget(recharge),
                    w.server_time - c.started_at,
                );
                (full_at - max_cut..=full_at).contains(&f)
                    && (ready_at - max_cut..=ready_at).contains(&stocks.wish_ready_at)
                    && (if def.charges == 1 {
                        stocks.wish_ready_at == f
                    } else {
                        stocks.wish_ready_at <= f
                    })
            });
        if !spent && !trimmed {
            return Err("incoherent spent Wish clocks".into());
        }
        if w.phase != crate::Phase::Active
            || !w.standing(ix)
            || (c.lands_at <= w.server_time && !w.rt.voided)
        {
            return Err("Wish cast outside reachable completed-step phase".into());
        }
    }
    Ok(())
}

/// The actual player Blaze producer is the only admitted generic mob DoT in this slice.
pub(crate) fn blaze_dot(
    w: &crate::state::World,
    st: &crate::status_runtime::StatusInstance,
) -> bool {
    use crate::status_runtime as rt;
    let Some(owner) = st.source.id else {
        return false;
    };
    let Some((dps, tail)) = rt::rank_one_field_policy(AbilityId::Blaze).burn else {
        return false;
    };
    st.kind == rt::StatusKind::Dot
        && st.ability == Some(AbilityId::Blaze)
        && w.roster
            .label(owner)
            .is_some_and(|name| name == &st.source.name)
        && st.source.owner_id.is_none()
        && st.tag.is_none()
        && st.value == dps
        && st.until - st.started_at >= tail
        // Every real refresh sets until=now+tail and retains the original start.
        // Overlapping charges may keep refreshing beyond one trail's lifetime.
        && st.started_at <= w.server_time
        && st.until <= w.server_time + tail
        && w.player(owner).is_none_or(|p| p.faction() == crate::FactionId::Fire)
        && st.reveal_from.is_none()
        && st.taken.is_none()
        && st.data
            == rt::Payload {
                shares: Some(crate::content::DamageShares {
                    phys: 0.,
                    magic: 0.,
                    true_: 1.,
                }),
                ..Default::default()
            }
}

/// Blaze resets before the same tick's ordinary history append. The retained canonical spend
/// proves the reset timestamp; only the first pair can share a time. Ordinary movement
/// later in that tick can move its second position (the queued post-Cast Move source case).
pub(crate) fn blaze_history(k: &crate::statics::MatchStatic, p: &crate::state::Player) -> bool {
    let h = p.body.history.as_slice();
    k.config.abilities == Mode::Full
        && p.faction() == crate::FactionId::Fire
        && h.len() >= 2
        && h[0].t == h[1].t
        && p.card_runtime
            .and_then(|c| c.wish_cast)
            .is_some_and(|c| c.at == h[0].t)
}

#[cfg(test)]
mod wishful_in_flight_tests {
    //! A Wish with a cast time (Frost's Freeze) cast again after Wishful Thinking cut the clock it replaces, and cut
    //! again while it is in flight: the checkpoint taken during the flight restores and plays on equal, and the bounds
    //! still refuse clocks no cut could leave. Both rules, with and without an Arcane Overload grant between the casts.
    //! The hits are applied through `cards::wishful_thinking`, the mutation `after_damage` makes for a landed group.
    //! Also Fire's two-charge Blaze across a grant between its charges (the charge equations' previous interval).
    use crate::abilities::Slot;
    use crate::cards::CardId;
    use crate::input::{validate, RawCommand};
    use crate::map::TileMap;
    use crate::{Arena, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

    fn room() -> Arena {
        let (w, h) = (40usize, 24usize);
        let rows: Vec<String> = (0..h)
            .map(|y| {
                (0..w)
                    .map(|x| {
                        if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                            '#'
                        } else {
                            '.'
                        }
                    })
                    .collect()
            })
            .collect();
        let map = TileMap::from_rows(&rows).expect("room");
        let spawns = [
            (112., 112.),
            (400., 112.),
            (800., 112.),
            (112., 624.),
            (800., 624.),
        ]
        .iter()
        .map(|&(x, y)| Vec2::new(x, y))
        .collect();
        Arena { map, spawns }
    }

    fn world(augments: crate::AugmentRule, wisher: FactionId) -> Sim {
        let placements: Vec<Placement> = [(wisher, 300.), (FactionId::Fire, 632.)]
            .iter()
            .map(|&(faction, x)| Placement {
                profile: faction.as_str().into(),
                faction,
                bot: false,
                at: Vec2::new(x, 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect();
        let config = SimConfig {
            quests: false,
            pvp_rules: false,
            abilities: crate::abilities::Mode::Full,
            wish_lock_ms: 0.,
            augments,
            ..Default::default()
        };
        let secrets = Secrets {
            order_salt: 7,
            spawn_seed: 0,
            reward_salt: [1, 2, 3, 4],
        };
        let mut s = Sim::reset_active(config, room(), secrets, &placements);
        assert!(crate::cards::grant(
            &s.k,
            &mut s.w,
            PlayerId(1),
            CardId::WishfulThinking
        ));
        s
    }

    fn cast(s: &mut Sim) {
        let raw = RawCommand::Cast {
            slot: Slot::Wish,
            x: 632.,
            y: 320.,
            // Freeze targets the unit; Blaze is cast at the point.
            id: (s.w.players[0].faction() == FactionId::Frost).then_some(PlayerId(2)),
            t: None,
            seq: None,
        };
        s.submit(PlayerId(1), validate(raw).expect("valid"))
            .expect("accepted");
        s.step();
    }

    fn hits(s: &mut Sim, n: u32) {
        let now = s.w.server_time;
        let numbers = s.k.cards.numbers();
        let p = &mut s.w.players[0];
        let spend = p.card_runtime.and_then(|r| r.wish_cast);
        crate::cards::wishful_thinking(
            numbers,
            n,
            1000.,
            now,
            &mut p.stocks,
            spend,
            &mut p.card_trims,
        );
        s.step();
    }

    /// Cast, cut, (grant), cast again once ready, cut in flight: the state of the flight.
    fn flight(augments: crate::AugmentRule, overload: bool) -> Sim {
        let mut s = world(augments, FactionId::Frost);
        cast(&mut s);
        let first = s.w.players[0].card_runtime.unwrap().wish_cast.unwrap();
        if overload {
            assert!(crate::cards::grant(
                &s.k,
                &mut s.w,
                PlayerId(1),
                CardId::ArcaneOverload
            ));
        }
        for _ in 0..3 {
            hits(&mut s, 2);
        }
        while s.w.players[0].stocks.wish_ready_at > s.w.server_time {
            s.step();
        }
        cast(&mut s);
        let second = s.w.players[0].card_runtime.unwrap().wish_cast.unwrap();
        assert!(second.at > first.at, "cast again");
        assert!(
            second.at < first.at + first.cooldown_ms,
            "the replaced clock was cut"
        );
        hits(&mut s, 1);
        assert!(s.w.players[0].core.statuses.cast.is_some(), "in flight");
        assert!(
            s.w.players[0].stocks.wish_ready_at < second.at + second.cooldown_ms,
            "cut in flight"
        );
        s
    }

    #[test]
    fn a_trimmed_wish_cast_again_checkpoints_in_flight_and_plays_on() {
        for augments in [crate::AugmentRule::Legacy, crate::AugmentRule::Rework] {
            for overload in [false, true] {
                let at = format!("{augments:?} overload={overload}");
                let mut s = flight(augments, overload);
                let mut r = Sim::restore(serde_json::to_value(&s).unwrap())
                    .unwrap_or_else(|e| panic!("{at}: in-flight checkpoint refused: {e:?}"));
                assert_eq!(r.state_hash(), s.state_hash(), "{at}");
                for t in 0..8 {
                    s.step();
                    r.step();
                    assert_eq!(r.state_hash(), s.state_hash(), "{at}: tick {t}");
                }
            }
        }
    }

    /// Fire's two-charge Blaze: cast, Arcane Overload granted, the second charge cast a tick later. The new full clock
    /// is the first cast's (short) interval plus the second's (long) one, under the `first_cast + 2 * recharge` the
    /// uniform-cooldown equation asked for.
    #[test]
    fn a_second_charge_cast_after_a_grant_restores() {
        for augments in [crate::AugmentRule::Legacy, crate::AugmentRule::Rework] {
            let mut s = world(augments, FactionId::Fire);
            cast(&mut s);
            let first = s.w.players[0].card_runtime.unwrap().wish_cast.unwrap();
            assert!(crate::cards::grant(
                &s.k,
                &mut s.w,
                PlayerId(1),
                CardId::ArcaneOverload
            ));
            super::validate(&s.k, &s.w).expect("granted between the charges");
            cast(&mut s);
            let second = s.w.players[0].card_runtime.unwrap().wish_cast.unwrap();
            assert!(second.at > first.at && second.cooldown_ms > first.cooldown_ms);
            assert_eq!(
                s.w.players[0].stocks.wish_full_at,
                Some(first.at + first.cooldown_ms + second.cooldown_ms),
                "{augments:?}"
            );
            let mut r = Sim::restore(serde_json::to_value(&s).unwrap())
                .unwrap_or_else(|e| panic!("{augments:?}: refused: {e:?}"));
            for t in 0..8 {
                s.step();
                r.step();
                assert_eq!(r.state_hash(), s.state_hash(), "{augments:?}: tick {t}");
            }
        }
    }

    #[test]
    fn in_flight_bounds_still_refuse_clocks_no_cut_leaves() {
        for augments in [crate::AugmentRule::Legacy, crate::AugmentRule::Rework] {
            let s = flight(augments, false);
            super::validate(&s.k, &s.w).expect("the played state");
            let spend = s.w.players[0].card_runtime.unwrap().wish_cast.unwrap();
            let full_at = spend.at + spend.cooldown_ms;
            let mut forged = Vec::new();
            // Above the spend's clock: no cut lengthens it.
            let mut w = s.w.clone();
            w.players[0].stocks.wish_ready_at = full_at + 50.;
            w.players[0].stocks.wish_full_at = Some(full_at + 50.);
            forged.push(("above the spend", w));
            // Further under it than the budget allows.
            let mut w = s.w.clone();
            let deep = full_at - 2. * s.k.cards.numbers().wishful_budget(spend.cooldown_ms);
            w.players[0].stocks.wish_ready_at = deep;
            w.players[0].stocks.wish_full_at = Some(deep);
            forged.push(("past the budget", w));
            // A replaced clock under the floor of any earlier cast.
            let mut w = s.w.clone();
            let d = w.players[0]
                .core
                .statuses
                .cast
                .as_mut()
                .unwrap()
                .producer
                .as_mut()
                .unwrap();
            d.previous_ready_at = 1000.;
            d.previous_full_at = Some(1000.);
            forged.push(("replaced clock under the floor", w));
            // A spend cooldown no build reaches.
            let mut w = s.w.clone();
            w.players[0]
                .card_runtime
                .as_mut()
                .unwrap()
                .wish_cast
                .as_mut()
                .unwrap()
                .cooldown_ms += 50.;
            forged.push(("spend cooldown", w));
            for (what, w) in forged {
                assert!(super::validate(&s.k, &w).is_err(), "{augments:?}: {what}");
            }
        }
    }
}
