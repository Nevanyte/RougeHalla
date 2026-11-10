//! The encoder paths (encode, try_encode, encode_into, encode_welcome) all write the golden-vector bytes,
//! size every frame exactly, and refuse instead of repair any frame a decoder would reject.
use rh_protocol::map::{EncodedMap, MapBlob};
use rh_protocol::quant::POS_MAX;
use rh_protocol::samples::*;
use rh_protocol::*;

fn actor(i: u32) -> WireActor {
    WireActor {
        archetype: Default::default(),
        sig: 0,
        mob_type_code: 0,
        effects: 0,
        displace_seq: 0,
        id: i * 3 + 1,
        faction: (i % 5) as u8,
        x: 100.25 + i as f32,
        y: 7.5 * i as f32,
        facing: (i as f32 * 0.37).sin(),
        hp_pct: (i % 101) as u8,
        status: (i % 4) as u8,
        weapon: (i % 7) as u8,
        bounty: (i * 977) as u16,
        kind: (i % 3) as u8,
        barrier_pct: 0,
        barrier_ring_step: 0,
        ..Default::default()
    }
}

fn me() -> WireSelf {
    WireSelf {
        archetype: Default::default(),
        sig: 0,
        effects: 0,
        displace_seq: 0,
        id: 3,
        faction: 4,
        x: 400.0,
        y: 320.5,
        facing: 1.5,
        hp: 1000.25,
        max_hp: 1145.0,
        status: 1,
        weapon: 5,
        ready_in_ms: 250,
        kills: 2,
        bounty: 0,
        gv: 20,
        move_seq: 7,
        hunt_target: None,
        hunt_stacks: 0,
        wish: None,
        barrier: 0.0,
        barrier_ring_step: 0,
        ..Default::default()
    }
}

fn snapshot(me: Option<WireSelf>, n: u32) -> ServerMsg {
    ServerMsg::Snapshot {
        training: false,
        owner_combat: None,
        tick: 101,
        server_time: snapshot_server_ms(101),
        phase: 1,
        ack_input: 42,
        me,
        actors: (0..n).map(actor).collect(),
    }
}

/// What a client decodes: remote actors quantized, everything else as sent.
fn decoded_form(m: &ServerMsg) -> ServerMsg {
    match m {
        ServerMsg::Snapshot {
            tick,
            server_time,
            phase,
            ack_input,
            me,
            actors,

            training: _,
            owner_combat,
        } => ServerMsg::Snapshot {
            training: false,
            owner_combat: *owner_combat,
            tick: *tick,
            phase: *phase,
            ack_input: *ack_input,
            me: *me,
            actors: actors.iter().map(WireActor::quantized).collect(),
            server_time: *server_time,
        },
        other => other.clone(),
    }
}

/// The Full frame the server's writer produces for a Snapshot message (`SnapshotData::build` then `encode_full_into`): the
/// production path of a Snapshot, with its refusals.
fn full_frame(out: &mut Vec<u8>, m: &ServerMsg) -> Result<usize, EncodeError> {
    let ServerMsg::Snapshot {
        tick,
        phase,
        ack_input,
        me,
        actors,
        training,
        server_time,
        owner_combat,
    } = m
    else {
        panic!("not a snapshot")
    };
    let mut snap = SnapshotData::build_with_server_time(
        *tick,
        *server_time,
        *phase,
        *ack_input,
        *me,
        actors.iter().copied(),
    )?;
    snap.set_training(*training);
    snap.set_owner_combat(*owner_combat)?;
    Ok(snap.encode_full_into(out))
}

#[test]
fn encoded_len_is_exact_and_encode_allocates_exactly_that() {
    for (name, m) in client_samples() {
        let b = m.encode();
        assert_eq!(b.len(), m.encoded_len(), "{name}");
        assert_eq!(b.capacity(), b.len(), "{name}: one exact allocation");
    }
    for (name, m) in server_samples() {
        let b = m.encode();
        assert_eq!(b.len(), m.encoded_len(), "{name}");
        assert_eq!(b.capacity(), b.len(), "{name}: one exact allocation");
    }
    for n in [0, 1, 14, 68, MAX_ACTORS as u32] {
        for m in [snapshot(None, n), snapshot(Some(me()), n)] {
            let b = m.encode();
            assert_eq!(b.len(), m.encoded_len());
            assert_eq!(b.capacity(), b.len());
        }
    }
}

