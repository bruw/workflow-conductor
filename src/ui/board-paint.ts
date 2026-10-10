// The flow board's paint: a layout as rows of styled spans, one character per
// cell, clipped to the window the pane gives it. Pure TypeScript: no `$`, no
// engine imports. Drawing by cell (and not with nested bordered boxes) lets a
// border carry a title, an edge sit between two cards, and the board pan.

import type { NodeType } from '../design/model'
import type { Place } from '../design/ops'
import type { NodeRun, RunStatus } from '../run/events'
import { clip, samePlace } from './board-layout'
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
  /** `3/3 27.7k`, with `1✗` between when an agent failed; `waiting` or `not run` with no agent. */
  text: string
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
      if (card.type !== 'code') out.set(card.id, { glyph: '·', color: 'inactive', text: over ? NOT_RUN : WAITING, reached: !over })
      continue
    }
    const settled = sum.done + sum.failed
    const text = `${settled}/${sum.total}${sum.failed > 0 ? ` ${sum.failed}${FAILED}` : ''} ${fmtTokens(sum.tokens)}`
    if (sum.running > 0) out.set(card.id, { glyph: spinnerFrame(run.now ?? 0), color: 'claude', text, reached: true })
    else if (sum.failed > 0) out.set(card.id, { glyph: FAILED, color: 'error', text, reached: true })
    else out.set(card.id, { glyph: GLYPH.done, color: 'success', text, reached: true })
  }
  return out
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
  if (card.type === 'unmapped') return []
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
  /** Ids of nodes a lint marks. */
  lints?: ReadonlySet<string>
  run?: RunOverlay
  /** A run is in progress: no slots, no affordances. */
  locked?: boolean
  /** A card in the pointer's hand: `x`, `y` are window cells. */
  drag?: { id: string; target: DropTarget | null; x: number; y: number } | null
  /** Cards still sliding to their place: cells away from it. */
  offsets?: Record<string, { dx: number; dy: number }>
  /** Colours and hovers left out: what a board too large for one tree falls back to. */
  plain?: boolean
}

const ROUND = ['╭', '─', '╮', '│', '╰', '╯'] as const
const HEAVY = ['┏', '━', '┓', '┃', '┗', '┛'] as const
const DASHED = ['╭', '╌', '╮', '┆', '╰', '╯'] as const

export const EDGE_GLYPH = {
  h: { stream: '─▶', barrier: '═▶' },
  v: { stream: '│▼', barrier: '║▼' },
} as const

export const EMPTY_HINT = 'add the first block'

function accentOf(type: NodeType | 'unmapped'): string {
  return type === 'unmapped' ? 'inactive' : ACCENT[type]
}

/** The board as rows of spans: exactly `rows` rows, none wider than `columns`. */
export function paintBoard(layout: BoardLayout, options: PaintOptions): Span[][] {
  const width = Math.max(0, Math.trunc(options.columns))
  const height = Math.max(0, Math.trunc(options.rows))
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

  for (const card of layout.cards) {
    const offset = offsets[card.id]
    const x = card.x + (offset?.dx ?? 0)
    const y = card.y + (offset?.dy ?? 0)
    const selected = card.id === options.selectedId
    const grabbed = card.id === options.grabbedId
    const lifted = card.id === dragId
    const lit = selected || grabbed
    const run = runs?.get(card.id)
    const faded = lifted || run?.reached === false
    const tint = faded ? 'inactive' : lit ? 'claude' : accentOf(card.type)
    const frame = lifted ? DASHED : lit ? HEAVY : ROUND
    const edge = look(lit && !faded ? { color: tint, bold: true } : { color: tint })

    put(x, y, `${frame[0]}${frame[1].repeat(Math.max(0, card.w - 2))}${frame[2]}`, edge)
    for (let row = 1; row < card.h - 1; row++) {
      put(x, y + row, frame[3], edge)
      put(x + 1, y + row, ' '.repeat(Math.max(0, card.w - 2)), 0)
      put(x + card.w - 1, y + row, frame[3], edge)
    }
    put(x, y + card.h - 1, `${frame[4]}${frame[1].repeat(Math.max(0, card.w - 2))}${frame[5]}`, edge)
    if (card.shadow) for (let row = 1; row < card.h; row++) put(x + card.w, y + row, '▒', look({ color: 'subtle' }))

    const marked = lints.has(card.id)
    put(x + 1, y, ` ${clip(card.header, card.w - 4 - (marked ? 2 : 0))} `, look({ color: tint, ...(lit ? { bold: true } : {}), ...(grabbed || lifted ? { inverse: true } : {}) }))
    if (marked) put(x + card.w - 3, y, GLYPH.lint, look({ color: 'warning' }))

    const acts = selected && !options.locked && dragId === null && !moving ? affordances(card, options.confirmId === card.id) : []
    const status = run ? `${run.glyph} ${run.text}` : ''
    if (card.container) {
      const foot = status || card.knobs
      const room = (acts[0]?.x ?? card.x + card.w - 1) - card.x - 4
      if (foot !== '' && room >= 4) put(x + 1, y + card.h - 1, ` ${clip(foot, room)} `, look({ color: run ? run.color : 'subtle' }))
    } else {
      put(x + 2, y + 1, clip(card.title, card.w - 4), look(faded ? { color: 'inactive' } : lit ? { bold: true } : {}))
      if (run) put(x + 2, y + 2, clip(status, card.w - 4), look({ color: run.color }))
      else put(x + 2, y + 2, clip(card.knobs, card.w - 4), look({ color: 'subtle' }))
    }
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
        put(edge.x, edge.y, glyph.slice(0, 1), style)
        put(edge.x, edge.y + 1, glyph.slice(1), style)
      }
    }
    if (!options.locked && dragId === null) {
      for (const slot of layout.slots) {
        if (!slot.mark) continue
        const open = samePlace(options.pickerAt, slot.place)
        put(slot.mark.x - 1, slot.mark.y, ' + ', look(open ? { color: 'claude', bold: true, inverse: true } : { color: 'subtle', hover: `conductor-slot-${slot.place.parentId ?? 'top'}-${slot.place.index}` }))
      }
      if (layout.cards.length === 0) put(4, 0, EMPTY_HINT, look({ color: 'subtle' }))
    }
  }

  const { drag } = options
  if (drag) {
    const slot = drag.target && drag.target.to !== null ? drag.target.slot : undefined
    const bar = look({ color: 'claude', bold: true })
    if (slot && slot.axis === 'h') for (let row = 0; row < slot.h; row++) put(slot.mark?.x ?? slot.x, slot.y + row, '┃', bar)
    if (slot && slot.axis === 'v') put(slot.x, slot.mark?.y ?? slot.y, '━'.repeat(slot.w), bar)
    const card = layout.cards.find(one => one.id === drag.id)
    if (card) put(drag.x + 2 + options.panX, drag.y + options.panY, ` ${card.id} ${clip(card.title, 16)} `, look({ color: 'claude', bold: true, inverse: true }))
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
