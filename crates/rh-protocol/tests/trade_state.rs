use rh_protocol::samples::{client_samples, server_samples};
use rh_protocol::*;

fn state_named(name: &str) -> ServerMsg {
    server_samples()
        .into_iter()
        .find_map(|(candidate, msg)| (candidate == name).then_some(msg))
        .unwrap_or_else(|| panic!("missing server sample {name}"))
}

#[test]
fn trade_codes_and_command_18_are_closed_and_round_trip() {
    assert_eq!(WireTradeKind::from_code(0), Some(WireTradeKind::Barter));
    assert_eq!(WireTradeKind::from_code(1), Some(WireTradeKind::Stats));
    assert_eq!(WireTradeKind::from_code(2), None);
    for code in 0..=6 {
        assert_eq!(WireTradeStat::from_code(code).unwrap().code(), code);
    }
    assert_eq!(WireTradeStat::from_code(7), None);

    let (name, message) = client_samples()
        .into_iter()
        .find(|(name, _)| *name == "input_trade")
        .unwrap();
    assert_eq!(name, "input_trade");
    assert_eq!(ClientMsg::decode(&message.encode()).unwrap(), message);
    let ClientMsg::Input { commands, .. } = message else {
        panic!("trade sample is input")
    };
    assert_eq!(commands.len(), 6);
}

#[test]
fn trade_state_preserves_availability_exact_f64_order_and_empty_rows() {
    let available = state_named("state_trade_available");
    assert_eq!(ServerMsg::decode(&available.encode()).unwrap(), available);
    let ServerMsg::State { items, .. } = &available else {
        panic!("trade vector is state")
    };
    let StateItem::Trade(Some(view)) = &items[0] else {
        panic!("trade vector is available")
    };
    assert_eq!(view.offers[0].cost_value.to_bits(), 0x3ff0_0000_0000_0001);
    assert_eq!(view.offers[0].gain_value.to_bits(), f64::MAX.to_bits());
    assert_eq!(view.stats[0].value.to_bits(), (-0.0f64).to_bits());
    assert_eq!(
        view.stats[1].stat,
        WireTradeStat::Ad,
        "duplicates remain in order"
    );
    assert_eq!(view.stats[1].value.to_bits(), (-f64::MAX).to_bits());
    assert_eq!(view.barter_ready_at.unwrap().to_bits(), (-0.0f64).to_bits());
    assert_eq!(view.merchants[0].x, 0.0);
    assert_eq!(view.merchants[0].y, 8191.875);

    let empty = state_named("state_trade_empty");
    let unavailable = state_named("state_trade_unavailable");
    assert_ne!(empty.encode(), unavailable.encode());
    assert_eq!(ServerMsg::decode(&empty.encode()).unwrap(), empty);
    assert_eq!(
        ServerMsg::decode(&unavailable.encode()).unwrap(),
        unavailable
    );
}

#[test]
fn trade_payload_reaches_exact_2213_byte_bound_and_all_eleven_keys_fit() {
    let max_trade = state_named("state_trade_max_2213");
    let bytes = max_trade.try_encode().unwrap();
    // tag + two-byte tick + item count + State key + 2213-byte value including availability.
    assert_eq!(bytes.len(), 1 + 2 + 1 + 1 + MAX_TRADE_VIEW_BYTES);
    assert_eq!(ServerMsg::decode(&bytes).unwrap(), max_trade);

    let all = state_named("state_eleven_keys");
    let ServerMsg::State { items, .. } = &all else {
        panic!("all-keys vector is state")
    };
    assert_eq!(items.len(), 11);
    assert_eq!(items.last().unwrap().key(), 11);
    assert!(all.try_encode().unwrap().len() <= MAX_SERVER_FRAME);
}

#[test]
fn trade_string_caps_count_utf8_bytes_and_refuse_without_truncation() {
    let StateItem::Trade(Some(mut view)) = (match state_named("state_trade_available") {
        ServerMsg::State { mut items, .. } => items.remove(0),
        _ => unreachable!(),
    }) else {
        unreachable!()
    };
    view.offers[0].label = "é".repeat(128); // 256 UTF-8 bytes, despite only 128 scalars.
    assert_eq!(
        view.check(),
        Err(EncodeError::StringTooLong {
            what: "trade offer label",
            len: 256,
        })
    );
}
