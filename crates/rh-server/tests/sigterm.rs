//! SIGTERM (how containers and the hosting bridge stop a process) drains: no new admissions, running matches finish, then
//! the process exits on its own. Unix only.
#![cfg(unix)]

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[test]
fn sigterm_drains_and_exits() {
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let mut child = Command::new(env!("CARGO_BIN_EXE_rh-server"))
        .args(["--bind", &format!("127.0.0.1:{port}")])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start rh-server");
    // Wait until it serves.
    let t0 = Instant::now();
    while std::net::TcpStream::connect(("127.0.0.1", port)).is_err() {
        assert!(
            t0.elapsed() < Duration::from_secs(20),
            "server did not start"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    let status = Command::new("kill")
        .args(["-TERM", &child.id().to_string()])
        .status()
        .unwrap();
    assert!(status.success());
    let t1 = Instant::now();
    loop {
        if let Some(st) = child.try_wait().unwrap() {
            let mut err = String::new();
            use std::io::Read;
            child
                .stderr
                .take()
                .unwrap()
                .read_to_string(&mut err)
                .unwrap();
            assert!(err.contains("draining"), "it drained: {err}");
            assert!(
                err.contains("terminated"),
                "and terminated gracefully: {err}"
            );
            assert!(st.success(), "clean exit: {st:?}");
            break;
        }
        if t1.elapsed() > Duration::from_secs(15) {
            let _ = child.kill();
            panic!("SIGTERM did not end an idle server");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
