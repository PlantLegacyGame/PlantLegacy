# UI inventory

What the interface is made of today, so a redesign starts from the real parts
instead of a sketch. Two surfaces matter: the entry flow (before you are a plant)
and the in-game HUD (after). Nothing here is a proposal; it is what runs.

## Surfaces

| Surface | Built by | Mount | What it does |
|---|---|---|---|
| Title screen | [`MainMenu.ts`](../apps/client/src/ui/MainMenu.ts) | `UIShell` `modal` layer | The scene, the mascot plant, nickname box, Play / Settings / Shop, and the avatar that opens sign-in. Steps still come from [`EntryFlowStateMachine.ts`](../apps/client/src/ui/EntryFlowStateMachine.ts) — `booting`, `title`, `sign_in`, `sign_up`, `connecting`, `world`, `plant_lost`. **The hero is one width, `--pl-hero: clamp(380px, 30vw, 560px)`**, shared by the menu stack and the name box so they line up, and answered by the window: it was a flat 380px, a phone's width, and stayed 380px on a 2560px monitor. Controls scale at `min-width: 1200px`. A phone is a width here, never a device: no user-agent check exists in the client. The title screen is the one surface that is **not** scaled by the overlay zoom (`--pl-ui-scale`): it lays itself out for the pane in `menuFit.ts`, and `.pl-menu` carries the inverse zoom so the fit is not counted twice |
| Title horizon | `.pl-scene__bloom`, `.pl-scene__haze` in [`title/TitleScene.ts`](../apps/client/src/ui/title/TitleScene.ts) | above the hills | A warm lobe of light sitting on the horizon under the sun, and a band of pale air lying on the hills where sky meets ground. Their opacity comes from `titleLighting`, so the horizon burns at golden hour and goes quiet at night |
| Title night sky | `starField()`, `.pl-scene__milkyway` | inside the sky box | 90 stars, eight of them first-magnitude with a diffraction cross, twinkling at different rates, over a faint rotated band of unresolved stars that fades in with the palette's night factor |
| Title depth | `.pl-menu__cloudshadow`, `.pl-menu__near`, `.pl-menu__vignette` | over the world | Cloud shadows crossing the soil, out-of-focus blades at the bottom edge, and a vignette: a camera inside the scene rather than in front of a backdrop |
| Title soil | `.pl-menu__stage` in [`MainMenu.ts`](../apps/client/src/ui/MainMenu.ts) | `.pl-menu__world` | The cut slice the plant stands in: a lit lip (`--pl-soil-lip`, derived from the palette so it warms at golden hour), a four-stop depth ramp down to `--pl-soil-deep`, and pebbles. **Nothing is cast onto it**: a cut slice seen from the side has no ground plane, so the stem carried no contact shadow and the soil carried no darkening where the plant meets it - both were removed rather than softened, because an ellipse of shade in a flat drawing is a 3D cue that reads as a smudge. Depth comes from the soil's own layers and from the roots fading as they go down. `--pl-root-band` reserves the band the roots hang in, and the menu stack starts below it so the controls never sit on the roots |
| Title light grade | [`title/dayCycle.ts`](../apps/client/src/ui/title/dayCycle.ts), `.pl-menu__wash` in [`MainMenu.ts`](../apps/client/src/ui/MainMenu.ts) | over the world, above the plant | Three passes derived from the palette by `titleLighting`: a warm screen-blended glow around the sun, a cold screen-blended halo around the moon, and a light multiply pass for the night. The leaves take the same cast - warmer at golden hour, cooler under moonlight - so the plant is lit by the scene rather than drawn on top of it |
| Title scene | [`title/TitleScene.ts`](../apps/client/src/ui/title/TitleScene.ts) | `.pl-menu__world` | Curved cutout ridges anchored to `--pl-horizon`, each with a lit crest stroke, and three cloud families (bank, cumulus, wisp) in two heights - cumulus near the horizon and a thin cirrus sheet above - drawn by [`title/cloudArt.ts`](../apps/client/src/ui/title/cloudArt.ts): every cloud is shaded by one crown-to-base ramp, its flat underside is a clip that cuts through the puffs rather than a bar drawn under them, and its bounds come from its own puffs so nothing is cropped. Plus a star field, a sun and moon on an arc, drag and pointer parallax, and the faded `H` hint. It opens on the world's real hour: boot reads `GET /world/time` before the first frame and keeps the world hidden until it knows, so no night or dawn reload starts with a flash of daylight |
| Title sky | [`title/dayCycle.ts`](../apps/client/src/ui/title/dayCycle.ts) | inside the scene | The world clock, read from `GET /world/time` and advanced locally between polls (`ui.title_day_night_seconds` is the fallback when no server answers). Interpolated night/dawn/day/dusk palettes; the plant dims with the sky |
| Title plant | [`title/TitlePlant.ts`](../apps/client/src/ui/title/TitlePlant.ts) | `.pl-menu__world`, feet on the horizon | Two halves. Above the line: one stem and seven generated leaves in three depths - two dark back leaves, five front leaves that shorten as they climb, a tender top leaf and a bud with two sepals - each an almond with a midrib and side veins, filled by its own base-to-tip gradient and traced by a rim light on the edge that faces the sky. Below the line: `rootsMarkup()`, drawn on its own 200x58 grid whose `y=0` is the soil line, so the shoot's box never moves - the stem carries on into the soil in bark, forks into a taproot and two uneven laterals, and those fork into tips; every strand is laid down twice, a wide dark contact shadow first, then the root over it, and the whole set fades with depth behind a mask. No drop shadow: it is tinted and dimmed by the sky like the hills, and the surface contact shadow is drawn on the ground where it belongs. `H` does not fade it and it stays clickable; the leaves sway, the roots do not, and a click reacts once per cooldown |
| Title plant sound | [`title/plantSound.ts`](../apps/client/src/ui/title/plantSound.ts) | Web Audio, no DOM | Stick-slip creak synthesis for the mascot's bend: a force-smoothed slip generator (static threshold, ~1-240 Hz slip rate, `sqrt(force)` amplitude and decay) exciting a wooden body of four modes, two panel delays and a 3 kHz squeak edge, plus a falling groan and a modal knock on release. Created on the first gesture and closed with the plant. One self-timing pump (35 ms, 120 ms lookahead) schedules the slips; a module-level preference with a registry of live instances is switched from Settings and mutes every plant |
| Shop | [`ShopPanel.ts`](../apps/client/src/ui/ShopPanel.ts) | `modal` layer | Sections and item cards from `config/shop.json` — six items in two sections today, priced in spores. The balance in the head row is the server's purse (`ShopPanel.setBalance`); every Buy button sends `SHOP_PURCHASE { itemId }` and the server checks the price and grants the item into the pouch. The same panel opens from the title's Shop button and from the spore chip's `+` during play |
| UI shell | [`UIShell.ts`](../apps/client/src/ui/UIShell.ts) (195 lines) | `document.body` | Named layers by z-index, theme tokens as CSS variables on `:root`, text scale, toasts, panel open/close events |
| Plant status | [`PlantStatusHud.ts`](../apps/client/src/ui/PlantStatusHud.ts) | top centre | The body only: phase word (and the health word when it is not "healthy"), health bar, mutation bill, node count, reroot D-pad, damage vignette. It refuses resources, the clock and the weather — those are the vitals card's (ADR-067) |
| Plant hover tip | [`PlantHoverTip.ts`](../apps/client/src/ui/PlantHoverTip.ts), names and facts from [`PlantNodeInfo.ts`](../apps/client/src/ui/PlantNodeInfo.ts) | tooltip layer | A pointer resting on a part names it the way the game talks — `Leaf #2`, not `leaf_37` — and gives its parent, children, total part count and how many growth options the server reports. The promise "click to see what it can grow" is only made when the count is above zero. Node picking is in [`nodePick.ts`](../apps/client/src/ui/nodePick.ts): the nearest hit wins, and a near-tie goes to the deeper node so a child inside its parent's pick sphere stays clickable |
| Plant cursors | [`cursors.ts`](../apps/client/src/ui/cursors.ts) | `<html data-pl-cursor>` | Leaf-shaped arrow, pointer and grab cursors in the game palette, with the **Leaf cursor** switch in Settings. Each leaf is a PNG rasterised from the same paths first and the SVG second: Chromium silently drops a cursor image it refuses and falls back to the default Windows arrow, so the raster guarantees the theme is what is drawn. `applyCursorTheme` and `createControls` clear the inline `cursor: auto` OrbitControls writes on the canvas, which otherwise beat the themed CSS and left the leaf only over DOM. Grow mode keeps its crosshair. The preference is remembered under `localStorage['pl-cursor-theme']`; the default remains the system pointer |
| World drops | [`WorldDrops.ts`](../apps/client/src/renderers/WorldDrops.ts) | world scene | One small model per live `DROP_SPAWN` (dung, remains, fragment), with hover, slow spin, a shadow on the surface and a fade before expiry. A drop is placed at `groundY(x, z) + drop.y`, so a tunnel drop stays underground and a pond drop stays on the floor. A click inside `drop_pick_distance_m` sends `DROP_COLLECT`; the server owns the reward and removes the marker with `DROP_EXPIRED` |
| Player panels | [`PlayerPanels.ts`](../apps/client/src/ui/PlayerPanels.ts) | `panel` layer | Node inspect, inventory, mutation cards, level-up offers. Two columns on a desktop; under 560px **on a finger layout** they become one full-width sheet with an Inspect / Inventory switch, because two ~170px columns were unreadable on a phone. A narrow browser pane keeps the two columns, scaled with the rest of the overlay — and under 480px the sheet applies whatever the pointer, because two panels cannot fit there however they are sized. The two are siblings, not one dialog: each close button closes its own panel, `I` toggles the pouch from then on, and the world HUD is restored only when both are down. Inspect can be pointed at another player's plant (click a rival part): the same panel then shows parts by type, total biomass and owner — the low-detail face, with mutations, nodes and level-up hidden rather than emptied |
| Mutations | [`MutationPanel.ts`](../apps/client/src/ui/MutationPanel.ts) (303 lines) | `hud` layer | Mutation list and detail |
| Settings | [`SettingsPanel.ts`](../apps/client/src/ui/SettingsPanel.ts) | `panel` layer | Text scale, reduced motion, the decorative sound switch and the **Leaf cursor** switch, in a two-card grid on a wide panel; a chip strip above them repeats the current state (text, motion, input, sound, how many actions answer to a key). A facts block gives the pane's CSS size, pixel ratio, overlay scale and loaded bindings — the numbers that explain a zoomed or short pane. Controls lists the loaded bindings on a pointer, and the touch gestures from [`touchCopy.ts`](../apps/client/src/ui/touchCopy.ts) on a finger layout |
| Growth choice | [`GrowthSelectionStateMachine.ts`](../apps/client/src/ui/GrowthSelectionStateMachine.ts) (317 lines) + `createGrowthSelectionUI` in `main.ts` | bottom centre | Three option cards; the machine owns selection, not the DOM |
| Chat | `createChatUI` in `main.ts` | top left (full width above the action bar under 560px) | Messages, input, context menu |
| Vitals | `createResourceReadout` in `main.ts`, rules in [`resourceVitals.ts`](../apps/client/src/ui/resourceVitals.ts) | top right (below the status card under 640px **on a finger layout**; a narrow desktop pane keeps the corner card and scales instead) | The one home for biomass, energy, light, water and minerals, plus the world clock ("Season 1 · Day 3 · 11:44") and the weather chip with its countdown. Bars where a capacity exists, numbers where it does not, a rate only when it is not zero, amber under 25% and pulsing red under 10% |
| Action bar | [`ActionBar.ts`](../apps/client/src/ui/ActionBar.ts) | bottom centre | Grow, Root sight, Inventory, Chat, Emotes, Hints, Menu, each with its key as a badge. On a coarse pointer the badges are dropped, targets are 48 px and the row wraps rather than overflowing |
| Contextual hints | [`ContextHint.ts`](../apps/client/src/ui/ContextHint.ts) | above the action bar | One relevant line, once per session, with the key that acts on it. On a finger layout the badge is dropped and `touchText` replaces `text`, so the line says "tap" where it would have said "click". Replaced the permanent three-line key card |
| Pause menu | [`PauseMenu.ts`](../apps/client/src/ui/PauseMenu.ts) | `modal` layer | Escape: Resume, Settings, Controls, Leave to title. Focus is trapped while it is open |
| Account chip | `main.ts` | top right | Identity and sign-in entry. Settings is reached from the pause menu (Esc, or the bar's Menu button); the old standalone corner button is gone |
| Emote wheel | `createEmoteWheel` in `main.ts` | centre | Held-open radial picker |
| Debug overlay, dev panel, tick card | [`DebugOverlay.ts`](../apps/client/src/ui/DebugOverlay.ts), [`DevPanel.ts`](../apps/client/src/ui/DevPanel.ts), `#detail` in `main.ts` | `debug` / `hud` | `ShiftLeft`/`ShiftRight` overlay; `?dev=1` panel, server-gated; the tick card is F3 and off by default |
| Unreachable overlay | [`ServerUnreachableOverlay.ts`](../apps/client/src/ui/ServerUnreachableOverlay.ts) | full cover | Retry loop while the server is down |

Layers and tokens come from `config/ui.json` (35 keys): `layers` (`world` 0 →
`debug` 700), `theme` (9 colours), `text_scale`, toast and hint limits, health
thresholds.

## Three styling systems, not one

This is the first thing a redesign has to settle, because it decides how much of
the rest is a rewrite.

| System | Used by | Consequence |
|---|---|---|
| Global stylesheet — [`styles.css`](../apps/client/src/styles.css) (1504 lines), `--loam/bark/bone/leaf/ember` tokens, `--hud-*` responsive metrics | HUD primitives, growth cards, dev panel, toasts | One place to change a look; but it is a single file with no ownership boundaries |
| Per-component injected `<style>` (`pl-menu__*`, `pl-scene__*`, panel blocks) | `MainMenu`, `TitleScene`, `TitlePlant`, `ShopPanel`, `SettingsPanel`, `PlayerPanels` | Component-local and portable; invisible to `styles.css`, so the same token is redefined |
| Inline `cssText` / `Object.assign(style)` | `PlantStatusHud`, `MutationPanel`, `DevPanel`, every HUD builder in `main.ts` | Fast to write, impossible to theme, and the reason responsive rules live in media queries that keep re-targeting the same fixed positions |

The third is the biggest one: roughly 60 inline style blocks in `main.ts` alone.
Positioning is done per element with `position: fixed` and hand-picked `top` /
`right` / `bottom`, which is why `styles.css` carries phone and landscape
overrides for individual ids.

## Known gaps

- The title screen is built; its story is not. The mascot has no holiday variants
  yet.
- The shop has a currency, a stock and a purchase path, but the purse and the
  pouch behind them are in memory: Postgres inventory and a row-locked spore
  balance are the open half of T08A. Prices and earn rates are config
  (`config/shop.json`, `config/spores.json`).
- The vitals card has no per-row history: a store that is dropping says so with its bar and its rate, not with a trend line.
- HUD elements are added ad hoc from `main.ts` rather than composed from one
  layout description, so nothing knows the full set of occupied screen regions.
- Text is inline strings inside builders; there is no message catalogue.

## Title screen behaviour

| Input | Result |
|---|---|
| Drag | Slides the layers, clamped by `title_parallax_drag_px`, springs back on release |
| Pointer move | Follows a share of the offset (`title_parallax_hover`) when not dragging |
| Click the plant | One reaction per `title_plant_react_cooldown_ms` |
| `H` | Hides the title, the name box and the buttons. The scene and the plant stay, and the plant stays clickable; the hint fades after `title_hint_fade_ms` |
| `Escape` | Closes a popover or leaves a form, never the game |
| `Enter` in the name box | Same as Play |

Every number above is a key in `config/ui.json`; the word lists behind the
generated names (`Mossy Fern 412`) are there too, so a holiday variant can swap
them without a code change. The sky is the exception: it follows the world clock
from `GET /world/time`, so the menu shows the same hour the game is in.

## Hotbar and purse (2026-11-20)

Two always-on surfaces were added beside the action bar, because the pouch and the
purse had no home during play:

| Surface | Built by | What it does |
|---|---|---|
| Hotbar | [`Hotbar.ts`](../apps/client/src/ui/Hotbar.ts) | Ten slots, key labels `1`–`9` and `0`, stack count, selection. Fed by `INVENTORY_SYNC` and `INVENTORY_SLOT_UPDATE` only: it draws the server's pouch and never holds an item count of its own. Number keys select and use outside the inventory, and select only while the inventory is open, where typing a count is the point. On a phone it sits above the thumb zone and every slot is a 44 px target |
| Spore chip | [`SporeChip.ts`](../apps/client/src/ui/SporeChip.ts) | The balance from `INVENTORY_SYNC.sporeBalance` and a `+` that opens the shop. A polite live region, so a purchase is announced once, and it writes the DOM only when the number changes |

The shop shows the same number in its head row (`ShopPanel.setBalance`), so a
purchase updates the chip, the panel and the pouch from one message. Prices and
earn rates are config (`config/shop.json`, `config/spores.json`); the client
sends `SHOP_PURCHASE { itemId }` and nothing else.

## Where to look when changing this

1. `config/ui.json` — layers, theme, scale. Everything visual should read from
   here or from `styles.css` tokens, not from a literal in a builder.
2. `UIShell` — the only sanctioned way to own screen regions.
3. `main.ts` builders listed above — the code that will move.
