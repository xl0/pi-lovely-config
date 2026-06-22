# pi-lovely-config

Scoped config helpers for Pi extension packages.

## Install

```bash
bun add @xl0/pi-lovely-config
```

## API

Exports:

- `defineScopedConfigSpec()`
- `ScopedConfigState`
- `ScopedConfigEditor`
- `createScopedConfigSchema()`
- `ConfigScopes`
- `ConfigScope`
- `ScopedConfig`
- `ScopedConfigField`
- `ScopedConfigSpec`
- `ConfigFromFields`

Config files use fixed Pi scopes by default:

- User: `~/.pi/agent/<fileName>`
- Workspace: `<cwd>/.pi/<fileName>`

Workspace values override User values. Missing files read as empty config.
Invalid JSON/schema throws a diagnostic error with the file path.

Use `scopes` to restrict a spec to one scope:

```ts
defineScopedConfigSpec({
	fileName: "my-extension.json",
	scopes: ["workspace"],
	fields: [/* ... */]
})
```

Default is `["user", "workspace"]`. Merge order follows `scopes`, so later
