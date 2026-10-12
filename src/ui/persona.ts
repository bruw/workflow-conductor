// The Conductor persona: its four poses as pixels, the small one the header
// shows, the ensemble of the splash, and the half-block paint all three share.
// Pure TypeScript: no `$`, no engine imports; time is a beat handed in.
//
// The pixels are read off docs/redesign-v1/claude-conductor-persona-assets
// (one pixel of the source's grid each). A pixel is half a cell tall, so a
// sprite of 28 rows is drawn on 14.

import { flatten } from '../design/model'
import type { Design } from '../design/model'

export type Pose = 'idle' | 'ready' | 'conducting' | 'complete'

/** Rows of pixels: `#` the body, `o` chalk (eyes, collar), `h` a hand, a space nothing. */
type Sprite = readonly string[]

/** The source's own colours: not theme keys, the persona looks the same on every theme. */
const INK: Record<string, string> = { '#': '#d46944', o: '#f1ebe1', h: '#f9855e' }

export type PersonaSpan = { text: string; color?: string; ground?: string }

const HEAD = ['     #########', '     #########', '     #########', '     #########', '     ##o###o##', '     #########', '     #########', '     #########'] as const
const LEGS = ['       ## ##', '       ## ##', '       ## ##', '       ## ##', '      ### ###', '     #### ####'] as const

/** The four poses, 26 pixels wide, feet on the last row of each. */
const FULL: Record<Pose, Sprite> = {
  idle: [
    ...HEAD,
    '       #####',
    '      #######',
    '     ##ooooo##',
    '    #####o#####',
    '    #####o#####',
    '    #####o######',
    '    #####o######     ##',
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
    '     ##ooooo######',
    '    #####o#######',
    '    ###hho#####',
    '    ###hho###',
    '    #####o###',
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
    '###  ##ooooo##',
    ' ## #####o#####',
    ' ########o######',
    '  ### ###o### #####',
    '      ###o###  ####hh',
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
    '     ##ooooo##',
    '    #####o#####',
    '    #####o#####',
    '   ######o#####',
    '   ######o#####',
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

/** The header's persona: four pixels tall, so two rows: the name's and the one under it. */
const SMALL: Record<Pose, Sprite> = {
  idle: [' #####', ' #o#o#', '  ###h', '  # # ##'],
  ready: [' #####  #', ' #o#o# #', '  ###h', '  # #'],
  conducting: [' #####', 'h#o#o#', ' ####h', '  # # ##'],
  complete: [' #####', ' #o#o#', 'h####', '  # #  #'],
}

/** Cells the header keeps for its persona: the sprite and a gap. */
export const SMALL_W = 10
export const SMALL_ROWS = 2

/** One of the ensemble, at rest and with its arms up. */
const AGENT: readonly Sprite[] = [
  [' #####', ' #o#o#', ' #####', '  ###', ' #####', '  # #', '  # #'],
  [' #####', ' #o#o#', ' #####', '# ### #', ' #####', '  # #', '  # #'],
]

/** Where the ensemble stands, as pixels from the scene's left and top: an arc at each side of the conductor. */
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

/** The splash: this many beats of this many ms each. */
export const SPLASH_BEATS = 6
export const BEAT_MS = 300
export const SPLASH_MS = SPLASH_BEATS * BEAT_MS
/** What the conductor does on each beat: the cue, two bars, the bow. */
const SCORE: readonly Pose[] = ['idle', 'ready', 'conducting', 'ready', 'conducting', 'complete']
/** Rows the splash's scene takes, with the ensemble and without it. */
export const SCENE_ROWS = SCENE_H / 2
export const SOLO_ROWS = FULL_H / 2
/** The scene is drawn with its ensemble from this many columns. */
export const SCENE_COLUMNS = SCENE_W

type Canvas = string[][]

function blankCanvas(width: number, height: number): Canvas {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => ' '))
}

/** Puts a sprite on the canvas, its top-left pixel at `x`, `y`; what falls outside is left out. */
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

/** The canvas as rows of spans: two rows of pixels to a row of cells, runs of one look joined. */
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

/** The header's persona in a pose: `SMALL_ROWS` rows, `SMALL_W` cells each. */
export function smallPersona(pose: Pose): PersonaSpan[][] {
  const canvas = blankCanvas(SMALL_W, SMALL_ROWS * 2)
  stamp(canvas, SMALL[pose] ?? SMALL.idle, 0, 0)
  return paint(canvas)
}

/** The conductor alone in a pose, feet on the last row: `SOLO_ROWS` rows, `FULL_W` cells each. */
export function fullPersona(pose: Pose): PersonaSpan[][] {
  const canvas = blankCanvas(FULL_W, FULL_H)
  const sprite = FULL[pose] ?? FULL.idle
  stamp(canvas, sprite, 0, FULL_H - sprite.length)
  return paint(canvas)
}

/**
 * The splash on a beat: the conductor, and where there is room for it the
 * ensemble around, each half of it rising on its own beat and all of it on the
 * last. Returns the rows and how wide they are.
 */
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

/** The beat the splash is on, `ms` after it began. */
export function beatAt(ms: number): number {
  return Math.max(0, Math.min(SPLASH_BEATS - 1, Math.floor(ms / BEAT_MS)))
}

/** How long the header's persona holds a gesture before it is at rest again. */
export const GESTURE_MS = 900

/**
 * What a change to the design calls for: the cue (`ready`) for a block added,
 * the downbeat (`conducting`) for blocks that changed place; null for any
 * other change.
 */
export function gestureOf(before: Design | null, after: Design | null): Pose | null {
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

/** The pose while a run is laid over the design: the bars of it while it runs, the bow once it is done. */
export function runPose(status: 'idle' | 'running' | 'done' | 'failed', clockMs: number): Pose | null {
  if (status === 'running') return Math.floor(clockMs / (BEAT_MS * 2)) % 2 === 0 ? 'conducting' : 'ready'
  if (status === 'done') return 'complete'
  return null
}

