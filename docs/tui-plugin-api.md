# OpenCode TUI Plugin API Reference

> Upstream branch reviewed: `sst/opencode` -> `dev`
> Main source of truth: `packages/plugin/src/tui.ts`
> Runtime cross-checks: `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`, `packages/opencode/src/cli/cmd/tui/plugin/api.tsx`, `packages/opencode/src/cli/cmd/tui/plugin/slots.tsx`, `packages/opencode/src/cli/cmd/tui/app.tsx`, `packages/opencode/src/cli/cmd/tui/routes/home.tsx`, `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`, `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx`, `packages/opencode/src/cli/cmd/tui/feature-plugins/home/footer.tsx`, `packages/opencode/src/cli/cmd/tui/feature-plugins/system/plugins.tsx`, `packages/opencode/src/cli/cmd/tui/config/tui.ts`, `packages/opencode/src/cli/cmd/tui/config/tui-schema.ts`, `packages/opencode/src/plugin/shared.ts`, `packages/opencode/src/plugin/loader.ts`, `packages/opencode/src/plugin/install.ts`, `packages/opencode/src/plugin/meta.ts`, `packages/core/src/npm.ts`
> Supporting spec: `packages/opencode/specs/tui-plugins.md`
> Validating tests: `packages/opencode/test/cli/tui/plugin-loader.test.ts`, `packages/opencode/test/cli/tui/plugin-loader-entrypoint.test.ts`, `packages/opencode/test/cli/tui/plugin-loader-pure.test.ts`, `packages/opencode/test/cli/tui/plugin-toggle.test.ts`, `packages/opencode/test/cli/tui/plugin-install.test.ts`, `packages/opencode/test/cli/tui/plugin-add.test.ts`, `packages/opencode/test/cli/tui/plugin-lifecycle.test.ts`, `packages/opencode/test/cli/tui/keybind-plugin.test.ts`, `packages/opencode/test/cli/tui/theme-store.test.ts`, `packages/opencode/test/config/tui.test.ts`
> Last reviewed locally: 2026-04-29

