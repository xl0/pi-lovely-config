import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path"
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent"

export type ConfigScope = "user" | "workspace"
export type ConfigScopeMode = ConfigScope | "both"
export type ConfigScopes = readonly [ConfigScope] | readonly ["user", "workspace"]
export type ConfigPatch = Record<string, unknown>
export type ScopedConfigPatch = Record<ConfigScope, ConfigPatch>
export type ResolvedConfig<Config extends object> = { [Key in keyof Config]-?: NonNullable<Config[Key]> }
export type ConfigWarning = { key: string; message: string }
export type ScopedConfigWarning = ConfigWarning & { scope: ConfigScope; path: string }

export type ConfigJsonSchema = {
	type: "object"
	properties: Record<
		string,
		{
			type: "string" | "boolean" | "number"
			default?: unknown
			description?: string
			enum?: unknown[]
			minimum?: number
			maximum?: number
		}
	>
	additionalProperties: true
}

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
	kind: "enum" | "boolean" | "string" | "number"
}

export type EnumConfigField<Values extends StringValues = StringValues> = BaseField & {
	kind: "enum"
	values: Values
	valueDescriptions?: Partial<Record<Values[number], string>> & Record<string, string>
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
export type ConfigField = EnumConfigField | BooleanConfigField | StringConfigField | NumberConfigField
export type ConfigSchema = Record<string, ConfigField>
export type ScopedConfigField = ConfigField & { key: string; label: string }

export type ConfigFromSchema<Schema extends ConfigSchema> = {
	[Key in keyof Schema]: FieldValue<Schema[Key]>
}

type FieldValue<Field> = Field extends { kind: "enum"; values: infer Values extends readonly string[] }
	? Values[number]
	: Field extends { kind: "boolean" }
		? boolean
		: Field extends { kind: "string" }
			? string
			: Field extends { kind: "number"; values: infer Values extends readonly number[] }
				? Values[number]
				: Field extends { kind: "number" }
					? number
					: never

export type LoadedConfig<Config extends object> = {
	value: ResolvedConfig<Config>
	scoped: ScopedConfigPatch
	warnings: ScopedConfigWarning[]
}

export type ScopedConfig<Config extends object> = {
	fileName: string
	scopes: ConfigScopes
	fields: readonly ScopedConfigField[]
	defaults: ResolvedConfig<Config>
	jsonSchema: ConfigJsonSchema
	path(scope: ConfigScope, cwd: string): string
	resolve(scoped: ScopedConfigPatch): ResolvedConfig<Config>
	load(cwd: string): LoadedConfig<Config>
	update<Key extends keyof Config & string>(
		cwd: string,
		change: { scope: ConfigScope; key: Key; value: Config[Key] | undefined }
	): LoadedConfig<Config>
	resetScope(cwd: string, scope: ConfigScope): LoadedConfig<Config>
}

type EnumFieldOptions<Values extends StringValues> = Omit<EnumConfigField<Values>, "kind" | "values" | "default">
type BooleanFieldOptions = Omit<BooleanConfigField, "kind" | "default">
type StringFieldOptions = Omit<StringConfigField, "kind" | "default">
type RangedNumberOptions = Omit<RangedNumberConfigField, "kind" | "default">
type ValuedNumberOptions<Values extends NumberValues> = Omit<ValuedNumberConfigField<Values>, "kind" | "default">

function enumField<const Values extends StringValues>(
	values: Values,
	defaultValue: Values[number],
	options: EnumFieldOptions<Values> = {}
): EnumConfigField<Values> {
	return { kind: "enum", values, default: defaultValue, ...options }
}

function booleanField(defaultValue: boolean, options: BooleanFieldOptions = {}): BooleanConfigField {
	return { kind: "boolean", default: defaultValue, ...options }
}

function stringField(defaultValue: string, options: StringFieldOptions = {}): StringConfigField {
	return { kind: "string", default: defaultValue, ...options }
}

function numberField<const Values extends NumberValues>(
	defaultValue: Values[number],
	options: ValuedNumberOptions<Values>
): ValuedNumberConfigField<Values>
function numberField(defaultValue: number, options?: RangedNumberOptions): RangedNumberConfigField
function numberField(defaultValue: number, options: RangedNumberOptions | ValuedNumberOptions<NumberValues> = {}): NumberConfigField {
	return { kind: "number", default: defaultValue, ...options } as NumberConfigField
}

export const field = {
	enum: enumField,
	boolean: booleanField,
	string: stringField,
	number: numberField
}

export function defineScopedConfig<const Schema extends ConfigSchema>(options: {
	fileName: string
	scope?: ConfigScopeMode
	schema: Schema
}): ScopedConfig<ConfigFromSchema<Schema>> {
	type Config = ConfigFromSchema<Schema>
	validateConfigFileName(options.fileName)
	const fields = normalizeFields(options.schema)
	validateFields(fields)
	const defaults = defaultConfig(fields) as ResolvedConfig<Config>
	const scopes = normalizeScopeMode(options.scope)
	const fieldByKey = new Map(fields.map(field => [field.key, field]))

	function path(scope: ConfigScope, cwd: string): string {
		return scope === "user" ? join(getAgentDir(), options.fileName) : resolvePath(cwd, CONFIG_DIR_NAME, options.fileName)
	}

	function resolve(scoped: ScopedConfigPatch): ResolvedConfig<Config> {
		const resolved: Record<string, unknown> = { ...defaults }
		for (const scope of scopes) {
			for (const field of fields) {
				const value = scoped[scope][field.key]
				if (value !== undefined && !getConfigValueWarning(field, value)) resolved[field.key] = value
			}
		}
		return resolved as ResolvedConfig<Config>
	}

	function load(cwd: string): LoadedConfig<Config> {
		const scoped = emptyScopedConfig()
		for (const scope of scopes) scoped[scope] = readConfigFile(path(scope, cwd))
		return { value: resolve(scoped), scoped, warnings: getScopedWarnings(fields, scoped, scopes, path, cwd) }
	}

	function update<Key extends keyof Config & string>(
		cwd: string,
		change: { scope: ConfigScope; key: Key; value: Config[Key] | undefined }
	): LoadedConfig<Config> {
		assertActiveScope(scopes, change.scope)
		const configField = fieldByKey.get(change.key)
		if (!configField) throw new Error(`Unknown config key: ${change.key}`)
		if (change.value !== undefined) validateUpdateValue(configField, change.value)

		const configPath = path(change.scope, cwd)
		const config = readConfigFile(configPath)
		if (change.value === undefined) delete config[change.key]
		else config[change.key] = change.value
		writeConfigFile(configPath, config)
		return load(cwd)
	}

	function resetScope(cwd: string, scope: ConfigScope): LoadedConfig<Config> {
		assertActiveScope(scopes, scope)
		const configPath = path(scope, cwd)
		const config = readConfigFile(configPath)
		for (const field of fields) delete config[field.key]
		writeConfigFile(configPath, config)
		return load(cwd)
	}

	return {
		fileName: options.fileName,
		scopes,
		fields,
		defaults,
		jsonSchema: createJsonSchema(fields),
		path,
		resolve,
		load,
		update,
		resetScope
	}
}

function normalizeFields(schema: ConfigSchema): ScopedConfigField[] {
	return Object.entries(schema).map(([key, field]) => ({ ...field, key, label: field.label ?? key }))
}

function emptyScopedConfig(): ScopedConfigPatch {
	return { user: {}, workspace: {} }
}

function validateConfigFileName(fileName: string): void {
	if (!fileName || fileName === "." || fileName === ".." || isAbsolute(fileName) || fileName.includes("/") || fileName.includes("\\")) {
		throw new Error(`Invalid config file name: ${fileName}`)
	}
}

function normalizeScopeMode(scope: ConfigScopeMode | undefined): ConfigScopes {
	const mode = scope ?? "both"
	if (mode === "user") return ["user"]
	if (mode === "workspace") return ["workspace"]
	if (mode === "both") return ["user", "workspace"]
	throw new Error(`Invalid config scope mode: ${String(mode)}`)
}

function assertActiveScope(scopes: ConfigScopes, scope: ConfigScope): void {
	if (!scopes.includes(scope)) throw new Error(`Config scope is not active: ${scope}`)
}

function validateFields(fields: readonly ScopedConfigField[]): void {
	const keys = new Set<string>()
	for (const field of fields) {
		if (!field.key) throw new Error("Config field key must not be empty")
		if (keys.has(field.key)) throw new Error(`Duplicate config field key: ${field.key}`)
		keys.add(field.key)
		if (field.depth !== undefined && (!Number.isInteger(field.depth) || field.depth < 0)) {
			throw new Error(`Config field ${field.key} depth must be a non-negative integer`)
		}

		if (field.kind === "enum") {
			if (field.values.length === 0) throw new Error(`Enum field ${field.key} must have at least one value`)
			if (!field.values.includes(field.default))
				throw new Error(`Enum field ${field.key} default must be one of: ${field.values.join(", ")}`)
		}
		if (field.kind === "number") validateNumberField(field)
	}
}

function validateNumberField(field: NumberConfigField & { key: string }): void {
	const rawRangeOptions = field as { min?: number; max?: number; step?: number }
	if (
		field.values !== undefined &&
		(rawRangeOptions.min !== undefined || rawRangeOptions.max !== undefined || rawRangeOptions.step !== undefined)
	) {
		throw new Error(`Number field ${field.key} cannot combine values with min, max, or step`)
	}
	if (!Number.isFinite(field.default)) throw new Error(`Number field ${field.key} default must be finite`)
	if (field.values !== undefined) {
		if (field.values.length === 0) throw new Error(`Number field ${field.key} values must have at least one value`)
		for (const value of field.values) {
			if (!Number.isFinite(value)) throw new Error(`Number field ${field.key} values must be finite`)
		}
		if (!field.values.includes(field.default))
			throw new Error(`Number field ${field.key} default must be one of: ${field.values.join(", ")}`)
		return
	}
	if (field.min !== undefined && !Number.isFinite(field.min)) throw new Error(`Number field ${field.key} min must be finite`)
	if (field.max !== undefined && !Number.isFinite(field.max)) throw new Error(`Number field ${field.key} max must be finite`)
	if (field.step !== undefined && (!Number.isFinite(field.step) || field.step <= 0)) {
		throw new Error(`Number field ${field.key} step must be a positive finite number`)
	}
	if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
		throw new Error(`Number field ${field.key} min must be less than or equal to max`)
	}
	if (field.min !== undefined && field.default < field.min)
		throw new Error(`Number field ${field.key} default must be at least ${field.min}`)
	if (field.max !== undefined && field.default > field.max)
		throw new Error(`Number field ${field.key} default must be at most ${field.max}`)
}

