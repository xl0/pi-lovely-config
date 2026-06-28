import type { Theme } from "@earendil-works/pi-coding-agent"
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
import type { ConfigPatch, ConfigScope, ScopedConfig, ScopedConfigField, ScopedConfigPatch } from "./config"
import { getConfigWarnings } from "./config"

type RenderTui = { requestRender(): void }
type Keybindings = ReturnType<typeof getKeybindings>

type ScopedConfigChangeHandler<Config extends object> = (config: ScopedConfig<Config>) => void
type FocusPart = "include" | "value"
type NumberInputParseResult = { ok: true; value: number } | { ok: false; message: string }

export class ScopedConfigEditor<Config extends object> {
	private readonly tui: RenderTui
	private readonly theme: Theme
	private readonly config: ScopedConfig<Config>
	private readonly onChange: ScopedConfigChangeHandler<Config>
	private readonly fields: readonly ScopedConfigField[]
	private readonly scopes: readonly ConfigScope[]
	private readonly done: (result: undefined) => void
	private activeInput: Input | undefined
	private activeInputError: string | undefined
	private focusPart: FocusPart = "value"
	private currentTab = 0
	private currentRow = 0

	constructor(options: {
		tui: RenderTui
		theme: Theme
		config: ScopedConfig<Config>
		onChange: ScopedConfigChangeHandler<Config>
		done: (result: undefined) => void
	}) {
		this.tui = options.tui
		this.theme = options.theme
		this.config = options.config
		this.onChange = options.onChange
		this.fields = options.config.fields
		this.scopes = options.config.scopes
		this.done = options.done
		this.updateFocus()
	}

	private get scoped(): ScopedConfigPatch {
		return this.config.scoped
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
			this.theme.fg("dim", "Tab switch scope • ↑↓ select • ←→ include/value • Enter edit/cycle • Space toggle/step • Esc close")
		)
		lines.push(this.theme.fg("accent", "─".repeat(renderWidth)))

