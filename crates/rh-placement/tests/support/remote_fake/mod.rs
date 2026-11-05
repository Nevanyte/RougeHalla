//! A persistent fake GameLift + DNS hosted by a PARENT test process over TCP, plus the client adapters a child service
//! process uses to reach it. Include with `#[path = ".../remote_fake/mod.rs"] mod remote_fake;` (tests) or from a bin.
//!
//! Protocol: newline-delimited JSON, ONE request per TCP connection, one response line. The server handles each request in
//! a detached task, so a client that dies (even SIGKILL) mid-request never affects the effect or the server. See
//! [`server::RemoteFake`] for the deterministic controls and the append-only mutation [`server::Mutation`] trace.
//!
//! Needs tokio features `rt`, `macros`, `time`, `net`, `io-util`, `sync` in rh-placement's manifest.
#![allow(dead_code)]

pub mod client;
pub mod server;
pub mod wire;

pub use client::{RemoteDns, RemoteGameLift};
#[allow(unused_imports)]
pub use server::{
    Barrier, ErrorKind, HeldInfo, HeldKind, Matcher, Mutation, RemoteFake, ReplyState, Stage,
};
pub use wire::Op;
