//! Output: the raw JSON of a run, a human summary next to it, and the sweep table.

use serde_json::{json, Value};
use std::fmt::Write as _;
use std::path::Path;

pub fn write_report(dir: &Path, label: &str, report: &Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(report).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{label}.json")), json)
        .map_err(|e| format!("write report: {e}"))?;
    std::fs::write(
        dir.join(format!("{label}.summary.txt")),
        summary_text(report),
    )
    .map_err(|e| format!("write summary: {e}"))?;
    Ok(())
}

fn f(v: &Value) -> String {
    match v {
        Value::Null => "n/a".into(),
        Value::Number(n) => match n.as_f64() {
            Some(x) if x.fract() == 0.0 => format!("{}", x as i64),
            Some(x) => format!("{x:.2}"),
            None => n.to_string(),
        },
        other => other.to_string().trim_matches('"').to_string(),
    }
}

fn dist(v: &Value, unit: &str) -> String {
    if v.is_null() {
        return "no samples".into();
    }
    format!(
        "n={} p50 {}{unit} p95 {}{unit} p99 {}{unit} max {}{unit}",
        f(&v["count"]),
        f(&v["p50"]),
        f(&v["p95"]),
        f(&v["p99"]),
        f(&v["max"])
    )
}

/// The human summary of one run report. Every figure here is read back from the JSON, so the two always agree.
pub fn summary_text(r: &Value) -> String {
    let mut s = String::new();
    let m = &r["meta"];
    let h = &m["host"];
    let _ = writeln!(
        s,
        "rh-load run {}  ({})",
        f(&r["label"]),
        f(&r["label_note"])
    );
    let _ = writeln!(
        s,
        "revision {}  profile {}  protocol {}  content {}",
        f(&m["gitRevision"]),
        f(&m["server"]["buildProfile"]),
        f(&m["server"]["protocol"]),
        f(&m["server"]["contentHash"])
    );
    let _ = writeln!(
        s,
        "host: {} ({}) | {} cores | {} GiB | {} | arch {} | emulated {}",
        f(&h["hardwareLabel"]),
        f(&h["cpu"]),
        f(&h["logicalCores"]),
        h["memoryBytes"]
            .as_u64()
            .map_or("n/a".into(), |b| (b >> 30).to_string()),
        f(&h["os"]),
        f(&h["arch"]),
        f(&h["emulated"])
    );
    let _ = writeln!(
        s,
        "transport: {}   raw output: {}",
        f(&m["transport"]),
        f(&m["rawOutput"])
    );
    let sc = &r["scenario"];
    let _ = writeln!(s, "scenario: {} matches x {} players ({} players), ramp {}/s, steady {} s, think {} ms, aggression {}, reconnect {} (every {} s), churn clients {}, slow {} , max-rooms {}", f(&sc["matches"]), f(&sc["playersPerMatch"]), f(&sc["totalPlayers"]), f(&sc["rampPerSec"]), f(&sc["durationSecs"]), f(&sc["thinkMs"]), f(&sc["aggression"]), f(&sc["reconnectFraction"]), f(&sc["reconnectEverySecs"]), f(&sc["churnClients"]), f(&sc["slowFraction"]), f(&sc["maxRooms"]));
    let t = &r["timing"];
    let _ = writeln!(
        s,
        "timing: ramp {} s, steady {} s, total {} s",
        f(&t["rampSecs"]),
        f(&t["steadySecs"]),
        f(&t["totalSecs"])
    );
    let _ = writeln!(
        s,
        "cold start: control health {} ms, public port {} ms",
        f(&r["coldStart"]["controlHealthMs"]),
        f(&r["coldStart"]["publicPortMs"])
    );
    let c = &r["capacity"];
    let _ = writeln!(s, "capacity: rooms peak {} (steady mean {}, min {}), players wanted {} admitted {} never admitted {}", f(&c["roomsPeak"]), f(&c["roomsSteadyMean"]), f(&c["roomsSteadyMin"]), f(&c["playersWanted"]), f(&c["playersAdmittedAtLeastOnce"]), f(&c["playersNeverAdmitted"]));
    let sv = &r["server"];
    let _ = writeln!(
        s,
        "server cpu (cores): steady mean {} max {} whole-run mean {} | rss MB peak {} mean {}",
        f(&sv["cpuCoresSteadyMean"]),
        f(&sv["cpuCoresSteadyMax"]),
        f(&sv["cpuCoresWholeRunMean"]),
        f(&sv["rssMbPeak"]),
        f(&sv["rssMbMean"])
    );
    let mm = &sv["metricsFinal"];
    let _ = writeln!(s, "server step us: p50 {} p99 {} max {} (steps {}, dropped {}) | publish us p50 {} p99 {} | wake lateness us p50 {} p99 {} max {}", f(&mm["stepUs"]["p50"]), f(&mm["stepUs"]["p99"]), f(&mm["stepUs"]["max"]), f(&mm["steps"]), f(&mm["droppedSteps"]), f(&mm["publishUs"]["p50"]), f(&mm["publishUs"]["p99"]), f(&mm["latenessUs"]["p50"]), f(&mm["latenessUs"]["p99"]), f(&mm["latenessUs"]["max"]));
    let ct = &r["clientTick"];
    let si = &ct["snapshotIntervalMs"];
    let _ = writeln!(s, "client snapshot interval ms (50 ideal): n={} p50 {} p95 {} p99 {} p99.9 {} max {} | late>100ms {} >200ms {} >500ms {} | ticks missed {}", f(&si["count"]), f(&si["p50"]), f(&si["p95"]), f(&si["p99"]), f(&si["p999"]), f(&si["max"]), f(&ct["lateSnapshots100ms"]), f(&ct["lateSnapshots200ms"]), f(&ct["lateSnapshots500ms"]), f(&ct["ticksMissed"]));
    let a = &r["admission"];
    let _ = writeln!(s, "connect ms: {}", dist(&a["connectMs"], ""));
    let _ = writeln!(s, "hello->welcome ms: {}", dist(&a["helloToWelcomeMs"], ""));
    let _ = writeln!(
        s,
        "welcome->first snapshot ms: {}",
        dist(&a["welcomeToFirstSnapshotMs"], "")
    );
    let _ = writeln!(
        s,
        "resume hello->welcome ms: {}",
        dist(&a["resumeHelloToWelcomeMs"], "")
    );
    let _ = writeln!(
        s,
        "refusals by reason: {}   connect errors {}",
        f(&a["refusalsByReason"]),
        f(&a["connectErrors"])
    );
    let b = &r["bandwidth"];
    let _ = writeln!(
        s,
        "bandwidth per client B/s in: {}",
        dist(&b["perClientBytesPerSecIn"], "")
    );
    let _ = writeln!(
        s,
        "bandwidth per client B/s out: {}",
        dist(&b["perClientBytesPerSecOut"], "")
    );
    let rc = &r["reconnect"];
    let _ = writeln!(
        s,
        "reconnect: attempts {} ok {} failed {} success rate {} failures {}",
        f(&rc["attempts"]),
        f(&rc["ok"]),
        f(&rc["failed"]),
        f(&rc["successRate"]),
        f(&rc["failuresByReason"])
    );
    let _ = writeln!(
        s,
        "slow consumers: started {} outcomes {}",
        f(&r["slowConsumers"]["started"]),
        f(&r["slowConsumers"]["outcomes"])
    );
    let _ = writeln!(
        s,
        "churn: joins {} leaves {}",
        f(&r["churn"]["joins"]),
        f(&r["churn"]["leaves"])
    );
    let p = &r["play"];
    let _ = writeln!(
        s,
        "play: results {} inputs {} snapshots {} decode errors {} abnormal ends {} other {}",
        f(&p["results"]),
        f(&p["inputsSent"]),
        f(&p["snapshots"]),
        f(&p["decodeErrors"]),
        f(&p["sessionsEndedAbnormally"]),
        f(&p["otherEvents"])
    );
    let sd = &r["shutdown"];
    if !sd.is_null() {
        let _ = writeln!(s, "shutdown ({}): rooms at trigger {} -> exit after {} s (timed out: {}), first admission refusal after {} ms, fresh welcomes after trigger {}, resume welcomes {}, results after trigger {}, abnormal ends {}, refusals {}", f(&sd["mode"]), f(&sd["roomsAtTrigger"]), f(&sd["serverExitedAfterSecs"]), f(&sd["timedOutWaitingForExit"]), f(&sd["firstAdmissionRefusalMs"]), f(&sd["freshWelcomesAfterTrigger"]), f(&sd["resumeWelcomesAfterTrigger"]), f(&sd["resultsAfterTrigger"]), f(&sd["abnormalSessionEndsAfterTrigger"]), f(&sd["refusalsAfterTrigger"]));
    }
    let v = &r["verdict"];
    let _ = writeln!(
        s,
        "verdict: {} {}",
        if v["degraded"] == true {
            "DEGRADED"
        } else {
            "healthy"
        },
        f(&v["reasons"])
    );
    s
}

