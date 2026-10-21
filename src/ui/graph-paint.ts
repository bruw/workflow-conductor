// The graph's paint: a layout as rows of styled spans, one grapheme per cell (two for a wide one), windowed by `panY`.
// The layout says the words and where they go; here each role gets its look. No `$`, no engine imports.

import type { NodeType } from '../project/model'
import type { Place } from '../project/ops'
import type { NodeRun, RunStatus } from '../run/events'
import { CRUMB_PAD, CRUMB_SEP, EMPTY_KEYS, EMPTY_NOTE, UNMAPPED_ID, edgeMarks, graphRows, samePlace, segsWidth, stickyCards } from './graph-layout'
import type { GraphCard, GraphDrop, GraphLayout, Seg } from './graph-layout'
import { FAILED, fmtCount, spinnerFrame } from './rail'
import { cellWidth, clip, glyphs, plainCells } from './text'
import { ACCENT, ACTIVE, FADED, GLYPH, GRAY, GRAY_FADED, RULE } from './theme'

/** How a run of cells is drawn while the pointer is on it, or on any other of its `scope`. */
export type Hover = { scope: string; color: string; bold: true; inverse?: true }

/** `ground` is the colour behind the cells where it is not the pane's own. */
export type Span = { text: string; color?: string; bold?: true; inverse?: true; hover?: Hover; ground?: string }

type Look = Omit<Span, 'text' | 'ground'>

export type RunOverlay = {
  status: RunStatus
  byNode: Record<string, NodeRun>
  /** Null when every agent names a block. */
  unmapped: NodeRun | null
  now?: number
}

export type CardRun = {
  /** Spinner frame, `✓`, `✗`, or `·` while it has no agent. */
  glyph: string
  color: 'claude' | 'success' | 'error' | 'inactive'
  /** `2/4 done · 1 failed · 27.7k`; `waiting` or `not run` with no agent. */
  text: string
  /** The same in fewer words, longest first, for a border too short for `text`. */
  shorter: string[]
  /** False once the run is over and the block got no agent. */
  reached: boolean
}

const WAITING = 'waiting'
const NOT_RUN = 'not run'
const NO_RUN: NodeRun = { total: 0, running: 0, done: 0, failed: 0, tokens: 0 }
const OVER: readonly RunStatus[] = ['done', 'failed', 'stopped']

function addRuns(a: NodeRun, b: NodeRun | undefined): NodeRun {
  if (!b) return a
  return { total: a.total + b.total, running: a.running + b.running, done: a.done + b.done, failed: a.failed + b.failed, tokens: a.tokens + b.tokens }
}

/** `2/4 done · 1 failed · 22.3k`: done are the ones that ended well, of all started; failures are named, never a bare mark. */
function runWords(sum: NodeRun): { text: string; shorter: string[] } {
  const count = `${sum.done}/${sum.total}`
  const failed = sum.failed > 0 ? ` · ${sum.failed} failed` : ''
  // No token figure before the first usage arrives: `0/4 done`, not `0/4 done · 0`.
  const full = `${count} done${failed}`
  return { text: sum.tokens > 0 ? `${full} · ${fmtCount(sum.tokens)}` : full, shorter: [full, `${count}${failed}`, count] }
}

/** The longest wording that fits `room` cells, glyph included; '' when none does. */
function fitStatus(run: CardRun | undefined, room: number): string {
  if (!run) return ''
  for (const words of [run.text, ...run.shorter]) if (words.length + 2 <= room) return `${run.glyph} ${words}`
  return run.shorter.length === 0 ? clip(`${run.glyph} ${run.text}`, room) : ''
}

export type GraphPaintOptions = {
  /** The breadcrumb's rows of a nested view are the first of `rows`. */
  columns: number
  rows: number
  panY: number
  hoverAt?: Place | null
  run?: RunOverlay
  /** A run locks the project: no slots, and the chips cannot be pressed. */
  locked?: boolean
  /** A card in the pointer's hand: `x`, `y` are window cells; `hint` says what a release would do. */
  drag?: { id: string; target: GraphDrop | null; x: number; y: number; hint?: string } | null
  /** Cards still sliding to their place or growing to their size: cells away from it. */
  offsets?: Record<string, { dx: number; dy: number; dh?: number }>
  /** Colours and hovers left out: what a graph too large for one tree falls back to. */
  plain?: boolean
  emptyNote?: string
  /** Blocks an edit just touched: drawn in `claude`, their name inverse while `strong`. */
  flash?: { ids: readonly string[]; strong: boolean } | null
  quiet?: boolean
}

