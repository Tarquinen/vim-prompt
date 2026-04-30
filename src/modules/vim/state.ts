import { createSignal } from "solid-js"

export type VimMode = "normal" | "insert"

export function createVimState() {
    const [mode, setMode] = createSignal<VimMode>("insert")

    return {
        mode,
        setMode,
    }
}
