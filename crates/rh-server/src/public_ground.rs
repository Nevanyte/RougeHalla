//! Cold public map projection. Only canonical collision, terrain and region cells, and the map facts legacy clients
//! generated themselves (camp markers, the coliseum and its gates, concealment bushes; protocol 17), cross this seam.
//! The seed, spawn pool, crate and ground spots and the feature list stay on the server (C-OBS).
//! Match effect mode is deliberately separate from the arena-only encoded asset cache.

use rh_protocol::codec::EncodeError;
use rh_protocol::map::{EncodedMap, MapCamp, MapColiseum, MapGate, MapPublic, MapTile};
use rh_protocol::GroundMode;
use rh_sim::mapdata::{FeatureKind, GateSide, LayerData};
use rh_sim::{terrain::Mode, TileMap};

fn dimensions(map: &TileMap) -> Result<(u16, u16), EncodeError> {
    if map
        .layers()
        .is_some_and(|layers| layers.dimensions() != (map.w, map.h))
    {
        return Err(EncodeError::BadMap("ground dimensions"));
    }
    Ok((
        u16::try_from(map.w).map_err(|_| EncodeError::BadMap("size"))?,
        u16::try_from(map.h).map_err(|_| EncodeError::BadMap("size"))?,
    ))
}

fn planes(map: &TileMap) -> (Option<&[u8]>, Option<&[u8]>) {
    match map.layers() {
        Some(layers) => (
            Some(layers.data().terrain.as_slice()),
            Some(layers.data().region_grid.as_slice()),
        ),
        None => (None, None),
    }
}

/// A legacy world-unit value as sent: a whole number in `u16` range, never rounded or clamped.
fn whole_u16(v: f64, why: &'static str) -> Result<u16, EncodeError> {
    if v.is_finite() && v.fract() == 0.0 && (0.0..=f64::from(u16::MAX)).contains(&v) {
        Ok(v as u16)
    } else {
        Err(EncodeError::BadMap(why))
    }
}

fn tile_u16(v: i32, why: &'static str) -> Result<u16, EncodeError> {
    u16::try_from(v).map_err(|_| EncodeError::BadMap(why))
}

/// The wire's gate side code: `GateSide` declaration order (n, e, s, w).
fn side_code(side: GateSide) -> u8 {
    match side {
        GateSide::North => 0,
        GateSide::East => 1,
        GateSide::South => 2,
        GateSide::West => 3,
    }
}

/// The protocol 17 public sections from the map's metadata. Camps keep `map.camps` order, the order of the `WireCamp`
/// rows. Bushes are legacy `bushAt` ids (feature index + 1 where the feature is a bush); the plane is absent when the
/// map has no bush. Props and ground variants are reserved and stay absent.
pub fn public_sections(data: &LayerData) -> Result<MapPublic, EncodeError> {
    let camps = data
        .camps
        .iter()
        .map(|c| {
            Ok(MapCamp {
                x: whole_u16(c.x, "camp position")?,
                y: whole_u16(c.y, "camp position")?,
                r: whole_u16(c.r, "camp radius")?,
                zone: c.zone.code(),
            })
        })
        .collect::<Result<Vec<_>, EncodeError>>()?;
    let col = &data.coliseum;
    let gates = col
        .gates
        .iter()
        .map(|g| {
            Ok(MapGate {
                side: side_code(g.side),
                tiles: g
                    .tiles
                    .iter()
                    .map(|t| {
                        Ok(MapTile {
                            x: tile_u16(t.x, "gate tile")?,
                            y: tile_u16(t.y, "gate tile")?,
                        })
                    })
                    .collect::<Result<Vec<_>, EncodeError>>()?,
            })
        })
        .collect::<Result<Vec<_>, EncodeError>>()?;
    let rect_u16 = |v: u32| u16::try_from(v).map_err(|_| EncodeError::BadMap("coliseum rect"));
    let coliseum = MapColiseum {
        x: tile_u16(col.rect.x, "coliseum rect")?,
        y: tile_u16(col.rect.y, "coliseum rect")?,
        w: rect_u16(col.rect.w)?,
        h: rect_u16(col.rect.h)?,
        gates,
    };
    let bushes: Vec<u8> = data
        .feature_grid
        .iter()
        .map(|&id| {
            let is_bush = id > 0
                && data
                    .features
                    .get(usize::from(id) - 1)
                    .is_some_and(|f| f.kind == FeatureKind::Bush);
            if is_bush {
                id
            } else {
                0
            }
        })
        .collect();
    let bushes = bushes.iter().any(|&id| id != 0).then_some(bushes);
    Ok(MapPublic {
        camps,
        coliseum: Some(coliseum),
        bushes,
        props: Vec::new(),
        ground_variants: None,
    })
}

fn public(map: &TileMap) -> Result<MapPublic, EncodeError> {
    map.layers()
        .map_or_else(|| Ok(MapPublic::default()), |l| public_sections(l.data()))
}

/// Validate borrowed canonical data before allocating the once-encoded static bytes.
pub fn encode_static_map(map: &TileMap) -> Result<EncodedMap, EncodeError> {
    let (w, h) = dimensions(map)?;
    let (terrain, regions) = planes(map);
    EncodedMap::from_public(w, h, &map.tiles, terrain, regions, &public(map)?)
}

/// A cache key is only a lookup aid. Reuse requires the complete canonical public content to match.
pub fn matches_static_map(encoded: &EncodedMap, map: &TileMap) -> bool {
    let Ok((w, h)) = dimensions(map) else {
        return false;
    };
    let Ok(public) = public(map) else {
        return false;
    };
    let (terrain, regions) = planes(map);
    encoded.matches_public(w, h, &map.tiles, terrain, regions, &public)
}

