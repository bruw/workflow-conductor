// The Conductor persona: its poses as pixels, the splash's ensemble, the header's small one, and the two paints
// (half-blocks for the splash, octants for the header). No `$`, no engine imports; time is a beat handed in.

import { flatten } from '../project/model'
import type { Project } from '../project/model'

export type Pose = 'idle' | 'ready' | 'conducting' | 'complete'

/** Rows of pixels: `#` the body, `o` chalk (eyes, collar, tie), `h` a hand, a space nothing. */
type Sprite = readonly string[]

/** The theme keys nearest the persona's own colours (`#d46944`, `#f1ebe1`, `#f9855e`) in the dark theme. */
const INK: Record<string, string> = { '#': 'clawd_body', o: 'text', h: 'rainbow_orange' }
/** The persona's own colours, for an SVG: its paint is a CSS colour, and no theme key is one. */
const SVG_INK: Record<string, string> = { '#': '#d46944', o: '#f1ebe1', h: '#f9855e' }

export type PersonaSpan = { text: string; color?: string; ground?: string }

const HEAD = ['     #########', '     #########', '     #########', '     #########', '     ##o###o##', '     #########', '     #########', '     #########'] as const
const LEGS = ['       ## ##', '       ## ##', '       ## ##', '       ## ##', '      ### ###', '     #### ####'] as const

/** Feet on the last row of each. */
const FULL: Record<Pose, Sprite> = {
  idle: [
    ...HEAD,
    '       #####',
    '      #######',
    '     ##o###o##',
    '    ####ooo####',
    '    #####o#####',
    '    ####ooo#####',
    '    ####ooo#####     ##',
    '    #####o### ###   ##',
    '    #########  ##  ##',
    '    h########   h##',
    '    h #######',
    ...LEGS,
  ],
  ready: [
    '                         #',
    '                        #',
    '     #########         #',
    '     #########        #',
    '     #########       #',
    '     #########      #',
    '     ##o###o##     #',
    '     #########    #',
    '     #########   hh',
    '     #########   hh',
    '       #####    ###',
    '      #######   ###',
    '     ##o###o######',
    '    ####ooo######',
    '    ###hho#####',
    '    ###hhoo##',
    '    ####ooo##',
    '      ###o###',
    '      #######',
    '      #######',
    '      #######',
    ...LEGS,
  ],
  conducting: [
    ...HEAD,
    'hh     #####',
    'hh    #######',
    '###  ##o###o##',
    ' ## ####ooo####',
    ' ########o######',
    '  ### ##ooo## #####',
    '      ##ooo##  ####hh',
    '      ###o###    ##hh',
    '      #######        #',
    '      #######         #',
    '      #######          #',
    '       ## ##            #',
    ...LEGS.slice(1),
  ],
  complete: [
    ...HEAD.slice(0, 4),
    '     #########',
    '     #oo###oo#',
    '     #########',
    '     #########',
    '       #####',
    '      #######',
    '     ##o###o##',
    '    ####ooo####',
    '    #####o#####',
    '   #####ooo####',
    '   #####ooo####',
    'hh### ###o#####',
    ' h##  #########',
    '      #########',
    '      ####### #',
    '       ## ##  #',
    '       ## ##   #',
    '       ## ##   #',
    '       ## ##    #',
    ...LEGS.slice(4),
  ],
}

export const FULL_W = 26
export const FULL_H = 28

/** The header's persona is the conductor from the chest up, eight pixels tall: two rows of octants. The bow is drawn as the one at rest. */
const REST: Sprite = [
  '      #####',
  '      #####      #',
  '      #o#o#     #',
  ' h    #####    h',
  ' ###   ###   ###',
  '   ####ooo####',
  '     ###o###',
  '     ###o###',
]
const SMALL: Record<Pose, Sprite> = {
  idle: REST,
  ready: [
    '      #####      #',
    '      #o#o#     #',
    ' h    #####    h',
    ' ##   #####   ##',
    '  ##   ###   ##',
    '   ####ooo####',
    '     ###o###',
    '     ###o###',
  ],
  conducting: [
    ' h    #####',
    ' #    #####',
    ' ##   #o#o#',
    '  ##  #####',
    '   ##  ###',
    '    ###ooo######h',
    '     ###o###     #',
    '     ###o###',
  ],
  complete: REST,
}

/** `SMALL_W` is its cells and a gap after them. */
const SMALL_PX = 18
export const SMALL_W = SMALL_PX / 2 + 1
export const SMALL_ROWS = 2

/** The header's persona steps through these, one to a key that moves the selection. */
const POSES: readonly Pose[] = ['idle', 'ready', 'conducting']

export function nextPose(pose: Pose): Pose {
  return POSES[(POSES.indexOf(pose) + 1) % POSES.length] ?? 'idle'
}

