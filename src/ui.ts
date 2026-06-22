import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import {
	CURSOR_MARKER,
	getKeybindings,
	Input,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi
} from "@earendil-works/pi-tui"
import type { ConfigDefaults, ConfigScope, ScopedConfig, ScopedConfigField, ScopedConfigSpec } from "./config"
import { getConfigValue } from "./config"

type Row = { kind: "field"; field: ScopedConfigField } | { kind: "reset" }
type RenderTui = { requestRender(): void }

type ScopedConfigChangeHandler<Config extends object> = (effective: Config, scoped: ScopedConfig<Config>) => void
type FocusPart = "include" | "value"

export class ScopedConfigEditor<Config extends object> {
	private scoped: ScopedConfig<Config>
	private readonly tui: RenderTui
	private readonly theme: Theme
	private readonly ctx: ExtensionContext
	private readonly spec: ScopedConfigSpec<Config>
	private readonly onChange: ScopedConfigChangeHandler<Config>
	private readonly fields: readonly ScopedConfigField[]
	private readonly defaults: ConfigDefaults<Config>
	private readonly scopes: readonly ConfigScope[]
	private readonly done: (result: undefined) => void
	private activeInput: Input | undefined
	private focusPart: FocusPart = "value"
	private currentTab = 0
	private currentRow = 0

	constructor(options: {
		tui: RenderTui
		theme: Theme
		ctx: ExtensionContext
		spec: ScopedConfigSpec<Config>
		scoped: ScopedConfig<Config>
		onChange: ScopedConfigChangeHandler<Config>
		done: (result: undefined) => void
	}) {
		this.tui = options.tui
		this.theme = options.theme
		this.ctx = options.ctx
		this.spec = options.spec
		this.onChange = options.onChange
		this.fields = options.spec.fields
		this.defaults = options.spec.defaults
		this.scopes = options.spec.scopes
		this.scoped = options.scoped
		this.done = options.done
	}

	render(width: number): string[] {
		const lines: string[] = []
		const renderWidth = Math.max(1, width)
		const scope = this.currentScope()
		const rows = this.rows(scope)

		lines.push(this.theme.fg("accent", "─".repeat(renderWidth)))
		this.renderTabs(lines, renderWidth)
		lines.push("")
		this.renderScopeHeader(lines, renderWidth)
		lines.push("")
		this.renderActiveFieldDescription(lines, renderWidth, rows)
		this.renderRows(lines, renderWidth, scope, rows)
		this.renderActiveValueDescription(lines, renderWidth, scope, rows)
		lines.push("")
		addWrappedWithPrefix(
			lines,
			renderWidth,
			" ",
			this.theme.fg("dim", "Tab switch scope • ↑↓ select • ←→ include/value • Enter/Space edit/toggle • Esc close")
		)
		lines.push(this.theme.fg("accent", "─".repeat(renderWidth)))

		return lines
	}

	invalidate() {}

	handleInput(data: string): void {
		const kb = getKeybindings()
		if (kb.matches(data, "tui.select.cancel") || matchesKey(data, Key.ctrl("c"))) {
			this.done(undefined)
			return
		}
		if (kb.matches(data, "tui.select.up")) {
			this.commitStringInput()
			this.moveRow(-1)
			return
		}
		if (kb.matches(data, "tui.select.down")) {
			this.commitStringInput()
			this.moveRow(1)
			return
		}
		if (
			this.activeInput &&
			this.focusPart === "value" &&
			kb.matches(data, "tui.editor.cursorLeft") &&
			inputCursor(this.activeInput) === 0
		) {
			this.focusPart = "include"
			this.tui.requestRender()
			return
		}
		if (
			this.activeInput &&
			this.focusPart === "value" &&
			(kb.matches(data, "tui.editor.cursorLeft") || kb.matches(data, "tui.editor.cursorRight"))
		) {
			this.activeInput.handleInput(data)
			this.tui.requestRender()
			return
		}
		if (matchesKey(data, Key.tab)) {
			this.commitStringInput()
			this.switchTab(1)
			return
		}
		if (kb.matches(data, "tui.editor.cursorRight")) {
			this.focusPart = "value"
			this.updateActiveInput()
			this.tui.requestRender()
			return
		}
		if (kb.matches(data, "tui.editor.cursorLeft")) {
			this.commitStringInput()
			this.focusPart = "include"
			this.activeInput = undefined
			this.tui.requestRender()
			return
		}
		if (this.handleStringInput(data)) return
		if (kb.matches(data, "tui.input.submit") || data === " ") {
			this.activateRow()
			return
		}
	}