function createJsonSchema(fields: readonly ScopedConfigField[]): ConfigJsonSchema {
	const properties: ConfigJsonSchema["properties"] = {}
	for (const field of fields) {
		properties[field.key] = {
			type: field.kind === "enum" ? "string" : field.kind,
			default: field.default,
			...(field.description === undefined ? {} : { description: field.description }),
			...(field.kind === "enum" || (field.kind === "number" && field.values) ? { enum: [...field.values] } : {}),
			...(field.kind === "number" && field.min !== undefined ? { minimum: field.min } : {}),
			...(field.kind === "number" && field.max !== undefined ? { maximum: field.max } : {})
		}
	}
	return { type: "object", properties, additionalProperties: true }
}

function readConfigFile(path: string): ConfigPatch {
	if (!existsSync(path)) return {}
	try {
		return parseConfigPatch(JSON.parse(readFileSync(path, "utf-8")))
	} catch (error) {
		throw new Error(`Invalid config at ${path}: ${formatConfigParseError(error)}`)
	}
}

function parseConfigPatch(value: unknown): ConfigPatch {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be an object")
	const config: ConfigPatch = {}
	for (const [key, fieldValue] of Object.entries(value)) {
		if (fieldValue !== undefined) config[key] = fieldValue
	}
	return config
}

