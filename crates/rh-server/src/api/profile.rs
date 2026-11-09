//! Profile, shop and leaderboard handlers (feature `postgres`). See the module docs of `api` for the layering.

use super::limits::{limit_key, PasscodeVerdict};
use super::{
    current_month, err, json, log_internal, method_not_allowed, with_retry_after, ClientAddr, St,
    IDEMPOTENCY_HEADER, MAX_BODY_BYTES, PASSCODE_HEADER, PROFILE_TOKEN_HEADER,
};
use axum::body::to_bytes;
use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::routing::any;
use axum::{Extension, Router};
use rh_persist::account::LeaderRow;
use rh_persist::cosmetics::{self, SLOTS};
use rh_persist::{
    valid_callsign, valid_month, Claim, EquipOutcome, Profile, PurchaseOutcome, Store,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};
use uuid::Uuid;

pub(super) fn routes() -> Router<St> {
    Router::new()
        .route("/api/profile/{name}", any(claim))
        .route("/api/profile/{name}/purchase", any(purchase))
        .route("/api/profile/{name}/equip", any(equip))
        .route(
            "/api/profile/{name}/matches/{match_id}/settlement",
            any(settlement),
        )
        .route("/api/leaderboard", any(leaderboard))
}

/// A held account-API database slot (see `ApiConfig::db_concurrency`). Dropping it frees the slot.
type Slot = Option<tokio::sync::OwnedSemaphorePermit>;

/// First stop of every `/api/profile*` and `/api/leaderboard` request, before any handler or database query: the
/// per-address (/64) token bucket. An exhausted bucket is answered 429 without touching storage. The legacy contracts
/// (403 for someone else's name, claim of a free one) are decided by the handlers after this and are unchanged.
pub(super) async fn guard(
    State(st): State<St>,
    Extension(ClientAddr(ip)): Extension<ClientAddr>,
    req: Request,
    next: Next,
) -> Response {
    if !st.a.lookups.take(&limit_key(ip), Instant::now()) {
        return with_retry_after(
            json(
                StatusCode::TOO_MANY_REQUESTS,
                serde_json::json!({
                    "error": "too many requests, slow down",
                    "code": "rate_limited",
                }),
            ),
            Duration::from_secs(1),
        );
    }
    next.run(req).await
}

/// Waits (bounded) for one of the account API's database slots; 503 when none frees up in time. Take it around database
/// work only, never while reading a request body (a stalled client must not hold a slot).
async fn slot(st: &St) -> Result<Slot, Response> {
    let Some(sem) = &st.a.db_slots else {
        return Ok(None);
    };
    match tokio::time::timeout(st.a.cfg.db_queue_wait, sem.clone().acquire_owned()).await {
        Ok(Ok(p)) => Ok(Some(p)),
        _ => Err(with_retry_after(
            json(
                StatusCode::SERVICE_UNAVAILABLE,
                serde_json::json!({
                    "error": "profile service busy; retry shortly",
                    "code": "busy",
                }),
            ),
            Duration::from_secs(1),
        )),
    }
}

const LEADERBOARD_DEFAULT_LIMIT: i64 = 20;
const LEADERBOARD_MAX_LIMIT: i64 = 100;
const LEADERBOARD_MAX_MONTHS: i64 = 24;
/// Longest token header we will hash (tokens we issue are 64 hex characters).
const MAX_TOKEN_LEN: usize = 512;

