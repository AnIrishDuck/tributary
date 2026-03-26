import type {
  Extension,
  HtmlExtension,
  Tokenizer,
  State,
  Code,
  CompileContext,
  Token
} from 'micromark-util-types'

// Token types for wikilinks
declare module 'micromark-util-types' {
  interface TokenTypeMap {
    wikilink: 'wikilink'
    wikilinkMarker: 'wikilinkMarker'
    wikilinkTitle: 'wikilinkTitle'
    wikilinkSeparator: 'wikilinkSeparator'
    wikilinkDisplay: 'wikilinkDisplay'
  }
}

const wikilinkTokenize: Tokenizer = function (effects, ok, nok) {
  const self = this

  const start: State = function (code) {
    // First `[`
    effects.enter('wikilink')
    effects.enter('wikilinkMarker')
    effects.consume(code)
    return openBracket2
  }

  const openBracket2: State = function (code) {
    // Second `[`
    if (code !== 91) return nok(code) // not `[`
    effects.consume(code)
    effects.exit('wikilinkMarker')
    effects.enter('wikilinkTitle')
    return titleStart
  }

  const titleStart: State = function (code) {
    // Empty `[[]]` is invalid
    if (code === 93 || code === null || code === -5 || code === -4 || code === -3) {
      return nok(code)
    }
    return titleContent(code)
  }

  const titleContent: State = function (code) {
    // `]` — might be closing
    if (code === 93) {
      effects.exit('wikilinkTitle')
      effects.enter('wikilinkMarker')
      effects.consume(code)
      return closeBracket2
    }
    // `|` — separator between title and display text
    if (code === 124) {
      effects.exit('wikilinkTitle')
      effects.enter('wikilinkSeparator')
      effects.consume(code)
      effects.exit('wikilinkSeparator')
      effects.enter('wikilinkDisplay')
      return displayStart
    }
    // EOF or line ending — invalid
    if (code === null || code === -5 || code === -4 || code === -3) {
      return nok(code)
    }
    effects.consume(code)
    return titleContent
  }

  const displayStart: State = function (code) {
    // Empty display `[[Title|]]` is invalid
    if (code === 93 || code === null || code === -5 || code === -4 || code === -3) {
      return nok(code)
    }
    return displayContent(code)
  }

  const displayContent: State = function (code) {
    if (code === 93) {
      effects.exit('wikilinkDisplay')
      effects.enter('wikilinkMarker')
      effects.consume(code)
      return closeBracket2
    }
    if (code === null || code === -5 || code === -4 || code === -3) {
      return nok(code)
    }
    effects.consume(code)
    return displayContent
  }

  const closeBracket2: State = function (code) {
    if (code !== 93) return nok(code) // not `]`
    effects.consume(code)
    effects.exit('wikilinkMarker')
    effects.exit('wikilink')
    return ok
  }

  return start
}

/**
 * Micromark syntax extension for wikilinks (`[[Title]]` and `[[Title|Display]]`).
 */
export function wikilinkSyntax(): Extension {
  return {
    text: {
      91: { // `[` character code
        name: 'wikilink',
        tokenize: wikilinkTokenize
      }
    }
  }
}

/**
 * Micromark HTML extension for wikilinks.
 *
 * Produces `<a href="wikilink:Title" class="wikilink">` tags using the
 * `wikilink:` URI scheme as a placeholder for later resolution.
 */
export function wikilinkHtml(): HtmlExtension {
  let title = ''
  let display = ''

  return {
    enter: {
      wikilink(this: CompileContext) {
        title = ''
        display = ''
        return undefined
      }
    },
    exit: {
      wikilinkTitle(this: CompileContext, token: Token) {
        title = this.sliceSerialize(token)
        return undefined
      },
      wikilinkDisplay(this: CompileContext, token: Token) {
        display = this.sliceSerialize(token)
        return undefined
      },
      wikilink(this: CompileContext) {
        const text = display || title
        this.tag(`<a href="wikilink:${encodeWikilinkTitle(title)}" class="wikilink">`)
        this.raw(this.encode(text))
        this.tag('</a>')
        return undefined
      }
    }
  }
}

/**
 * Encode a wikilink title for use in the `wikilink:` URI.
 * We keep the title mostly as-is but encode characters that would
 * break the HTML attribute.
 */
function encodeWikilinkTitle(title: string): string {
  return title.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
