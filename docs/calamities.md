# Calamities

**Status:** direction and core mechanics accepted by the owner on 2026-11-21
and 2026-11-22; not shipped behaviour. No calamity director, zone system or
natural schedule exists in the build yet. `config/world.json` now defaults a
season to 90 real days (ADR-078). The settled rules are survivor carry-over,
time acceleration, no luck roll, survivor state, downloadable demo packaging and
the revised gate baseline.

This document replaces the old single "season-end calamity" model. It is the
working spec for the calamity system and the source for the slices that will
follow. Where it disagrees with an older task description, this document and
ADR-078 are current.

## 1. What changed

The old season boundary killed every plant in one global event. The new model is:

- **Many calamities per season**, not one. Some are natural, some are triggered
  by a developer or the dev panel.
- **Every calamity is placed.** It has a shape, a centre or path, a radius or
  width, a duration and a falloff. "Worldwide" is one shape, not the default.
- **Calamities are survivable.** A plant in the wrong place can die; a plant at
  the edge, sheltered, or built for that hazard can lose parts and live. The
  final cataclysm is the largest event, not an automatic wipe.
- **A season can be survived.** A plant that lives through the final cataclysm
  carries into the next season. A player who wants to see the next season is not
  required to die.
- **Lineage is earned.** A plant that dies passes on lineage only through a
  propagule it actually made: a seed, bulb, tuber, rhizome, spore or another
  configured equivalent. There is no automatic calamity seed, and no seed from a
  plant that never produced one.
- **Time accelerates after a calamity.** A short recovery window runs at a
  higher simulation scale, and the inter-season deep-time transformation runs as
  a replayable time-lapse. The server tick rate does not change.

## 2. Season shape

A season is **90 real days** by default. Ninety days is the first number to
test, not a lock; it is a tunable in `config/world.json`.

The natural schedule is a **seeded deck per world**, not a fixed script. A
season should contain roughly six to ten natural events, with the final
cataclysm at day 90. The exact count is a config target and should be tuned so a
player who logs in for an hour still has a reasonable chance of seeing one
warning or aftermath.

| Window | Default fraction | What it is for |
|---|---|---|
| Opening | Days 1–20 | Growth, territory, learning the world. At most small local events. |
| First pressure | Days 20–45 | Early hazards; warnings teach the vocabulary. |
| Mid-season | Days 45–70 | Larger and more frequent events; compound hazards begin. |
| Late season | Days 70–89 | Escalation. The world is visibly preparing for the finale. |
| Finale | Day 90 | The final cataclysm: several overlapping zones or one very large event. |
| Aftermath | After day 90 | Deep-time transformation and the next season on the same planet. |

The schedule should avoid two identical events back to back, should not put the
same biome under the same hazard twice in a short window, and should leave at
least one clear growth window between major events. Natural events get a
forecast; dev events do not need one unless the developer asks for it.

### Time acceleration

Two different accelerations are needed, and they must not be confused:

1. **Recovery window.** After a calamity ends, the simulation clock runs faster
   for a configured period (starting proposal: 2× for 12 in-game hours, 4× for
   the next 12). This lets regrowth, soil recovery and succession be visible in a
   session instead of requiring a real day of waiting.
2. **Inter-season deep time.** After the final cataclysm, the world runs the
   rule-based transformation at a much larger scale and records a god-view
   time-lapse. This is the existing T20 deep-time idea.

The multiplier belongs to the world clock, not to the render tick. A 20 Hz server
still ticks 20 times a second; the clock and the growth/environment steps consume
more simulated time per tick while the window is active. This keeps networking,
input and physics predictable.

## 3. Calamity model

### 3.1 Definition and instance

A **definition** is content: name, family, zone shapes it can use, damage
channels, terrain/water/climate effects, warning lead time, visual and audio
cues, and which traits mitigate it.

An **instance** is one event in the world: definition id, zone, centre/path,
magnitude, start tick, duration, seed, source (`natural` or `dev`), and state
(`forecast`, `active`, `aftermath`). Instances are server-owned and streamed to
clients like weather. The server is authoritative over every effect.

### 3.2 Zone shapes