// ---- DTOs (legacy `ProfileDTO`, field by field so a hash or an unknown stored key can never ride along) ---------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileDto {
    name: String,
    gv: i64,
    gv_lifetime: i64,
    gv_by_month: BTreeMap<String, i64>,
    stats: StatsDto,
    cosmetics: CosmeticsDto,
    achievements: BTreeMap<String, i64>,
    progress: ProgressDto,
}
#[derive(Serialize)]
struct StatsDto {
    runs: i64,
    wins: i64,
    draws: i64,
    deaths: i64,
    kills: i64,
}
#[derive(Serialize)]
struct CosmeticsDto {
    owned: Vec<String>,
    equipped: BTreeMap<String, String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressDto {
    qualified_wins: i64,
    bounty_runs: i64,
    best_run_kills: i64,
    wins_by_faction: BTreeMap<String, i64>,
    wins_by_weapon: BTreeMap<String, i64>,
}

fn dto(p: Profile) -> Value {
    serde_json::to_value(ProfileDto {
        name: p.callsign,
        gv: p.gv,
        gv_lifetime: p.gv_lifetime,
        gv_by_month: p.gv_by_month,
        stats: StatsDto {
            runs: p.stats.runs,
            wins: p.stats.wins,
            draws: p.stats.draws,
            deaths: p.stats.deaths,
            kills: p.stats.kills,
        },
        cosmetics: CosmeticsDto {
            owned: p.cosmetics.owned,
            equipped: p.cosmetics.equipped,
        },
        achievements: p.achievements,
        progress: ProgressDto {
            qualified_wins: p.progress.qualified_wins,
            bounty_runs: p.progress.bounty_runs,
            best_run_kills: p.progress.best_run_kills,
            wins_by_faction: p.progress.wins_by_faction,
            wins_by_weapon: p.progress.wins_by_weapon,
        },
    })
    .expect("plain data serializes")
}

// ---- helpers --------------------------------------------------------------------------------------------------

fn store_err(route: &str, e: rh_persist::Error) -> Response {
    if e.is_unavailable() {
        log_internal(route, &"storage unavailable");
        return with_retry_after(
            json(
                StatusCode::SERVICE_UNAVAILABLE,
                serde_json::json!({
                    "error": "profile storage unavailable; retry shortly",
                    "code": "storage_unavailable",
                }),
            ),
            Duration::from_secs(1),
        );
    }
    log_internal(route, &e);
    err(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
}

/// The presented profile token: absent, empty, non-UTF-8 or oversized all read as "no token".
fn token_of(headers: &HeaderMap) -> &str {
    headers
        .get(PROFILE_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|t| t.len() <= MAX_TOKEN_LEN)
        .unwrap_or("")
}

fn store_of(st: &St) -> &Arc<Store> {
    st.a.store.as_ref().expect("profile routes need a store")
}

/// The durable id when `token` is the profile's own.
async fn authed(store: &Store, name: &str, token: &str) -> Result<Option<i64>, rh_persist::Error> {
    if token.is_empty() {
        return Ok(None);
    }
    store.verify_token_id(name, token).await
}

fn new_token() -> String {
    let mut b = [0u8; 32];
    getrandom::getrandom(&mut b).expect("OS randomness");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn bad_name() -> Response {
    json(
        StatusCode::BAD_REQUEST,
        serde_json::json!({ "error": "invalid profile name", "code": "bad_request" }),
    )
}

fn forbidden() -> Response {
    shop_err("forbidden", None)
}

fn shop_err(code: &'static str, need_have: Option<(i64, i64)>) -> Response {
    let (status, msg) = match code {
        "forbidden" => (403, "profile belongs to someone else"),
        "bad_request" => (400, "bad request"),
        "unknown_cosmetic" => (404, "unknown cosmetic"),
        "unknown_slot" => (400, "unknown slot"),
        "not_for_sale" => (409, "not for sale"),
        "already_owned" => (409, "already owned"),
        "insufficient_gv" => (402, "not enough GV"),
        "not_owned" => (409, "not owned"),
        "slot_mismatch" => (400, "that item does not go in that slot"),
        _ => (500, "internal error"),
    };
    let mut body = serde_json::json!({ "error": msg, "code": code });
    if let Some((need, have)) = need_have {
        body["need"] = need.into();
        body["have"] = have.into();
    }
    json(StatusCode::from_u16(status).expect("status"), body)
}

fn is_json(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .is_some_and(|t| t.trim().eq_ignore_ascii_case("application/json"))
}

/// Reads the (1 KiB capped) body and parses it as strict JSON into `T` (unknown fields, trailing bytes and non-objects fail).
async fn read_body<T: serde::de::DeserializeOwned>(
    headers: &HeaderMap,
    body: axum::body::Body,
) -> Result<T, Response> {
    if !is_json(headers) {
        return Err(json(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            serde_json::json!({ "error": "expected application/json", "code": "bad_request" }),
        ));
    }
    let bytes = to_bytes(body, MAX_BODY_BYTES).await.map_err(|e| {
        // The only failure of a limited read is the limit (or a client that went away).
        let too_large = is_length_limit(&e);
        json(
            if too_large {
                StatusCode::PAYLOAD_TOO_LARGE
            } else {
                StatusCode::BAD_REQUEST
            },
            serde_json::json!({
                "error": if too_large { "request too large" } else { "malformed request" },
                "code": "bad_request",
            }),
        )
    })?;
    serde_json::from_slice(&bytes).map_err(|_| {
        json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "error": "malformed request", "code": "bad_request" }),
        )
    })
}

