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
- `ConfigScopeMode`
- `ConfigPatch`
- `ScopedConfigPatch`
- `ResolvedConfig`
- `ScopedConfigField`
- `ScopedConfigSpec`
- `ConfigFromFields`

Config files use fixed Pi scopes by default:

- User: `~/.pi/agent/<fileName>`
- Workspace: `<cwd>/.pi/<fileName>`

Workspace values override User values. Missing files read as empty config patches.
`loadScoped()` returns per-scope patches. `resolve()` and `load()` return resolved
config with defaults filled. Invalid JSON/schema throws a diagnostic error with
the file path. Unknown config-file properties are ignored.

Use `scope` to restrict a spec to one scope:

```ts
defineScopedConfigSpec({
	fileName: "my-extension.json",
	scope: "workspace",
	fields: [/* ... */]
})
```

Default is `scope: "both"`. Workspace always overrides User. `scope` accepts
`"user"`, `"workspace"`, or `"both"`; callers cannot configure scope order.
`fileName` must be a plain file name, not a path.

Fields support optional `description` and `valueDescriptions`; `ScopedConfigEditor`
renders the active field and set value descriptions under the field list.
String fields are edited inline; use the include toggle to unset a value.
Number fields support either `min`/`max`/`step` or explicit `values`, not both.
`step` controls UI stepping only. Number fields with `values` cycle through those
values; other number fields can be edited inline.

## Related projects

|  |  |
| --- | --- |
| [Pi Lovely Web](https://github.com/xl0/pi-lovely-web) | `web_search`, `web_fetch`, `web_image` tools |
| [Pi Lovely Dev Tools](https://github.com/xl0/pi-lovely-dev-tools) | interactive debugging helpers `/tool`, `/show-sysprompt`, `/show-context`, `/llm-stats` |
| [Pi Lovely Codex](https://github.com/xl0/pi-lovely-codex) | GPT fast mode and Codex-style `apply_patch` |
| [Pi Lovely IDE](https://github.com/xl0/pi-lovely-ide) | IDE integration |

---

Like this work? [Hire me](https://alexey.work/cv?ref=pi-lovely-config)
