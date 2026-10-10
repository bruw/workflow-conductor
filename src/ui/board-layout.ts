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
/** With a run laid over it a card's status row needs more room. */
export const LEAF_MIN_RUN_W = 20
export const LEAF_MAX_W = 30
export const LEAF_H = 4
export const CONTAINER_MIN_W = 20
/** Columns between two chained cards: room for ` ─▶ `. */
export const GAP_H = 4
/** Rows between two chained cards: a line and an arrow head. */
export const GAP_V = 2
/** The `+` after the last card of a list. */
const END_W = 3
/** How much of a container's title its header asks room for. */
const HEADER_TITLE_W = 18
/** How far (columns, a row counting four) a dragged card may be from a slot and still drop into it. */
export const DROP_REACH = 16

export type BoardCard = Rect & {
  id: string
  type: NodeType | 'unmapped'
  /** `n2 pipeline ×4`, and for a container ` · title` after it. */
  header: string
  title: string
  /** The knobs worth a glance, or the prompt's first words; '' with none. */
  knobs: string
  /** `×4`, `×n` for a fan-out with no stated count, '' for none. */
  fan: string
  /** A column of shade right of the card: there are many of these. */
  shadow: boolean
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
  /** The axis the list runs along: a slot on `h` is a column between cards, on `v` a row. */
  axis: Axis
  /** Where its `+` is drawn; null for a slot that only takes a drop (before the first card, between stacked cards). */
  mark: { x: number; y: number } | null
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
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function clip(text: string, max: number): string {
  if (max <= 0) return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
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

/** The knobs worth a glance on the card. */
export function knobLine(node: DesignNode): string {
  const knobs = node.knobs ?? {}
  const parts: string[] = []
  if (knobs.model) parts.push(knobs.model)
  if (knobs.effort) parts.push(knobs.effort)
  if (knobs.isolation) parts.push(knobs.isolation)
  if (knobs.votes !== undefined) parts.push(`${knobs.votes} votes`)
  if (knobs.until) parts.push(`until ${clean(knobs.until)}`)
  if (knobs.fanout) parts.push(/^\s*[×x]/.test(knobs.fanout) ? clean(knobs.fanout) : `× ${clean(knobs.fanout)}`)
  return parts.join(' · ')
}

/** A card's second line: its knobs, or for a leaf with none, what its prompt is about (cut to the card, never widening it). */
function secondLine(node: DesignNode): { text: string; sized: boolean } {
  const knobs = knobLine(node)
  if (knobs === '' && !canHoldChildren(node.type) && node.knobs?.prompt) return { text: clean(node.knobs.prompt), sized: false }
  return { text: knobs, sized: true }
}

type Measured = {
  node: DesignNode
  w: number
  h: number
  /** Width with the shade column. */
  fw: number
  header: string
  title: string
  knobs: string
  fan: string
  flow: Flow | null
  kids: Measured[]
  inside: number
}

type Arranged = { w: number; h: number; at: { x: number; y: number }[]; end: { x: number; y: number } }

/** Where the cards of one list go, from the list's own corner, and where its end slot starts. */
function arrange(sizes: readonly { fw: number; h: number }[], flow: Flow, axis: Axis): Arranged {
  const at: { x: number; y: number }[] = []
  let x = 0
  let y = 0
  let w = 0
  let h = 0
  for (const [i, size] of sizes.entries()) {
    const last = i === sizes.length - 1
    at.push({ x, y })
    if (axis === 'h') {
      x += size.fw + (last ? 0 : flow === 'chain' ? GAP_H : 1)
      h = Math.max(h, size.h)
    } else {
      y += size.h + (last ? 0 : flow === 'chain' ? GAP_V : 0)
      w = Math.max(w, size.fw)
    }
  }
  if (axis === 'h') return { w: x + END_W, h: Math.max(h, 1), at, end: { x, y: 0 } }
  return { w: Math.max(w, END_W), h: y + 1, at, end: { x: 0, y } }
}

function measure(node: DesignNode, options: LayoutOptions): Measured {
  const fan = fanOf(node)
  const head = `${node.id} ${node.type}${fan ? ` ${fan}` : ''}`
  const title = clean(node.title)
  const second = secondLine(node)
  const knobs = second.text
  const shade = fan === '' ? 0 : 1
  if (!canHoldChildren(node.type)) {
    const w = Math.max(options.run ? LEAF_MIN_RUN_W : LEAF_MIN_W, Math.min(LEAF_MAX_W, Math.max(head.length, title.length, second.sized ? knobs.length : 0) + 4))
    return { node, w, h: LEAF_H, fw: w + shade, header: head, title, knobs, fan, flow: null, kids: [], inside: 0 }
  }
  const flow = childFlow(node.type)
  const kids = (node.children ?? []).map(child => measure(child, options))
  const list = arrange(kids, flow, flowAxis(flow, options.orientation))
  const header = title === '' || title === node.type ? head : `${head} · ${title}`
  const w = Math.max(CONTAINER_MIN_W, list.w + 4, Math.min(header.length, head.length + 3 + HEADER_TITLE_W) + 4)
  const inside = kids.reduce((sum, kid) => sum + 1 + kid.inside, 0)
  return { node, w, h: list.h + 2, fw: w + shade, header, title, knobs, fan, flow, kids, inside }
}

/** The board for a design: every card, edge and slot, in cells from the board's top left. */
export function layoutBoard(design: Design, options: LayoutOptions): BoardLayout {
  const cards: BoardCard[] = []
  const edges: BoardEdge[] = []
  const slots: BoardSlot[] = []

  const placeList = (kids: Measured[], flow: Flow, ox: number, oy: number, parent: DesignNode | undefined, depth: number): Arranged => {
    const axis = flowAxis(flow, options.orientation)
    const list = arrange(kids, flow, axis)
    const count = kids.length
    const place = (index: number): Place => (parent ? { parentId: parent.id, index } : { index })

    for (const [i, kid] of kids.entries()) {
      const spot = list.at[i] ?? { x: 0, y: 0 }
      const x = ox + spot.x
      const y = oy + spot.y
      cards.push({
        x,
        y,
        w: kid.w,
        h: kid.h,
        id: kid.node.id,
        type: kid.node.type,
        header: kid.header,
        title: kid.title,
        knobs: kid.knobs,
        fan: kid.fan,
        shadow: kid.fan !== '',
        depth,
        parentId: parent?.id,
        index: i,
        container: kid.flow !== null,
        inside: kid.inside,
        axis,
      })
      if (kid.flow !== null) placeList(kid.kids, kid.flow, x + 2, y + 1, kid.node, depth + 1)
    }

    for (let i = 0; i <= count; i++) {
      const spot = list.at[i]
      if (i === count || !spot) {
        const x = ox + list.end.x
        const y = oy + list.end.y
        if (axis === 'h') slots.push({ x, y: oy, w: END_W, h: list.h, place: place(count), depth, axis, mark: { x: x + 1, y: oy + (list.h >= 2 ? 1 : 0) } })
        else slots.push({ x: ox, y, w: list.w, h: 1, place: place(count), depth, axis, mark: { x: ox + 1, y } })
        continue
      }
      const x = ox + spot.x
      const y = oy + spot.y
      if (axis === 'h') {
        const gap = flow === 'chain' ? GAP_H : 1
        if (i === 0) slots.push({ x, y: oy, w: 1, h: list.h, place: place(0), depth, axis, mark: null })
        else slots.push({ x: x - gap, y: oy, w: gap, h: list.h, place: place(i), depth, axis, mark: flow === 'chain' ? { x: x - gap + 1, y: oy + 2 } : null })
      } else if (i === 0 || flow === 'stack') {
        slots.push({ x: ox, y, w: list.w, h: 1, place: place(i), depth, axis, mark: null })
      } else {
        slots.push({ x: ox, y: y - GAP_V, w: list.w, h: GAP_V, place: place(i), depth, axis, mark: { x: ox + 6, y: y - GAP_V } })
      }
      const before = kids[i - 1]
      const here = kids[i]
      if (flow === 'chain' && before && here) {
        const kind = edgeKind(parent?.type, before.node)
        edges.push(axis === 'h' ? { kind, from: before.node.id, to: here.node.id, axis, x: x - GAP_H + 1, y: oy + 1 } : { kind, from: before.node.id, to: here.node.id, axis, x: ox + 2, y: y - GAP_V })
      }
    }
    return list
  }

  const top = placeList(
    design.nodes.map(node => measure(node, options)),
    'chain',
    0,
    0,
    undefined,
    0,
  )
  let width = top.w
  let height = top.h
  const strays = options.unmapped ?? 0
  if (strays > 0) {
    const fan = `×${strays}`
    const title = 'no block claims these'
    const w = title.length + 4
    const horizontal = options.orientation === 'horizontal'
    const x = horizontal ? top.w + 1 : 0
    const y = horizontal ? 0 : top.h + 1
    cards.push({ x, y, w, h: LEAF_H, id: UNMAPPED_ID, type: 'unmapped', header: `unmapped ${fan}`, title, knobs: '', fan, shadow: true, depth: 0, parentId: undefined, index: design.nodes.length, container: false, inside: 0, axis: horizontal ? 'h' : 'v' })
    width = Math.max(width, x + w + 1)
    height = Math.max(height, y + LEAF_H)
  }
  return { orientation: options.orientation, width, height, cards, edges, slots }
}

/**
 * The orientation to draw in. A docked pane (narrow, tall) asks for `vertical` and
 * gets it. An inline pane asks for `horizontal`, and gets it unless the board is
 * then taller than the rows there are while the vertical one fits the columns.
 */
export function chooseOrientation(design: Design, wanted: Orientation, columns: number, rows: number, options: Omit<LayoutOptions, 'orientation'> = {}): Orientation {
  if (wanted === 'vertical') return 'vertical'
  if (rows <= 0 || layoutBoard(design, { ...options, orientation: 'horizontal' }).height <= rows) return 'horizontal'
  return columns > 0 && layoutBoard(design, { ...options, orientation: 'vertical' }).width <= columns ? 'vertical' : 'horizontal'
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

/** The slot whose `+` (and the cell on either side of it) is under a cell. */
export function slotAt(layout: BoardLayout, x: number, y: number): BoardSlot | undefined {
  return layout.slots.find(slot => slot.mark !== null && slot.mark.y === y && Math.abs(slot.mark.x - x) <= 1)
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
