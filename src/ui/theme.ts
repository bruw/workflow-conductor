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

/**
 * Each block type's border colour on the flow board, as theme keys: kinds of
 * block are told apart at a glance, the type word in the header says which.
 * `success` and `error` are left to run outcomes; `claude` to what the pointer
 * can press (`edit`, `del`, a `+` in use). The selection has no hue of its own:
 * it is the heavy border and the bold title, in the type's colour. No type is
 * dim (`inactive`, `subtle`): dim is a block a run never reached.
 */
export const ACCENT = {
  agent: 'text',
  pipeline: 'suggestion',
  parallel: 'autoAccept',
  sweep: 'autoAccept',
  loop: 'planMode',
  'loop-until-dry': 'planMode',
  branch: 'bashBorder',
  subworkflow: 'merged',
  code: 'ide',
  verify: 'permission',
  'judge-panel': 'permission',
  critic: 'permission',
} as const
