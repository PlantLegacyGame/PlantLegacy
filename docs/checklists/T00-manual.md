# T00 manual checklist

Run from the repository root. A box is checked only when the command was run and
the stated result observed.

## 1. Config loads

- [x] `pnpm config:validate`
  - Expected: `config: 73 file(s)` and `config: OK`, exit 0.
  - Observed: 73 files, OK.

## 2. Every Part 6.2 file exists

- [x] Compare the file list in `docs/tunables.md` with DESIGN.md Part 6.2.
  - Expected: 73 names, no extras, no missing.
  - Observed: 73/73.

## 3. Rarity ban fails the build and startup

- [x] Copy `config/` to a temp directory, add
      `"rarity": { "type": "string", "value": "legendary" }` to `values` in
      `growth.json`, then run:

  ```sh
  node tools/config-validator/src/cli.ts --dir <temp>/bad-config
  ```

  - Expected: exit 1, `growth.json:values.rarity [rarity.forbidden]`.
  - Observed: exit 1 with that issue.

- [x] With the same temp dir:

  ```sh
  CONFIG_DIR=<temp>/bad-config node apps/server/src/main.ts
  ```

  - Expected: exit 1 before listening, same `rarity.forbidden` message.
  - Observed: exit 1, never listened.

- [x] Restore/delete the temp directory. Real `config/` still validates OK.

## 4. Account-bound invariant

- [x] `pnpm --filter @plant-legacy/shared test`
  - Expected: the `enforces account_bound forcing the other three flags false`
    test passes.
  - Observed: pass.

## 5. Compliance draft

- [x] `config/compliance.json` has exactly five `policy_lines`.
- [x] The fifth line says nothing else is removed for content reasons.
- [x] `docs/compliance-policy.md` mirrors the same five lines.

## 6. Stubs

- [x] `docs/art-bible.md` exists and is marked as a stub.
- [x] `ATTRIBUTION.md` exists, has a manifest table, and records no assets.
- [x] `CONTEXT.md` lists the locked decisions:
      camera is an independent entity; item/gene mutations are server
      transactions.

## 7. No values in code

- [x] Search the server and shared source for gameplay numbers.
  - Expected: only HTTP/DB plumbing constants (status codes, timeouts already in
    config, frame header bytes).
  - Observed: ops values come from `config/ops.json`; no gameplay logic exists.
