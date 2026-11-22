-- T08A: the player's pouch and purse.
--
-- The inventory used to live only on the ConnectedPlayer object, so a restart
-- rebuilt it from the starting kit and a reconnect could duplicate a purchase.
-- This is one row per owner (account id), not per plant: an account keeps its
-- pouch and purse when its plant dies and it starts a new seed.
--
-- slots is a JSON array of { itemId, count } or null, bounded by the configured
-- slot count at the server's own validator. spores is a bigint because the
-- configured ceiling is far above a 32-bit integer. The check constraints are a
-- last line of defence, not the validation: a malformed row must fail loudly
-- rather than load a negative purse or a non-array pouch.

CREATE TABLE IF NOT EXISTS player_state (
    owner_id TEXT PRIMARY KEY,
    slots JSONB NOT NULL DEFAULT '[]'::jsonb,
    spores BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT player_state_slots_is_array CHECK (jsonb_typeof(slots) = 'array'),
    CONSTRAINT player_state_spores_non_negative CHECK (spores >= 0)
);