		return lines
	}

	invalidate() {}

	handleInput(data: string): void {
		const kb = getKeybindings()
		const isSpace = data === " " || matchesKey(data, Key.space) || matchesKey(data, Key.shift("space"))
		if (this.handleCloseKey(data, kb)) return
		if (this.handleNavigationKey(data, kb)) return
		if (this.handleActiveInput(data, kb)) return
		if (this.handleActivationKey(data, kb, isSpace)) return
	}

	private handleCloseKey(data: string, kb: Keybindings): boolean {
		if (matchesKey(data, Key.ctrl("c"))) {
			this.done(undefined)
			return true
		}
		if (this.activeInput && kb.matches(data, "tui.select.cancel")) {
			this.activeInput = undefined
			this.activeInputError = undefined
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
		if (this.activeInput && (kb.matches(data, "tui.editor.cursorLeft") || kb.matches(data, "tui.editor.cursorRight"))) return false
		if (kb.matches(data, "tui.editor.cursorRight")) {
			if (!this.selectedFieldIsSet()) return true
			this.focusPart = "value"
			this.tui.requestRender()
			return true
		}
		if (!kb.matches(data, "tui.editor.cursorLeft")) return false
		if (!this.commitActiveInput()) return true
		this.focusPart = "include"
		this.activeInput = undefined
		this.tui.requestRender()
		return true
	}

	private selectedFieldIsSet(): boolean {
		const field = this.selectedField()
		return !!field && getConfigValue(this.scoped[this.currentScope()], field.key) !== undefined
	}

	private handleActivationKey(data: string, kb: Keybindings, isSpace: boolean): boolean {
		if (kb.matches(data, "tui.input.submit")) {
			this.activateRow()
			return true
		}
		if (isSpace) {
			const field = this.selectedField()
			if (field && this.focusPart === "include") this.toggleField(this.currentScope(), field)
			else if (field?.kind === "number" && !field.values)
				this.saveValue(this.currentScope(), field, nextNumberValue(field, getConfigValue(this.scoped[this.currentScope()], field.key)))
			else if (field?.kind !== "string") this.activateRow()
			else if (this.isResetSelected()) this.reset(this.currentScope())
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

		const path = this.config.path(scope)
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
			const valueStyle = getFieldWarning(this.scoped[scope], field)
				? "warning"
				: !isSet
					? "muted"
					: selected && this.focusPart === "value"
						? "accent"
						: "text"
			const renderedValue = !isSet && note ? "" : ` ${this.theme.fg(valueStyle, value)}`
			addWrappedWithPrefix(lines, width, prefix, `${renderedInclude}${this.theme.fg("text", field.label)}${renderedValue}${renderedNote}`)
		}
		this.renderResetRow(lines, width, this.isResetSelected(fields))
	}

	private renderActiveValueDescription(lines: string[], width: number, scope: ConfigScope, fields: readonly ScopedConfigField[]): void {
		const field = this.selectedField(fields)
		const error = this.activeInput ? this.activeInputError : undefined
		const warning = field ? getFieldWarning(this.scoped[scope], field) : undefined
		const valueDescription = field ? getValueDescription(this.scoped[scope], field) : undefined
		lines.push("")
		if (error) addWrappedWithPrefix(lines, width, " ", this.theme.fg("error", error))
		else if (warning) addWrappedWithPrefix(lines, width, " ", this.theme.fg("warning", warning))
		else if (valueDescription) addWrappedWithPrefix(lines, width, " ", this.theme.fg("muted", valueDescription))
		else lines.push("")
	}

	private renderFieldValue(config: ConfigPatch, field: ScopedConfigField, selected: boolean, width: number): string {
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
		const scoped = { user: {}, workspace: {} } as ScopedConfigPatch
		for (const configScope of this.scopes) {
			scoped[configScope] = this.scoped[configScope]
			if (configScope === scope) break
		}
		return this.config.resolve(scoped)
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

	private rowCount(): number {
		return this.visibleFields().length + 1
	}

	private scopeIsUnset(scope: ConfigScope): boolean {
		return this.fields.every(field => getConfigValue(this.scoped[scope], field.key) === undefined)
	}

	private refresh(): void {
		this.currentRow = Math.min(this.currentRow, this.rowCount() - 1)
		this.updateFocus()
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
		else if (getConfigValue(this.scoped[scope], field.key) === undefined) this.saveValue(scope, field, field.default)
		else if (field.kind === "number" && field.values)
			this.saveValue(scope, field, nextNumberValue(field, getConfigValue(this.scoped[scope], field.key)))
		else if (fieldUsesInput(field)) this.startInput(field)
		else this.saveValue(scope, field, nextFieldValue(this.scoped[scope], field))
	}

	private toggleField(scope: ConfigScope, field: ScopedConfigField): void {
		const current = getConfigValue(this.scoped[scope], field.key)
		const nextIsSet = current === undefined
		this.activeInput = undefined
		this.saveValue(scope, field, nextIsSet ? field.default : undefined)
	}

	private startInput(field: ScopedConfigField, initial?: string): void {
		if (!fieldUsesInput(field)) return
		const value = initial ?? getConfigValue(this.scoped[this.currentScope()], field.key)
		const input = new Input()
		input.setValue(typeof value === "string" || typeof value === "number" ? String(value) : "")
		input.focused = true
		this.activeInput = input
		this.updateActiveInputError(field)
		this.tui.requestRender()
	}

	private handleActiveInput(data: string, kb: Keybindings): boolean {
		const field = this.selectedField()
		if (this.focusPart !== "value" || !field || !fieldUsesInput(field)) return false

		if (this.activeInput && kb.matches(data, "tui.input.submit")) {
			this.commitActiveInput()
			return true
		}

		if (this.activeInput) {
			if (field.kind === "number" && !isNumberInputAllowed(data, this.activeInput, kb)) return true
			this.activeInput.handleInput(data)
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
			this.activeInputError = undefined
			this.saveValue(this.currentScope(), field, parsed.value)
			return true
		}

		this.activeInput = undefined
		this.activeInputError = undefined
		this.saveValue(this.currentScope(), field, value)
		return true
	}

	private updateActiveInputError(field: ScopedConfigField): void {
		if (field.kind !== "number" || field.values || !this.activeInput) {
			this.activeInputError = undefined
			return
		}

		const parsed = parseNumberInput(field, this.activeInput.getValue())
		this.activeInputError = parsed.ok ? undefined : parsed.message
	}

	private saveValue(scope: ConfigScope, field: ScopedConfigField, value: unknown): void {
		this.activeInputError = undefined
		this.config.update(scope, field.key as keyof Config & string, value as Config[keyof Config & string] | undefined)
		this.onChange(this.config)
		this.refresh()
	}

	private reset(scope: ConfigScope): void {
		this.config.resetScope(scope)
		this.onChange(this.config)
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

function isFieldVisible(
	field: ScopedConfigField,
	scope: ConfigScope,
	configs: ScopedConfigPatch,
	resolved: Record<string, unknown>
): boolean {
	if (!field.visibleWhen) return true
	return field.visibleWhen({
		scope,
		get: key => resolved[key],
		getScoped: (key, targetScope = scope) => getConfigValue(configs[targetScope], key)
	})
}

function getConfigValue(config: object, key: string): unknown {
	return (config as Record<string, unknown>)[key]
}

function fieldUsesInput(field: ScopedConfigField): boolean {
	return field.kind === "string" || (field.kind === "number" && !field.values)
}

function renderInput(input: Input, width: number): string {
	const rendered = input.render(width + 2)[0]?.slice(2) ?? ""
	return rendered.trimEnd()
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

function parseNumberInput(field: Extract<ScopedConfigField, { kind: "number" }>, value: string): NumberInputParseResult {
	const trimmed = value.trim()
	if (trimmed === "") return { ok: false, message: `${field.label} must be a number` }

	const parsed = Number(trimmed)
	if (!Number.isFinite(parsed)) return { ok: false, message: `${field.label} must be a number` }
	if (field.values !== undefined && !field.values.includes(parsed)) {
		return { ok: false, message: `${field.label} must be one of: ${field.values.join(", ")}` }
	}
	if (field.min !== undefined && parsed < field.min) return { ok: false, message: `${field.label} must be at least ${field.min}` }
	if (field.max !== undefined && parsed > field.max) return { ok: false, message: `${field.label} must be at most ${field.max}` }
	return { ok: true, value: parsed }
}

function nextFieldValue(config: ConfigPatch, field: ScopedConfigField): unknown {
	const current = formatScopedValue(config, field)
	const options = field.kind === "enum" ? field.values : ["on", "off"]
	const next = nextOption(options, current)
	return field.kind === "boolean" ? next === "on" : next
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

function getFieldWarning(config: object, field: ScopedConfigField): string | undefined {
	return getConfigWarnings([field], config)[0]?.message
}

function getFieldValueWarning(field: ScopedConfigField, value: unknown): string | undefined {
	return getConfigWarnings([field], { [field.key]: value })[0]?.message
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

function getScopeNote(
	scope: ConfigScope,
	scopes: readonly ConfigScope[],
	configs: ScopedConfigPatch,
	field: ScopedConfigField
): string | undefined {
	const value = getConfigValue(configs[scope], field.key)
	const userValue = getConfigValue(configs.user, field.key)
	const workspaceValue = getConfigValue(configs.workspace, field.key)
	const user = userValue === undefined || getFieldValueWarning(field, userValue) ? undefined : formatFieldValue(field, userValue)
	const workspace =
		workspaceValue === undefined || getFieldValueWarning(field, workspaceValue) ? undefined : formatFieldValue(field, workspaceValue)
	const defaultValue = formatFieldValue(field, field.default)

	if (value !== undefined) {
		if (getFieldValueWarning(field, value)) return undefined
		return scope === "user" && scopes.includes("workspace") && workspace !== undefined ? `Workspace: ${workspace}` : undefined
	}

	if (scope === "user" && scopes.includes("workspace") && workspace !== undefined) return `Workspace: ${workspace}`
	if (scope === "workspace" && scopes.includes("user") && user !== undefined) return `User: ${user}`
	return `default: ${defaultValue}`
}

function scopeLabel(scope: ConfigScope): string {
	return `${scope[0]?.toUpperCase() ?? ""}${scope.slice(1)}`
}
