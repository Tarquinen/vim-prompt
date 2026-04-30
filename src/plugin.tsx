/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { PromptRoot } from "./prompt/root"
import { createVimModule } from "./modules/vim"
import { createSnippetsModule } from "./modules/snippets"

const tui: TuiPlugin = async (api) => {
    api.slots.register({
        order: 50,
        slots: {
            home_prompt(ctx, props) {
                return <PromptRoot api={api} slot={ctx} kind="home" workspaceID={props.workspace_id} ref={props.ref} modules={[createSnippetsModule(), createVimModule()]} />
            },
            session_prompt(ctx, props) {
                return (
                    <PromptRoot
                        api={api}
                        slot={ctx}
                        kind="session"
                        sessionID={props.session_id}
                        visible={props.visible}
                        disabled={props.disabled}
                        onSubmit={props.on_submit}
                        ref={props.ref}
                        modules={[createSnippetsModule(), createVimModule()]}
                    />
                )
            },
        },
    })
}

const plugin: TuiPluginModule & { id: string } = {
    id: "local.vim-prompt",
    tui,
}

export default plugin