	private renderTabs(lines: string[], width: number): void {
		const tabs = ["← "]
		for (const [index, scope] of this.scopes.entries()) {
			const isUnset = this.scopeIsUnset(scope)
			const text = ` ${isUnset ? "□" : "■"} ${scopeLabel(scope)} `
			const styled =
				index === this.currentTab
					? this.theme.bg("selectedBg", this.theme.fg("text", text))
					: this.theme.fg(isUnset ? "muted" : "success", text)
			tabs.push(`${styled} `)
		}
		tabs.push("→")
		addWrappedWithPrefix(lines, width, " ", tabs.join(""))
	}

	private renderScopeHeader(lines: string[], width: number): void {
		const scope = this.scopes[this.currentTab]
		if (!scope) return

		const path = this.spec.getPath(scope, this.ctx.cwd)
		addWrappedWithPrefix(
			lines,
			width,
			" ",
			`${this.theme.fg("accent", this.theme.bold(`${scopeLabel(scope)} config`))} ${this.theme.fg("dim", path)}`
		)
	}

	private renderRows(lines: string[], width: number, scope: ConfigScope, rows: Row[]): void {
		for (const [index, row] of rows.entries()) {
			const selected = index === this.currentRow
			if (row.kind === "reset") {
				this.renderResetRow(lines, width, selected)
				continue
			}

			const prefix = this.theme.fg(selected ? "accent" : "muted", `${selected ? "> " : "  "}${"  ".repeat(row.field.depth ?? 0)}`)
			const isSet = getConfigValue(this.scoped[scope], row.field.key) !== undefined
			const include = `${isSet ? "[x]" : "[ ]"} `
			const renderedInclude = this.theme.fg(selected && this.focusPart === "include" ? "accent" : "muted", include)
			const value = this.renderFieldValue(this.scoped[scope], row.field, selected, width)
			const note = getScopeNote(scope, this.scopes, this.scoped, row.field)
			const renderedNote = note ? ` ${this.theme.fg("muted", `(${note})`)}` : ""
			const valueStyle = value === "unset" ? "muted" : selected && this.focusPart === "value" ? "accent" : "text"
			addWrappedWithPrefix(
				lines,
				width,
				prefix,
				`${renderedInclude}${this.theme.fg("text", row.field.label)}  ${this.theme.fg(valueStyle, value)}${renderedNote}`
			)
		}
	}

	private renderActiveValueDescription(lines: string[], width: number, scope: ConfigScope, rows: Row[]): void {
		const row = rows[this.currentRow]
		const valueDescription = row?.kind === "field" ? getValueDescription(this.scoped[scope], row.field) : undefined
		lines.push("")
		if (valueDescription) addWrappedWithPrefix(lines, width, " ", this.theme.fg("muted", valueDescription))
		else lines.push("")
	}

	private renderFieldValue(config: Config, field: ScopedConfigField, selected: boolean, width: number): string {
		if (selected && this.focusPart === "value" && field.kind === "string" && this.activeInput)
			return renderStringInput(this.activeInput, width)
		return formatScopedValue(config, field)
	}

	private renderActiveFieldDescription(lines: string[], width: number, rows: Row[]): void {
		const row = rows[this.currentRow]
		const description = row?.kind === "field" ? row.field.description : undefined
		const wrapped = description ? wrapTextWithAnsi(this.theme.fg("muted", description), Math.max(1, width - 1)).slice(0, 2) : []
		for (let index = 0; index < 2; index++) lines.push(wrapped[index] ? ` ${wrapped[index]}` : "")
	}

	private renderResetRow(lines: string[], width: number, selected: boolean): void {
		lines.push(this.theme.fg("dim", `  ${"─".repeat(Math.max(1, width - 2))}`))
		const prefix = this.theme.fg(selected ? "accent" : "muted", selected ? "> " : "  ")
		addWrappedWithPrefix(
			lines,
			width,
			prefix,
			`${this.theme.fg("text", "Reset to default")}  ${this.theme.fg("muted", "delete this scope config file")}`
		)
	}

	private currentScope(): ConfigScope {
		return this.scopes[this.currentTab] ?? "user"
	}

	private resolvedConfig(scope: ConfigScope): Record<string, unknown> {
		let config: Record<string, unknown> = { ...this.defaults }
		for (const configScope of this.scopes) {
			config = { ...config, ...this.scoped[configScope] }
			if (configScope === scope) break
		}
		return config
	}

	private rows(scope: ConfigScope = this.currentScope()): Row[] {
		const effective = this.resolvedConfig(scope)
		const fields = this.fields.filter(field => isFieldVisible(field, scope, this.scoped, effective))
		return [...fields.map(field => ({ kind: "field" as const, field })), { kind: "reset" }]
	}

