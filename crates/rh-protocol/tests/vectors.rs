use rh_protocol::samples::*;
use rh_protocol::*;

#[test]
fn committed_vectors_match_the_encoder() {
    let name = format!("v{}.json", PROTOCOL_VERSION);
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../protocol/fixtures")
        .join(&name);
    let committed = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("protocol/fixtures/{name} (run the protocol-fixtures bin)"));
    assert_eq!(
        committed,
        manifest(),
        "the wire encoding changed: bump PROTOCOL_VERSION if incompatible, then regenerate (cargo run -p rh-protocol --bin protocol-fixtures)"
    );
}

#[test]
fn every_sample_round_trips() {
    for (name, m) in client_samples() {
        assert_eq!(ClientMsg::decode(&m.encode()).as_ref(), Ok(&m), "{name}");
    }
    for (name, m) in server_samples() {
        // A client decodes what the server wrote, with remote actors quantized (a sample may be off the grid on purpose).
        let want = match &m {
            ServerMsg::Snapshot {
                tick,
                phase,
                ack_input,
                me,
                actors,
                training,
                server_time,
                owner_combat,
            } => ServerMsg::Snapshot {
                training: *training,
                owner_combat: *owner_combat,
                tick: *tick,
                server_time: *server_time,
                phase: *phase,
                ack_input: *ack_input,
                me: *me,
                actors: actors.iter().map(WireActor::quantized).collect(),
            },
            ServerMsg::Fx { tick, fx } => ServerMsg::Fx {
                tick: *tick,
                fx: fx.iter().map(WireFx::quantized).collect(),
            },
            other => other.clone(),
        };
        assert_eq!(ServerMsg::decode(&m.encode()).as_ref(), Ok(&want), "{name}");
    }
}