function writeConfigFile(path: string, config: ConfigPatch): void {
	if (Object.keys(config).length === 0) {
		rmSync(path, { force: true })
		return
	}
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
}

function validateUpdateValue(field: ScopedConfigField, value: unknown): void {
	const warning = getConfigValueWarning(field, value)
	if (warning) throw new Error(warning.replace("; value is ignored while resolving", ""))
}

export function getConfigWarnings(fields: readonly ScopedConfigField[], config: object): ConfigWarning[] {
	const warnings: ConfigWarning[] = []
	for (const field of fields) {
		const value = getConfigValue(config, field.key)
		if (value === undefined) continue
		const message = getConfigValueWarning(field, value)
		if (message) warnings.push({ key: field.key, message })
	}
	return warnings
}

function getScopedWarnings(
	fields: readonly ScopedConfigField[],
	scoped: ScopedConfigPatch,
	scopes: ConfigScopes,
	path: (scope: ConfigScope, cwd: string) => string,
	cwd: string
): ScopedConfigWarning[] {
	const warnings: ScopedConfigWarning[] = []
	for (const scope of scopes) {
		for (const warning of getConfigWarnings(fields, scoped[scope])) warnings.push({ ...warning, scope, path: path(scope, cwd) })
	}
	return warnings
}

function getConfigValueWarning(field: ScopedConfigField, value: unknown): string | undefined {
	switch (field.kind) {
		case "enum":
			if (typeof value !== "string") return `/${field.key} must be string; value is ignored while resolving`
			if (!field.values.includes(value))
				return `/${field.key} should be one of: ${field.values.join(", ")}; value is ignored while resolving`
			return undefined
		case "boolean":
			return typeof value === "boolean" ? undefined : `/${field.key} must be boolean; value is ignored while resolving`
		case "string":
			return typeof value === "string" ? undefined : `/${field.key} must be string; value is ignored while resolving`
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) return `/${field.key} must be number; value is ignored while resolving`
			if (field.values !== undefined && !field.values.includes(value)) {
				return `/${field.key} should be one of: ${field.values.join(", ")}; value is ignored while resolving`
			}
			if (field.min !== undefined && value < field.min)
				return `/${field.key} should be at least ${field.min}; value is ignored while resolving`
			if (field.max !== undefined && value > field.max)
				return `/${field.key} should be at most ${field.max}; value is ignored while resolving`
			return undefined
	}
}

function defaultConfig(fields: readonly ScopedConfigField[]): Record<string, unknown> {
	const defaults: Record<string, unknown> = {}
	for (const field of fields) defaults[field.key] ??= field.default
	return defaults
}

export function getConfigValue(config: object, key: string): unknown {
	return (config as Record<string, unknown>)[key]
}

function formatConfigParseError(error: unknown): string {
	if (error instanceof Error && error.message) return error.message
	return String(error)
}
