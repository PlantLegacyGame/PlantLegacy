# Attribution

**Status:** stub created by T00. No third-party **asset files** are in the
repository; bundled npm dependencies are listed in the notes below.

Every asset added to the project must be recorded here **before** it is used.
C01's asset loader will fail the build when a file has no entry in this manifest
(DESIGN.md Part 19, D-19).

## Rules

- Free licenses only: CC0, public domain, MIT, Apache-2.0, BSD, OFL.
- **No NonCommercial licenses.** Spores are sold for real money, which makes the
  project commercial.
- Self-host every file. No hotlinking and no CDN dependency.
- Record the exact source URL, author, license, and the files it covers.
- Modified assets state what changed.

## Manifest

| Asset | Files | Author | License | Source | Modified |
|---|---|---|---|---|---|
| _none yet_ | — | — | — | — | — |

## Audio

| Asset | Files | Author | License | Source | Modified |
|---|---|---|---|---|---|
| _none yet_ | — | — | — | — | — |

## Fonts

| Asset | Files | Author | License | Source | Modified |
|---|---|---|---|---|---|
| _none yet_ | — | — | — | — | — |

## Notes

The client bundles third-party **code** dependencies through pnpm (Three.js,
Vite, `@vitejs/plugin-legacy`, `ws`, `pg`, `argon2`, `jsonwebtoken`); their licenses travel with the
packages in `node_modules`, and none are committed as asset files. The UI still
uses system fonts and hand-written CSS. No image, model, texture, sound or font
file is committed, so the asset manifest stays empty.

### Server runtime dependencies added in T08C

| Package | Version | License | Purpose |
|---|---|---|---|
| `argon2` | 0.41.1 | Apache-2.0 / BSD-3-Clause | Argon2id password hashing |
| `jsonwebtoken` | 9.0.2 | MIT | JWT access/refresh tokens |
