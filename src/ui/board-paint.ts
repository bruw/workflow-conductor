// The flow board's paint: a layout as rows of styled spans, one character per
// cell, clipped to the window the pane gives it. Pure TypeScript: no `$`, no
// engine imports. Drawing by cell (and not with nested bordered boxes) lets a
// border carry a title, an edge sit between two cards, and the board pan.

import type { NodeType } from '../design/model'
import type { Place } from '../design/ops'
import type { NodeRun, RunStatus } from '../run/events'
import { clip, samePlace, slotVisible } from './board-layout'
import type { BoardCard, BoardLayout, DropTarget } from './board-layout'
import { FAILED, fmtTokens, spinnerFrame } from './rail'
import { ACCENT, GLYPH } from './theme'

/** A run laid over the design: counts by node id, and the sum of the agents no block claims. */
export type RunOverlay = {
  status: RunStatus
  byNode: Record<string, NodeRun>
  /** Null when every agent names a block. */
  unmapped: NodeRun | null
  /** The run's tick clock, for the spinner frame. */
  now?: number
}

export type RunColor = 'claude' | 'success' | 'error' | 'inactive'

/** What the run overlay puts on a card. */
export type CardRun = {
  /** Spinner frame, `✓`, `✗`, or `·` while it has no agent. */
  glyph: string
  color: RunColor
  /** `2/4 done · 1 failed · 27.7k`; `waiting` or `not run` with no agent. */
  text: string
  /** The same in fewer words, longest first, for a border too short for `text`: without the tokens, then the count alone. */
  shorter: string[]
  /** False once the run is over and the block got no agent. */
  reached: boolean
}

export const WAITING = 'waiting'
export const NOT_RUN = 'not run'

const NO_RUN: NodeRun = { total: 0, running: 0, done: 0, failed: 0, tokens: 0 }
const OVER: readonly RunStatus[] = ['done', 'failed']

function addRuns(a: NodeRun, b: NodeRun | undefined): NodeRun {
  if (!b) return a
  return { total: a.total + b.total, running: a.running + b.running, done: a.done + b.done, failed: a.failed + b.failed, tokens: a.tokens + b.tokens }
}

/** Every card's run: its own agents plus those of everything it holds. A `code` block that spawned nothing has none. */
export function cardRuns(layout: BoardLayout, run: RunOverlay): Map<string, CardRun> {
  const sums = new Map<string, NodeRun>()
  for (const card of layout.cards) sums.set(card.id, addRuns(NO_RUN, card.type === 'unmapped' ? (run.unmapped ?? undefined) : run.byNode[card.id]))
  for (let i = layout.cards.length - 1; i >= 0; i--) {
    const card = layout.cards[i]
    if (card?.parentId === undefined) continue
    sums.set(card.parentId, addRuns(sums.get(card.parentId) ?? NO_RUN, sums.get(card.id)))
  }
  const over = OVER.includes(run.status)
  const out = new Map<string, CardRun>()
  for (const card of layout.cards) {
    const sum = sums.get(card.id) ?? NO_RUN
    if (sum.total === 0) {
      if (card.type !== 'code') out.set(card.id, { glyph: '·', color: 'inactive', text: over ? NOT_RUN : WAITING, shorter: [], reached: !over })
      continue
    }
    const words = runWords(sum)
    if (sum.running > 0) out.set(card.id, { glyph: spinnerFrame(run.now ?? 0), color: 'claude', ...words, reached: true })
    else if (sum.failed > 0) out.set(card.id, { glyph: FAILED, color: 'error', ...words, reached: true })
    else out.set(card.id, { glyph: GLYPH.done, color: 'success', ...words, reached: true })
  }
  return out
}

/**
 * A block's agents in words nobody can misread: `2/4 done · 1 failed · 22.3k`
 * (done are the ones that ended well, of all started; failures are named, never a bare mark).
 */
