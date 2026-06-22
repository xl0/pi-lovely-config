import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent"
import { type TObject, type TSchema, Type } from "typebox"
import Schema from "typebox/schema"

export type ConfigScope = "user" | "workspace"
export type ScopedConfig<Config extends object> = Record<ConfigScope, Config>
export type ConfigScopes = readonly [ConfigScope, ...ConfigScope[]]

type EnumValues = readonly [string, ...string[]]

export type VisibilityContext = {
	get(key: string): unknown
	getScoped(key: string, scope?: ConfigScope): unknown
	scope: ConfigScope
}

type BaseField = {
	key: string
	label: string
	description?: string
	kind: "enum" | "boolean" | "string"
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

export type ScopedConfigField = EnumConfigField | BooleanConfigField | StringConfigField
export type ConfigFromFields<Fields extends readonly ScopedConfigField[]> = {
	[Field in Fields[number] as Field["key"]]?: FieldValue<Field>
}

export type ConfigDefaults<Config extends object> = { [Key in keyof Config]-?: NonNullable<Config[Key]> } & Record<string, unknown>
type FieldValue<Field> = Field extends { kind: "enum"; values: infer Values extends readonly string[] }
	? Values[number]
	: Field extends { kind: "boolean" }
		? boolean
		: Field extends { kind: "string" }
			? string
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

export type ScopedConfigSpec<Config extends object> = {
	fileName: string
	scopes: ConfigScopes
	fields: readonly ScopedConfigField[]
	schema: TSchema
	defaults: ConfigDefaults<Config>
	get<Key extends keyof Config>(config: Config, key: Key): NonNullable<Config[Key]>
	getPath(scope: ConfigScope, cwd: string): string
	readFileOrEmpty(path: string): Config
	writeFile(path: string, config: Config): void
	deleteFile(path: string): void
	merge(scoped: ScopedConfig<Config>): Config
	loadScoped(cwd: string): ScopedConfig<Config>
	load(cwd: string): Config
}

export class ScopedConfigState<Config extends object> {
	private effective: Config = {} as Config

	constructor(readonly spec: ScopedConfigSpec<Config>) {}

	load(cwd: string): Config {
		this.effective = this.spec.load(cwd)
		return this.effective
	}

	set(next: Config): Config {
		this.effective = next
		return this.effective
	}

	reset(): Config {
		this.effective = {} as Config
		return this.effective
	}

	get<Key extends keyof Config>(key: Key): NonNullable<Config[Key]> {
		return this.spec.get(this.effective, key)
	}
}

export function createScopedConfigSchema(fields: readonly ScopedConfigField[]): TObject {
	validateFields(fields)
	const properties: Record<string, TSchema> = {}
	for (const field of fields) {
		properties[field.key] = Type.Optional(createFieldSchema(field))
	}
	return Type.Object(properties)
}

export function defineScopedConfigSpec<const Fields extends readonly ScopedConfigField[]>(options: {
	fileName: string
	scopes?: ConfigScopes
	fields: Fields & ValidateEnumDefaults<Fields>
}): ScopedConfigSpec<ConfigFromFields<Fields>> & {
	fields: Fields
	schema: TObject
} {
	type Config = ConfigFromFields<Fields>
	const schema = createScopedConfigSchema(options.fields)
	const defaults = defaultConfig(options.fields) as ConfigDefaults<Config>
	const validator = Schema.Compile(schema)
	const scopes = options.scopes ?? (["user", "workspace"] as const)
	validateScopes(scopes)

	function get<Key extends keyof Config>(config: Config, key: Key): NonNullable<Config[Key]> {
		const value = getConfigValue(config, String(key))
		return (value === undefined ? defaults[key] : value) as NonNullable<Config[Key]>
	}

	function getPath(scope: ConfigScope, cwd: string): string {
		return scope === "user" ? join(getAgentDir(), options.fileName) : resolve(cwd, CONFIG_DIR_NAME, options.fileName)
	}

	function readFileOrEmpty(path: string): Config {
		if (!existsSync(path)) return {} as Config
		const raw = readFileSync(path, "utf-8")
		try {
			return validator.Parse(JSON.parse(raw)) as Config
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Invalid config at ${path}: ${message}`)
		}
	}

	function writeFile(path: string, config: Config): void {
		mkdirSync(dirname(path), { recursive: true })
		writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
	}

	function deleteFile(path: string): void {
		rmSync(path, { force: true })
	}

	function merge(scoped: ScopedConfig<Config>): Config {
		let merged = {} as Config
		for (const scope of scopes) merged = { ...merged, ...scoped[scope] }
		return merged
	}

	function loadScoped(cwd: string): ScopedConfig<Config> {
		const scoped = { user: {} as Config, workspace: {} as Config }
		for (const scope of scopes) scoped[scope] = readFileOrEmpty(getPath(scope, cwd))
		return scoped
	}

	function load(cwd: string): Config {
		return merge(loadScoped(cwd))
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
		writeFile,
		deleteFile,
		merge,
		loadScoped,
		load
	}
}

function validateScopes(scopes: ConfigScopes): void {
	const seen = new Set<ConfigScope>()
	for (const scope of scopes) {
		if (seen.has(scope)) throw new Error(`Duplicate config scope: ${scope}`)
		seen.add(scope)
	}
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
