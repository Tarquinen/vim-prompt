/** @jsxImportSource @opentui/solid */
import type { PromptModule } from "../../prompt/types"
import { createVimState } from "./state"
import { VimStatus } from "./view"

export function createVimModule(): PromptModule {
    const state = createVimState()

    return {
        id: "vim",
        order: 0,
        onPromptRef(ref) {
            if (!ref) return
            state.setMode(ref.focused ? "insert" : "normal")
        },
        renderRight(ctx) {
            return <VimStatus mode={state.mode()} disabled={ctx.disabled} />
        },
    }
}
