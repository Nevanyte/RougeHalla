//! cargo run -p rh-protocol --bin protocol-fixtures : rewrites protocol/fixtures/v1.json (commit the result; the tests fail
//! when the encoding and the committed vectors differ).
fn main() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../protocol/fixtures/v1.json");
    std::fs::write(&path, rh_protocol::samples::manifest()).expect("write vectors");
    println!("wrote {}", path.display());
}
