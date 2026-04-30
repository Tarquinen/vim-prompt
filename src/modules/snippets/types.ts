export type SnippetSource = "global" | "project"

export type SnippetInfo = {
    name: string
    content: string
    aliases: string[]
    description?: string
    filePath: string
    source: SnippetSource
}

export type HashtagTriggerMatch = {
    start: number
    end: number
    query: string
    token: string
}

export type SnippetController = {
    chooseActive?: () => boolean
}
