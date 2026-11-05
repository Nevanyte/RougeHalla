//! End to end with the REAL Go bridge and the REAL rh-server binary, no AWS: GameLift is played by the bridge's scripted fake SDK
//! (the `fakesdk` build of hosting/glbridge, see hosting/README.md), the game client is a real WebSocket client.
//!
//!   OnStartGameSession -> POST /control/session -> ActivateGameSession
//!   reserved player session -> POST /control/admit -> a client joins with its profile token -> AcceptPlayerSession
//!   a dropped client resumes inside the grace (no Remove, no second Accept)
//!   a dropped client stays away past the grace -> `left` -> RemovePlayerSession
//!   OnProcessTerminate -> drain -> the last player leaves -> ProcessEnding -> Destroy -> the bridge exits 0, rh-server is gone
//!
//! `#[ignore]` because it needs a glbridge binary for this host: `hosting/scripts/e2e-bridge.sh` builds it (in the pinned
//! golang image) and runs this test with RH_GLBRIDGE_FAKE set. It takes about 25 s (rh-server's real 10 s reconnect grace).

#[path = "support/http.rs"]
mod http;
#[path = "support/ws.rs"]
mod ws;

use http::{get, post_json};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::process::{Child, Command};
use std::time::{Duration, Instant};
use ws::try_join;

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

