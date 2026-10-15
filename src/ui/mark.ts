// The header's mark: three blocks of a graph, the first feeding the other two, in colours that move round them.
// Blocks and box drawing only, which every terminal draws itself. No `$`, no engine imports; time is handed in.

import { ease } from './tween'

/** Its cells and a gap after them. */
export const MARK_W = 10
export const MARK_ROWS = 2

const CELLS = ['██─┬─██  ', '   └───██'] as const
/** Which block each cell belongs to: `a` the first, `b` and `c` the two it feeds, `1` its edge out, `2` and `3` theirs in. */
const PARTS = ['aa1┬2bb  ', '   ┬333cc'] as const

type Look = 'lead' | 'done' | 'wait'
type Part = 'a' | 'b' | 'c'
/** The lead walks the graph, what it has left is done, what is ahead waits; then all of it is done once. */
const STATES: readonly Record<Part, Look>[] = [
  { a: 'lead', b: 'wait', c: 'wait' },
  { a: 'done', b: 'lead', c: 'wait' },
  { a: 'done', b: 'done', c: 'lead' },
  { a: 'done', b: 'done', c: 'done' },
]
export const MARK_STATES = STATES.length

/** How long a state holds, and how long its colours take to become the next's. */
export const HOLD_MS = 1200
export const FADE_MS = 360
export const STEP_MS = HOLD_MS + FADE_MS

export type MarkPalette = Record<Look | 'line', string>

/** Raw colours, since a theme key cannot be blended: the persona's orange, the theme's success green, a grey for what waits. */
export const DARK: MarkPalette = { lead: '#d77757', done: '#4eba65', wait: '#5c5c5c', line: '#5c5c5c' }
export const LIGHT: MarkPalette = { lead: '#d77757', done: '#2c7a39', wait: '#b4b4b4', line: '#b4b4b4' }

export function markPalette(theme: string | undefined): MarkPalette {
  return theme?.startsWith('light') ? LIGHT : DARK
}

export type MarkSpan = { text: string; color?: string }

function lookOf(state: number, part: string): Look | 'line' {
  const looks = STATES[((state % MARK_STATES) + MARK_STATES) % MARK_STATES] ?? STATES[0]!
  if (part === 'a' || part === 'b' || part === 'c') return looks[part]
  // An edge takes the look of the block it leads into, the fork that of the first block; one into a block that waits is a line.
  const into: Part = part === '1' || part === '┬' ? 'a' : part === '2' ? 'b' : 'c'
  const look = looks[into]
  return look === 'wait' ? 'line' : look
}

/** A nudge: the fade to the next state starts now; one under way is cut short, its state taken as reached. */
export function nudged(state: number, ms: number): { state: number; ms: number } {
  const at = markAt(state, ms)
  return { state: at.t > 0 ? (at.state + 1) % MARK_STATES : at.state, ms: HOLD_MS }
}

const channels = (hex: string): number[] => [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16))

export function blend(from: string, to: string, t: number): string {
  if (t <= 0) return from
  if (t >= 1) return to
  const a = channels(from)
  const b = channels(to)
  return `#${a.map((value, at) => Math.round(value + ((b[at] ?? value) - value) * t).toString(16).padStart(2, '0')).join('')}`
}

/** The mark `t` of the way (0 to 1, eased here) from `state` to the one after it. */
export function markFrame(state: number, t: number, palette: MarkPalette): MarkSpan[][] {
  const eased = ease(t)
  return CELLS.map((row, y) => {
    const line: MarkSpan[] = []
    ;[...row].forEach((text, x) => {
      const part = PARTS[y]?.[x] ?? ' '
      const color = part === ' ' ? undefined : blend(palette[lookOf(state, part)], palette[lookOf(state + 1, part)], eased)
      const last = line[line.length - 1]
      if (last && last.color === color) last.text += text
      else line.push(color === undefined ? { text } : { text, color })
    })
    return line
  })
}

/** Where the cycle is `ms` into a state: the state, and how far its fade to the next has gone. */
export function markAt(state: number, ms: number): { state: number; t: number } {
  const steps = Math.max(0, Math.floor(ms / STEP_MS))
  const into = Math.max(0, ms - steps * STEP_MS)
  return { state: (state + steps) % MARK_STATES, t: into <= HOLD_MS ? 0 : (into - HOLD_MS) / FADE_MS }
}