type Frame = readonly [string, string, string, string, string, string]

/** A chain's line is dashed, a stack's dotted. A cell is twice as tall as wide, so a horizontal glyph has half the dashes of its vertical one: the pitch is the same along both sides. */
const FRAMES: Record<'leaf' | 'chain' | 'stack', { rest: Frame; selected: Frame }> = {
  leaf: { rest: ['╭', '─', '╮', '│', '╰', '╯'], selected: ['┏', '━', '┓', '┃', '┗', '┛'] },
  chain: { rest: ['┌', '╴', '┐', '╎', '└', '┘'], selected: ['┏', '╸', '┓', '╏', '┗', '┛'] },
  stack: { rest: ['┌', '╌', '┐', '┊', '└', '┘'], selected: ['┏', '╍', '┓', '┋', '┗', '┛'] },
}
/** A leaf in the pointer's hand. */
const LIFTED: Frame = ['╭', '╴', '╮', '╎', '╰', '╯']

function frameOf(card: Pick<GraphCard, 'type' | 'flow'>): keyof typeof FRAMES {
  return card.flow ?? 'leaf'
}

/** `↓` hands each result on as it arrives, `all ⇓` waits for all of them. */
const ARROW = { stream: '↓', barrier: '⇓' } as const
const ARROW_ALL = 'all '
const GUTTER_GLYPH = { left: '◀', right: '▶' } as const

function accentOf(type: NodeType | 'unmapped', gray: boolean): string {
  return type === 'unmapped' ? FADED : (gray ? GRAY : ACCENT)[type]
}

/** What can be pressed (a chip, a crumb, a gutter) is inverse in `claude` under the pointer. */
function pressed(scope: string): Hover {
  return { scope, color: 'claude', bold: true, inverse: true }
}

/** Each block's own agents plus those of everything it holds, drawn or not. Keyed by block id, and `unmapped`. */
function graphRuns(layout: GraphLayout, run: RunOverlay): Map<string, CardRun> {
  const blocks: { id: string; type: NodeType | 'unmapped'; parentId: string | undefined }[] = [...layout.blocks]
  if (layout.cards.some(card => card.type === 'unmapped')) blocks.push({ id: UNMAPPED_ID, type: 'unmapped', parentId: undefined })
  const sums = new Map<string, NodeRun>()
  for (const block of blocks) sums.set(block.id, addRuns(NO_RUN, block.type === 'unmapped' ? (run.unmapped ?? undefined) : run.byNode[block.id]))
  // Parents come before their children: from the last block up, each adds its sum to its container's.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block?.parentId === undefined) continue
    sums.set(block.parentId, addRuns(sums.get(block.parentId) ?? NO_RUN, sums.get(block.id)))
  }
  const over = OVER.includes(run.status)
  const out = new Map<string, CardRun>()
  for (const block of blocks) {
    const sum = sums.get(block.id) ?? NO_RUN
    if (sum.total === 0) {
      // A `code` block that spawned nothing has no status, and the start block never spawns.
      if (block.type !== 'code' && block.type !== 'start') out.set(block.id, { glyph: '·', color: 'inactive', text: over ? NOT_RUN : WAITING, shorter: [], reached: !over })
      continue
    }
    const words = runWords(sum)
    if (sum.running > 0) out.set(block.id, { glyph: spinnerFrame(run.now ?? 0), color: 'claude', ...words, reached: true })
    else if (sum.failed > 0) out.set(block.id, { glyph: FAILED, color: 'error', ...words, reached: true })
    else out.set(block.id, { glyph: GLYPH.done, color: 'success', ...words, reached: true })
  }
  return out
}