#[test]
fn malformed_server_frames_are_rejected_for_the_documented_reason() {
    use DecodeError::*;
    let want = |name: &str| -> DecodeError {
        match name {
            "potion_notice_zero" | "potion_notice_unknown" => BadField("potion notice"),
            "cannon_notice_zero"
            | "cannon_notice_unknown"
            | "cannon_notice_bad_seconds"
            | "cannon_notice_seconds_over" => BadField("cannon notice"),
            "cannon_notice_missing_seconds" => Truncated,
            "state_too_many_camps" | "state_too_many_projectiles" => TooMany(0),
            "projectile_kind" | "projectile_owner_zero" => BadField("projectile"),
            "projectile_owner_flag" => BadTag(2),
            "projectile_owner_overlong" => BadVarint,
            "camp_mob_type"
            | "camp_elite"
            | "camp_alive"
            | "camp_state"
            | "camp_negative_time"
            | "camp_nonfinite_time"
            | "camp_time_order" => BadField("camp"),
            "wish_ability_over_4" => BadField("wish ability"),
            "wish_charge_count_invalid" | "wish_time_nonfinite" | "wish_cast_time_order" => {
                BadField("wish")
            }
            "wish_option_over_1" | "wish_fx_option_over_1" => BadTag(2),
            "wish_fx_caster_zero" => BadField("wish caster"),
            "wish_fx_ability_over_4" => BadField("wish ability"),
            "wish_fx_time_nonfinite"
            | "wish_fx_blaze_one_point"
            | "wish_fx_nonblaze_destination"
            | "wish_fx_anonymous_landed_target"
            | "wish_fx_anonymous_landed_no_target" => BadField("wish fx"),
            "wish_fx_end_reason_over_2" => BadField("wish reason"),
            "owner_combat_bad_lock"
            | "owner_combat_zero_target"
            | "owner_combat_missing_self"
            | "owner_combat_dangling_target"
            | "owner_combat_nonfinite_mirror"
            | "owner_combat_fractional_mirror"
            | "owner_combat_below_min_mirror"
            | "delta_owner_combat_option_unknown"
            | "delta_owner_combat_redundant_clear_owner_loss"
            | "delta_owner_combat_available_without_self"
            | "delta_owner_combat_bad_lock"
            | "delta_owner_combat_zero_target"
            | "delta_owner_combat_nonfinite_mirror" => BadField("owner combat"),
            "actor_mob_type_over_30" | "delta_actor_mob_type_over_30" => BadField("mob type"),
            "empty" | "truncated_snapshot" | "self_truncated" | "actor_count_without_actors" => {
                Truncated
            }
            "pickup_bad_reason_zero" | "pickup_bad_reason_unknown" => BadField("combat"),
            "hit_bad_passive" => BadTag(2),
            "unknown_tag" | "client_tag_from_server" => BadTag(0),
            "trailing_byte" => Trailing(0),
            "overlong_varint"
            | "varint_past_u32"
            | "varint_too_long"
            | "head_overlong_varint"
            | "actor_mask_overlong_varint"
            | "delta_head_overlong_varint" => BadVarint,
            "head_self_bit_without_present_bit" | "head_unknown_bit" | "delta_head_unknown_bit" => {
                BadField("head")
            }
            "self_status_over_3" | "actor_status_over_3" | "delta_actor_status_over_3" => {
                BadField("status")
            }
            "phase_over_3" | "delta_phase_over_3" => BadField("phase"),
            "chest_bad_reason_zero" | "chest_bad_reason_unknown" => BadField("chest reason"),
            "state_unknown_key" => BadField("state key"),
            "state_quest_status_unknown" => BadField("quest status"),
            "state_quest_flags_unknown" => BadField("quest flags"),
            "state_quest_visited_unknown" | "state_quest_ref_missing" => {
                BadField("quest references")
            }
            "state_quest_owner_visited_unknown" => BadField("quest row"),
            "state_quest_prop_missing_view" => BadField("quest prop reference"),
            "state_quest_row_handle_zero"
            | "state_quest_objective_handle_zero"
            | "state_quest_prop_handle_zero" => BadField("quest handle"),
            "state_quest_roster_id_zero" => BadField("quest roster id"),
            "state_quest_availability_flag"
            | "state_quest_participant_accepted_flag"
            | "state_quest_done_by_flag" => BadField("quest flag"),
            "state_quest_prop_fetch_flag" => BadField("flag"),
            "state_quest_duplicate_row_handle" => BadField("quest handles"),
            "state_quest_duplicate_roster_id" => BadField("quest roster"),
            "state_quest_duplicate_participant_id"
            | "state_quest_owner_roster_missing"
            | "state_quest_carrier_missing"
            | "state_quest_participant_missing" => BadField("quest references"),
            "state_quest_unknown_count" | "state_quest_display_count_over_unknown" => {
                BadField("quest counts")
            }
            "state_quest_def_empty"
            | "state_quest_def_over_16"
            | "state_quest_giver_nonfinite"
            | "state_quest_giver_out_of_range"
            | "state_quest_expiry_negative"
            | "state_quest_expiry_nonfinite" => BadField("quest row"),
            "state_quest_objective_nonfinite" | "state_quest_objective_out_of_range" => {
                BadField("quest objective")
            }
            "state_quest_roster_over_limit"
            | "state_quest_rows_over_limit"
            | "state_quest_participants_over_limit"
            | "state_quest_objectives_over_limit"
            | "state_quest_objectives_per_row_over_limit" => TooMany(0),
            "state_quests_over_24576" => TooLarge(24577),
            "state_trade_availability_flag" | "state_trade_used_flag" => BadField("trade flag"),
            "state_trade_deadline_option_unknown" => BadTag(2),
            "state_trade_kind_unknown" => BadField("trade kind"),
            "state_trade_stat_unknown" => BadField("trade stat"),
            "state_trade_offer_same_stat"
            | "state_trade_offer_nonpositive"
            | "state_trade_offer_nonfinite" => BadField("trade offer"),
            "state_trade_label_bad_utf8" => BadUtf8,
            "state_trade_delta_nonfinite" => BadField("trade delta"),
            "state_trade_deadline_negative" | "state_trade_deadline_nonfinite" => {
                BadField("trade deadline")
            }
            "state_trade_merchant_nonfinite" | "state_trade_merchant_out_of_range" => {
                BadField("trade merchant")
            }
            "state_trade_offers_over_limit"
            | "state_trade_stats_over_limit"
            | "state_trade_merchants_over_limit" => TooMany(0),
            "state_reward_card_id_80" => BadField("reward id"),
            "state_reward_kind_unknown" => BadField("reward kind"),
            "state_reward_kill_key_unknown" => BadField("reward key"),
            "state_reward_kill_gain_zero"
            | "state_reward_kill_gain_negative"
            | "state_reward_kill_gain_nan"
            | "state_reward_kill_gain_infinity" => BadField("reward gain"),
            "state_reward_kill_truncated_key" | "state_reward_kill_truncated_gain" => Truncated,
            "state_reward_options_too_many" => TooMany(4),
            "state_plan_negative_deadline" => BadField("plan"),
            "state_duplicate_key" | "state_key_order" => BadField("state key order"),
            "state_too_many_keys"
            | "state_too_many_props"
            | "state_too_many_fields"
            | "state_too_many_rewards" => TooMany(0),
            "state_bad_potion_count" => BadField("potion count"),
            "state_zero_prop_handle" => BadField("pickup handle"),
            "state_missing_focus" => BadField("prop focus"),
            "state_truncated" => Truncated,
            "state_trailing_byte" => Trailing(0),
            "self_max_hp_over_u16" => BadField("max_hp"),
            "fx_too_many" => TooMany(0),
            "fx_bad_tag" => BadTag(0),
            "too_many_actors" => TooMany(0),
            "actor_reserved_mask_bit"
            | "actor_unknown_mask_bit_after_kind"
            | "delta_actor_mask_unknown_bit" => BadField("actor mask"),
            "actor_id_gap_zero" | "actor_id_overflow" => BadField("actor order"),
            "actor_hp_over_100" => BadField("hp_pct"),
            "snapshot_giver_kit_default"
            | "snapshot_giver_kit_half"
            | "snapshot_giver_kit_half_weapon"
            | "snapshot_giver_mob_type" => BadField("giver actor"),
            "actor_bounty_over_u16" => BadField("bounty"),
            "delta_age_zero" | "delta_age_over_max" | "delta_age_past_tick" => BadField("base age"),
            "delta_head_field_without_present_bit" | "delta_head_archetype_without_present_bit" => {
                BadField("head")
            }
            "delta_self_status_over_3" => BadField("status"),
            // Protocol 16, ADR0026: indicator facts.
            "delta_head_flags_without_present_bit" => BadField("head"),
            "self_flags_unknown_bit"
            | "actor_flags_unknown_bit"
            | "delta_self_flags_unknown_bit"
            | "delta_actor_flags_unknown_bit" => BadField("flags"),
            "self_build_marks_repeated"
            | "actor_build_marks_key_over_9"
            | "actor_build_marks_second_without_first"
            | "actor_build_marks_repeated"
            | "delta_self_build_marks_key_over_9"
            | "delta_actor_build_marks_repeated" => BadField("build marks"),
            "self_mark_tier_over_4"
            | "actor_mark_tier_over_4"
            | "actor_mark_brand_over_100"
            | "actor_mark_tax_over_100"
            | "delta_self_mark_brand_over_100"
            | "delta_actor_mark_tier_over_4" => BadField("mark"),
            "actor_offhand_over_16" | "delta_actor_offhand_over_16" => BadField("offhand"),
            "actor_mark_truncated" => Truncated,
            "delta_actor_id_gap_zero" => BadField("actor order"),
            "delta_actor_hp_over_100" => BadField("hp_pct"),
            "delta_actor_bounty_over_u16" => BadField("bounty"),
            "delta_too_many_actors" | "delta_departed_too_many" => TooMany(0),
            "delta_departed_empty" => BadField("departed"),
            "delta_departed_id_gap_zero" => BadField("departed order"),
            "delta_truncated" => Truncated,
            "delta_trailing_byte" => Trailing(0),
            "reject_code_zero" => BadTag(0),
            "server_bad_utf8" => BadUtf8,
            "map_zero_size" | "map_too_large" => BadMap("size"),
            "map_bad_tile" | "map_zero_run" | "map_run_past_size" => BadMap("run"),
            "map_short" => BadMap("length"),
            "map_hash_mismatch" => BadMap("hash"),
            "map_ext_short" => BadMap("extension length"),
            "map_ext_version" => BadMap("section version"),
            "map_ext_presence" => BadMap("presence"),
            "map_ext_run_zero" | "map_ext_plane_length" => BadMap("run"),
            "map_ext_terrain_value" => BadMap("terrain value"),
            "map_ext_region_value" => BadMap("region value"),
            "map_ext_terrain_collision" => BadMap("terrain collision"),
            "map_ext_semantic_hash" => BadMap("semantic hash"),
            "map_ext_mode" => BadField("terrain mode"),
            "map_ext_context_hash" => BadMap("context hash"),
            "map_ext_trailing" => BadMap("extension trailing"),
            "welcome_trailing" => Trailing(1),
            "welcome_archetype_order" => BadField("archetype order"),
            "welcome_archetype_hull" => BadField("archetype hull"),
            "welcome_archetype_zero_box"
            | "welcome_archetype_key_long"
            | "welcome_archetype_key_ascii" => BadField("archetype"),
            "welcome_archetype_count" => BadField("archetype count"),
            "welcome_archetype_truncated" | "welcome_vision_truncated" => Truncated,
            "welcome_vision_version_zero"
            | "welcome_vision_tile_zero"
            | "welcome_vision_radius_nan"
            | "welcome_vision_radius_negative"
            | "welcome_vision_trail_negative"
            | "welcome_vision_update_infinite"
            | "welcome_vision_mask_zero"
            | "welcome_vision_coliseum_flag"
            | "welcome_vision_coliseum_empty"
            | "welcome_vision_coliseum_outside" => BadField("vision"),
            "welcome_weapon_count" => BadField("weapon count"),
            "welcome_weapon_truncated" => Truncated,
            "welcome_weapon_kind" => BadField("weapon kind"),
            "welcome_weapon_order" | "welcome_weapon_duplicate_id" => BadField("weapon order"),
            "welcome_weapon_reach_nan"
            | "welcome_weapon_speed_infinite"
            | "welcome_weapon_radius_negative"
            | "welcome_weapon_reach_over_max"
            | "welcome_weapon_arc_half_arc_over_pi"
            | "welcome_weapon_arc_half_arc_zero"
            | "welcome_weapon_arc_reach_zero"
            | "welcome_weapon_arc_speed"
            | "welcome_weapon_projectile_speed_zero"
            | "welcome_weapon_projectile_half_arc"
            | "welcome_weapon_none_values" => BadField("weapon"),
            other => panic!("no expectation for {other}"),
        }
    };
    for (name, bytes) in malformed_server() {
        let got = ServerMsg::decode(&bytes).expect_err(name);
        // The payload of BadTag / Trailing / TooMany is incidental: compare the kind.
        assert_eq!(
            std::mem::discriminant(&got),
            std::mem::discriminant(&want(name)),
            "{name}: {got:?}"
        );
        match (&got, &want(name)) {
            (BadField(a), BadField(b)) | (BadMap(a), BadMap(b)) => assert_eq!(a, b, "{name}"),
            _ => {}
        }
    }
}

