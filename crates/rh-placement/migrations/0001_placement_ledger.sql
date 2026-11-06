-- rh-placement ledger schema, version 1. Applied by `PgLedger::migrate` inside one transaction under an advisory lock.
-- Own `rh_placement_*` table names and its own version table (`rh_placement_schema`): it never touches sqlx's
-- `_sqlx_migrations`, so it can share a database with rh-persist.

CREATE TABLE rh_placement_epoch (
    singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    nonce      bytea NOT NULL CHECK (octet_length(nonce) = 32),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE rh_placement_requests (
    request_id   text PRIMARY KEY CHECK (char_length(request_id) BETWEEN 1 AND 64),
    scope        text NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 128),
    fingerprint  text NOT NULL CHECK (char_length(fingerprint) = 64),
    request_json jsonb,
    config_json  jsonb,
    zone         text,
    phase        text NOT NULL CHECK (phase IN ('active','offered','releasing','released','finished','tombstone')),
    final_phase  text CHECK (final_phase IN ('finished','released')),
    fence        bigint NOT NULL CHECK (fence >= 1),
    claim_kind   text NOT NULL DEFAULT 'none' CHECK (claim_kind IN ('none','worker','reaper','release')),
    claim_holder text,
    claim_until  timestamptz,
    state        jsonb,
    created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at  timestamptz,
    CHECK ((phase = 'tombstone') = (final_phase IS NOT NULL)),
    CHECK (phase = 'tombstone' OR (request_json IS NOT NULL AND config_json IS NOT NULL AND zone IS NOT NULL AND state IS NOT NULL))
);

CREATE INDEX rh_placement_reapable ON rh_placement_requests (updated_at)
    WHERE phase IN ('active', 'releasing');
CREATE INDEX rh_placement_purgeable ON rh_placement_requests (finished_at)
    WHERE phase IN ('finished', 'released');