/** One of the ensemble: at rest, and with its arms up. */
const AGENT: readonly Sprite[] = [
  [' #####', ' #o#o#', ' #####', '  ###', ' #####', '  # #', '  # #'],
  [' #####', ' #o#o#', ' #####', '# ### #', ' #####', '  # #', '  # #'],
]

/** Pixels from the scene's left and top: an arc at each side of the conductor. */
const SEATS: readonly { x: number; y: number }[] = [
  { x: 13, y: 2 },
  { x: 3, y: 11 },
  { x: 13, y: 21 },
  { x: 57, y: 2 },
  { x: 67, y: 11 },
  { x: 57, y: 21 },
]
const SCENE_W = 77
const SCENE_H = 30
const CONDUCTOR_X = 26

export const SPLASH_BEATS = 6
export const BEAT_MS = 300
export const SPLASH_MS = SPLASH_BEATS * BEAT_MS
/** The cue, two bars, the bow. */
const SCORE: readonly Pose[] = ['idle', 'ready', 'conducting', 'ready', 'conducting', 'complete']
export const SCENE_ROWS = SCENE_H / 2
export const SOLO_ROWS = FULL_H / 2
export const SCENE_COLUMNS = SCENE_W

type Canvas = string[][]

function blankCanvas(width: number, height: number): Canvas {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => ' '))
}

function stamp(canvas: Canvas, sprite: Sprite, x: number, y: number): void {
  sprite.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ink = row[i]
      const line = canvas[y + j]
      if (ink === undefined || ink === ' ' || line === undefined || x + i < 0 || x + i >= line.length) continue
      line[x + i] = ink
    }
  })
}

function paint(canvas: Canvas): PersonaSpan[][] {
  const out: PersonaSpan[][] = []
  for (let y = 0; y < canvas.length; y += 2) {
    const top = canvas[y] ?? []
    const low = canvas[y + 1] ?? []
    const line: PersonaSpan[] = []
    for (let x = 0; x < top.length; x++) {
      const a = INK[top[x] ?? ' ']
      const b = INK[low[x] ?? ' ']
      const cell: PersonaSpan = a === undefined && b === undefined ? { text: ' ' } : a === undefined ? { text: '▄', color: b } : b === undefined ? { text: '▀', color: a } : a === b ? { text: '█', color: a } : { text: '▀', color: a, ground: b }
      const last = line[line.length - 1]
      if (last && last.color === cell.color && last.ground === cell.ground) last.text += cell.text
      else line.push(cell)
    }
    out.push(line)
  }
  return out
}

/** Indexed by a cell's eight pixels: bit `2 * row + column` is the pixel at that place. Unicode 16's octants in the order of their bits, less the 26 sets that had a block before them. */
const OCTANT: readonly string[] = (() => {
  const older: Record<number, string> = {
    0: ' ', 255: '█', 15: '▀', 240: '▄', 85: '▌', 170: '▐', 192: '▂', 252: '▆',
    5: '▘', 10: '▝', 80: '▖', 160: '▗', 165: '▚', 90: '▞', 245: '▙', 95: '▛', 175: '▜', 250: '▟',
    1: '\u{1cea8}', 2: '\u{1ceab}', 64: '\u{1cea3}', 128: '\u{1cea0}',
    3: '\u{1fb82}', 63: '\u{1fb85}', 20: '\u{1fbe6}', 40: '\u{1fbe7}',
  }
  let next = 0x1cd00
  return Array.from({ length: 256 }, (_, bits) => older[bits] ?? String.fromCodePoint(next++))
})()

/** Eight pixels to a cell. A cell has two colours at most: with a third look in it, the fewest pixels take their neighbour's. */
function paintFine(canvas: Canvas): PersonaSpan[][] {
  const out: PersonaSpan[][] = []
  for (let y = 0; y < canvas.length; y += 4) {
    const line: PersonaSpan[] = []
    for (let x = 0; x < (canvas[y]?.length ?? 0); x += 2) {
      const inks: string[] = []
      for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) inks.push(canvas[y + j]?.[x + i] ?? ' ')
      const count = (ink: string): number => inks.filter(one => one === ink).length
      // The looks in the cell, the most pixels first; of two as many, the body last.
      const looks = [...new Set(inks.filter(ink => ink !== ' '))].sort((a, b) => count(b) - count(a) || (a === '#' ? 1 : -1))
      const open = inks.includes(' ')
      // With nothing behind some pixel the ground stays the pane's; else the body is the ground.
      const ground = open || looks.length < 2 ? undefined : looks.includes('#') ? '#' : looks[1]
      const front = looks.find(ink => ink !== ground)
      const bits = inks.reduce((sum, ink, at) => sum + (ink !== ' ' && ink !== ground ? 1 << at : 0), 0)
      const cell: PersonaSpan = { text: OCTANT[bits] ?? ' ' }
      if (front !== undefined) cell.color = INK[front]
      if (ground !== undefined) cell.ground = INK[ground]
      const last = line[line.length - 1]
      if (last && last.color === cell.color && last.ground === cell.ground) last.text += cell.text
      else line.push(cell)
    }
    out.push(line)
  }
  return out
}