/// True only when the failed read hit the body limit: the error's source IS the length-limit type (not merely a message
/// that mentions one).
fn is_length_limit(e: &axum::Error) -> bool {
    std::error::Error::source(e).is_some_and(|s| s.is::<http_body_util::LengthLimitError>())
}

fn name_of(p: Result<Path<String>, axum::extract::rejection::PathRejection>) -> Option<String> {
    p.ok().map(|Path(n)| n).filter(|n| valid_callsign(n))
}

/// A public MatchId's UUID text uses its raw Welcome bytes in network order (`room::match_id_string`).
/// This route never claims a free name: it authenticates once, then reads only that immutable principal's pair.
async fn settlement(
    State(st): State<St>,
    path: Result<Path<(String, String)>, axum::extract::rejection::PathRejection>,
    req: Request,
) -> Response {
    if req.method() != Method::GET {
        return method_not_allowed("GET, OPTIONS");
    }
    let Ok(Path((name, raw_match))) = path else {
        return err(StatusCode::BAD_REQUEST, "invalid settlement path");
    };
    if !valid_callsign(&name) {
        return bad_name();
    }
    let Ok(match_id) = Uuid::parse_str(&raw_match) else {
        return err(StatusCode::BAD_REQUEST, "invalid match id");
    };
    if !match_id.to_string().eq_ignore_ascii_case(&raw_match) {
        return err(StatusCode::BAD_REQUEST, "invalid match id");
    }
    let _slot = match slot(&st).await {
        Ok(slot) => slot,
        Err(response) => return response,
    };
    let store = store_of(&st);
    let pid = match authed(store, &name, token_of(req.headers())).await {
        Ok(Some(pid)) => pid,
        Ok(None) => return forbidden_profile(),
        Err(error) => return store_err("GET /api/profile/settlement", error),
    };
    match store.settlement_by_id(pid, match_id).await {
        Ok(None) => json(
            StatusCode::OK,
            serde_json::json!({
                "v":1, "matchId":match_id.to_string(), "status":"unknown"
            }),
        ),
        Ok(Some(receipt)) => json(
            StatusCode::OK,
            serde_json::json!({
                "v":1, "matchId":match_id.to_string(), "status":"committed",
                "settlement": {"outcome":receipt.outcome, "gvCredited":receipt.gv_credited}
            }),
        ),
        Err(error) => store_err("GET /api/profile/settlement", error),
    }
}

// ---- claim / open ---------------------------------------------------------------------------------------------

