// Pure UI constants. No `$`, no engine imports.

export const PANE_ID = 'conductor'
export const PANE_TITLE = 'Conductor'

export const GLYPH = {
  dot: '●',
  diamond: '◆',
  diamondOpen: '◇',
  rail: '│',
  railBranch: '├',
  railEnd: '╰',
  done: '✓',
  lint: '▲',
} as const

export type GlyphName = keyof typeof GLYPH
