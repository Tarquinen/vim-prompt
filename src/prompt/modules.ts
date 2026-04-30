import type { PromptContext, PromptModule } from "./types"

export function sortModules(modules: PromptModule[]) {
    return [...modules].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id))
}

export function submitModules(modules: PromptModule[], ctx: PromptContext) {
    for (const module of modules) {
        if (module.onSubmit?.(ctx) === true) return true
    }
    return false
}

export function notifyPromptRef(modules: PromptModule[], ref: ReturnType<PromptContext["prompt"]>, ctx: PromptContext) {
    for (const module of modules) module.onPromptRef?.(ref, ctx)
}
