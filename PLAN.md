# Plan

## Current direction

Keep the library small: keyed flat schema + fixed user/workspace storage + optional TUI editor.
Unknown keys must survive older app versions, so runtime ignores them and preserves them on key updates.

## Todo

- [x] Core scoped config with fixed user/workspace paths.
- [x] Keyed schema API with field builders.
- [x] Defaults-filled merged config resolution.
- [x] Unknown-key preservation across key updates.
- [x] Invalid known-value warnings with ignored resolution.
- [x] Key-level `update()` flow that writes and reloads.
- [x] No separate loaded/state wrapper; config object owns loaded state.
- [x] TUI editor for scope tabs, field cycling, reset, visibility, and basic scope notes.
- [x] Configurable scope mode for user-only, workspace-only, or combined configs.
- [x] Opt-in searchable enum picker in TUI editor.
- [x] Demo Pi extension in `extensions/` with `/scoped-config-demo`.
- [x] README updated for keyed schema API.
