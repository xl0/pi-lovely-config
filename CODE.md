# Codebase

`@xl0/pi-lovely-config` provides scoped config helpers for Pi extensions.

## Layout

- `src/config.ts` - schema, paths, file IO, merge logic.
- `src/ui.ts` - `ScopedConfigEditor` and TUI-only helpers.
- `src/index.ts` - public API re-exports.
- `extensions/scoped-config-demo.ts` - manual demo extension, `/scoped-config-demo`.

## Public API

- `defineScopedConfig()` declares a flat keyed schema, returns a stateful config object.
- `field.enum/multiEnum/boolean/string/text/number()` create fields.
- `config.load(cwd)` fills `config.value`, `config.scoped`, `config.warnings`.
- `config.update(scope, key, value)` writes one known key, reloads.
- `config.resetScope(scope)` deletes that scope's file, reloads.
- `config.resolve(scoped)` merges defaults + active scopes without file IO.
- `config.path(scope)`, `fields`, `defaults` are for UI/debug after load.

Non-obvious:

- The API is factory-based for type inference; runtime lives on an
  internal `ScopedConfigImpl` class.
- Root type exports stay deliberately small: `ConfigFromSchema`,
  `ConfigScope`, `ScopedConfig`.

## Schema model

Keys come from schema object keys; `label` defaults to the key.
Field metadata: `description`, `valueDescriptions`, `depth`, `visibleWhen`.

- String fields are single-line; text fields are also strings but edit
  multiline in the TUI.
- Enum fields opt into fuzzy search with `search: true`.
- MultiEnum fields hold a string array; each scope replaces the whole array.
- Enum/multiEnum `choices` default to `"strict"`. `"advisory"` retains
  unavailable strings and widens resolved types to `string` / `readonly string[]`.
  Choice lists stay nonempty and defaults must be listed, even in advisory mode.
  Builder return modes use `NoInfer` to keep inline schemas from accidentally
  widening strict enum types through contextual inference.
- Number fields use either range mode (`min`/`max`/`step`) or explicit
  `values`, never both; their constraints remain strict.

## Scopes

- user: `~/.pi/agent/<fileName>`
- workspace: `<cwd>/.pi/<fileName>`

Both are active unless a spec restricts `scope`; workspace overrides user.
Scope order is not configurable. Missing files read as empty patches.

## Validation and preservation

- Config file names must be plain names, not paths.
- Invalid JSON or non-object files read as empty patches and warn; the next
  update replaces malformed content with valid config.
- Scoped patches stay untyped `Record<string, unknown>` - files may hold
  anything.
- Unknown keys are preserved across key updates, ignored on resolution.
- Invalid known values become warnings and are skipped while resolving;
  `update()` refuses them, but hand-edited files keep them.
- Advisory choice mismatches are accepted by resolution and `update()`;
  wrong types (including non-string array items) remain invalid.
  Warnings carry `action: "retained" | "ignored"`; scope precedence still applies.
  Choice warnings show up to three complete unavailable values, not the catalog.
- Newlines in string field defaults or values are invalid - use text fields.
- Files left empty are deleted.

## TUI notes

- Left/right moves focus between include checkbox and value.
  Enter edits/opens pickers or cycles discrete values; Space toggles
  include, quick-steps numbers, or cycles searchable enums.
- Searchable enum input replaces the row value, results render inline
  below it. MultiEnum reuses the same picker with `✓` markers and a
  pending set: Space toggles, Enter commits, Esc discards. Checked items
  float to the top; cursor follows the toggled item. Lists wrap, never
  truncated. Text editor also renders inline; Shift+Enter inserts newlines.
- Advisory pickers snapshot listed + saved unavailable choices. Unavailable
  items are marked and stay in the picker after unchecking so they can be
  rechecked before saving. Scope notes include retained values.
- Esc exits edit mode and discards uncommitted input.
- Scope notes show compact default/user/workspace source values.
- `visibleWhen` is UI-only: hidden saved values persist until cleared.
- Ranged number inputs reject out-of-range values on commit.

## Tooling

- `bun run typecheck`, `bun run biome:check`, `bun test`; `bun run check`
  runs all three. `tests/advisory-choices.test.ts` covers typing, resolution,
  writes, sampled warnings, and picker preservation/removal.
- Published as a library module, not a Pi extension package;
  ships `src/`, `README.md`, `CHANGELOG.md`, `LICENSE`.
- No runtime deps; Pi packages (`@earendil-works/pi-coding-agent`,
  `@earendil-works/pi-tui`) are peers and dev deps.

## Releases

- `CHANGELOG.md` holds human-written `[Unreleased]` entries and release
  history back to 0.0.1; historical dates follow npm publication dates (UTC).
- `bun run release [patch|minor|major|x.y.z] [--no-push]` runs
  `scripts/release.ts`, matching the codex/web staged-release flow.
  It checks origin, npm, release-file cleanliness, and package checks before
  writing the version/changelog. Confirmation commits only those two files,
  tags, and pushes; unrelated staged files stay out of the release commit.
- `.github/workflows/publish.yml` handles stable `v*` tags: verifies version,
  checks, stages on npm with OIDC provenance, then creates a GitHub Release
  from the changelog. Environment: `npm`; no CI npm token.
- Publication requires manual 2FA approval, prompted by the script after
  staging or performed on npmjs.com. `--no-push` stops at the local tag.
