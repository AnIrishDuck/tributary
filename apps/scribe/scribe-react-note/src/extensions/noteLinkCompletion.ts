import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import {
  autocompletion,
  CompletionContext,
  CompletionResult,
  Completion,
} from '@codemirror/autocomplete'
import { TributaryLocal } from 'tributary-client'
import { suggestSlugs, suggestByTitlePrefix } from 'scribe-data'
import type { SlugSuggestion } from 'scribe-data'

const MAX_SUGGESTIONS = 3

/**
 * Theme for note-link autocomplete icons.
 * Uses the CodeMirror completionIcon-{type} convention to show
 * entity-type icons to the left of each suggestion.
 */
const noteLinkCompletionTheme = EditorView.baseTheme({
  '.cm-completionIcon-note': {
    '&::after': { content: "'\\1F4DD'" }, // memo / note
  },
  '.cm-completionIcon-collection': {
    '&::after': { content: "'\\1F4C1'" }, // folder
  },
  '.cm-completionIcon-image': {
    '&::after': { content: "'\\1F5BC'" }, // framed picture
  },
})

/**
 * Configuration for the note-link autocomplete extension.
 */
export interface NoteLinkCompletionConfig {
  /** Async function that returns the local DB instance. */
  getDb: () => Promise<TributaryLocal | null>
  /** Async function that returns the library (root collection) UUID. */
  getLibraryUuid: () => Promise<string | null>
  /**
   * The current note's slug path (e.g. "cooking/italian/pasta").
   * Used for resolving relative links (./  ../).
   */
  noteSlugPath?: string
}

/**
 * Parse the context around the cursor to detect if we're inside a markdown
 * link target `[text](cursor)` or a wikilink `[[cursor`.
 *
 * Returns null if the cursor is not in a completable position.
 */
export interface LinkContext {
  type: 'markdown-link' | 'wikilink'
  /** The partial text the user has typed so far. */
  prefix: string
  /** Start position of the prefix in the document. */
  from: number
}

export function detectLinkContext(ctx: CompletionContext): LinkContext | null {
  const { state, pos } = ctx
  // Look at text from start of line to cursor
  const line = state.doc.lineAt(pos)
  const lineTextToCursor = state.sliceDoc(line.from, pos)

  // Check for wikilink: find the last [[ that isn't closed by ]]
  const lastWikilinkOpen = lineTextToCursor.lastIndexOf('[[')
  if (lastWikilinkOpen >= 0) {
    const afterOpen = lineTextToCursor.slice(lastWikilinkOpen + 2)
    // Not closed yet (no ]] after the [[)
    if (!afterOpen.includes(']]')) {
      // The prefix is everything after [[, but only the title part (before |)
      const pipeIdx = afterOpen.indexOf('|')
      if (pipeIdx < 0) {
        // Still typing the title part
        return {
          type: 'wikilink',
          prefix: afterOpen,
          from: line.from + lastWikilinkOpen + 2,
        }
      }
      // After the pipe = display text, no autocomplete needed there
      return null
    }
  }

  // Check for markdown link target: [text](cursor)
  // Find the last unclosed ( that's preceded by ](
  const lastParenOpen = lineTextToCursor.lastIndexOf('](')
  if (lastParenOpen >= 0) {
    const afterParen = lineTextToCursor.slice(lastParenOpen + 2)
    // Not closed yet
    if (!afterParen.includes(')')) {
      return {
        type: 'markdown-link',
        prefix: afterParen,
        from: line.from + lastParenOpen + 2,
      }
    }
  }

  return null
}

/**
 * Convert a partial slug link to absolute segments for suggestSlugs,
 * handling relative paths (./  ../) against the current note's collection.
 *
 * Returns null if the relative path is invalid (navigates above root).
 */
export function resolvePartialSlugToSegments(
  partialSlug: string,
  noteSlugPath?: string
): string[] | null {
  if (partialSlug.startsWith('/')) {
    // Absolute path: /cooking/ital → ['cooking', 'ital']
    return partialSlug.slice(1).split('/').filter(s => s.length > 0 || s === '')
  }

  if (partialSlug.startsWith('./') || partialSlug.startsWith('../')) {
    // Relative path: resolve against current note's collection
    if (!noteSlugPath) return null

    // Collection path = all segments except the last (which is the note slug)
    const currentSegments = noteSlugPath.split('/').filter(s => s)
    const collectionSegments = currentSegments.slice(0, -1)

    const parts = partialSlug.split('/')
    const result = [...collectionSegments]

    for (const part of parts) {
      if (part === '.' || part === '') {
        continue
      } else if (part === '..') {
        if (result.length === 0) return null
        result.pop()
      } else {
        result.push(part)
      }
    }

    // The last segment is the search prefix (possibly empty for "./")
    // but we need at least the empty string as the search prefix
    // Actually, suggestSlugs expects the last element to be the prefix.
    // When the user types "./", after resolution we have the collection segments
    // and need to append '' as the search prefix.
    // When they type "./pa", the last segment 'pa' is already in result.

    // If the partialSlug ends with '/', the user just navigated into a dir
    // and the search prefix is empty.
    if (partialSlug.endsWith('/')) {
      result.push('')
    }

    return result
  }

  // Bare slug: cooking/ital → ['cooking', 'ital']
  const segments = partialSlug.split('/')
  // If it ends with '/', add empty string as search prefix
  if (partialSlug.endsWith('/') && segments[segments.length - 1] === '') {
    // keep the trailing empty string
  }
  return segments
}