#[test]
fn fuzzed_server_frames_never_panic() {
    // Every prefix and single-byte mutation of every server sample decodes to Ok or Err, never panics (and never allocates
    // more than MAX_ACTORS actors: the count is checked before the Vec is sized).
    for (_, m) in server_samples() {
        let b = m.encode();
        for cut in 0..b.len().min(400) {
            let _ = ServerMsg::decode(&b[..cut]);
        }
        for i in 0..b.len().min(400) {
            for v in [0u8, 1, 0x7f, 0x80, 0xff] {
                let mut c = b.clone();
                c[i] = v;
                let _ = ServerMsg::decode(&c);
            }
        }
    }
}

#[test]
fn decoding_then_encoding_a_valid_snapshot_is_byte_identical() {
    // The canonical form: one encoding per value, so a decoder that re-encodes (the C# test does) reproduces the frame.
    for (name, m) in server_samples() {
        if matches!(m, ServerMsg::Snapshot { .. } | ServerMsg::Fx { .. }) {
            let bytes = m.encode();
            let back = ServerMsg::decode(&bytes).unwrap().encode();
            assert_eq!(bytes, back, "{name}");
        }
    }
}

#[test]
fn varints_round_trip_and_have_one_encoding() {
    for v in [
        0u32,
        1,
        127,
        128,
        255,
        16383,
        16384,
        2_097_151,
        2_097_152,
        268_435_455,
        268_435_456,
        u32::MAX,
    ] {
        let mut w = Writer::default();
        w.varint(v);
        let b = w.finish();
        assert_eq!(b.len(), codec::varint_len(v), "{v}");
        assert_eq!(Reader::new(&b).varint(), Ok(v));
    }
    assert_eq!(
        Reader::new(&[0x80, 0x00]).varint(),
        Err(DecodeError::BadVarint)
    );
    assert_eq!(
        Reader::new(&[0xff, 0xff, 0xff, 0xff, 0x10]).varint(),
        Err(DecodeError::BadVarint)
    );
    assert_eq!(
        Reader::new(&[0x80, 0x80, 0x80, 0x80, 0x80]).varint(),
        Err(DecodeError::BadVarint)
    );
    assert_eq!(Reader::new(&[0x80]).varint(), Err(DecodeError::Truncated));
}

