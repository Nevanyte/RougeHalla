use crate::{FixInput, RawCommand, Value};

/// The fixture input as a raw command (None for a type outside the slice).
pub fn raw_command_pub(i: &FixInput) -> Option<RawCommand> {
    raw_command(i)
}

/// The `msg` keys each slice input type may carry: [`raw_command`] reads exactly these, so any other key (a future
/// `charge` on an attack) is reported by [`unread_msg_keys`] instead of being dropped without a word.
pub const INPUT_MSG_KEYS: [(&str, &[&str]); 7] = [
    ("move", &["x", "y", "seq"]),
    ("stop", &["seq"]),
    ("aim", &["a"]),
    ("attack", &["a", "t"]),
    ("release", &["a", "t"]),
    ("swap", &["slot"]),
    ("pickup", &["containerId"]),
];

/// The keys of a slice input's `msg` that [`raw_command`] does not read (a non-object `msg` reports `<not an object>`).
/// Empty for an input type outside the slice (that input fails on its own).
pub fn unread_msg_keys(i: &FixInput) -> Vec<String> {
    let Some((_, keys)) = INPUT_MSG_KEYS.iter().find(|(k, _)| *k == i.kind) else {
        return Vec::new();
    };
    match i.msg.as_object() {
        None => vec!["<not an object>".into()],
        Some(m) => m
            .keys()
            .filter(|k| !keys.contains(&k.as_str()))
            .cloned()
            .collect(),
    }
}

pub(crate) fn raw_command(i: &FixInput) -> Option<RawCommand> {
    let m = &i.msg;
    let f = |k: &str| m.get(k).and_then(Value::as_f64);
    let seq = m
        .get("seq")
        .and_then(Value::as_u64)
        .filter(|v| *v <= 255)
        .map(|v| v as u8);
    Some(match i.kind.as_str() {
        "move" => RawCommand::Move {
            x: f("x")?,
            y: f("y")?,
            seq,
        },
        "stop" => RawCommand::Stop { seq },
        "aim" => RawCommand::Aim { a: f("a")? },
        "attack" => RawCommand::Attack {
            a: f("a")?,
            t: f("t"),
        },
        "release" => RawCommand::Release {
            a: f("a")?,
            t: f("t"),
        },
        "swap" => RawCommand::Swap {
            slot: match m.get("slot") {
                None => None,
                Some(v) => Some(u8::try_from(v.as_u64()?).ok()?),
            },
        },
        "pickup" => {
            // Legacy parseId admits up to 64 UTF-16 code units. Noncanonical but
            // well-formed strings (e.g. "c01") spend an order and miss; never let
            // radix conversion alias them onto the real object named "c1".
            let id = m.get("containerId").and_then(Value::as_str);
            let container_id = match id {
                Some(id) if (1..=64).contains(&id.encode_utf16().count()) => id
                    .strip_prefix('c')
                    .and_then(|s| u32::from_str_radix(s, 36).ok())
                    .filter(|&n| n != 0 && super::combat::id36(n) == id)
                    .unwrap_or(u32::MAX),
                _ => 0, // validation refusal
            };
            RawCommand::Pickup { container_id }
        }
        _ => return None,
    })
}

/// Every legacy event kind with a complete Rust projection. Unknown kinds always fail.
pub const EVENT_KINDS: &[&str] = &[
    "windup",
    "swing",
    "hit",
    "death",
    "victory",
    "raidEnded",
    "bounty",
    "stagger",
    "block",
    "toast",
    "raidStarted",
];
