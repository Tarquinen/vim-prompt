/** @jsxImportSource @opentui/solid */
import { onCleanup } from "solid-js"
import type { JSX } from "@opentui/solid"
import { HostPrompt } from "./host"
import { sortModules } from "./modules"
import { createPromptRef } from "./ref"
import type { PromptRootProps } from "./types"

export function PromptRoot(props: PromptRootProps) {
    const modules = sortModules(props.modules)
    const api = props.api
    const ctx = createPromptRef(modules, {
        api,
        slot: props.slot,
        kind: props.kind,
        sessionID: props.sessionID,
        workspaceID: props.workspaceID,
        visible: props.visible,
        disabled: props.disabled,
        submitHost: () => props.onSubmit?.(),
        requestRender: () => api.renderer.requestRender(),
    })

    const cleanups = modules.flatMap((module) => {
        const cleanup = module.setup?.(ctx)
        return typeof cleanup === "function" ? [cleanup] : []
    })
    onCleanup(() => {
        for (const cleanup of cleanups) cleanup()
    })

    const moduleAbove = modules.map((module) => module.renderAbove?.(ctx)).filter(Boolean) as JSX.Element[]
    const moduleBelow = modules.map((module) => module.renderBelow?.(ctx)).filter(Boolean) as JSX.Element[]
    const moduleRight = modules.map((module) => module.renderRight?.(ctx)).filter(Boolean) as JSX.Element[]
    const hostRight = renderHostRight(props)

    return (
        <box>
            {moduleAbove}
            <HostPrompt ctx={ctx} modules={modules} ref={props.ref} right={<RightItems items={[...moduleRight, hostRight]} />} />
            {moduleBelow}
        </box>
    )
}

function renderHostRight(props: PromptRootProps) {
    const Slot = props.api.ui.Slot
    if (props.kind === "home") return <Slot name="home_prompt_right" workspace_id={props.workspaceID} />
    return <Slot name="session_prompt_right" session_id={props.sessionID ?? ""} />
}

function RightItems(props: { items: JSX.Element[] }) {
    const items = props.items.filter(Boolean)
    if (items.length === 0) return undefined
    return <box flexDirection="row">{items}</box>
}
