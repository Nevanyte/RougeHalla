//! P-WIRE17-MAP-2 oracle (server): the map blob the server sends carries the camp patience plane computed by the sim's
//! own rule (`rh_sim::mapdata::patience::patience_plane`, which calls the sim's leash predicate), once per map; it is
//! public map data (no viewer enters it). A map without layers, or whose camps cover no tile, sends no plane (version 2,
//! as before this packet).

use rh_protocol::map::{EncodedMap, MapBlob, MapPublic};
use rh_protocol::{
    encode_welcome, GroundMode, ServerMsg, WelcomeHeader, WireVision, MAX_SERVER_FRAME,
};
use rh_server::public_ground::{encode_static_map, matches_static_map, public_sections};
use rh_sim::mapdata::patience::patience_plane;
use rh_sim::mapdata::MapExport;
use rh_sim::TileMap;

fn seed1() -> TileMap {
    let export: MapExport = serde_json::from_str(include_str!(
        "../../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .unwrap();
    export.validate().unwrap().into_arena().unwrap().map
}

fn welcome_map(encoded: &EncodedMap, player_id: u32) -> (usize, MapBlob) {
    let header = WelcomeHeader {
        protocol: rh_protocol::PROTOCOL_VERSION,
        content_hash: 1,
        match_id: [3; 16],
        player_id,
        session: [7; 16],
        tick_rate: 20,
        tick: 0,
        server_ms: 0.,
    };
    let bytes = encode_welcome(
        &header,
        &[],
        &WireVision::default(),
        &[],
        &Default::default(),
        encoded,
        GroundMode::Map,
    );
    match ServerMsg::decode(&bytes).expect("the Welcome decodes") {
        ServerMsg::Welcome { map, .. } => (bytes.len(), map),
        _ => panic!("expected Welcome"),
    }
}

#[test]
fn the_seed1_welcome_carries_the_sims_patience_plane() {
    let map = seed1();
    let data = map.layers().unwrap().data();
    let want = patience_plane(data);
    assert!(want.iter().any(|&v| v != 0), "seed 1's camps cover tiles");
    let encoded = encode_static_map(&map).expect("encodes");
    let (len, blob) = welcome_map(&encoded, 1);
    assert!(len <= MAX_SERVER_FRAME, "{len} bytes");
    let differ = |got: Option<&[u8]>| -> Option<usize> {
        got.filter(|g| g.len() == want.len())
            .map(|g| g.iter().zip(&want).filter(|(a, b)| a != b).count())
    };
    assert_eq!(
        differ(blob.public.patience.as_deref()),
        Some(0),
        "tiles where the plane the server sends differs from the sim's rule (None: no plane of the map's size)"
    );
    let sections = public_sections(data).expect("encodes");
    assert_eq!(
        differ(sections.patience.as_deref()),
        Some(0),
        "public_sections"
    );
    // The cache still recognises its own map.
    assert!(matches_static_map(&encoded, &map));
}

#[test]
fn the_plane_is_the_same_for_every_viewer() {
    let encoded = encode_static_map(&seed1()).expect("encodes");
    let (_, a) = welcome_map(&encoded, 1);
    let (_, b) = welcome_map(&encoded, 2);
    assert!(a.public.patience.is_some(), "the plane is sent");
    assert!(
        a.public.patience == b.public.patience,
        "no viewer enters the plane"
    );
}

#[test]
fn guard_a_map_without_layers_or_covered_camps_sends_no_plane() {
    let plain = TileMap::new(4, 3, vec![0; 12]).unwrap();
    let (_, blob) = welcome_map(&encode_static_map(&plain).unwrap(), 1);
    assert_eq!(blob.public, MapPublic::default());
    // Camps without territory cover nothing (legacy `campPatienceOutline` returns null): no plane, the rest unchanged.
    let mut data = seed1().layers().unwrap().data().clone();
    for camp in &mut data.camps {
        camp.area = 0;
    }
    let public = public_sections(&data).expect("encodes");
    assert_eq!(public.patience, None);
    assert!(!public.camps.is_empty());
}
