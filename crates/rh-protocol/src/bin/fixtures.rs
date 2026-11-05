//! cargo run -p rh-protocol --bin protocol-fixtures : rewrites protocol/fixtures/v<PROTOCOL_VERSION>.json (commit the result; the
//! tests fail when the encoding and the committed vectors differ). Only the current version's file is kept.
fn main() {
    let name = format!("v{}.json", rh_protocol::PROTOCOL_VERSION);
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../protocol/fixtures")
        .join(name);
    std::fs::write(&path, rh_protocol::samples::manifest()).expect("write vectors");
    println!("wrote {}", path.display());
}