#[test]
fn every_path_writes_the_same_bytes() {
    let prefix = [0xAAu8, 0xBB, 0xCC];
    for (name, m) in client_samples() {
        let want = m.encode();
        assert_eq!(m.try_encode().as_ref(), Ok(&want), "{name}");
        let mut out = prefix.to_vec();
        assert_eq!(m.encode_into(&mut out), Ok(want.len()), "{name}");
        assert_eq!(&out[..3], &prefix);
        assert_eq!(&out[3..], &want[..], "{name}");
    }
    for (name, m) in server_samples() {
        let want = m.encode();
        assert_eq!(m.try_encode().as_ref(), Ok(&want), "{name}");
        let mut out = prefix.to_vec();
        assert_eq!(m.encode_into(&mut out), Ok(want.len()), "{name}");
        assert_eq!(&out[..3], &prefix);
        assert_eq!(&out[3..], &want[..], "{name}");
        if matches!(m, ServerMsg::Snapshot { .. }) {
            let mut out = prefix.to_vec();
            assert_eq!(full_frame(&mut out, &m), Ok(want.len()), "{name}");
            assert_eq!(&out[3..], &want[..], "{name}: SnapshotData full frame");
        }
    }
}

#[test]
fn a_reused_buffer_stops_allocating() {
    let m = snapshot(Some(me()), 14);
    let mut buf = Vec::new();
    m.encode_into(&mut buf).unwrap();
    let (ptr, cap) = (buf.as_ptr(), buf.capacity());
    for _ in 0..100 {
        buf.clear();
        m.encode_into(&mut buf).unwrap();
        buf.clear();
        full_frame(&mut buf, &m).unwrap();
    }
    assert_eq!((buf.as_ptr(), buf.capacity()), (ptr, cap));
    assert_eq!(buf, m.encode());
}

#[test]
fn max_actors_encodes_and_one_more_is_refused_not_clamped() {
    let ok = snapshot(Some(me()), MAX_ACTORS as u32);
    let bytes = ok.try_encode().expect("512 actors is a legal frame");
    assert_eq!(ServerMsg::decode(&bytes), Ok(decoded_form(&ok)));

    let over = snapshot(Some(me()), MAX_ACTORS as u32 + 1);
    let err = EncodeError::TooMany {
        what: "actors",
        n: MAX_ACTORS + 1,
        max: MAX_ACTORS,
    };
    assert_eq!(over.try_encode(), Err(err.clone()));
    let mut out = vec![1, 2, 3];
    assert_eq!(over.encode_into(&mut out), Err(err.clone()));
    assert_eq!(
        out,
        [1, 2, 3],
        "a refused frame leaves the buffer untouched"
    );
    assert_eq!(full_frame(&mut out, &over), Err(err));
    assert_eq!(out, [1, 2, 3], "a refused snapshot writes nothing");
    // What every decoder does with the frame the encoder refuses to write (hand-built: 513 minimal actors).
    let mut w = Writer::default();
    w.u8(0x83);
    w.varint(1);
    w.varint(0);
    w.varint(0);
    w.varint(MAX_ACTORS as u32 + 1);
    for _ in 0..=MAX_ACTORS {
        w.varint(1);
        w.bytes(&[0; 7]);
    }
    assert_eq!(
        ServerMsg::decode(&w.finish()),
        Err(DecodeError::TooMany(MAX_ACTORS + 1))
    );
}

#[cfg(debug_assertions)]
#[test]
#[should_panic(expected = "every decoder rejects")]
fn encode_debug_asserts_on_too_many_actors() {
    let _ = snapshot(None, MAX_ACTORS as u32 + 1).encode();
}

