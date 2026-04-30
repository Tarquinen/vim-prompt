import type { TuiPromptInfo, TuiPromptRef } from "@opencode-ai/plugin/tui"
import type { PromptContext } from "../../prompt/types"
import type { createVimState } from "./state"

export type VimOperator = "delete" | "change"
export type VimOperatorState = { operator: VimOperator; object?: "inner" }

type VimState = ReturnType<typeof createVimState>
type TextRange = { start: number; end: number }
type InputLike = {
    cursorOffset?: number
    plainText?: string
}

export function handleOperatorKey(key: string, state: VimState, ctx: PromptContext) {
    if (state.mode() !== "normal") return false

    const pending = state.operator()
    if (!pending) {
        const operator = operatorForKey(key)
        if (!operator) return false
        state.setOperator({ operator })
        return true
    }

    if (!pending.object && key === "i") {
        state.setOperator({ ...pending, object: "inner" })
        return true
    }

    const applied = applyPendingOperator(key, pending, state, ctx)
    if (applied) state.setOperator(undefined)
    return applied
}

export function clearOperator(state: VimState) {
    state.setOperator(undefined)
}

function applyPendingOperator(key: string, pending: VimOperatorState, state: VimState, ctx: PromptContext) {
    const ref = ctx.prompt()
    const input = inputLike(ctx)
    if (!ref || !input) return false

    const range = pending.object ? objectRange(input, key) : motionRange(input, key)
    if (!range) return false

    applyOperator(ref, input, pending.operator, range, state)
    return true
}

function operatorForKey(key: string): VimOperator | undefined {
    if (key === "d") return "delete"
    if (key === "c") return "change"
    return undefined
}

function motionRange(input: InputLike, key: string): TextRange | undefined {
    if (key === "w") return rangeToWordNext(input)
    if (key === "e") return rangeToWordEnd(input)
    if (key === "b") return rangeToWordPrev(input)
    return undefined
}

function objectRange(input: InputLike, key: string): TextRange | undefined {
    if (key !== "w") return undefined
    return innerWordRange(input)
}

function applyOperator(ref: TuiPromptRef, input: InputLike, operator: VimOperator, range: TextRange, state: VimState) {
    const text = input.plainText ?? ref.current.input
    const start = clamp(range.start, 0, text.length)
    const end = clamp(range.end, start, text.length)
    const next = `${text.slice(0, start)}${text.slice(end)}`

    ref.set(toPromptInfo(ref, next))
    const nextOffset = clamp(start, 0, next.length)
    input.cursorOffset = nextOffset

    if (operator === "change") {
        state.setMode("insert")
        ref.focus()
    }
}

function rangeToWordNext(input: InputLike): TextRange | undefined {
    const state = textState(input)
    if (!state) return undefined
    const end = nextWordStart(state.text, state.offset)
    if (end === undefined) return rangeToWordEnd(input)
    if (end === state.offset) return undefined
    return orderedRange(state.offset, end)
}

function rangeToWordEnd(input: InputLike): TextRange | undefined {
    const state = textState(input)
    if (!state) return undefined
    const end = nextWordEnd(state.text, state.offset)
    if (end === undefined) return undefined
    return orderedRange(state.offset, end + 1)
}

function rangeToWordPrev(input: InputLike): TextRange | undefined {
    const state = textState(input)
    if (!state) return undefined
    const start = previousWordStart(state.text, state.offset)
    if (start === undefined || start === state.offset) return undefined
    return orderedRange(start, state.offset)
}

function innerWordRange(input: InputLike): TextRange | undefined {
    const state = textState(input)
    if (!state) return undefined
    const index = wordIndexAt(state.text, state.offset)
    if (index === undefined) return undefined

    let start = index
    while (start > 0 && isWordChar(state.text[start - 1])) start--

    let end = index + 1
    while (end < state.text.length && isWordChar(state.text[end])) end++

    return { start, end }
}

function textState(input: InputLike) {
    if (input.cursorOffset === undefined || input.plainText === undefined) return undefined
    return {
        text: input.plainText,
        offset: clamp(input.cursorOffset, 0, input.plainText.length),
    }
}

function nextWordStart(text: string, offset: number) {
    let index = Math.min(offset + 1, text.length)
    while (index < text.length && isWordChar(text[index])) index++
    while (index < text.length && !isWordChar(text[index])) index++
    return index < text.length ? index : undefined
}

function nextWordEnd(text: string, offset: number) {
    let index = Math.min(offset, text.length - 1)
    if (isWordChar(text[index]) && isWordChar(text[index + 1])) {
        while (index + 1 < text.length && isWordChar(text[index + 1])) index++
        return index
    }

    index++
    while (index < text.length && !isWordChar(text[index])) index++
    if (index >= text.length) return undefined
    while (index + 1 < text.length && isWordChar(text[index + 1])) index++
    return index
}

function previousWordStart(text: string, offset: number) {
    let index = Math.min(offset - 1, text.length - 1)
    while (index >= 0 && !isWordChar(text[index])) index--
    if (index < 0) return undefined
    while (index > 0 && isWordChar(text[index - 1])) index--
    return index
}

function wordIndexAt(text: string, offset: number) {
    let index = clamp(offset, 0, Math.max(0, text.length - 1))
    if (isWordChar(text[index])) return index
    while (index < text.length && !isWordChar(text[index])) index++
    return index < text.length ? index : undefined
}

function inputLike(ctx: PromptContext): InputLike | undefined {
    const focused = ctx.api.renderer.currentFocusedRenderable as InputLike | null | undefined
    if (focused?.cursorOffset === undefined || focused.plainText === undefined) return undefined
    return focused
}

function orderedRange(start: number, end: number): TextRange {
    return start <= end ? { start, end } : { start: end, end: start }
}

function isWordChar(value: string | undefined) {
    return !!value && /\S/.test(value)
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value))
}

function toPromptInfo(ref: TuiPromptRef, input: string): TuiPromptInfo {
    return {
        input,
        mode: ref.current.mode,
        parts: [...ref.current.parts],
    }
}