async fn claim(
    axum::extract::State(st): axum::extract::State<St>,
    name: Result<Path<String>, axum::extract::rejection::PathRejection>,
    Extension(ClientAddr(ip)): Extension<ClientAddr>,
    req: Request,
) -> Response {
    // HEAD must not reach a handler that would claim a name and throw its token away (legacy `getOnly`).
    if req.method() != Method::GET {
        return method_not_allowed("GET, OPTIONS");
    }
    let Some(name) = name_of(name) else {
        return err(StatusCode::BAD_REQUEST, "invalid profile name");
    };
    let store = store_of(&st);
    let presented = token_of(req.headers());
    let slot = match slot(&st).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    match authed(store, &name, presented).await {
        // Opening: the caller's own token proves ownership; it is echoed back because the legacy client stores the
        // `token` of every profile response. Nothing the server holds is returned (it holds only a hash).
        Ok(Some(pid)) => return open(store, pid, presented).await,
        Ok(None) => {}
        Err(e) => return store_err("GET /api/profile", e),
    }
    match store.profile_id(&name).await {
        Ok(Some(_)) => return forbidden_profile(),
        Ok(None) => {}
        Err(e) => return store_err("GET /api/profile", e),
    }

    // A free name: the only thing a stranger can do here, so the only thing guarded.
    let now = Instant::now();
    let passcode = req
        .headers()
        .get(PASSCODE_HEADER)
        .and_then(|v| v.to_str().ok());
    match st.a.passcode.check(passcode, ip, now) {
        PasscodeVerdict::Ok => {}
        PasscodeVerdict::Missing | PasscodeVerdict::Wrong => {
            return json(
                StatusCode::UNAUTHORIZED,
                serde_json::json!({
                    "error": "this playtest needs a passcode",
                    "code": "passcode_required",
                }),
            )
        }
        PasscodeVerdict::Throttled(wait) => {
            return with_retry_after(
                json(
                    StatusCode::TOO_MANY_REQUESTS,
                    serde_json::json!({
                        "error": "too many wrong passcodes from this connection: wait a minute and try again",
                        "code": "passcode_throttled",
                    }),
                ),
                wait,
            )
        }
    }
    // Reserved before the insert so concurrent claims cannot all pass one check; the guard hands the reservation back on
    // every exit that did not leave a claimed name behind (error, lost race, panic, or a claim whose token could not be
    // delivered and was undone).
    if let Err(wait) = st.a.new_profiles.reserve(ip, now) {
        return with_retry_after(
            err(
                StatusCode::TOO_MANY_REQUESTS,
                "too many new callsigns lately, try again later",
            ),
            wait,
        );
    }
    let reservation = Reservation {
        shared: st.a.clone(),
        ip,
        at: now,
        armed: true,
    };
    // The commit, its answer and the compensation run in a task the request timeout cannot cancel: cancelling a handler
    // between the INSERT and the response would leave a claimed name whose token nobody ever received. The handler only
    // waits for the task's answer; if it has gone (timeout, client left), the task undoes the claim itself. There is no
    // `.await` between the reservation above and this spawn, so cancellation cannot lose the reservation.
    let (tx, rx) = tokio::sync::oneshot::channel::<Response>();
    let store = store.clone();
    tokio::spawn(async move {
        let _slot = slot; // held until the commit and any compensation are done
        let mut reservation = reservation;
        let token = new_token();
        let answer = match store.create_profile(&name, &token).await {
            Ok(Claim::Created) => {
                // Answered from the insert itself: a read-back could fail or be cancelled with the token already minted.
                let body = serde_json::json!({
                    "profile": dto(Profile::fresh(&name)),
                    "token": token,
                    "created": true,
                });
                match tx.send(json(StatusCode::OK, body)) {
                    Ok(()) => reservation.keep(),
                    Err(_) => {
                        // Nobody is waiting for the token: free the name again (a fresh row with no history) so the
                        // caller's retry can claim it, and give the reservation back.
                        match store.discard_unclaimed_profile(&name, &token).await {
                            Ok(true) => {}
                            Ok(false) | Err(_) => {
                                reservation.keep();
                                log_internal(
                                    "GET /api/profile",
                                    &"claim committed but its response was lost; name left claimed",
                                );
                            }
                        }
                    }
                }
                return;
            }
            // Lost a race for the name.
            Ok(_) => forbidden_profile(),
            Err(e) => store_err("GET /api/profile", e),
        };
        let _ = tx.send(answer);
    });
    match rx.await {
        Ok(r) => r,
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
    }
}

/// A new-profile reservation that is given back unless [`Reservation::keep`] is called (a name was created and its token
/// delivered or deliberately left).
struct Reservation {
    shared: Arc<super::Shared>,
    ip: std::net::IpAddr,
    at: Instant,
    armed: bool,
}

impl Reservation {
    fn keep(&mut self) {
        self.armed = false;
    }
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if self.armed {
            self.shared.new_profiles.refund(self.ip, self.at);
        }
    }
}

fn forbidden_profile() -> Response {
    err(StatusCode::FORBIDDEN, "profile belongs to someone else")
}

async fn open(store: &Store, profile_id: i64, token: &str) -> Response {
    match store.get_profile_by_id(profile_id).await {
        Ok(Some(p)) => json(
            StatusCode::OK,
            serde_json::json!({ "profile": dto(p), "token": token, "created": false }),
        ),
        Ok(None) => forbidden_profile(),
        Err(e) => store_err("GET /api/profile", e),
    }
}

