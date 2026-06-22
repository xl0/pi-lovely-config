import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent"
import { type TObject, type TSchema, Type } from "typebox"

export type ConfigScope = "user" | "workspace"
export type ConfigScopeMode = ConfigScope | "both"
export type ConfigPatch<Config extends object> = Partial<Config> & Record<string, unknown>
export type ScopedConfigPatch<Config extends object> = Record<ConfigScope, ConfigPatch<Config>>
export type ResolvedConfig<Config extends object> = { [Key in keyof Config]-?: NonNullable<Config[Key]> } & Record<string, unknown>
export type ConfigScopes = readonly [ConfigScope] | readonly ["user", "workspace"]
export type ConfigWarning = { key: string; message: string }
export type ScopedConfigWarning = ConfigWarning & { scope: ConfigScope; path: string }

type EnumValues = readonly [string, ...string[]]
type NumberValues = readonly [number, ...number[]]

export type VisibilityContext = {
	get(key: string): unknown
	getScoped(key: string, scope?: ConfigScope): unknown
	scope: ConfigScope
}

type BaseField = {
	key: string
	label: string
	description?: string
	kind: "enum" | "boolean" | "string" | "number"
	depth?: number
	visibleWhen?: (ctx: VisibilityContext) => boolean
}

export type EnumConfigField = BaseField & {
	kind: "enum"
	values: EnumValues
	valueDescriptions?: Record<string, string>
	default: string
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

export type ValuedNumberConfigField = BaseNumberConfigField & {
	values: NumberValues
	min?: never
	max?: never
	step?: never
}

export type NumberConfigField = RangedNumberConfigField | ValuedNumberConfigField

export type ScopedConfigField = EnumConfigField | BooleanConfigField | StringConfigField | NumberConfigField
export type ConfigFromFields<Fields extends readonly ScopedConfigField[]> = {
	[Field in Fields[number] as Field["key"]]: FieldValue<Field>
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
type ValidateEnumDefaults<Fields extends readonly ScopedConfigField[]> = {
	[Index in keyof Fields]: Fields[Index] extends {
		kind: "enum"
		values: infer Values extends readonly string[]
		default: infer Default extends string
	}
		? Default extends Values[number]
			? unknown
			: { enumDefaultMustBeOneOf: Values[number] }
		: unknown
}
type ValidateNumberDefaults<Fields extends readonly ScopedConfigField[]> = {
	[Index in keyof Fields]: Fields[Index] extends {
		kind: "number"
		values: infer Values extends readonly number[]
		default: infer Default extends number
	}
		? Default extends Values[number]
			? unknown
			: { numberDefaultMustBeOneOf: Values[number] }
		: unknown
}

export type ScopedConfigSpec<Config extends object> = {
	fileName: string
	scopes: ConfigScopes
	fields: readonly ScopedConfigField[]
	schema: TSchema
	defaults: ResolvedConfig<Config>
	get<Key extends keyof Config>(config: ConfigPatch<Config> | ResolvedConfig<Config>, key: Key): NonNullable<Config[Key]>
	getPath(scope: ConfigScope, cwd: string): string
	readFileOrEmpty(path: string): ConfigPatch<Config>
	saveFile(path: string, config: ConfigPatch<Config>): void
	deleteFile(path: string): void
	getWarnings(config: ConfigPatch<Config> | ResolvedConfig<Config>): ConfigWarning[]
	getScopedWarnings(scoped: ScopedConfigPatch<Config>, cwd: string): ScopedConfigWarning[]
	resolve(scoped: ScopedConfigPatch<Config>): ResolvedConfig<Config>
	loadScoped(cwd: string): ScopedConfigPatch<Config>
	load(cwd: string): ResolvedConfig<Config>
}

export class ScopedConfigState<Config extends object> {
	private scoped: ScopedConfigPatch<Config> = emptyScopedConfig()
	private resolved: ResolvedConfig<Config> = {} as ResolvedConfig<Config>

	constructor(readonly spec: ScopedConfigSpec<Config>) {
		this.resolved = spec.resolve(this.scoped)
	}

	loadScoped(cwd: string): ScopedConfigPatch<Config> {
		this.scoped = this.spec.loadScoped(cwd)
		this.resolved = this.spec.resolve(this.scoped)
		return this.scoped
	}

	load(cwd: string): ResolvedConfig<Config> {
		this.loadScoped(cwd)
		return this.resolved
	}

	setScoped(next: ScopedConfigPatch<Config>): ResolvedConfig<Config> {
		const resolved = this.spec.resolve(next)
		this.scoped = next
		this.resolved = resolved
		return this.resolved
	}

	reset(): ResolvedConfig<Config> {
		return this.setScoped(emptyScopedConfig())
	}

	getScoped(): ScopedConfigPatch<Config> {
		return this.scoped
	}

	getResolved(): ResolvedConfig<Config> {
		return this.resolved
	}

	get<Key extends keyof Config>(key: Key): NonNullable<Config[Key]> {
		return this.spec.get(this.resolved, key)
	}
}

export function createScopedConfigSchema(fields: readonly ScopedConfigField[]): TObject {
	validateFields(fields)
	const properties: Record<string, TSchema> = {}
	for (const field of fields) {
		properties[field.key] = Type.Optional(createFieldSchema(field))
	}
	return Type.Object(properties, { additionalProperties: true })
}

export function defineScopedConfigSpec<const Fields extends readonly ScopedConfigField[]>(options: {
	fileName: string
	scope?: ConfigScopeMode
	fields: Fields & ValidateEnumDefaults<Fields> & ValidateNumberDefaults<Fields>
}): ScopedConfigSpec<ConfigFromFields<Fields>> & {
	fields: Fields
	schema: TObject
} {
	type Config = ConfigFromFields<Fields>
	validateConfigFileName(options.fileName)
	const schema = createScopedConfigSchema(options.fields)
	const defaults = defaultConfig(options.fields) as ResolvedConfig<Config>
	const scopes = normalizeScopeMode(options.scope)

	function get<Key extends keyof Config>(config: ConfigPatch<Config> | ResolvedConfig<Config>, key: Key): NonNullable<Config[Key]> {
		const value = getConfigValue(config, String(key))
		return (value === undefined ? defaults[key] : value) as NonNullable<Config[Key]>
	}

	function getPath(scope: ConfigScope, cwd: string): string {
		return scope === "user" ? join(getAgentDir(), options.fileName) : resolve(cwd, CONFIG_DIR_NAME, options.fileName)
	}

	function readFileOrEmpty(path: string): ConfigPatch<Config> {
		if (!existsSync(path)) return {} as ConfigPatch<Config>
		const raw = readFileSync(path, "utf-8")
		try {
			return parseConfigPatch(JSON.parse(raw))
		} catch (error) {
			const message = formatConfigParseError(error)
			throw new Error(`Invalid config at ${path}: ${message}`)
		}
	}

	function saveFile(path: string, config: ConfigPatch<Config>): void {
		let parsed: ConfigPatch<Config>
		try {
			parsed = parseConfigPatch(config)
		} catch (error) {
			const message = formatConfigParseError(error)
			throw new Error(`Invalid config at ${path}: ${message}`)
		}
		if (Object.keys(parsed).length === 0) {
			deleteFile(path)
			return
		}
		mkdirSync(dirname(path), { recursive: true })
		writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8")
	}

	function deleteFile(path: string): void {
		rmSync(path, { force: true })
	}

	function getWarnings(config: ConfigPatch<Config> | ResolvedConfig<Config>): ConfigWarning[] {
		return getConfigWarnings(options.fields, config)
	}

	function getScopedWarnings(scoped: ScopedConfigPatch<Config>, cwd: string): ScopedConfigWarning[] {
		const warnings: ScopedConfigWarning[] = []
		for (const scope of scopes) {
			const path = getPath(scope, cwd)
			for (const warning of getWarnings(scoped[scope])) warnings.push({ ...warning, scope, path })
		}
		return warnings
	}

	function resolveScoped(scoped: ScopedConfigPatch<Config>): ResolvedConfig<Config> {
		let resolved = { ...defaults }
		for (const scope of scopes) {
			try {
				resolved = { ...resolved, ...createResolvingPatch(parseConfigPatch(scoped[scope])) }
			} catch (error) {
				const message = formatConfigParseError(error)
				throw new Error(`Invalid ${scope} config patch: ${message}`)
			}
		}
		return resolved as ResolvedConfig<Config>
	}

	function loadScoped(cwd: string): ScopedConfigPatch<Config> {
		const scoped = emptyScopedConfig<Config>()
		for (const scope of scopes) scoped[scope] = readFileOrEmpty(getPath(scope, cwd))
		return scoped
	}

	function load(cwd: string): ResolvedConfig<Config> {
		return resolveScoped(loadScoped(cwd))
	}

	function parseConfigPatch(value: unknown): ConfigPatch<Config> {
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be an object")
		const parsed = value as Record<string, unknown>
		const config: Record<string, unknown> = {}
		for (const [key, fieldValue] of Object.entries(parsed)) {
			if (fieldValue !== undefined) config[key] = fieldValue
		}
		for (const field of options.fields) {
			const fieldValue = config[field.key]
			if (fieldValue === undefined) continue
			validateConfigValue(field, fieldValue)
		}
		return config as ConfigPatch<Config>
	}

	function createResolvingPatch(config: ConfigPatch<Config>): ConfigPatch<Config> {
		const resolving = { ...(config as Record<string, unknown>) }
		for (const field of options.fields) {
			const fieldValue = resolving[field.key]
			if (fieldValue !== undefined && getConfigValueWarning(field, fieldValue)) delete resolving[field.key]
		}
		return resolving as ConfigPatch<Config>
	}

	return {
		fileName: options.fileName,
		scopes,
		fields: options.fields,
		schema,
		defaults,
		get,
		getPath,
		readFileOrEmpty,
		saveFile,
		deleteFile,
		getWarnings,
		getScopedWarnings,
		resolve: resolveScoped,
		loadScoped,
		load
	}
}

function emptyScopedConfig<Config extends object>(): ScopedConfigPatch<Config> {
	return { user: {}, workspace: {} }
}

function validateConfigFileName(fileName: string): void {
	if (!fileName || fileName === "." || fileName === ".." || isAbsolute(fileName) || fileName.includes("/") || fileName.includes("\\")) {
		throw new Error(`Invalid config file name: ${fileName}`)
	}
}

function normalizeScopeMode(scope: ConfigScopeMode | undefined): ConfigScopes {
	const mode = scope ?? "both"
	if (mode === "user") return ["user"] as const
	if (mode === "workspace") return ["workspace"] as const
	if (mode === "both") return ["user", "workspace"] as const
	throw new Error(`Invalid config scope mode: ${String(mode)}`)
}

function validateFields(fields: readonly ScopedConfigField[]): void {
	const keys = new Set<string>()
	for (const field of fields) {
		if (keys.has(field.key)) throw new Error(`Duplicate config field key: ${field.key}`)
		keys.add(field.key)
		if (field.depth !== undefined && (!Number.isInteger(field.depth) || field.depth < 0)) {
			throw new Error(`Config field ${field.key} depth must be a non-negative integer`)
		}

		if (field.kind !== "enum") continue
		if (field.values.length === 0) throw new Error(`Enum field ${field.key} must have at least one value`)
		if (!field.values.includes(field.default)) {
			throw new Error(`Enum field ${field.key} default must be one of: ${field.values.join(", ")}`)
		}
	}
	for (const field of fields) {
		if (field.kind !== "number") continue
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
			if (!field.values.includes(field.default)) {
				throw new Error(`Number field ${field.key} default must be one of: ${field.values.join(", ")}`)
			}
			continue
		}
		if (field.min !== undefined && !Number.isFinite(field.min)) throw new Error(`Number field ${field.key} min must be finite`)
		if (field.max !== undefined && !Number.isFinite(field.max)) throw new Error(`Number field ${field.key} max must be finite`)
		if (field.step !== undefined && (!Number.isFinite(field.step) || field.step <= 0)) {
			throw new Error(`Number field ${field.key} step must be a positive finite number`)
		}
		if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
			throw new Error(`Number field ${field.key} min must be less than or equal to max`)
		}
		if (field.min !== undefined && field.default < field.min) {
			throw new Error(`Number field ${field.key} default must be at least ${field.min}`)
		}
		if (field.max !== undefined && field.default > field.max) {
			throw new Error(`Number field ${field.key} default must be at most ${field.max}`)
		}
	}
}