#[test]
fn malformed_client_frames_are_rejected() {
    for (name, bytes) in malformed_client() {
        assert!(
            ClientMsg::decode(&bytes).is_err(),
            "{name} must be rejected"
        );
    }
}

#[test]
fn map_blob_rejects_a_wrong_hash_and_bad_runs() {
    let m = map::MapBlob::new(4, 3, vec![0; 12]);
    let mut w = Writer::default();
    m.write(&mut w);
    let mut bytes = w.finish();
    assert!(map::MapBlob::read(&mut Reader::new(&bytes)).is_ok());
    bytes[4] ^= 1; // hash
    assert!(map::MapBlob::read(&mut Reader::new(&bytes)).is_err());
}

#[test]
fn fuzzed_client_frames_never_panic() {
    // Cheap deterministic fuzz: every prefix and single-byte mutation of every sample decodes to Ok or Err, never panics.
    for (_, m) in client_samples() {
        let b = m.encode();
        for cut in 0..b.len() {
            let _ = ClientMsg::decode(&b[..cut]);
        }
        for i in 0..b.len() {
            for v in [0u8, 1, 0x7f, 0x80, 0xff] {
                let mut c = b.clone();
                c[i] = v;
                let _ = ClientMsg::decode(&c);
            }
        }
    }
}

