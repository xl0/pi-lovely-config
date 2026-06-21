# Codebase

`@xl0/pi-lovely-config` provides scoped config helpers for Pi extensions.

## Runtime library

`src/index.ts` exports:

- `defineScopedConfigSpec()` to declare fields, defaults, schema, paths, load/write/delete, and user/workspace merge semantics.
- `createScopedConfigSchema()` for TypeBox schemas from fields.
- `ScopedConfigState` for in-memory effective config access.
- `ScopedConfigEditor` custom TUI component for editing user/workspace scopes.
- Types for scopes, specs, fields, and field-derived config.

Scopes are fixed:

- user: `~/.pi/agent/<fileName>`
- workspace: `<cwd>/.pi/<fileName>`

Workspace overrides user. Missing files read as empty config. Invalid JSON/schema throws with path.

Supported fields: enum and boolean. Fields can be indented with `depth` and hidden with `visibleWhen`.

## Manual extension

`extensions/scoped-config-demo.ts` registers `/scoped-config-demo`.

It opens `ScopedConfigEditor` in TUI mode for `scoped-config-demo.json`, showing enum, boolean, nested, and conditional fields. It updates footer status with effective values after edits. Non-TUI mode reports effective values via notification.

## Tooling

- `bun run typecheck` typechecks `src` and `extensions`.
- `bun run biome:check` checks formatting/linting.
