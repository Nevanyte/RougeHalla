#![allow(dead_code)]
//! A minimal HTTP/1.1 client (one request per connection) for the account API tests, so they drive the real listener with
//! no extra dependency. Bodies are read to EOF (`Connection: close`).

use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[derive(Debug, Clone)]
pub struct Resp {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Resp {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_str(&self.body)
            .unwrap_or_else(|e| panic!("not JSON ({e}): {:?}", self.body))
    }
}

pub async fn request(
    addr: SocketAddr,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&[u8]>,
) -> Resp {
    request_raw(addr, method, path, headers, body, true).await
}

/// `send_body` false declares the Content-Length but never sends the bytes (a stalled client).
pub async fn request_raw(
    addr: SocketAddr,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&[u8]>,
    send_body: bool,
) -> Resp {
    let mut s = TcpStream::connect(addr).await.expect("connect");
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: test\r\nConnection: close\r\n");
    for (k, v) in headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    if let Some(b) = body {
        head.push_str(&format!("Content-Length: {}\r\n", b.len()));
    }
    head.push_str("\r\n");
    // The server may answer (413) and close before reading everything: a failed write is fine, the reply is still read.
    let _ = s.write_all(head.as_bytes()).await;
    if let (Some(b), true) = (body, send_body) {
        let _ = s.write_all(b).await;
    }
    let mut raw = Vec::new();
    let _ = s.read_to_end(&mut raw).await;
    let text = String::from_utf8_lossy(&raw).to_string();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let mut lines = head.lines();
    let status: u16 = lines
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|c| c.parse().ok())
        .unwrap_or_else(|| panic!("no status line in {text:?}"));
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned()))
        .collect();
    Resp {
        status,
        headers,
        body: body.to_owned(),
    }
}

pub async fn get(addr: SocketAddr, path: &str, headers: &[(&str, &str)]) -> Resp {
    request(addr, "GET", path, headers, None).await
}

pub async fn post_json(addr: SocketAddr, path: &str, headers: &[(&str, &str)], body: &str) -> Resp {
    let mut h = vec![("Content-Type", "application/json")];
    h.extend_from_slice(headers);
    request(addr, "POST", path, &h, Some(body.as_bytes())).await
}
