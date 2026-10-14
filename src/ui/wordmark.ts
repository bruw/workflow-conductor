// The splash's wordmark: Conductor drawn as pixels, painted like the persona
// (half-blocks: a pixel is half a cell tall). No `$`, no engine imports.

import { paintPixels } from './persona'
import type { PersonaSpan } from './persona'

/** Rows of pixels, `#` the body: eight to a letter, the small letters from the third down. */
type Glyph = readonly string[]

const HEIGHT = 8
const NONE = ['', ''] as const
const rows = (row: string, count: number): string[] => Array.from({ length: count }, () => row)

const GLYPHS: Record<string, Glyph> = {
  C: [' ####', '#####', ...rows('##', 4), '#####', ' ####'],
  o: [...NONE, '#####', '#####', ...rows('## ##', 2), '#####', ' ### '],
  n: [...NONE, '#### ', '#####', ...rows('## ##', 4)],
  d: ['   ##', '   ##', '#####', '#####', ...rows('## ##', 2), '#####', ' ####'],
  u: [...NONE, ...rows('## ##', 4), '#####', ' ####'],
  c: [...NONE, ' ####', '#####', ...rows('##', 2), '#####', ' ####'],
  t: [' ##', ' ##', '####', '####', ...rows(' ##', 2), ' ###', '  ##'],
  r: [...NONE, ' ###', '####', ...rows('##', 4)],
}

const WORD = 'Conductor'
/** Pixels between two letters. */
const GAP = 1

export function wordmark(): { lines: PersonaSpan[][]; width: number } {
  const canvas: string[][] = Array.from({ length: HEIGHT }, () => [])
  ;[...WORD].forEach((letter, at) => {
    const glyph = GLYPHS[letter] ?? []
    const width = Math.max(...glyph.map(row => row.length)) + (at < WORD.length - 1 ? GAP : 0)
    canvas.forEach((row, y) => row.push(...(glyph[y] ?? '').padEnd(width)))
  })
  return { lines: paintPixels(canvas), width: canvas[0]?.length ?? 0 }
}
