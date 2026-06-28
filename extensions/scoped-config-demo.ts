import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { defineScopedConfig, field, ScopedConfigEditor } from "../src/index"

const demoSchema = {
	temperature: field.number(0.7, {
		label: "Temperature",
		description: "Number field with min, max, and step. Space steps through values; direct edit accepts numbers",
		min: 0,
		max: 2,
		step: 0.1
	}),
	theme: field.enum(["system", "light", "dark", "unset"], "system", {
		label: "Theme",
		description: "Cycles an enum value. Workspace overrides user when both scopes are active",
		valueDescriptions: {
			system: "Follow Pi's current theme",
			light: "Prefer a light presentation",
			dark: "Prefer a dark presentation",
			unset: "Literal enum value named unset"
		}
	}),
	compactMode: field.boolean(false, {
		label: "Compact mode",
		description: "Boolean field. Turning it on hides Detail level via visibleWhen",
		valueDescriptions: {
			on: "Enable compact mode and hide Detail level",
			off: "Disable compact mode and show Detail level"
		}
	}),
	signature: field.string("sent from pi", {
		label: "Signature",
		description: "String field. Use the include toggle to unset the value"
	}),
	retries: field.number(1, {
		label: "Retries",
		description: "Number field with explicit values. Space cycles values; direct edit is disabled",
		values: [0, 1, 2, 3],
		valueDescriptions: {
			0: "No retries",
			1: "Retry once",
			2: "Retry twice",
			3: "Retry three times"
		}
	}),
	detailLevel: field.enum(["low", "medium", "high"], "medium", {
		label: "Detail level",
		description: "Conditional enum field. Visible only while Compact mode is not on",
		valueDescriptions: {
			low: "Show terse details",
			medium: "Show balanced details",
			high: "Show verbose details"
		},
		visibleWhen: ctx => ctx.get("compactMode") !== true
	}),
	experimental: field.boolean(false, {
		label: "Experimental options",
		description: "Parent toggle for an indented child field",
		valueDescriptions: {
			on: "Show experimental child options",
			off: "Hide experimental child options"
		}
	}),
	experimentMode: field.enum(["safe", "fast", "weird"], "safe", {
		label: "Experiment mode",
		description: "Indented child field. Visible only when Experimental options is on",
		valueDescriptions: {
			safe: "Prefer predictable behavior",
			fast: "Prefer speed over caution",
			weird: "Exercise unusual enum values"
		},
		depth: 1,
		visibleWhen: ctx => ctx.get("experimental") === true
	})
} as const

const demoConfig = defineScopedConfig({
	fileName: "scoped-config-demo.json",
	schema: demoSchema
})

export default function (pi: ExtensionAPI) {
	pi.registerCommand("scoped-config-demo", {
		description: "Open scoped config demo",
		handler: async (_args, ctx) => {
			demoConfig.load(ctx.cwd)
			const format = (config: typeof demoConfig.defaults) =>
				[
					`theme=${config.theme}`,
					`compact=${config.compactMode === true ? "on" : "off"}`,
					`signature=${JSON.stringify(config.signature)}`,
					`temperature=${config.temperature}`,
					`retries=${config.retries}`,
					`detail=${config.detailLevel}`,
					`experimental=${config.experimental === true ? "on" : "off"}`,
					`experiment=${config.experimentMode}`
				].join(" ")

			if (demoConfig.warnings.length > 0) {
				ctx.ui.notify(demoConfig.warnings.map(warning => `${warning.path}: ${warning.message}`).join("\n"), "warning")
			}

			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				return new ScopedConfigEditor({
					tui,
					theme,
					config: demoConfig,
					onChange: config => {
						ctx.ui.setStatus("scoped-config-demo", format(config.value))
					},
					done
				})
			})

			ctx.ui.setStatus("scoped-config-demo", format(demoConfig.value))
		}
	})
}
