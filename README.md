# pi-lovely-config

Scoped config helpers for Pi extension packages.

Define a flat schema once. Get fixed user/workspace files, typed defaults,
merge semantics, validation warnings, JSON Schema output, key updates, and an
optional TUI editor.

## Quick start

```ts
import {
	defineScopedConfig,
	field
} from "@xl0/pi-lovely-config"

const config = defineScopedConfig({
	fileName: "vibes.json",
	schema: {
		mood: field.enum(["calm", "spicy", "feral"], "calm"),
		temperature: field.number(0.7, { min: 0, max: 2, step: 0.1 }),
		signature: field.string("sent from pi")
	}
})

const loaded = config.load(process.cwd())
console.log(loaded.value.mood, loaded.value.temperature)

config.update(process.cwd(), {
	scope: "workspace",
	key: "temperature",
	value: 1.1
})
```

## Model

Scopes are fixed:

| Scope | Path |
| --- | --- |
| User | `~/.pi/agent/<fileName>` |
| Workspace | `<cwd>/.pi/<fileName>` |

Default `scope` is `"both"`; workspace overrides user. Use `scope: "user"` or
`scope: "workspace"` for single-scope configs.

Unknown keys are preserved in files but ignored by typed config resolution. This
lets newer config files survive older app versions.

Invalid known values are warnings and are ignored while resolving. Invalid JSON
or non-object config files still throw.

## Schema

Use field builders:

```ts
const config = defineScopedConfig({
	fileName: "my-extension.json",
	schema: {
		theme: field.enum(["system", "light", "dark"], "system", {
			label: "Theme",
			description: "Preferred theme"
		}),
		compact: field.boolean(false),
		signature: field.string("sent from pi"),
		temperature: field.number(0.7, { min: 0, max: 2, step: 0.1 }),
		retries: field.number(1, { values: [0, 1, 2, 3] })
	}
})
```

Supported fields: enum, boolean, string, number.

UI-only metadata:

- `label`
- `description`
- `valueDescriptions`
- `depth`
- `visibleWhen`

## Runtime API

```ts
const loaded = config.load(ctx.cwd)
```

`loaded` contains:

- `value` — defaults-filled merged config
- `scoped` — raw user/workspace patches, including unknown keys
- `warnings` — invalid known values by scope/path

Update one key:

```ts
const next = config.update(ctx.cwd, {
	scope: "user",
	key: "theme",
	value: "dark"
})
```

Unset one key:

```ts
config.update(ctx.cwd, {
	scope: "workspace",
	key: "theme",
	value: undefined
})
```

Reset all known keys in one scope while preserving unknown keys:

```ts
config.resetScope(ctx.cwd, "workspace")
```

Other useful properties/methods:

- `config.fields` — normalized field list for UI
- `config.defaults`
- `config.jsonSchema`
- `config.path(scope, cwd)`
- `config.resolve(scoped)`

## TUI editor

```ts
const loaded = config.load(ctx.cwd)

await ctx.ui.custom<void>((tui, theme, _keys, done) => {
	return new ScopedConfigEditor({
		tui,
		theme,
		ctx,
		spec: config,
		scoped: loaded.scoped,
		onChange: value => {
			ctx.ui.setStatus("vibes", `mood=${value.mood}`)
		},
		done
	})
})
```

Editor writes via `update()` / `resetScope()`, then reloads merged config.

## Related projects

|  |  |
| --- | --- |
| [Pi Lovely Web](https://github.com/xl0/pi-lovely-web) | `web_search`, `web_fetch`, `web_image` tools |
| [Pi Lovely Dev Tools](https://github.com/xl0/pi-lovely-dev-tools) | `/tool`, `/show-sysprompt`, `/show-context`, `/llm-stats` |
| [Pi Lovely Codex](https://github.com/xl0/pi-lovely-codex) | GPT fast mode and Codex-style `apply_patch` |
| [Pi Lovely IDE](https://github.com/xl0/pi-lovely-ide) | Interactive IDE integration |

---

Like this work? [Hire me](https://alexey.work/cv?ref=pi-lovely-config)