export function paintPixels(pixels: readonly (readonly string[])[]): PersonaSpan[][] {
  return paint(pixels.map(row => [...row]))
}

export function smallPersona(pose: Pose): PersonaSpan[][] {
  const canvas = blankCanvas(SMALL_W * 2, SMALL_ROWS * 4)
  stamp(canvas, SMALL[pose] ?? SMALL.idle, 0, 0)
  return paintFine(canvas)
}

/** CSS pixels to a pixel: two rows of text tall, narrower than its cells. */
const SVG_SCALE = 4
export const SMALL_SVG_W = SMALL_PX * SVG_SCALE
export const SMALL_SVG_H = SMALL_ROWS * 4 * SVG_SCALE

export function smallPersonaSvg(pose: Pose): string {
  const rects: string[] = []
  ;(SMALL[pose] ?? SMALL.idle).forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const ink = row[x] ?? ' '
      let end = x + 1
      while (row[end] === ink) end++
      const fill = SVG_INK[ink]
      if (fill !== undefined) rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${fill}"/>`)
      x = end
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SMALL_PX} ${SMALL_ROWS * 4}" width="${SMALL_SVG_W}" height="${SMALL_SVG_H}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}

export function fullPersona(pose: Pose): PersonaSpan[][] {
  const canvas = blankCanvas(FULL_W, FULL_H)
  const sprite = FULL[pose] ?? FULL.idle
  stamp(canvas, sprite, 0, FULL_H - sprite.length)
  return paint(canvas)
}

/** With room for it, the ensemble stands around: each half rises on its own beat, all of it on the last. */
export function splashScene(beat: number, columns: number, rows: number): { lines: PersonaSpan[][]; width: number } {
  const at = Math.max(0, Math.min(SPLASH_BEATS - 1, Math.trunc(beat)))
  const pose = SCORE[at] ?? 'idle'
  if (columns < SCENE_COLUMNS || rows < SCENE_ROWS) return { lines: fullPersona(pose), width: FULL_W }
  const canvas = blankCanvas(SCENE_W, SCENE_H)
  const sprite = FULL[pose]
  stamp(canvas, sprite, CONDUCTOR_X, SCENE_H - sprite.length)
  SEATS.forEach((seat, index) => {
    const up = at === SPLASH_BEATS - 1 || (at > 0 && (at + index) % 2 === 0)
    stamp(canvas, AGENT[up ? 1 : 0] ?? [], seat.x, seat.y - (up ? 1 : 0))
  })
  return { lines: paint(canvas), width: SCENE_W }
}

/** The splash while a draft is awaited: its two bars, round and round. `beat` only grows. */
export function waitScene(beat: number, columns: number, rows: number): { lines: PersonaSpan[][]; width: number } {
  return splashScene(1 + (Math.max(0, Math.trunc(beat)) % 2), columns, rows)
}

/** The header's persona on the same beats, while a draft is laid out on the graph. */
export function draftPose(beat: number): Pose {
  return Math.max(0, Math.trunc(beat)) % 2 === 0 ? 'conducting' : 'ready'
}

export function beatAt(ms: number): number {
  return Math.max(0, Math.min(SPLASH_BEATS - 1, Math.floor(ms / BEAT_MS)))
}

/** How long the header's persona holds a gesture before it is at rest again. */
export const GESTURE_MS = 900

/** The cue (`ready`) for a block added, the downbeat (`conducting`) for blocks that changed place; null for any other change. */
export function gestureOf(before: Project | null, after: Project | null): Pose | null {
  if (!before || !after || before === after) return null
  const was = flatten(before)
  const now = flatten(after)
  if (now.length > was.length) return 'ready'
  if (now.length < was.length) return null
  const places = (rows: typeof was): string[] => rows.map(row => `${row.node.id}@${row.parentId ?? ''}#${row.index}`)
  const old = places(was)
  const next = places(now)
  if (old.join('|') === next.join('|')) return null
  const ids = new Set(was.map(row => row.node.id))
  return now.every(row => ids.has(row.node.id)) ? 'conducting' : null
}

export function runPose(status: 'idle' | 'running' | 'done' | 'failed', clockMs: number): Pose | null {
  if (status === 'running') return Math.floor(clockMs / (BEAT_MS * 2)) % 2 === 0 ? 'conducting' : 'ready'
  if (status === 'done') return 'complete'
  return null
}