export function runWords(sum: NodeRun): { text: string; shorter: string[] } {
  const count = `${sum.done}/${sum.total}`
  const failed = sum.failed > 0 ? ` · ${sum.failed} failed` : ''
  // No token figure before the first usage arrives: `0/4 done`, not `0/4 done · 0`.
  const full = `${count} done${failed}`
  return { text: sum.tokens > 0 ? `${full} · ${fmtTokens(sum.tokens)}` : full, shorter: [full, `${count}${failed}`, count] }
}

/** A card's status as it fits `room` cells, glyph included: the longest wording that does, '' when none. */
export function fitStatus(run: CardRun | undefined, room: number): string {
  if (!run) return ''
  for (const words of [run.text, ...run.shorter]) if (words.length + 2 <= room) return `${run.glyph} ${words}`
  return run.shorter.length === 0 ? clip(`${run.glyph} ${run.text}`, room) : ''
}

export type Affordance = { kind: 'edit' | 'remove'; x: number; y: number; w: number; label: string }

/** A second click on this deletes a container and all it holds. */
export const CONFIRM_LABEL = ' delete all? '

/**
 * The words on a selected card's bottom border: `edit` and `del`. `confirm` turns
 * `del` into the question a container that holds blocks asks first. `edit` is
 * left out where the card is too narrow for both.
 */
export function affordances(card: BoardCard, confirm: boolean = false): Affordance[] {
  if (card.type === 'unmapped' || card.line) return []
  const y = card.y + card.h - 1
  const del = confirm ? CONFIRM_LABEL : ' del '
  const edit = ' edit '
  const delX = Math.max(card.x + 1, card.x + card.w - 2 - del.length)
  const out: Affordance[] = [{ kind: 'remove', x: delX, y, w: Math.min(del.length, card.w - 2), label: clip(del, card.w - 2) }]
  const editX = delX - 1 - edit.length
  if (editX >= card.x + 2) out.unshift({ kind: 'edit', x: editX, y, w: edit.length, label: edit })
  return out
}

/** One run of cells drawn alike. `hover` names the group that lights under the pointer. */
export type Span = { text: string; color?: string; bold?: true; inverse?: true; hover?: string }

type Look = Omit<Span, 'text'>

export type PaintOptions = {
  /** The window: how many cells are drawn, and which cell of the board is its top left. */
  columns: number
  rows: number
  panX: number
  panY: number
  selectedId: string | null
  /** The card the keyboard's grab holds. */
  grabbedId?: string | null
  /** The container whose delete waits for a second ask. */
  confirmId?: string | null
  /** The slot the add picker is open for. */
  pickerAt?: Place | null
  /** The slot under the pointer: its `+` is drawn though the selection does not call for it. */
  hoverAt?: Place | null
  /** Ids of nodes a lint marks. */
  lints?: ReadonlySet<string>
  run?: RunOverlay
  /** A run is in progress: no slots, no affordances. */
  locked?: boolean
  /** A card in the pointer's hand: `x`, `y` are window cells; `hint` says what a release would do. */
  drag?: { id: string; target: DropTarget | null; x: number; y: number; hint?: string } | null
  /** Cards still sliding to their place or growing to their size: cells away from it. */
  offsets?: Record<string, { dx: number; dy: number; dh?: number }>
  /** Colours and hovers left out: what a board too large for one tree falls back to. */
  plain?: boolean
  /** Said on an empty board in place of its `+`: Claude is drafting the design. */
  emptyNote?: string
  /** Blocks an edit from chat just touched: drawn in `claude`, their header inverse while `strong`. */
  flash?: { ids: readonly string[]; strong: boolean } | null
}

const ROUND = ['╭', '─', '╮', '│', '╰', '╯'] as const
const HEAVY = ['┏', '━', '┓', '┃', '┗', '┛'] as const
const DASHED = ['╭', '╌', '╮', '┆', '╰', '╯'] as const
/** The bottom border of a block that runs many times: a double line, at no extra row. Light, and for the selected card. */
export const FAN_BOTTOM = { light: ['╘', '═', '╛'], heavy: ['╚', '═', '╝'] } as const

/** Left to right an edge is a line and its head; top to bottom, one row of line, the head on the next card's top border. */
export const EDGE_GLYPH = {
  h: { stream: '─▶', barrier: '═▶' },
  v: { stream: '│▼', barrier: '║▼' },
} as const

