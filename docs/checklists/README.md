# Manual checklists

Run these by hand after the automated `pnpm verify` chain. They exist because
some acceptance criteria are behavioural, not unit-testable: a real browser, a
real container, a real push.

| Checklist | Covers |
|---|---|
| [T00-manual.md](./T00-manual.md) | Config loading, Part 6.2 file coverage (79 files today), rarity ban, compliance draft, stubs |
| [O01-manual.md](./O01-manual.md) | Install/verify, health and readiness, one-command dev, Docker, CI, staging, secrets |
| [T02-manual.md](./T02-manual.md) | Root Sight routes, two-mode camera, cutaway, root highlight |
| [T25-manual.md](./T25-manual.md) | Terrain field, colliders, soil edits, tunnel persistence |

Conventions:

- `[x]` means the command was run and the stated result observed.
- `[ ]` means it needs infrastructure that is not present locally (Docker, a
  GitHub remote, a VM). It is not a code gap.
- Record the observed output next to the box when it differs from the expected
  output.
