# sim-bots

A player that is not a browser. It connects to the real server over the real
WebSocket, grows a plant with the same intents the client sends, and writes down
anything the world does to it that growing a plant should not do.

Zero dependencies: Node 22+ ships a global `WebSocket`.

## Run

The server must be running. `pnpm dev` starts one on `:8080`; a second one is
fine on another port:

```sh
PORT=8090 node apps/server/src/main.ts

node tools/sim-bots/src/run.ts --url ws://127.0.0.1:8090/ws --bots 2 --minutes 5
```

| Flag | Default | Meaning |
|---|---|---|
| `--url` | `ws://127.0.0.1:8080/ws` | Server socket |
| `--bots` | `1` | Parallel guest players |
| `--minutes` | `5` | Session length |
| `--verbose` | off | Print every connection, screen and growth |
| `--json` | `tools/sim-bots/last-run.json` | Report path |
| `--fail-on-error` | off | Exit 1 when any error finding is reported (for CI) |

Two servers are better than one while fixing something: your own `pnpm dev` keeps
its world, and the bot plays a fresh one on another port.

## What it does

1. `HELLO` as a guest, waits for `WELCOME`.
2. Mirrors the plant from `PLANT_SYNC` (the same payload the client uses).
3. Asks for `GROWTH_OPTIONS_RESULT` on a few likely parents, then grows in the
   order a real plant needs: radicle, cotyledons, stem, leaves, then an
   alternation of canopy and roots. Directions come from `policy.ts`.
4. Backs off when the server refuses, and throws away a menu that quoted
   something the server then rejected.

It never uses a dev command, never teleports and never edits state directly, so
a bug it finds is a bug a player can reach.

## Findings it reports

| Code | Severity | Meaning |
|---|---|---|
| `damage-while-growing` | error | Tissue lost within 15 s of an accepted growth under clear skies: growing hurt the plant |
| `damage-without-source` | error | A damage source that does not exist in the world |
| `uproot-while-growing` | error | Torn free right after growing, with no storm |
| `death-while-growing` | error | Died of starvation/damage while it was only growing |
| `mutation-upkeep-death` | error | Died of mutation upkeep |
| `negative-energy` / `negative-mass` | error | Storage or mass went below zero |
| `zero-biomass` | error | Nodes exist but the plant carries no mass |
| `reject-loop` | warn | The same intent refused six times: the menu and the charge disagree |
| `stall` | warn | Nothing grew for a minute while options were offered |
| `no-growth` | warn | Not one growth in the whole session |
| `mutation-invisible` | info | A mutation carries a visual signature but paints no organ |
| `mutation-look-collision` | info | Two mutations share one visual signature |

The first six are the rules that answer "can growing a plant hurt it?". They were
written before the first run and the first run failed them.

## First result (2026-11-15)

Before the fix, every bot lost its new radicle two seconds after growing it:

```
[error] damage-while-growing  took 0.54 terrain damage 2s after growing radicle under "clear" skies
```

A root tunnel is a `TerrainEdit`; dry soil collapses it at `collapse_cadence_hz`;
`DamagePipeline.processTerrainCollapse` billed that collapse to every plant whose
root was inside the radius — including the plant that dug it. The radicle has
0.54 biomass and `terrain_collapse_damage` was 1 at the time (15 today), so the first root was destroyed,
the menu offered a new radicle, and the player looped.

Fixed by carrying the digging plant on the void and on the collapse edit, and
skipping that plant in `applyCollapse`. Tests:
`does not damage the plant whose own root tunnel collapsed` and
`still damages everyone else under a collapsing tunnel`.

## Next

The same harness grows the in-browser half: a Chrome driver over the DevTools
protocol that presses `R`, screenshots the Root Sight aperture and clicks the
panel buttons. Rendering and click bugs cannot be asserted from a socket.

## T26 contract (from the placeholder this replaced)

The directory was a placeholder owned by **T26** (persistence and bot soak). The
contract it promised still applies:

- `pnpm --filter @plant-legacy/sim-bots start -- --bots 50 --minutes 30` runs a
  population soak. The CLI already accepts it; 50 bots on one process is the
  soak target, not something this laptop has been asked to prove yet.
- Bots speak the real wire protocol from `packages/shared` and get no server
  shortcuts. They never write to Postgres.
- Exiting non-zero on a problem is opt-in today (`--fail-on-error`) because the
  current M1 mode is investigating a known-broken tree; a CI soak should pass
  the flag.
- Reading the action mix and bot count from `config/persistence.json` is not
  implemented: `persistence.json` is still a stub with no values, so the mix is
  code (`policy.ts`) until T26 fills that file. Adding a config read now would
  invent tunables that T26 owns.
