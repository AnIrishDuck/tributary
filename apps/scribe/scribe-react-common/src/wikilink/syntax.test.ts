import { describe, it, expect } from 'vitest'
import { micromark } from 'micromark'
import { wikilinkSyntax, wikilinkHtml } from './syntax'

function parse(input: string): string {
  return micromark(input, {
    extensions: [wikilinkSyntax()],
    htmlExtensions: [wikilinkHtml()]
  })
}

describe('wikilink micromark extension', () => {
  it('should parse simple wikilink', () => {
    const result = parse('[[My Note]]')
    expect(result).toContain('<a href="wikilink:My Note" class="wikilink">My Note</a>')
  })

  it('should parse wikilink with pipe display text', () => {
    const result = parse('[[My Note|click here]]')
    expect(result).toContain('<a href="wikilink:My Note" class="wikilink">click here</a>')
  })

  it('should parse wikilink inline with text', () => {
    const result = parse('See [[My Note]] for details')
    expect(result).toContain('See ')
    expect(result).toContain('<a href="wikilink:My Note" class="wikilink">My Note</a>')
    expect(result).toContain(' for details')
  })

  it('should parse multiple wikilinks', () => {
    const result = parse('[[Note A]] and [[Note B]]')
    expect(result).toContain('<a href="wikilink:Note A" class="wikilink">Note A</a>')
    expect(result).toContain('<a href="wikilink:Note B" class="wikilink">Note B</a>')
  })

  it('should not parse empty brackets [[]]', () => {
    const result = parse('[[]]')
    expect(result).not.toContain('wikilink')
    expect(result).toContain('[[]]')
  })

  it('should not parse single brackets [text]', () => {
    const result = parse('[text]')
    expect(result).not.toContain('wikilink')
  })

  it('should not parse unclosed wikilink', () => {
    const result = parse('[[unclosed')
    expect(result).not.toContain('wikilink')
  })

  it('should not parse wikilink with only one closing bracket', () => {
    const result = parse('[[half]')
    expect(result).not.toContain('wikilink')
  })

  it('should not parse empty display text [[Title|]]', () => {
    const result = parse('[[Title|]]')
    expect(result).not.toContain('class="wikilink"')
  })

  it('should handle wikilink with special characters in title', () => {
    const result = parse('[[Note & "Stuff"]]')
    expect(result).toContain('class="wikilink"')
    expect(result).toContain('Note &amp; &quot;Stuff&quot;')
  })

  it('should handle wikilink with spaces', () => {
    const result = parse('[[  spaced  ]]')
    expect(result).toContain('<a href="wikilink:  spaced  " class="wikilink">  spaced  </a>')
  })

  it('should not span across line breaks', () => {
    const result = parse('[[broken\nlink]]')
    expect(result).not.toContain('class="wikilink"')
  })
})
