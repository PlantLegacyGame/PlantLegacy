-- Season calendar persistence.
--
-- The plant rows say what is growing; this row says when the world is. It is
-- one row per world: the calendar is world state, not per-plant state, so
-- replanting after a calamity must not reset the season number.
--
-- Remaining ticks, not an absolute tick: the simulation's tick counter starts at
-- zero on every boot, so an absolute start tick would make a restart either skip
-- a season or stretch one. last_calamity_at is wall time, for display only.

CREATE TABLE IF NOT EXISTS world_state (
    world_id TEXT PRIMARY KEY,
    season INTEGER NOT NULL DEFAULT 1,
    season_remaining_ticks BIGINT NOT NULL DEFAULT 0,
    last_calamity_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
