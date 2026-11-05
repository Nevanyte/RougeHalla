//! The local, fsynced result spool: a durable handoff between "a room resolved a result" and "PostgreSQL committed it".
//!
//! # What this guarantees, and what it does not (ADR 0006, "Addendum: durable result handoff")
//!
//! A result moves through three points:
//!
//! 1. **Emitted**: the room task sent `RoomReport::Result` on an in-memory channel. Nothing is durable.
//! 2. **Spooled**: [`ResultSpool::append`] wrote a versioned, checksummed record to a temporary file, `fsync`ed it,
//!    renamed it into place and `fsync`ed the directory. The record now survives a *process* crash or restart on the
//!    same host and volume. Logged and counted as `spooled`.
//! 3. **Committed**: the fenced PostgreSQL transaction (`record_result_by_id`) returned `Applied` or `AlreadyApplied`.
//!    Only now is the record removed. This is the only point that survives *host loss*. Logged and counted as `committed`.
//!
//! The window that can still lose a result is point 1 to point 2: the process dying after the room emitted the result
//! and before the record was renamed and the directory synced (a few milliseconds on a healthy disk), plus any result
//! whose append failed because the spool was full or unwritable (it then falls back to the in-memory retry that existed
//! before the spool, and is counted). A match interrupted by a process death before it emitted results produced no
//! result at all; nothing here, or anywhere, invents one.
//!
//! The spool is **not** host-loss durable: a replaced instance or a lost volume loses every spooled record. Making it so
//! needs an off-host durable write (for example a queue or object store with its own durability and fencing story), which
//! is a different dependency and a different failure analysis; the packet's own boundary is the PostgreSQL commit, so the
//! spool is deliberately only a same-host crash buffer.
//!
//! Records hold exactly what will be written: the profile id, the original lease fence, the stored `MatchResult`
//! document and the match metadata (owner, build, content hash, roster) of the build that produced the result. Recovery
//! never substitutes the restarted build's values. Records carry no credentials.
//!
//! # Layout
//!
//! ```text
//! <dir>/<match-uuid>-<profile-id>.rec     pending (the name is the idempotency key)
//! <dir>/dead/<name>.rec  + <name>.reason  definitively refused or unreadable: operator-owned, never retried
//! <dir>/.<name>.<pid>.<n>.tmp             half-written: removed at open (never acknowledged)
//! ```
//!
//! A record file is `RHSP1 <payload-bytes> <crc32-hex>\n` followed by the JSON payload. Anything that does not parse,
//! has the wrong length or checksum, an unknown version, or a body that disagrees with its file name is moved to
//! `dead/` with a reason, not deleted and not retried. To retry a dead letter by hand, move the `.rec` back into `<dir>`
//! before starting the server; it is replayed through the same fenced path and will be refused again if a newer owner
//! exists.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// Version of the record body. A reader refuses (dead-letters) a version it does not know.
pub const FORMAT_VERSION: u32 = 1;
const MAGIC: &str = "RHSP1";
/// A record larger than this is refused outright (a real one is well under 1 KiB).
pub const MAX_RECORD_BYTES: usize = 64 * 1024;

/// Match metadata exactly as it was when the result was produced (the `matches` row of the original build).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpoolMeta {
    pub owner: String,
    pub region: Option<String>,
    pub placement_id: Option<String>,
    pub build: String,
    pub content_hash: u64,
    pub humans: u32,
    pub bots: u32,
}

