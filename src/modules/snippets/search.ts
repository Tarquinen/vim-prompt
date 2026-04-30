import type { SnippetInfo } from "./types"

export type HighlightPart = {
    text: string
    match: boolean
}

function normalizeSearchText(input: string) {
    return input.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function scoreText(input: string, query: string) {
    const raw = input.toLowerCase()
    const compact = normalizeSearchText(input)
    const normalizedQuery = query.toLowerCase()
    const compactQuery = normalizeSearchText(query)

    if (raw === normalizedQuery) return 0
    if (compact === compactQuery) return 1
    if (raw.startsWith(normalizedQuery)) return 2
    if (compact.startsWith(compactQuery)) return 3
    if (raw.includes(normalizedQuery)) return 4
    if (compact.includes(compactQuery)) return 5
    return Number.POSITIVE_INFINITY
}

function snippetDescription(snippet: SnippetInfo) {
    return (snippet.description || snippet.content).replace(/\s+/g, " ").trim()
}

function scoreSnippet(snippet: SnippetInfo, query: string) {
    if (!query) return 0

    const nameScore = Math.min(scoreText(snippet.name, query), ...snippet.aliases.map((alias) => scoreText(alias, query)))
    if (Number.isFinite(nameScore)) return nameScore

    const description = snippetDescription(snippet).toLowerCase()
    const lowerQuery = query.toLowerCase()
    if (description.startsWith(lowerQuery)) return 6
    if (description.includes(lowerQuery)) return 7
    return Number.POSITIVE_INFINITY
}

function sourceRank(snippet: SnippetInfo) {
    return snippet.source === "project" ? 0 : 1
}

export function filterSnippets(snippets: SnippetInfo[], query: string) {
    return snippets
        .map((snippet) => ({ snippet, score: scoreSnippet(snippet, query) }))
        .filter((entry) => Number.isFinite(entry.score))
        .sort((left, right) => left.score - right.score || sourceRank(left.snippet) - sourceRank(right.snippet) || left.snippet.name.localeCompare(right.snippet.name))
        .map((entry) => entry.snippet)
}

export function matchedAliases(snippet: SnippetInfo, query: string) {
    if (!query) return []
    return snippet.aliases.filter((alias) => Number.isFinite(scoreText(alias, query)))
}

export function describeSnippet(snippet: SnippetInfo) {
    return snippetDescription(snippet)
}

export function highlightMatches(input: string, query: string): HighlightPart[] {
    if (!query) return [{ text: input, match: false }]

    const index = input.toLowerCase().indexOf(query.toLowerCase())
    if (index < 0) return [{ text: input, match: false }]

    return [
        { text: input.slice(0, index), match: false },
        { text: input.slice(index, index + query.length), match: true },
        { text: input.slice(index + query.length), match: false },
    ].filter((part) => part.text.length > 0)
}
