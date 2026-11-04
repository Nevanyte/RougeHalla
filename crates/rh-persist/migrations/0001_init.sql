-- Schema v1. Money rule: profiles.gv is only ever changed together with a gv_ledger row (sum(ledger.delta) == gv).

CREATE TABLE profiles (
    callsign      text PRIMARY KEY CHECK (callsign ~ '^[A-Za-z0-9_-]{2,16}$'),
    -- SHA-256 of the token; the plain token is never stored.
    token_sha256  bytea NOT NULL CHECK (octet_length(token_sha256) = 32),
    gv            bigint NOT NULL DEFAULT 0 CHECK (gv >= 0),
    gv_lifetime   bigint NOT NULL DEFAULT 0 CHECK (gv_lifetime >= 0),
    stats         jsonb NOT NULL DEFAULT '{"runs":0,"wins":0,"draws":0,"deaths":0,"kills":0}',
    cosmetics     jsonb NOT NULL DEFAULT '{"owned":[],"equipped":{}}',
    achievements  jsonb NOT NULL DEFAULT '{}',
    progress      jsonb NOT NULL DEFAULT '{"qualifiedWins":0,"bountyRuns":0,"bestRunKills":0,"winsByFaction":{},"winsByWeapon":{}}',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Callsigns are case-insensitively unique.
CREATE UNIQUE INDEX profiles_callsign_lower ON profiles (lower(callsign));

CREATE TABLE gv_by_month (
    callsign text NOT NULL REFERENCES profiles (callsign),
    month    text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    gv       bigint NOT NULL CHECK (gv >= 0),
    PRIMARY KEY (callsign, month)
);
CREATE INDEX gv_by_month_month ON gv_by_month (month, gv DESC);

CREATE TABLE gv_ledger (
    id         bigserial PRIMARY KEY,
    callsign   text NOT NULL REFERENCES profiles (callsign),
    delta      bigint NOT NULL,
    reason     text NOT NULL,
    ref        text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gv_ledger_callsign ON gv_ledger (callsign);

CREATE FUNCTION gv_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'gv_ledger is append-only';
END $$;
CREATE TRIGGER gv_ledger_no_change BEFORE UPDATE OR DELETE ON gv_ledger
    FOR EACH ROW EXECUTE FUNCTION gv_ledger_append_only();

CREATE TABLE session_leases (
    callsign    text PRIMARY KEY REFERENCES profiles (callsign),
    match_id    uuid NOT NULL,
    owner       text NOT NULL,
    -- Monotonic per profile. The row is never deleted (release only marks it) so a fence is never reused.
    fence       bigint NOT NULL,
    expires_at  timestamptz NOT NULL,
    released_at timestamptz,
    acquired_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE match_results (
    match_id   uuid NOT NULL,
    callsign   text NOT NULL REFERENCES profiles (callsign),
    result     jsonb NOT NULL,
    fence      bigint NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, callsign)
);

-- Idempotency keys of shop purchases (not in the first design sketch; needed for purchase_id idempotency).
CREATE TABLE purchases (
    purchase_id uuid PRIMARY KEY,
    callsign    text NOT NULL REFERENCES profiles (callsign),
    item_id     text NOT NULL,
    price       bigint NOT NULL CHECK (price >= 0),
    created_at  timestamptz NOT NULL DEFAULT now()
);