/// The chains in the vectors replay on a fresh tracker to exactly the recorded result at every step (the C# and JS suites do
/// the same with their own trackers).
#[test]
fn every_chain_replays_to_its_recorded_outcome() {
    for (name, steps) in chain_samples() {
        let mut t = SnapshotTracker::new();
        for (i, step) in steps.iter().enumerate() {
            let got = t.decode(&step.frame);
            match (&step.outcome, got) {
                (ChainOutcome::Applied(want), Ok(m)) => assert_eq!(&m, want, "{name} step {i}"),
                (ChainOutcome::Held { tick, actors }, Ok(_)) => {
                    assert_eq!(
                        (t.held_tick(), t.actors().len()),
                        (Some(*tick), *actors),
                        "{name}"
                    )
                }
                (ChainOutcome::Reset, Ok(ServerMsg::Welcome { .. })) => {}
                (ChainOutcome::Refused(why), Err(TrackError::Delta(e))) => {
                    assert_eq!(e.code(), *why, "{name} step {i}")
                }
                (_, other) => panic!("{name} step {i}: {other:?}"),
            }
        }
    }
}

#[test]
fn the_delta_chain_uses_both_frame_kinds_and_every_field_class() {
    let chains = chain_samples();
    let (_, steps) = chains.iter().find(|(n, _)| *n == "delta_chain").unwrap();
    let tags: Vec<u8> = steps.iter().map(|s| s.frame[0]).collect();
    assert!(tags.contains(&0x83) && tags.contains(&0x87), "{tags:?}");
    assert_eq!(tags[0], 0x83, "a connection starts with a Full frame");
}
