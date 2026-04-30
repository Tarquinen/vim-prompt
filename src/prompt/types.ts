import type { JSX } from "@opentui/solid"
import type { TuiPluginApi, TuiPromptRef, TuiSlotContext } from "@opencode-ai/plugin/tui"

export type PromptKind = "home" | "session"

export type PromptContext = {
    api: TuiPluginApi
    slot: TuiSlotContext
    kind: PromptKind
    sessionID?: string
    workspaceID?: string
    visible?: boolean
    disabled?: boolean
    prompt: () => TuiPromptRef | undefined
    setPromptRef: (ref: TuiPromptRef | undefined) => void
    submitHost: () => void
    requestRender: () => void
}

export type PromptModule = {
    id: string
    order?: number
    setup?: (ctx: PromptContext) => void | (() => void)
    onPromptRef?: (ref: TuiPromptRef | undefined, ctx: PromptContext) => void
    onSubmit?: (ctx: PromptContext) => boolean | void
    renderAbove?: (ctx: PromptContext) => JSX.Element
    renderBelow?: (ctx: PromptContext) => JSX.Element
    renderRight?: (ctx: PromptContext) => JSX.Element
}

export type PromptRootProps = {
    api: TuiPluginApi
    slot: TuiSlotContext
    kind: PromptKind
    sessionID?: string
    workspaceID?: string
    visible?: boolean
    disabled?: boolean
    onSubmit?: () => void
    ref?: (ref: TuiPromptRef | undefined) => void
    modules: PromptModule[]
}
