/** @jsxImportSource @opentui/solid */
import type { TuiPromptRef } from "@opencode-ai/plugin/tui"
import type { JSX } from "@opentui/solid"
import type { PromptContext, PromptModule } from "./types"
import { submitModules } from "./modules"

type HostPromptProps = {
    ctx: PromptContext
    modules: PromptModule[]
    ref?: (ref: TuiPromptRef | undefined) => void
    right?: JSX.Element
}

export function HostPrompt(props: HostPromptProps) {
    const api = props.ctx.api

    const setRef = (ref: TuiPromptRef | undefined) => {
        props.ctx.setPromptRef(ref)
        props.ref?.(ref)
    }

    const onSubmit = () => {
        if (submitModules(props.modules, props.ctx)) return
        props.ctx.submitHost()
    }

    return (
        <api.ui.Prompt
            sessionID={props.ctx.sessionID}
            workspaceID={props.ctx.workspaceID}
            visible={props.ctx.visible}
            disabled={props.ctx.disabled}
            onSubmit={onSubmit}
            ref={setRef}
            right={props.right}
        />
    )
}
