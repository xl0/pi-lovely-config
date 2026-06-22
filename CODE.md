# Codebase

`@xl0/pi-lovely-config` provides scoped config helpers for Pi extensions.

## Runtime library

Core files:

- `src/config.ts` contains scoped config spec/state/schema/path/file logic.
- `src/ui.ts` contains `ScopedConfigEditor` and TUI-only helpers.
- `src/index.ts` re-exports both modules.

Public API:

- `defineScopedConfigSpec()` to declare fields, defaults, schema, paths, load/write/delete, and user/workspace merge semantics.
- `createScopedConfigSchema()` for TypeBox schemas from fields.
- `ScopedConfigState` for in-memory scoped patch and resolved config access.
- `ScopedConfigEditor` custom TUI component for editing user/workspace scopes.
- Types for scopes, specs, fields, and field-derived config.

Scopes are fixed:

- user: `~/.pi/agent/<fileName>`
- workspace: `<cwd>/.pi/<fileName>`

Specs default to `scope: "both"`, where workspace always overrides user.
Specs can restrict active scopes with `scope: "user"` or `scope: "workspace"`.
Callers cannot configure scope order. Missing files read as empty config patches.
`loadScoped()` returns user/workspace patches; `resolve()` and `load()` return defaults-filled resolved config.
Invalid JSON/config values throw with path and validation details. Unknown file properties are ignored.
Validation is implemented locally; TypeBox is used for public schema generation only.
Config file names must be plain file names, not paths. `saveFile()` validates known fields and deletes empty patches.

Supported fields: enum, boolean, string, and number. Fields can include `description` and `valueDescriptions`, be indented with `depth`, and hidden with `visibleWhen`.
Number fields support either `min`/`max`/`step` or explicit `values`, not both.
Inline input Esc closes the editor when the input matches persisted state;
otherwise it reverts the input to persisted state.
Removing the last explicit value in a scope deletes that scope config file.

## Manual extension

`extensions/scoped-config-demo.ts` registers `/scoped-config-demo [user|workspace|both]`.

It opens `ScopedConfigEditor` in TUI mode, showing enum, boolean, nested, and conditional fields. It updates footer status with effective values after edits. Non-TUI mode reports effective values via notification. Optional arg selects active scopes; default is `both`.

## Tooling

- `bun run typecheck` typechecks `src` and `extensions`.
- `bun run biome:check` checks formatting/linting.
- Pi packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`) are peers at runtime and local dev deps for typechecking.