export { EMPTY_HINT } from './board-layout'

function accentOf(type: NodeType | 'unmapped'): string {
  return type === 'unmapped' ? 'subtle' : ACCENT[type]
}

/** What the window's edges say of the board past them. */
export function edgeMarks(layout: BoardLayout, window: Pick<PaintOptions, 'columns' | 'rows' | 'panX' | 'panY'>): { above: string; below: string; left: boolean; right: boolean } {
  const bottom = window.panY + window.rows
  // Always a count: the blocks wholly out of view, or with none (part of one is cut) the rows.
  const count = (hidden: (card: BoardCard) => boolean, rows: number, glyph: string, where: string): string => {
    const blocks = layout.cards.filter(hidden).length
    return blocks > 0 ? `${glyph} ${blocks} more ${where}` : `${glyph} ${rows} more ${rows === 1 ? 'row' : 'rows'} ${where}`
  }
  return {
    above: window.panY > 0 ? count(card => card.y + card.h <= window.panY, window.panY, '▲', 'above') : '',
    below: bottom < layout.height ? count(card => card.y >= bottom, layout.height - bottom, '▼', 'below') : '',
    left: window.panX > 0,
    right: window.panX + window.columns < layout.width,
  }
}

/** The containers whose header is scrolled off the window's top while their body shows: the innermost of each nest. */
export function stickyCards(layout: BoardLayout, panY: number): BoardCard[] {
  const open = layout.cards.filter(card => card.container && card.y < panY && card.y + card.h - 1 > panY)
  return open.filter(card => !open.some(other => other.parentId === card.id))
}

