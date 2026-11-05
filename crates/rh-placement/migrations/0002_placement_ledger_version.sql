-- rh-placement ledger schema, version 2. Adds the per-row write counter every ledger write is compare-and-swapped on, so a
-- delayed copy of an earlier write (same fence, same holder) can never land after a later one. Existing rows start at 1.
-- Forward compatible: a version 1 binary refuses a version 2 database (it only knows versions up to 1), and this migration
-- is additive (one column with a default), so rows written before it stay valid.
ALTER TABLE rh_placement_requests ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version >= 1);

-- A purged `released` row keeps the placement id of its offer, so a late duplicate release still has to name it. Tombstones
-- made before this migration have none and refuse every release (fail closed).
ALTER TABLE rh_placement_requests ADD COLUMN final_placement_id text;