function createFieldSchema(field: ScopedConfigField): TSchema {
	switch (field.kind) {
		case "enum":
			if (field.values.length === 0) throw new Error(`Enum field ${field.key} must have at least one value`)
			return Type.Union(field.values.map(value => Type.Literal(value)) as unknown as [TSchema, ...TSchema[]], { default: field.default })
		case "boolean":
			return Type.Boolean({ default: field.default })
		case "string":
			return Type.String({ default: field.default })
		case "number":
			if (field.values) {
				return Type.Union(field.values.map(value => Type.Literal(value)) as unknown as [TSchema, ...TSchema[]], { default: field.default })
			}
			return Type.Number({
				default: field.default,
				...(field.min === undefined ? {} : { minimum: field.min }),
				...(field.max === undefined ? {} : { maximum: field.max })
			})
	}
}

function validateConfigValue(field: ScopedConfigField, value: unknown): void {
	switch (field.kind) {
		case "enum":
			if (typeof value !== "string" || !field.values.includes(value)) {
				throw new Error(`/${field.key} must be one of: ${field.values.join(", ")}`)
			}
			return
		case "boolean":
			if (typeof value !== "boolean") throw new Error(`/${field.key} must be boolean`)
			return
		case "string":
			if (typeof value !== "string") throw new Error(`/${field.key} must be string`)
			return
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`/${field.key} must be number`)
			return
	}
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