// ---- shop -----------------------------------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PurchaseBody {
    id: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EquipBody {
    slot: Value,
    id: Value,
}

/// The shared prefix of the two shop routes, in the legacy order: method, name, token proof and bucket (before the body is
/// read), media type, body. `None` for the id means the token was not the profile's own (answered after the body checks).
async fn shop_prelude<T: serde::de::DeserializeOwned>(
    st: &St,
    name: Result<Path<String>, axum::extract::rejection::PathRejection>,
    req: Request,
) -> Result<(String, Option<i64>, HeaderMap, T), Response> {
    if req.method() != Method::POST {
        return Err(method_not_allowed("POST, OPTIONS"));
    }
    let Some(name) = name_of(name) else {
        return Err(bad_name());
    };
    let (parts, body) = req.into_parts();
    let token = token_of(&parts.headers).to_owned();
    let pid = {
        let _slot = slot(st).await?;
        authed(store_of(st), &name, &token)
            .await
            .map_err(|e| store_err("POST /api/profile/shop", e))?
    };
    // Only a request that proves the profile's token spends from its bucket (legacy `shopRateLimit`).
    if let Some(pid) = pid {
        if !st.a.shop.take(&pid, Instant::now()) {
            return Err(with_retry_after(
                err(
                    StatusCode::TOO_MANY_REQUESTS,
                    "too many requests, slow down",
                ),
                Duration::from_secs(1),
            ));
        }
    }
    let parsed = read_body::<T>(&parts.headers, body).await?;
    Ok((token, pid, parts.headers, parsed))
}

