// The Conductor persona: its poses as pixels, the splash's ensemble, and its paint in half-blocks. No `$`, no engine imports; time is a beat handed in.

export type Pose = 'idle' | 'ready' | 'conducting' | 'complete'

/** Rows of pixels: `#` the body, `o` chalk (eyes, collar, tie), `h` a hand, a space nothing. */
type Sprite = readonly string[]

/** The theme keys nearest the persona's own colours (`#d46944`, `#f1ebe1`, `#f9855e`) in the dark theme. */
const INK: Record<string, string> = { '#': 'clawd_body', o: 'text', h: 'rainbow_orange' }

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

export function paintPixels(pixels: readonly (readonly string[])[]): PersonaSpan[][] {
  return paint(pixels.map(row => [...row]))
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

export function beatAt(ms: number): number {
  return Math.max(0, Math.min(SPLASH_BEATS - 1, Math.floor(ms / BEAT_MS)))
}