impl SpoolMeta {
    pub fn to_persist(&self) -> rh_persist::MatchMeta {
        rh_persist::MatchMeta {
            owner: self.owner.clone(),
            region: self.region.clone(),
            placement_id: self.placement_id.clone(),
            build: self.build.clone(),
            content_hash: self.content_hash,
            humans: self.humans,
            bots: self.bots,
        }
    }
    pub fn from_persist(m: &rh_persist::MatchMeta) -> Self {
        Self {
            owner: m.owner.clone(),
            region: m.region.clone(),
            placement_id: m.placement_id.clone(),
            build: m.build.clone(),
            content_hash: m.content_hash,
            humans: m.humans,
            bots: m.bots,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SpoolRecord {
    pub v: u32,
    /// Hyphenated UUID of the match.
    pub match_id: String,
    pub profile_id: i64,
    /// Display snapshot for logs and the operator; never used to resolve identity.
    pub profile: String,
    /// The lease fence the result was earned under. Replayed unchanged: a newer fence refuses it.
    pub fence: i64,
    pub meta: SpoolMeta,
    pub result: rh_persist::MatchResult,
    /// When the record was made (Unix ms). Becomes `matches.ended_at` on replay instead of the commit time.
    pub spooled_at_ms: i64,
}

impl SpoolRecord {
    pub fn new(
        match_id: uuid::Uuid,
        profile_id: i64,
        profile: &str,
        fence: i64,
        meta: SpoolMeta,
        result: rh_persist::MatchResult,
    ) -> Self {
        Self {
            v: FORMAT_VERSION,
            match_id: match_id.to_string(),
            profile_id,
            profile: profile.to_owned(),
            fence,
            meta,
            result,
            spooled_at_ms: now_ms(),
        }
    }
    pub fn match_uuid(&self) -> Result<uuid::Uuid, uuid::Error> {
        uuid::Uuid::parse_str(&self.match_id)
    }
    /// The file name, which is also the idempotency key `(match, profile)`.
    pub fn file_name(&self) -> String {
        format!("{}-{}.rec", self.match_id, self.profile_id)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// CRC-32 (IEEE). A torn or bit-rotted record is detected; this is not a defence against an adversary on the volume.
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xEDB8_8320 & (!(crc & 1)).wrapping_add(1));
        }
    }
    !crc
}

pub fn encode(rec: &SpoolRecord) -> Vec<u8> {
    let payload = serde_json::to_vec(rec).expect("spool record serializes");
    let mut out = format!("{MAGIC} {} {:08x}\n", payload.len(), crc32(&payload)).into_bytes();
    out.extend_from_slice(&payload);
    out
}

/// Why a file is not a usable record.
pub fn decode(bytes: &[u8], expect_name: Option<&str>) -> Result<SpoolRecord, String> {
    let nl = bytes
        .iter()
        .position(|&b| b == b'\n')
        .ok_or("truncated: no header line")?;
    let header = std::str::from_utf8(&bytes[..nl]).map_err(|_| "header is not UTF-8")?;
    let mut parts = header.split(' ');
    if parts.next() != Some(MAGIC) {
        return Err("bad magic".into());
    }
    let len: usize = parts
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or("bad length field")?;
    let crc = parts
        .next()
        .and_then(|s| u32::from_str_radix(s, 16).ok())
        .ok_or("bad checksum field")?;
    let payload = &bytes[nl + 1..];
    if payload.len() != len {
        return Err(format!(
            "truncated or padded: header says {len} bytes, found {}",
            payload.len()
        ));
    }
    if crc32(payload) != crc {
        return Err("checksum mismatch".into());
    }
    let rec: SpoolRecord = serde_json::from_slice(payload).map_err(|e| format!("body: {e}"))?;
    if rec.v != FORMAT_VERSION {
        return Err(format!("unsupported record version {}", rec.v));
    }
    rec.match_uuid().map_err(|_| "match id is not a UUID")?;
    if let Some(name) = expect_name {
        if rec.file_name() != name {
            return Err("body disagrees with the file name".into());
        }
    }
    Ok(rec)
}

#[derive(Clone, Copy, Debug)]
pub struct SpoolConfig {
    /// Pending records the directory may hold (dead letters do not count). Appends beyond it fail with
    /// [`SpoolError::Full`].
    pub max_records: usize,
    /// Dead letters kept in `dead/`. At the bound a further definitive refusal is NOT moved: its record stays where it is
    /// (pending, never deleted), the server stops retrying it in this process, counts it (`dead_overflow_total`) and logs
    /// loudly. A restart tries it again; the operator frees space by clearing `dead/`.
    pub max_dead: usize,
    /// An ALERT threshold, not a deadline: a result still unresolved after this long (live or recovered) is logged and
    /// counted as stuck, repeatedly every interval. A transient error never dead-letters a result, however long the
    /// database is away; only a definitive refusal does.
    pub retry_deadline: Duration,
    pub backoff_initial: Duration,
    pub backoff_max: Duration,
}

impl Default for SpoolConfig {
    fn default() -> Self {
        Self {
            max_records: 4096,
            max_dead: 1024,
            retry_deadline: Duration::from_secs(15 * 60),
            backoff_initial: Duration::from_millis(100),
            backoff_max: Duration::from_secs(5),
        }
    }
}

#[derive(Debug)]
pub enum SpoolError {
    /// The directory holds `max_records` already. The caller falls back to in-memory retry (and counts it).
    Full,
    TooLarge,
    Io(io::Error),
}
impl std::fmt::Display for SpoolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Full => f.write_str("spool full"),
            Self::TooLarge => f.write_str("record too large"),
            Self::Io(e) => write!(f, "spool I/O: {e}"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Appended {
    New,
    /// The same `(match, profile)` was already spooled; the original record is kept.
    AlreadyPresent,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SpoolStats {
    pub pending: usize,
    pub dead: usize,
    pub spooled_total: u64,
    pub removed_total: u64,
    pub dead_total: u64,
    pub full_total: u64,
    pub io_errors_total: u64,
    /// Definitive refusals that could not be moved to `dead/` because it was at `max_dead`.
    pub dead_overflow_total: u64,
}

/// What [`ResultSpool::dead_letter`] did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeadOutcome {
    Moved,
    /// `dead/` is at `max_dead`: the record was left in place (still pending, never deleted).
    Overflow,
    /// The record was already gone (committed or moved by someone else): nothing to do.
    AlreadyGone,
}

pub struct ResultSpool {
    dir: PathBuf,
    dead: PathBuf,
    pub cfg: SpoolConfig,
    /// Names being appended right now, guarded together with the slot counts so concurrent appends of one name or of
    /// many cannot double count or overshoot the bounds.
    slots: Mutex<HashSet<String>>,
    pending: AtomicUsize,
    dead_count: AtomicUsize,
    spooled_total: AtomicU64,
    removed_total: AtomicU64,
    dead_total: AtomicU64,
    full_total: AtomicU64,
    io_errors_total: AtomicU64,
    dead_overflow_total: AtomicU64,
    tmp_seq: AtomicU64,
}

fn sync_dir(dir: &Path) -> io::Result<()> {
    File::open(dir)?.sync_all()
}

fn is_record(name: &str) -> bool {
    name.ends_with(".rec") && !name.starts_with('.')
}

impl ResultSpool {
    /// Opens (creating) the spool directory, removes half-written temporaries (never acknowledged) and counts what is
    /// there. Blocking: call it at startup.
    pub fn open(dir: impl Into<PathBuf>, cfg: SpoolConfig) -> io::Result<std::sync::Arc<Self>> {
        let dir = dir.into();
        let dead = dir.join("dead");
        fs::create_dir_all(&dead)?;
        let mut pending = 0;
        for e in fs::read_dir(&dir)? {
            let e = e?;
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') && name.ends_with(".tmp") {
                eprintln!("[spool] removing an unfinished temporary record (it was never acknowledged): {name}");
                let _ = fs::remove_file(e.path());
            } else if is_record(&name) {
                pending += 1;
            }
        }
        let dead_n = fs::read_dir(&dead)?
            .filter_map(Result::ok)
            .filter(|e| is_record(&e.file_name().to_string_lossy()))
            .count();
        sync_dir(&dir)?;
        Ok(std::sync::Arc::new(Self {
            dir,
            dead,
            cfg,
            slots: Mutex::new(HashSet::new()),
            pending: AtomicUsize::new(pending),
            dead_count: AtomicUsize::new(dead_n),
            spooled_total: AtomicU64::new(0),
            removed_total: AtomicU64::new(0),
            dead_total: AtomicU64::new(0),
            full_total: AtomicU64::new(0),
            io_errors_total: AtomicU64::new(0),
            dead_overflow_total: AtomicU64::new(0),
            tmp_seq: AtomicU64::new(0),
        }))
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }
    pub fn dead_dir(&self) -> &Path {
        &self.dead
    }

    pub fn stats(&self) -> SpoolStats {
        SpoolStats {
            pending: self.pending.load(Ordering::SeqCst),
            dead: self.dead_count.load(Ordering::SeqCst),
            spooled_total: self.spooled_total.load(Ordering::SeqCst),
            removed_total: self.removed_total.load(Ordering::SeqCst),
            dead_total: self.dead_total.load(Ordering::SeqCst),
            full_total: self.full_total.load(Ordering::SeqCst),
            io_errors_total: self.io_errors_total.load(Ordering::SeqCst),
            dead_overflow_total: self.dead_overflow_total.load(Ordering::SeqCst),
        }
    }

    /// Durably stores `rec` (write temp, fsync, rename, fsync directory). Blocking; call from `spawn_blocking`.
    /// Returns only after the record would survive a process crash.
    pub fn append(&self, rec: &SpoolRecord) -> Result<Appended, SpoolError> {
        let name = rec.file_name();
        let bytes = encode(rec);
        if bytes.len() > MAX_RECORD_BYTES {
            return Err(SpoolError::TooLarge);
        }
        let final_path = self.dir.join(&name);
        {
            let mut inflight = self.slots.lock().expect("spool slots");
            // Another append of the same (match, profile) is mid-write: it owns the slot and the original is kept.
            if inflight.contains(&name) || final_path.exists() {
                return Ok(Appended::AlreadyPresent);
            }
            if self.pending.load(Ordering::SeqCst) >= self.cfg.max_records {
                self.full_total.fetch_add(1, Ordering::SeqCst);
                return Err(SpoolError::Full);
            }
            self.pending.fetch_add(1, Ordering::SeqCst);
            inflight.insert(name.clone());
        }
        let write = || -> io::Result<()> {
            let tmp = self.dir.join(format!(
                ".{name}.{}.{}.tmp",
                std::process::id(),
                self.tmp_seq.fetch_add(1, Ordering::SeqCst)
            ));
            let mut f = File::create(&tmp)?;
            f.write_all(&bytes)?;
            f.sync_all()?;
            drop(f);
            if let Err(e) = fs::rename(&tmp, &final_path) {
                let _ = fs::remove_file(&tmp);
                return Err(e);
            }
            sync_dir(&self.dir)
        };
        let res = write();
        self.slots.lock().expect("spool slots").remove(&name);
        match res {
            Ok(()) => {
                self.spooled_total.fetch_add(1, Ordering::SeqCst);
                Ok(Appended::New)
            }
            Err(e) => {
                self.pending.fetch_sub(1, Ordering::SeqCst);
                self.io_errors_total.fetch_add(1, Ordering::SeqCst);
                Err(SpoolError::Io(e))
            }
        }
    }

    /// Removes a record once its result is committed (or definitively `AlreadyApplied`). Blocking.
    pub fn remove(&self, name: &str) -> io::Result<()> {
        match fs::remove_file(self.dir.join(name)) {
            Ok(()) => {
                self.pending.fetch_sub(1, Ordering::SeqCst);
                self.removed_total.fetch_add(1, Ordering::SeqCst);
                sync_dir(&self.dir)
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => {
                self.io_errors_total.fetch_add(1, Ordering::SeqCst);
                Err(e)
            }
        }
    }

    /// Moves a pending record to `dead/` with a reason, for an operator. The reason must not contain secrets (callers pass
    /// store outcomes and parse errors only). A record that is already gone is success (nothing left to move, and the
    /// reason file is cleaned up). At `max_dead` the record is left in place and [`DeadOutcome::Overflow`] is returned:
    /// nothing pending is ever deleted. Blocking.
    pub fn dead_letter(&self, name: &str, reason: &str) -> io::Result<DeadOutcome> {
        let from = self.dir.join(name);
        let to = self.dead.join(name);
        let existed_dead = to.exists();
        if !existed_dead {
            // Reserve a dead slot under the lock so concurrent dead-letters cannot overshoot the bound.
            let _g = self.slots.lock().expect("spool slots");
            if self.dead_count.load(Ordering::SeqCst) >= self.cfg.max_dead {
                self.dead_overflow_total.fetch_add(1, Ordering::SeqCst);
                eprintln!(
                    "[spool] DEAD-LETTER DIRECTORY FULL ({} records): {name} stays pending and will not be retried \
                     until restart; reason: {reason}. An operator must clear {}",
                    self.cfg.max_dead,
                    self.dead.display()
                );
                return Ok(DeadOutcome::Overflow);
            }
            self.dead_count.fetch_add(1, Ordering::SeqCst);
        }
        let release = |this: &Self| {
            if !existed_dead {
                this.dead_count.fetch_sub(1, Ordering::SeqCst);
            }
        };
        let reason_file = self.dead.join(format!("{name}.reason"));
        let wrote = (|| -> io::Result<()> {
            let mut f = File::create(&reason_file)?;
            writeln!(f, "{reason}")?;
            f.sync_all()
        })();
        if let Err(e) = wrote {
            release(self);
            return Err(e);
        }
        match fs::rename(&from, &to) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                // Committed and removed (or moved) while we were here: success, and no orphan reason file.
                let _ = fs::remove_file(&reason_file);
                release(self);
                return Ok(DeadOutcome::AlreadyGone);
            }
            Err(e) => {
                release(self);
                return Err(e);
            }
        }
        sync_dir(&self.dead)?;
        sync_dir(&self.dir)?;
        self.pending.fetch_sub(1, Ordering::SeqCst);
        self.dead_total.fetch_add(1, Ordering::SeqCst);
        Ok(DeadOutcome::Moved)
    }