| Shape | Use | Aiming |
|---|---|---|
| `point` | Meteor, sinkhole, vent, epicentre | Click a ground point. |
| `circle` | Flood, ashfall, blast, drought cell | Click, then drag the radius. |
| `ring` | Tsunami front, shockwave, exclusion band | Click, drag inner and outer radius. |
| `capsule` | Tornado track, lava flow, river flood | Click a start and an end, drag the width. |
| `path` | Hurricane eye, moving storm, locust swarm | Draw waypoints; each has a radius and a speed. |
| `polygon` | Landslide, blight quarantine, regional drought | Click a polygon; close it to preview. |
| `global` | Impact winter, solar storm, sea-level change | No aim; confirm a world-wide event. |

A moving event's zone is sampled along its path, so a plant is exposed when the
front reaches it, not when the event starts. A zone can persist after the active
phase as an **aftermath field** (salinity, ash, heat, toxins, buried biomass).

### 3.3 Exposure and damage

Exposure is per plant and per plant part, not per tile only:

```
exposure = zone_intensity(position, time)
         × magnitude
         × (1 - mitigation(traits, morphology, terrain, shelter))
```

Each calamity maps exposure to one or more **damage channels**: impact, burial,
drowning, heat, cold, desiccation, wind, toxin, radiation, salinity, infection.
Those channels feed the existing T06 damage/health pipeline, so a calamity is not
a second death system. Damage can remove a part, reduce structural mass, uproot
the plant, bury the crown, or kill it. The same event can leave one plant dead,
one uprooted and one almost untouched.

Survival is a check against the plant's remaining structure and reserves, not a
dice roll. There is **no luck variable**: exposure, the zone, the plant's
mutations and morphology, the terrain and shelter decide the result. Two identical
plants in the same place get the same outcome. The dev panel can show the
exposure and the projected outcome; players get a risk description, not a hidden
numeric promise.

Mitigations should be readable from the plant the player already grew:

- **Flood / tsunami:** height above the water line, aerenchyma or air roots, salt
  tolerance, flexible stems, buoyant propagules.
- **Earthquake / collapse:** root spread and depth, flexible wood, low centre of
  mass, stable bedrock, distance from the fault.
- **Meteor / blast:** distance, shelter, hard bark, fire resistance, buried bud
  bank, fast regrowth.
- **Drought / heat:** deep taproot, succulence, waxy cuticle, stomatal control.
- **Fire:** thick bark, serotiny, resprouting, protected seed bank.
- **Cold / snow:** antifreeze, deciduous habit, snow-shedding shape.
- **Wind:** flexible stems, low profile, strong anchor roots.
- **Toxin / blight:** resistance genes, symbiosis, isolation, detoxification.
- **Radiation:** pigments, shielding tissue, repair, mutation pressure.

These are directions for the trait model, not promises that every combination
will be built in the first slice.

### 3.4 Survivors and the finale

The final cataclysm is the largest event of the season: several overlapping
zones, a global aftermath, or one very large placed event. It is **not** an
automatic kill. A survivor:

- persists as a world entity into the next season;
- keeps its position, damage, mutations and any propagules it made;
- becomes part of the next season's starting ecology, not a fresh spawn;
- may be the parent of the next generation if it produces a propagule.

A plant that dies in the finale goes through the death pipeline. Its structural
biomass becomes organic matter (ADR-044). Its lineage continues only through a
propagule that existed when it died or that it released before death.

This means a season can end with living plants. That is deliberate. It also means
the next season's opening state is not guaranteed to be bare soil, so succession
and terrain recovery must read the survivors rather than assume a reset.

## 4. Reproduction and lineage

A plant can only pass on lineage through something it actually made. The first
supported propagules are:

| Propagule | Made by | On death | Notes |
|---|---|---|---|
| Seed | Mature flower | Drops or is carried by the death/queue path | Heirloom and offspring paths use this. |
| Spore | Spore sac | Released into the air/soil | Cross-pollination range in T53. |
| Bulb | Configured bulb organ | Detaches, can survive burial | Clone of the parent, not a recombinant. |
| Tuber | Configured tuber organ | Detaches, can survive burial | Clone; stores energy. |
| Rhizome | Configured rhizome organ | Splits and resprouts | Clone; may survive fire/burial. |
| Seed bank | Soil, from a previous drop | Not made at death | A separate world field; only if it was already there. |