/// The row of a sweep table for one level's report.
pub fn sweep_row(r: &Value) -> Value {
    let mm = &r["server"]["metricsFinal"];
    json!({
        "matches": r["scenario"]["matches"], "players": r["scenario"]["totalPlayers"],
        "roomsSteadyMean": r["capacity"]["roomsSteadyMean"], "playersNeverAdmitted": r["capacity"]["playersNeverAdmitted"],
        "cpuCoresSteadyMean": r["server"]["cpuCoresSteadyMean"], "rssMbPeak": r["server"]["rssMbPeak"],
        "stepUsP50": mm["stepUs"]["p50"], "stepUsP99": mm["stepUs"]["p99"], "stepUsMax": mm["stepUs"]["max"],
        "droppedSteps": mm["droppedSteps"], "latenessUsP99": mm["latenessUs"]["p99"],
        "clientIntervalMsP50": r["clientTick"]["snapshotIntervalMs"]["p50"], "clientIntervalMsP95": r["clientTick"]["snapshotIntervalMs"]["p95"],
        "clientIntervalMsP99": r["clientTick"]["snapshotIntervalMs"]["p99"], "ticksMissed": r["clientTick"]["ticksMissed"],
        "helloToWelcomeMsP95": r["admission"]["helloToWelcomeMs"]["p95"],
        "bytesPerSecInP50": r["bandwidth"]["perClientBytesPerSecIn"]["p50"],
        "harnessCpuCoresNote": "see series",
        "degraded": r["verdict"]["degraded"], "reasons": r["verdict"]["reasons"],
        "report": r["meta"]["rawOutput"],
    })
}

