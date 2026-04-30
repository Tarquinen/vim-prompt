/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import type { TuiPromptRef } from "@opencode-ai/plugin/tui"
import type { PromptContext } from "../../prompt/types"
import { loadSnippets } from "./loader"
import { describeSnippet, filterSnippets, highlightMatches, matchedAliases } from "./search"
import { findTrailingHashtagTrigger, insertSnippetTag, preferredSnippetTag } from "./trigger"
import type { SnippetController, SnippetInfo } from "./types"

const PROMPT_SYNC_MS = 50
const MENU_MAX_HEIGHT = 10
const INLINE_BORDER = {
    border: ["left", "right"] as Array<"left" | "right">,
    customBorderChars: {
        topLeft: "",
        bottomLeft: "",
        vertical: "┃",
        topRight: "",
        bottomRight: "",
        horizontal: " ",
        bottomT: "",
        topT: "",
        cross: "",
        leftT: "",
        rightT: "",
    },
}

type SnippetAutocompleteProps = {
    ctx: PromptContext
    controller: SnippetController
}

export function SnippetAutocomplete(props: SnippetAutocompleteProps) {
    const [snippets, setSnippets] = createSignal<SnippetInfo[]>([])
    const [input, setInput] = createSignal("")
    const [selected, setSelected] = createSignal(0)
    const [dismissed, setDismissed] = createSignal<string>()

    let syncTimer: ReturnType<typeof setInterval> | undefined
    let disposed = false

    loadSnippets(props.ctx.api.state.path.directory).then((items) => {
        if (!disposed) setSnippets(items)
    })

    syncTimer = setInterval(() => {
        const ref = props.ctx.prompt()
        const next = ref?.current.input ?? ""
        setInput(next)
    }, PROMPT_SYNC_MS)

    onCleanup(() => {
        disposed = true
        if (syncTimer) clearInterval(syncTimer)
        props.controller.chooseActive = undefined
    })

    const match = createMemo(() => {
        if (props.ctx.disabled || props.ctx.visible === false) return undefined
        return findTrailingHashtagTrigger(input())
    })
    const query = createMemo(() => match()?.query.trim() ?? "")
    const options = createMemo(() => (match() ? filterSnippets(snippets(), query()) : []))
    const menuVisible = createMemo(() => !!match() && dismissed() !== match()?.token && options().length > 0)
    const menuHeight = createMemo(() => Math.min(options().length, MENU_MAX_HEIGHT))
    const selectedFg = createMemo(() => selectedText(props.ctx.api.theme.current))

    createEffect(() => {
        match()?.token
        options().length
        setSelected(0)
    })

    const chooseActive = () => {
        if (!menuVisible()) return false

        const ref = props.ctx.prompt()
        const item = options()[selected()]
        if (!ref || !item) return false


        setPromptInput(ref, insertSnippetTag(ref.current.input, preferredSnippetTag(ref.current.input, item)))
        setInput(ref.current.input)
        setDismissed(undefined)
        ref.focus()
        props.ctx.requestRender()
        return true
    }

    props.controller.chooseActive = chooseActive

    useKeyboard((event) => {
        if (!menuVisible()) return

        if (event.name === "up") {
            setSelected((current) => Math.max(0, current - 1))
            event.preventDefault()
            event.stopPropagation()
            return
        }

        if (event.name === "down") {
            setSelected((current) => Math.min(options().length - 1, current + 1))
            event.preventDefault()
            event.stopPropagation()
            return
        }

        if (event.name === "escape") {
            setDismissed(match()?.token)
            event.preventDefault()
            event.stopPropagation()
            return
        }

        if (event.name === "tab") {
            if (chooseActive()) {
                event.preventDefault()
                event.stopPropagation()
            }
        }
    })

    return (
        <Show when={menuVisible()}>
            <box position="absolute" top={-menuHeight()} left={0} right={0} zIndex={100} borderColor={props.ctx.api.theme.current.border} {...INLINE_BORDER}>
                <scrollbox backgroundColor={props.ctx.api.theme.current.backgroundMenu} height={menuHeight()} scrollbarOptions={{ visible: false }}>
                    <For each={options().slice(0, MENU_MAX_HEIGHT)}>
                        {(item, index) => <SnippetRow ctx={props.ctx} snippet={item} query={query()} selected={index() === selected()} selectedFg={selectedFg()} />}
                    </For>
                </scrollbox>
            </box>
        </Show>
    )
}

function SnippetRow(props: { ctx: PromptContext; snippet: SnippetInfo; query: string; selected: boolean; selectedFg: RGBA }) {
    const aliases = matchedAliases(props.snippet, props.query)
    const description = describeSnippet(props.snippet)
    const fg = () => (props.selected ? props.selectedFg : props.ctx.api.theme.current.text)
    const mutedFg = () => (props.selected ? props.selectedFg : props.ctx.api.theme.current.textMuted)

    return (
        <box flexDirection="row" backgroundColor={props.selected ? props.ctx.api.theme.current.primary : undefined} paddingLeft={1} paddingRight={1}>
            <text fg={fg()} flexShrink={0} wrapMode="none">
                <Highlighted text={`#${props.snippet.name}`} query={props.query} fg={fg()} />
            </text>
            <Show when={aliases.length > 0}>
                <text fg={mutedFg()} flexShrink={0} wrapMode="none">
                    <Highlighted text={`  ${aliases.length === 1 ? "alias" : "aliases"}: ${aliases.join(", ")}`} query={props.query} fg={mutedFg()} />
                </text>
            </Show>
            <Show when={description}>
                <text fg={mutedFg()} wrapMode="none">
                    <Highlighted text={`  ${description}`} query={props.query} fg={mutedFg()} />
                </text>
            </Show>
        </box>
    )
}

function Highlighted(props: { text: string; query: string; fg: RGBA }) {
    return (
        <For each={highlightMatches(props.text, props.query)}>
            {(part) => (part.match ? <span style={{ fg: props.fg, underline: true }}>{part.text}</span> : part.text)}
        </For>
    )
}

function setPromptInput(prompt: TuiPromptRef, input: string) {
    prompt.set({ ...prompt.current, input })
}

function selectedText(theme: PromptContext["api"]["theme"]["current"]) {
    if (theme.background.a !== 0) return theme.background

    const { r, g, b } = theme.primary
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
}