async fn purchase(
    axum::extract::State(st): axum::extract::State<St>,
    name: Result<Path<String>, axum::extract::rejection::PathRejection>,
    req: Request,
) -> Response {
    let (token, pid, headers, body) = match shop_prelude::<PurchaseBody>(&st, name, req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    // Idempotency: an optional `Idempotency-Key: <uuid>` is the durable purchase id, so a retry after a lost response
    // gets the same 200. Without one (the legacy contract has none) a fresh id is used and idempotency comes from
    // ownership: the second attempt finds the item owned under the profile row lock and answers 409 already_owned,
    // never a second debit.
    let purchase_id = match headers.get(IDEMPOTENCY_HEADER) {
        None => Uuid::new_v4(),
        Some(v) => match v.to_str().ok().and_then(|s| Uuid::parse_str(s).ok()) {
            Some(u) => u,
            None => return shop_err("bad_request", None),
        },
    };
    let Some(pid) = pid else {
        return forbidden();
    };
    let Some(item) = body.id.as_str().and_then(cosmetics::by_id) else {
        return shop_err("unknown_cosmetic", None);
    };
    if !item.for_sale() {
        return shop_err("not_for_sale", None);
    }
    let price = item.price.unwrap_or(0);
    let store = store_of(&st);
    let _slot = match slot(&st).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    match store
        .purchase_by_id(pid, &token, purchase_id, &item.id, price)
        .await
    {
        Ok(PurchaseOutcome::Ok { .. } | PurchaseOutcome::AlreadyApplied) => {
            current_profile(store, pid).await
        }
        Ok(PurchaseOutcome::AlreadyOwned) => shop_err("already_owned", None),
        Ok(PurchaseOutcome::Insufficient { need, have }) => {
            shop_err("insufficient_gv", Some((need, have)))
        }
        Ok(PurchaseOutcome::BadToken) => forbidden(),
        Err(rh_persist::Error::Conflict(_)) => json(
            StatusCode::CONFLICT,
            serde_json::json!({
                "error": "idempotency key was used for a different purchase",
                "code": "bad_request",
            }),
        ),
        Err(e) => store_err("POST /api/profile/purchase", e),
    }
}

async fn equip(
    axum::extract::State(st): axum::extract::State<St>,
    name: Result<Path<String>, axum::extract::rejection::PathRejection>,
    req: Request,
) -> Response {
    let (token, pid, _headers, body) = match shop_prelude::<EquipBody>(&st, name, req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(pid) = pid else {
        return forbidden();
    };
    let Some(slot) = body.slot.as_str().filter(|s| SLOTS.contains(s)) else {
        return shop_err("unknown_slot", None);
    };
    let item_id: Option<&str> = match &body.id {
        Value::Null => None,
        Value::String(id) => {
            let Some(c) = cosmetics::by_id(id) else {
                return shop_err("unknown_cosmetic", None);
            };
            if c.slot != slot {
                return shop_err("slot_mismatch", None);
            }
            Some(c.id.as_str())
        }
        _ => return shop_err("bad_request", None),
    };
    let store = store_of(&st);
    let _slot = match self::slot(&st).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    match store.equip_by_id(pid, &token, slot, item_id).await {
        Ok(EquipOutcome::Ok) => current_profile(store, pid).await,
        Ok(EquipOutcome::NotOwned) => shop_err("not_owned", None),
        Ok(EquipOutcome::BadToken) => forbidden(),
        Err(e) => store_err("POST /api/profile/equip", e),
    }
}

async fn current_profile(store: &Store, profile_id: i64) -> Response {
    match store.get_profile_by_id(profile_id).await {
        Ok(Some(p)) => json(StatusCode::OK, serde_json::json!({ "profile": dto(p) })),
        Ok(None) => forbidden(),
        Err(e) => store_err("profile read", e),
    }
}

// ---- leaderboard ----------------------------------------------------------------------------------------------

/// Cached leaderboard pages. An entry is current while this store's GV-credit epoch is the one read before its query
/// (every result transaction that credits GV, from any room of this process, bumps it after COMMIT) and it is younger than
/// `leaderboard_ttl` (which bounds staleness from other hosts' credits, since each host only sees its own epoch).
#[derive(Default)]
pub(crate) struct Board {
    rows: HashMap<String, (u64, Instant, Arc<Vec<LeaderRow>>)>,
    months: Option<(u64, Instant, Arc<Vec<String>>)>,
}

fn board(st: &St) -> std::sync::MutexGuard<'_, Board> {
    st.a.board.lock().unwrap_or_else(|p| p.into_inner())
}

async fn board_rows(st: &St, month: &str) -> Result<Arc<Vec<LeaderRow>>, rh_persist::Error> {
    let store = store_of(st);
    let ttl = st.a.cfg.leaderboard_ttl;
    let epoch = store.gv_epoch();
    let now = Instant::now();
    if let Some((e, at, rows)) = board(st).rows.get(month) {
        if *e == epoch && now.saturating_duration_since(*at) < ttl {
            return Ok(rows.clone());
        }
    }
    let rows = Arc::new(store.leaderboard_rows(month, LEADERBOARD_MAX_LIMIT).await?);
    let mut b = board(st);
    // Empty months are cached too (a caller probing arbitrary months would otherwise cost one query per request), but
    // under the same bound: when full, stale entries go first, then the empty ones, then everything.
    if b.rows.len() >= 64 && !b.rows.contains_key(month) {
        b.rows
            .retain(|_, (e, at, _)| *e == epoch && at.elapsed() < ttl);
        if b.rows.len() >= 64 {
            b.rows.retain(|_, (_, _, r)| !r.is_empty());
        }
        if b.rows.len() >= 64 {
            b.rows.clear();
        }
    }
    b.rows.insert(month.to_owned(), (epoch, now, rows.clone()));
    Ok(rows)
}

async fn board_months(st: &St) -> Result<Arc<Vec<String>>, rh_persist::Error> {
    let store = store_of(st);
    let ttl = st.a.cfg.leaderboard_ttl;
    let epoch = store.gv_epoch();
    let now = Instant::now();
    if let Some((e, at, m)) = &board(st).months {
        if *e == epoch && now.saturating_duration_since(*at) < ttl {
            return Ok(m.clone());
        }
    }
    let months = Arc::new(store.leaderboard_months(LEADERBOARD_MAX_MONTHS).await?);
    board(st).months = Some((epoch, now, months.clone()));
    Ok(months)
}

/// The single value of `key`; `Err` when it is repeated (Express turned that into an array, which no check accepts).
fn single<'a>(pairs: &'a [(String, String)], key: &str) -> Result<Option<&'a str>, ()> {
    let mut it = pairs.iter().filter(|(k, _)| k == key);
    let first = it.next().map(|(_, v)| v.as_str());
    if it.next().is_some() {
        return Err(());
    }
    Ok(first)
}