/**
 * Build the label and apply text for a slug suggestion.
 * For relative links, we show relative paths in the completion.
 */
export function buildSlugApplyText(
  suggestion: SlugSuggestion,
  partialSlug: string,
  noteSlugPath?: string
): string {
  // If the user started typing a relative path, complete with relative path
  if (partialSlug.startsWith('./') || partialSlug.startsWith('../')) {
    // We need to compute the relative path from the current note's collection
    // to the suggestion's absolute slug_path.
    // For simplicity, since we resolved forward, just replace the prefix
    // portion with the original relative prefix up to the last /.
    const lastSlash = partialSlug.lastIndexOf('/')
    const relativePrefix = partialSlug.slice(0, lastSlash + 1)

    // The suggestion.slug_path is absolute. We need to compute what comes
    // after the resolved parent.
    const currentSegments = noteSlugPath ? noteSlugPath.split('/').filter(s => s) : []
    const collectionSegments = currentSegments.slice(0, -1)

    // Walk the relative prefix to find the resolved parent
    const prefixParts = partialSlug.slice(0, lastSlash).split('/')
    const resolvedParent = [...collectionSegments]
    for (const part of prefixParts) {
      if (part === '.' || part === '') continue
      else if (part === '..') resolvedParent.pop()
      else resolvedParent.push(part)
    }

    const parentPath = resolvedParent.join('/')
    const suggestionPath = suggestion.slug_path
    // Strip the parent path prefix to get just the final segment
    const suffix = parentPath
      ? suggestionPath.slice(parentPath.length + 1)
      : suggestionPath
    return relativePrefix + suffix
  }

  if (partialSlug.startsWith('/')) {
    return '/' + suggestion.slug_path
  }

  // Bare slug: return the full slug path
  return suggestion.slug_path
}

function completionSource(config: NoteLinkCompletionConfig) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const linkCtx = detectLinkContext(ctx)
    if (!linkCtx) return null

    // Require at least 1 char or an explicit trigger
    if (linkCtx.prefix.length === 0 && !ctx.explicit) return null

    const db = await config.getDb()
    if (!db) return null

    if (linkCtx.type === 'wikilink') {
      const libraryUuid = await config.getLibraryUuid()
      if (!libraryUuid) return null

      const results = await suggestByTitlePrefix(db, linkCtx.prefix, {
        limit: MAX_SUGGESTIONS,
      })

      if (results.length === 0) return null

      const options: Completion[] = results.map((r) => ({
        label: r.title,
        type: r.entity_type,
        apply: r.title,
      }))

      return {
        from: linkCtx.from,
        options,
        filter: false,
      }
    }

    // markdown-link: suggest slugs
    const libraryUuid = await config.getLibraryUuid()
    if (!libraryUuid) return null

    const partialSlug = linkCtx.prefix

    // Skip external links (with protocol)
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(partialSlug)) return null
    // Skip tag links
    if (partialSlug.startsWith('#')) return null

    const segments = resolvePartialSlugToSegments(partialSlug, config.noteSlugPath)
    if (!segments) return null

    const suggestions = await suggestSlugs(db, segments, libraryUuid, {
      limit: MAX_SUGGESTIONS,
    })

    if (suggestions.length === 0) return null

    const options: Completion[] = suggestions.map((s) => ({
      label: s.title,
      detail: s.slug_path,
      type: s.type,
      apply: buildSlugApplyText(s, partialSlug, config.noteSlugPath),
    }))

    return {
      from: linkCtx.from,
      options,
      filter: false,
    }
  }
}

/**
 * Creates a CodeMirror extension that provides autocomplete suggestions
 * for note links (both markdown `[text](slug)` and wikilinks `[[Title]]`).
 *
 * Shows at most 3 suggestions as the user types.
 */
export function noteLinkCompletion(config: NoteLinkCompletionConfig): Extension {
  return [
    autocompletion({
      override: [completionSource(config)],
      icons: true,
    }),
    noteLinkCompletionTheme,
  ]
}
