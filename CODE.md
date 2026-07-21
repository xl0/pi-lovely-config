# Codebase

`@xl0/pi-lovely-config` provides scoped config helpers for Pi extensions.

## Layout

- `src/config.ts` - schema, paths, file IO, merge logic.
- `src/ui.ts` - `ScopedConfigEditor` and TUI-only helpers.
- `src/index.ts` - public API re-exports.
- `extensions/scoped-config-demo.ts` - manual demo extension, `/scoped-config-demo`.

## Public API

- `defineScopedConfig()` declares a flat keyed schema, returns a stateful config object.
- `field.enum/boolean/string/text/number()` create fields.
- `config.load(cwd)` fills `config.value`, `config.scoped`, `config.warnings`.
- `config.update(scope, key, value)` writes one known key, reloads.
- `config.resetScope(scope)` deletes that scope's file, reloads.
- `config.resolve(scoped)` merges defaults + active scopes without file IO.
- `config.path(scope)`, `fields`, `defaults` are for UI/debug after load.

Non-obvious:

- The API is factory-based for type inference; runtime lives on an
  internal `ScopedConfigImpl` class.
- Root type exports stay deliberately small: `ConfigFromSchema`,
  `ConfigScope`, `ScopedConfig`.

## Schema model

Keys come from schema object keys; `label` defaults to the key.
Field metadata: `description`, `valueDescriptions`, `depth`, `visibleWhen`.

- String fields are single-line; text fields are also strings but edit
  multiline in the TUI.
- Enum fields opt into fuzzy search with `search: true`.
- Number fields use either range mode (`min`/`max`/`step`) or explicit
  `values`, never both.

## Scopes

- user: `~/.pi/agent/<fileName>`
- workspace: `<cwd>/.pi/<fileName>`

Both are active unless a spec restricts `scope`; workspace overrides user.
Scope order is not configurable. Missing files read as empty patches.

## Validation and preservation

- Config file names must be plain names, not paths.
- Invalid JSON or non-object files read as empty patches and warn; the next
  update replaces malformed content with valid config.
- Scoped patches stay untyped `Record<string, unknown>` - files may hold
  anything.
- Unknown keys are preserved across key updates, ignored on resolution.
- Invalid known values become warnings and are skipped while resolving;
  `update()` refuses them, but hand-edited files keep them.
- Newlines in string field defaults or values are invalid - use text fields.
- Files left empty are deleted.

## TUI notes

- Left/right moves focus between include checkbox and value.
  Enter edits/opens pickers or cycles discrete values; Space toggles
  include, quick-steps numbers, or cycles searchable enums.
- Searchable enum input replaces the row value, results render inline
  below it. Text editor also renders inline; Shift+Enter inserts newlines.
- Esc exits edit mode and discards uncommitted input.
- Scope notes show compact default/user/workspace source values.
- `visibleWhen` is UI-only: hidden saved values persist until cleared.
- Ranged number inputs reject out-of-range values on commit.

## Tooling

- `bun run typecheck`, `bun run biome:check`, `bun run check` (both).
- Published as a library module, not a Pi extension package;
  ships `src/`, `README.md`, `LICENSE`.
- No runtime deps; Pi packages (`@earendil-works/pi-coding-agent`,
  `@earendil-works/pi-tui`) are peers and dev deps.
