-- Schema v1. Money rule: profiles.gv is only ever changed together with a gv_ledger row (sum(ledger.delta) == gv).
--
-- Identity: a profile IS its `profile_id` (surrogate, never reused, never shown). The callsign is a display attribute: unique
-- case-insensitively, but it can be renamed (moderation, a legacy case collision) without touching a single child row.
-- Every child table references profile_id, so the append-only ledger never has to be rewritten for a rename.
--
-- (This file was rewritten in place before any production database existed: only throwaway test databases had applied
-- the earlier text. From the first real deployment on, a change is a NEW migration, never an edit.)

CREATE TABLE profiles (
    profile_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    callsign      text NOT NULL CHECK (callsign ~ '^[A-Za-z0-9_-]{2,16}$'),
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

-- Which binaries may run against this database. A binary whose version (the newest migration it embeds) is below
-- `min_binary` refuses to start. Additive migrations leave it alone (expand/contract: old binaries keep running); only a
-- migration that an old binary cannot survive (a dropped or retyped column, a changed meaning) raises it.
CREATE TABLE schema_compat (
    only_row   boolean PRIMARY KEY DEFAULT true CHECK (only_row),
    min_binary integer NOT NULL
);
INSERT INTO schema_compat (min_binary) VALUES (1);

CREATE TABLE gv_by_month (
    profile_id bigint NOT NULL REFERENCES profiles (profile_id),
    month      text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    gv         bigint NOT NULL CHECK (gv >= 0),
    PRIMARY KEY (profile_id, month)
);
CREATE INDEX gv_by_month_month ON gv_by_month (month, gv DESC);

CREATE TABLE gv_ledger (
    id         bigserial PRIMARY KEY,
    profile_id bigint NOT NULL REFERENCES profiles (profile_id),
    delta      bigint NOT NULL,
    reason     text NOT NULL,
    ref        text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gv_ledger_profile ON gv_ledger (profile_id);

CREATE FUNCTION gv_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'gv_ledger is append-only';
END $$;
CREATE TRIGGER gv_ledger_no_change BEFORE UPDATE OR DELETE ON gv_ledger
    FOR EACH ROW EXECUTE FUNCTION gv_ledger_append_only();

CREATE TABLE session_leases (
    profile_id  bigint PRIMARY KEY REFERENCES profiles (profile_id),
    match_id    uuid NOT NULL,
    owner       text NOT NULL,
    -- Monotonic per profile. The row is never deleted (release only marks it) so a fence is never reused.
    fence       bigint NOT NULL,
    expires_at  timestamptz NOT NULL,
    released_at timestamptz,
    acquired_at timestamptz NOT NULL DEFAULT now()
);

-- One row per match that banked a result, written (idempotently) by the first result transaction of the match.
-- `placement_id` and `region` are the hosting adapter's (GameLift placement, location) and stay NULL until one reports them;
-- `replay_ref` points at the stored replay once a replay store exists. `content_hash` is the rules identity as a signed
-- 64-bit reinterpretation of the unsigned hash. `ended_at` is the time of the LATEST recorded result of the match (each result
-- transaction advances it); per-player times are match_results.applied_at.
CREATE TABLE matches (
    match_id     uuid PRIMARY KEY,
    owner        text NOT NULL,
    region       text,
    placement_id text,
    build        text NOT NULL,
    content_hash bigint NOT NULL,
    ended_at     timestamptz NOT NULL DEFAULT now(),
    humans       integer NOT NULL CHECK (humans >= 0),
    bots         integer NOT NULL CHECK (bots >= 0),
    replay_ref   text
);

CREATE TABLE match_results (
    match_id   uuid NOT NULL REFERENCES matches (match_id),
    profile_id bigint NOT NULL REFERENCES profiles (profile_id),
    -- {"v":1, ...the complete RunResult fields plus faction and weapon, camelCase}. See rh_persist::MatchResult.
    result     jsonb NOT NULL,
    fence      bigint NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, profile_id)
);
CREATE INDEX match_results_profile ON match_results (profile_id);

-- Idempotency keys of shop purchases (not in the first design sketch; needed for purchase_id idempotency).
CREATE TABLE purchases (
    purchase_id uuid PRIMARY KEY,
    profile_id  bigint NOT NULL REFERENCES profiles (profile_id),
    item_id     text NOT NULL,
    price       bigint NOT NULL CHECK (price >= 0),
    created_at  timestamptz NOT NULL DEFAULT now()
);
