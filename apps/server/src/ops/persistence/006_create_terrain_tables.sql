-- T25: sparse soil edits. The base surface is derived from the world seed, so
-- only chunks that were edited, their voids and the append-only edit log are
-- stored.
CREATE TABLE IF NOT EXISTS terrain_chunks (
  world_id TEXT NOT NULL,
  cx INTEGER NOT NULL,
  cz INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  heights BYTEA NOT NULL,
  moisture BYTEA NOT NULL,
  compaction BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (world_id, cx, cz)
);

CREATE TABLE IF NOT EXISTS terrain_edits (
  id BIGINT NOT NULL,
  world_id TEXT NOT NULL,
  tick BIGINT NOT NULL DEFAULT 0,
  actor_plant_id TEXT,
  kind TEXT NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  z DOUBLE PRECISION NOT NULL,
  radius_m DOUBLE PRECISION NOT NULL,
  volume_m3 DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (world_id, id)
);

CREATE INDEX IF NOT EXISTS terrain_edits_world_tick_idx
  ON terrain_edits (world_id, tick);

CREATE TABLE IF NOT EXISTS terrain_voids (
  world_id TEXT NOT NULL,
  id BIGINT NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  z DOUBLE PRECISION NOT NULL,
  radius_m DOUBLE PRECISION NOT NULL,
  volume_m3 DOUBLE PRECISION NOT NULL,
  stability DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (world_id, id)
);
