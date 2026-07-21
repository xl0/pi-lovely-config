import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve as resolvePath } from "node:path"
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent"

export type ConfigScope = "user" | "workspace"
export type ConfigPatch = Record<string, unknown>
export type ScopedConfigPatch = Record<ConfigScope, ConfigPatch>
export type ResolvedConfig<Config extends object> = { [Key in keyof Config]-?: NonNullable<Config[Key]> }
export type ConfigWarning = { key?: string; message: string }
export type ScopedConfigWarning = ConfigWarning & { scope: ConfigScope; path: string }

type StringValues = readonly [string, ...string[]]
type NumberValues = readonly [number, ...number[]]

export type VisibilityContext = {
	get(key: string): unknown
	getScoped(key: string, scope?: ConfigScope): unknown
	scope: ConfigScope
}

type FieldMeta = {
	label?: string
	description?: string
	depth?: number
	visibleWhen?: (ctx: VisibilityContext) => boolean
}

type BaseField = FieldMeta & {
	kind: "enum" | "boolean" | "string" | "text" | "number"
}

export type EnumConfigField<Values extends StringValues = StringValues> = BaseField & {
	kind: "enum"
	values: Values
	valueDescriptions?: Partial<Record<Values[number], string>> & Record<string, string>
	search?: boolean
	default: Values[number]
}

export type BooleanConfigField = BaseField & {
	kind: "boolean"
	valueDescriptions?: Partial<Record<"on" | "off", string>>
	default: boolean
}

export type StringConfigField = BaseField & {
	kind: "string"
	default: string
}

export type TextConfigField = BaseField & {
	kind: "text"
	default: string
}

type BaseNumberConfigField = BaseField & {
	kind: "number"
	default: number
	valueDescriptions?: Record<string, string>
}

export type RangedNumberConfigField = BaseNumberConfigField & {
	min?: number
	max?: number
	step?: number
	values?: never
}

export type ValuedNumberConfigField<Values extends NumberValues = NumberValues> = BaseNumberConfigField & {
	values: Values
	default: Values[number]
	min?: never
	max?: never
	step?: never
}

export type NumberConfigField = RangedNumberConfigField | ValuedNumberConfigField
export type ConfigField = EnumConfigField | BooleanConfigField | StringConfigField | TextConfigField | NumberConfigField
export type ConfigSchema = Record<string, ConfigField>
export type ScopedConfigField = ConfigField & { key: string; label: string }

export type ConfigFromSchema<Schema extends ConfigSchema> = {
	[Key in keyof Schema]: FieldValue<Schema[Key]>
}

type FieldValue<Field> = Field extends { kind: "enum"; values: infer Values extends readonly string[] }
	? Values[number]
	: Field extends { kind: "boolean" }
		? boolean
		: Field extends { kind: "string" | "text" }
			? string
			: Field extends { kind: "number"; values: infer Values extends readonly number[] }
				? Values[number]
				: Field extends { kind: "number" }
					? number
					: never

export type ScopedConfig<Config extends object> = {
	fileName: string
	scopes: readonly ConfigScope[]
	fields: readonly ScopedConfigField[]
	defaults: ResolvedConfig<Config>
	cwd: string | undefined
	value: ResolvedConfig<Config>
	scoped: ScopedConfigPatch
	warnings: ScopedConfigWarning[]
	path(scope: ConfigScope, cwd?: string): string
	resolve(scoped?: ScopedConfigPatch): ResolvedConfig<Config>
	load(cwd: string): ScopedConfig<Config>
	update<Key extends keyof Config & string>(scope: ConfigScope, key: Key, value: Config[Key] | undefined): ScopedConfig<Config>
	resetScope(scope: ConfigScope): ScopedConfig<Config>
}

type EnumFieldOptions<Values extends StringValues> = Omit<EnumConfigField<Values>, "kind" | "values" | "default">
type BooleanFieldOptions = Omit<BooleanConfigField, "kind" | "default">
type StringFieldOptions = Omit<StringConfigField, "kind" | "default">
type TextFieldOptions = Omit<TextConfigField, "kind" | "default">
type RangedNumberOptions = Omit<RangedNumberConfigField, "kind" | "default">
type ValuedNumberOptions<Values extends NumberValues> = Omit<ValuedNumberConfigField<Values>, "kind" | "default">

function enumField<const Values extends StringValues>(
	values: Values,
	defaultValue: Values[number],
	options: EnumFieldOptions<Values> = {}
): EnumConfigField<Values> {
	if (values.length === 0) throw new Error("Enum field must have at least one value")
	if (!values.includes(defaultValue)) throw new Error(`Enum field default must be one of: ${values.join(", ")}`)
	return { kind: "enum", values, default: defaultValue, ...options }
}

