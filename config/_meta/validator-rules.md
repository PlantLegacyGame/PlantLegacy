# Config validator rules (extended-1)

Owner: T00. Enforced by `packages/shared/src/config/validate.ts` and run in CI via
`pnpm config:validate` and at server startup.

Every tunable lives in `config/<system>.json`. The `value` of an entry **is** the
default; `range` bounds it. Nothing may be hardcoded in code (RULE_3).

## File-level rules

| Code | Rule |
|---|---|
| `config.not_object` | The file must be a JSON object. |
| `config.invalid_json` | The file must parse. |
| `config.values_missing` | The file must have a `values` object (empty is valid for a stub). |
| `meta.missing` | The file must have a `_meta` object. |
| `meta.system_invalid` | `_meta.system` must be `snake_case`. |
| `meta.system_mismatch` | `_meta.system` must equal the file name without `.json`. |
| `meta.version_invalid` | `_meta.version` must look like `1.0` or `1.0.0`. |
| `meta.schema_invalid` | `_meta.schema` must be exactly `extended-1`. |
| `meta.owner_task_invalid` | `_meta.owner_task` must be a task id (`T01`, `C04`, `O01`, `H01`). |
| `meta.status_invalid` | `_meta.status` must be `stub`, `draft`, `active` or `deprecated`. |

## Entry rules

| Type | Required | Checks |
|---|---|---|
| `number` | `value`, `range` | finite value inside `[min, max]`, `min < max` |
| `integer` | `value`, `range` | as above, plus `Number.isInteger(value)` |
| `boolean` | `value` | boolean |
| `string` | `value` | string; optional `max_length` not exceeded |
| `enum` | `enum`, `value` | non-empty string array; default is a member |
| `array` | `value` | array; optional `item_type` hint |
| `schema_array` | `schema`, `value` | every declared field present with the declared type; `enum` fields must be a member of the schema's `enum` list |
| `matrix` | `rows`, `cols`, `value` | `value.length === rows.length`, every row length `=== cols.length`, all cells finite numbers |
| `color` | `value` | `#rrggbb` or `#rrggbbaa` |
| `object` | `value` | object |

Codes: `entry.not_object`, `entry.type_invalid`, `entry.value_invalid`,
`entry.range_invalid`, `entry.range_empty`, `entry.value_out_of_range`,
`entry.enum_missing`, `entry.enum_invalid`, `entry.enum_value_invalid`,
`entry.max_length_invalid`, `entry.value_too_long`, `entry.schema_missing`,
`entry.schema_empty`, `entry.schema_field_type`, `entry.item_invalid`,
`entry.item_missing_field`, `entry.item_field_type`, `entry.item_enum_member`,
`entry.matrix_axes`, `entry.matrix_rows`, `entry.matrix_cols`, `entry.matrix_cell`,
`entry.color_invalid`, `entry.notes_invalid`.

## Cross-cutting rules (any depth)

| Code | Rule |
|---|---|
| `rarity.forbidden` | No object key may be `rarity` or `rarities`. A schema field named `rarity` is a bug (RULE_20). |
| `rarity.enum_member` | No `enum` array may contain the member `rarity`. |
| `item_flags.account_bound_conflict` | If `account_bound` is `true`, then `tradeable`, `mailable` and `listable` must all be `false` (RULE_23). |

## Notes

- Extra fields inside `schema_array` items are allowed and ignored; required fields
  are the ones declared in `schema`.
- A `stub` config has `values: {}` on purpose. Its owning task fills it; the file
  exists from T00 so no task has to invent a path.
- The validator is the authority, not `schema.json`. The JSON Schema is a
  convenience for editors and cannot express the rarity ban across arbitrary depth.
