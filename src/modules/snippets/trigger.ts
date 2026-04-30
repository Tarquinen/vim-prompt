import type { HashtagTriggerMatch, SnippetInfo } from "./types"

const HASHTAG_TRIGGER = /(^|\s)#([^\s#]*)$/

export function findTrailingHashtagTrigger(input: string): HashtagTriggerMatch | undefined {
    const match = HASHTAG_TRIGGER.exec(input)
    if (!match) return undefined

    const query = match[2] ?? ""
    const leading = match[1] ?? ""
    const start = input.length - query.length - 1

    return {
        start: start - (leading ? 0 : 0),
        end: input.length,
        query,
        token: `#${query}`,
    }
}

export function insertSnippetTag(input: string, name: string) {
    const match = findTrailingHashtagTrigger(input)
    if (match) return `${input.slice(0, match.start)}#${name} `
    const separator = input.length === 0 || /\s$/.test(input) ? "" : " "
    return `${input}${separator}#${name} `
}

export function preferredSnippetTag(input: string, snippet: SnippetInfo) {
    const query = findTrailingHashtagTrigger(input)?.query.toLowerCase()
    if (query && snippet.aliases.some((alias) => alias.toLowerCase() === query)) return query
    return snippet.name
}
