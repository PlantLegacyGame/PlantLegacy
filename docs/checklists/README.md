# Manual checklists

Run these by hand after the automated `pnpm verify` chain. They exist because
some acceptance criteria are behavioural, not unit-testable: a real browser, a
real container, a real push.

| Checklist | Covers |
|---|---|
| [T00-manual.md](./T00-manual.md) | Config loading, Part 6.2 file coverage (count owned by [`../tunables.md`](../tunables.md)), rarity ban, compliance draft, stubs |
| [O01-manual.md](./O01-manual.md) | Install/verify, health and readiness, one-command dev, Docker, CI, staging, secrets |
| [T02-manual.md](./T02-manual.md) | Root Sight routes, two-mode camera, cutaway, root highlight |
| [T25-manual.md](./T25-manual.md) | Terrain field, colliders, soil edits, tunnel persistence |

Conventions:

- `[x]` means the command was run and the stated result observed.
- `[ ]` means **not observed yet**, and the file says why. Two reasons exist and
  they are not interchangeable:
  - it needs infrastructure this workspace does not have (Docker, a GitHub
    remote, a VM, a phone) — not a code gap;
  - it needs a browser or a person and nobody has walked it yet — a real gap in
    verification, which an automated test may or may not already cover.
- Record the observed output next to the box when it differs from the expected
  output. A box ticked from a test rather than a hand run says so in its text.

Ticking a box nobody ran is the one thing that makes a checklist worthless: the
next session cannot tell a checked box from a copied one. Leave it open and say
what it needs instead.

**Status:** `T00` is fully run and `O01` except its persistent VM, which waits on
a host this workspace does not have. `T02` was walked except its two newest rows
(A7/A11 and A13). `T25` has never been walked end to end — that is local browser
work, not infrastructure, and it is a verification gap rather than a code gap:
the field, collider and persistence halves are pinned by tests, the walk is not.