/** The board as rows of spans: exactly `rows` rows, none wider than `columns`. */
export function paintBoard(layout: BoardLayout, options: PaintOptions): Span[][] {
  const width = Math.max(0, Math.trunc(options.columns))
  const height = Math.max(0, Math.trunc(options.rows))
  const vertical = layout.orientation === 'vertical'
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
  const put = (x: number, y: number, text: string, style: number): void => {
    const row = y - options.panY
    if (row < 0 || row >= height) return
    let column = x - options.panX
    for (const char of text) {
      if (column >= 0 && column < width) {
        const line = chars[row]
        const tone = looks[row]
        if (line && tone) {
          line[column] = char
          tone[column] = style
        }
      }
      column++
    }
  }

  const runs = options.run ? cardRuns(layout, options.run) : undefined
  const lints = options.lints ?? new Set<string>()
  const offsets = options.offsets ?? {}
  const moving = Object.keys(offsets).length > 0
  const dragId = options.drag?.id ?? null
  const subtle = look({ color: 'subtle' })

  const flashIds = new Set(options.flash?.ids ?? [])
  const flashStrong = options.flash?.strong === true
  type Tone = { selected: boolean; grabbed: boolean; lifted: boolean; lit: boolean; faded: boolean; flashed: boolean; loud: boolean; tint: string; frame: typeof ROUND | typeof HEAVY | typeof DASHED; edge: number; run: CardRun | undefined }
  const toneOf = (card: BoardCard): Tone => {
    const selected = card.id === options.selectedId
    const grabbed = card.id === options.grabbedId
    const lifted = card.id === dragId
    const lit = selected || grabbed
    const run = runs?.get(card.id)
    // Dim is for a block the run never reached (and a card in the hand): a type is never dim by itself.
    const faded = lifted || run?.reached === false
    // A block an edit from chat just touched borrows `claude` for a moment, whatever its type.
    const flashed = !faded && flashIds.has(card.id)
    const tint = faded ? 'inactive' : flashed ? 'claude' : accentOf(card.type)
    // Selection is the heavy border and the bold words; the colour stays the type's.
    return { selected, grabbed, lifted, lit, faded, flashed, loud: flashed && flashStrong, tint, frame: lifted ? DASHED : lit ? HEAVY : ROUND, edge: look((lit || flashed) && !faded ? { color: tint, bold: true } : { color: tint }), run }
  }

  /** A box card's top border and what is written on it. `kept` columns at its right end are left for other words. */
  const drawTop = (card: BoardCard, x: number, y: number, tone: Tone, kept: number = 0): void => {
    const { frame, edge, tint, lit, lifted } = tone
    const grabbed = tone.grabbed || tone.loud
    put(x, y, `${frame[0]}${frame[1].repeat(Math.max(0, card.w - 2))}${frame[2]}`, edge)
    const marked = lints.has(card.id)
    const hx = x + (vertical ? 3 : 1)
    const room = card.w - (hx - x) - 3 - (marked ? 2 : 0) - kept
    if (room < 2) return
    const flags = { ...(lit ? { bold: true as const } : {}), ...(grabbed || lifted ? { inverse: true as const } : {}) }
    const head = clip(card.header, room)
    put(hx, y, ` ${head}`, look({ color: tint, ...flags }))
    let at = hx + 1 + head.length
    let left = room - head.length
    if (card.container) {
      const title = card.title === '' || card.title === card.type ? '' : card.title
      if (title !== '' && left >= 6) {
        // The title keeps at least half the room when there is an `each:` to say after it.
        const text = ` · ${clip(title, card.each === '' ? left - 3 : Math.max(Math.min(title.length, left - 3), Math.ceil(left / 2) - 3))}`
        put(at, y, text, look(lit && !tone.faded ? flags : { color: tint, ...flags }))
        at += text.length
        left -= text.length
      }
      if (card.each !== '' && left >= 14) {
        const text = ` · each: ${clip(card.each, left - 9)}`
        put(at, y, text, look({ color: tone.faded ? 'inactive' : 'subtle', ...(grabbed || lifted ? { inverse: true as const } : {}) }))
        at += text.length
      }
    }
    put(at, y, ' ', look({ color: tint, ...flags }))
    if (marked) put(x + card.w - 3 - kept, y, GLYPH.lint, look({ color: 'warning' }))
  }

  for (const card of layout.cards) {
    const offset = offsets[card.id]
    const x = card.x + (offset?.dx ?? 0)
    const y = card.y + (offset?.dy ?? 0)
    const tone = toneOf(card)
    const { selected, grabbed, lifted, lit, faded, tint, frame, edge, run } = tone

    if (card.line) {
      // One row: `╶── n3 agent · review ─────╴`, the run's count at its right end.
      put(x, y, `╶${frame[1].repeat(Math.max(0, card.w - 2))}╴`, edge)
      // The words keep the cells they need, and at least half the row; the status says what fits the rest.
      const words = card.header.length + (card.title === '' ? 0 : 3 + card.title.length)
      const status = fitStatus(run, Math.max(Math.floor(card.w / 2) - 4, card.w - 10 - words - (lints.has(card.id) ? 2 : 0)))
      const tail = status === '' ? 0 : status.length + 3
      const mark = lints.has(card.id) ? 2 : 0
      const room = card.w - 7 - tail - mark
      if (room >= 2) {
        const head = clip(card.header, room)
        const flags = grabbed || lifted || tone.loud ? { inverse: true as const } : {}
        put(x + 3, y, ` ${head}`, look({ color: tint, ...flags }))
        const rest = room - head.length
        const title = rest >= 5 && card.title !== '' ? ` · ${clip(card.title, rest - 3)}` : ''
        put(x + 4 + head.length, y, `${title} `, look(faded ? { color: 'inactive', ...flags } : flags))
      }
      if (mark) put(x + card.w - 3 - tail, y, GLYPH.lint, look({ color: 'warning' }))
      if (status !== '' && card.w - tail >= 8) put(x + card.w - 1 - tail, y, ` ${status} `, look({ color: run?.color ?? 'subtle' }))
      continue
    }

    // A card growing or shrinking to its size is drawn at the height it has reached.
    const h = Math.max(2, card.h + (offset?.dh ?? 0))
    drawTop(card, x, y, tone)
    for (let row = 1; row < h - 1; row++) {
      put(x, y + row, frame[3], edge)
      put(x + 1, y + row, ' '.repeat(Math.max(0, card.w - 2)), 0)
      put(x + card.w - 1, y + row, frame[3], edge)
    }
    // Many of these: the bottom border is a double line.
    const bottom = card.fanned ? FAN_BOTTOM[lit && !lifted ? 'heavy' : 'light'] : ([frame[4], frame[1], frame[5]] as const)
    put(x, y + h - 1, `${bottom[0]}${bottom[1].repeat(Math.max(0, card.w - 2))}${bottom[2]}`, edge)

    for (const [i, line] of card.lines.entries()) {
      if (1 + i >= h - 1) break
      const style: Look = line.role === 'title' ? (faded ? { color: 'inactive' } : lit ? { bold: true } : {}) : faded ? { color: 'inactive' } : line.role === 'note' ? {} : { color: 'subtle' }
      put(x + 2, y + 1 + i, clip(line.text, card.w - 4), look(style))
    }

    const acts = selected && !options.locked && dragId === null && !moving ? affordances(card, options.confirmId === card.id) : []
    // The bottom border: a container's meta (knobs, `out:`) from the left, the run's status after it (a leaf's meta is inside the card).
    // Top to bottom a container's border starts with its `+`; the words come after it.
    const fx = x + (vertical && card.container ? 5 : 1)
    const room = (acts[0]?.x ?? card.x + card.w - 1) - (fx - x + card.x) - 4
    const status = fitStatus(run, card.foot === '' ? room : Math.max(8, Math.ceil(room / 2)))
    const left = room - (status === '' ? 0 : status.length + 3)
    const foot = card.foot !== '' && left >= 8 ? clip(card.foot, left) : ''
    if (foot !== '') put(fx, y + h - 1, ` ${foot} `, look({ color: faded ? 'inactive' : 'subtle' }))
    if (status !== '' && status.length <= room) put(foot === '' ? fx : fx + foot.length + 3, y + h - 1, ` ${status} `, look({ color: run?.color ?? 'subtle' }))
    for (const act of acts) {
      const sure = act.kind === 'remove' && options.confirmId === card.id
      put(act.x, act.y, act.label, look({ color: sure ? 'error' : 'claude', ...(sure ? { bold: true } : {}), hover: `conductor-${act.kind}` }))
    }
  }

  // Edges and slots stand where the cards will be: left out while cards slide.
  if (!moving) {
    for (const edge of layout.edges) {
      const glyph = EDGE_GLYPH[edge.axis][edge.kind]
      const style = look(edge.kind === 'barrier' ? { bold: true } : { color: 'subtle' })
      if (edge.axis === 'h') put(edge.x, edge.y, glyph, style)
      else {
        // One row of line; its head sits on the next card's top border.
        put(edge.x, edge.y, glyph.slice(0, 1), style)
        put(edge.x, edge.y + 1, glyph.slice(1), style)
      }
    }
    // Between two blocks that do not follow one another: `or` (a branch's arms), `∥` (run at the same time).
    for (const rule of layout.rules) {
      if (rule.axis === 'h') put(rule.x, rule.y, ` ${rule.label} `.slice(0, rule.w), look({ color: 'subtle', bold: true }))
      else {
        put(rule.x, rule.y, '╌'.repeat(Math.max(0, rule.w)), subtle)
        put(rule.x + 2, rule.y, ` ${rule.label} `, look({ color: 'subtle', bold: true }))
      }
    }
    const drafting = options.emptyNote !== undefined && options.emptyNote !== '' && layout.cards.length === 0
    if (drafting) put(1, 0, clip(options.emptyNote ?? '', Math.max(1, width - 2)), look({ color: 'claude' }))
    if (!options.locked && dragId === null && !drafting) {
      for (const slot of layout.slots) {
        if (!slot.mark) continue
        const open = samePlace(options.pickerAt, slot.place)
        const hovered = samePlace(options.hoverAt, slot.place)
        if (!open && !hovered && !slotVisible(layout, slot, options.selectedId)) continue
        const style: Look = open ? { color: 'claude', bold: true, inverse: true } : { color: hovered ? 'claude' : 'subtle', ...(hovered ? { bold: true as const } : {}), hover: `conductor-slot-${slot.place.parentId ?? 'top'}-${slot.place.index}` }
        put(slot.mark.x - 1, slot.mark.y, ` ${slot.mark.label} `, look(style))
      }
    }
  }

  const { drag } = options
  if (drag) {
    const slot = drag.target && drag.target.to !== null ? drag.target.slot : undefined
    const bar = look({ color: 'claude', bold: true })
    if (slot && slot.bar === 'column') for (let row = 0; row < slot.h; row++) put(slot.mark?.x ?? slot.x, slot.y + row, '┃', bar)
    if (slot && slot.bar === 'row') put(slot.x, slot.y, '━'.repeat(slot.w), bar)
    const card = layout.cards.find(one => one.id === drag.id)
    if (card) {
      const chip = ` ${card.id} ${clip(card.title, 16)}${drag.hint ? ` · ${drag.hint}` : ''} `
      // Kept inside the window: the words say what a release does.
      const at = Math.max(0, Math.min(drag.x + 2, width - chip.length))
      put(at + options.panX, drag.y + options.panY, chip, look({ color: 'claude', bold: true, inverse: true }))
    }
  }

  // Where the board goes on past the window: a sticky header for the container the top row is inside, and dim words at the edges.
  if (height >= 3 && width >= 8) {
    const marks = edgeMarks(layout, { columns: width, rows: height, panX: options.panX, panY: options.panY })
    if (marks.above !== '') {
      const pinned = moving ? [] : stickyCards(layout, options.panY)
      const first = pinned[0]
      const words = ` ${marks.above} `
      const inside = first !== undefined && first.w >= words.length + 16
      if (!first) put(options.panX, options.panY, ' '.repeat(width), 0)
      for (const card of pinned) drawTop(card, card.x, options.panY, toneOf(card), card === first && inside ? words.length + 1 : 0)
      if (first && inside) put(first.x + first.w - 2 - words.length, options.panY, words, subtle)
      else if (!first) put(options.panX + 1, options.panY, marks.above, subtle)
    }
    if (marks.below !== '') {
      put(options.panX, options.panY + height - 1, ' '.repeat(width), 0)
      put(options.panX + 1, options.panY + height - 1, marks.below, subtle)
    }
    // Sideways: one glyph in the edge column, on the empty cell nearest mid-height, so nothing drawn is written over.
    const side = look({ color: 'subtle', bold: true })
    const free = (column: number): number | undefined => {
      for (let away = 0; away < height; away++) {
        for (const row of [Math.floor(height / 2) - away, Math.floor(height / 2) + away]) {
          // Not on the first or last row: those say what is above and below.
          if (row >= 1 && row < height - 1 && chars[row]?.[column] === ' ' && looks[row]?.[column] === 0) return row
        }
      }
      return undefined
    }
    const leftRow = marks.left ? free(0) : undefined
    const rightRow = marks.right ? free(width - 1) : undefined
    if (leftRow !== undefined) put(options.panX, options.panY + leftRow, '◀', side)
    if (rightRow !== undefined) put(options.panX + width - 1, options.panY + rightRow, '▶', side)
  }

  return chars.map((line, row) => {
    const tone = looks[row] ?? []
    let end = line.length
    while (end > 0 && line[end - 1] === ' ' && tone[end - 1] === 0) end--
    const spans: Span[] = []
    let start = 0
    for (let at = 1; at <= end; at++) {
      if (at < end && tone[at] === tone[start]) continue
      spans.push({ text: line.slice(start, at).join(''), ...table[tone[start] ?? 0] })
      start = at
    }
    return spans.length > 0 ? spans : [{ text: ' ' }]
  })
}

/** Roughly what the painted rows weigh as a tree, in characters: the engine refuses a tree past 100,000. */
export function paintWeight(lines: readonly Span[][]): number {
  return lines.reduce((sum, line) => sum + 40 + line.reduce((cells, span) => cells + span.text.length + 50 + (span.hover ? 90 : 0) + (span.color ? 20 : 0), 0), 0)
}

/** The rows as plain text, for tests and for a surface with no `Client`. */
export function paintText(lines: readonly Span[][]): string[] {
  return lines.map(line => line.map(span => span.text).join('').replace(/\s+$/, ''))
}