#[test]
fn other_lists_and_sizes_decoders_reject_are_refused() {
    let input = ClientMsg::Input {
        seq: 1,
        commands: vec![WireCommand::Aim { a: 0.0 }; MAX_COMMANDS_PER_INPUT + 1],
    };
    assert_eq!(
        input.try_encode(),
        Err(EncodeError::TooMany {
            what: "commands",
            n: 17,
            max: 16
        })
    );
    for bad in [
        WireCommand::Aim { a: f32::NAN },
        WireCommand::Move {
            x: f32::INFINITY,
            y: 0.0,
            seq: None,
        },
        WireCommand::Attack {
            a: 0.0,
            t: Some(f64::NAN),
        },
        WireCommand::Release {
            a: f32::NEG_INFINITY,
            t: None,
        },
    ] {
        let m = ClientMsg::Input {
            seq: 1,
            commands: vec![bad],
        };
        assert_eq!(m.try_encode(), Err(EncodeError::NonFinite), "{bad:?}");
    }
    // What the decoder does with such a frame (written by hand: the encoder refuses to).
    let mut w = Writer::default();
    w.u8(0x02);
    w.u32(1);
    w.u16(1);
    w.u8(3);
    w.f32(f32::NAN);
    assert_eq!(ClientMsg::decode(&w.finish()), Err(DecodeError::NonFinite));
    let ping = ClientMsg::Ping {
        nonce: 1,
        client_ms: f64::NAN,
    };
    assert_eq!(ping.try_encode(), Err(EncodeError::NonFinite));

    let fx = ServerMsg::Fx {
        tick: 1,
        fx: vec![
            WireFx::Hit {
                victim: 1,
                by: 2,
                amount: 3.0,
                passive: false,
                critical: false,
            };
            u16::MAX as usize + 1
        ],
    };
    assert!(matches!(
        fx.try_encode(),
        Err(EncodeError::TooMany { what: "fx", .. })
    ));
    let events = ServerMsg::Events {
        tick: 1,
        events: vec![WireEvent::Bounty { id: 1, bounty: 2 }; u16::MAX as usize + 1],
    };
    assert!(matches!(
        events.try_encode(),
        Err(EncodeError::TooMany { what: "events", .. })
    ));
    // A legal count whose frame is still over the server frame limit.
    let big = ServerMsg::Fx {
        tick: 1,
        fx: vec![
            WireFx::Hit {
                victim: 1,
                by: 2,
                amount: 3.0,
                passive: false,
                critical: false,
            };
            40_000
        ],
    };
    // tag 1, tick 1, count 3 (a varint of 40000), then 1 + 1 + 1 + 4 + 1 per hit.
    assert_eq!(
        big.try_encode(),
        Err(EncodeError::TooLarge {
            len: 5 + 8 * 40_000,
            max: MAX_SERVER_FRAME
        })
    );
}

fn welcome_header() -> WelcomeHeader {
    WelcomeHeader {
        protocol: PROTOCOL_VERSION,
        content_hash: 0x0123_4567_89ab_cdef,
        match_id: [7; 16],
        player_id: 3,
        session: [5; 16],
        tick_rate: 20,
        tick: 77,
        server_ms: 3850.0,
    }
}

fn welcome(map: MapBlob) -> ServerMsg {
    let h = welcome_header();
    ServerMsg::Welcome {
        protocol: h.protocol,
        content_hash: h.content_hash,
        match_id: h.match_id,
        player_id: h.player_id,
        session: h.session,
        tick_rate: h.tick_rate,
        tick: h.tick,
        server_ms: h.server_ms,
        archetypes: rh_protocol::samples::sample_archetypes(),
        vision: rh_protocol::WireVision::default(),
        weapons: rh_protocol::samples::sample_weapons(),
        map,
    }
}