/** Exactly `rows` rows, none wider than `columns`. */
export function paintGraph(layout: GraphLayout, options: GraphPaintOptions): Span[][] {
  const width = Math.max(0, Math.trunc(options.columns))
  const height = Math.max(0, Math.trunc(options.rows))
  const top = Math.min(layout.top, height)
  const room = graphRows(layout, height)
  const panY = Math.trunc(options.panY) || 0
  const chars: string[][] = Array.from({ length: height }, () => new Array<string>(width).fill(' '))
  const looks: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(0))
  const table: Look[] = [{}]
  const known = new Map<string, number>([['{}', 0]])
  const look = (wanted: Look): number => {
    const one: Look = options.plain ? { ...(wanted.bold ? { bold: true } : {}), ...(wanted.inverse ? { inverse: true } : {}) } : wanted
    const key = JSON.stringify(one)
    const at = known.get(key)
    if (at !== undefined) return at
    table.push(one)
    known.set(key, table.length - 1)
    return table.length - 1
  }
  /** A wide grapheme takes two cells: its glyph, then a cell that holds '' and draws nothing, so a row is always `width` cells. One that would stand across an edge is a space in the cell it has. */
  const write = (x: number, row: number, text: string, style: number, from: number = 0, to: number = width): void => {
    const line = chars[row]
    const tone = looks[row]
    if (!line || !tone) return
    const first = Math.max(0, from)
    const end = Math.min(width, to)
    const set = (column: number, glyph: string): void => {
      if (column < first || column >= end) return
      // Half of a wide grapheme written over: its other half is a space.
      if (line[column] === '' && column > 0) line[column - 1] = ' '
      if (line[column + 1] === '') line[column + 1] = ' '
      line[column] = glyph
      tone[column] = style
    }
    if (plainCells(text)) {
      for (let i = 0; i < text.length; i++) set(x + i, text[i] ?? ' ')
      return
    }
    let column = x
    for (const glyph of glyphs(text)) {
      if (glyph.width === 1) set(column, glyph.text)
      else if (glyph.width === 2) {
        const whole = column >= first && column + 1 < end
        set(column, whole ? glyph.text : ' ')
        set(column + 1, whole ? '' : ' ')
      }
      column += glyph.width
    }
  }
  /** The cells of the graph a card may be drawn in: the inside of the container it is in. Null for no bound. */
  let bound: { x: number; y: number; w: number; h: number } | null = null
  /** A cell of the graph: under the breadcrumb, moved by the pan, kept inside `bound`. */
  const put = (x: number, y: number, text: string, style: number): void => {
    const row = y - panY
    if (row < 0 || row >= room) return
    if (bound === null) return write(x, row + top, text, style)
    if (y < bound.y || y >= bound.y + bound.h) return
    write(x, row + top, text, style, bound.x, bound.x + bound.w)
  }

  const runs = options.run ? graphRuns(layout, options.run) : undefined
  const offsets = options.offsets ?? {}
  const moving = Object.keys(offsets).length > 0
  const dragId = options.drag?.id ?? null
  const faint = look({ color: FADED })
  const flashIds = new Set(options.flash?.ids ?? [])
  const flashStrong = options.flash?.strong === true
  // While a run is drawn only it keeps colour (and `claude`, what can be pressed): the graph is in grays, a dimmer one for what it never reached.
  const gray = options.run !== undefined
  const gone = gray ? GRAY_FADED : 'inactive'

  type Tone = { faded: boolean; loud: boolean; tint: string; frame: Frame; edge: number; run: CardRun | undefined }
  const toneOf = (card: GraphCard): Tone => {
    const lifted = card.id === dragId
    const run = runs?.get(card.id)
    // Dim is for a block the run never reached (and a card in the hand): a type is never dim by itself.
    const faded = lifted || run?.reached === false
    // A block an edit just touched borrows `claude` for a moment, whatever its type.
    const flashed = !faded && flashIds.has(card.id)
    const tint = faded ? gone : accentOf(card.type, gray)
    // The selection is the heavy border in `claude`; at rest a leaf's border is quiet and a container's has its type's colour.
    const border = faded ? gone : card.selected || flashed ? 'claude' : card.kind === 'leaf' ? RULE : tint
    const shape = frameOf(card)
    const frame = lifted ? (shape === 'leaf' ? LIFTED : FRAMES[shape].rest) : card.selected ? FRAMES[shape].selected : FRAMES[shape].rest
    return { faded, loud: flashed && flashStrong, tint, frame, edge: look(card.selected && !faded ? { color: border, bold: true } : { color: border }), run }
  }

  const segLook = (seg: Seg, tone: Tone): Look => {
    const dim = { color: tone.faded ? gone : FADED }
    const loud = tone.loud ? { inverse: true as const } : {}
    switch (seg.role) {
      case 'type':
        return { color: tone.tint, ...loud }
      case 'title':
        return tone.faded ? { color: gone, bold: true } : { bold: true, ...loud }
      case 'arm':
        return { color: tone.faded ? gone : accentOf('branch', gray), bold: true }
      case 'error':
        return { color: tone.faded ? gone : gray ? 'text' : 'error' }
      case 'badge':
        return { color: tone.faded ? gone : gray ? 'text' : 'error', bold: true, inverse: true }
      case 'key':
        return { color: tone.faded ? gone : 'claude', ...(seg.chip && !options.locked ? { hover: pressed(`conductor-chip-${seg.chip}`) } : {}) }
      case 'value':
        return { ...(tone.faded ? { color: gone } : {}), ...(seg.chip && !options.locked ? { hover: pressed(`conductor-chip-${seg.chip}`) } : {}) }
      case 'unset':
        return { color: 'inactive', ...(seg.chip && !options.locked ? { hover: pressed(`conductor-chip-${seg.chip}`) } : {}) }
      case 'meta':
      case 'text':
        return tone.faded ? { color: gone } : {}
      default:
        return dim
    }
  }

  /** On a border, cells of the line show through a `rule` that is not blank. */
  const putSegs = (segs: readonly Seg[], x: number, y: number, tone: Tone, border: boolean): void => {
    let at = x
    for (const seg of segs) {
      if (seg.role !== 'rule') put(at, y, seg.text, look(segLook(seg, tone)))
      else if (border && seg.text.trim() === '') put(at, y, seg.text, tone.edge)
      at += cellWidth(seg.text)
    }
  }

  const drawTop = (card: GraphCard, x: number, y: number, tone: Tone): void => {
    const { frame, edge } = tone
    put(x, y, `${frame[0]}${frame[1].repeat(Math.max(0, card.w - 2))}${frame[2]}`, edge)
    putSegs(card.top.left, x + 2, y, tone, true)
    putSegs(card.top.right, x + card.w - 2 - segsWidth(card.top.right), y, tone, true)
  }

  // A card on the move is drawn inside its container's border only, as that one is inside its own (parents come before their children).
  const insides = new Map<string, { x: number; y: number; w: number; h: number }>()
  for (const card of layout.cards) {
    const offset = offsets[card.id]
    const x = card.x + (offset?.dx ?? 0)
    const y = card.y + (offset?.dy ?? 0)
    // A card growing or shrinking to its size is drawn at the height it has reached.
    const h = Math.max(2, card.h + (offset?.dh ?? 0))
    // A card with no row in the window has no cell to write. (While cards slide each is gone through: one may bound what it holds.)
    if (!moving && (y - panY >= room || y + h - panY <= 0)) continue
    const tone = toneOf(card)
    const { frame, edge, run } = tone
    bound = moving && card.parentId !== undefined ? (insides.get(card.parentId) ?? null) : null
    if (moving && card.kind === 'open') {
      const x0 = Math.max(x + 1, bound?.x ?? x + 1)
      const y0 = Math.max(y + 1, bound?.y ?? y + 1)
      insides.set(card.id, { x: x0, y: y0, w: Math.max(0, Math.min(x + card.w - 1, bound ? bound.x + bound.w : Infinity) - x0), h: Math.max(0, Math.min(y + h - 1, bound ? bound.y + bound.h : Infinity) - y0) })
    }
    drawTop(card, x, y, tone)
    for (let row = 1; row < h - 1; row++) {
      put(x, y + row, frame[3], edge)
      put(x + 1, y + row, ' '.repeat(Math.max(0, card.w - 2)), 0)
      put(x + card.w - 1, y + row, frame[3], edge)
    }
    put(x, y + h - 1, `${frame[4]}${frame[1].repeat(Math.max(0, card.w - 2))}${frame[5]}`, edge)
    for (const [i, row] of card.rows.entries()) {
      if (1 + i >= h - 1) break
      putSegs(row.left, x + 2, y + 1 + i, tone, false)
      putSegs(row.right, x + card.w - 2 - segsWidth(row.right), y + 1 + i, tone, false)
    }
    // The run's status on the bottom border, left. A container keeps the middle of its border for its `[+]`.
    const status = fitStatus(run, card.kind === 'open' ? Math.floor(card.w / 2) - 8 : card.w - 6)
    if (status !== '') put(x + 2, y + h - 1, ` ${status} `, look({ color: run?.color ?? FADED }))
  }
  bound = null

  // Arrows, the words between arms, gutters and slots stand where the cards will be: left out while cards slide.
  if (!moving) {
    const drafting = options.emptyNote !== undefined && options.emptyNote !== '' && layout.blank
    // A project with no block of its own says how to start, dim, under its `[+]`. Locked, the `[+]` is dim too and no key is named.
    const first = layout.blank ? layout.slots.find(slot => slot.mark !== null) : undefined
    if (drafting) put(1, first?.mark?.y ?? 0, clip(options.emptyNote ?? '', Math.max(1, width - 2)), look({ color: 'claude' }))
    if (first?.mark && !drafting) {
      const { x, y } = first.mark
      if (options.locked) put(x, y, first.mark.label, faint)
      const lines = [...(options.locked || options.quiet ? [] : EMPTY_KEYS.map(([key, text]) => `${key}  ${text}`)), ...(options.locked ? [] : ['', ...EMPTY_NOTE])]
      for (const [i, line] of lines.entries()) put(x, y + 2 + i, clip(line, Math.max(1, width - x - 1)), faint)
    }
    if (!options.locked && dragId === null && !drafting) {
      // The active `[+]` is lit: its add list is open, the pointer is on it, or `n` adds there.
      const active = { color: ACTIVE, bold: true } as const
      for (const slot of layout.slots) {
        if (!slot.mark) continue
        const lit = slot.open || samePlace(options.hoverAt, slot.place) || (slot.target && !options.quiet)
        // Under the pointer the surface draws any of them as the active one.
        const style: Look = { ...(lit ? active : { color: FADED }), ...(slot.open ? {} : { hover: { ...active, scope: `conductor-slot-${slot.place.parentId ?? 'top'}-${slot.place.index}` } }) }
        // A space either side keeps the words off the border they may stand on.
        put(slot.mark.x - 1, slot.mark.y, ' ', 0)
        put(slot.mark.x, slot.mark.y, slot.mark.label, look(style))
        put(slot.mark.x + slot.mark.label.length, slot.mark.y, ' ', 0)
      }
    }
    for (const edge of layout.edges) {
      put(edge.x, edge.y, ARROW[edge.kind], look(edge.kind === 'barrier' ? { bold: true } : {}))
      if (edge.kind === 'barrier') put(edge.x - ARROW_ALL.length, edge.y, ARROW_ALL, faint)
    }
    for (const rule of layout.rules) put(rule.x, rule.y, ` ${rule.label} `.slice(0, rule.w), look({ color: FADED, bold: true }))
    for (const gutter of layout.gutters) {
      const style = look({ color: 'claude', bold: true, hover: pressed(`conductor-gutter-${gutter.id}-${gutter.side}`) })
      const count = gutter.count > 99 ? '99+' : String(gutter.count)
      put(gutter.x + 1, gutter.y + 1, GUTTER_GLYPH[gutter.side], style)
      put(gutter.x + Math.max(0, Math.floor((gutter.w - count.length) / 2)), gutter.y + 2, count, style)
    }
  }

  const { drag } = options
  if (drag) {
    const slot = drag.target && drag.target.to !== null ? drag.target.slot : undefined
    const bar = look({ color: 'claude', bold: true })
    if (slot && slot.bar === 'column') for (let row = 0; row < slot.h; row++) put(slot.x + Math.floor(slot.w / 2), slot.y + row, '┃', bar)
    if (slot && slot.bar === 'row') put(slot.x, slot.y, '━'.repeat(slot.w), bar)
    const card = layout.cards.find(one => one.id === drag.id)
    if (card) {
      const chip = ` ${card.id} ${clip(card.title, 16)}${drag.hint ? ` · ${drag.hint}` : ''} `
      // Kept inside the window: the words say what a release does.
      const wide = cellWidth(chip)
      const at = Math.max(0, Math.min(drag.x + 2, width - wide))
      write(at, drag.y, chip, look({ color: 'claude', bold: true, inverse: true }))
    }
  }

  // Where the graph goes on past the window: the header of the container the first row is inside, and dim words at the edges.
  if (room >= 3 && width >= 8) {
    const marks = edgeMarks(layout, room, panY)
    // In a window just as tall as the selected card, the words would be written over its border: the card is shown whole instead.
    const chosen = layout.cards.find(card => card.selected && card.kind !== 'open')
    if (chosen !== undefined && chosen.y === panY) marks.above = ''
    if (chosen !== undefined && chosen.y + chosen.h === panY + room) marks.below = ''
    if (marks.above !== '') {
      const pinned = moving ? [] : stickyCards(layout, panY)
      const first = pinned[0]
      if (!first) {
        put(0, panY, ' '.repeat(width), 0)
        put(1, panY, marks.above, faint)
      }
      for (const card of pinned) drawTop(card, card.x, panY, toneOf(card))
      // The count goes on the pinned header where it leaves the room.
      const words = ` ${marks.above} `
      const taken = first ? segsWidth(first.top.left) + segsWidth(first.top.right) : 0
      if (first && first.w - 6 - taken >= words.length) put(first.x + first.w - 3 - segsWidth(first.top.right) - words.length, panY, words, faint)
    }
    if (marks.below !== '') {
      put(0, panY + room - 1, ' '.repeat(width), 0)
      put(1, panY + room - 1, marks.below, faint)
    }
  }

  // The breadcrumb, on rows of its own: the view's own crumb is lit, every other one a press away.
  if (top > 0) {
    if (layout.level !== '') write(1, 0, layout.level, look({ bold: true }))
    const pad = ' '.repeat(CRUMB_PAD)
    for (const [i, crumb] of layout.crumbs.entries()) {
      if (i > 0) write(crumb.x - CRUMB_SEP.length, 0, CRUMB_SEP, faint)
      const style: Look = crumb.last ? { color: 'claude', bold: true, inverse: true } : crumb.id === undefined ? { color: FADED } : { hover: pressed(`conductor-crumb-${crumb.id ?? 'root'}`) }
      write(crumb.x, 0, `${pad}${crumb.text}${pad}`, look(style))
    }
    if (top > 1) write(0, 1, '─'.repeat(width), look({ color: RULE }))
  }

  return chars.map((line, row) => {
    const tone = looks[row] ?? []
    let end = line.length
    while (end > 0 && line[end - 1] === ' ' && tone[end - 1] === 0) end--
    const spans: Span[] = []
    let start = 0
    for (let at = 1; at <= end; at++) {
      // The second cell of a wide grapheme goes with its first.
      if (at < end && (tone[at] === tone[start] || line[at] === '')) continue
      spans.push({ text: line.slice(start, at).join(''), ...table[tone[start] ?? 0] })
      start = at
    }
    return spans.length > 0 ? spans : [{ text: ' ' }]
  })
}

/** Roughly what the painted rows weigh as a tree, in characters: the engine refuses a tree past 100,000. */
export function paintWeight(lines: readonly Span[][]): number {
  return lines.reduce((sum, line) => sum + 40 + line.reduce((cells, span) => cells + span.text.length + 50 + (span.hover ? 90 : 0) + (span.color ? 20 : 0) + (span.ground ? 30 : 0), 0), 0)
}
