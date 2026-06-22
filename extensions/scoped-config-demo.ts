import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import {
	type ConfigScopes,
	defineScopedConfigSpec,
	ScopedConfigEditor,
	type ScopedConfigSpec,
	ScopedConfigState,
	type VisibilityContext
} from "../src/index"

type ScopeDemoMode = "user" | "workspace" | "both"

const demoFields = [
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
		visibleWhen: (ctx: VisibilityContext) => ctx.get("compactMode") !== true
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
		visibleWhen: (ctx: VisibilityContext) => ctx.get("experimental") === true
	}
] as const

const scopeDemoConfigs = {
	user: defineScopeDemoConfig("user", ["user"]),
	workspace: defineScopeDemoConfig("workspace", ["workspace"]),
	both: defineScopeDemoConfig("both", ["user", "workspace"])
}

const scopeDemoStates = {
	user: new ScopedConfigState(scopeDemoConfigs.user),
	workspace: new ScopedConfigState(scopeDemoConfigs.workspace),
	both: new ScopedConfigState(scopeDemoConfigs.both)
}

function defineScopeDemoConfig(mode: ScopeDemoMode, scopes: ConfigScopes) {
	return defineScopedConfigSpec({
		fileName: `scoped-config-${mode}-demo.json`,
		scopes,
		fields: [
			...demoFields,
			{
				key: "scopeMarker",
				label: "Scope marker",
				kind: "enum",
				values: ["alpha", "beta", "gamma"],
				default: "alpha"
			}
		] as const
	})
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("scoped-config-demo", {
		description: "Open scoped config demo; optional arg: user, workspace, or both",
		handler: async (args, ctx) => {
			const mode = await pickScopeDemoMode(args, ctx)
			if (!mode) return

			await openDemoEditor(ctx, `scoped-config-demo:${mode}`, scopeDemoConfigs[mode], scopeDemoStates[mode])
		}
	})
}

async function pickScopeDemoMode(args: string, ctx: ExtensionCommandContext): Promise<ScopeDemoMode | undefined> {
	const requested = args.trim()
	if (isScopeDemoMode(requested)) return requested
	if (requested) {
		ctx.ui.notify("Usage: /scoped-config-demo [user|workspace|both]", "error")
		return undefined
	}
	return "both"
}

function isScopeDemoMode(value: string): value is ScopeDemoMode {
	return value === "user" || value === "workspace" || value === "both"
}

async function openDemoEditor<Config extends object>(
	ctx: ExtensionCommandContext,
	statusKey: string,
	spec: ScopedConfigSpec<Config>,
	state: ScopedConfigState<Config>
): Promise<void> {
	const scoped = spec.loadScoped(ctx.cwd)
	state.set(spec.merge(scoped))

	if (ctx.mode !== "tui") {
		ctx.ui.notify(formatEffectiveConfig(state), "info")
		return
	}

	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		return new ScopedConfigEditor({
			tui,
			theme,
			ctx,
			spec,
			scoped,
			onChange: effective => {
				state.set(effective)
				ctx.ui.setStatus(statusKey, formatEffectiveConfig(state))
			},
			done
		})
	})

	ctx.ui.setStatus(statusKey, formatEffectiveConfig(state))
}

function formatEffectiveConfig<Config extends object>(state: ScopedConfigState<Config>): string {
	return [
		`theme=${state.get("theme" as keyof Config)}`,
		`compact=${state.get("compactMode" as keyof Config) === true ? "on" : "off"}`,
		`detail=${state.get("detailLevel" as keyof Config)}`,
		`experimental=${state.get("experimental" as keyof Config) === true ? "on" : "off"}`,
		`experiment=${state.get("experimentMode" as keyof Config)}`
	].join(" ")
}
