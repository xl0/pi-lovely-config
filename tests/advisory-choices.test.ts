import { afterEach, beforeEach, expect, expectTypeOf, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Theme } from "@earendil-works/pi-coding-agent"
import type { TUI } from "@earendil-works/pi-tui"
import { type ConfigFromSchema, defineScopedConfig, field, type ScopedConfig, ScopedConfigEditor } from "../src"

let cwd: string
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "lovely-config-"))
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

function load<Config extends object>(config: ScopedConfig<Config>, value: unknown) {
	const path = config.path("workspace", cwd)
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, JSON.stringify(value))
	return config.load(cwd)
}

function editor<Config extends object>(config: ScopedConfig<Config>) {
	return new ScopedConfigEditor({
		config,
		tui: { requestRender() {} } as TUI,
		theme: {
			fg: (color: string, text: string) => (color === "warning" ? `\x1b[33m${text}\x1b[39m` : text),
			bg: (_color: string, text: string) => text,
			bold: (text: string) => text
		} as Theme,
		onChange() {},
		done() {}
	})
}

test("only advisory enum values widen; defaults still require listed choices", () => {
	const schema = {
		strict: field.enum(["a", "b"], "a"),
		strictMany: field.multiEnum(["a", "b"], [], { choices: "strict" }),
		advisory: field.enum(["a", "b"], "a", { choices: "advisory" }),
		advisoryMany: field.multiEnum(["a", "b"], [], { choices: "advisory" }),
		number: field.number(1, { values: [1, 2] }),
		raw: { kind: "enum", values: ["a", "b"], default: "a" }
	} as const
	type Config = ConfigFromSchema<typeof schema>
	expectTypeOf<Config["strict"]>().toEqualTypeOf<"a" | "b">()
	expectTypeOf<Config["strictMany"]>().toEqualTypeOf<readonly ("a" | "b")[]>()
	expectTypeOf<Config["advisory"]>().toEqualTypeOf<string>()
	expectTypeOf<Config["advisoryMany"]>().toEqualTypeOf<readonly string[]>()
	expectTypeOf<Config["number"]>().toEqualTypeOf<1 | 2>()
	expectTypeOf<Config["raw"]>().toEqualTypeOf<"a" | "b">()
	const options = {} as { choices?: "strict" | "advisory" }
	const dynamic = { value: field.enum(["a"], "a", options) }
	expectTypeOf<ConfigFromSchema<typeof dynamic>["value"]>().toEqualTypeOf<string>()
	const inline = defineScopedConfig({
		fileName: "choices.json",
		schema: { one: field.enum(["a", "b"], "a"), many: field.multiEnum(["a", "b"], []) }
	})
	expectTypeOf(inline.value.one).toEqualTypeOf<"a" | "b">()
	expectTypeOf(inline.value.many).toEqualTypeOf<readonly ("a" | "b")[]>()

	expect(() => field.enum(["a"], "removed" as "a", { choices: "advisory" })).toThrow("unavailable choice")
	expect(() => field.multiEnum(["a"], ["removed" as "a"], { choices: "advisory" })).toThrow("unavailable choice")
})

test("load and update retain advisory choices, but strict choices fall back and reject writes", () => {
	const config = defineScopedConfig({
		fileName: "choices.json",
		scope: "workspace",
		schema: {
			model: field.enum(["known"], "known", { choices: "advisory" }),
			models: field.multiEnum(["known"], [], { choices: "advisory" }),
			strict: field.multiEnum(["known"], ["known"])
		}
	})
	const models = ["removed", "known"]
	load(config, { model: "removed", models, strict: models, unknown: true })
	expect(config.value).toEqual({ model: "removed", models, strict: ["known"] })
	expect(config.scoped.workspace).toMatchObject({ strict: models })
	expect(config.warnings.map(({ key, action }) => ({ key, action }))).toEqual([
		{ key: "model", action: "retained" },
		{ key: "models", action: "retained" },
		{ key: "strict", action: "ignored" }
	])
	expect(config.warnings[1]).toMatchObject({
		scope: "workspace",
		path: config.path("workspace"),
		message: '/models unavailable choice: "removed"; value is retained while resolving'
	})

	config.update("workspace", "model", "another-unavailable")
	config.update("workspace", "models", ["known", "another-unavailable"])
	expect(config.value.models).toEqual(["known", "another-unavailable"])
	expect(JSON.parse(readFileSync(config.path("workspace"), "utf8"))).toMatchObject({
		model: "another-unavailable",
		models: ["known", "another-unavailable"],
		strict: models,
		unknown: true
	})
	// @ts-expect-error Strict enums also reject unknown choices at compile time.
	expect(() => config.update("workspace", "strict", ["removed"])).toThrow("unavailable choice")
	config.update("workspace", "models", [])
	expect(config.warnings.some(warning => warning.key === "models")).toBe(false)
})

