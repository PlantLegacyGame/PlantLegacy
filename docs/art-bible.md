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

## Organism Anatomy & Visual Fusion (C02 / T02)

Plants in Plant Legacy are living organisms, not collections of intersecting geometric blocks:
1. **Unified Organism Skin (SDF `smin`):** Primitive capsules and node spheres are fused mathematically using smooth minimum (`smin`). Forking branches, lateral roots, and the root crown form smooth organic collars and fillets without polygon clipping, internal end-caps, or floating parts.
2. **Seamless Root-to-Canopy Continuum:** The subterranean root system and the aboveground shoot/trunk are one continuous anatomical structure penetrating the ground at $y = 0$. In Root Sight, the earth peels back to reveal the subterranean anatomy of that same unbroken organism.
3. **Continuous 3D Texture Language:** UV-free 3D Fractional Brownian Motion (fbm) noise flows across joints and branches without seam distortion or UV stretching. Woody bark on stems, fibrous pale texture on roots, and translucent chlorophyll on foliage.
4. **Living Motion:** Procedural 3D wind field displaces branches organically (higher nodes sway further with time-varying harmonics) with zero CPU animation overhead.

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
glow, no tier colors, no unique meshes. All of it paints the shared plant
material (RULE_20).

The style itself is data, not code (RULE_3, ADR-059): `config/mutation_visuals.json`
holds one record per mutation — organ family, pattern, tint and strength,
variegation, glow, bark thickness and darkening, thorn density — and every held
mutation composes into it. The "three shader parameters" limit this file used to
quote is superseded by that record; what still holds is that the amounts are
capped (`values.caps`), stacked values are clamped rather than multiplied
open, and the renderer knows no mutation by name.

## Water and what it does to light

Water is a medium, not a decal (ADR-062). Two looks have to agree:

1. **Above it** — the sheet is a lid you see: Fresnel sky at grazing angles, the
   water's own body colour where you look down into it, absorption darkening with
   depth (Beer–Lambert), rain rings and downstream streaks, foam-free shoreline
   (the damp-soil stain is the shore).
2. **Under it** — the same surface is a ceiling: a bright, rippling *Snell's
   window* within ~48.6° of vertical, total internal reflection (dim, greenish,
   mirror-like) everywhere outside it. The view between is the water's colour, not
   the sky's: fog collapses to a few metres, direct sun is eaten with depth, and
   there is no horizon.

Rule: the colours are `water_deep_color`, `water_shallow_color` and
`water_sky_color` in `config/water.json`, and one set paints the medium, the fog
and every sheet, so a pond cannot be blue from above and green from inside.

Rule: **water has no straight edge.** The sheets are square grids, so their alpha
falls off radially as well as with distance (`sheet_edge_fade`); a lid of water
that stops on a line is a texture, and from a high camera it read as a square of
water in the middle of the world.
