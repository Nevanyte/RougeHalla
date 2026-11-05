//! rh-load: a parameterized load and soak harness for `rh-server`. It opens ordinary authenticated WebSocket sessions
//! (protocol v5, ws or wss), joins matches, sends scripted inputs at human cadence and measures what the server does:
//! capacity, CPU and memory, tick behaviour, bandwidth, admission latency, reconnects, refusals and graceful shutdown.
//! Scripted only; it implements no game rule and uses no learned model. See crates/rh-load/README.md.

pub mod player;
pub mod report;
pub mod runner;
pub mod scenario;
pub mod script;
pub mod server;
pub mod shared;
pub mod stats;
pub mod sys;
