import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { defineScopedConfigSpec, ScopedConfigEditor, ScopedConfigState } from "../src/index"

const demoConfig = defineScopedConfigSpec({
	fileName: "scoped-config-demo.json",
	fields: [
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
			key: "detailLevel",
			label: "Detail level",
			kind: "enum",
			values: ["low", "medium", "high"],
			default: "medium",
			visibleWhen: ctx => ctx.get("compactMode") !== true
		},
		{
			key: "experimental",
			label: "Experimental options",
			kind: "boolean",
			default: false
		},
		{
			key: "experimentMode",
			label: "Experiment mode",
			kind: "enum",
			values: ["safe", "fast", "weird"],
			default: "safe",
			depth: 1,
			visibleWhen: ctx => ctx.get("experimental") === true
		}
	] as const
})

const state = new ScopedConfigState(demoConfig)

export default function (pi: ExtensionAPI) {
	pi.registerCommand("scoped-config-demo", {
		description: "Open demo editor for @xl0/pi-lovely-config scoped config",
		handler: async (_args, ctx) => {
			const scoped = demoConfig.loadScoped(ctx.cwd)
			state.set(demoConfig.merge(scoped))

			if (ctx.mode !== "tui") {
				ctx.ui.notify(formatEffectiveConfig(), "info")
				return
			}

			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				return new ScopedConfigEditor({
					tui,
					theme,
					ctx,
					spec: demoConfig,
					scoped,
					onChange: effective => {
						state.set(effective)
						ctx.ui.setStatus("scoped-config-demo", formatEffectiveConfig())
					},
					done
				})
			})

			ctx.ui.setStatus("scoped-config-demo", formatEffectiveConfig())
		}
	})
}

function formatEffectiveConfig(): string {
	return [
		`theme=${state.get("theme")}`,
		`compact=${state.get("compactMode") ? "on" : "off"}`,
		`detail=${state.get("detailLevel")}`,
		`experimental=${state.get("experimental") ? "on" : "off"}`,
		`experiment=${state.get("experimentMode")}`
	].join(" ")
}
