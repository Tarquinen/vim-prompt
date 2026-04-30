/** @jsxImportSource @opentui/solid */
import type { VimMode } from "./state"

type VimStatusProps = {
    mode: VimMode
    disabled?: boolean
}

export function VimStatus(props: VimStatusProps) {
    const label = props.mode === "normal" ? "NORMAL" : "INSERT"

    return (
        <box paddingLeft={1} paddingRight={1}>
            <text fg={props.disabled ? "gray" : props.mode === "normal" ? "yellow" : "green"}>{label}</text>
        </box>
    )
}
