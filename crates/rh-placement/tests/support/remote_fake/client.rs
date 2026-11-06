//! Backend adapters over the remote fake. Every transport failure is `Unavailable` (ambiguous, like a real network error);
//! a dead server never panics. Each call is one connection and runs under one overall timeout.

use super::wire::{WireReq, WireResp};
use rh_placement::backend::{
    BackendError, DnsBackend, GameLiftBackend, PlacementState, StartPlacement,
};
use rh_placement::RegionCapacity;
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

pub const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(5);

async fn call(addr: SocketAddr, limit: Duration, req: &WireReq) -> Result<WireResp, BackendError> {
    let unavailable = |why: &str| BackendError::Unavailable(format!("remote fake: {why}"));
    let mut line = serde_json::to_string(req).map_err(|_| unavailable("encode"))?;
    line.push('\n');
    let io = async {
        let mut stream = TcpStream::connect(addr)
            .await
            .map_err(|_| unavailable("connect"))?;
        stream
            .write_all(line.as_bytes())
            .await
            .map_err(|_| unavailable("write"))?;
        stream.flush().await.map_err(|_| unavailable("write"))?;
        let mut reply = String::new();
        let n = BufReader::new(stream)
            .read_line(&mut reply)
            .await
            .map_err(|_| unavailable("read"))?;
        if n == 0 {
            return Err(unavailable("connection closed"));
        }
        serde_json::from_str::<WireResp>(reply.trim_end()).map_err(|_| unavailable("bad reply"))
    };
    match tokio::time::timeout(limit, io).await {
        Ok(r) => r,
        Err(_) => Err(unavailable("timed out")),
    }
}

fn placement(r: WireResp) -> Result<PlacementState, BackendError> {
    match r {
        WireResp::Placement { state } => Ok(state.into()),
        WireResp::Err { err } => Err(err.into()),
        _ => Err(BackendError::Unavailable(
            "remote fake: unexpected reply".into(),
        )),
    }
}

fn unit(r: WireResp) -> Result<(), BackendError> {
    match r {
        WireResp::Unit => Ok(()),
        WireResp::Err { err } => Err(err.into()),
        _ => Err(BackendError::Unavailable(
            "remote fake: unexpected reply".into(),
        )),
    }
}

#[derive(Clone, Debug)]
pub struct RemoteGameLift {
    addr: SocketAddr,
    timeout: Duration,
}

impl RemoteGameLift {
    pub fn new(addr: SocketAddr, timeout: Duration) -> Self {
        Self { addr, timeout }
    }
    pub fn with_default_timeout(addr: SocketAddr) -> Self {
        Self::new(addr, DEFAULT_CALL_TIMEOUT)
    }
}

impl GameLiftBackend for RemoteGameLift {
    async fn start_placement(&self, req: &StartPlacement) -> Result<PlacementState, BackendError> {
        placement(call(self.addr, self.timeout, &WireReq::from_start(req)).await?)
    }
    async fn describe_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        let r = WireReq::Describe {
            placement_id: id.to_string(),
        };
        placement(call(self.addr, self.timeout, &r).await?)
    }
    async fn stop_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        let r = WireReq::Stop {
            placement_id: id.to_string(),
        };
        placement(call(self.addr, self.timeout, &r).await?)
    }
    async fn terminate_game_session(&self, arn: &str) -> Result<(), BackendError> {
        let r = WireReq::Terminate {
            arn: arn.to_string(),
        };
        unit(call(self.addr, self.timeout, &r).await?)
    }
    async fn capacity(&self) -> Result<BTreeMap<String, RegionCapacity>, BackendError> {
        match call(self.addr, self.timeout, &WireReq::Capacity).await? {
            WireResp::Capacity { regions } => Ok(regions
                .into_iter()
                .map(|(k, v)| {
                    (
                        k,
                        RegionCapacity {
                            available_sessions: v,
                        },
                    )
                })
                .collect()),
            WireResp::Err { err } => Err(err.into()),
            _ => Err(BackendError::Unavailable(
                "remote fake: unexpected reply".into(),
            )),
        }
    }
}

#[derive(Clone, Debug)]
pub struct RemoteDns {
    addr: SocketAddr,
    timeout: Duration,
}

impl RemoteDns {
    pub fn new(addr: SocketAddr, timeout: Duration) -> Self {
        Self { addr, timeout }
    }
    pub fn with_default_timeout(addr: SocketAddr) -> Self {
        Self::new(addr, DEFAULT_CALL_TIMEOUT)
    }
}

impl DnsBackend for RemoteDns {
    async fn upsert(&self, name: &str, ip: &str, ttl_s: u32) -> Result<(), BackendError> {
        let r = WireReq::DnsUpsert {
            name: name.to_string(),
            ip: ip.to_string(),
            ttl_s,
        };
        unit(call(self.addr, self.timeout, &r).await?)
    }
    async fn delete(&self, name: &str) -> Result<(), BackendError> {
        let r = WireReq::DnsDelete {
            name: name.to_string(),
        };
        unit(call(self.addr, self.timeout, &r).await?)
    }
    async fn resolve_authoritative(&self, name: &str) -> Result<Vec<String>, BackendError> {
        let r = WireReq::DnsResolve {
            name: name.to_string(),
        };
        match call(self.addr, self.timeout, &r).await? {
            WireResp::Addrs { addrs } => Ok(addrs),
            WireResp::Err { err } => Err(err.into()),
            _ => Err(BackendError::Unavailable(
                "remote fake: unexpected reply".into(),
            )),
        }
    }
}
