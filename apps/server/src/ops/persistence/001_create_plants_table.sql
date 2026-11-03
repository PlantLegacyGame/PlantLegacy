-- Plant persistence schema for T03
-- Binary snapshot + append-only event log per Part 13.9

CREATE TABLE IF NOT EXISTS world_plants (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    -- Compact binary snapshot of the plant's node graph
    snapshot BYTEA NOT NULL,
    -- Append-only event log since last snapshot (JSON array of events)
    event_log JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Plant metadata for quick queries without deserializing snapshot
    root_node_id TEXT,
    total_biomass DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_upkeep DOUBLE PRECISION NOT NULL DEFAULT 0,
    node_count INTEGER NOT NULL DEFAULT 0,
    max_nodes INTEGER NOT NULL DEFAULT 2000,
    last_growth_tick BIGINT NOT NULL DEFAULT 0,
    growth_cooldown_until BIGINT NOT NULL DEFAULT 0,
    -- Tier for offline simulation (Part 13.6): 'active', 'near', 'dormant'
    tier TEXT NOT NULL DEFAULT 'dormant',
    -- Last time this plant was updated (for tier transitions)
    last_tick BIGINT NOT NULL DEFAULT 0,
    -- Created/updated timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_world_plants_owner ON world_plants(owner_id);
CREATE INDEX IF NOT EXISTS idx_world_plants_world ON world_plants(world_id);
CREATE INDEX IF NOT EXISTS idx_world_plants_tier ON world_plants(tier);
CREATE INDEX IF NOT EXISTS idx_world_plants_last_tick ON world_plants(last_tick);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_world_plants_updated_at ON world_plants;
CREATE TRIGGER trigger_world_plants_updated_at
    BEFORE UPDATE ON world_plants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Event log for global world events (chat, etc.) - Part 13.9 mentions event log
CREATE TABLE IF NOT EXISTS world_events (
    id BIGSERIAL PRIMARY KEY,
    world_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    tick BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_world_events_world_tick ON world_events(world_id, tick);
CREATE INDEX IF NOT EXISTS idx_world_events_type ON world_events(type);