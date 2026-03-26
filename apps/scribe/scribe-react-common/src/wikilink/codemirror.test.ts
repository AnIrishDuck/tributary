import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { wikilinkExtension } from './codemirror'

function createView(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [wikilinkExtension]
  })
  // Use a minimal DOM container
  const container = document.createElement('div')
  return new EditorView({ state, parent: container })
}

describe('wikilink codemirror extension', () => {
  it('should apply decorations to simple wikilink', () => {
    const view = createView('Hello [[My Note]] world')
    // The extension creates decorations — verify class names are present in the DOM
    const brackets = view.dom.querySelectorAll('.cm-wikilink-bracket')
    const titles = view.dom.querySelectorAll('.cm-wikilink-title')
    expect(brackets.length).toBe(2) // [[ and ]]
    expect(titles.length).toBe(1)
    expect(titles[0].textContent).toBe('My Note')
    view.destroy()
  })

  it('should apply decorations to wikilink with pipe syntax', () => {
    const view = createView('See [[Title|display text]] here')
    const brackets = view.dom.querySelectorAll('.cm-wikilink-bracket')
    const titles = view.dom.querySelectorAll('.cm-wikilink-title')
    const pipes = view.dom.querySelectorAll('.cm-wikilink-pipe')
    const displays = view.dom.querySelectorAll('.cm-wikilink-display')
    expect(brackets.length).toBe(2)
    expect(titles.length).toBe(1)
    expect(titles[0].textContent).toBe('Title')
    expect(pipes.length).toBe(1)
    expect(pipes[0].textContent).toBe('|')
    expect(displays.length).toBe(1)
    expect(displays[0].textContent).toBe('display text')
    view.destroy()
  })

  it('should handle multiple wikilinks', () => {
    const view = createView('[[A]] and [[B]]')
    const titles = view.dom.querySelectorAll('.cm-wikilink-title')
    expect(titles.length).toBe(2)
    expect(titles[0].textContent).toBe('A')
    expect(titles[1].textContent).toBe('B')
    view.destroy()
  })

  it('should not decorate regular brackets', () => {
    const view = createView('Just [single] brackets')
    const brackets = view.dom.querySelectorAll('.cm-wikilink-bracket')
    expect(brackets.length).toBe(0)
    view.destroy()
  })

  it('should not decorate empty wikilinks [[]]', () => {
    const view = createView('Empty [[]] here')
    const titles = view.dom.querySelectorAll('.cm-wikilink-title')
    expect(titles.length).toBe(0)
    view.destroy()
  })
})
