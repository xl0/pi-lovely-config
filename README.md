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
scopes override earlier scopes.

Fields support optional `description` and `valueDescriptions`; `ScopedConfigEditor`
renders the active field and set value descriptions under the field list.

## Related projects

|  |  |
| --- | --- |
| [Pi Lovely Web](https://github.com/xl0/pi-lovely-web) | `web_search`, `web_fetch`, `web_image` tools |
| [Pi Lovely Dev Tools](https://github.com/xl0/pi-lovely-dev-tools) | interactive debugging helpers `/tool`, `/show-sysprompt`, `/show-context`, `/llm-stats` |
| [Pi Lovely Codex](https://github.com/xl0/pi-lovely-codex) | GPT fast mode and Codex-style `apply_patch` |
| [Pi Lovely IDE](https://github.com/xl0/pi-lovely-ide) | IDE integration |

---

Like this work? [Hire me](https://alexey.work/cv?ref=pi-lovely-config)
