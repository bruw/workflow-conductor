// The flow board's layout: a Design as positioned cards, edges and insertion
// slots, in character cells. Pure TypeScript: no `$`, no engine imports.
//
// One model, two orientations. The main axis is the flow: left to right when
// the pane is wide and short (`horizontal`), top to bottom when it is narrow
// and tall (`vertical`). A container is a box around its children; a `chain`
// (pipeline, loops, the top level) lays them along the main axis with an edge
// between each pair, a `stack` (parallel, sweep, branch) lays them across it.

import { canHoldChildren, flatten } from '../design/model'
import type { Design, DesignNode, NodeType } from '../design/model'
import type { Place } from '../design/ops'

export type Orientation = 'horizontal' | 'vertical'
/** A screen axis: `h` runs left to right, `v` top to bottom. */
export type Axis = 'h' | 'v'
export type Rect = { x: number; y: number; w: number; h: number }
/** `stream`: each result is handed on as it arrives. `barrier`: the next block waits for all of them. */
export type EdgeKind = 'stream' | 'barrier'
export type Flow = 'chain' | 'stack'
export type Direction = 'left' | 'right' | 'up' | 'down'

/** The id of the card that stands for the agents no block claims; no node id has this form. */
export const UNMAPPED_ID = 'unmapped'

export const LEAF_MIN_W = 16
/** With a run laid over it a card's status needs more room. */
export const LEAF_MIN_RUN_W = 20
export const LEAF_MAX_W = 30
/** A left-to-right card: borders, the title and one line of notes. */
export const LEAF_H = 4
/** How wide the selected card may grow on a left-to-right board, so its notes have room to wrap. */
export const EXPANDED_W = 40
export const CONTAINER_MIN_W = 22
/** Top to bottom, cards fill the board's width: this is the width with none given, and the most a very wide pane is used. */
export const BOARD_DEFAULT_W = 60
export const BOARD_MAX_W = 100
export const BOARD_MIN_W = 24
/** Top to bottom, side-by-side branches share their container's width down to this; past it the board grows and pans. */
export const BRANCH_MIN_W = 18
/** Columns between two chained cards: room for ` ─▶ `. */
export const GAP_H = 4
/** Rows between two chained cards, top to bottom: the connector, one row. */
export const GAP_V = 1
/** Lines of notes on a card that is not selected: top to bottom, left to right. */
export const NOTE_ROWS = { vertical: 2, horizontal: 1 } as const
/** The `+` after the last card of a left-to-right list. */
const END_W = 3
/** How far (columns, a row counting four) a dragged card may be from a slot and still drop into it. */
export const DROP_REACH = 16
export const ADD_FIRST = '+ add first block'
export const ADD_BLOCK = '+ add block'
export const EMPTY_HINT = '+ add the first block'

/** One row of text inside a card. `more` is the `… N more lines` marker, `summary` the knobs of the selected card. */
export type CardLine = { text: string; role: 'title' | 'note' | 'more' | 'summary' }

export type BoardCard = Rect & {
  id: string
  type: NodeType | 'unmapped'
  /** `n2 pipeline ×4`. */
  header: string
  title: string
  /** A container's per-item text (its `fanout` knob without the count): `each: …` in its header. '' with none. */
  each: string
  /** The rows of text inside the box, from its second row: a leaf's title and notes, a selected container's notes. */
  lines: CardLine[]
  /** What the bottom border says: the knobs worth a glance, and for a container `out: …` (its `schema` knob). '' with none. */
  foot: string
  /** `×4`, `×n` for a fan-out with no stated count, '' for none. */
  fan: string
  /** Borders drawn under the bottom one, each a column in: there are many of these. They are outside the card's own rows. */
  stack: 0 | 1 | 2
  /** A one-row card: what compact mode makes of every leaf that is not selected. */
  line: boolean
  /** The selected card, grown to show all its notes. */
  expanded: boolean
  depth: number
  parentId: string | undefined
  index: number
  container: boolean
  /** How many blocks it holds, at any depth. */
  inside: number
  /** The axis its siblings run along. */
  axis: Axis
}

export type BoardEdge = { kind: EdgeKind; from: string; to: string; axis: Axis; x: number; y: number }

