# T25 manual checklist

Run `pnpm dev`, open `http://localhost:4173/?dev=1`.

**Status: never walked.** Every box below is a browser or person check that no
session has performed end to end. What the tests do pin, so the walk would mostly
be confirming rather than discovering: `apps/server/src/ops/terrain.test.ts`
(lowering only for a shallow tunnel, a deep tunnel that records volume and leaves
the surface alone, the per-edit volume cap, a dry void collapsing into a dimple,
and a snapshot that restores edits and voids),
`physics/plantColliderPlan.test.ts` (which parts get a collider and how much),
`world/soilPhysics.test.ts` (a void's own stability). What remains unverified
by anything is the human part: walking 500 m over a rise, standing on a slope,
or orbiting a mature plant without the camera sinking. A box left open here is a
gap in verification, not a claim that the feature is missing — and a box ticked
here would be a claim that somebody stood on the ground and looked.

## Ground

- [ ] Walk across the 620 m play disc: the ground rises and falls. At the disc
      rim, note the 20 km transition ring's seam; the 620 m boundary is the known
      limitation described in `planet-scale.md` §2.1, not a passing no-seam check.
- [ ] Stand on a slope: the camera does not sink into the hill, and the orbit
      target follows the surface.
- [ ] Walk to the disc rim: the player stays on the disc heightfield; the ring
      and the global globe are scenery, not walkable ground. Do not expect to
      walk on the outer ring.

## Plant colliders

- [ ] Rain or debris (when wired) stops on a leaf instead of passing through.
- [ ] Camera orbit around a mature plant: the camera is pushed in by a branch
      instead of clipping through it.
- [ ] With two plants nearby, roots and stems of one do not collide with the
      other (plants are static relative to each other).
- [ ] A 100-node plant does not drop frames while growing (collider rebuilds
      are debounced at 10 Hz).

## Root Sight

- [ ] Press `R`: the cutaway follows root branches rather than one sphere.
- [ ] A rival plant's roots nearby open their own bubbles; a distant rival does
      not widen the opening.
- [ ] Orbit below the surface: the camera follows roots underground instead of
      being clamped above the grass.
- [ ] Close Root Sight: the camera returns above the ground.
- [ ] Roots inside the opening are drawn; roots outside it are hidden by soil.

## Soil edits and persistence

- [ ] Grow a shallow root run: the surface around it sinks and a ring of raised
      soil appears.
- [ ] Grow a deep root run: no surface change, but Root Sight shows a tunnel.
- [ ] Wait: a dry, loose tunnel collapses and the surface dimples.
- [ ] Restart the server and reconnect: the same tunnels still appear in Root
      Sight.
- [ ] `TERRAIN_REGION_REQUEST` in the network tab returns a `TERRAIN_REGION`
      and a `TERRAIN_EDITS` packet, and no other client receives them.

## Known non-visual

- Surface height deltas are not yet applied to the lit ground mesh; only the
  Root Sight cavity reflects them.
