//! Profile, shop and leaderboard handlers (feature `postgres`). See the module docs of `api` for the layering.

use super::limits::PasscodeVerdict;
use super::{
    current_month, err, json, log_internal, method_not_allowed, with_retry_after, ClientAddr, St,
    IDEMPOTENCY_HEADER, MAX_BODY_BYTES, PASSCODE_HEADER, PROFILE_TOKEN_HEADER,
};
use axum::body::to_bytes;
use axum::extract::{Path, Query, Request};
use axum::http::{header, HeaderMap, Method, StatusCode};
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
        .route("/api/leaderboard", any(leaderboard))
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
        let too_large =
            std::error::Error::source(&e).is_some_and(|s| s.to_string().contains("length limit"));
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

fn name_of(p: Result<Path<String>, axum::extract::rejection::PathRejection>) -> Option<String> {
    p.ok().map(|Path(n)| n).filter(|n| valid_callsign(n))
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
    match authed(store, &name, presented).await {
        // Opening: the caller's own token proves ownership; it is echoed back because the legacy client stores the
        // `token` of every profile response. Nothing the server holds is returned (it holds only a hash).
        Ok(Some(_)) => return open(store, &name, presented).await,
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
    // Reserved before the insert so concurrent claims cannot all pass one check; refunded unless a name was created.
    if let Err(wait) = st.a.new_profiles.reserve(ip, now) {
        return with_retry_after(
            err(
                StatusCode::TOO_MANY_REQUESTS,
                "too many new callsigns lately, try again later",
            ),
            wait,
        );
    }
    let token = new_token();
    match store.create_profile(&name, &token).await {
        Ok(Claim::Created) => {}
        Ok(_) => {
            // Lost a race for the name.
            st.a.new_profiles.refund(ip, now);
            return forbidden_profile();
        }
        Err(e) => {
            st.a.new_profiles.refund(ip, now);
            return store_err("GET /api/profile", e);
        }
    }
    match store.get_profile(&name).await {
        Ok(Some(p)) => json(
            StatusCode::OK,
            serde_json::json!({ "profile": dto(p), "token": token, "created": true }),
        ),
        // The name exists (we just created it) but could not be read back: the caller has no other way to learn the
        // token, so say so rather than discard it silently.
        Ok(None) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
        Err(e) => store_err("GET /api/profile", e),
    }
}

fn forbidden_profile() -> Response {
    err(StatusCode::FORBIDDEN, "profile belongs to someone else")
}

async fn open(store: &Store, name: &str, token: &str) -> Response {
    match store.get_profile(name).await {
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
) -> Result<(String, String, Option<i64>, HeaderMap, T), Response> {
    if req.method() != Method::POST {
        return Err(method_not_allowed("POST, OPTIONS"));
    }
    let Some(name) = name_of(name) else {
        return Err(bad_name());
    };
    let (parts, body) = req.into_parts();
    let token = token_of(&parts.headers).to_owned();
    let pid = authed(store_of(st), &name, &token)
        .await
        .map_err(|e| store_err("POST /api/profile/shop", e))?;
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
    Ok((name, token, pid, parts.headers, parsed))
}

async fn purchase(
    axum::extract::State(st): axum::extract::State<St>,
    name: Result<Path<String>, axum::extract::rejection::PathRejection>,
    req: Request,
) -> Response {
    let (name, token, pid, headers, body) = match shop_prelude::<PurchaseBody>(&st, name, req).await
    {
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
    if pid.is_none() {
        return forbidden();
    }
    let Some(item) = body.id.as_str().and_then(cosmetics::by_id) else {
        return shop_err("unknown_cosmetic", None);
    };
    if !item.for_sale() {
        return shop_err("not_for_sale", None);
    }
    let price = item.price.unwrap_or(0);
    let store = store_of(&st);
    match store
        .purchase(&name, &token, purchase_id, &item.id, price)
        .await
    {
        Ok(PurchaseOutcome::Ok { .. } | PurchaseOutcome::AlreadyApplied) => {
            current_profile(store, &name).await
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
    let (name, token, pid, _headers, body) = match shop_prelude::<EquipBody>(&st, name, req).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if pid.is_none() {
        return forbidden();
    }
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
    match store.equip(&name, &token, slot, item_id).await {
        Ok(EquipOutcome::Ok) => current_profile(store, &name).await,
        Ok(EquipOutcome::NotOwned) => shop_err("not_owned", None),
        Ok(EquipOutcome::BadToken) => forbidden(),
        Err(e) => store_err("POST /api/profile/equip", e),
    }
}

async fn current_profile(store: &Store, name: &str) -> Response {
    match store.get_profile(name).await {
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
    // A month nobody banked GV in costs one indexed query and no cache entry, so a caller cannot fill the map with them.
    if rows.is_empty() {
        b.rows.remove(month);
    } else {
        if b.rows.len() >= 64 {
            b.rows
                .retain(|_, (e, at, _)| *e == epoch && at.elapsed() < ttl);
            if b.rows.len() >= 64 {
                b.rows.clear();
            }
        }
        b.rows.insert(month.to_owned(), (epoch, now, rows.clone()));
    }
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
}
