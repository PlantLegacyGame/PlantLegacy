# Art bible

**Status:** stub (T00). Owned by the C-series rendering tasks; updated at every gate.
**Source of truth:** DESIGN.md Part 19. This file exists so every AI session shares
one visual language; it is not a second spec.

## Pillars

1. Light is the hero — warm direct light, cool shade, visible canopy shadows.
2. Readable silhouettes — detail lives in gradients and shader noise.
3. Painterly materials, believable forms — no photographic high-frequency texture.
4. Quiet interface — the HUD disappears into the world's palette.

## Direction

Stylized naturalism (D-18). PBR-lite, one directional light, hemispheric ambient,
rim light on plants, aerial-perspective fog, per-time-of-day color grading.

## To be filled by

- **C01** — quality tiers, dynamic resolution, debug overlay budget.
- **C02 / C02b** — plant materials, mutation visual signatures, LOD appearance.
- **C03** — sky, weather, terrain, cutaway reuse.
- **C06** — audio direction.

## Asset policy (D-19)

All assets free (CC0 or permissive), self-hosted, recorded in `ATTRIBUTION.md`.
C01's asset loader must fail the build when an asset has no attribution entry.
Avoid NonCommercial licenses: real-money Spores make the project commercial.

## Mutation signature rules

A signature describes what a mutation does, never how strong it is. No rarity
glow, no tier colors, no unique meshes. At most three shader parameters per
mutation, all on the shared plant material (RULE_20).
