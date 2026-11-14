//! P-PROTOCOL-18-STAMP-1 oracle: the build that is next deployed speaks protocol 18 (owner approval 9, 2026-11-12), its
//! golden vectors are `protocol/fixtures/v18.json`, and no wire byte other than the version moved: v18 is v17 with the
//! version substituted. `v17.json` stays in the tree as history (crates/rh-protocol/AGENTS.md).
use rh_protocol::{ClientMsg, ServerMsg, PROTOCOL_VERSION};
use std::path::PathBuf;

fn fixture_path(version: u16) -> PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../protocol/fixtures")
        .join(format!("v{version}.json"))
}

fn fixture(version: u16) -> String {
    let path = fixture_path(version);
    assert!(
        path.exists(),
        "protocol/fixtures/v{version}.json is missing (cargo run -p rh-protocol --bin protocol-fixtures)"
    );
    std::fs::read_to_string(&path).expect("readable vectors")
}

/// The bytes of the vector `name` (the first one: client vectors come before server vectors in the file).
fn vector(text: &str, name: &str) -> Vec<u8> {
    let key = format!("{{\"name\": \"{name}\", \"hex\": \"");
    let line = text
        .lines()
        .map(str::trim_start)
        .find(|l| l.starts_with(&key))
        .unwrap_or_else(|| panic!("no vector {name}"));
    let hex = &line[key.len()..];
    let hex = &hex[..hex.find('"').expect("closing quote")];
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex"))
        .collect()
}

#[test]
fn protocol_version_is_18() {
    assert_eq!(PROTOCOL_VERSION, 18);
}

#[test]
fn v18_fixture_exists_and_its_hello_and_welcome_say_18() {
    let v18 = fixture(18);
    assert!(
        v18.contains("\n  \"protocol\": 18,\n"),
        "the v18 header names protocol 18"
    );
    let hello = vector(&v18, "hello");
    assert_eq!(ClientMsg::hello_protocol(&hello), Some(18));
    match ClientMsg::decode(&hello) {
        Ok(ClientMsg::Hello { protocol, .. }) => assert_eq!(protocol, 18),
        other => panic!("the hello vector decodes to a Hello: {other:?}"),
    }
    match ServerMsg::decode(&vector(&v18, "welcome")) {
        Ok(ServerMsg::Welcome { protocol, .. }) => assert_eq!(protocol, 18),
        other => panic!("the welcome vector decodes to a Welcome: {other:?}"),
    }
}

/// Measured on the base (`fffbad5c6`): regenerating at 18 changes 136 lines of v17.json, all of them by these four
/// substitutions (the header; the version u16 LE after a Hello tag 0x01 or a Welcome tag 0x81; the debug text).
#[test]
fn v17_and_v18_differ_only_in_the_version() {
    let v17 = fixture(17);
    let v18 = fixture(18);
    let mut expected = String::with_capacity(v17.len());
    for line in v17.split_inclusive('\n') {
        let line = if line == "  \"protocol\": 17,\n" {
            "  \"protocol\": 18,\n".to_owned()
        } else {
            line.replacen("\"hex\": \"011100", "\"hex\": \"011200", 1)
                .replacen("\"hex\": \"811100", "\"hex\": \"811200", 1)
                .replace("protocol: 17,", "protocol: 18,")
        };
        expected.push_str(&line);
    }
    assert_ne!(expected, v17, "the substitutions apply to v17.json");
    let first_difference = expected.lines().zip(v18.lines()).position(|(a, b)| a != b);
    assert!(
        expected == v18,
        "v18.json differs from v17.json beyond the protocol version (first differing line {first_difference:?}; \
         line counts {} vs {})",
        expected.lines().count(),
        v18.lines().count()
    );
}
