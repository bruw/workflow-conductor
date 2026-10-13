// Text measured, cleaned, cut and wrapped in terminal cells: what the graph's
// layout, its paint, the rail, the detail pane and the help pages share. Pure
// TypeScript: no `$`, no engine imports.
//
// A cell is one column of the terminal. What is drawn is a grapheme (a letter
// with its marks, an emoji sequence): none, one or two cells wide.

/** Every UTF-16 unit of these is one grapheme, one cell wide: ASCII, Latin, the punctuation, arrows, box lines and spinners the pane is drawn in. */
const PLAIN = /^[\x20-\x7e\u00a0-\u00ac\u00ae-\u02ff\u2010-\u2027\u2030-\u205e\u2190-\u22ff\u2500-\u25fc\u2800-\u28ff]*$/

/** Whether `text` is one cell to a UTF-16 unit: its width is its length, and any slice of it is whole. */
export function plainCells(text: string): boolean {
  return PLAIN.test(text)
}

/** Takes no cell: combining marks, controls, format characters (the joiner and the variation selectors among them). */
const ZERO = /^[\p{Mn}\p{Me}\p{Cc}\p{Cf}\u1160-\u11ff\ud7b0-\ud7ff]$/u
const EMOJI = /^\p{Emoji_Presentation}$/u
/** Drawn as an emoji, two cells, when U+FE0F follows it. */
const PICTURE = /^[\p{Extended_Pictographic}#*0-9]$/u
const VS16 = 0xfe0f

/** East Asian Wide and Fullwidth, less the emoji (`EMOJI` has those): first and last code point of each range, in order. */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x17000, 0x18cff],
  [0x1aff0, 0x1b2ff],
  [0x1f200, 0x1f2ff],
  [0x20000, 0x3fffd],
]

function isWide(code: number): boolean {
  if (code < 0x1100) return false
  for (const [from, to] of WIDE) if (code <= to) return code >= from
  return false
}

const isFlagHalf = (code: number): boolean => code >= 0x1f1e6 && code <= 0x1f1ff

/** The cells one grapheme takes: 0, 1 or 2. */
function graphemeWidth(grapheme: string): number {
  if (grapheme.length === 1) {
    const code = grapheme.charCodeAt(0)
    if (code >= 0x20 && code < 0x7f) return 1
  }
  let width = 0
  let picture = false
  let flags = 0
  for (const char of grapheme) {
    const code = char.codePointAt(0) ?? 0
    if (code === VS16 && picture) return 2
    if (width > 0 && !isFlagHalf(code)) continue
    if (ZERO.test(char)) continue
    if (isFlagHalf(code)) {
      // Two regional indicators are one flag; one alone is a letter.
      if (++flags === 2) return 2
      width = 1
      continue
    }
    if (isWide(code) || EMOJI.test(char)) return 2
    picture = PICTURE.test(char)
    width = 1
  }
  return width
}

// One for the module: making one costs more than a row's worth of text. Null where the runtime has none.
let segmenter: Intl.Segmenter | null | undefined

/** `text` as graphemes. With no segmenter: code points, each mark joined to the one before it. */
function graphemesOf(text: string): string[] {
  if (segmenter === undefined) segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  const out: string[] = []
  if (segmenter !== null) {
    for (const part of segmenter.segment(text)) out.push(part.segment)
    return out
  }
  for (const char of text) {
    const last = out.length - 1
    if (last >= 0 && ZERO.test(char)) out[last] += char
    else out.push(char)
  }
  return out
}

export type Glyph = { text: string; width: number }

/** `text` as what is drawn of it, in order: each grapheme and the cells it takes (0, 1 or 2). */
export function glyphs(text: string): Glyph[] {
  if (plainCells(text)) return Array.from(text, char => ({ text: char, width: 1 }))
  return graphemesOf(text).map(one => ({ text: one, width: graphemeWidth(one) }))
}

/** The cells `text` takes on a row of the terminal. */
export function cellWidth(text: string): number {
  if (plainCells(text)) return text.length
  let width = 0
  for (const one of graphemesOf(text)) width += graphemeWidth(one)
  return width
}