	private scopeIsUnset(scope: ConfigScope): boolean {
		return this.fields.every(field => getConfigValue(this.scoped[scope], field.key) === undefined)
	}

	private refresh(): void {
		this.currentRow = Math.min(this.currentRow, this.rows().length - 1)
		this.updateFocus()
		this.updateActiveInput()
		this.tui.requestRender()
	}

	private updateFocus(): void {
		const row = this.rows()[this.currentRow]
		this.focusPart =
			row?.kind === "field" && getConfigValue(this.scoped[this.currentScope()], row.field.key) === undefined ? "include" : "value"
	}

	private switchTab(delta: number): void {
		this.currentTab = (this.currentTab + delta + this.scopes.length) % this.scopes.length
		this.refresh()
	}

	private moveRow(delta: number): void {
		const rowCount = this.rows().length
		this.currentRow = (this.currentRow + delta + rowCount) % rowCount
		this.refresh()
	}

	private activateRow(): void {
		const scope = this.currentScope()
		const row = this.rows(scope)[this.currentRow]
		if (!row) return
		if (row.kind === "reset") this.reset(scope)
		else if (this.focusPart === "include") this.toggleField(scope, row.field)
		else if (getConfigValue(this.scoped[scope], row.field.key) === undefined)
			this.save(scope, setConfigValue(this.scoped[scope], row.field.key, row.field.default))
		else if (row.field.kind === "string") this.startStringInput(row.field)
		else this.save(scope, cycleField(this.scoped[scope], row.field))
	}

	private toggleField(scope: ConfigScope, field: ScopedConfigField): void {
		const current = getConfigValue(this.scoped[scope], field.key)
		this.save(scope, setConfigValue(this.scoped[scope], field.key, current === undefined ? field.default : undefined))
	}

	private updateActiveInput(): void {
		const row = this.rows()[this.currentRow]
		if (this.focusPart !== "value" || row?.kind !== "field" || row.field.kind !== "string") {
			this.activeInput = undefined
			return
		}

		const value = getConfigValue(this.scoped[this.currentScope()], row.field.key)
		if (typeof value !== "string") {
			this.activeInput = undefined
			return
		}

		this.startStringInput(row.field, value)
	}

	private startStringInput(field: ScopedConfigField, initial?: string): void {
		if (field.kind !== "string") return
		const value = initial ?? getConfigValue(this.scoped[this.currentScope()], field.key)
		const input = new Input()
		input.setValue(typeof value === "string" ? value : "")
		setInputCursor(input, 0)
		input.focused = true
		this.activeInput = input
		this.tui.requestRender()
	}

	private handleStringInput(data: string): boolean {
		const row = this.rows()[this.currentRow]
		if (this.focusPart !== "value" || row?.kind !== "field" || row.field.kind !== "string") return false

		const kb = getKeybindings()
		if (kb.matches(data, "tui.input.submit")) {
			if (!this.activeInput) this.startStringInput(row.field)
			else this.commitStringInput()
			return true
		}

		if (this.activeInput) {
			this.activeInput.handleInput(data)
			this.tui.requestRender()
			return true
		}

		if (data.length === 1 && !matchesKey(data, Key.escape)) {
			this.startStringInput(row.field)
			const input = this.activeInput as Input | undefined
			if (input) input.handleInput(data)
			this.tui.requestRender()
			return true
		}

		return false
	}

	private commitStringInput(): void {
		const row = this.rows()[this.currentRow]
		if (row?.kind !== "field" || row.field.kind !== "string" || !this.activeInput) return
		const value = this.activeInput.getValue()
		this.activeInput = undefined
		this.save(this.currentScope(), setConfigValue(this.scoped[this.currentScope()], row.field.key, value))
	}

	private save(scope: ConfigScope, nextConfig: Config): void {
		this.scoped = { ...this.scoped, [scope]: nextConfig }
		this.spec.writeFile(this.spec.getPath(scope, this.ctx.cwd), nextConfig)
		this.onChange(this.spec.merge(this.scoped), this.scoped)
		this.refresh()
	}

	private reset(scope: ConfigScope): void {
		this.scoped = { ...this.scoped, [scope]: {} as Config }
		this.spec.deleteFile(this.spec.getPath(scope, this.ctx.cwd))
		this.onChange(this.spec.merge(this.scoped), this.scoped)
		this.refresh()
	}
}

