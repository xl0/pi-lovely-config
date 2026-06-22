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
- `ScopedConfigState` for in-memory effective config access.
- `ScopedConfigEditor` custom TUI component for editing user/workspace scopes.
- Types for scopes, specs, fields, and field-derived config.

Scopes are fixed:

- user: `~/.pi/agent/<fileName>`
- workspace: `<cwd>/.pi/<fileName>`

Specs default to `scopes: ["user", "workspace"]`, where workspace overrides user.
Specs can restrict active scopes with `scopes: ["user"]` or `scopes: ["workspace"]`.
Merge order follows the configured `scopes`. Missing files read as empty config.
Invalid JSON/schema throws with path.

Supported fields: enum and boolean. Fields can include `description` and `valueDescriptions`, be indented with `depth`, and hidden with `visibleWhen`.

## Manual extension

`extensions/scoped-config-demo.ts` registers `/scoped-config-demo [user|workspace|both]`.

It opens `ScopedConfigEditor` in TUI mode, showing enum, boolean, nested, and conditional fields. It updates footer status with effective values after edits. Non-TUI mode reports effective values via notification. Optional arg selects active scopes; default is `both`.

## Tooling

- `bun run typecheck` typechecks `src` and `extensions`.
- `bun run biome:check` checks formatting/linting.