test("advisory values keep normal whole-field scope precedence", () => {
	const config = defineScopedConfig({
		fileName: "choices.json",
		schema: {
			models: field.multiEnum(["known"], [], { choices: "advisory" }),
			strict: field.multiEnum(["known"], [])
		}
	})
	expect(
		config.resolve({
			user: { models: ["known"], strict: ["known"] },
			workspace: { models: ["removed"], strict: ["removed"] }
		})
	).toEqual({ models: ["removed"], strict: ["known"] })
	expect(config.resolve({ user: { models: ["removed"] }, workspace: { models: [] } }).models).toEqual([])
})

test("advisory fields still reject wrong types; number constraints stay strict", () => {
	const config = defineScopedConfig({
		fileName: "choices.json",
		scope: "workspace",
		schema: {
			model: field.enum(["known"], "known", { choices: "advisory" }),
			models: field.multiEnum(["known"], [], { choices: "advisory" }),
			range: field.number(5, { min: 0, max: 10 }),
			discrete: field.number(1, { values: [1, 2] })
		}
	})
	load(config, { model: 42, models: ["removed", 42], range: 11, discrete: 3 })
	expect(config.value).toEqual(config.defaults)
	expect(config.warnings.every(warning => warning.action === "ignored")).toBe(true)
	// @ts-expect-error Exercise runtime validation of untyped callers.
	expect(() => config.update("workspace", "models", ["known", 42])).toThrow("array of strings")
	expect(() => config.update("workspace", "models", new Array<string>(1))).toThrow("array of strings")
	expect(() => config.update("workspace", "range", -1)).toThrow("at least 0")
	expect(() => config.update("workspace", "range", Number.NaN)).toThrow("finite number")
	expect(config.resolve({ user: {}, workspace: { models: null, model: [], range: Infinity } })).toEqual(config.defaults)
})

test("choice warnings show up to three complete values rather than the allowed catalog", () => {
	const config = defineScopedConfig({
		fileName: "choices.json",
		scope: "workspace",
		schema: {
			models: field.multiEnum(["known", ...Array.from({ length: 100 }, (_, i) => `allowed-${i}`)], [], { choices: "advisory" })
		}
	})
	const values = ["missing\nmodel", "x".repeat(1000), "third", "fourth", "fifth"]
	load(config, { models: values })
	const message = config.warnings[0]?.message ?? ""
	expect(message).toContain('"missing\\nmodel"')
	expect(message).toContain("(+2 more)")
	expect(message).not.toContain("allowed-")
	expect(message).toContain(JSON.stringify("x".repeat(1000)))
	expect(message).not.toContain("fourth")
	expect(message).not.toContain("fifth")
	expect(config.value.models).toEqual(values)
	load(config, [])
	expect(config.warnings[0]).toMatchObject({ action: "ignored" })
})

test("multi-enum picker preserves, searches, removes, and rechecks unavailable choices", () => {
	const config = load(
		defineScopedConfig({
			fileName: "choices.json",
			scope: "workspace",
			schema: { models: field.multiEnum(["known"], [], { choices: "advisory" }) }
		}),
		{ models: ["known", "removed"] }
	)
	const ui = editor(config)
	ui.handleInput("\r")
	expect(ui.render(100).join("\n")).toContain("\x1b[33m✗ \x1b[39m\x1b[33mremoved\x1b[39m")
	ui.handleInput("\r")
	expect(config.value.models).toEqual(["known", "removed"])

	ui.handleInput("\r")
	ui.handleInput("removed")
	ui.handleInput(" ")
	expect(ui.render(100).join("\n")).toContain("\x1b[33mremoved\x1b[39m")
	expect(ui.render(100).join("\n")).not.toContain("✗ ")
	ui.handleInput(" ")
	ui.handleInput("\r")
	expect(config.value.models).toEqual(["known", "removed"])

	ui.handleInput("\r")
	ui.handleInput("removed")
	ui.handleInput(" ")
	ui.handleInput("\x1b")
	expect(config.value.models).toEqual(["known", "removed"])

	ui.handleInput("\r")
	ui.handleInput("removed")
	ui.handleInput(" ")
	ui.handleInput("\r")
	expect(config.value.models).toEqual(["known"])
	expect(config.warnings).toEqual([])
})

test("single-enum picker keeps an unavailable selection; scope notes show retained values", () => {
	const config = load(
		defineScopedConfig({
			fileName: "choices.json",
			scope: "workspace",
			schema: { model: field.enum(["known"], "known", { choices: "advisory", search: true }) }
		}),
		{ model: "removed" }
	)
	const ui = editor(config)
	ui.handleInput("\r")
	expect(ui.render(100).join("\n")).toContain("> \x1b[33m✗ \x1b[39m\x1b[33mremoved\x1b[39m")
	ui.handleInput("\r")
	expect(config.value.model).toBe("removed")

	const scoped = defineScopedConfig({
		fileName: "choices.json",
		schema: { models: field.multiEnum(["known"], [], { choices: "advisory" }) }
	})
	scoped.cwd = cwd
	scoped.scoped.user = { models: ["removed"] }
	const scopedUi = editor(scoped)
	scopedUi.handleInput("\t")
	expect(scopedUi.render(100).join("\n")).toContain("User: removed")
})
