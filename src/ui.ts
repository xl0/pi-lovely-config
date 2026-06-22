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
import type { ConfigPatch, ConfigScope, ResolvedConfig, ScopedConfigField, ScopedConfigPatch, ScopedConfigSpec } from "./config"
import { getConfigValue } from "./config"

type RenderTui = { requestRender(): void }
type Keybindings = ReturnType<typeof getKeybindings>

type ScopedConfigChangeHandler<Config extends object> = (resolved: ResolvedConfig<Config>, scoped: ScopedConfigPatch<Config>) => void
type FocusPart = "include" | "value"
type NumberInputParseResult = { ok: true; value: number } | { ok: false; message: string }

export class ScopedConfigEditor<Config extends object> {
	private scoped: ScopedConfigPatch<Config>
	private readonly tui: RenderTui
	private readonly theme: Theme
	private readonly ctx: ExtensionContext
	private readonly spec: ScopedConfigSpec<Config>
	private readonly onChange: ScopedConfigChangeHandler<Config>
	private readonly fields: readonly ScopedConfigField[]
	private readonly defaults: ResolvedConfig<Config>
	private readonly scopes: readonly ConfigScope[]
	private readonly done: (result: undefined) => void
	private activeInput: Input | undefined
	private activeInputDirty = false
	private activeInputError: string | undefined
	private focusPart: FocusPart = "value"
	private currentTab = 0
	private currentRow = 0