#[test]
fn a_pre_encoded_map_gives_the_same_welcome() {
    let mut maps = vec![
        MapBlob::new(4, 3, (0..12).map(|i| (i % 3) as u8).collect()),
        // One run longer than u16::MAX: split exactly as the per-Welcome encoder splits it.
        MapBlob::new(500, 140, vec![0; 70_000]),
        MapBlob::new(1, 1, vec![2]),
        MapBlob::new(
            256,
            256,
            (0..65_536u32).map(|i| ((i / 7) % 3) as u8).collect(),
        ),
    ];
    for (_, m) in server_samples() {
        if let ServerMsg::Welcome { map, .. } = m {
            maps.push(map);
        }
    }
    for map in maps {
        let pre = map.pre_encode().unwrap();
        let mut w = Writer::default();
        map.write(&mut w);
        let body = w.finish();
        assert_eq!(pre.static_bytes().len() + 5, body.len());
        let mut cached = Writer::default();
        pre.write_with_mode(&mut cached, map.terrain_mode);
        assert_eq!(cached.finish(), body);
        assert_eq!(pre.len(), map.encoded_len());
        assert_eq!(
            (pre.w(), pre.h(), pre.layer_hash()),
            (map.w, map.h, map.layer_hash)
        );
        let mode = map.terrain_mode;
        let msg = welcome(map);
        let want = msg.encode();
        let got = encode_welcome(
            &welcome_header(),
            &rh_protocol::samples::sample_archetypes(),
            &rh_protocol::WireVision::default(),
            &rh_protocol::samples::sample_weapons(),
            &pre,
            mode,
        );
        assert_eq!(got, want);
        assert_eq!(got.capacity(), got.len());
        let mut out = vec![1];
        assert_eq!(
            encode_welcome_into(
                &welcome_header(),
                &rh_protocol::samples::sample_archetypes(),
                &rh_protocol::WireVision::default(),
                &rh_protocol::samples::sample_weapons(),
                &pre,
                mode,
                &mut out
            ),
            Ok(want.len())
        );
        assert_eq!(&out[1..], &want[..]);
        assert_eq!(ServerMsg::decode(&got), Ok(msg));
    }
}

#[test]
fn cached_static_map_is_content_bound_while_mode_is_per_welcome() {
    let tiles = [0, 0];
    let terrain = [0, 4];
    let cached = EncodedMap::from_slices(2, 1, &tiles, Some(&terrain), None).unwrap();
    assert!(cached.matches_slices(2, 1, &tiles, Some(&terrain), None));
    assert!(!cached.matches_slices(2, 1, &tiles, None, None));
    assert!(!cached.matches_slices(2, 1, &tiles, Some(&[0, 5]), None));
    assert!(!cached.matches_slices(2, 1, &[0, 1], Some(&terrain), None));

    let off = encode_welcome(
        &welcome_header(),
        &[],
        &rh_protocol::WireVision::default(),
        &[],
        &cached,
        GroundMode::Off,
    );
    let all = encode_welcome(
        &welcome_header(),
        &[],
        &rh_protocol::WireVision::default(),
        &[],
        &cached,
        GroundMode::All,
    );
    let ServerMsg::Welcome { map: off_map, .. } = ServerMsg::decode(&off).unwrap() else {
        panic!("welcome")
    };
    let ServerMsg::Welcome { map: all_map, .. } = ServerMsg::decode(&all).unwrap() else {
        panic!("welcome")
    };
    assert_eq!(off_map.terrain_mode, GroundMode::Off);
    assert_eq!(all_map.terrain_mode, GroundMode::All);
    assert_eq!(off_map.terrain, Some(terrain.to_vec()));
    assert_eq!(all_map.terrain, Some(terrain.to_vec()));
    assert_ne!(off_map.context_hash, all_map.context_hash);
}