Rules:

- No organ, no propagule. A sterile or juvenile plant that dies ends its lineage.
- A propagule can be destroyed by the same calamity. Fire can consume a seed;
  burial can protect one. That is part of the risk.
- The death grant (`death_grant_seed`) is a mid-season help, not a calamity
  grant. `calamity_grant_seed` stays **false**.
- A player with no propagule starts the next season on Path 1 (new seed, no
  mutations). That is not an account punishment; it is the consequence of a plant
  that did not reproduce.
- Propagules are world objects or inventory items according to their configured
  flags. They obey the same damage pipeline when planted or dropped.

## 5. Calamity catalogue

The first four are required by the owner. The rest are candidates, ordered by how
much they reuse existing systems. "Counter" is the intended survival answer, not
a guarantee that the trait exists at launch.

### Required

| Event | Family | Zone | Primary effect | Counter / survival |
|---|---|---|---|---|
| **Worldwide flood / sea-level surge** | Hydrological | global or coastal band | Water rises over days; drowning, root rot, salinity; shorelines move | Elevation, air roots, salt tolerance, buoyant propagules |
| **Tsunami** | Hydrological | coastal ring / moving front | Short, violent inundation; impact, uprooting, salt deposition | Height, distance inland, flexible stems, salt glands |
| **Earthquake** | Geological | point + radius, aftershock zones | Shaking; root-plate failure, landslides, liquefaction, structural damage | Root spread, flexible wood, bedrock, distance |
| **Meteor impact** | Cosmic | point + shockwave ring | Blast, heat, crater, ejecta, dust; local extinction | Distance, shelter, hard bark, buried buds, fire resistance |

### Additional candidates

| Event | Family | Zone | Primary effect | Counter / survival |
|---|---|---|---|---|
| Flash flood | Hydrological | capsule / path | Fast water, uprooting, debris | Deep anchor, slope, distance from channel |
| Storm surge | Hydrological | coastal band | Wind-driven water and salt | Elevation, salt tolerance, wind shape |
| Drought / heatwave | Hydrological / atmospheric | polygon or global | Slow water loss, heat stress, wilting | Deep roots, succulence, cuticle, stomatal control |
| Wildfire | Hydrological / biological | moving path | Burn, smoke, soil sterilisation, seed-bank loss | Thick bark, resprouting, serotiny, wet ground |
| Acid rain | Atmospheric | regional polygon | Leaf burn, soil pH shift, mineral lock-up | Buffering soil, waxy leaves, mineral reserves |
| Red tide / algal bloom | Hydrological / biological | water polygon | Toxins, oxygen loss, fouled roots | Filtration, symbiosis, distance from bloom |
| Landslide / mudslide | Geological | slope polygon / path | Burial, root shear, debris | Root reinforcement, slope, stable rock |
| Sinkhole / karst collapse | Geological | point / small circle | Ground drops, roots snap, void opens | Deep roots, cavity tolerance, distance |
| Tectonic rift / plate collapse | Geological | long capsule / polygon | Ground drops or splits; permanent terrain change | Distance from fault, flexible roots, elevation |
| Volcanic eruption | Geological | point + ash polygon | Lava, ash, toxic gas, lightning, heat | Distance, wind, ash shedding, heat tolerance |
| Lava flow | Geological | moving path | Burn and burial; permanent rock | Elevation, distance, heat tolerance |
| Ashfall | Geological / atmospheric | regional polygon | Sunlight loss, leaf clogging, soil chemistry | Canopy shape, shedding, stored energy |
| Avalanche | Geological / atmospheric | mountain path | Burial, impact, cold | Flexible stems, snow shedding, slope |
| Hurricane / cyclone | Atmospheric | large moving circle | Wind, rain, surge, prolonged exposure | Flexible wood, deep anchor, low profile |
| Tornado | Atmospheric | narrow moving path | Extreme wind, uprooting, debris | Low profile, flexible stem, shelter |
| Hailstorm | Atmospheric | moving polygon | Physical shredding, fruit/seed loss | Canopy shape, hard tissue, shelter |
| Blizzard / freeze | Atmospheric | regional polygon | Cold, snow load, frost heave | Antifreeze, deciduous habit, snow shedding |
| Dust storm | Atmospheric | moving polygon | Abrasion, sunlight loss, burial of seedlings | Waxy leaves, low profile, deep buds |
| Lightning superstorm | Atmospheric | regional polygon | Strikes, fire ignition, electrical damage | Height, isolation, fire resistance |
| Meteor shower | Cosmic | multiple small points | Many small impacts, local fires | Small footprint, shelter, fire resistance |
| Impact winter | Cosmic | global | Sunlight and temperature drop for days/weeks | Stored energy, evergreen, cold tolerance |
| Solar / radiation storm | Cosmic | global | UV/radiation damage, mutation pressure | Pigments, shielding, repair, mutation tolerance |
| Locust / herbivore swarm | Biological | moving polygon | Defoliation, seed consumption | Toxins, regrowth, buried reserves |
| Blight / pathogen | Biological | spreading polygon | Infection, leaf/stem loss, spread between plants | Resistance genes, isolation, sanitation |
| Root rot / fungal bloom | Biological | soil polygon | Root decay, water transport failure | Drainage, symbiosis, resistant roots |
| Invasive smothering vine | Biological | spreading polygon | Competition for light, physical weight | Pruning, fast growth, shade tolerance |