pub fn sweep_table(rows: &[Value]) -> String {
    let mut s = String::new();
    let _ = writeln!(s, "matches players rooms(steady) cpu(cores) rssMB  step p50/p99/max us  dropped lateness p99us  client int p50/p95/p99 ms  missed  verdict");
    for r in rows {
        let _ = writeln!(
            s,
            "{:>7} {:>7} {:>13} {:>10} {:>5} {:>8}/{}/{} {:>7} {:>12} {:>10}/{}/{} {:>7}  {}",
            f(&r["matches"]),
            f(&r["players"]),
            f(&r["roomsSteadyMean"]),
            f(&r["cpuCoresSteadyMean"]),
            f(&r["rssMbPeak"]),
            f(&r["stepUsP50"]),
            f(&r["stepUsP99"]),
            f(&r["stepUsMax"]),
            f(&r["droppedSteps"]),
            f(&r["latenessUsP99"]),
            f(&r["clientIntervalMsP50"]),
            f(&r["clientIntervalMsP95"]),
            f(&r["clientIntervalMsP99"]),
            f(&r["ticksMissed"]),
            if r["degraded"] == true {
                format!("DEGRADED {}", f(&r["reasons"]))
            } else {
                "healthy".into()
            }
        );
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_format_compactly_and_null_is_na() {
        assert_eq!(f(&json!(5.0)), "5");
        assert_eq!(f(&json!(5.126)), "5.13");
        assert_eq!(f(&Value::Null), "n/a");
        assert_eq!(f(&json!("x")), "x");
        assert_eq!(dist(&Value::Null, "ms"), "no samples");
    }

    #[test]
    fn summary_reads_back_the_json_and_never_panics_on_a_sparse_report() {
        let r = json!({"label": "t", "meta": {"gitRevision": "abc", "host": {"memoryBytes": 64u64 << 30, "arch": "aarch64", "emulated": false}},
                        "verdict": {"degraded": true, "reasons": ["step p99"]}, "capacity": {"roomsPeak": 4}});
        let t = summary_text(&r);
        assert!(
            t.contains("revision abc")
                && t.contains("64 GiB")
                && t.contains("emulated false")
                && t.contains("DEGRADED")
        );
        assert!(summary_text(&Value::Null).contains("healthy"));
    }

    #[test]
    fn sweep_rows_and_table() {
        let r = json!({"scenario": {"matches": 10, "totalPlayers": 80}, "verdict": {"degraded": false, "reasons": []}, "meta": {"rawOutput": "x.json"}});
        let row = sweep_row(&r);
        assert_eq!(row["matches"], 10);
        let t = sweep_table(&[row]);
        assert!(t.contains("healthy") && t.lines().count() == 2);
    }

    #[test]
    fn reports_are_written_next_to_each_other() {
        let dir = std::env::temp_dir().join(format!("rh-load-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        write_report(
            &dir,
            "lbl",
            &json!({"label": "lbl", "verdict": {"degraded": false}}),
        )
        .unwrap();
        assert!(dir.join("lbl.json").exists() && dir.join("lbl.summary.txt").exists());
        let back: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("lbl.json")).unwrap()).unwrap();
        assert_eq!(back["label"], "lbl");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