    /// Reads every pending record. A file that is not a usable record is dead-lettered here (with the parse reason).
    /// Blocking; used at startup.
    pub fn scan(&self) -> Vec<(String, SpoolRecord)> {
        let mut names: Vec<String> = match fs::read_dir(&self.dir) {
            Ok(rd) => rd
                .filter_map(Result::ok)
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| is_record(n))
                .collect(),
            Err(e) => {
                eprintln!("[spool] cannot list {}: {e}", self.dir.display());
                return Vec::new();
            }
        };
        names.sort();
        let mut out = Vec::new();
        for name in names {
            let parsed = fs::read(self.dir.join(&name))
                .map_err(|e| format!("unreadable: {e}"))
                .and_then(|b| decode(&b, Some(&name)));
            match parsed {
                Ok(rec) => out.push((name, rec)),
                Err(why) => {
                    eprintln!("[spool] dead-lettering unusable record {name}: {why}");
                    if let Err(e) = self.dead_letter(&name, &format!("corrupt: {why}")) {
                        self.io_errors_total.fetch_add(1, Ordering::SeqCst);
                        eprintln!("[spool] could not dead-letter {name}: {e}");
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(profile_id: i64) -> SpoolRecord {
        SpoolRecord::new(
            uuid::Uuid::from_u128(7),
            profile_id,
            "papa",
            3,
            SpoolMeta {
                owner: "host-a".into(),
                region: None,
                placement_id: None,
                build: "build-x".into(),
                content_hash: u64::MAX - 1,
                humans: 2,
                bots: 1,
            },
            rh_persist::MatchResult::default(),
        )
    }

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("rh-spool-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn crc32_matches_the_standard_check_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn a_record_round_trips_and_preserves_original_metadata() {
        let r = rec(5);
        let back = decode(&encode(&r), Some(&r.file_name())).unwrap();
        assert_eq!(back, r);
        assert_eq!(back.meta.build, "build-x");
        assert_eq!(back.meta.content_hash, u64::MAX - 1);
    }

    #[test]
    fn damage_is_detected() {
        let r = rec(5);
        let good = encode(&r);
        assert!(decode(&good[..good.len() - 3], None).is_err(), "truncated");
        assert!(decode(&good[..8], None).is_err(), "no header line");
        let mut flipped = good.clone();
        let last = flipped.len() - 5;
        flipped[last] ^= 1;
        assert!(decode(&flipped, None).unwrap_err().contains("checksum"));
        assert!(decode(&good, Some("other.rec")).is_err(), "name mismatch");
        let mut padded = good.clone();
        padded.push(b' ');
        assert!(decode(&padded, None).is_err(), "padded");
        let mut v2 = rec(5);
        v2.v = 2;
        assert!(decode(&encode(&v2), None).unwrap_err().contains("version"));
    }

    #[test]
    fn append_is_idempotent_bounded_and_removable() {
        let dir = temp("append");
        let spool = ResultSpool::open(
            &dir,
            SpoolConfig {
                max_records: 2,
                ..SpoolConfig::default()
            },
        )
        .unwrap();
        assert_eq!(spool.append(&rec(1)).unwrap(), Appended::New);
        assert_eq!(spool.append(&rec(1)).unwrap(), Appended::AlreadyPresent);
        assert_eq!(spool.append(&rec(2)).unwrap(), Appended::New);
        assert!(matches!(spool.append(&rec(3)), Err(SpoolError::Full)));
        assert_eq!(spool.stats().pending, 2);
        assert_eq!(spool.stats().full_total, 1);
        spool.remove(&rec(1).file_name()).unwrap();
        assert_eq!(spool.append(&rec(3)).unwrap(), Appended::New);
        // A reopened spool sees the same records and drops temporaries.
        fs::write(dir.join(".junk.tmp"), b"partial").unwrap();
        drop(spool);
        let again = ResultSpool::open(&dir, SpoolConfig::default()).unwrap();
        assert!(!dir.join(".junk.tmp").exists());
        let names: Vec<_> = again.scan().into_iter().map(|(n, _)| n).collect();
        assert_eq!(names.len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_files_go_to_dead_with_a_reason_and_are_not_deleted() {
        let dir = temp("corrupt");
        let spool = ResultSpool::open(&dir, SpoolConfig::default()).unwrap();
        spool.append(&rec(1)).unwrap();
        let path = dir.join(rec(1).file_name());
        let bytes = fs::read(&path).unwrap();
        fs::write(&path, &bytes[..bytes.len() / 2]).unwrap();
        assert!(spool.scan().is_empty());
        assert_eq!(spool.stats().pending, 0);
        assert_eq!(spool.stats().dead, 1);
        let dead = spool.dead_dir().join(rec(1).file_name());
        assert_eq!(fs::read(dead).unwrap().len(), bytes.len() / 2);
        let reason = fs::read_to_string(
            spool
                .dead_dir()
                .join(format!("{}.reason", rec(1).file_name())),
        )
        .unwrap();
        assert!(reason.starts_with("corrupt:"), "{reason}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dead_letters_do_not_consume_the_pending_bound_and_have_their_own() {
        let dir = temp("deadbound");
        let spool = ResultSpool::open(
            &dir,
            SpoolConfig {
                max_records: 2,
                max_dead: 1,
                ..SpoolConfig::default()
            },
        )
        .unwrap();
        spool.append(&rec(1)).unwrap();
        spool.append(&rec(2)).unwrap();
        assert!(matches!(spool.append(&rec(3)), Err(SpoolError::Full)));
        // One dead letter frees a pending slot and does not take one.
        assert_eq!(
            spool.dead_letter(&rec(1).file_name(), "refused").unwrap(),
            DeadOutcome::Moved
        );
        assert_eq!((spool.stats().pending, spool.stats().dead), (1, 1));
        assert_eq!(
            spool.append(&rec(3)).unwrap(),
            Appended::New,
            "dead letters are not counted as pending"
        );
        // The dead bound (1) is reached: the next refusal is kept pending, counted, never deleted.
        assert_eq!(
            spool.dead_letter(&rec(2).file_name(), "refused").unwrap(),
            DeadOutcome::Overflow
        );
        assert!(
            dir.join(rec(2).file_name()).exists(),
            "pending record is never deleted"
        );
        assert!(!spool.dead_dir().join(rec(2).file_name()).exists());
        assert_eq!(spool.stats().dead, 1);
        assert_eq!(spool.stats().dead_overflow_total, 1);
        assert_eq!(spool.stats().pending, 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_dead_letter_for_a_record_that_is_already_gone_is_success_and_leaves_no_reason_file() {
        let dir = temp("gone");
        let spool = ResultSpool::open(&dir, SpoolConfig::default()).unwrap();
        let name = rec(1).file_name();
        assert_eq!(
            spool.dead_letter(&name, "raced with the commit").unwrap(),
            DeadOutcome::AlreadyGone
        );
        assert!(!spool.dead_dir().join(format!("{name}.reason")).exists());
        let st = spool.stats();
        assert_eq!((st.pending, st.dead, st.dead_total), (0, 0, 0));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn concurrent_appends_of_one_record_count_it_once() {
        for round in 0..30u128 {
            let dir = temp(&format!("race{round}"));
            let spool = ResultSpool::open(&dir, SpoolConfig::default()).unwrap();
            let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
            let hs: Vec<_> = (0..8)
                .map(|_| {
                    let (s, b) = (spool.clone(), barrier.clone());
                    let mut r = rec(1);
                    r.match_id = uuid::Uuid::from_u128(round + 100).to_string();
                    std::thread::spawn(move || {
                        b.wait();
                        s.append(&r).unwrap()
                    })
                })
                .collect();
            let news = hs
                .into_iter()
                .map(|h| h.join().unwrap())
                .filter(|a| *a == Appended::New)
                .count();
            assert_eq!(news, 1, "round {round}");
            assert_eq!(
                spool.stats().pending,
                1,
                "pending must not double count (round {round})"
            );
            let _ = fs::remove_dir_all(&dir);
        }
    }
}
