# Verification images

Evidence captures for the rows in [`../bug-inventory.md`](../bug-inventory.md)
and [`../what-works-now.md`](../what-works-now.md). Two kinds of capture exist,
and only one of them is committed.

## Curated evidence — tracked

A PNG sitting **directly** in this folder is curated: it is cited by a doc row,
and it is committed, so the citation can never rot.

- Name it after the row it proves: `a14-buried-beside-pit.png`,
  `r23-sky-open-over-pit.png`.
- One image per claim. For a before/after pair, say which is which in the row,
  not in the filename (`a15-above-before.png` / `a15-above-after.png` is fine).
- If a row's evidence is a test, cite the test. Do not commit a capture that
  proves nothing the row does not already say.

## Ad-hoc dumps — ignored

Screenshots taken while checking a change are scratch, not evidence, and git
never stores them:

- every browser pass's own folder — `docs/verify/pass-YYYY-MM-DD/`
- root-level `*.png` (`shot-*.png`, `river-*.png`, …)
- `screens/` and `screenshots/`

They are listed in [`.gitignore`](../../.gitignore), which ignores subfolders of
this one but not its files. A dump may be looked at and thrown away; it must not
be cited, because a citation to it points at nothing for anyone else.

The 2026-11-16 and 2026-11-17 pass dumps and the root shots were deleted on
2026-11-18, which is what left dangling citations in the bug inventory; the rows
now cite the tests, or say plainly that the fix was verified live in the
browser.
