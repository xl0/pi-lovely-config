# pi-lovely-config

Scoped config helpers for Pi extension packages.

Define config once. Get fixed user/workspace files, typed defaults, merge semantics,
validation, warnings, schema, and optional TUI editor.

**Key capabilities:**
- **Scoped config** — user file plus workspace override
- **Typed fields** — enum, boolean, string, number
- **Resolved state** — defaults-filled effective config
- **Soft numeric warnings** — bad number values warn, load, and stay editable
- **TUI editor** — edit both scopes with one component
- **Schema output** — derive small plain JSON Schema-like object

## Table of Contents

- [Quick Start](#quick-start)
- [Purpose](#purpose)
- [How it works](#how-it-works)
- [Config model](#config-model)
- [API overview](#api-overview)
- [Defining config](#defining-config)
- [Runtime flow](#runtime-flow)
- [TUI editor](#tui-editor)
- [Schema and validation](#schema-and-validation)
- [Example](#example)
- [Related projects](#related-projects)

## Quick Start

Install:

```bash
bun add @xl0/pi-lovely-config
```

Minimal setup:

```ts
import {
	defineScopedConfigSpec,
	ScopedConfigState,
	type ScopedConfigField
} from "@xl0/pi-lovely-config"

const fields = [
	{ key: "theme", label: "Theme", kind: "enum", values: ["system", "light", "dark"], default: "system" },
	{ key: "temperature", label: "Temperature", kind: "number", min: 0, max: 2, step: 0.1, default: 0.7 }
] as const satisfies readonly ScopedConfigField[]

const spec = defineScopedConfigSpec({
	fileName: "my-extension.json",
	fields
})

const state = new ScopedConfigState(spec)
const config = state.load(process.cwd())

console.log(config.theme, config.temperature)
```

## Purpose

Pi extensions often need few knobs, but knobs live in two places:

- user preference in `~/.pi/agent/<fileName>`
- workspace override in `<cwd>/.pi/<fileName>`

This lib keeps that machinery out of extension code.

Use it when extension needs:

- typed defaults
- user/workspace layering
- load/save helpers
- soft warnings for bad numeric values
- optional TUI editing

## How it works

1. Declare fields once with `defineScopedConfigSpec()`.
2. Library derives defaults, schema, fixed paths, validation, merge order.
3. Load scoped patches with `loadScoped()` or effective config with `load()`.
4. Keep in-memory state with `ScopedConfigState`.
5. In TUI, pass spec + scoped state into `ScopedConfigEditor`.

## Config model

Scopes are fixed:

| Scope | Path |
| --- | --- |
| User | `~/.pi/agent/<fileName>` |
| Workspace | `<cwd>/.pi/<fileName>` |

Merge semantics:

- default `scope` is `"both"`
- workspace overrides user
- `scope` can be `"user"`, `"workspace"`, or `"both"`
- callers cannot change scope order
- missing files load as empty patches

## API overview

Core exports:

- `defineScopedConfigSpec()` — declare config once
- `ScopedConfigState` — hold scoped + resolved state in memory
- `ScopedConfigEditor` — edit both scopes in TUI
- `createScopedConfigSchema()` — derive plain JSON Schema-like shape
- `getConfigWarnings()` — standalone numeric warnings helper

Useful types:

- `ScopedConfigField`
- `ScopedConfigSpec`
- `ConfigFromFields`
- `ConfigScope`
- `ConfigScopeMode`

## Defining config

Supported fields:

- `enum`
- `boolean`
- `string`
- `number`

Field features:

- `description` — field help text
- `valueDescriptions` — per-value help text in editor
- `depth` — visual indentation for nested rows
- `visibleWhen` — UI-only conditional visibility

Number fields support one of:

- range mode: `min` / `max` / `step`
- explicit values: `values`

Not both.

Example:

```ts
const fields = [
	{
		key: "theme",
		label: "Theme",
		kind: "enum",
		values: ["system", "light", "dark"],
		default: "system"
	},
	{
		key: "compactMode",
		label: "Compact mode",
		kind: "boolean",
		default: false
	},
	{
		key: "signature",
		label: "Signature",
		kind: "string",
		default: "sent from pi"
	},
	{
		key: "temperature",
		label: "Temperature",
		kind: "number",
		min: 0,
		max: 2,
		step: 0.1,
		default: 0.7
	}
] as const satisfies readonly ScopedConfigField[]
```

## Runtime flow

Load raw scoped patches:

```ts
const scoped = spec.loadScoped(ctx.cwd)
```

Resolve effective config:

```ts
const config = spec.resolve(scoped)
// or
const config = spec.load(ctx.cwd)
```

Keep state in memory:

```ts
const state = new ScopedConfigState(spec)
state.loadScoped(ctx.cwd)
const resolved = state.getResolved()
```

Write one scope explicitly:

```ts
spec.saveFile(spec.getPath("workspace", ctx.cwd), {
	temperature: 1.1
})
```

If known-field values become empty and no unknown properties remain, file is deleted.

## TUI editor

Use `ScopedConfigEditor` inside `ctx.ui.custom()`:

```ts
await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
	return new ScopedConfigEditor({
		tui,
		theme,
		ctx,
		spec,
		scoped,
		onChange: (_resolved, nextScoped) => {
			state.setScoped(nextScoped)
		},
		done
	})
})
```

Editor behavior:

- tab switches scope
- workspace/user tabs show whether scope file is set
- string fields edit inline
- ranged number fields step or accept direct numeric input
- value-list number fields cycle through allowed values
- hidden fields stay saved; `visibleWhen` affects UI only

## Schema and validation

`createScopedConfigSchema()` returns small plain JSON Schema-like object with:

- `type: "object"`
- `properties`
- `additionalProperties: true`
- field `default`
- field `description`
- enum `enum`
- number `minimum` / `maximum`

Validation rules:

- invalid JSON or wrong known-field types throw with file path
- unknown properties are preserved across load/save
- numeric range/value mismatches are soft warnings, not fatal
- warned numeric values are ignored while resolving, so lower-scope/default wins

Warnings are available from:

- `spec.getWarnings(config)`
- `spec.getScopedWarnings(scoped, cwd)`
- `getConfigWarnings(fields, config)`

## Example

Tiny extension with mood, heat, signature. User sets baseline taste. Workspace can
turn one repo feral.

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
	defineScopedConfigSpec,
	ScopedConfigEditor,
	ScopedConfigState,
	type ScopedConfigField
} from "@xl0/pi-lovely-config"

const fields = [
	{
		key: "mood",
		label: "Mood",
		kind: "enum",
		values: ["calm", "spicy", "feral"],
		valueDescriptions: {
			calm: "Measured, boring, safe",
			spicy: "Sharp edges, fun risk",
			feral: "No promises"
		},
		default: "calm"
	},
	{
		key: "temperature",
		label: "Temperature",
		kind: "number",
		min: 0,
		max: 2,
		step: 0.1,
		default: 0.7
	},
	{
		key: "signature",
		label: "Signature",
		kind: "string",
		default: "sent from bat cave"
	}
] as const satisfies readonly ScopedConfigField[]

const spec = defineScopedConfigSpec({
	fileName: "vibes.json",
	fields
})

const state = new ScopedConfigState(spec)

export default function (pi: ExtensionAPI) {
	pi.registerCommand("vibes", {
		description: "Edit or print scoped vibes config",
		handler: async (_args, ctx) => {
			const scoped = state.loadScoped(ctx.cwd)
			const warnings = spec.getScopedWarnings(scoped, ctx.cwd)
			if (warnings.length > 0) {
				ctx.ui.notify(warnings.map(w => `${w.path}: ${w.message}`).join("\n"), "warning")
			}

			if (ctx.mode !== "tui") {
				const config = state.getResolved()
				ctx.ui.notify(`mood=${config.mood} temp=${config.temperature} sig=${config.signature}`, "info")
				return
			}

			await ctx.ui.custom<void>((tui, theme, _keys, done) => {
				return new ScopedConfigEditor({
					tui,
					theme,
					ctx,
					spec,
					scoped,
					onChange: (_resolved, nextScoped) => {
						state.setScoped(nextScoped)
					},
					done
				})
			})
		}
	})
}
```

Result:

- user file sets baseline vibe
- workspace file overrides it for repo
- editor shows both scopes
- `state.getResolved()` gives final effective config

## Related projects

|  |  |
| --- | --- |
| [Pi Lovely Web](https://github.com/xl0/pi-lovely-web) | `web_search`, `web_fetch`, `web_image` tools |
| [Pi Lovely Dev Tools](https://github.com/xl0/pi-lovely-dev-tools) | `/tool`, `/show-sysprompt`, `/show-context`, `/llm-stats` |
| [Pi Lovely Codex](https://github.com/xl0/pi-lovely-codex) | GPT fast mode and Codex-style `apply_patch` |
| [Pi Lovely IDE](https://github.com/xl0/pi-lovely-ide) | Interactive IDE integration |

---

Like this work? [Hire me](https://alexey.work/cv?ref=pi-lovely-config)