function getConfigValueWarning(field: ScopedConfigField, value: unknown): string | undefined {
	if (field.kind !== "number" || typeof value !== "number" || !Number.isFinite(value)) return undefined
	if (field.values !== undefined && !field.values.includes(value)) {
		return `/${field.key} should be one of: ${field.values.join(", ")}; value is ignored while resolving`
	}
	if (field.min !== undefined && value < field.min) {
		return `/${field.key} should be at least ${field.min}; value is ignored while resolving`
	}
	if (field.max !== undefined && value > field.max) {
		return `/${field.key} should be at most ${field.max}; value is ignored while resolving`
	}
	return undefined
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
	const errors = error && typeof error === "object" ? (error as { errors?: unknown }).errors : undefined
	if (Array.isArray(errors) && errors.length > 0) return errors.map(formatSchemaError).join("; ")
	if (error instanceof Error && error.message) return error.message
	return String(error)
}

function formatSchemaError(error: unknown): string {
	if (!error || typeof error !== "object") return String(error)
	const { instancePath, message: errorMessage, keyword } = error as { instancePath?: unknown; message?: unknown; keyword?: unknown }
	const path = typeof instancePath === "string" && instancePath ? instancePath : "/"
	let message = String(error)
	if (typeof errorMessage === "string" && errorMessage) message = errorMessage
	else if (typeof keyword === "string") message = `failed ${keyword}`
	return `${path} ${message}`
}