/// Legacy limit: `^[+-]?\d+$` is a number (clamped 1..=100, saturating for huge values); anything else is the default.
fn parse_limit(raw: Result<Option<&str>, ()>) -> i64 {
    let Ok(Some(s)) = raw else {
        return LEADERBOARD_DEFAULT_LIMIT;
    };
    let digits = s.strip_prefix(['+', '-']).unwrap_or(s);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return LEADERBOARD_DEFAULT_LIMIT;
    }
    let n: i128 = s.parse().unwrap_or(if s.starts_with('-') {
        i128::MIN
    } else {
        i128::MAX
    });
    n.clamp(1, i128::from(LEADERBOARD_MAX_LIMIT)) as i64
}

async fn leaderboard(axum::extract::State(st): axum::extract::State<St>, req: Request) -> Response {
    if req.method() != Method::GET {
        return method_not_allowed("GET, OPTIONS");
    }
    let Ok(Query(pairs)) = Query::<Vec<(String, String)>>::try_from_uri(req.uri()) else {
        return err(StatusCode::BAD_REQUEST, "bad request");
    };
    let month = match single(&pairs, "month") {
        Ok(None) => current_month(),
        Ok(Some(m)) if valid_month(m) => m.to_owned(),
        _ => return err(StatusCode::BAD_REQUEST, "invalid month, expected YYYY-MM"),
    };
    let limit = parse_limit(single(&pairs, "limit")) as usize;
    let _slot = match slot(&st).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    let rows = match board_rows(&st, &month).await {
        Ok(r) => r,
        Err(e) => return store_err("GET /api/leaderboard", e),
    };
    let months = match board_months(&st).await {
        Ok(m) => m,
        Err(e) => return store_err("GET /api/leaderboard", e),
    };
    let entries: Vec<Value> = rows
        .iter()
        .take(limit)
        .map(|r| {
            let mut e = serde_json::json!({ "name": r.name, "gv": r.gv });
            if let Some(t) = &r.title {
                e["title"] = Value::String(t.clone());
            }
            e
        })
        .collect();
    let mut body = serde_json::json!({ "month": month, "entries": entries, "months": *months });
    // Only the named profile's owner gets its place: without the token anyone could follow any callsign's GV month by
    // month. No token or a wrong one: no `you`, and no error.
    if let Ok(Some(name)) = single(&pairs, "name") {
        if valid_callsign(name) {
            let store = store_of(&st);
            match authed(store, name, token_of(req.headers())).await {
                Ok(Some(pid)) => match store.leaderboard_rank(&month, pid).await {
                    Ok(Some((rank, gv))) => {
                        body["you"] = serde_json::json!({ "rank": rank, "gv": gv })
                    }
                    Ok(None) => {}
                    Err(e) => return store_err("GET /api/leaderboard", e),
                },
                Ok(None) => {}
                Err(e) => return store_err("GET /api/leaderboard", e),
            }
        }
    }
    json(StatusCode::OK, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limit_follows_the_legacy_rules() {
        let p = |s: &str| parse_limit(Ok(Some(s)));
        assert_eq!(parse_limit(Ok(None)), 20);
        assert_eq!(parse_limit(Err(())), 20);
        assert_eq!(p("5"), 5);
        assert_eq!(p("+7"), 7);
        assert_eq!(p("0"), 1);
        assert_eq!(p("-3"), 1);
        assert_eq!(p("1000"), 100);
        assert_eq!(p("99999999999999999999999999999999999999999999"), 100);
        assert_eq!(p("-99999999999999999999999999999999999999999999"), 1);
        for bad in ["", "abc", "1.5", "1e3", " 5", "0x10", "+", "-"] {
            assert_eq!(p(bad), 20, "{bad:?}");
        }
    }

    #[tokio::test]
    async fn only_the_length_limit_error_type_means_payload_too_large() {
        let limit = to_bytes(axum::body::Body::from(vec![0u8; 16]), 4)
            .await
            .unwrap_err();
        assert!(is_length_limit(&limit));
        // A different failure whose text happens to say "length limit" is not a 413.
        let lookalike = axum::Error::new(std::io::Error::other("length limit exceeded"));
        assert!(!is_length_limit(&lookalike));
    }
}
