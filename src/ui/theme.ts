// Pure UI constants. No `$`, no engine imports.

export const PANE_ID = 'conductor'
export const PANE_TITLE = 'Conductor'

/** Plain words: the theme's own text. A `Text` with no colour takes the terminal's, which a light theme on a dark terminal draws white on the pane's light ground. */
export const TEXT = 'text'
/** Quiet words: the dim that still reads on any terminal background. */
export const FADED = 'inactive'
/** Lines that are not words: a leaf's border, the rule between two parts of the pane. */
export const RULE = 'subtle'
/** The `[+]` a new block goes to. */
export const ACTIVE = 'claude'

export const GLYPH = {
  dot: '●',
  diamond: '◆',
  rail: '│',
  railBranch: '├',
  railEnd: '╰',
  done: '✓',
  elbow: '⎿',
} as const

/** Theme keys. `claude` is left to the selection and to what can be pressed, `success` and `error` to run outcomes; no type is `FADED`, which is a block a run never reached. */
export const ACCENT = {
  agent: 'text',
  pipeline: 'suggestion',
  parallel: 'autoAccept',
  loop: 'planMode',
  branch: 'warning',
  subworkflow: 'merged',
  code: 'ide',
  start: 'bashBorder',
} as const

/** `ACCENT` while a run is drawn, so only the run is in colour: an accent light on the default dark theme stays `text`, a darker one is `inactive`, a block the run never reached `subtle`. Theme keys follow any theme, but one that orders its accents otherwise keeps this order. */
export const GRAY: Record<keyof typeof ACCENT, string> = {
  agent: 'text',
  pipeline: 'text',
  parallel: 'inactive',
  loop: 'inactive',
  branch: 'text',
  subworkflow: 'inactive',
  code: 'inactive',
  start: 'inactive',
}
export const GRAY_FADED = 'subtle'
