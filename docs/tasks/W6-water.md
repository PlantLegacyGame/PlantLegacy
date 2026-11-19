# W6 — Water, rebuilt on fewer surfaces

**Status:** proposal, not built. **Decided by:** the water stack's own bug list, not
by taste.

## Why this exists

Water grew one feature at a time and each feature added a surface. Today a single
river bend can carry three translucent layers plus the sea, and every new defect
has been fixed by adding a rule to keep those layers from fighting: a depth bias,
a near discard, a route clip mask, a lift, a hysteresis check, and a client-side
clamp of the server's own height field (`EnvironmentRenderer.clampTableToTerrain`).
`docs/what-works-now.md` describes the result honestly: each fix is a rule about
which of four surfaces may draw where.

Inventory of what draws water now:

| Surface | Owner | Why it exists |
|---|---|---|
| Rain sheet (puddles) | `surfaceWater` solver → `waterField` | standing water after rain |
| Water table mesh | server `RESOURCE_UPDATE.waterTable` → `waterField` | groundwater seen through a pit or burrow |
| River ribbon | surveyed channel → `waterField` | the flowing stream |
| Ocean dome | `ocean.ts` | the planet-wide sea |

Plus: two grid height fields, one 640² bed texture, a baked river mask that
clips the first two out of the channel, `aWater` depth attributes on two of them,
and the shader's ocean mode.

Every one of those is load-bearing today. The problem is not any single surface:
it is that four independent depth writers must agree about a film 5 cm thick,
and they cannot at distance.

## Options

| | A — wet terrain only | B — one inland surface | C — water in the ground pass | D — AG single volume |
|---|---|---|---|---|
| Inland water is | a soil-shader property: dampness, sheen, flow streaks | one mesh from the shared field + analytic river SDF | drawn by the terrain shader from the streamed height | one big transparent surface, AG `W_SURF` |
| Translucent surfaces | **0** | 1 (+ocean) | 0 (+ocean) | 1 (+ocean) |
| Draw passes added | none | 1 (transparent) | none | 1 + a depth prepass |
| Kills z-fighting between layers | completely | mostly | completely | no — still one layer against the ground |
| Shoreline | where the damp gradient ends | SDF distance → foam | where the height texture crosses the ground | depth texture + foam |
| Reflections / TIR | none | Fresnel sky + optional screen-space | screen-space only | full refraction and Snell's window |
| Cost | cheapest | medium | cheap, one extra texture fetch in the ground shader | heaviest; needs tiers |
| Failure it removes | every overlap and depth-bias bug | table/ribbon/sheet duplication | all translucent-overlap bugs inland | none structural |

**D** is what Abyssal Garden does (`docs/abyssal-garden-source-analysis.md` §6.1, §6.2, §6.5 —
underwater absorption, caustics from the water texture, and the water surface from below). It is beautiful and it is
one surface — but it is still a transparent layer over the ground, so it keeps
exactly the depth fight this project keeps losing, and it needs a prepass and a
quality tier to be affordable.

## Recommendation

**C for inland water, A for shallow film, keep the ocean dome.** Concretely:

1. Delete the water table mesh and its streamed grid. The underground waterline is
   already drawn by the soil shader's capillary band, so a pit still looks wet; a
   separate mesh seen through the cavity was the only thing it added.
2. Draw rail/pond/river water in the terrain pass from the existing height field:
   the ground shader compares its own depth against the water height, darkens by
   Beer–Lambert, adds a flow streak along `aFlowUV` and a Fresnel sheen. No new
   geometry, no depth bias, no near discard — nothing to fight.
3. Puddles become wetness in the same shader at millimetre depth; foam is a band
   where the height difference is near zero.
4. Keep the ocean dome and its bed texture; it is the one place a single surface
   at scale already works.
5. Only if reflections are missed: add screen-space reflection to the inland case
   behind a quality tier, never a second surface.

Net: four water surfaces become one (+ the sea), three clip/bias/hysteresis rules
become none, and `clampTableToTerrain` disappears with the table.

## Slice plan

- **Slice 1 — delete the table.** Remove the mesh, its stream, and the client
  clamp. Verify a burrowed eye still sees a wet waterline, and a pit still fills.
  Expected to delete more code than it adds.
- **Slice 2 — water in the ground shader.** Height texture + depth compare +
  absorption + flow. Acceptance: no z-fighting from the highest preview camera,
  no square sheet edge, a shoreline that follows the drawn terrain, and the same
  water at 5 cm and 3 m.
- **Slice 3 — puddles as wetness.** The solver keeps running; only its rendering
  moves into the shader.
- **Slice 4 (optional)** — screen-space reflection tier.

## Risks

- The ground shader is already large (`ground/shaderOverrides`, soil detail); this
  adds branches and a texture fetch. Measure at the tier floor before slice 2.
- Losing the standalone surfaces loses specular highlights that read as "water"
  at grazing angles. The wetness sheen must be tuned against the current look.
- The ocean dome stays a transparent layer; it must not gain a second one.

## Not decided here

Whether the underground water table should exist as *data* at all. The server
needs groundwater for roots; this document only proposes that it stops being a
drawn surface.
