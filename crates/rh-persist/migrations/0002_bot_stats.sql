-- P-BOTS-5: the filler bots' learning stats (legacy server/src/bots/learning/BotStatsStore.ts) kept off-tick in PostgreSQL
-- instead of the legacy JSON file. Additive migration: old binaries keep running (schema_compat.min_binary stays 1).
--
-- The baseline is one decayed placement cell per tier; the entries are the decayed residual cells per choice key
-- (domain|a|b, at most 96 bytes). The source file accepted any file it could parse and dropped damaged entries; the table
-- constraints make a damaged row impossible to store in the first place, and the store still drops one on read (defence
-- in depth, the source's "one bad row is not worth the other rows").
CREATE TABLE bot_learning_baseline (
    tier text PRIMARY KEY CHECK (tier IN ('easy', 'normal', 'hard')),
    n    double precision NOT NULL CHECK (n >= 0 AND n NOT IN ('NaN'::double precision, 'Infinity'::double precision)),
    s    double precision NOT NULL CHECK (s >= 0 AND s <= n + 1e-9
                                         AND s NOT IN ('NaN'::double precision, 'Infinity'::double precision))
);

CREATE TABLE bot_learning_entries (
    key        text PRIMARY KEY
               CHECK (octet_length(key) <= 96
                      AND key ~ '^(faction|opener|second|spawn|boon|skill|relic|camp)\|[^|]+\|[^|]+$'),
    n          double precision NOT NULL CHECK (n >= 0 AND n NOT IN ('NaN'::double precision, 'Infinity'::double precision)),
    s          double precision NOT NULL CHECK (s >= 0 AND s <= n + 1e-9
                                               AND s NOT IN ('NaN'::double precision, 'Infinity'::double precision)),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- Eviction orders by the decayed count; the index keeps that and the table scan honest.
CREATE INDEX bot_learning_entries_decay ON bot_learning_entries (n);
