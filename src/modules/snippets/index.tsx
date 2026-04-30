/** @jsxImportSource @opentui/solid */
import type { PromptModule } from "../../prompt/types"
import type { SnippetController } from "./types"
import { SnippetAutocomplete } from "./view"

export function createSnippetsModule(): PromptModule {
    const controller: SnippetController = {}

    return {
        id: "snippets",
        order: -10,
        onSubmit() {
            return controller.chooseActive?.() === true
        },
        renderAbove(ctx) {
            return <SnippetAutocomplete ctx={ctx} controller={controller} />
        },
    }
}
