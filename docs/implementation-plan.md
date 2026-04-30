# Vim Prompt Implementation Plan

## Goal

Build `vim-prompt` as the single TUI prompt-slot owner for OpenCode while keeping prompt behavior modular.

The plugin should replace the `home_prompt` and `session_prompt` slots once, render one shared host prompt, apply vim-style behavior/chrome, and then compose additional prompt modules such as snippets autocomplete.

## Constraints

- OpenCode renders `home_prompt` and `session_prompt` with `mode="replace"`.
- `replace` suppresses the native fallback prompt when any plugin contributes to the slot.
- `replace` renders all contributing plugins; it is not a single-winner mode.
- Therefore multiple plugins that register `home_prompt` or `session_prompt` will render multiple prompt boxes.
- There is no current public TUI API to mutate the already-rendered native prompt chrome in place.
- `TuiPromptRef` can mutate prompt state and focus, but not prompt layout or visuals.
- Compatible prompt extensions need to be composed inside one prompt-slot owner.

## Snippets Findings

`opencode-snippets` does not modify the native prompt in place.

It registers full replacements for:

- `home_prompt`
- `session_prompt`

Its TUI wrapper then renders the host prompt exactly once via `api.ui.Prompt` and adds autocomplete UI around it.

Relevant behavior from `opencode-snippets`:

- Owns prompt slots with `api.slots.register`.
- Wraps the host prompt in `PromptWithSnippetAutocomplete`.
- Forwards the host ref with `hostRef?.(ref)`.
- Polls `TuiPromptRef.current.input` because the prompt ref has no input-change callback.
- Renders autocomplete UI above the prompt.
- Uses the prompt ref to set/replace text, restore focus, and submit/reload.

This is the model `vim-prompt` should follow, but with a module system so snippets-style behavior is only one module.

## Target Structure

```txt
plugin/vim-prompt/
  tui.tsx
  package.json
  tsconfig.json
  docs/
    implementation-plan.md
    tui-plugin-api.md
  src/
    plugin.tsx
    prompt/
      root.tsx
      host.tsx
      types.ts
      ref.ts
      modules.ts
    modules/
      vim/
        index.tsx
        state.ts
        keys.ts
        view.tsx
      snippets/
        index.tsx
        autocomplete.tsx
        search.ts
        trigger.ts
        loader.ts
        skill-loader.ts
        upstream.md
```

## Prompt Ownership Model

`vim-prompt` should be the only plugin in `tui.jsonc` that registers `home_prompt` and `session_prompt`.

`opencode-snippets@latest` should remain in `opencode.jsonc` for server-side functionality, but should stay disabled in `tui.jsonc` while `vim-prompt` owns the TUI prompt.

The prompt slot render path should be:

```tsx
<PromptRoot>
  <ModuleAbove />
  <VimChrome>
    <HostPrompt />
  </VimChrome>
  <ModuleBelow />
</PromptRoot>
```

Only `HostPrompt` should render `api.ui.Prompt`.

Modules should not render `api.ui.Prompt` directly. They should decorate, intercept, or mutate the shared prompt through a module context.

## Module Contract

Start with a small contract and expand only when needed.

```ts
type PromptKind = "home" | "session"

type PromptModule = {
  id: string
  order?: number
  setup?(ctx: PromptContext): void | (() => void)
  onPromptRef?(ref: TuiPromptRef | undefined, ctx: PromptContext): void
  onSubmit?(ctx: PromptContext): boolean | void
  renderAbove?(ctx: PromptContext): JSX.Element
  renderBelow?(ctx: PromptContext): JSX.Element
  renderRight?(ctx: PromptContext): JSX.Element
}
```

`onSubmit` should return `true` when the module handled the submit and the host submit should stop.

`renderRight` output should be composed with the host right-side slots:

- `home_prompt_right`
- `session_prompt_right`

## Prompt Context

`PromptContext` should hold all shared state needed by modules:

```ts
type PromptContext = {
  api: TuiPluginApi
  kind: PromptKind
  sessionID?: string
  workspaceID?: string
  visible?: boolean
  disabled?: boolean
  prompt: () => TuiPromptRef | undefined
  setPromptRef(ref: TuiPromptRef | undefined): void
  submitHost(): void
  requestRender(): void
}
```

The context should preserve the host route ref behavior by forwarding the received prompt ref to the slot prop `ref`.

## Implementation Stages

### Stage 1: Restructure Without Behavior Change

- Move current `tui.tsx` logic into `src/plugin.tsx`.
- Make root `tui.tsx` re-export from `src/plugin`.
- Add `PromptRoot` that registers `home_prompt` and `session_prompt`.
- Add `HostPrompt` that renders `api.ui.Prompt` exactly once.
- Preserve host props: `workspaceID`, `sessionID`, `visible`, `disabled`, `onSubmit`, `ref`.
- Preserve right-side slots by rendering `api.ui.Slot` for `home_prompt_right` and `session_prompt_right`.

### Stage 2: Add Vim Module

- Add a `modules/vim` module.
- Start with visual/chrome changes around the shared host prompt.
- Add minimal mode state: normal/insert.
- Add a visible mode indicator.
- Add key handling only after the shared prompt wiring is stable.

### Stage 3: Add Module Composition

- Implement `modules.ts` to sort modules by `order`.
- Compose `renderAbove`, `renderBelow`, and `renderRight` outputs.
- Chain `onSubmit` handlers before calling the host `onSubmit`.
- Broadcast prompt ref changes through `onPromptRef`.

### Stage 4: Port Snippets TUI As A Module

- Copy snippets TUI helper logic into `src/modules/snippets`.
- Keep upstream source grouped and easy to diff.
- Do not let the snippets module render `api.ui.Prompt`.
- Convert `PromptWithSnippetAutocomplete` into a module that renders autocomplete in `renderAbove`.
- Keep prompt input mutation through the shared `TuiPromptRef`.
- Keep snippet commands such as insert/reload registered from `setup`.
- Keep polling-based prompt input sync until OpenCode exposes an input-change callback.

### Stage 5: Upstream Tracking

- Add `src/modules/snippets/upstream.md` with:
  - upstream repository URL
  - upstream version copied from
  - copied source files
  - local changes made during adaptation
  - update checklist
- When snippets updates, compare upstream `tui.tsx`, `src/tui-search.ts`, `src/tui-trigger.ts`, `src/loader.ts`, and `src/skill-loader.ts` against our module files.

### Stage 6: Future Prompt Modules

- Treat any future prompt-box modifying plugin as a module, not another prompt-slot contributor.
- If a plugin only needs additive UI, prefer `renderRight`, `renderAbove`, or `renderBelow`.
- If a plugin needs input mutation, route it through the shared `TuiPromptRef`.
- If a plugin needs submit interception, implement `onSubmit`.

## Config Policy

`opencode.jsonc`:

- Keep `opencode-snippets@latest` enabled for server-side functionality.

`tui.jsonc`:

- Keep `./plugin/vim-prompt` enabled.
- Keep `opencode-snippets@latest` disabled while `vim-prompt` owns prompt slots.

## Verification Plan

After each stage:

- Run `bun x tsc -p plugin/vim-prompt/tsconfig.json --noEmit` from `/home/dan/src/opencode-config`.
- Start OpenCode and verify only one prompt renders on home and session screens.
- Verify the prompt still accepts text, submits, focuses, and preserves host right-side slots.
- Verify no slot errors appear in `/home/dan/.local/share/opencode/log/`.

For snippets module work:

- Verify `#` trigger opens autocomplete.
- Verify snippet insertion updates the prompt text.
- Verify skill options still appear.
- Verify reload command behavior.
- Verify dialogs do not submit prompt accidentally.

## Open Questions

- How much vim behavior should wrap the host `api.ui.Prompt` versus eventually replacing prompt internals?
- Does the current prompt ref expose enough control for normal-mode navigation, deletion, and selection?
- If deeper editing control is needed, should we upstream additional prompt ref methods to OpenCode instead of duplicating prompt internals?