This document reflects the current TUI plugin system on `dev`. It is a plugin-facing source-of-truth reference, cross-checked against the public types, runtime implementation, current built-in plugins, and tests.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Plugin Module Shape](#2-plugin-module-shape)
3. [`TuiPluginApi` Overview](#3-tuipluginapi-overview)
4. [Configuration And `api.tuiConfig`](#4-configuration-and-apituiconfig)
5. [Loading, Identity, Retry, Pure Mode, And Cleanup](#5-loading-identity-retry-pure-mode-and-cleanup)
6. [Commands](#6-commands)
7. [Routes](#7-routes)
8. [Dialogs, Prompt, And Toasts](#8-dialogs-prompt-and-toasts)
9. [Keybinds](#9-keybinds)
10. [Themes And Package Themes](#10-themes-and-package-themes)
11. [KV, State, Client, And Events](#11-kv-state-client-and-events)
12. [Slots](#12-slots)
13. [Plugin Management And Install](#13-plugin-management-and-install)
14. [Lifecycle And Metadata](#14-lifecycle-and-metadata)
15. [Current Built-in Plugins](#15-current-built-in-plugins)
16. [Current Public Type Reference](#16-current-public-type-reference)
17. [Complete Example](#17-complete-example)

---

## 1. Architecture Overview

The current runtime flow looks like this:

```text
merged tui.json
  |
  v
createTuiApi(...)                     -- base public TuiPluginApi
  |
  v
TuiPluginRuntime.init(hostApi)        -- singleton bound to process.cwd()
  |
  +-- setupSlots(hostApi)             -- OpenTUI slot registry
  +-- load internal plugins first     -- built-ins are real TUI plugins
  +-- resolve external plugins in parallel
  |     +-- skip deprecated plugins
  |     +-- resolve target
  |     +-- resolve entrypoint (./tui export when present)
  |     +-- check npm engines.opencode compatibility
  |     +-- import module
  |     +-- parse strict v1 TUI shape
  |     +-- derive plugin id
  |     +-- read oc-themes list from package.json
  |     +-- (missing ./tui + valid oc-themes = theme-only no-op module)
  |     +-- (missing ./tui + no oc-themes = skip with warning)
  +-- retry failed file plugins once after waitForDependencies()
  +-- touch PluginMeta for external plugins
  +-- merge enabled state from tui.json + KV
  +-- activate enabled plugins sequentially
        +-- sync oc-themes on first/updated metadata state
        +-- call module.tui(api, options, meta)
        +-- auto-track route/command/event cleanup
        +-- auto-dispose slot registrations
        +-- run lifecycle.onDispose handlers on shutdown/deactivate
```

Important runtime properties:

- `TuiPluginRuntime.init()` is singleton-style and tied to the current `process.cwd()`.
- Re-initializing against a different working directory throws until `TuiPluginRuntime.dispose()` runs.
- Internal plugins are loaded before configured external plugins.
- Internal plugins and external plugins share the same runtime model.
- External plugin resolution and import are parallel.
- External plugin activation is sequential so command, route, and side-effect order stays deterministic.
- Plugin ids are the runtime identity used for metadata, enable or disable state, plugin manager rows, and generated slot ids.

---

## 2. Plugin Module Shape

### Current public module type

```ts
type TuiPluginModule = {
  id?: string
  tui: TuiPlugin
  server?: never
}
```

The loader only accepts a default-exported object with `tui`.

```tsx
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api, options, meta) => {
  api.command.register(() => [
    {
      title: "Demo",
      value: "demo.open",
      onSelect: () => api.route.navigate("demo"),
    },
  ])
}

const plugin: TuiPluginModule & { id: string } = {
  id: "acme.demo",
  tui,
}

export default plugin
```

### Loader rules

- The runtime only reads the module default export object.
- The TUI shape is `default export { id?, tui }`.
- Including `server` in the same module is rejected.
- A single module cannot export both `server` and `tui`.
- A bare function default export is not valid for TUI v1 modules.
- Named exports are ignored.
- Each module contributes at most one TUI plugin lifecycle scope.

### Id rules

- File and path plugins must export a non-empty `id`.
- npm plugins may omit `id`; package `name` is used.
- Duplicate plugin ids are rejected, including collisions with internal plugin ids.
- `meta.id` is the canonical plugin identity passed into `tui()`.

### Current plugin signature

```ts
type TuiPlugin = (
  api: TuiPluginApi,
  options: PluginOptions | undefined,
  meta: TuiPluginMeta,
) => Promise<void>
```

Notes:

- Missing config options are passed as `undefined`.
- `PluginOptions` is currently `Record<string, unknown>`.
- UI render values are Solid and OpenTUI `JSX.Element` values.

---

## 3. `TuiPluginApi` Overview

Current top-level API groups exposed to `tui(api, options, meta)`:

- `api.app.version`
- `api.command.register(cb)` / `api.command.trigger(value)` / `api.command.show()`
- `api.route.register(routes)` / `api.route.navigate(name, params?)` / `api.route.current`
- `api.ui.Dialog`, `DialogAlert`, `DialogConfirm`, `DialogPrompt`, `DialogSelect`, `Prompt`, `Slot`, `ui.toast`, `ui.dialog`
- `api.keybind.match`, `print`, `create`
- `api.tuiConfig`
- `api.kv.get`, `set`, `ready`
- `api.state`
- `api.theme.current`, `selected`, `has`, `set`, `install`, `mode`, `ready`
- `api.client`
- `api.event.on(type, handler)`
- `api.renderer`
- `api.slots.register(plugin)`
- `api.plugins.list()`, `activate(id)`, `deactivate(id)`, `add(spec)`, `install(spec, options?)`
- `api.lifecycle.signal`, `api.lifecycle.onDispose(fn)`

At runtime this means plugins receive:

| Property | Purpose |
| --- | --- |
| `api.app` | App-level info such as `version` |
| `api.command` | Register, trigger, and open command-palette entries |
| `api.route` | Register plugin routes, navigate, inspect current route |
| `api.ui` | Built-in dialog components, host prompt and slot components, dialog stack, toast helper |
| `api.keybind` | Match, print, and create keybind sets |
| `api.tuiConfig` | Typed-readonly view of merged TUI config |
| `api.kv` | Shared persistent app KV store |
| `api.state` | Live synced host, session, provider, LSP, and MCP state |
| `api.theme` | Current theme access plus plugin-context `theme.install()` |
| `api.client` | Current active SDK client |
| `api.event` | Subscribe to typed SDK events |
| `api.renderer` | Low-level `CliRenderer` access |
| `api.slots` | Register slot plugins |
| `api.plugins` | Inspect, install, add, activate, or deactivate TUI plugins |
| `api.lifecycle` | Abort signal and cleanup hooks |

---

## 4. Configuration And `api.tuiConfig`

### `tui.json` drives external TUI plugins

Example:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "smoke-theme",
  "diff_style": "stacked",
  "plugin": [
    "@acme/opencode-plugin@1.2.3",
    ["./plugins/demo.tsx", { "label": "demo" }]
  ],
  "plugin_enabled": {
    "acme.demo": false
  }
}
```

Config behavior:

- TUI plugin config lives in `tui.json`.
- `plugin` entries can be either a string spec or `[spec, options]`.
- Plugin specs can be npm specs, `file://` URLs, relative paths, or absolute paths.
- Relative path specs are resolved relative to the config file that declared them.
- Duplicate npm plugins are deduped by package name; higher-precedence config wins.
- Duplicate file plugins are deduped by exact resolved file spec.
- Deduplication happens during config merge, before plugin modules are loaded.
- `plugin_enabled` is keyed by plugin id, not by plugin spec.
- Plugins are enabled by default.
- `plugin_enabled` is merged across config layers.
- Runtime enable or disable state is also stored in KV under `plugin_enabled`; that KV state overrides config on startup.

Current accepted top-level TUI config fields are:

- `$schema`
- `theme`
- `keybinds`
- `plugin`
- `plugin_enabled`
- `scroll_speed`
- `scroll_acceleration`
- `diff_style`
- `mouse`

Loader notes from `TuiConfig`:

- TUI config is merged across the same discovery layers the app uses for TUI config loading.
- Merge order is: global config dir, custom path (`OPENCODE_TUI_CONFIG`), project files, `.opencode` directories, managed config dir.
- A nested legacy `{ "tui": { ... } }` object is flattened when encountered inside `tui.json`-style data.
- Legacy TUI keys can be migrated out of `opencode.json` into `tui.json` when needed.
- When `plugin` entries exist in a writable `.opencode` dir or `OPENCODE_CONFIG_DIR`, OpenCode installs `@opencode-ai/plugin` into that dir along with `package.json`, `bun.lock`, `node_modules/`, and `.gitignore`. This is what makes local config-scoped plugins able to import `@opencode-ai/plugin/tui`.

### What `api.tuiConfig` actually is

Public type:

```ts
readonly tuiConfig: Frozen<TuiConfigView>
```

Practical behavior:

- `api.tuiConfig` is typed as readonly.
- The runtime returns the host `tuiConfig` object directly.
- It is not deep-frozen at runtime.
- Treat it as read-only, but do not rely on JavaScript object freezing.
- It is a live host object, not a one-time snapshot.

---

## 5. Loading, Identity, Retry, Pure Mode, And Cleanup

### External plugin loading

For each configured external plugin, the runtime:

1. Skips deprecated plugins.
2. Resolves the plugin target from the spec.
3. Resolves the entrypoint (`./tui` export when present).
4. Checks `engines.opencode` compatibility for npm plugins.
5. Imports the module.
6. Parses strict v1 shape with `readV1Plugin(..., "tui")`.
7. Resolves runtime id.
8. Reads `oc-themes` list from `package.json`.
9. Touches persisted plugin metadata.

Important loading rules:

- If package `exports` contains `./tui`, the loader resolves that entrypoint.
- If package `exports` exists, the loader only resolves `./tui` or `./server`; it does not fall back to `exports["."]`. A root `"."` export is not used by the plugin loader.
- For npm package specs, TUI does not use `package.json` `main` as a fallback entry. `main` is only used for server plugin entrypoint resolution.
- If a package supports both server and TUI, use separate files and package `exports` (`./server` and `./tui`) so each target resolves to a target-only module.
- Path specs pointing at a directory can resolve to `index.ts`, `index.tsx`, `index.js`, `index.mjs`, or `index.cjs` when `package.json` is missing.
- There is no directory auto-discovery for TUI plugins; they must be listed in `tui.json` or added at runtime.

### Source publishing

Plugins can ship raw `.ts` and `.tsx` source files without a build step. OpenCode uses Bun which handles TypeScript natively. This means `exports["./tui"]` can point directly to a source file:

```json
{
  "exports": {
    "./tui": {
      "import": "./tui.tsx"
    }
  }
}
```

No `tsconfig.json`, `dist/` directory, or build script is required when source publishing.

### Theme-only packages

npm packages can be TUI theme-only by declaring `oc-themes` in `package.json` without a `./tui` entrypoint:

- If a configured TUI package has no `./tui` entrypoint but has valid `oc-themes`, the runtime creates a synthetic no-op module and loads it for theme sync and plugin state tracking.
- Theme-only packages appear in `api.plugins.list()` and the plugin manager dialog like any other external plugin.
- If a configured TUI package has no `./tui` entrypoint and no valid `oc-themes`, it is skipped with a warning (not a load failure).

### Version compatibility

npm plugins can declare a version compatibility range in `package.json`:

```json
{
  "engines": {
    "opencode": "^1.0.0"
  }
}
```

- The value is a semver range checked against the running OpenCode version.
- If the range is not satisfied, the plugin is skipped with a warning.
- If `engines.opencode` is absent, no check is performed (backward compatible).
- File plugins are never checked; only npm package plugins are validated.

### Retry and pure mode

- File plugins that fail initially are retried once after `TuiConfig.waitForDependencies()`.
- Runtime add uses the same external loader path, including that file-plugin retry.
- `--pure` / `OPENCODE_PURE` skips external TUI plugins only.
- Internal TUI plugins still load in pure mode.

### Activation and cleanup

- External resolution/import is parallel.
- Plugin activation is sequential.
- Theme auto-sync from `oc-themes` runs before `tui(...)` execution and only on metadata state `first` or `updated`.
- Plugin init failure rolls back that plugin's tracked registrations and loading continues.
- The runtime tracks command registrations, route registrations, event subscriptions, slot registrations, and explicit `lifecycle.onDispose(...)` handlers.
- Cleanup runs in reverse order.
- Cleanup is awaited.
- The total cleanup budget per plugin is 5 seconds.
- Cleanup timeout or error is logged and shutdown continues.

---

## 6. Commands

Command APIs:

- `api.command.register(cb)`
- `api.command.trigger(value)`
- `api.command.show()`

`api.command.register(cb)` returns an unregister function.

Command rows support:

- `title`, `value`
- `description`, `category`
- `keybind`
- `suggested`, `hidden`, `enabled`
- `slash: { name, aliases? }`
- `onSelect`

Command behavior:

- Registrations are reactive.
- Later registrations win for duplicate `value`.
- Later registrations also win for keybind handling.
- Hidden commands are removed from the command dialog and slash list.
- Hidden commands still respond to keybinds and `api.command.trigger(value)` if `enabled !== false`.
- `enabled: false` prevents both keybind and trigger execution.
- `api.command.show()` opens the host command palette.

---

## 7. Routes

### Route API

- `api.route.register(routes)` returns an unregister function.
- `api.route.navigate(name, params?)` switches the active route.
- `api.route.current` exposes the current route in public plugin-friendly form.

Current route shape:

```ts
type TuiRouteCurrent =
  | { name: "home" }
  | { name: "session"; params: { sessionID: string; prompt?: unknown } }
  | { name: string; params?: Record<string, unknown> }
```

Route behavior:

- Reserved route names are `home` and `session`.
- Any other route name is treated as a plugin route.
- `api.route.navigate("home")` goes home.
- `api.route.navigate("session", params)` only uses `params.sessionID`.
- `api.route.navigate("session", ...)` cannot set the current route's `prompt` value.
- If multiple plugins register the same route name, the last registered route wins.
- Unknown plugin routes render a fallback screen with a `go home` action.

---

## 8. Dialogs, Prompt, And Toasts

### Built-in UI components

`api.ui` currently exposes:

- `Dialog`
- `DialogAlert`
- `DialogConfirm`
- `DialogPrompt`
- `DialogSelect`
- `Slot`
- `Prompt`
- `toast(...)`
- `dialog`

### `ui.dialog`

The host dialog stack exposes:

- `replace(render, onClose?)`
- `clear()`
- `setSize("medium" | "large" | "xlarge")`
- readonly `size`
- readonly `depth`
- readonly `open`

### `ui.DialogPrompt`

Current public props:

```ts
type TuiDialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  busy?: boolean
  busyText?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}
```

Behavior details:

- `busy` prevents submission.
- When `busy` is true, non-escape keyboard input is blocked.
- The textarea is blurred while busy.
- A spinner row is shown using `busyText ?? "Working..."`.

### `ui.Prompt`

`ui.Prompt` exposes the host prompt component to plugins.

```ts
type TuiPromptProps = {
  sessionID?: string
  workspaceID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: TuiPromptRef | undefined) => void
  hint?: JSX.Element
  right?: JSX.Element
  showPlaceholder?: boolean
  placeholders?: {
    normal?: string[]
    shell?: string[]
  }
}
```

`ui.Prompt` is the same host prompt component used by both the home and session routes.

Current prompt helper types:

```ts
type TuiPromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

type TuiPromptRef = {
  focused: boolean
  current: TuiPromptInfo
  set(prompt: TuiPromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}
```

Practical notes:

- `sessionID` and `workspaceID` let plugins bind the prompt to the same host contexts the built-in routes use.
- `ref` exposes focus and prompt state control.
- `right` renders trailing prompt UI, matching the host's `home_prompt_right` and `session_prompt_right` slot pattern.

### `ui.Slot`

`api.ui.Slot` renders a slot by name from plugin UI:

```tsx
<api.ui.Slot name="home_prompt_right" workspace_id={workspaceID} />
```

It uses the same slot registry as host-rendered slots, so plugins can render built-in host slots or custom plugin-defined slot names inside their own routes and dialogs.

### Toasts

`api.ui.toast(...)` shows a host toast with:

- `variant?: "info" | "success" | "warning" | "error"`
- `title?`
- `message`
- `duration?`

---

## 9. Keybinds

Current keybind APIs:

- `api.keybind.match(key, evt)`
- `api.keybind.print(key)`
- `api.keybind.create(defaults, overrides?)`

`api.keybind.create(...)` returns a plugin-local keybind set with:

- readonly `all`
- `get(name)`
- `match(name, evt)`
- `print(name)`

Behavior notes:

- Host `match` and `print` use the app's keybind parser/printer.
- `create(defaults, overrides?)` builds a keybind set from plugin defaults plus optional overrides.
- Missing, blank, or non-string overrides are ignored.
- Key syntax is not validated at creation time.

---

## 10. Themes And Package Themes

### Theme API

Current theme APIs:

- `api.theme.current`
- `api.theme.selected`
- `api.theme.has(name)`
- `api.theme.set(name)`
- `api.theme.install(jsonPath)`
- `api.theme.mode()`
- `api.theme.ready`

### `theme.install()` behavior

- `theme.install()` is plugin-context behavior; the base host API stub throws outside plugin context.
- Relative theme paths are resolved from the plugin root.
- The installed theme name is the JSON basename.
- `api.theme.install(...)` and `oc-themes` auto-sync share the same installer path.
- Theme copy/write runs under a cross-process lock keyed by the destination path (`tui-theme:<dest>`).
- First install writes only when the destination file is missing.
- If the theme name already exists, install is skipped unless plugin metadata state is `updated`.
- On `updated`, the host only rewrites themes previously tracked for that plugin and only when source `mtime` or `size` changed.
- When a theme already exists and state is not `updated`, the host can still persist theme metadata when the destination file already exists on disk.
- Local plugins persist installed themes under local `.opencode/themes` near the config source.
- Global plugins persist installed themes under the global `themes` directory.
- Invalid or unreadable theme files are ignored.

### Package themes via `oc-themes`

npm packages can bundle theme files by declaring `oc-themes` in `package.json`:

```json
{
  "name": "@acme/opencode-themes",
  "oc-themes": [
    "./themes/dark.json",
    "./themes/light.json"
  ]
}
```

`oc-themes` rules:

- `oc-themes` is an array of relative paths to theme JSON files.
- Absolute paths and `file://` URLs are rejected.
- Resolved paths must stay inside the package directory.
- Invalid `oc-themes` entries cause a manifest read failure during install.

Auto-sync behavior:

- Theme auto-sync from `oc-themes` runs during plugin activation, before `tui(...)` is called.
- Auto-sync only runs when the plugin metadata state is `first` or `updated`; plugins with state `same` are skipped.
- Each theme file in the `oc-themes` list is processed through the same installer path as `api.theme.install(...)`.
- A package can provide only themes (no `./tui` entrypoint) and still participate as a theme-only plugin.

### Theme token reference

`api.theme.current` exposes the full set of resolved theme tokens as `TuiThemeCurrent`. The token set includes:

- Core colors: `primary`, `secondary`, `accent`, `error`, `warning`, `success`, `info`
- Text: `text`, `textMuted`, `selectedListItemText`
- Backgrounds: `background`, `backgroundPanel`, `backgroundElement`, `backgroundMenu`
- Borders: `border`, `borderActive`, `borderSubtle`
- Diff: `diffAdded`, `diffRemoved`, `diffContext`, `diffHunkHeader`, `diffHighlightAdded`, `diffHighlightRemoved`, `diffAddedBg`, `diffRemovedBg`, `diffContextBg`, `diffLineNumber`, `diffAddedLineNumberBg`, `diffRemovedLineNumberBg`
- Markdown: `markdownText`, `markdownHeading`, `markdownLink`, `markdownLinkText`, `markdownCode`, `markdownBlockQuote`, `markdownEmph`, `markdownStrong`, `markdownHorizontalRule`, `markdownListItem`, `markdownListEnumeration`, `markdownImage`, `markdownImageText`, `markdownCodeBlock`
- Syntax: `syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`
- Other: `thinkingOpacity` (number)

All color tokens are `RGBA` values from `@opentui/core`.

---

## 11. KV, State, Client, And Events

### KV

`api.kv` is:

- the shared app KV store
- backed by `state/kv.json`
- not plugin-namespaced

Current KV API:

- `get(key, fallback?)`
- `set(key, value)`
- readonly `ready`

Since KV is shared across all plugins and the host, plugins should prefix keys with their plugin id to avoid collisions:

```ts
const key = (name: string) => `${meta.id}:${name}`
api.kv.set(key("setting_a"), true)
api.kv.get(key("setting_a"), false)
```

### State

`api.state` is a live host object with getters, not a frozen snapshot.

Current state surface:

- `ready`
- `config`
- `provider`
- `path.{state,config,worktree,directory}`
- `vcs?.branch`
- `session.count()`
- `session.diff(sessionID)`
- `session.todo(sessionID)`
- `session.messages(sessionID)`
- `session.status(sessionID)`
- `session.permission(sessionID)`
- `session.question(sessionID)`
- `part(messageID)`
- `lsp()`
- `mcp()`

### Client and events

- `api.client` reflects the current runtime client.
- There is no top-level `api.scopedClient(...)` helper in the current public TUI API.
- There is no top-level mutable `api.workspace` API in the current public TUI API.
- `api.event.on(type, handler)` subscribes to the SDK event stream and returns an unsubscribe function.

### Renderer

`api.renderer` exposes the raw `CliRenderer` from `@opentui/core`.

Known renderer capabilities used by plugins:

- `api.renderer.addPostProcessFn(fn)` registers a post-processing function called each frame. The function receives a buffer object and a delta-time value.
- `api.renderer.removePostProcessFn(fn)` unregisters a post-processing function.
- `api.renderer.requestLive()` requests continuous rendering (animation loop). Call this when post-processing needs per-frame updates.
- `api.renderer.dropLive()` releases a live rendering request.
- `api.renderer.targetFps` and `api.renderer.maxFps` control frame rate limits for the render loop.

Plugins that use post-processing should clean up in `lifecycle.onDispose`:

```ts
api.lifecycle.onDispose(() => {
  if (postFn) api.renderer.removePostProcessFn(postFn)
  if (live) api.renderer.dropLive()
})
```

---

## 12. Slots

### Current slot names

```ts
type TuiHostSlotMap = {
  app: {}
  home_logo: {}
  home_prompt: {
    workspace_id?: string
    ref?: (ref: TuiPromptRef | undefined) => void
  }
  home_prompt_right: {
    workspace_id?: string
  }
  session_prompt: {
    session_id: string
    visible?: boolean
    disabled?: boolean
    on_submit?: () => void
    ref?: (ref: TuiPromptRef | undefined) => void
  }
  session_prompt_right: {
    session_id: string
  }
  home_bottom: {}
  home_footer: {}
  sidebar_title: {
    session_id: string
    title: string
    share_url?: string
  }
  sidebar_content: {
    session_id: string
  }
  sidebar_footer: {
    session_id: string
  }
}

type TuiSlotMap<Slots extends Record<string, object> = {}> = TuiHostSlotMap & Slots
```

### Slot behavior

- Slot context currently exposes only `theme`.
- `api.slots.register(plugin)` returns the host-assigned slot plugin id.
- `api.slots.register(plugin)` does not return an unregister function.
- Slot registration cleanup is tracked automatically by the plugin lifecycle scope.
- Returned ids are `pluginId`, `pluginId:1`, `pluginId:2`, and so on.
- Plugin-provided `id` is not allowed; the host assigns it.
- `TuiSlotMap` is generic, so plugins can define additional slot names in their own slot registries.
- Host-rendered slots are the built-in names listed in `TuiHostSlotMap`; custom slot names must be rendered from plugin UI with `api.ui.Slot`.
- A plugin can call `api.slots.register(...)` multiple times with different slot plugin objects.

### Slot callback signature

Slot render callbacks receive two arguments: slot context and slot props.

```ts
slots: {
  sidebar_content(ctx, props) {
    // ctx.theme is the TuiTheme object
    // props contains the slot-specific props from TuiSlotMap
    return <View theme={ctx.theme.current} session_id={props.session_id} />
  }
}
```

The first argument (`ctx: TuiSlotContext`) provides `{ theme }`. The second argument contains the slot-specific props from `TuiSlotMap` for that slot name. Slots with no props (e.g. `home_bottom`) still receive both arguments but the second is `{}`.

### Slot ordering

Slot registrations can include an `order` field. Lower values render first. Internal plugins use orders starting at 100:

- `sidebar_content` internal order: context `100`, mcp `200`, lsp `300`, todo `400`, files `500`
- `home_footer` and `sidebar_footer` internal order: `100`
- `home_bottom` (tips) internal order: `100`

External plugins can use orders below 100 to appear before built-in content, or above 500 to appear after it.

### Current host rendering modes

- `app` uses the slot library default mode.
- `home_logo` is rendered with `replace`.
- `home_prompt` is rendered with `replace`.
- `home_prompt_right` uses the slot library default mode.
- `session_prompt` is rendered with `replace`.
- `session_prompt_right` uses the slot library default mode.
- `home_bottom` uses the slot library default mode.
- `home_footer` is rendered with `single_winner`.
- `sidebar_title` is rendered with `single_winner`.
- `sidebar_content` uses the slot library default mode.
- `sidebar_footer` is rendered with `single_winner`.

### Home and session prompt replacement

The home route wraps the main prompt in:

```tsx
<TuiPluginRuntime.Slot name="home_prompt" mode="replace" workspace_id={route.workspaceID} ref={promptRef}>
  <Prompt right={<TuiPluginRuntime.Slot name="home_prompt_right" workspace_id={route.workspaceID} />} />
</TuiPluginRuntime.Slot>
```

The session route does the same with `session_prompt` and `session_prompt_right`.

That means plugins can replace either host input UI, or extend the default prompt chrome using the right-side prompt slots.

---

## 13. Plugin Management And Install

### Plugin control APIs

Current plugin control APIs:

- `api.plugins.list()`
- `api.plugins.activate(id)`
- `api.plugins.deactivate(id)`
- `api.plugins.add(spec)`
- `api.plugins.install(spec, options?)`

### `api.plugins.list()`

Returns:

```ts
type TuiPluginStatus = {
  id: string
  source: "file" | "npm" | "internal"
  spec: string
  target: string
  enabled: boolean
  active: boolean
}
```

Notes:

- `enabled` is the persisted desired state.
- `active` means the plugin is currently initialized.

### `api.plugins.activate(id)` / `deactivate(id)`

- `activate(id)` sets `enabled = true`, persists it into KV, and initializes the plugin if needed.
- `deactivate(id)` sets `enabled = false`, persists it into KV, and disposes the plugin scope if active.
- If activation fails, a plugin can remain `enabled = true` and `active = false`.

### Replacing built-in plugins

Plugins can deactivate internal plugins to replace their functionality. For example, a plugin that provides its own sidebar context widget can deactivate the built-in one:

```ts
await api.plugins.deactivate("internal:sidebar-context")
```

Plugins that deactivate built-ins should restore them on dispose:

```ts
api.lifecycle.onDispose(async () => {
  await api.plugins.activate("internal:sidebar-context")
})
```

Internal plugin ids that can be deactivated are listed in [Current Built-in Plugins](#15-current-built-in-plugins).

### `api.plugins.add(spec)`

Behavior:

- Trims the input.
- Returns `false` for an empty string.
- Treats the input as the runtime plugin spec and loads it without re-reading `tui.json`.
- Uses the same external loader path as startup loading.
- Includes the same file-plugin retry after dependency wait.
- No-ops when that resolved spec is already loaded.
- Also no-ops when the resolved plugin id is already loaded.
- Assumes enabled and always attempts initialization.
- Does not consult config or KV enable state before attempting activation.
- Can load theme-only packages (`oc-themes` with no `./tui` entrypoint) as runtime entries.

### `api.plugins.install(spec, { global? })`

Behavior:

- Runs install -> manifest read -> config patch using the same helpers as CLI install.
- Returns either `{ ok: false, message, missing? }` or `{ ok: true, dir, tui }`.
- Does not load the plugin into the current session.
- Use `api.plugins.add(spec)` after install if you want a runtime load.
- If a package declares default options via `exports["./tui"].config` in `package.json`, install writes those options into the config as a tuple entry on first install.
- If runtime state is not ready, the current error is `Plugin runtime is not ready.`
- Empty spec returns `Plugin package name is required`.
- If `api.state.path.directory` is unavailable, the current error is `Paths are still syncing. Try again in a moment.`

### Package manifest and install target detection

Install target detection is inferred from `package.json` entrypoints and theme metadata:

- `server` target when `exports["./server"]` exists or `main` is set.
- `tui` target when `exports["./tui"]` exists.
- `tui` target when `oc-themes` exists and resolves to a non-empty set of valid package-relative theme paths.

A package can target `server`, `tui`, or both. If a package targets both, each target must resolve to a separate target-only module.

Default plugin options can be embedded in `package.json`:

```json
{
  "exports": {
    "./tui": {
      "import": "./dist/tui.js",
      "config": { "compact": true }
    }
  }
}
```

The `config` object is written as the plugin's default options on first install.

### Install behavior details

- npm plugin package installs run through the shared Arborist installer with `ignoreScripts: true`, so package `install` / `postinstall` lifecycle scripts are not run.
- Explicit npm specs with a version suffix (e.g. `pkg@1.2.3`) are pinned. Runtime install requests that exact version.
- Bare npm specs (`pkg`) are treated as `latest`.
- Config patching uses targeted `jsonc-parser` edits, so existing JSONC comments are preserved when plugin entries are added or replaced.
- Config patching serializes per-target config writes with file locking.
- Config patching returns structured result unions (`ok`, `code`, fields by error kind).
- Without `--force`, an already-configured npm package name is a no-op.
- Install flow is shared by CLI (`opencode plugin <module>`) and TUI in `src/plugin/install.ts`.
- There is no uninstall, list, or update CLI command for external plugins.
- Local file plugins are configured directly in `tui.json`.

### Plugin manager

The plugin manager is a built-in TUI plugin.

- Command title is `Plugins`.
- Command value is `plugins.list`.
- Keybind name is `plugin_manager`.
- Default keybind is `none`.
- It lists both internal and external plugins.
- It toggles based on `active` state.
- Its own row is disabled only inside the manager dialog.
- It also exposes command `plugins.install` with title `Install plugin`.
- Inside the Plugins dialog, key `shift+i` opens the install prompt.
- The install prompt asks for an npm package name.
- Scope defaults to local.
- `tab` toggles local/global scope in the install dialog.
- The install dialog uses `DialogPrompt.busy` and `busyText` while install is in flight.
- Manager install uses `api.plugins.install(spec, { global })`.
- `tui` target detection includes `exports["./tui"]` and valid `oc-themes`.
- If install returns `tui = false`, the manager reports that the package has no TUI target to load in this app.
- If install returns `tui = true`, the manager then calls `api.plugins.add(spec)`.
- If runtime add fails, the manager shows a warning and restart remains the fallback.

---

## 14. Lifecycle And Metadata

### Lifecycle

Current lifecycle API:

```ts
type TuiLifecycle = {
  readonly signal: AbortSignal
  onDispose: (fn: TuiDispose) => () => void
}
```

Behavior:

- `api.lifecycle.signal` is aborted before cleanup handlers run.
- `api.lifecycle.onDispose(fn)` registers cleanup and returns an unregister function.
- Cleanup handlers are executed in reverse registration order.
- Cleanup is idempotent per plugin scope.

### Plugin metadata

`meta` passed to `tui(api, options, meta)` contains:

- `state`: `first | updated | same`
- `id`, `source`, `spec`, `target`
- npm-only fields when available: `requested`, `version`
- file-only field when available: `modified`
- `first_time`, `last_time`, `time_changed`, `load_count`, `fingerprint`

Metadata notes:

- Metadata is persisted by plugin id in `plugin-meta.json` in the state directory.
- File plugin fingerprint is `target|modified`.
- npm plugin fingerprint is `target|requested|version`.
- Internal plugins get synthetic metadata with `state: "same"`.
- Plugin theme tracking is also stored in the metadata entry under `themes`.

---

## 15. Current Built-in Plugins

Current internal plugin ids:

- `internal:home-footer`
- `internal:home-tips`
- `internal:sidebar-context`
- `internal:sidebar-mcp`
- `internal:sidebar-lsp`
- `internal:sidebar-todo`
- `internal:sidebar-files`
- `internal:sidebar-footer`
- `internal:plugin-manager`

Sidebar content order is currently:

- context `100`
- mcp `200`
- lsp `300`
- todo `400`
- files `500`

### Plugin manager

The plugin manager is exposed as a command with title `Plugins` and value `plugins.list`. See [Plugin Management And Install](#13-plugin-management-and-install) for full details.

---

## 16. Current Public Type Reference

These are the most important current public type shapes from `packages/plugin/src/tui.ts`.

### `TuiDialogPromptProps`

```ts
type TuiDialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  busy?: boolean
  busyText?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}
```

### `TuiPromptProps`

```ts
type TuiPromptProps = {
  sessionID?: string
  workspaceID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: TuiPromptRef | undefined) => void
  hint?: JSX.Element
  right?: JSX.Element
  showPlaceholder?: boolean
  placeholders?: {
    normal?: string[]
    shell?: string[]
  }
}
```

### `TuiPromptInfo`

```ts
type TuiPromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}
```

### `TuiPromptRef`

```ts
type TuiPromptRef = {
  focused: boolean
  current: TuiPromptInfo
  set(prompt: TuiPromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}
```

### `TuiPluginInstallResult`

```ts
type TuiPluginInstallResult =
  | {
      ok: true
      dir: string
      tui: boolean
    }
  | {
      ok: false
      message: string
      missing?: boolean
    }
```

### `TuiPluginStatus`

```ts
type TuiPluginStatus = {
  id: string
  source: "file" | "npm" | "internal"
  spec: string
  target: string
  enabled: boolean
  active: boolean
}
```

### `TuiHostSlotMap` and `TuiSlotMap`

```ts
type TuiHostSlotMap = {
  app: {}
  home_logo: {}
  home_prompt: {
    workspace_id?: string
    ref?: (ref: TuiPromptRef | undefined) => void
  }
  home_prompt_right: {
    workspace_id?: string
  }
  session_prompt: {
    session_id: string
    visible?: boolean
    disabled?: boolean
    on_submit?: () => void
    ref?: (ref: TuiPromptRef | undefined) => void
  }
  session_prompt_right: {
    session_id: string
  }
  home_bottom: {}
  home_footer: {}
  sidebar_title: {
    session_id: string
    title: string
    share_url?: string
  }
  sidebar_content: {
    session_id: string
  }
  sidebar_footer: {
    session_id: string
  }
}

type TuiSlotMap<Slots extends Record<string, object> = {}> = TuiHostSlotMap & Slots
```

### `TuiPluginModule`

```ts
type TuiPluginModule = {
  id?: string
  tui: TuiPlugin
  server?: never
}
```

### `TuiPluginMeta`

```ts
type TuiPluginMeta = {
  state: "first" | "updated" | "same"
  id: string
  source: "file" | "npm" | "internal"
  spec: string
  target: string
  requested?: string
  version?: string
  modified?: number
  first_time: number
  last_time: number
  time_changed: number
  load_count: number
  fingerprint: string
}
```

### `TuiThemeCurrent`

```ts
type TuiThemeCurrent = {
  readonly primary: RGBA
  readonly secondary: RGBA
  readonly accent: RGBA
  readonly error: RGBA
  readonly warning: RGBA
  readonly success: RGBA
  readonly info: RGBA
  readonly text: RGBA
  readonly textMuted: RGBA
  readonly selectedListItemText: RGBA
  readonly background: RGBA
  readonly backgroundPanel: RGBA
  readonly backgroundElement: RGBA
  readonly backgroundMenu: RGBA
  readonly border: RGBA
  readonly borderActive: RGBA
  readonly borderSubtle: RGBA
  readonly diffAdded: RGBA
  readonly diffRemoved: RGBA
  readonly diffContext: RGBA
  readonly diffHunkHeader: RGBA
  readonly diffHighlightAdded: RGBA
  readonly diffHighlightRemoved: RGBA
  readonly diffAddedBg: RGBA
  readonly diffRemovedBg: RGBA
  readonly diffContextBg: RGBA
  readonly diffLineNumber: RGBA
  readonly diffAddedLineNumberBg: RGBA
  readonly diffRemovedLineNumberBg: RGBA
  readonly markdownText: RGBA
  readonly markdownHeading: RGBA
  readonly markdownLink: RGBA
  readonly markdownLinkText: RGBA
  readonly markdownCode: RGBA
  readonly markdownBlockQuote: RGBA
  readonly markdownEmph: RGBA
  readonly markdownStrong: RGBA
  readonly markdownHorizontalRule: RGBA
  readonly markdownListItem: RGBA
  readonly markdownListEnumeration: RGBA
  readonly markdownImage: RGBA
  readonly markdownImageText: RGBA
  readonly markdownCodeBlock: RGBA
  readonly syntaxComment: RGBA
  readonly syntaxKeyword: RGBA
  readonly syntaxFunction: RGBA
  readonly syntaxVariable: RGBA
  readonly syntaxString: RGBA
  readonly syntaxNumber: RGBA
  readonly syntaxType: RGBA
  readonly syntaxOperator: RGBA
  readonly syntaxPunctuation: RGBA
  readonly thinkingOpacity: number
}
```

---

## 17. Complete Example

This example shows the current v1 TUI module shape, command registration, route registration, and replacement of the `home_prompt` slot using `api.ui.Prompt`.

```tsx
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api, options, meta) => {
  api.command.register(() => [
    {
      title: "Open demo",
      value: "demo.open",
      description: "Open the demo route",
      category: "Demo",
      slash: { name: "demo" },
      onSelect: () => api.route.navigate("demo"),
    },
  ])

  api.route.register([
    {
      name: "demo",
      render: () => (
        <box flexDirection="column" gap={1}>
          <text>plugin: {meta.id}</text>
          <text>route: {api.route.current.name}</text>
          <text>sessions: {api.state.session.count()}</text>
          <text>theme: {api.theme.selected}</text>
          <text>label: {String(options?.label ?? "unset")}</text>
        </box>
      ),
    },
  ])

  api.slots.register({
    order: 200,
    slots: {
      home_prompt(ctx, props) {
        return (
          <api.ui.Prompt
            workspaceID={props.workspace_id}
            right={<api.ui.Slot name="home_prompt_right" workspace_id={props.workspace_id} />}
            showPlaceholder
            placeholders={{
              normal: ["Open the demo route", "Summarize this repo"],
              shell: ["git status", "ls -la"],
            }}
            hint={<text fg={ctx.theme.current.textMuted}>Plugin prompt replacement</text>}
          />
        )
      },
      home_bottom(ctx) {
        return <text fg={ctx.theme.current.textMuted}>Loaded {meta.id}</text>
      },
    },
  })

  api.lifecycle.onDispose(() => {
    // Clean up timers, subscriptions, or other external resources here.
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "acme.demo",
  tui,
}

export default plugin
```

Local `tui.json` example:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [["./plugins/demo.tsx", { "label": "hello" }]]
}
```