#[test]
fn maximum_three_plane_decode_stays_within_the_documented_budget() {
    let cells = MapBlob::new_with_ground(
        1024,
        1024,
        vec![0; map::MAX_MAP_TILES],
        Some(vec![0; map::MAX_MAP_TILES]),
        Some(vec![0; map::MAX_MAP_TILES]),
        GroundMode::All,
    )
    .unwrap();
    let frame = welcome(cells).try_encode().unwrap();
    assert!(frame.len() <= MAX_SERVER_FRAME);
    let ServerMsg::Welcome { map, .. } = ServerMsg::decode(&frame).unwrap() else {
        panic!("welcome")
    };
    assert_eq!(
        map.tiles.len() + map.terrain.as_ref().unwrap().len() + map.regions.as_ref().unwrap().len(),
        3 * map::MAX_MAP_TILES
    );
}

#[test]
fn maps_decoders_reject_are_refused_for_the_same_reason() {
    let good = MapBlob::new(4, 3, vec![0; 12]);
    let mut bad_tile = good.clone();
    bad_tile.tiles[5] = 3;
    bad_tile.layer_hash = map::layer_hash(4, 3, &bad_tile.tiles);
    let mut short = good.clone();
    short.tiles.pop();
    short.layer_hash = map::layer_hash(4, 3, &short.tiles);
    let mut wrong_hash = good.clone();
    wrong_hash.layer_hash ^= 1;
    let empty = MapBlob::new(0, 3, vec![]);
    for (m, why) in [
        (bad_tile, "run"),
        (short, "length"),
        (wrong_hash, "hash"),
        (empty, "size"),
    ] {
        assert_eq!(m.check(), Err(EncodeError::BadMap(why)));
        assert_eq!(m.pre_encode(), Err(EncodeError::BadMap(why)));
        assert_eq!(
            welcome(m.clone()).try_encode(),
            Err(EncodeError::BadMap(why))
        );
        let mut w = Writer::default();
        m.write(&mut w);
        let b = w.finish();
        assert_eq!(
            MapBlob::read(&mut Reader::new(&b)),
            Err(DecodeError::BadMap(why)),
            "the decoder names the same reason"
        );
    }
    // A legal map whose Welcome exceeds MAX_SERVER_FRAME (alternating tiles: one run per tile).
    let striped = MapBlob::new(400, 400, (0..160_000u32).map(|i| (i % 2) as u8).collect());
    assert!(matches!(striped.check(), Err(EncodeError::TooLarge { .. })));
    assert_eq!(
        welcome(striped.clone()).try_encode(),
        Err(EncodeError::TooLarge {
            len: 60 + 12 + 3 * 160_000 + 4 + 11,
            max: MAX_SERVER_FRAME
        })
    );
    assert!(matches!(
        striped.pre_encode(),
        Err(EncodeError::TooLarge { .. })
    ));
    assert!(matches!(
        EncodedMap::from_slices(400, 400, &striped.tiles, None, None),
        Err(EncodeError::TooLarge { .. })
    ));
}

/// A remote actor or swing outside the 0 ..= POS_MAX grid is refused (never clamped), on every encoder path; one at the
/// top of the range is carried exactly.
#[test]
fn positions_outside_the_quantizable_range_are_refused_not_clamped() {
    let at = |x: f32, y: f32| WireActor { x, y, ..actor(0) };
    let snap = |a: WireActor| ServerMsg::Snapshot {
        training: false,
        owner_combat: None,
        tick: 1,
        server_time: snapshot_server_ms(1),
        phase: 1,
        ack_input: 0,
        me: None,
        actors: vec![a],
    };
    let inside = snap(at(POS_MAX, 8191.5));
    let bytes = inside.try_encode().expect("the top of the range encodes");
    assert_eq!(ServerMsg::decode(&bytes).unwrap(), decoded_form(&inside));
    assert_eq!(
        decoded_form(&inside),
        inside,
        "and decodes to what was sent"
    );
    for (x, y) in [
        (8191.876, 0.0),
        (0.0, 8192.0),
        (1.0e9, 5.0),
        (-0.01, 5.0),
        (5.0, f32::NAN),
        (f32::INFINITY, 5.0),
    ] {
        let m = snap(at(x, y));
        assert_eq!(
            m.try_encode(),
            Err(EncodeError::BadValue("position")),
            "{x},{y}"
        );
        let mut out = vec![9u8];
        assert_eq!(
            m.encode_into(&mut out),
            Err(EncodeError::BadValue("position"))
        );
        assert_eq!(out, vec![9u8], "an error leaves the buffer unchanged");
        let mut out = Vec::new();
        assert_eq!(
            full_frame(&mut out, &m),
            Err(EncodeError::BadValue("position"))
        );
        assert!(out.is_empty());
    }
    let swing = |x: f32, y: f32| ServerMsg::Fx {
        tick: 1,
        fx: vec![WireFx::Swing {
            by: 1,
            weapon: 2,
            x,
            y,
            a: 0.5,
        }],
    };
    assert!(swing(POS_MAX, 0.0).try_encode().is_ok());
    assert_eq!(
        swing(0.0, 8192.0).try_encode(),
        Err(EncodeError::BadValue("position"))
    );
    assert_eq!(
        swing(f32::NAN, 0.0).try_encode(),
        Err(EncodeError::BadValue("position"))
    );
}

