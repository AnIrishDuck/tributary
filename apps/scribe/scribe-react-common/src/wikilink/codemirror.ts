import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import type { Extension } from '@codemirror/state'

const bracketMark = Decoration.mark({ class: 'cm-wikilink-bracket' })
const titleMark = Decoration.mark({ class: 'cm-wikilink-title' })
const pipeMark = Decoration.mark({ class: 'cm-wikilink-pipe' })
const displayMark = Decoration.mark({ class: 'cm-wikilink-display' })

// Matches [[Title]] and [[Title|Display Text]]
const wikilinkPattern = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to)
    let match: RegExpExecArray | null
    wikilinkPattern.lastIndex = 0

    while ((match = wikilinkPattern.exec(text)) !== null) {
      const start = from + match.index
      const titleText = match[1]
      const displayText = match[2]

      // Opening [[
      builder.add(start, start + 2, bracketMark)

      if (displayText !== undefined) {
        // Title portion
        builder.add(start + 2, start + 2 + titleText.length, titleMark)
        // Pipe
        builder.add(start + 2 + titleText.length, start + 2 + titleText.length + 1, pipeMark)
        // Display text
        builder.add(start + 2 + titleText.length + 1, start + 2 + titleText.length + 1 + displayText.length, displayMark)
      } else {
        // Title only
        builder.add(start + 2, start + 2 + titleText.length, titleMark)
      }

      // Closing ]]
      const end = start + match[0].length
      builder.add(end - 2, end, bracketMark)
    }
  }

  return builder.finish()
}

const wikilinkViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

const wikilinkTheme = EditorView.baseTheme({
  '.cm-wikilink-bracket': {
    color: '#9ca3af',
  },
  '.cm-wikilink-title': {
    color: '#2563eb',
    fontWeight: '500',
  },
  '.cm-wikilink-pipe': {
    color: '#9ca3af',
  },
  '.cm-wikilink-display': {
    color: '#7c3aed',
    fontWeight: '500',
  },
})

export const wikilinkExtension: Extension = [wikilinkViewPlugin, wikilinkTheme]