function booleanField(defaultValue: boolean, options: BooleanFieldOptions = {}): BooleanConfigField {
	return { kind: "boolean", default: defaultValue, ...options }
}

function stringField(defaultValue: string, options: StringFieldOptions = {}): StringConfigField {
	if (/[\r\n]/.test(defaultValue)) throw new Error("String field default must be single-line")
	return { kind: "string", default: defaultValue, ...options }
}

function textField(defaultValue: string, options: TextFieldOptions = {}): TextConfigField {
	return { kind: "text", default: defaultValue, ...options }
}

function numberField<const Values extends NumberValues>(
	defaultValue: Values[number],
	options: ValuedNumberOptions<Values>
): ValuedNumberConfigField<Values>
function numberField(defaultValue: number, options?: RangedNumberOptions): RangedNumberConfigField
function numberField(defaultValue: number, options: RangedNumberOptions | ValuedNumberOptions<NumberValues> = {}): NumberConfigField {
	const rawRangeOptions = options as { min?: number; max?: number; step?: number }
	if (
		options.values !== undefined &&
		(rawRangeOptions.min !== undefined || rawRangeOptions.max !== undefined || rawRangeOptions.step !== undefined)
	) {
		throw new Error("Number field cannot combine values with min, max, or step")
	}
	if (!Number.isFinite(defaultValue)) throw new Error("Number field default must be finite")
	if (options.values !== undefined) {
		if (options.values.length === 0) throw new Error("Number field values must have at least one value")
		for (const value of options.values) {
			if (!Number.isFinite(value)) throw new Error("Number field values must be finite")
		}
		if (!options.values.includes(defaultValue)) throw new Error(`Number field default must be one of: ${options.values.join(", ")}`)
	} else {
		if (options.min !== undefined && !Number.isFinite(options.min)) throw new Error("Number field min must be finite")
		if (options.max !== undefined && !Number.isFinite(options.max)) throw new Error("Number field max must be finite")
		if (options.step !== undefined && (!Number.isFinite(options.step) || options.step <= 0)) {
			throw new Error("Number field step must be a positive finite number")
		}
		if (options.min !== undefined && options.max !== undefined && options.min > options.max) {
			throw new Error("Number field min must be less than or equal to max")
		}
		if (options.min !== undefined && defaultValue < options.min) throw new Error(`Number field default must be at least ${options.min}`)
		if (options.max !== undefined && defaultValue > options.max) throw new Error(`Number field default must be at most ${options.max}`)
	}
	return { kind: "number", default: defaultValue, ...options } as NumberConfigField
}

export const field = {
	enum: enumField,
	boolean: booleanField,
	string: stringField,
	text: textField,
	number: numberField
}

export function defineScopedConfig<const Schema extends ConfigSchema>(options: {
	fileName: string
	scope?: ConfigScope
	schema: Schema
}): ScopedConfig<ConfigFromSchema<Schema>> {
	type Config = ConfigFromSchema<Schema>
	if (!/^[A-Za-z0-9._-]+$/.test(options.fileName) || options.fileName === "." || options.fileName === "..") {
		throw new Error(`Invalid config file name: ${options.fileName}`)
	}

	const fields = Object.entries(options.schema).map(([key, field]) => ({ ...field, key, label: field.label ?? key }))
	const defaults = Object.fromEntries(fields.map(field => [field.key, field.default]))

	return new ScopedConfigImpl<Config>(
		options.fileName,
		options.scope === undefined ? ["user", "workspace"] : [options.scope],
		fields,
		defaults as ResolvedConfig<Config>
	)
}

class ScopedConfigImpl<Config extends object> implements ScopedConfig<Config> {
	readonly #fieldByKey: Map<string, ScopedConfigField>
	cwd: string | undefined
	value: ResolvedConfig<Config>
	scoped: ScopedConfigPatch = { user: {}, workspace: {} }
	warnings: ScopedConfigWarning[] = []

	constructor(
		readonly fileName: string,
		readonly scopes: readonly ConfigScope[],
		readonly fields: readonly ScopedConfigField[],
		readonly defaults: ResolvedConfig<Config>
	) {
		this.#fieldByKey = new Map(fields.map(field => [field.key, field]))
		this.value = { ...defaults }
	}

	path(scope: ConfigScope, cwd?: string): string {
		return scope === "user" ? join(getAgentDir(), this.fileName) : resolvePath(cwd ?? this.currentCwd(), CONFIG_DIR_NAME, this.fileName)
	}

	resolve(scoped: ScopedConfigPatch = this.scoped): ResolvedConfig<Config> {
		const resolved: Record<string, unknown> = { ...this.defaults }
		for (const scope of this.scopes) {
			for (const field of this.fields) {
				const value = scoped[scope][field.key]
				if (value !== undefined && !getConfigValueWarning(field, value)) resolved[field.key] = value
			}
		}
		return resolved as ResolvedConfig<Config>
	}