#[test]
fn a_welcome_refuses_a_malformed_archetype_table() {
    use rh_protocol::{WireArchetype, WireHull};
    let good = rh_protocol::samples::sample_archetypes();
    let pre = MapBlob::new(1, 1, vec![2]).pre_encode().unwrap();
    let bytes = encode_welcome(
        &welcome_header(),
        &good,
        &rh_protocol::WireVision::default(),
        &[],
        &pre,
        GroundMode::Off,
    );
    let ServerMsg::Welcome { archetypes, .. } = ServerMsg::decode(&bytes).unwrap() else {
        panic!("welcome")
    };
    assert_eq!(archetypes, good);
    let mut unordered = good.clone();
    unordered.swap(0, 1);
    let mut empty_key = good.clone();
    empty_key[0].key.clear();
    let mut zero_box = good.clone();
    zero_box[1].hull = WireHull::Boxes {
        fx: 0,
        fy: 6,
        bx: 16,
        by: 35,
        ox: 0,
        oy: -30,
    };
    let too_many: Vec<_> = (0..=32u8)
        .map(|id| WireArchetype {
            id,
            key: "k".into(),
            hull: WireHull::Circle { r: 1 },
            chest: 0,
        })
        .collect();
    for bad in [unordered, empty_key, zero_box, too_many] {
        let mut out = Vec::new();
        assert!(encode_welcome_into(
            &welcome_header(),
            &bad,
            &rh_protocol::WireVision::default(),
            &[],
            &pre,
            GroundMode::Off,
            &mut out
        )
        .is_err());
        // Forge the frame: the decoder refuses it too.
        let mut forged = encode_welcome(
            &welcome_header(),
            &[],
            &rh_protocol::WireVision::default(),
            &[],
            &pre,
            GroundMode::Off,
        );
        let mut table = Writer::default();
        rh_protocol::samples::write_archetype_table_for_tests(&mut table, &bad);
        let table = table.finish();
        forged.splice(
            rh_protocol::WELCOME_HEADER_LEN..rh_protocol::WELCOME_HEADER_LEN + 1,
            table,
        );
        assert!(ServerMsg::decode(&forged).is_err());
    }
}

