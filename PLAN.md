# Plan

## Current direction

Build small scoped config library for Pi extensions, plus a project-local demo extension for manual testing.

## Todo

- [x] Core scoped config spec with fixed user/workspace paths.
- [x] TypeBox schema generation plus local config validation.
- [x] In-memory effective config state.
- [x] TUI editor for scope tabs, field cycling, reset, visibility, and override notes.
- [x] Configurable scope mode for user-only, workspace-only, or combined configs.
- [x] Demo Pi extension in `extensions/` with `/scoped-config-demo [user|workspace|both]`.
- [x] Include extension sources in typecheck.
