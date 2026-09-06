# Changelog

Historical release dates use npm publication dates (UTC).

## [Unreleased]

### Added

- Multi-enum fields with whole-array scope overrides and searchable TUI
  checklists. Space toggles items, Enter saves, Esc discards; selected items
  float to the top.

### Changed

- Releases now stage on npm through GitHub Actions with OIDC provenance,
  then publish after manual 2FA approval.

## [0.1.2] - 2026-07-21

### Fixed

- Malformed JSON and non-object config files now load as empty patches with
  scope/path warnings instead of throwing. Subsequent updates replace malformed
  content with valid config.

### Changed

- File-level warnings omit `key`; field-level warnings still include it.
- Expanded installation, field metadata, and TUI interaction documentation.

## [0.1.1] - 2026-07-08

### Added

- Searchable enum pickers via `search: true`, with inline fuzzy matching
  against values and descriptions.
- `field.text()` for multiline strings, with an inline TUI editor:
  Enter saves, Shift+Enter inserts a newline, Esc discards.

### Fixed

- Single-line string fields reject multiline defaults and values; use text
  fields for multiline content.

## [0.1.0] - 2026-06-28

### Changed

- Replaced `defineScopedConfigSpec()` and `ScopedConfigState` with
  `defineScopedConfig({ schema })` and typed `field` builders. Schema object
  keys define config keys, and labels default to those keys.
- Unified loading, scoped patches, resolved values, warnings, key-level
  updates, and scope resets on one stateful config object.
- Invalid known values now warn and are skipped during resolution;
  `update()` rejects invalid values while preserving unrelated file contents.
- Simplified TUI editing controls and default/user/workspace source notes.
- Trimmed root type exports to `ConfigFromSchema`, `ConfigScope`, and
  `ScopedConfig`.

### Removed

- TypeBox schema dependency; the library has no runtime dependencies.

## [0.0.1] - 2026-06-23

### Added

- Initial scoped config library with user/workspace JSON storage, defaults,
  fixed workspace precedence, and optional single-scope restriction.
- Enum, boolean, string, and number fields, including ranged numbers and
  explicit numeric choices.
- Field validation, numeric range warnings, unknown-property preservation,
  and deletion of empty config files.
- TUI editor with scope selection, include toggles, resets, descriptions,
  conditional visibility, inline string/number editing, and live numeric
  validation.
- Manual demo extension and usage documentation.