	constructor(options: {
		tui: RenderTui
		theme: Theme
		ctx: ExtensionContext
		spec: ScopedConfigSpec<Config>
		scoped: ScopedConfigPatch<Config>
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
		const fields = this.visibleFields(scope)

		lines.push(this.theme.fg("accent", "─".repeat(renderWidth)))
		this.renderTabs(lines, renderWidth)
		lines.push("")
		this.renderScopeHeader(lines, renderWidth)
		lines.push("")
		this.renderActiveFieldDescription(lines, renderWidth, fields)
		this.renderRows(lines, renderWidth, scope, fields)
		this.renderActiveValueDescription(lines, renderWidth, scope, fields)
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
		const isSpace = data === " " || matchesKey(data, Key.space) || matchesKey(data, Key.shift("space"))
		if (this.handleCloseKey(data, kb)) return
		if (this.handleActiveInputCursorKey(data, kb)) return
		if (this.handleNavigationKey(data, kb)) return
		if (this.handleActivationKey(data, kb, isSpace)) return
		if (this.handleActiveInput(data, kb)) return
	}

	private handleCloseKey(data: string, kb: Keybindings): boolean {
		if (matchesKey(data, Key.ctrl("c"))) {
			this.done(undefined)
			return true
		}
		if (this.activeInput && kb.matches(data, "tui.select.cancel")) {
			if (this.activeInputMatchesPersisted()) {
				this.done(undefined)
				return true
			}
			this.updateActiveInput()
			this.tui.requestRender()
			return true
		}
		if (kb.matches(data, "tui.select.cancel")) {
			this.done(undefined)
			return true
		}
		return false
	}

	private handleNavigationKey(data: string, kb: Keybindings): boolean {
		if (kb.matches(data, "tui.select.up")) {
			if (!this.commitActiveInput()) return true
			this.moveRow(-1)
			return true
		}
		if (kb.matches(data, "tui.select.down")) {
			if (!this.commitActiveInput()) return true
			this.moveRow(1)
			return true
		}
		if (matchesKey(data, Key.tab)) {
			if (!this.commitActiveInput()) return true
			this.switchTab(1)
			return true
		}
		if (kb.matches(data, "tui.editor.cursorRight")) {
			if (!this.selectedFieldIsSet()) return true
			this.focusPart = "value"
			this.updateActiveInput()
			this.tui.requestRender()
			return true
		}
		if (!kb.matches(data, "tui.editor.cursorLeft")) return false
		if (this.focusPart === "include") {
			if (!this.selectedFieldIsSet()) return true
			this.focusPart = "value"
			this.updateActiveInput()
			this.tui.requestRender()
			return true
		}
		if (!this.commitActiveInput()) return true
		this.focusPart = "include"
		this.activeInput = undefined
		this.tui.requestRender()
		return true
	}

	private handleActiveInputCursorKey(data: string, kb: Keybindings): boolean {
		if (
			!this.activeInput ||
			this.focusPart !== "value" ||
			(!kb.matches(data, "tui.editor.cursorLeft") && !kb.matches(data, "tui.editor.cursorRight"))
		) {
			return false
		}

		const cursor = inputCursor(this.activeInput)
		const value = this.activeInput.getValue()
		const overstepsLeft = kb.matches(data, "tui.editor.cursorLeft") && cursor === 0
		const overstepsRight = kb.matches(data, "tui.editor.cursorRight") && cursor === value.length
		if (overstepsLeft || overstepsRight) {
			if (!this.commitActiveInput()) return true
			this.focusPart = "include"
		} else {
			this.activeInput.handleInput(data)
		}
		this.tui.requestRender()
		return true
	}

	private handleActivationKey(data: string, kb: Keybindings, isSpace: boolean): boolean {
		if (isSpace && this.focusPart === "value" && this.activeInput && this.selectedField()?.kind === "string") {
			this.handleActiveInput(data, kb)
			return true
		}
		if (isSpace && this.focusPart === "value" && this.activeInput && this.selectedField()?.kind === "number") {
			this.stepActiveNumberInput()
			return true
		}
		if (kb.matches(data, "tui.input.submit") && this.focusPart === "value" && this.activeInput) {
			if (this.selectedField()?.kind === "number" && this.activeInputDirty) this.commitActiveInput()
			else if (this.selectedField()?.kind === "number") this.activateRow()
			else this.commitActiveInput()
			return true
		}
		if (kb.matches(data, "tui.input.submit")) {
			this.activateRow()
			return true
		}
		if (isSpace) {
			this.activateRow()
			return true
		}
		return false
	}

	private renderTabs(lines: string[], width: number): void {
		const tabs = []
		for (const [index, scope] of this.scopes.entries()) {
			const isUnset = this.scopeIsUnset(scope)
			const text = ` ${isUnset ? "□" : "■"} ${scopeLabel(scope)} `
			const styled =
				index === this.currentTab
					? this.theme.bg("selectedBg", this.theme.fg("text", text))
					: this.theme.fg(isUnset ? "muted" : "success", text)
			tabs.push(`${styled} `)
		}
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

	private renderRows(lines: string[], width: number, scope: ConfigScope, fields: readonly ScopedConfigField[]): void {
		for (const [index, field] of fields.entries()) {
			const selected = index === this.currentRow
			const prefix = this.theme.fg(selected ? "accent" : "muted", `${selected ? "> " : "  "}${"  ".repeat(field.depth ?? 0)}`)
			const rawValue = getConfigValue(this.scoped[scope], field.key)
			const isSet = rawValue !== undefined
			const include = `${isSet ? "[x]" : "[ ]"} `
			const renderedInclude = this.theme.fg(selected && this.focusPart === "include" ? "accent" : "muted", include)
			const value = this.renderFieldValue(this.scoped[scope], field, selected, width)
			const note = getScopeNote(scope, this.scopes, this.scoped, field)
			const renderedNote = note ? ` ${this.theme.fg("muted", `(${note})`)}` : ""
			const valueStyle = !isSet ? "muted" : selected && this.focusPart === "value" ? "accent" : "text"
			addWrappedWithPrefix(
				lines,
				width,
				prefix,
				`${renderedInclude}${this.theme.fg("text", field.label)}  ${this.theme.fg(valueStyle, value)}${renderedNote}`
			)
		}
		this.renderResetRow(lines, width, this.isResetSelected(fields))
	}

	private renderActiveValueDescription(lines: string[], width: number, scope: ConfigScope, fields: readonly ScopedConfigField[]): void {
		const field = this.selectedField(fields)
		const error = this.activeInput ? this.activeInputError : undefined
		const valueDescription = field ? getValueDescription(this.scoped[scope], field) : undefined
		lines.push("")
		if (error) addWrappedWithPrefix(lines, width, " ", this.theme.fg("error", error))
		else if (valueDescription) addWrappedWithPrefix(lines, width, " ", this.theme.fg("muted", valueDescription))
		else lines.push("")
	}

	private renderFieldValue(config: ConfigPatch<Config>, field: ScopedConfigField, selected: boolean, width: number): string {
		if (selected && this.focusPart === "value" && this.activeInput) {
			if (field.kind === "string") return renderStringInput(this.activeInput, width)
			if (field.kind === "number" && !field.values) return renderInput(this.activeInput, width)
		}
		return formatScopedValue(config, field)
	}

	private renderActiveFieldDescription(lines: string[], width: number, fields: readonly ScopedConfigField[]): void {
		const description = this.selectedField(fields)?.description
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
			`${this.theme.fg("text", `Reset ${scopeLabel(this.currentScope())} to default`)}  ${this.theme.fg("muted", "delete this scope config file")}`
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

	private visibleFields(scope: ConfigScope = this.currentScope()): ScopedConfigField[] {
		const resolved = this.resolvedConfig(scope)
		return this.fields.filter(field => isFieldVisible(field, scope, this.scoped, resolved))
	}

	private selectedField(fields: readonly ScopedConfigField[] = this.visibleFields()): ScopedConfigField | undefined {
		return fields[this.currentRow]
	}

	private isResetSelected(fields: readonly ScopedConfigField[] = this.visibleFields()): boolean {
		return this.currentRow === fields.length
	}

	private selectedFieldIsSet(): boolean {
		const field = this.selectedField()
		return !!field && getConfigValue(this.scoped[this.currentScope()], field.key) !== undefined
	}

	private rowCount(): number {
		return this.visibleFields().length + 1
	}

	private scopeIsUnset(scope: ConfigScope): boolean {
		return this.fields.every(field => getConfigValue(this.scoped[scope], field.key) === undefined)
	}

	private refresh(): void {
		this.currentRow = Math.min(this.currentRow, this.rowCount() - 1)
		this.updateFocus()
		this.updateActiveInput()
		this.tui.requestRender()
	}

	private updateFocus(): void {
		const field = this.selectedField()
		this.focusPart = field && getConfigValue(this.scoped[this.currentScope()], field.key) === undefined ? "include" : "value"
	}

	private switchTab(delta: number): void {
		this.currentTab = (this.currentTab + delta + this.scopes.length) % this.scopes.length
		this.refresh()
	}

	private moveRow(delta: number): void {
		const rowCount = this.rowCount()
		this.currentRow = (this.currentRow + delta + rowCount) % rowCount
		this.refresh()
	}

	private activateRow(): void {
		const scope = this.currentScope()
		const fields = this.visibleFields(scope)
		const field = this.selectedField(fields)
		if (!field) {
			if (this.isResetSelected(fields)) this.reset(scope)
			return
		}
		if (this.focusPart === "include") this.toggleField(scope, field)
		else if (getConfigValue(this.scoped[scope], field.key) === undefined)
			this.save(scope, setConfigValue(this.scoped[scope], field.key, field.default))
		else if (field.kind === "number") this.save(scope, cycleField(this.scoped[scope], field))
		else if (fieldUsesInput(field)) this.startInput(field)
		else this.save(scope, cycleField(this.scoped[scope], field))
	}

	private toggleField(scope: ConfigScope, field: ScopedConfigField): void {
		const current = getConfigValue(this.scoped[scope], field.key)
		const nextIsSet = current === undefined
		this.activeInput = undefined
		this.activeInputDirty = false
		this.save(scope, setConfigValue(this.scoped[scope], field.key, nextIsSet ? field.default : undefined))
	}

	private updateActiveInput(): void {
		const field = this.selectedField()
		if (this.focusPart !== "value" || !field || !fieldUsesInput(field)) {
			this.activeInput = undefined
			this.activeInputDirty = false
			this.activeInputError = undefined
			return
		}

		const value = getConfigValue(this.scoped[this.currentScope()], field.key)
		if ((field.kind === "string" && typeof value !== "string") || (field.kind === "number" && typeof value !== "number")) {
			this.activeInput = undefined
			this.activeInputDirty = false
			this.activeInputError = undefined
			return
		}

		this.startInput(field, String(value))
	}

	private activeInputMatchesPersisted(): boolean {
		const field = this.selectedField()
		if (!field || !fieldUsesInput(field) || !this.activeInput) return true

		const persisted = getConfigValue(this.scoped[this.currentScope()], field.key)
		const inputValue = this.activeInput.getValue()
		if (field.kind === "string") return typeof persisted === "string" && inputValue === persisted
		if (field.kind !== "number" || typeof persisted !== "number") return false

		const parsed = parseNumberInput(field, inputValue, { validateRange: false })
		return parsed.ok && parsed.value === persisted
	}

	private startInput(field: ScopedConfigField, initial?: string): void {
		if (!fieldUsesInput(field)) return
		const value = initial ?? getConfigValue(this.scoped[this.currentScope()], field.key)
		const input = new Input()
		input.setValue(typeof value === "string" || typeof value === "number" ? String(value) : "")
		input.focused = true
		this.activeInput = input
		this.activeInputDirty = false
		this.updateActiveInputError(field)
		this.tui.requestRender()
	}

	private handleActiveInput(data: string, kb: Keybindings): boolean {
		const field = this.selectedField()
		if (this.focusPart !== "value" || !field || !fieldUsesInput(field)) return false

		if (kb.matches(data, "tui.input.submit")) {
			if (this.activeInput) this.commitActiveInput()
			return true
		}

		if (this.activeInput) {
			if (field.kind === "number" && !isNumberInputAllowed(data, this.activeInput, kb)) return true
			this.activeInput.handleInput(data)
			this.activeInputDirty = true
			this.updateActiveInputError(field)
			this.tui.requestRender()
			return true
		}

		if (data.length === 1 && !matchesKey(data, Key.escape)) {
			if (field.kind === "number" && !isNumberInputAllowed(data, undefined, kb)) return true
			this.startInput(field)
			const input = this.activeInput as Input | undefined
			if (input) input.handleInput(data)
			this.activeInputDirty = true
			this.updateActiveInputError(field)
			this.tui.requestRender()
			return true
		}

		return false
	}

	private commitActiveInput(): boolean {
		const field = this.selectedField()
		if (!field || !fieldUsesInput(field) || !this.activeInput) return true
		const value = this.activeInput.getValue()
		if (field.kind === "number") {
			const parsed = parseNumberInput(field, value)
			if (!parsed.ok) {
				this.activeInputError = parsed.message
				this.tui.requestRender()
				return false
			}
			this.activeInput = undefined
			this.activeInputDirty = false
			this.activeInputError = undefined
			this.save(this.currentScope(), setConfigValue(this.scoped[this.currentScope()], field.key, parsed.value))
			return true
		}

		this.activeInput = undefined
		this.activeInputDirty = false
		this.activeInputError = undefined
		this.save(this.currentScope(), setConfigValue(this.scoped[this.currentScope()], field.key, value))
		return true
	}

	private stepActiveNumberInput(): void {
		const field = this.selectedField()
		if (field?.kind !== "number" || !this.activeInput) return

		const parsed = parseNumberInput(field, this.activeInput.getValue(), { validateRange: false })
		if (!parsed.ok) {
			this.activeInputError = parsed.message
			this.tui.requestRender()
			return
		}

		const step = field.step ?? 1
		const base =
			field.min !== undefined && parsed.value < field.min
				? field.min - step
				: field.max !== undefined && parsed.value > field.max
					? field.max
					: parsed.value
		this.activeInput = undefined
		this.activeInputDirty = false
		this.activeInputError = undefined
		this.save(this.currentScope(), setConfigValue(this.scoped[this.currentScope()], field.key, nextNumberValue(field, base)))
	}

	private updateActiveInputError(field: ScopedConfigField): void {
		if (field.kind !== "number" || field.values || !this.activeInput) {
			this.activeInputError = undefined
			return
		}

		const parsed = parseNumberInput(field, this.activeInput.getValue())
		this.activeInputError = parsed.ok ? undefined : parsed.message
	}

	private save(scope: ConfigScope, nextConfig: ConfigPatch<Config>): void {
		this.activeInputError = undefined
		this.spec.saveFile(this.spec.getPath(scope, this.ctx.cwd), nextConfig)
		this.scoped = { ...this.scoped, [scope]: nextConfig }
		this.onChange(this.spec.resolve(this.scoped), this.scoped)
		this.refresh()
	}

	private reset(scope: ConfigScope): void {
		this.save(scope, {})
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
	configs: ScopedConfigPatch<Config>,
	resolved: Record<string, unknown>
): boolean {
	if (!field.visibleWhen) return true
	return field.visibleWhen({
		scope,
		get: key => resolved[key],
		getScoped: (key, targetScope = scope) => getConfigValue(configs[targetScope], key)
	})
}

function setConfigValue<Config extends object>(config: ConfigPatch<Config>, key: string, value: unknown): ConfigPatch<Config> {
	const next = { ...(config as Record<string, unknown>) }
	if (value === undefined) delete next[key]
	else next[key] = value
	return next as ConfigPatch<Config>
}

function fieldUsesInput(field: ScopedConfigField): boolean {
	return field.kind === "string" || (field.kind === "number" && !field.values)
}

function renderInput(input: Input, width: number, trimPadding = true): string {
	const rendered = input.render(width + 2)[0]?.slice(2) ?? ""
	return trimPadding ? rendered.trimEnd() : rendered
}

function inputCursor(input: Input): number {
	return (input as unknown as { cursor: number }).cursor
}

function renderStringInput(input: Input, width: number): string {
	const text = `"${input.getValue()}"`
	const cursor = Math.min(inputCursor(input) + 1, text.length - 1)
	const beforeCursor = text.slice(0, cursor)
	const atCursor = text[cursor] ?? '"'
	const afterCursor = text.slice(cursor + atCursor.length)
	return truncateToWidth(`${beforeCursor}${CURSOR_MARKER}\x1b[7m${atCursor}\x1b[27m${afterCursor}`, width, "")
}

function isNumberInputAllowed(data: string, input: Input | undefined, kb: Keybindings): boolean {
	if (kb.matches(data, "tui.editor.deleteCharBackward") || kb.matches(data, "tui.editor.deleteCharForward")) return true
	if (/^[0-9]$/.test(data)) return true
	if (data === ".") return !input?.getValue().includes(".")
	if (data === "+" || data === "-") {
		if (!input) return true
		return inputCursor(input) === 0 && !/[+-]/.test(input.getValue())
	}
	return data.length !== 1
}

function parseNumberInput(
	field: Extract<ScopedConfigField, { kind: "number" }>,
	value: string,
	options: { validateRange?: boolean } = {}
): NumberInputParseResult {
	const trimmed = value.trim()
	if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.")
		return { ok: false, message: `${field.label} must be a number` }

	const parsed = Number(trimmed)
	if (!Number.isFinite(parsed)) return { ok: false, message: `${field.label} must be a number` }
	if (options.validateRange === false) return { ok: true, value: parsed }
	if (field.min !== undefined && parsed < field.min) return { ok: false, message: `${field.label} must be at least ${field.min}` }
	if (field.max !== undefined && parsed > field.max) return { ok: false, message: `${field.label} must be at most ${field.max}` }
	return { ok: true, value: parsed }
}

function cycleField<Config extends object>(config: ConfigPatch<Config>, field: ScopedConfigField): ConfigPatch<Config> {
	const current = formatScopedValue(config, field)
	if (field.kind === "number") return setConfigValue(config, field.key, nextNumberValue(field, getConfigValue(config, field.key)))
	const options = field.kind === "enum" ? field.values : ["on", "off"]
	const next = nextOption(options, current)
	const persisted = field.kind === "boolean" ? next === "on" : next
	return setConfigValue(config, field.key, persisted)
}

function nextNumberValue(field: Extract<ScopedConfigField, { kind: "number" }>, value: unknown): number {
	if (field.values) return nextOption(field.values, typeof value === "number" ? value : field.default)
	const step = field.step ?? 1
	const current = typeof value === "number" ? value : field.default
	const next = roundToStepPrecision(current + step, step)
	if (field.max !== undefined && next > field.max) return current < field.max ? field.max : (field.min ?? field.default)
	return next
}

function roundToStepPrecision(value: number, step: number): number {
	const decimalPlaces = step.toString().split(".")[1]?.length ?? 0
	return Number(value.toFixed(decimalPlaces))
}

function nextOption<T>(options: readonly T[], value: T): T {
	const index = options.indexOf(value)
	return options[(index + 1) % options.length] ?? options[0] ?? value
}

function formatScopedValue(config: object, field: ScopedConfigField): string {
	const value = getConfigValue(config, field.key)
	return formatFieldValue(field, value)
}

function getValueDescription(config: object, field: ScopedConfigField): string | undefined {
	const rawValue = getConfigValue(config, field.key)
	if (rawValue === undefined) return undefined
	const value = formatFieldValue(field, rawValue)

	switch (field.kind) {
		case "enum":
		case "number":
			return field.valueDescriptions?.[value]
		case "boolean":
			return field.valueDescriptions?.[value as "on" | "off"]
		case "string":
			return undefined
	}
}

function formatFieldValue(field: ScopedConfigField, value: unknown): string {
	if (value === undefined) return "unset"
	if (field.kind === "boolean") return value ? "on" : "off"
	if (field.kind === "string") return JSON.stringify(String(value))
	if (field.kind === "number") return String(value)
	return String(value)
}

function getScopeNote<Config extends object>(
	scope: ConfigScope,
	scopes: readonly ConfigScope[],
	configs: ScopedConfigPatch<Config>,
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