The catalogue is deliberately broad. The first implementation slice should pick
three or four that exercise different zone shapes and damage channels rather than
shipping all of them at once. Recommended first set: **meteor (point + ring),
flood (global/coastal band), earthquake (point + aftershock), wildfire (moving
path)**. They cover impact, water, structure and fire, and they can reuse the
existing damage and terrain paths.

## 6. Dev panel: aiming and control

The dev panel gets a **Calamities** tab. It is a developer tool, not player UI,
and it stays behind the existing dev access check.

### 6.1 Catalogue and scheduling

- Searchable list grouped by family.
- Each entry shows its zone shapes, damage channels and default magnitude.
- **Trigger now** creates an instance immediately.
- **Schedule** creates a forecast with a chosen lead time.
- **Queue natural** asks the natural scheduler for the next event; **force next**
  skips the wait.
- A world-level switch pauses or resumes the natural schedule without stopping
  active events.
- A seed field makes a schedule reproducible; the same seed and world state
  produce the same deck.

### 6.2 Aiming

1. Choose an event.
2. Choose a shape (the event may allow several).
3. Click the ground to place the centre, or click waypoints for a path/polygon.
4. Drag to set radius/width; use the numeric fields for exact values.
5. The preview overlay shows the zone, the falloff bands and the number of plants
   and tiles affected.
6. Set magnitude, duration, warning lead time and aftermath duration.
7. **Trigger** or **Schedule**. **Cancel** removes the preview without creating an
   instance.

Aiming must work from the normal camera and from a top-down dev camera. The
preview must be legible without colour: use a boundary line, hatch/pattern for
the core, and a label with the radius and affected count.

### 6.3 Active events

- List of active and forecast events with time remaining.
- Pause/stop one event, or clear all dev events.
- Inspect a zone: exposure by plant, projected damage, survivors.
- A "show zones" toggle draws all active/forecast zones in the world.
- A "step one tick" control for reproducing a damage boundary.

### 6.4 Safety

- Dev calamities are refused unless the caller has dev access, exactly like the
  other dev commands.
- A dev-triggered global event asks for confirmation and names the event.
- There is a hard cap on concurrent zones; the server rejects an event beyond it.
- Every dev trigger is logged with the caller, event id, zone and seed.

## 7. Player-facing presentation

- **Forecast:** a plain statement of what is coming, where, and when. No
  editorial language (RULE_13). Example: "Coastal inundation expected in 2 days.
  Low ground below 4 m."
- **Active:** sky, wind, water, ground shake, ash, fire, sound and a zone boundary
  in the world. The boundary is not colour-only.
- **Aftermath:** the changed ground remains readable: wet soil, salt crust, ash,
  scorch, buried biomass, new water, cracked ground.
