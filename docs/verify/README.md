# Verification captures

Captures are **local-only**. No screenshot is committed, and a screenshot is
never evidence a document can link to. The clone carries the tests, the code and
the written checks; it does not carry the images a developer looked at while
making a change.

## What to cite

- Cite a test when a test proves the behaviour.
- Otherwise say plainly that the fix was checked in the running client, and
  describe what was seen and measured.
- Never write a capture filename into a doc row: it resolves only on the machine
  that produced it, and it is not part of the repository.

## Where local captures go

- Put a browser pass's files in `docs/verify/pass-YYYY-MM-DD/` or anywhere
  ignored.
- Root-level PNGs, `screens/`, `screenshots/`, `docs/screenshots/` and every
  `docs/verify/*.png` are ignored by [`.gitignore`](../../.gitignore).
- The growth-capture method is recorded in [`head-capture.md`](head-capture.md);
  the measurements it produced stay in the bug and history records, the images
  do not.