/// Protocol 16: the vision block round-trips, the pre-encoded path writes it exactly, and the encoder refuses a block a
/// decoder would refuse (each field's fault, and a coliseum rectangle outside the map).
#[test]
fn a_welcome_carries_the_vision_block_and_refuses_a_malformed_one() {
    use rh_protocol::{WireRect, WireVision};
    let map = MapBlob::new(4, 3, vec![0; 12]);
    let pre = map.pre_encode().unwrap();
    let good = WireVision {
        coliseum: Some(WireRect {
            x: 1,
            y: 1,
            w: 3,
            h: 2,
        }),
        ..WireVision::default()
    };
    let bytes = encode_welcome(&welcome_header(), &[], &good, &[], &pre, GroundMode::Off);
    let ServerMsg::Welcome { vision, .. } = ServerMsg::decode(&bytes).unwrap() else {
        panic!("welcome")
    };
    assert_eq!(vision, good);
    let d = WireVision::default();
    let rect = |x, y, w, h| Some(WireRect { x, y, w, h });
    for bad in [
        WireVision { version: 0, ..d },
        WireVision {
            tile: f64::NAN,
            ..d
        },
        WireVision { radius: 0.0, ..d },
        WireVision {
            trail_ms: -1.0,
            ..d
        },
        WireVision {
            update_ms: f64::INFINITY,
            ..d
        },
        WireVision { sight_mask: 0, ..d },
        WireVision {
            coliseum: rect(0, 0, 1, 0),
            ..d
        },
        WireVision {
            coliseum: rect(2, 0, 3, 1),
            ..d
        },
        WireVision {
            coliseum: rect(0, 2, 1, 2),
            ..d
        },
    ] {
        let mut out = Vec::new();
        assert!(
            encode_welcome_into(
                &welcome_header(),
                &[],
                &bad,
                &[],
                &pre,
                GroundMode::Off,
                &mut out
            )
            .is_err(),
            "{bad:?}"
        );
        let msg = ServerMsg::Welcome {
            protocol: rh_protocol::PROTOCOL_VERSION,
            content_hash: 1,
            match_id: [0; 16],
            player_id: 1,
            session: [0; 16],
            tick_rate: 20,
            tick: 0,
            server_ms: 0.0,
            archetypes: Vec::new(),
            vision: bad,
            weapons: Vec::new(),
            map: map.clone(),
        };
        assert!(msg.try_encode().is_err(), "{bad:?}");
        // Forge the frame: the decoder refuses it too.
        let mut forged = encode_welcome(&welcome_header(), &[], &d, &[], &pre, GroundMode::Off);
        let mut block = Writer::default();
        rh_protocol::vision::write_vision_for_tests(&mut block, &bad);
        let at = rh_protocol::WELCOME_HEADER_LEN + 1;
        forged.splice(
            at..at + rh_protocol::vision::VISION_BLOCK_LEN,
            block.finish(),
        );
        assert!(ServerMsg::decode(&forged).is_err(), "{bad:?}");
    }
}

