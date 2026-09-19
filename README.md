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
config. Enum fields can opt into advisory choices to retain unavailable values
instead of falling back.

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
		retries: field.number(1, { values: [0, 1, 2, 3] }),
		models: field.multiEnum(["gpt", "claude", "gemini"], ["claude"])
	}
})
```

Supported fields: enum, multiEnum, boolean, string, text, number. Multi-enum
fields resolve to a string array; scopes replace the whole array, no merging.
The TUI editor always opens a searchable checklist for them. String fields are
single-line. Text fields resolve to string values and use a multi-line TUI
editor. Number fields take either range mode (`min`/`max`/`step`) or an
explicit `values` list, never both.

### Strict and advisory choices

Enums and multi-enums default to `choices: "strict"`: unlisted values invalidate
the whole field, which falls back to a lower scope or its default. `update()`
rejects them. Strict enums retain their inferred literal-union types.

For changing catalogs such as available models, opt into advisory choices:

```ts
models: field.multiEnum(["provider/model-a", "provider/model-b"], [], {
	choices: "advisory"
})
```

`choices: "advisory"` works on both `field.enum()` and `field.multiEnum()`.
Loading, resolving, and updating retain unlisted strings; multi-enums keep the
whole list rather than filtering it. Load/update report retained-value warnings
in `config.warnings`. The caller decides how to handle unavailable choices.
Resolved types widen to `string` / `readonly string[]`.

Wrong types are still invalid, including any non-string multi-enum item.
Choice lists must still be nonempty, and schema defaults must be listed choices.
Numeric bounds and numeric `values` remain strict: invalid numbers fall back
during resolution and are rejected by `update()`, never clamped.

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
- `warnings` — field or malformed file warnings by scope/path; field warnings
  include `key`. Each has a `message` and `action: "retained" | "ignored"`.
  Retained means accepted for resolution, not necessarily the winning scope.
  Choice warnings show at most three unavailable values, not the allowed catalog.

For example, callers can display retained warnings less prominently:

```ts
for (const warning of config.warnings) {
	ctx.ui.notify(`${warning.path}: ${warning.message}`,
		warning.action === "retained" ? "info" : "warning")
}
```

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
Advisory pickers include saved unavailable choices, marked `(unavailable)`.
Multi-enum selections remain checked until explicitly removed; filtering or
saving other selections does not drop them. Esc discards pending changes.

## Releasing

Write entries under `CHANGELOG.md`'s `[Unreleased]`, then commit them.
From `master`, with Bun 1.3.13 and npm 12.0.2 (logged in):

```sh
bun run release [patch|minor|major|x.y.z] [--no-push]
```

The script checks the release, bumps the version, rolls the changelog, and
pauses for review before committing, tagging, and pushing. `--no-push`
stops after the local commit and tag.

The tag triggers `.github/workflows/publish.yml`: checks, npm staging with
OIDC provenance, then a GitHub Release. The script waits for staging and
asks for a 2FA code to approve publication; approval is also available on
npmjs.com.

Configure npm's GitHub Actions trusted publisher for `xl0/pi-lovely-config`,
workflow `publish.yml`, environment `npm`. The GitHub job uses that environment.
No npm token is needed in CI.

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