/// Publish the actual simulation configuration, without changing or interpreting terrain rules.
pub fn mode(mode: Mode) -> GroundMode {
    match mode {
        Mode::Off => GroundMode::Off,
        Mode::Map => GroundMode::Map,
        Mode::All => GroundMode::All,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rh_protocol::map::MapBlob;
    use rh_protocol::{encode_welcome, WelcomeHeader};
    use rh_protocol::{ServerMsg, WireVision, MAX_SERVER_FRAME};

    fn seed1() -> TileMap {
        let export: rh_sim::mapdata::MapExport = serde_json::from_str(include_str!(
            "../../rh-sim/src/mapdata/fixtures/seed1.map.json"
        ))
        .unwrap();
        export.validate().unwrap().into_arena().unwrap().map
    }

    fn welcome_bytes(encoded: &EncodedMap) -> Vec<u8> {
        let header = WelcomeHeader {
            protocol: rh_protocol::PROTOCOL_VERSION,
            content_hash: 1,
            match_id: [3; 16],
            player_id: 1,
            session: [7; 16],
            tick_rate: 20,
            tick: 0,
            server_ms: 0.,
        };
        encode_welcome(
            &header,
            &[],
            &WireVision::default(),
            &[],
            encoded,
            GroundMode::Map,
        )
    }

    fn decoded(bytes: &[u8]) -> MapBlob {
        match ServerMsg::decode(bytes).unwrap() {
            ServerMsg::Welcome { map, .. } => map,
            _ => panic!("expected Welcome"),
        }
    }

    #[test]
    fn seed1_welcome_carries_camps_coliseum_and_bushes_under_the_frame_limit() {
        let map = seed1();
        let data = map.layers().unwrap().data();
        let encoded = encode_static_map(&map).unwrap();
        let bytes = welcome_bytes(&encoded);
        println!(
            "seed-1 Welcome: {} bytes (map blob {} bytes; frame limit {MAX_SERVER_FRAME})",
            bytes.len(),
            encoded.len()
        );
        assert!(bytes.len() <= MAX_SERVER_FRAME);
        let blob = decoded(&bytes);
        let public = &blob.public;

        // Camps, index-aligned with map.camps (the WireCamp order), legacy x, y, r and zone code.
        assert_eq!(public.camps.len(), data.camps.len());
        assert!(!public.camps.is_empty());
        for (wire, camp) in public.camps.iter().zip(&data.camps) {
            assert_eq!(f64::from(wire.x), camp.x);
            assert_eq!(f64::from(wire.y), camp.y);
            assert_eq!(f64::from(wire.r), camp.r);
            assert_eq!(wire.zone, camp.zone.code());
        }

        // The coliseum rectangle and its gates in legacy order.
        let col = public.coliseum.as_ref().unwrap();
        let src = &data.coliseum;
        assert_eq!(
            (
                i32::from(col.x),
                i32::from(col.y),
                u32::from(col.w),
                u32::from(col.h)
            ),
            (src.rect.x, src.rect.y, src.rect.w, src.rect.h)
        );
        assert_eq!(col.gates.len(), src.gates.len());
        for (wire, gate) in col.gates.iter().zip(&src.gates) {
            assert_eq!(wire.side, side_code(gate.side));
            let tiles: Vec<(i32, i32)> = wire
                .tiles
                .iter()
                .map(|t| (i32::from(t.x), i32::from(t.y)))
                .collect();
            let want: Vec<(i32, i32)> = gate.tiles.iter().map(|t| (t.x, t.y)).collect();
            assert_eq!(tiles, want);
        }

        // The bush plane is the legacy bushAt identity at every tile centre.
        let layers = map.layers().unwrap();
        let bushes = public.bushes.as_ref().unwrap();
        assert_eq!(bushes.len(), map.tiles.len());
        let w = map.w as usize;
        for (i, &id) in bushes.iter().enumerate() {
            let (tx, ty) = ((i % w) as i64, (i / w) as i64);
            let at = layers.bush_at_world(
                rh_sim::map::tile_to_world_center(tx),
                rh_sim::map::tile_to_world_center(ty),
            );
            assert_eq!(u16::from(id), at, "tile {i}");
        }
        assert!(bushes.iter().any(|&id| id != 0));

        // Reserved sections ship absent.
        assert!(public.props.is_empty());
        assert!(public.ground_variants.is_none());

        // The cache matches its own map and nothing with different public content.
        assert!(matches_static_map(&encoded, &map));
        let plain = TileMap::new(map.w, map.h, map.tiles.clone()).unwrap();
        assert!(!matches_static_map(&encoded, &plain));
    }

    #[test]
    fn a_map_without_layers_sends_no_public_section() {
        let map = TileMap::new(4, 3, vec![0; 12]).unwrap();
        let encoded = encode_static_map(&map).unwrap();
        let blob = decoded(&welcome_bytes(&encoded));
        assert_eq!(blob.public, MapPublic::default());
        assert!(matches_static_map(&encoded, &map));
    }

    #[test]
    fn a_camp_off_the_whole_number_grid_is_refused_not_rounded() {
        let map = seed1();
        let mut data = map.layers().unwrap().data().clone();
        data.camps[0].x += 0.5;
        assert_eq!(
            public_sections(&data),
            Err(EncodeError::BadMap("camp position"))
        );
        let mut data = map.layers().unwrap().data().clone();
        data.camps[0].r = -1.0;
        assert_eq!(
            public_sections(&data),
            Err(EncodeError::BadMap("camp radius"))
        );
        let mut data = map.layers().unwrap().data().clone();
        data.camps[0].y = 70_000.0;
        assert_eq!(
            public_sections(&data),
            Err(EncodeError::BadMap("camp position"))
        );
    }
}
