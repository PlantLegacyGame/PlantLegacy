-- Add unique constraint on rate_limits for atomic upsert
-- This enables ON CONFLICT (ip_address, endpoint) in checkRateLimit

-- First, deduplicate existing data by keeping the latest window_start per ip/endpoint
DELETE FROM rate_limits a
USING rate_limits b
WHERE a.id < b.id
  AND a.ip_address = b.ip_address
  AND a.endpoint = b.endpoint;

-- Add unique constraint
ALTER TABLE rate_limits
ADD CONSTRAINT unique_rate_limit_ip_endpoint UNIQUE (ip_address, endpoint);

-- The existing index idx_rate_limits_ip_endpoint is now redundant but we keep it for query performance
-- (the unique constraint creates its own index)