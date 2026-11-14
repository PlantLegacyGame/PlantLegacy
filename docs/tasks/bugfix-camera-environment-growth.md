# Bug-fix plan: camera, UI, ground, sky and growth gizmo

Ordered easiest/simplest first. Each item is checked before moving on.

1. **Camera pole flip** — prevent the orbit from reaching the degenerate directly-overhead pole; keep a stable camera up near vertical. ✅
2. **Near-ground stutter** — remove the per-frame post-orbit camera floor shove and make the ground-aware polar limit stable. ✅
3. **Ground/cavity z-fighting** — polygon-offset and slightly bury the cavity bowl rim where it meets the cut ground. ✅
4. **Resource readout freshness** — make read-only DevPanel rows refresh from authoritative values at least once per second. ✅
5. **Skipped server ticks** — stop gating the tick readout on a four-tick threshold; feed all authoritative tick sources through one live readout. ✅
6. **Layered underground** — keep one visible dirt shell while underground; hide the distant planet/outer-LOD shells, and give the cavity bowl a real dirt surface instead of flat vertex colour. ✅
7. **Rain streaks** — build each drop quad from the world fall direction and a camera-facing side axis so it reads as falling water from above and the side. ✅
8. **Sky/space/stars** — add a dark space floor outside the atmosphere and replace warped star cells with a stable 3D star field. ✅
9. **Root Sight pre-growth expansion** — weight cavity size and node bubbles by growth progress so the pit does not open for a node before it grows. ✅
10. **Detached third root** — always use the server's parent attachment point, including after a node has finished growing. ✅
11. **3D growth gizmo** — allow the ring to be placed on the hit point of the selected node and hide it when the plant itself occludes that point. ✅ (verified by moving the ring behind the seed and orbiting the camera back to the front)

Verification: `pnpm verify` passes (lint, typecheck, config validation, 130 shared / 84 client / 8 weather / 189 server tests). After a fresh reload, the camera stayed stable at its lowest ground-contact orbit, a seed → radicle → lateral root → second lateral root chain rendered connected, and the Root Sight cavity showed enclosing dirt from above and below with the plant visible inside the aperture. Visual checks also covered the Root Sight cavity wall, rain streak orientation from above, live resource/tick readout, and moving the gizmo ring behind the seed and orbiting back to the front.
