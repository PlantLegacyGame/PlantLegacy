# T25 manual checklist

Run `pnpm dev`, open `http://localhost:4173/?dev=1`.

## Ground

- [ ] Walk 500 m from spawn: the ground rises and falls, and the horizon patch
      meets the detail patch without a visible seam or step.
- [ ] Stand on a slope: the camera does not sink into the hill, and the orbit
      target follows the surface.
- [ ] Walk off the detail patch: the player keeps walking on the outer patch
      instead of falling through.

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