struct Proc(Child);
impl Drop for Proc {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// The SDK calls so far, from the file the fake SDK appends to (it survives the bridge process).
async fn calls(file: &std::path::Path) -> Vec<String> {
    std::fs::read_to_string(file)
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

async fn until<F, Fut>(what: &str, secs: u64, mut f: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(secs) {
        if f().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("timed out after {secs} s waiting for: {what}");
}

async fn rooms(control: SocketAddr) -> Value {
    get(control, "/control/rooms", &[]).await.json()
}

fn player_status(rooms: &Value, psid: &str) -> Option<String> {
    rooms["rooms"][0]["players"]
        .as_array()?
        .iter()
        .find(|p| p["playerSessionId"] == psid)
        .and_then(|p| p["status"].as_str().map(str::to_string))
}

fn index_of(calls: &[String], call: &str) -> usize {
    calls
        .iter()
        .position(|c| c == call)
        .unwrap_or_else(|| panic!("{call} missing from {calls:?}"))
}

#[tokio::test]
#[ignore = "needs RH_GLBRIDGE_FAKE (a fakesdk glbridge for this host); run hosting/scripts/e2e-bridge.sh"]
async fn the_real_bridge_drives_the_real_server_through_a_whole_game_session() {
    let bridge_bin = std::env::var("RH_GLBRIDGE_FAKE").expect("RH_GLBRIDGE_FAKE");
    let (game, ctl, script) = (free_port(), free_port(), free_port());
    let (control, script): (SocketAddr, SocketAddr) = (
        format!("127.0.0.1:{ctl}").parse().unwrap(),
        format!("127.0.0.1:{script}").parse().unwrap(),
    );
    let map = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/maps/seed1.map.json"
    );
    let log = std::fs::File::create(
        std::env::temp_dir().join(format!("glbridge-e2e-{}.log", std::process::id())),
    )
    .unwrap();
    let calls_file =
        std::env::temp_dir().join(format!("glbridge-e2e-calls-{}.txt", std::process::id()));
    let _ = std::fs::remove_file(&calls_file);
    let mut bridge = Proc(
        Command::new(&bridge_bin)
            .args([
                "--server-bin",
                env!("CARGO_BIN_EXE_rh-server"),
                "--control-addr",
                &format!("127.0.0.1:{ctl}"),
                "--game-port",
                &game.to_string(),
                "--map",
                map,
                "--poll-interval",
                "100ms",
                "--admit-interval",
                "100ms",
                "--drain-deadline",
                "60s",
                "--",
                // Two humans are needed to start a match and the lobby timer is long: the room stays a lobby for the test.
                "--lobby-seconds",
                "600",
            ])
            .env("GLBRIDGE_FAKE_ADDR", script.to_string())
            .env("GLBRIDGE_FAKE_CALLS", &calls_file)
            .stdout(log.try_clone().unwrap())
            .stderr(log)
            .spawn()
            .expect("spawn the fake-SDK bridge"),
    );
    let post = |path: &'static str, body: Value| async move {
        let r = post_json(script, path, &[], &body.to_string()).await;
        assert_eq!(r.status, 200, "{path}: {}", r.body);
    };

    // The bridge starts rh-server, waits for control.requireAdmit, then ProcessReady.
    until("ProcessReady", 30, || async {
        calls(&calls_file)
            .await
            .contains(&format!("ProcessReady:{game}"))
    })
    .await;
    let h = get(control, "/control/health", &[]).await.json();
    assert_eq!(h["control"]["requireAdmit"], true);
    assert_eq!(h["control"]["maxRooms"], 1);

    // GameLift starts a game session; the bridge creates the room and activates.
    post(
        "/start",
        json!({"id": "arn:test:game-session/gs-1", "maxPlayers": 4}),
    )
    .await;
    until("Activate", 10, || async {
        calls(&calls_file).await.contains(&"Activate".to_string())
    })
    .await;
    let r = rooms(control).await;
    assert_eq!(r["rooms"][0]["gameSessionId"], "arn:test:game-session/gs-1");
    assert_eq!(r["rooms"][0]["phase"], "lobby");

    // Two player sessions reserved by the backend (PlayerId = callsign). The bridge admits them.
    post(
        "/reserve",
        json!({"id": "psess-alice", "playerId": "alice"}),
    )
    .await;
    post("/reserve", json!({"id": "psess-bob", "playerId": "bob"})).await;
    until("both admitted", 10, || async {
        let r = rooms(control).await;
        player_status(&r, "psess-alice").as_deref() == Some("admitted")
            && player_status(&r, "psess-bob").as_deref() == Some("admitted")
    })
    .await;

    // The game server is a real listener: an unadmitted callsign is refused, the admitted ones join with their profile token
    // (the dev auth accepts any ticket; the admit is the extra gate).
    let url = format!("ws://127.0.0.1:{game}/ws");
    let nope = try_join(&url, "mallory", "t", None).await;
    assert_eq!(nope.err().unwrap().1, "not admitted");
    let alice = try_join(&url, "alice", "t", None)
        .await
        .expect("alice joins");
    let mut bob = try_join(&url, "bob", "t", None).await.expect("bob joins");
    until("both accepted", 10, || async {
        let c = calls(&calls_file).await;
        c.contains(&"Accept:psess-alice".to_string()) && c.contains(&"Accept:psess-bob".to_string())
    })
    .await;

    // A drop and a resume inside the grace: no RemovePlayerSession, no second AcceptPlayerSession, never `left`.
    let session = alice.session;
    alice.drop_socket();
    until("alice away", 10, || async {
        player_status(&rooms(control).await, "psess-alice").as_deref() == Some("away")
    })
    .await;
    let alice = try_join(&url, "alice", "no-ticket-needed-to-resume", Some(session))
        .await
        .expect("resume inside the grace");
    until("alice seated again", 10, || async {
        player_status(&rooms(control).await, "psess-alice").as_deref() == Some("seated")
    })
    .await;
    tokio::time::sleep(Duration::from_millis(800)).await;
    let c = calls(&calls_file).await;
    assert!(
        !c.iter().any(|x| x.starts_with("Remove:")),
        "no seat removed by a resumed drop: {c:?}"
    );
    assert_eq!(
        c.iter().filter(|x| *x == "Accept:psess-alice").count(),
        1,
        "{c:?}"
    );

    // A drop that outlasts the grace (10 s in the real server): away first, `left` and RemovePlayerSession only after it.
    let dropped_at = Instant::now();
    alice.drop_socket();
    until("alice away", 10, || async {
        player_status(&rooms(control).await, "psess-alice").as_deref() == Some("away")
    })
    .await;
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert!(
        !calls(&calls_file)
            .await
            .iter()
            .any(|x| x.starts_with("Remove:")),
        "no Remove while the seat is within its grace"
    );
    until("alice left and removed", 20, || async {
        calls(&calls_file)
            .await
            .contains(&"Remove:psess-alice".to_string())
    })
    .await;
    assert!(
        dropped_at.elapsed() >= Duration::from_secs(9),
        "removed only after the ~10 s grace: {:?}",
        dropped_at.elapsed()
    );
    until("the record is acknowledged", 10, || async {
        // The bridge acked it: a replayed admit now says the player left, and it is still not seatable.
        let r = post_json(
            control,
            "/control/admit",
            &[],
            &json!({"v":1,"gameSessionId":"arn:test:game-session/gs-1","playerSessionId":"psess-alice","callsign":"alice"}).to_string(),
        )
        .await;
        r.json()["state"] == "left"
    })
    .await;
    let replay = try_join(&url, "alice", "t", None).await;
    assert_eq!(
        replay.err().unwrap().1,
        "not admitted",
        "a left player session is never re-armed"
    );

    // OnProcessTerminate: the bridge drains. The room still has bob, so nothing ends yet.
    post("/terminate", json!({})).await;
    until("draining", 10, || async {
        get(control, "/control/health", &[]).await.json()["state"] == "draining"
    })
    .await;
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(
        bridge.0.try_wait().unwrap().is_none(),
        "the bridge waits for the room"
    );
    assert!(!calls(&calls_file)
        .await
        .contains(&"ProcessEnding".to_string()));

    // The last player leaves: the room closes, rh-server terminates, the bridge reports ProcessEnding and exits 0.
    bob.leave().await;
    let t = Instant::now();
    let status = loop {
        if let Some(s) = bridge.0.try_wait().unwrap() {
            break s;
        }
        assert!(
            t.elapsed() < Duration::from_secs(30),
            "the bridge did not exit"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    assert!(status.success(), "bridge exit status {status}");
    let c = calls(&calls_file).await;
    assert!(index_of(&c, "Activate") < index_of(&c, "Accept:psess-alice"));
    assert!(index_of(&c, "Remove:psess-alice") < index_of(&c, "ProcessEnding"));
    assert!(index_of(&c, "ProcessEnding") < index_of(&c, "Destroy"));
    // rh-server died with the bridge (it was its child and drained itself) (it was the bridge's child and drained itself).
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        tokio::net::TcpStream::connect(control).await.is_err(),
        "rh-server is gone"
    );
}
