import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import {
	type ConfigScopeMode,
	defineScopedConfigSpec,
	ScopedConfigEditor,
	type ScopedConfigField,
	type ScopedConfigSpec,
	ScopedConfigState
} from "../src/index"

type ScopeDemoMode = "user" | "workspace" | "both"

const demoFields = [
	{
		key: "theme",
		label: "Theme",
		description: "Cycles an enum value. Workspace overrides user when both scopes are active",
		kind: "enum",
		values: ["system", "light", "dark", "unset"],
		valueDescriptions: {
			system: "Follow Pi's current theme",
			light: "Prefer a light presentation",
			dark: "Prefer a dark presentation",
			unset: "Literal enum value named unset"
		},
		default: "system"
	},
	{
		key: "compactMode",
		label: "Compact mode",
		description: "Boolean field. Turning it on hides Detail level via visibleWhen",
		kind: "boolean",
		valueDescriptions: {
			on: "Enable compact mode and hide Detail level",
			off: "Disable compact mode and show Detail level"
		},
		default: false
	},
	{
		key: "signature",
		label: "Signature",
		description: "String field. Use the include toggle to unset the value",
		kind: "string",
		default: "sent from pi"
	},
	{
		key: "temperature",
		label: "Temperature",
		description: "Number field with min, max, and step. Space steps through values; direct edit accepts numbers",
		kind: "number",
		min: 0,
		max: 2,
		step: 0.1,
		default: 0.7
	},
	{
		key: "retries",
		label: "Retries",
		description: "Number field with explicit values. Space cycles values; direct edit is disabled",
		kind: "number",
		values: [0, 1, 2, 3],
		valueDescriptions: {
			0: "No retries",
			1: "Retry once",
			2: "Retry twice",
			3: "Retry three times"
		},
		default: 1
	},
	{
		key: "detailLevel",
		label: "Detail level",
		description: "Conditional enum field. Visible only while Compact mode is not on",
		kind: "enum",
		values: ["low", "medium", "high"],
		valueDescriptions: {
			low: "Show terse details",
			medium: "Show balanced details",
			high: "Show verbose details"
		},
		default: "medium",
		visibleWhen: ctx => ctx.get("compactMode") !== true
	},
	{
		key: "experimental",
		label: "Experimental options",
		description: "Parent toggle for an indented child field",
		kind: "boolean",
		valueDescriptions: {
			on: "Show experimental child options",
			off: "Hide experimental child options"
		},
		default: false
	},
	{
		key: "experimentMode",
		label: "Experiment mode",
		description: "Indented child field. Visible only when Experimental options is on",
		kind: "enum",
		values: ["safe", "fast", "weird"],
		valueDescriptions: {
			safe: "Prefer predictable behavior",
			fast: "Prefer speed over caution",
			weird: "Exercise unusual enum values"
		},
		default: "safe",
		depth: 1,
		visibleWhen: ctx => ctx.get("experimental") === true
	}
] as const satisfies readonly ScopedConfigField[]

const scopeDemoConfigs = {
	user: defineScopeDemoConfig("user", "user"),
	workspace: defineScopeDemoConfig("workspace", "workspace"),
	both: defineScopeDemoConfig("both", "both")
}

const scopeDemoStates = {
	user: new ScopedConfigState(scopeDemoConfigs.user),
	workspace: new ScopedConfigState(scopeDemoConfigs.workspace),
	both: new ScopedConfigState(scopeDemoConfigs.both)
}

function defineScopeDemoConfig(mode: ScopeDemoMode, scope: ConfigScopeMode) {
	return defineScopedConfigSpec({
		fileName: `scoped-config-${mode}-demo.json`,
		scope,
		fields: [
			...demoFields,
			{
				key: "scopeMarker",
				label: "Scope marker",
				description: "Extra field for this scope-mode demo config file",
				kind: "enum",
				values: ["alpha", "beta", "gamma"],
				valueDescriptions: {
					alpha: "First marker value",
					beta: "Second marker value",
					gamma: "Third marker value"
				},
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
	const scoped = state.loadScoped(ctx.cwd)

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
			onChange: (_resolved, scoped) => {
				state.setScoped(scoped)
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
		`signature=${JSON.stringify(state.get("signature" as keyof Config))}`,
		`temperature=${state.get("temperature" as keyof Config)}`,
		`retries=${state.get("retries" as keyof Config)}`,
		`detail=${state.get("detailLevel" as keyof Config)}`,
		`experimental=${state.get("experimental" as keyof Config) === true ? "on" : "off"}`,
		`experiment=${state.get("experimentMode" as keyof Config)}`
	].join(" ")
}
