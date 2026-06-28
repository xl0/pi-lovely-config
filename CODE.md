# Codebase

`@xl0/pi-lovely-config` provides scoped config helpers for Pi extensions.

## Runtime library

Core files:

- `src/config.ts` contains scoped config schema/path/file/merge logic.
- `src/ui.ts` contains `ScopedConfigEditor` and TUI-only helpers.
- `src/index.ts` re-exports public package API.

Public API:

- `defineScopedConfig()` declares a flat keyed schema and returns a stateful config instance.
- `field.enum()`, `field.boolean()`, `field.string()`, `field.number()` create fields.
- `config.load(cwd)` loads scoped patches into the config object.
- `config.value`, `config.scoped`, and `config.warnings` hold current loaded state.
- `config.update(scope, key, value)` writes one known key, reloads, and returns the config object.
- `config.resetScope(scope)` deletes one scope config file and reloads.
- `config.resolve(scoped)` merges defaults + active scopes without file IO.
- `config.path(scope)`, `fields`, and `defaults` are available for UI/debug after load.
- `ScopedConfigEditor` custom TUI component edits user/workspace scopes.
- Implementation keeps the public API factory-based for type inference; runtime behavior lives on an internal `ScopedConfigImpl` class.
- Root type exports are intentionally small: `ConfigFromSchema`, `ConfigScope`, and `ScopedConfig`.

Schema model:

- Schema is a keyed object; config keys come from object keys.
- Field `label` is optional and defaults to key.
- Supported fields: enum, boolean, string, number.
- Field metadata: `description`, `valueDescriptions`, `depth`, `visibleWhen`.
- Number fields support either range mode (`min` / `max` / `step`) or explicit `values`, not both.

Scopes are fixed:

- user: `~/.pi/agent/<fileName>`
- workspace: `<cwd>/.pi/<fileName>`

Omitting `scope` enables both scopes, where workspace overrides user.
Specs can restrict active scopes with `scope: "user"` or `scope: "workspace"`.
Callers cannot configure scope order. Missing files read as empty config patches.

Validation / preservation:

- Config file names must be plain file names, not paths.
- Invalid JSON or non-object config files throw with path.
- Raw scoped patches are untyped `Record<string, unknown>` because files may contain unknown or invalid values.
- Unknown keys are preserved by key updates and ignored by resolved typed config.
- Invalid known values become warnings and are ignored while resolving.
- `update()` only accepts known keys and valid values; manual invalid file values remain preserved.
- Empty files are deleted.

TUI notes:

- `visibleWhen` is UI-only; hidden saved values stay in config until cleared/reset.
- Inline input Esc closes editor when input matches persisted state; otherwise it reverts.
- Ranged number inputs reject out-of-range values on commit.
- Manual invalid values show warnings and are ignored by resolution until corrected.

## Manual extension

`extensions/scoped-config-demo.ts` registers `/scoped-config-demo`.

It opens `ScopedConfigEditor` in TUI mode, showing enum, boolean, string, ranged number, valued number, nested, and conditional fields. It updates footer status with effective values after edits. Non-TUI mode reports effective values via notification. Demo always uses both scopes.

## Tooling

- `bun run typecheck` typechecks `src` and `extensions`.
- `bun run biome:check` checks formatting/linting.
- `bun run check` runs both.
- Published package is a library module, not a Pi extension package.
  It ships `src/`, `README.md`, and `LICENSE` only.
- No runtime dependencies beyond Pi peer packages.
- Pi packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) are runtime peers and local dev deps for typechecking.