export type BoardSlot = Rect & {
  place: Place
  depth: number
  /** The axis the list runs along. */
  axis: Axis
  /** The slot after the last card of its list. */
  end: boolean
  /** How a drop here is marked: a bar along a row, or down a column. */
  bar: 'row' | 'column'
  /** Where its `+` (or `+ add …`) is drawn, from the first character; null for a slot that only takes a drop. */
  mark: { x: number; y: number; label: string } | null
}

export type BoardLayout = {
  orientation: Orientation
  width: number
  height: number
  /** Parents before their children. */
  cards: BoardCard[]
  edges: BoardEdge[]
  slots: BoardSlot[]
}

export type LayoutOptions = {
  orientation: Orientation
  /** A run is laid over the design: cards are a little wider. */
  run?: boolean
  /** Agents no block claims: more than 0 adds their card after the design. */
  unmapped?: number
  /** The columns there are. Top to bottom the cards fill them (up to BOARD_MAX_W). */
  width?: number
  /** The selected block: its card grows to show its notes in full. */
  selectedId?: string | null
  /** Every leaf that is not selected is one row. */
  compact?: boolean
  /** The most rows of notes the selected card shows, the `… N more lines` row counted. */
  noteRows?: number
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function clip(text: string, max: number): string {
  if (max <= 0) return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** `text` as lines no wider than `width`, broken between words; a word longer than a line is cut. */
export function wrapText(text: string, width: number): string[] {
  const room = Math.max(1, Math.trunc(width))
  const out: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    for (let word of paragraph.split(/\s+/).filter(one => one !== '')) {
      if (line !== '' && line.length + 1 + word.length <= room) {
        line += ` ${word}`
        continue
      }
      if (line !== '') out.push(line)
      while (word.length > room) {
        out.push(word.slice(0, room))
        word = word.slice(room)
      }
      line = word
    }
    if (line !== '') out.push(line)
  }
  return out
}

/** At most `max` lines of `text`: the last one ends in `…` when there is more. */
export function firstLines(text: string, width: number, max: number): string[] {
  const all = wrapText(text, width)
  if (all.length <= max) return all
  const shown = all.slice(0, max)
  const last = shown[max - 1] ?? ''
  if (max > 0) shown[max - 1] = last.length + 1 > width ? `${last.slice(0, Math.max(0, width - 1))}…` : `${last}…`
  return shown
}

export function moreLines(count: number): string {
  return `… ${count} more ${count === 1 ? 'line' : 'lines'}`
}

/** All of `text` wrapped, or its first `max - 1` lines and a row saying how many more there are. */
export function cappedLines(text: string, width: number, max: number): { lines: string[]; more: number } {
  const all = wrapText(text, width)
  const most = Math.max(1, Math.trunc(max))
  if (all.length <= most) return { lines: all, more: 0 }
  const lines = all.slice(0, Math.max(1, most - 1))
  return { lines, more: all.length - lines.length }
}

/** The most rows of notes the selected card shows in a board with `room` rows (top to bottom, the `… N more lines` row counted). */
export function expandRows(orientation: Orientation, room: number): number {
  if (orientation === 'vertical') return Math.max(3, Math.min(10, Math.floor(room / 3)))
  // Left to right the rows are few: two containers, their stacked borders and the card's own leave these.
  return Math.max(2, Math.min(4, room - 9))
}

/** `×4` from a stated count (`×4 dimensions`, `4 angles`, votes), `×n` for any other fan-out, '' for none. */
export function fanOf(node: Pick<DesignNode, 'knobs'>): string {
  const knobs = node.knobs ?? {}
  if (knobs.fanout) {
    const count = /^\s*[×x]?\s*(\d+)\b/.exec(knobs.fanout)
    return count ? `×${count[1]}` : '×n'
  }
  return knobs.votes !== undefined ? `×${knobs.votes}` : ''
}

/** What a fan-out runs once for: the `fanout` knob without its count (`×4 dimensions` → `dimensions`). */
export function eachOf(node: Pick<DesignNode, 'knobs'>): string {
  const fanout = clean(node.knobs?.fanout ?? '')
  const rest = fanout.replace(/^[×x]?\s*\d+\b\s*/, '')
  return rest === '' ? fanout.replace(/^[×x]\s*/, '') : rest
}

/** How many borders are drawn under a card that fans out: one for two, two for more (or for a count not stated). */
export function stackOf(fan: string): 0 | 1 | 2 {
  if (fan === '') return 0
  const count = Number(fan.slice(1))
  if (Number.isNaN(count)) return 2
  return count <= 1 ? 0 : count === 2 ? 1 : 2
}

/** How a container arranges what it holds: stages chained along the flow, or branches stacked across it. */
export function childFlow(type: NodeType | undefined): Flow {
  return type === 'parallel' || type === 'sweep' || type === 'branch' ? 'stack' : 'chain'
}

const MANY: readonly NodeType[] = ['pipeline', 'parallel', 'sweep', 'judge-panel']

/**
 * The edge leaving `from` inside `parent` (undefined at the top level). Stages of
 * a pipeline hand each item on with no barrier. Anywhere else the next block
 * starts when `from` is done: a barrier when `from` yields many results (a
 * fan-out, votes, a pipeline, a parallel, a sweep, a panel), a plain hand-off
 * when it yields one.
 */
export function edgeKind(parent: NodeType | undefined, from: Pick<DesignNode, 'type' | 'knobs'>): EdgeKind {
  if (parent === 'pipeline') return 'stream'
  return MANY.includes(from.type) || fanOf(from) !== '' ? 'barrier' : 'stream'
}

/** The axis a list's cards run along. */
export function flowAxis(flow: Flow, orientation: Orientation): Axis {
  const main: Axis = orientation === 'horizontal' ? 'h' : 'v'
  if (flow === 'chain') return main
  return main === 'h' ? 'v' : 'h'
}

/** The knobs worth a glance: model, effort, isolation, votes, until. The fan-out is said elsewhere (`×N`, `each:`). */
export function knobLine(node: DesignNode): string {
  const knobs = node.knobs ?? {}
  const parts: string[] = []
  if (knobs.model) parts.push(knobs.model)
  if (knobs.effort) parts.push(knobs.effort)
  if (knobs.isolation) parts.push(knobs.isolation)
  if (knobs.votes !== undefined) parts.push(`${knobs.votes} votes`)
  if (knobs.until) parts.push(`until ${clean(knobs.until)}`)
  return parts.join(' · ')
}

/** What a card's bottom border says. A leaf names what it runs once for; a container, what it hands on. */
export function footLine(node: DesignNode): string {
  const parts = [knobLine(node)]
  if (canHoldChildren(node.type)) {
    if (node.knobs?.schema) parts.push(`out: ${clean(node.knobs.schema)}`)
  } else if (node.knobs?.fanout) parts.push(`each: ${eachOf(node)}`)
  return parts.filter(part => part !== '').join(' · ')
}

/** The selected card's one line of knobs: the bottom border's words and what the block hands on. */
export function summaryLine(node: DesignNode): string {
  const parts = [footLine(node)]
  if (!canHoldChildren(node.type) && node.knobs?.schema) parts.push(`out: ${clean(node.knobs.schema)}`)
  return parts.filter(part => part !== '').join(' · ')
}

/** What a card says under its title: the block's notes, or with none what its prompt asks. */
export function cardText(node: DesignNode): string {
  const notes = (node.notes ?? '').trim()
  return notes !== '' ? notes : (node.knobs?.prompt ?? '').trim()
}

type Measured = {
  node: DesignNode
  w: number
  /** The box's own rows. */
  h: number
  /** Rows with the stacked borders under it. */
  fh: number
  header: string
  title: string
  each: string
  lines: CardLine[]
  foot: string
  fan: string
  stack: 0 | 1 | 2
  line: boolean
  expanded: boolean
  flow: Flow | null
  kids: Measured[]
  inside: number
}

type Arranged = { w: number; h: number; at: { x: number; y: number }[]; end: { x: number; y: number } }

/** What a list is laid out by: which way the board runs, and whether the list is the top level (which has no box to carry its last `+`). */
type ListShape = { flow: Flow; axis: Axis; orientation: Orientation; top: boolean }

/** Where the cards of one list go, from the list's own corner, and where its end slot starts. */
function arrange(sizes: readonly { w: number; fh: number }[], shape: ListShape): Arranged {
  const { flow, axis, orientation, top } = shape
  const at: { x: number; y: number }[] = []
  let x = 0
  let y = 0
  let w = 0
  let h = 0
  for (const [i, size] of sizes.entries()) {
    const last = i === sizes.length - 1
    at.push({ x, y })
    if (axis === 'h') {
      x += size.w + (last ? 0 : flow === 'chain' ? GAP_H : 1)
      h = Math.max(h, size.fh)
    } else {
      y += size.fh + (last ? 0 : flow === 'chain' ? GAP_V : 0)
      w = Math.max(w, size.w)
    }
  }
  const empty = sizes.length === 0
  if (orientation === 'horizontal') {
    // Left to right every list ends in room for its `+`: a column after a chain, a row under a stack.
    const label = empty ? (top ? EMPTY_HINT : ADD_FIRST).length + 1 : END_W
    if (axis === 'h') return { w: x + label, h: Math.max(h, 1), at, end: { x, y: 0 } }
    return { w: Math.max(w, label), h: y + 1, at, end: { x: 0, y } }
  }
  // Top to bottom a container's last `+` is on its bottom border; an empty one, and the top level, give it a row.
  if (axis === 'h') return { w: x, h: Math.max(h, 1), at, end: { x: 0, y: 0 } }
  return { w, h: empty ? 1 : top ? y + 1 : y, at, end: { x: 0, y } }
}

type Ctx = Required<Pick<LayoutOptions, 'orientation' | 'run' | 'compact' | 'noteRows'>> & { selectedId: string | null }

function noteLines(node: DesignNode, width: number, selected: boolean, ctx: Ctx): CardLine[] {
  const text = cardText(node)
  if (text === '') return []
  // Left to right there is no row to spare for a count of what is left: the last line ends in `…`.
  if (!selected || ctx.orientation === 'horizontal') return firstLines(text, width, selected ? ctx.noteRows : NOTE_ROWS[ctx.orientation]).map(one => ({ text: one, role: 'note' as const }))
  const capped = cappedLines(text, width, ctx.noteRows)
  const lines: CardLine[] = capped.lines.map(one => ({ text: one, role: 'note' as const }))
  if (capped.more > 0) lines.push({ text: moreLines(capped.more), role: 'more' })
  return lines
}

/**
 * Sizes a block and all it holds. `width` is the columns it is given: top to
 * bottom it fills them (a row of branches that cannot share them grows past);
 * left to right it is ignored and a card is as wide as its words ask.
 */
function measure(node: DesignNode, width: number, ctx: Ctx): Measured {
  const fan = fanOf(node)
  const header = `${node.id} ${node.type}${fan ? ` ${fan}` : ''}`
  const title = clean(node.title)
  const selected = node.id === ctx.selectedId
  const vertical = ctx.orientation === 'vertical'
  const base = { node, header, title, fan, expanded: selected }

  if (!canHoldChildren(node.type)) {
    const foot = footLine(node)
    const none = { ...base, each: '', flow: null, kids: [], inside: 0 }
    if (ctx.compact && !selected) {
      const w = vertical ? width : Math.min(EXPANDED_W, Math.max(LEAF_MIN_W, header.length + 3 + title.length + 7))
      return { ...none, w, h: 1, fh: 1, lines: [], foot: '', stack: 0, line: true }
    }
    const natural = Math.max(ctx.run ? LEAF_MIN_RUN_W : LEAF_MIN_W, Math.min(LEAF_MAX_W, Math.max(header.length, title.length, foot.length) + 4))
    const w = vertical ? width : selected && cardText(node).length > natural - 4 ? Math.max(natural, EXPANDED_W) : natural
    const lines: CardLine[] = [{ text: title, role: 'title' }, ...noteLines(node, w - 4, selected, ctx)]
    // Top to bottom the selected card says its knobs on a row of their own; left to right they stay on the border.
    const summary = selected && vertical ? summaryLine(node) : ''
    if (summary !== '') lines.push({ text: summary, role: 'summary' })
    const h = Math.max(vertical ? 3 : LEAF_H, lines.length + 2)
    const stack = stackOf(fan)
    return { ...none, w, h, fh: h + stack, lines, foot: selected && vertical ? '' : foot, stack, line: false }
  }

  const flow = childFlow(node.type)
  const axis = flowAxis(flow, ctx.orientation)
  const kin = node.children ?? []
  let kids: Measured[]
  if (!vertical) kids = kin.map(child => measure(child, 0, ctx))
  else if (axis === 'v') kids = kin.map(child => measure(child, width - 4, ctx))
  else {
    // Branches side by side share the columns; the last takes what the division leaves over.
    const room = width - 4 - Math.max(0, kin.length - 1)
    const share = Math.max(BRANCH_MIN_W, Math.floor(room / Math.max(1, kin.length)))
    kids = kin.map((child, i) => measure(child, i === kin.length - 1 ? Math.max(share, room - share * (kin.length - 1)) : share, ctx))
  }
  const list = arrange(kids, { flow, axis, orientation: ctx.orientation, top: false })
  const w = vertical ? Math.max(width, list.w + 4) : Math.max(CONTAINER_MIN_W, list.w + 4, Math.min(header.length + (title === '' || title === node.type ? 0 : 3 + Math.min(title.length, 18)), 44) + 4)
  // A selected container says its notes above what it holds.
  const lines = selected ? noteLines(node, w - 4, true, { ...ctx, noteRows: Math.min(ctx.noteRows, vertical ? 4 : 1) }) : []
  const h = list.h + 2 + lines.length
  const stack = stackOf(fan)
  const inside = kids.reduce((sum, kid) => sum + 1 + kid.inside, 0)
  return { ...base, each: fan === '' ? '' : eachOf(node), w, h, fh: h + stack, lines, foot: footLine(node), stack, line: false, flow, kids, inside }
}

/** The board for a design: every card, edge and slot, in cells from the board's top left. */
export function layoutBoard(design: Design, options: LayoutOptions): BoardLayout {
  const cards: BoardCard[] = []
  const edges: BoardEdge[] = []
  const slots: BoardSlot[] = []
  const { orientation } = options
  const vertical = orientation === 'vertical'
  const span = vertical ? Math.max(BOARD_MIN_W, Math.min(BOARD_MAX_W, Math.trunc(options.width ?? BOARD_DEFAULT_W))) : 0
  const ctx: Ctx = {
    orientation,
    run: options.run ?? false,
    compact: options.compact ?? false,
    selectedId: options.selectedId ?? null,
    noteRows: Math.max(1, options.noteRows ?? (vertical ? 8 : 3)),
  }

  const placeList = (kids: Measured[], flow: Flow, ox: number, oy: number, box: BoardCard | undefined, depth: number): Arranged => {
    const axis = flowAxis(flow, orientation)
    const list = arrange(kids, { flow, axis, orientation, top: box === undefined })
    const count = kids.length
    const place = (index: number): Place => (box ? { parentId: box.id, index } : { index })
    const lw = vertical ? (box ? box.w - 4 : Math.max(span, list.w)) : list.w
    const firstLabel = clip(box ? ADD_FIRST : EMPTY_HINT, Math.max(1, lw - (vertical ? 2 : 1)))

    const made: BoardCard[] = []
    for (const [i, kid] of kids.entries()) {
      const spot = list.at[i] ?? { x: 0, y: 0 }
      const card: BoardCard = {
        x: ox + spot.x,
        y: oy + spot.y,
        w: kid.w,
        h: kid.h,
        id: kid.node.id,
        type: kid.node.type,
        header: kid.header,
        title: kid.title,
        each: kid.each,
        lines: kid.lines,
        foot: kid.foot,
        fan: kid.fan,
        stack: kid.stack,
        line: kid.line,
        expanded: kid.expanded,
        depth,
        parentId: box?.id,
        index: i,
        container: kid.flow !== null,
        inside: kid.inside,
        axis,
      }
      cards.push(card)
      made.push(card)
      if (kid.flow !== null) placeList(kid.kids, kid.flow, card.x + 2, card.y + 1 + kid.lines.length, card, depth + 1)
    }

    for (let i = 0; i <= count; i++) {
      const here = made[i]
      if (!here) {
        // The end of the list.
        const x = ox + list.end.x
        const y = oy + list.end.y
        const common = { place: place(count), depth, axis, end: true }
        if (!vertical) {
          const label = count === 0 ? firstLabel : '+'
          if (axis === 'h') slots.push({ ...common, x, y: oy, w: label.length + 2, h: list.h, bar: 'column', mark: { x: x + 1, y: oy + (list.h >= 2 ? 1 : 0), label } })
          else slots.push({ ...common, x: ox, y, w: list.w, h: 1, bar: 'row', mark: { x: ox + 1, y, label } })
        } else if (count === 0) {
          slots.push({ ...common, x: ox, y: oy, w: lw, h: 1, bar: 'row', mark: { x: ox + 1, y: oy, label: firstLabel } })
        } else if (box) {
          // On the bottom border of the box it adds to.
          const by = box.y + box.h - 1
          slots.push({ ...common, x: box.x, y: by, w: box.w, h: 1, bar: 'row', mark: { x: box.x + 3, y: by, label: '+' } })
        } else {
          slots.push({ ...common, x: ox, y, w: lw, h: 1, bar: 'row', mark: { x: ox + 1, y, label: ADD_BLOCK } })
        }
        continue
      }
      const common = { place: place(i), depth, axis, end: false }
      if (axis === 'h') {
        const gap = flow === 'chain' ? GAP_H : 1
        if (i === 0) slots.push({ ...common, x: here.x, y: oy, w: 1, h: list.h, bar: 'column', mark: null })
        else slots.push({ ...common, x: here.x - gap, y: oy, w: gap, h: list.h, bar: 'column', mark: flow === 'chain' ? { x: here.x - gap + 1, y: oy + Math.min(2, list.h - 1), label: '+' } : null })
      } else if (i === 0 || flow === 'stack') {
        slots.push({ ...common, x: ox, y: here.y, w: lw, h: 1, bar: 'row', mark: null })
      } else {
        // The connector's row: the `+` a little right of the line, the same place at every level.
        slots.push({ ...common, x: ox, y: here.y - GAP_V, w: lw, h: GAP_V, bar: 'row', mark: { x: ox + 5, y: here.y - GAP_V, label: '+' } })
      }
      const before = kids[i - 1]
      const prior = made[i - 1]
      if (flow === 'chain' && before && prior) {
        const kind = edgeKind(box?.type === 'unmapped' ? undefined : box?.type, before.node)
        if (axis === 'h') edges.push({ kind, from: prior.id, to: here.id, axis, x: here.x - GAP_H + 1, y: oy + (Math.min(prior.h, here.h) >= 3 ? 1 : 0) })
        else edges.push({ kind, from: prior.id, to: here.id, axis, x: ox + 2, y: here.y - GAP_V })
      }
    }
    return list
  }

  const top = placeList(
    design.nodes.map(node => measure(node, span, ctx)),
    'chain',
    0,
    0,
    undefined,
    0,
  )
  let width = vertical ? Math.max(span, top.w) : top.w
  let height = top.h
  const strays = options.unmapped ?? 0
  if (strays > 0) {
    const fan = `×${strays}`
    const title = 'no block claims these'
    const w = vertical ? span : title.length + 4
    const x = vertical ? 0 : top.w + 1
    const y = vertical ? top.h : 0
    const stack = stackOf(fan)
    cards.push({ x, y, w, h: LEAF_H - 1, id: UNMAPPED_ID, type: 'unmapped', header: `unmapped ${fan}`, title, each: '', lines: [{ text: title, role: 'title' }], foot: '', fan, stack, line: false, expanded: false, depth: 0, parentId: undefined, index: design.nodes.length, container: false, inside: 0, axis: vertical ? 'v' : 'h' })
    width = Math.max(width, x + w)
    height = Math.max(height, y + LEAF_H - 1 + stack)
  }
  return { orientation, width, height, cards, edges, slots }
}

/**
 * The orientation to draw in. A docked pane (narrow, tall) asks for `vertical` and
 * gets it. An inline pane asks for `horizontal`, and gets it unless the board is
 * then taller than the rows there are while the vertical one fits the columns.
 */
export function chooseOrientation(design: Design, wanted: Orientation, columns: number, rows: number, options: Omit<LayoutOptions, 'orientation'> = {}): Orientation {
  if (wanted === 'vertical') return 'vertical'
  if (rows <= 0 || layoutBoard(design, { ...options, orientation: 'horizontal' }).height <= rows) return 'horizontal'
  return columns > 0 && layoutBoard(design, { ...options, orientation: 'vertical', width: columns }).width <= columns ? 'vertical' : 'horizontal'
}

function within(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
}

/** The innermost card under a cell. */
export function cardAt(layout: BoardLayout, x: number, y: number): BoardCard | undefined {
  for (let i = layout.cards.length - 1; i >= 0; i--) {
    const card = layout.cards[i]
    if (card && within(card, x, y)) return card
  }
  return undefined
}

/** The slot whose `+` (its words, and the cell on either side) is under a cell, drawn or not. */
export function slotAt(layout: BoardLayout, x: number, y: number): BoardSlot | undefined {
  return layout.slots.find(slot => slot.mark !== null && slot.mark.y === y && x >= slot.mark.x - 1 && x <= slot.mark.x + slot.mark.label.length)
}

/**
 * Whether a slot's `+` is drawn with no pointer on it: the slots before and
 * after the selected card, the end of the list it is in, the end of the selected
 * container's own list, the end of the top level, and an empty container's one
 * slot. Every other `+` waits for the pointer.
 */
export function slotVisible(layout: BoardLayout, slot: BoardSlot, selectedId: string | null): boolean {
  if (!slot.mark) return false
  if (slot.end && (slot.place.parentId === undefined || slot.place.index === 0)) return true
  const selected = selectedId === null ? undefined : layout.cards.find(card => card.id === selectedId)
  if (!selected || selected.type === 'unmapped') return false
  if (slot.end && slot.place.parentId === selected.id) return true
  if (slot.place.parentId !== selected.parentId) return false
  return slot.end || slot.place.index === selected.index || slot.place.index === selected.index + 1
}

export function samePlace(a: Place | null | undefined, b: Place | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && a.parentId === b.parentId && a.index === b.index
}

/** A card and everything inside it. */
function subtree(layout: BoardLayout, id: string): Set<string> {
  const ids = new Set([id])
  for (const card of layout.cards) if (card.parentId !== undefined && ids.has(card.parentId)) ids.add(card.id)
  return ids
}

export type DropTarget = {
  slot: BoardSlot
  /** Where `moveNode` is to put the card; null when the slot is where the card already is. */
  to: Place | null
}

/**
 * Where a card dragged to a cell would land: the nearest slot within reach that
 * is not inside the card itself. Null when no slot is near: a drop there cancels.
 */
export function dropTarget(layout: BoardLayout, id: string, x: number, y: number): DropTarget | null {
  const card = layout.cards.find(one => one.id === id)
  if (!card || card.type === 'unmapped') return null
  const own = subtree(layout, id)
  let best: BoardSlot | undefined
  let bestReach = Infinity
  for (const slot of layout.slots) {
    if (slot.place.parentId !== undefined && own.has(slot.place.parentId)) continue
    const dx = Math.max(slot.x - x, 0, x - (slot.x + slot.w - 1))
    const dy = Math.max(slot.y - y, 0, y - (slot.y + slot.h - 1))
    const reach = dx + 4 * dy
    if (reach < bestReach || (reach === bestReach && best !== undefined && slot.depth > best.depth)) {
      best = slot
      bestReach = reach
    }
  }
  if (!best || bestReach > DROP_REACH) return null
  const { parentId, index } = best.place
  if (parentId === card.parentId && (index === card.index || index === card.index + 1)) return { slot: best, to: null }
  const at = parentId === card.parentId && card.index < index ? index - 1 : index
  return { slot: best, to: parentId === undefined ? { index: at } : { parentId, index: at } }
}

/**
 * The block an arrow key moves the selection to. Along the axis its siblings run
 * on: the sibling before or after; before the first, its container; after the
 * last, whatever follows its container on that axis. Across that axis: forward
 * goes into a container (its first block), backward out to the container.
 */
export function navigate(design: Design, id: string | null, direction: Direction, orientation: Orientation): string | null {
  const rows = flatten(design)
  const forward = direction === 'right' || direction === 'down'
  const here = rows.find(row => row.node.id === id)
  if (!here) return (forward ? design.nodes[0] : design.nodes.at(-1))?.id ?? null
  const keyAxis: Axis = direction === 'left' || direction === 'right' ? 'h' : 'v'
  const byId = new Map(rows.map(row => [row.node.id, row]))
  const parentOf = (row: (typeof rows)[number]) => (row.parentId === undefined ? undefined : byId.get(row.parentId))
  const axisOf = (row: (typeof rows)[number]): Axis => flowAxis(childFlow(parentOf(row)?.node.type), orientation)
  const siblingsOf = (row: (typeof rows)[number]): readonly DesignNode[] => parentOf(row)?.node.children ?? design.nodes

  const along = axisOf(here) === keyAxis
  if (along) {
    const sibling = siblingsOf(here)[here.index + (forward ? 1 : -1)]
    if (sibling) return sibling.id
  }
  if (!forward) return here.parentId ?? here.node.id
  if (!along && (here.node.children?.length ?? 0) > 0) return here.node.children?.[0]?.id ?? here.node.id
  // Forward with nothing ahead here: the nearest container that has a next block on this axis.
  for (let up = parentOf(here); up; up = parentOf(up)) {
    const next = axisOf(up) === keyAxis ? siblingsOf(up)[up.index + 1] : undefined
    if (next) return next.id
  }
  return here.node.id
}