function addWrappedWithPrefix(lines: string[], width: number, prefix: string, text: string): void {
	const prefixWidth = visibleWidth(prefix)
	if (prefixWidth >= width) {
		lines.push(...wrapTextWithAnsi(prefix + text, width))
		return
	}

	const wrapped = wrapTextWithAnsi(text, width - prefixWidth)
	const continuationPrefix = " ".repeat(prefixWidth)
	for (let i = 0; i < wrapped.length; i++) lines.push(`${i === 0 ? prefix : continuationPrefix}${wrapped[i]}`)
}

function isFieldVisible<Config extends object>(
	field: ScopedConfigField,
	scope: ConfigScope,
	configs: ScopedConfig<Config>,
	effective: Record<string, unknown>
): boolean {
	if (!field.visibleWhen) return true
	return field.visibleWhen({
		scope,
		get: key => effective[key],
		getScoped: (key, targetScope = scope) => getConfigValue(configs[targetScope], key)
	})
}

function setConfigValue<Config extends object>(config: Config, key: string, value: unknown): Config {
	const next = { ...(config as Record<string, unknown>) }
	if (value === undefined) delete next[key]
	else next[key] = value
	return next as Config
}

function inputCursor(input: Input): number {
	return (input as unknown as { cursor: number }).cursor
}

function setInputCursor(input: Input, cursor: number): void {
	;(input as unknown as { cursor: number }).cursor = cursor
}

function renderStringInput(input: Input, width: number): string {
	const text = `"${input.getValue()}"`
	const cursor = Math.min(inputCursor(input) + 1, text.length - 1)
	const beforeCursor = text.slice(0, cursor)
	const atCursor = text[cursor] ?? '"'
	const afterCursor = text.slice(cursor + atCursor.length)
	return truncateToWidth(`${beforeCursor}${CURSOR_MARKER}\x1b[7m${atCursor}\x1b[27m${afterCursor}`, width, "")
}

function cycleField<Config extends object>(config: Config, field: ScopedConfigField): Config {
	const current = formatScopedValue(config, field)
	const options = field.kind === "enum" ? field.values : ["on", "off"]
	const next = nextOption(options, current)
	const persisted = field.kind === "boolean" ? next === "on" : next
	return setConfigValue(config, field.key, persisted)
}

function nextOption<T extends string>(options: readonly T[], value: T): T {
	const index = options.indexOf(value)
	return options[(index + 1) % options.length] ?? options[0] ?? value
}

function formatScopedValue(config: object, field: ScopedConfigField): string {
	const value = getConfigValue(config, field.key)
	return formatFieldValue(field, value)
}

function getValueDescription(config: object, field: ScopedConfigField): string | undefined {
	const value = formatScopedValue(config, field)
	if (value === "unset") return undefined
	const description =
		field.kind === "enum"
			? field.valueDescriptions?.[value]
			: field.kind === "boolean"
				? field.valueDescriptions?.[value as "on" | "off"]
				: undefined
	return description
}

function formatFieldValue(field: ScopedConfigField, value: unknown): string {
	if (value === undefined) return "unset"
	if (field.kind === "boolean") return value ? "on" : "off"
	if (field.kind === "string") return JSON.stringify(String(value))
	return String(value)
}

function getScopeNote<Config extends object>(
	scope: ConfigScope,
	scopes: readonly ConfigScope[],
	configs: ScopedConfig<Config>,
	field: ScopedConfigField
): string | undefined {
	const userValue = getConfigValue(configs.user, field.key)
	const workspaceValue = getConfigValue(configs.workspace, field.key)
	const user = userValue === undefined ? undefined : formatFieldValue(field, userValue)
	const workspace = workspaceValue === undefined ? undefined : formatFieldValue(field, workspaceValue)
	const defaultValue = formatFieldValue(field, field.default)
	if (scopes.length === 1) {
		const value = scope === "user" ? user : workspace
		return value === undefined ? `uses default: ${defaultValue}` : `overrides default: ${defaultValue}`
	}

	if (user === undefined && workspace === undefined) return `uses default: ${defaultValue}`

	if (scope === "user") {
		if (user !== undefined && workspace !== undefined) return `Workspace overrides with: ${workspace}`
		if (user === undefined && workspace !== undefined) return `Workspace sets: ${workspace}`
		return undefined
	}

	if (workspace === undefined && user !== undefined) return `inherits User: ${user}`
	if (workspace !== undefined && user !== undefined) return workspace === user ? `same as User: ${user}` : `overrides User: ${user}`
	if (workspace !== undefined && user === undefined) return `overrides default: ${defaultValue}`
	return undefined
}

function scopeLabel(scope: ConfigScope): string {
	return `${scope[0]?.toUpperCase() ?? ""}${scope.slice(1)}`
}
