# Codebase

`@xl0/pi-lovely-config` provides scoped config helpers for Pi extensions.

## Runtime library

Core files:

- `src/config.ts` contains scoped config spec/state/schema/path/file logic.
- `src/ui.ts` contains `ScopedConfigEditor` and TUI-only helpers.
- `src/index.ts` re-exports both modules.

Public API:

- `defineScopedConfigSpec()` to declare fields, defaults, schema, paths, load/write/delete, and user/workspace merge semantics.
- `createScopedConfigSchema()` for plain JSON Schema-like objects from fields.
- `ScopedConfigState` for in-memory scoped patch and resolved config access.
- `ScopedConfigEditor` custom TUI component for editing user/workspace scopes.
- `getConfigWarnings()` and spec `getWarnings()` / `getScopedWarnings()` for soft validation diagnostics.
- Root exports keep to core entrypoints plus small type set: scopes, spec, fields, field-derived config.

Scopes are fixed:

- user: `~/.pi/agent/<fileName>`
- workspace: `<cwd>/.pi/<fileName>`

Specs default to `scope: "both"`, where workspace always overrides user.
Specs can restrict active scopes with `scope: "user"` or `scope: "workspace"`.
Callers cannot configure scope order. Missing files read as empty config patches.
`loadScoped()` returns user/workspace patches; `resolve()` and `load()` validate known field types and return defaults-filled resolved config.
Invalid JSON/type values throw with path and validation details. Unknown file properties are preserved across load/save, but ignored by typed field behavior.
Validation is implemented locally; schema generation has no runtime dependency.
Generated schemas include field defaults, descriptions, enum values, and number
minimum/maximum bounds.
Config file names must be plain file names, not paths. `saveFile()` validates known fields and deletes empty patches.

Supported fields: enum, boolean, string, and number. Fields can include `description` and `valueDescriptions`, be indented with `depth`, and hidden with `visibleWhen`.
`visibleWhen` is UI-only; hidden saved values remain in config and still participate in resolution until cleared/reset.
Number fields support either `min`/`max`/`step` or explicit `values`, not both.
`step` controls UI stepping only.
Number range/value mismatches in files are warnings, not fatal; they remain in raw scoped patches, are ignored while resolving, and can be corrected in the editor.
Inline input Esc closes the editor when the input matches persisted state;
otherwise it reverts the input to persisted state.
Freeform number inputs accept digits, `.`, `+`, and `-`, validate number syntax while typing, and show range warnings in the value-description area.
Removing the last explicit known-field value in a scope deletes that scope config file only when no unknown properties remain.

## Manual extension

`extensions/scoped-config-demo.ts` registers `/scoped-config-demo [user|workspace|both]`.

It opens `ScopedConfigEditor` in TUI mode, showing enum, boolean, nested, and conditional fields. It updates footer status with effective values after edits. Non-TUI mode reports effective values via notification. Optional arg selects active scopes; default is `both`.

## Tooling

- `bun run typecheck` typechecks `src` and `extensions`.
- `bun run biome:check` checks formatting/linting.
- Published package is a library module, not a Pi extension package.
  It ships `src/`, `README.md`, and `LICENSE` only.
- No runtime dependencies beyond Pi peer packages.
- Pi packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) are runtime peers and local dev deps for typechecking.
- `README.md` is structured like Pi docs: capabilities, table of contents,
  purpose, config model, API overview, runtime flow, TUI editor, and full usage example.