/// Protocol 16: the weapon table round-trips, the pre-encoded path writes it exactly, and the encoder refuses a table a
/// decoder would refuse (each fault: count, kind, a value out of range, a value that does not fit its kind, order).
#[test]
fn a_welcome_carries_the_weapon_table_and_refuses_a_malformed_one() {
    use rh_protocol::weapon::{table_fault, table_len, WEAPON_ROW_LEN};
    use rh_protocol::{WireVision, WireWeapon, MAX_WEAPONS};
    let map = MapBlob::new(4, 3, vec![0; 12]);
    let pre = map.pre_encode().unwrap();
    let good = rh_protocol::samples::sample_weapons();
    assert_eq!(table_fault(&good), None);
    assert_eq!(table_len(&good), 1 + good.len() * WEAPON_ROW_LEN);
    let d = WireVision::default();
    let bytes = encode_welcome(&welcome_header(), &[], &d, &good, &pre, GroundMode::Off);
    let ServerMsg::Welcome { weapons, .. } = ServerMsg::decode(&bytes).unwrap() else {
        panic!("welcome")
    };
    assert_eq!(weapons, good);
    let (sword, bow, none) = (good[0], good[1], good[6]);
    let with = |i: usize, row: WireWeapon| {
        let mut t = good.clone();
        t[i] = row;
        t
    };
    let pi = std::f64::consts::PI;
    let mut unordered = good.clone();
    unordered.swap(2, 3);
    let cases: Vec<(&str, Vec<WireWeapon>)> = vec![
        (
            "weapon count",
            (0..=MAX_WEAPONS as u8)
                .map(|id| WireWeapon { id, ..sword })
                .collect(),
        ),
        ("weapon kind", with(0, WireWeapon { kind: 3, ..sword })),
        ("weapon order", unordered),
        ("weapon order", with(1, WireWeapon { id: 0, ..bow })),
        (
            "weapon",
            with(
                0,
                WireWeapon {
                    reach: f64::NAN,
                    ..sword
                },
            ),
        ),
        (
            "weapon",
            with(
                1,
                WireWeapon {
                    speed: f64::INFINITY,
                    ..bow
                },
            ),
        ),
        (
            "weapon",
            with(
                1,
                WireWeapon {
                    radius: -1.0,
                    ..bow
                },
            ),
        ),
        (
            "weapon",
            with(
                1,
                WireWeapon {
                    reach: 1.0e6 + 1.0,
                    ..bow
                },
            ),
        ),
        (
            "weapon",
            with(
                0,
                WireWeapon {
                    half_arc: pi + 1e-9,
                    ..sword
                },
            ),
        ),
        (
            "weapon",
            with(
                0,
                WireWeapon {
                    half_arc: 0.0,
                    ..sword
                },
            ),
        ),
        (
            "weapon",
            with(
                0,
                WireWeapon {
                    reach: 0.0,
                    ..sword
                },
            ),
        ),
        (
            "weapon",
            with(
                0,
                WireWeapon {
                    speed: 1.0,
                    ..sword
                },
            ),
        ),
        (
            "weapon",
            with(
                0,
                WireWeapon {
                    radius: 1.0,
                    ..sword
                },
            ),
        ),
        ("weapon", with(1, WireWeapon { speed: 0.0, ..bow })),
        ("weapon", with(1, WireWeapon { reach: 0.0, ..bow })),
        (
            "weapon",
            with(
                1,
                WireWeapon {
                    half_arc: 0.1,
                    ..bow
                },
            ),
        ),
        ("weapon", with(6, WireWeapon { speed: 1.0, ..none })),
    ];
    // The edges are valid: a half arc of exactly PI, a projectile with no contact radius, values of exactly 1e6.
    for ok in [
        with(
            0,
            WireWeapon {
                half_arc: pi,
                ..sword
            },
        ),
        with(1, WireWeapon { radius: 0.0, ..bow }),
        with(
            1,
            WireWeapon {
                reach: 1.0e6,
                speed: 1.0e6,
                radius: 1.0e6,
                ..bow
            },
        ),
    ] {
        assert_eq!(table_fault(&ok), None);
    }
    for (why, bad) in cases {
        assert_eq!(table_fault(&bad), Some(why), "{bad:?}");
        let mut out = Vec::new();
        assert_eq!(
            encode_welcome_into(
                &welcome_header(),
                &[],
                &d,
                &bad,
                &pre,
                GroundMode::Off,
                &mut out
            ),
            Err(EncodeError::BadValue(why)),
            "{bad:?}"
        );
        assert!(out.is_empty());
        let msg = ServerMsg::Welcome {
            protocol: rh_protocol::PROTOCOL_VERSION,
            content_hash: 1,
            match_id: [0; 16],
            player_id: 1,
            session: [0; 16],
            tick_rate: 20,
            tick: 0,
            server_ms: 0.0,
            archetypes: Vec::new(),
            vision: d,
            weapons: bad.clone(),
            map: map.clone(),
        };
        assert!(msg.try_encode().is_err(), "{bad:?}");
        // Forge the frame: the decoder refuses it too, for the same reason.
        let mut forged = encode_welcome(&welcome_header(), &[], &d, &[], &pre, GroundMode::Off);
        let mut table = Writer::default();
        rh_protocol::samples::write_weapon_table_for_tests(&mut table, &bad);
        let at = rh_protocol::WELCOME_HEADER_LEN + 1 + rh_protocol::vision::VISION_BLOCK_LEN;
        forged.splice(at..at + 1, table.finish());
        assert_eq!(
            ServerMsg::decode(&forged),
            Err(rh_protocol::DecodeError::BadField(why)),
            "{bad:?}"
        );
    }
}
