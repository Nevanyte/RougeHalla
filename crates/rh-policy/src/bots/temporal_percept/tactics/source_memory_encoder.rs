fn encode_memory(mem: &super::super::memory::Memory) -> SVal {
    use super::super::memory::{ContainersWeapon, MemoryView};
    let MemoryView {
        fighters,
        mobs,
        camps,
        containers,
        self_memory,
        stimuli,
        bounties,
        choices,
    } = mem.view();
    let fighters = source_reader::map(
        fighters
            .iter()
            .map(|(id, f)| {
                (
                    SVal::Str(id.clone()),
                    obj(vec![
                        ("id", source_reader::s(&f.id)),
                        ("name", source_reader::s(&f.name)),
                        ("bot", bool_sv(f.bot)),
                        (
                            "faction",
                            f.faction
                                .map(|v| source_reader::s(v.as_str()))
                                .unwrap_or(SVal::Null),
                        ),
                        (
                            "weaponsSeen",
                            source_reader::arr(
                                f.weapons_seen
                                    .iter()
                                    .map(|w| source_reader::s(w.as_str()))
                                    .collect(),
                            ),
                        ),
                        (
                            "inHand",
                            f.in_hand
                                .map(|w| source_reader::s(w.as_str()))
                                .unwrap_or(SVal::Null),
                        ),
                        (
                            "otherSlot",
                            f.other_slot
                                .map(|w| source_reader::s(w.as_str()))
                                .unwrap_or(SVal::Null),
                        ),
                        ("seenAt", num_sv(f.seen_at)),
                        ("pos", vec2_sv(f.pos)),
                        ("vel", vec2_sv(f.vel)),
                        ("hpFrac", num_sv(f.hp_frac)),
                        ("bounty", num_sv(f.bounty)),
                        ("alive", bool_sv(f.alive)),
                        ("diedAt", f.died_at.map(num_sv).unwrap_or(SVal::Null)),
                        ("hitMeAt", f.hit_me_at.map(num_sv).unwrap_or(SVal::Null)),
                        (
                            "hitByMeAt",
                            f.hit_by_me_at.map(num_sv).unwrap_or(SVal::Null),
                        ),
                        ("damageToMe", num_sv(f.damage_to_me)),
                        ("damageByMe", num_sv(f.damage_by_me)),
                        (
                            "engagedWith",
                            f.engaged_with
                                .as_deref()
                                .map(source_reader::s)
                                .unwrap_or(SVal::Null),
                        ),
                        ("engagedAt", f.engaged_at.map(num_sv).unwrap_or(SVal::Null)),
                        ("chasingMe", bool_sv(f.chasing_me)),
                        (
                            "wishSeenAt",
                            f.wish_seen_at.map(num_sv).unwrap_or(SVal::Null),
                        ),
                        (
                            "wishReadyGuess",
                            f.wish_ready_guess.map(num_sv).unwrap_or(SVal::Null),
                        ),
                        ("feints", num_sv(f.feints as f64)),
                        (
                            "lastFeintAt",
                            f.last_feint_at.map(num_sv).unwrap_or(SVal::Null),
                        ),
                    ]),
                )
            })
            .collect(),
    );
    let mobs = source_reader::map(
        mobs.iter()
            .map(|(id, m)| {
                let mut fields = vec![
                    ("id", source_reader::s(&m.id)),
                    ("kind", source_reader::s(&m.kind)),
                    (
                        "faction",
                        m.faction
                            .map(|v| source_reader::s(v.as_str()))
                            .unwrap_or(SVal::Null),
                    ),
                ];
                if let Some(name) = &m.name {
                    fields.push(("name", source_reader::s(name)));
                }
                fields.extend([
                    ("home", m.home.map(vec2_sv).unwrap_or(SVal::Null)),
                    (
                        "campId",
                        m.camp_id
                            .as_deref()
                            .map(source_reader::s)
                            .unwrap_or(SVal::Null),
                    ),
                    ("pos", vec2_sv(m.pos)),
                    ("dotAt", num_sv(m.dot_at)),
                    ("seenAt", m.seen_at.map(num_sv).unwrap_or(SVal::Null)),
                    ("hpFrac", num_sv(m.hp_frac)),
                    (
                        "inHand",
                        m.in_hand
                            .map(|w| source_reader::s(w.as_str()))
                            .unwrap_or(SVal::Null),
                    ),
                    ("awake", bool_sv(m.awake)),
                    ("returning", bool_sv(m.returning)),
                    ("alive", bool_sv(m.alive)),
                ]);
                if let Some(ty) = &m.type_ {
                    fields.push(("type", source_reader::s(ty)));
                }
                (SVal::Str(id.clone()), obj(fields))
            })
            .collect(),
    );
    let camps = source_reader::map(
        camps
            .iter()
            .map(|(id, c)| {
                (
                    SVal::Str(id.clone()),
                    obj(vec![
                        ("id", source_reader::s(&c.id)),
                        ("zone", source_reader::s(c.zone.as_str())),
                        ("elite", bool_sv(c.elite)),
                        ("aliveSeen", num_sv(f64::from(c.alive_seen))),
                        ("clearedAt", c.cleared_at.map(num_sv).unwrap_or(SVal::Null)),
                        (
                            "contestedAt",
                            c.contested_at.map(num_sv).unwrap_or(SVal::Null),
                        ),
                        ("visitedAt", c.visited_at.map(num_sv).unwrap_or(SVal::Null)),
                    ]),
                )
            })
            .collect(),
    );
    let containers = source_reader::map(
        containers
            .iter()
            .map(|(id, c)| {
                (
                    SVal::Str(id.clone()),
                    obj(vec![
                        ("id", source_reader::s(&c.id)),
                        ("kind", source_reader::s(&c.kind)),
                        ("pos", vec2_sv(c.pos)),
                        ("closed", bool_sv(c.closed)),
                        (
                            "weapon",
                            match c.weapon {
                                ContainersWeapon::Undefined => SVal::Undefined,
                                ContainersWeapon::Null => SVal::Null,
                                ContainersWeapon::Weapon(w) => source_reader::s(w.as_str()),
                            },
                        ),
                        ("seenAt", num_sv(c.seen_at)),
                        ("skipped", bool_sv(c.skipped)),
                    ]),
                )
            })
            .collect(),
    );
    let recent_hits = source_reader::arr(
        self_memory
            .recent_hits
            .iter()
            .map(|h| {
                obj(vec![
                    ("t", num_sv(h.t)),
                    (
                        "by",
                        h.by.as_deref().map(source_reader::s).unwrap_or(SVal::Null),
                    ),
                    ("amount", num_sv(h.amount)),
                ])
            })
            .collect(),
    );
    let self_sv = obj(vec![
        (
            "lastHitAt",
            self_memory.last_hit_at.map(num_sv).unwrap_or(SVal::Null),
        ),
        (
            "lastHitByPlayerAt",
            self_memory
                .last_hit_by_player_at
                .map(num_sv)
                .unwrap_or(SVal::Null),
        ),
        (
            "lastDealtAt",
            self_memory.last_dealt_at.map(num_sv).unwrap_or(SVal::Null),
        ),
        ("recentDamage", num_sv(self_memory.recent_damage)),
        ("recentHits", recent_hits),
        (
            "teleportedAt",
            self_memory.teleported_at.map(num_sv).unwrap_or(SVal::Null),
        ),
        (
            "lastOrder",
            self_memory
                .last_order
                .as_ref()
                .map(memory_timed_sv)
                .unwrap_or(SVal::Null),
        ),
        (
            "lastCast",
            self_memory
                .last_cast
                .as_ref()
                .map(memory_timed_sv)
                .unwrap_or(SVal::Null),
        ),
        ("stillSince", num_sv(self_memory.still_since)),
    ]);
    obj(vec![
        ("fighters", fighters),
        ("mobs", mobs),
        ("camps", camps),
        ("containers", containers),
        ("self", self_sv),
        (
            "stimuli",
            source_reader::arr(stimuli.iter().map(encode_stimulus).collect()),
        ),
        (
            "bounties",
            source_reader::map(
                bounties
                    .iter()
                    .map(|(id, v)| (SVal::Str(id.clone()), num_sv(*v)))
                    .collect(),
            ),
        ),
        (
            "choices",
            source_reader::arr(choices.iter().map(|c| source_reader::s(c)).collect()),
        ),
    ])
}

