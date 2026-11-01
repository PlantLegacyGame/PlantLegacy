# Protocol

**Status:** not decided. Owner: **T03P** (Gate 0, week 2). Implemented by T03.
**Source of truth:** DESIGN.md Part 13.8.

T03P must return this document filled in. Nothing may assume a protocol before
that note exists.

## What T03P must decide

- Framing: `[version:u8][type:u8][payload]` is the starting point, not a mandate.
- Message catalogue: intents from the client, state deltas from the server,
  `ack` / `reject` with reason codes.
- Quantization: positions to 1/64 unit, angles to 16 bits.
- Keyframe interval and delta rules.
- Per-message-type rate limits.
- Version-mismatch behavior: a friendly "update required" screen.

## Fixed by the plan

- Server is authoritative for all state that affects other players (RULE_4).
- Client prediction is limited to camera and self-movement.
- Growth and combat are never predicted.
- Compression is off on the hot path; optional for large cold payloads.
