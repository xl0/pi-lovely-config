# Plan

Keep the library small: a flat keyed schema, fixed user/workspace storage,
and an optional TUI editor. Nothing else belongs here.

Config files are edited by humans and shared across versions, so the runtime
must be forgiving: unknown keys survive updates, invalid known values warn
instead of failing, malformed files read as empty and are repaired by writes,
and only what the schema knows is ever written back. Dynamic catalogs can
opt into advisory enum choices: retain unavailable strings with warnings
without weakening type checks or numeric constraints.

## Todo

- [x] Advisory enum choices, widened types, retained/ignored warnings, and
      editable unavailable selections; covered by type/runtime/TUI regressions.
- [x] Core library: keyed schema, field builders, scoped resolution,
      key-level `update()`, unknown-key preservation, invalid-value warnings.
- [x] TUI editor: scope tabs, cycling, reset, `visibleWhen`, scope notes,
      searchable enums and multi-enum checklists, multiline text fields.
- [x] Demo extension and README covering the keyed schema API.
- [x] CI-driven staged npm releases, changelog, and local release script
      matching codex/web; publication remains gated on manual 2FA approval.
