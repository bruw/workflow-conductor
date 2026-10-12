// Pure UI constants. No `$`, no engine imports.

export const PANE_ID = 'conductor'
export const PANE_TITLE = 'Conductor'

/** Words said quietly (a note, a hint, a legend's word, an id, a `[+]` at rest): the dim that still reads on any terminal background. */
export const FADED = 'inactive'
/** Lines that are not words: a leaf's border, the rule between two parts of the pane. */
export const RULE = 'subtle'
/** The `[+]` a new block goes to: the one `n` would use, the one under the pointer, the one whose add list is open. */
export const ACTIVE = 'claude'

export const GLYPH = {
  dot: '●',
  diamond: '◆',
  rail: '│',
  railBranch: '├',
  railEnd: '╰',
  done: '✓',
} as const

/**
 * Each block type's accent on the graph, as theme keys: the type word on every
 * card, and a container's border (a leaf's border is quiet, `RULE`). `claude`
 * is left to the selection (the heavy border) and to what can be pressed (a
 * chip's digit, a carousel's gutter, the active `[+]`); `success` to run
 * outcomes; `error` to failures, the problem mark and `[not set]`. `warning`
 * is the branch's: beside a selected arm and its mark, its border and its
 * `IF` / `ELSE` read as neither. No type is dim (`FADED`): dim is a block a
 * run never reached. A container's border also says how it runs what it holds,
 * by its line: dashed for a chain, dotted for a stack, none for a phase.
 */
export const ACCENT = {
  agent: 'text',
  pipeline: 'suggestion',
  parallel: 'autoAccept',
  loop: 'planMode',
  branch: 'warning',
  subworkflow: 'merged',
  code: 'ide',
  args: 'bashBorder',
  phase: 'text',
} as const

/**
 * What a phase is drawn on in place of a border: a neutral ground one step off the pane's own, as a theme
 * key so that it follows the person's theme (the darkest tone of a dark theme, the lightest of a light one).
 * A phase in a phase goes back to the pane's own ground, so each is told from the one around it.
 */
export const PHASE_GROUND = 'inverseText'
