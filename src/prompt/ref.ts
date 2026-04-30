import type { TuiPromptRef } from "@opencode-ai/plugin/tui"
import type { PromptContext, PromptModule } from "./types"
import { notifyPromptRef } from "./modules"

export function createPromptRef(modules: PromptModule[], ctx: Omit<PromptContext, "prompt" | "setPromptRef">) {
    let current: TuiPromptRef | undefined
    const context = {
        ...ctx,
        prompt: () => current,
        setPromptRef(ref: TuiPromptRef | undefined) {
            current = ref
            notifyPromptRef(modules, ref, context)
        },
    } satisfies PromptContext

    return context
}