- **Risk:** the player can read their own exposure from the world and their
  plant's traits. The HUD does not promise survival or predict a hidden roll.
- **Accessibility:** reduced motion for screen shake and particles; non-colour
  cues for zone boundaries; text alternatives for sound cues.

## 8. Server and protocol

The server owns definitions, instances, the natural deck, exposure and damage.
Clients render what the server sends and never decide that a plant died.

Proposed protocol additions (next breaking version; the wire is v4 today):

| Message | Direction | Purpose |
|---|---|---|
| `CALAMITY_STATE` | server → client | Active/forecast instances, zones, time scale, aftermath fields |
| `CALAMITY_WARNING` | server → client | A new forecast with lead time and a plain description |
| `CALAMITY_EVENT` | server → client | Start/end/phase change for one instance |
| `CALAMITY_DEV_SPAWN` | client → server | Dev-only: definition, shape, zone, magnitude, duration, seed |
| `CALAMITY_DEV_CANCEL` | client → server | Dev-only: cancel a preview or active dev event |

`CALAMITY_STATE` is a snapshot; `CALAMITY_EVENT` is the delta. Zones can be large,
so the snapshot must be bounded: send the shape and parameters, not every
affected tile. The client derives the preview from the same zone function the
server uses, with a shared module in `packages/shared`.

## 9. Config

- `config/world.json` owns `season_length_days` (now 90).
- `config/calamities.json` (new) owns definitions, zone defaults, the natural
  deck, warning lead times, exposure/falloff, survival caps and time scales.
- `config/deep_time.json` owns the inter-season transformation and time-lapse.
- `config/damage.json` / `config/tumbling.json` own the channels a calamity feeds.
- `config/reproduction.json` owns propagule organs and their survival rules.
- Counts and default values are owned by [`tunables.md`](./tunables.md); do not
  copy them into prose.

## 10. Implementation slices

**C0 — the frame.** 90-day config; shared zone math; definition/instance types;
server state; dev spawn for one event; no natural schedule. Acceptance: a dev can
place a meteor at a point, see the zone, and a plant inside it takes damage.

**C1 — survival and lineage.** Exposure per plant/part; mitigation hooks;
uproot/burial; survivor persistence; propagule production and death drops; no
automatic seed. Acceptance: the same meteor kills one plant, uproots a second and
leaves a third alive; only a plant with a propagule leaves lineage.

**C2 — natural season.** Seeded deck; forecast and warnings; four events
(meteor, flood, earthquake, wildfire); recovery time scale; dev panel catalogue
and aiming. Acceptance: a shortened season produces a readable sequence of
warnings, events and recoveries.

**C3 — finale and deep time.** Final cataclysm composition; survivor carry-over;
inter-season time-lapse; aftermath fields; more catalogue entries. Acceptance: a
season can end with survivors, and the next season starts on the transformed
planet with those survivors present.

**C4 — demo tuning.** A single-player demo preset: shorter season, smaller
catalogue, no accounts, no network. The packaging is settled: a downloadable build that bundles the
existing server.

## 11. Settled mechanics and the remaining schedule question

The owner answered these on 2026-11-22. They are decisions, not proposals.

1. **Survivor carry-over.** A plant that survives the final cataclysm can carry
   into the next season. It is not forced to; it is allowed to remain.
2. **Time acceleration.** A short recovery window runs after every event, and a
   large inter-season deep-time pass runs after the finale. The server tick rate
   does not change.
3. **No luck.** There is no luck variable. Survival comes from mutations,
   morphology, terrain, shelter and being outside the zone. Identical plants in
   identical positions get identical exposure.
4. **Survivor state.** A survivor keeps its position, damage and mutations, with
   normal recovery. The next season is a continuation, not a reset.
5. **Demo packaging.** The first single-player demo is a downloadable build that
   bundles the existing server. An HTML5 local-simulation build is a later
   option, not the first release.
6. **Gate dates.** The owner asked for longer than 24 / 52 / 80 and longer than
   the proposed 32 / 68 / 104. The planning baseline is now **40 / 84 / 130
   weeks**. Task-level week numbers in DESIGN are the original build order, not
   the new calendar.
