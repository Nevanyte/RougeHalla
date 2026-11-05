//! Placement id -> DNS name. Deterministic, so a retried DNS upsert is idempotent and a janitor can recompute the name from
//! a placement id. `hosting/infra/edge/dns/hostname.mjs` mirrors this and is tested against
//! `hosting/placement/vectors/hostnames.json` (this crate tests the same file).
//!
//! `<region>-<token>.<zone>`: one DNS label, so one wildcard certificate `*.<zone>` covers every game host. The token is the
//! first 12 characters of the lowercase RFC 4648 base32 of SHA-256(placement id): 60 bits, ids are never reused.

use sha2::{Digest, Sha256};

const B32: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";

pub fn token(placement_id: &str) -> String {
    let digest = Sha256::digest(placement_id.as_bytes());
    let mut out = String::with_capacity(12);
    let (mut buf, mut bits) = (0u32, 0u32);
    for &b in digest.iter() {
        buf = (buf << 8) | b as u32;
        bits += 8;
        while bits >= 5 && out.len() < 12 {
            bits -= 5;
            out.push(B32[((buf >> bits) & 31) as usize] as char);
        }
        if out.len() == 12 {
            break;
        }
    }
    out
}

/// A region id that is safe inside a DNS label: lowercase letters, digits and dashes, not starting or ending with a dash.
pub fn region_ok(region: &str) -> bool {
    !region.is_empty()
        && region.len() <= 32
        && !region.starts_with('-')
        && !region.ends_with('-')
        && region
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// The fully qualified game hostname. `zone` is e.g. `g.rougehalla.com` (no leading dot, no wildcard).
pub fn game_hostname(region: &str, placement_id: &str, zone: &str) -> Result<String, String> {
    if !region_ok(region) {
        return Err(format!("region {region:?} is not usable in a DNS label"));
    }
    if zone.is_empty() || zone.starts_with('.') || zone.starts_with('*') || zone.ends_with('.') {
        return Err("zone must be a bare domain such as g.rougehalla.com".into());
    }
    let label = format!("{region}-{}", token(placement_id));
    debug_assert!(label.len() <= 63);
    Ok(format!("{label}.{zone}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_vectors_match_the_node_mirror() {
        let raw = include_str!("../../../hosting/placement/vectors/hostnames.json");
        let v: serde_json::Value = serde_json::from_str(raw).unwrap();
        let zone = v["zone"].as_str().unwrap();
        for c in v["cases"].as_array().unwrap() {
            let got = game_hostname(
                c["region"].as_str().unwrap(),
                c["placementId"].as_str().unwrap(),
                zone,
            )
            .unwrap();
            assert_eq!(got, c["hostname"].as_str().unwrap(), "{c}");
        }
    }

    #[test]
    fn deterministic_and_distinct() {
        assert_eq!(token("rh-abc-1"), token("rh-abc-1"));
        assert_ne!(token("rh-abc-1"), token("rh-abc-2"));
        assert_eq!(token("x").len(), 12);
    }

    #[test]
    fn rejects_unsafe_inputs() {
        assert!(game_hostname("US-West-2", "p", "g.example.com").is_err());
        assert!(game_hostname("us-west-2", "p", "*.g.example.com").is_err());
        assert!(game_hostname("us-west-2", "p", ".g.example.com").is_err());
        assert!(game_hostname("us.west", "p", "g.example.com").is_err());
        assert!(game_hostname("us-west-2", "p", "g.example.com")
            .unwrap()
            .starts_with("us-west-2-"));
    }
}