	load(cwd: string): ScopedConfig<Config> {
		const scoped: ScopedConfigPatch = { user: {}, workspace: {} }
		const warnings: ScopedConfigWarning[] = []
		for (const scope of this.scopes) {
			const path = this.path(scope, cwd)
			const result = readConfigFile(path)
			scoped[scope] = result.config
			if (result.warning) warnings.push({ message: result.warning, scope, path })
		}
		this.cwd = cwd
		this.scoped = scoped
		this.value = this.resolve(scoped)
		this.warnings = warnings
		for (const scope of this.scopes) {
			for (const warning of getConfigWarnings(this.fields, scoped[scope])) {
				this.warnings.push({ ...warning, scope, path: this.path(scope, cwd) })
			}
		}
		return this
	}

	update<Key extends keyof Config & string>(scope: ConfigScope, key: Key, value: Config[Key] | undefined): ScopedConfig<Config> {
		if (!this.scopes.includes(scope)) throw new Error(`Config scope is not active: ${scope}`)
		const field = this.#fieldByKey.get(key)
		if (!field) throw new Error(`Unknown config key: ${key}`)
		if (value !== undefined) {
			const warning = getConfigValueWarning(field, value)
			if (warning) throw new Error(warning)
		}

		const cwd = this.currentCwd()
		const configPath = this.path(scope)
		// Patch existing file instead of writing only known schema keys.
		// Unknown keys belong to newer app versions and must survive old versions.
		const patch = readConfigFile(configPath).config
		if (value === undefined) delete patch[key]
		else patch[key] = value
		writeConfigFile(configPath, patch)
		return this.load(cwd)
	}

	resetScope(scope: ConfigScope): ScopedConfig<Config> {
		if (!this.scopes.includes(scope)) throw new Error(`Config scope is not active: ${scope}`)
		const cwd = this.currentCwd()
		const configPath = this.path(scope)
		const patch = readConfigFile(configPath).config
		for (const field of this.fields) delete patch[field.key]
		writeConfigFile(configPath, patch)
		return this.load(cwd)
	}

	private currentCwd(): string {
		if (!this.cwd) throw new Error("Config must be loaded before this operation")
		return this.cwd
	}
}

function readConfigFile(path: string): { config: ConfigPatch; warning?: string } {
	if (!existsSync(path)) return { config: {} }
	const source = readFileSync(path, "utf-8")
	let value: unknown
	try {
		value = JSON.parse(source)
	} catch (error) {
		const message = error instanceof Error && error.message ? error.message : String(error)
		return { config: {}, warning: `Invalid config: ${message}; file is ignored` }
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { config: {}, warning: "Invalid config: must be an object; file is ignored" }
	}
	const config: ConfigPatch = {}
	for (const [key, fieldValue] of Object.entries(value)) {
		if (fieldValue !== undefined) config[key] = fieldValue
	}
	return { config }
}

function writeConfigFile(path: string, config: ConfigPatch): void {
	if (Object.keys(config).length === 0) {
		rmSync(path, { force: true })
		return
	}
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
}

export function getConfigWarnings(fields: readonly ScopedConfigField[], config: object): ConfigWarning[] {
	const warnings: ConfigWarning[] = []
	for (const field of fields) {
		const value = (config as Record<string, unknown>)[field.key]
		if (value === undefined) continue
		const message = getConfigValueWarning(field, value)
		if (message) warnings.push({ key: field.key, message: `${message}; value is ignored while resolving` })
	}
	return warnings
}

function getConfigValueWarning(field: ScopedConfigField, value: unknown): string | undefined {
	switch (field.kind) {
		case "enum":
			if (typeof value !== "string") return `/${field.key} must be string`
			if (!field.values.includes(value)) return `/${field.key} should be one of: ${field.values.join(", ")}`
			return undefined
		case "boolean":
			return typeof value === "boolean" ? undefined : `/${field.key} must be boolean`
		case "string":
			if (typeof value !== "string") return `/${field.key} must be string`
			return /[\r\n]/.test(value) ? `/${field.key} must be single-line string` : undefined
		case "text":
			return typeof value === "string" ? undefined : `/${field.key} must be string`
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) return `/${field.key} must be number`
			if (field.values !== undefined && !field.values.includes(value)) {
				return `/${field.key} should be one of: ${field.values.join(", ")}`
			}
			if (field.min !== undefined && value < field.min) return `/${field.key} should be at least ${field.min}`
			if (field.max !== undefined && value > field.max) return `/${field.key} should be at most ${field.max}`
			return undefined
	}
}
