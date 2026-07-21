# pi-lovely-config

Scoped config helpers for Pi extension packages.

Define a flat schema once. Get fixed user/workspace files, typed defaults,
merge semantics, validation warnings, key updates, and an optional TUI editor.

## Install

```sh
npm i @xl0/pi-lovely-config
```

No extra runtime dependencies.

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
		signature: field.string("sent from pi"),
		instructions: field.text("Keep replies concise.")
	}
})

config.load(process.cwd())
console.log(config.value.mood, config.value.temperature)

config.update("workspace", "temperature", 1.1)
```

## Model

Scopes are fixed:

| Scope | Path |
| --- | --- |
| User | `~/.pi/agent/<fileName>` |
| Workspace | `<cwd>/.pi/<fileName>` |

By default both scopes are active and workspace overrides user. Pass
`scope: "user"` or `scope: "workspace"` to `defineScopedConfig` for
single-scope configs.

Unknown keys are preserved in files but ignored by typed config resolution. This
lets newer config files survive older app versions.

Invalid known values, invalid JSON, and non-object config files are warnings and
are ignored while resolving. Writing a key replaces a malformed file with valid
config.

## Schema

Use field builders:

```ts
const config = defineScopedConfig({
	fileName: "my-extension.json",
	schema: {
		theme: field.enum(["system", "light", "dark"], "system", {
			label: "Theme",
			description: "Preferred theme",
			search: true
		}),
		compact: field.boolean(false),
		signature: field.string("sent from pi"),
		instructions: field.text("Keep replies concise.", {
			label: "Instructions",
			description: "Long multi-line text edited in the TUI editor"
		}),
		temperature: field.number(0.7, { min: 0, max: 2, step: 0.1 }),
		retries: field.number(1, { values: [0, 1, 2, 3] })
	}
})
```

Supported fields: enum, boolean, string, text, number. String fields are
single-line. Text fields resolve to string values and use a multi-line TUI
editor. Number fields take either range mode (`min`/`max`/`step`) or an
explicit `values` list, never both.

UI-only metadata:

- `label` — display name; defaults to the key
- `description` — help text shown with the field
- `valueDescriptions` — per-value help, e.g. `{ dark: "Easy on the eyes" }`
- `search` — enum fields only; enables fuzzy picker in the TUI editor
- `depth` — indent level, for visually nesting fields under a parent
- `visibleWhen: ctx => boolean` — hide the field in the editor based on other
  values (`ctx.get(key)`, `ctx.getScoped(key, scope?)`, `ctx.scope`). UI-only:
  hidden saved values persist until cleared.

## Runtime API

```ts
config.load(ctx.cwd)
```

`config` now contains:

- `value` — defaults-filled merged config
- `scoped` — raw user/workspace patches, including unknown keys
- `warnings` — invalid field or malformed file warnings by scope/path; field warnings include `key`

Update one key:

```ts
config.update("user", "theme", "dark")
```

Unset one key:

```ts
config.update("workspace", "theme", undefined)
```

Delete one scope config file:

```ts
config.resetScope("workspace")
```

Other useful properties/methods:

- `config.fields` — normalized field list for UI
- `config.defaults` — schema defaults as a plain object
- `config.path(scope)` — resolved file path for a scope
- `config.resolve(scoped)` — merge defaults + scope patches without file IO

## TUI editor

```ts
config.load(ctx.cwd)

await ctx.ui.custom<void>((tui, theme, _keys, done) => {
	return new ScopedConfigEditor({
		tui,
		theme,
		config,
		onChange: config => {
			ctx.ui.setStatus("vibes", `mood=${config.value.mood}`)
		},
		done
	})
})
```

Each row shows an include checkbox and a value, plus compact
default/user/workspace source notes. Left/right moves focus, Enter edits or
cycles values, Space toggles include, Esc discards uncommitted input.

Editor writes via `update()` / `resetScope()`, then reloads merged config.

## Related projects

|  |  |
| --- | --- |
| [Pi Lovely Web](https://github.com/xl0/pi-lovely-web) | `web_search`, `web_fetch`, `web_image` tools |
| [Pi Lovely Dev Tools](https://github.com/xl0/pi-lovely-dev-tools) | `/tool`, `/show-sysprompt`, `/show-context`, `/llm-stats` |
| [Pi Lovely Codex](https://github.com/xl0/pi-lovely-codex) | GPT fast mode and Codex-style `apply_patch` |
| [Pi Lovely IDE](https://github.com/xl0/pi-lovely-ide) | Interactive IDE integration |
| [Pi Lovely Comment](https://github.com/xl0/agent-files/tree/master/pi/packages/pi-lovely-comment) | Open the last assistant message in your editor and sync edits back into the prompt |
| [Pi Lovely Rename](https://github.com/xl0/agent-files/tree/master/pi/packages/pi-lovely-rename) | Automatic and manual session naming |

---

Like this work? [Hire me](https://alexey.work/cv?ref=pi-lovely-config)