/** The start of `text` that fits `max` cells: whole graphemes only, so it may be a cell short. */
export function cutCells(text: string, max: number): string {
  if (max <= 0) return ''
  if (plainCells(text)) return text.length > max ? text.slice(0, max) : text
  let out = ''
  let width = 0
  for (const one of graphemesOf(text)) {
    width += graphemeWidth(one)
    if (width > max) break
    out += one
  }
  return out
}

/** `text` with spaces after it, up to `width` cells; as it is when it has them already. */
export function padCells(text: string, width: number): string {
  return `${text}${' '.repeat(Math.max(0, Math.trunc(width) - cellWidth(text)))}`
}

/**
 * What must not reach a terminal from text this mod did not write (a project file, an agent's label): the C0 controls
 * but the white space (tab to carriage return, which every caller breaks or collapses), DEL, C1, the marks that turn
 * or isolate the direction of text, and the format characters that take no cell. The joiner and the variation
 * selectors of an emoji sequence stay. Half a surrogate pair is `\ufffd`.
 */
const UNSAFE = /[\x00-\x08\x0e-\x1f\x7f-\x9f\u00ad\u061c\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff\ufff9-\ufffb]/g
/** A whole pair, which is kept, or the half of one. */
const SURROGATES = /[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g

/** `text` as it can be shown: `UNSAFE` left out. For display only: what is stored is never changed by it. */
export function sanitize(text: string): string {
  if (plainCells(text)) return text
  return text.replace(UNSAFE, '').replace(SURROGATES, pair => (pair.length === 2 ? pair : '\ufffd'))
}

/** `text` on one line, as it can be shown: sanitised, each run of white space (a line break too) one space. */
export function oneLine(text: string): string {
  return sanitize(text).replace(/\s+/g, ' ').trim()
}

/** `text` in at most `max` cells: cut, it ends in `…`. */
export function clip(text: string, max: number): string {
  if (max <= 0) return ''
  return cellWidth(text) > max ? `${cutCells(text, max - 1)}…` : text
}

/** `text` as lines no wider than `width` cells, broken between words; a word longer than a line is cut, between two graphemes. */
export function wrapText(text: string, width: number): string[] {
  const room = Math.max(1, Math.trunc(width))
  const out: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    let used = 0
    for (let word of paragraph.split(/\s+/).filter(one => one !== '')) {
      let wide = cellWidth(word)
      if (line !== '' && used + 1 + wide <= room) {
        line += ` ${word}`
        used += 1 + wide
        continue
      }
      if (line !== '') out.push(line)
      while (wide > room) {
        // A grapheme wider than the line is all there is room for: it takes a line to itself.
        const head = cutCells(word, room) || (glyphs(word)[0]?.text ?? word)
        out.push(head)
        word = word.slice(head.length)
        wide = cellWidth(word)
      }
      line = word
      used = wide
    }
    if (line !== '') out.push(line)
  }
  return out
}

/** At most `max` lines of `text`: the last one ends in `…` when there is more. */
export function firstLines(text: string, width: number, max: number): string[] {
  const all = wrapText(text, width)
  if (all.length <= max) return all
  const shown = all.slice(0, max)
  const last = shown[max - 1] ?? ''
  if (max > 0) shown[max - 1] = cellWidth(last) + 1 > width ? `${cutCells(last, Math.max(0, width - 1))}…` : `${last}…`
  return shown
}

export function moreLines(count: number): string {
  return `… ${count} more ${count === 1 ? 'line' : 'lines'}`
}

/** All of `text` wrapped, or its first `max - 1` lines and a row saying how many more there are. */
export function cappedLines(text: string, width: number, max: number): { lines: string[]; more: number } {
  const all = wrapText(text, width)
  const most = Math.max(1, Math.trunc(max))
  if (all.length <= most) return { lines: all, more: 0 }
  const lines = all.slice(0, Math.max(1, most - 1))
  return { lines, more: all.length - lines.length }
}
