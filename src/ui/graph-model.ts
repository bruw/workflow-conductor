// The graph's model: what the hooks module hands the Client, the messages it posts back, and the reducer for what the Client keeps.
// Selection, the view, the carousels' offsets, the add list and the delete question live in the hooks module's state. No `$`, no engine imports.

import { isRecord } from '../project/model'
import type { Project } from '../project/model'
import type { Place } from '../project/ops'
import { cardOf, dropTarget, graphAt, graphRows, layoutGraph, panTo, samePlace, slideBy } from './graph-layout'
import type { GraphCard, GraphDrop, GraphHit, GraphLayout } from './graph-layout'
import type { RunOverlay } from './graph-paint'
import { ENTER, KEY_OPS } from './keys'
import { FRAME_MS, motionActive, rowOffset, rowOffsets, settleMotion, stepMotion, stillMotion } from './tween'
import type { Motion } from './tween'

/** Client → hooks module (surface.post → ui.message). One per input: two posts in a frame can drop one. */
export type GraphMessage =
  | { kind: 'select'; id: string | null }
  /** `to` is the place once the card is lifted out, as `moveNode` takes it. */
  | { kind: 'move'; id: string; to: Place }
  | { kind: 'addAt'; at: Place }
  | { kind: 'knob'; id: string; slot: number }
  | { kind: 'view'; id: string | null }
  | { kind: 'slide'; id: string; first: number }
  /** A press let go that asked for nothing else: the click still gave the graph the keyboard, and the hooks module must hear of it. */
  | { kind: 'touch' }
  | { kind: 'key'; key: string }

/** `run` while a run of this project is in progress: editing is locked. */
export type GraphMode = 'project' | 'run'

/** The wheel's rows as the hooks module counts them. A count begun anew (the module loaded again) has another `from`. */
export type GraphWheel = { from: string; rows: number }

export type GraphProps = {
  project: Project
  mode: GraphMode
  selectedId: string | null
  viewRootId: string | null
  problems: Record<string, number>
  openAt: Place | null
  /** By container id: the first arm its carousel is asked to show. */
  scroll: Record<string, number>
  /** The columns the graph is laid out in (centred in a wider region) and the rows of its region. */
  columns: number
  rows: number
  /** Agents of the run no block claims. */
  unmapped: number
  /** The pan moves by what was added since the last drawing. */
  wheel: GraphWheel
  /** What an empty graph says in place of its `[+]`: Claude is drafting it. */
  emptyNote?: string
  run?: RunOverlay
  /** Blocks an edit from chat just touched: marked for FLASH_MS. A new `seq` is a new edit. */
  flash?: { ids: string[]; seq: number }
  /** A request waits in the prompt box and the keys could not be handed to it: the graph answers no key until the person takes them there. */
  hold?: boolean
  /** The pane does not hold the keyboard: an empty graph names no key, and no `[+]` is lit as the one `n` adds at. */
  quiet?: boolean
}

/** The hooks module walks the same layout the Client draws. */
export function graphLayout(props: Pick<GraphProps, 'project' | 'mode' | 'selectedId' | 'viewRootId' | 'problems' | 'openAt' | 'scroll' | 'columns' | 'rows' | 'unmapped'>): GraphLayout {
  return layoutGraph(props.project, {
    columns: props.columns,
    rows: props.rows,
    selectedId: props.selectedId,
    viewRootId: props.viewRootId,
    scroll: props.scroll,
    problems: props.problems,
    openAt: props.openAt,
    unmapped: props.unmapped,
    locked: props.mode === 'run',
  })
}

function readPlace(value: unknown): Place | undefined {
  if (!isRecord(value)) return undefined
  const { parentId, index } = value
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return undefined
  if (parentId !== undefined && typeof parentId !== 'string') return undefined
  return parentId === undefined ? { index } : { parentId, index }
}

/** Never throws. */
export function parseGraphMessage(data: unknown): GraphMessage | undefined {
  if (!isRecord(data)) return undefined
  const { kind, id } = data
  if (kind === 'touch') return { kind }
  if (kind === 'select' || kind === 'view') return id === null || typeof id === 'string' ? { kind, id } : undefined
  if (kind === 'addAt') {
    const at = readPlace(data.at)
    return at ? { kind, at } : undefined
  }
  if (kind === 'key') return typeof data.key === 'string' && Object.hasOwn(KEY_OPS, data.key) ? { kind, key: data.key } : undefined
  if (typeof id !== 'string') return undefined
  if (kind === 'knob') return typeof data.slot === 'number' && [1, 2].includes(data.slot) ? { kind, id, slot: data.slot } : undefined
  if (kind === 'slide') return typeof data.first === 'number' && Number.isInteger(data.first) && data.first >= 0 ? { kind, id, first: data.first } : undefined
  if (kind === 'move') {
    const to = readPlace(data.to)
    return to ? { kind, id, to } : undefined
  }
  return undefined
}

export type GraphDrag =
  /** The selected card under a held button: in hand once the pointer leaves the cell it went down on. Let go where it went down, a container (`open`) is opened as the view. */
  | { kind: 'card'; id: string; downX: number; downY: number; x: number; y: number; active: boolean; open: boolean }
  /** Anything else under a held button: the graph pans with the pointer. `post` is what a release on the cell it went down on asks for. */
  | { kind: 'pan'; downX: number; downY: number; panY: number; post?: GraphMessage; moved?: boolean }
  /** A `[+]`, a chip, a crumb or a gutter under a held button: released on the same one, it acts; anywhere else, nothing. */
  | { kind: 'press'; on: string; post: GraphMessage }

export type GraphState = {
  /** The row of the graph that is the window's first, under the breadcrumb. */
  panY: number
  /** The selection the pan last made room for: the card's id and where it stood. */
  seen: string | null
  /** The view the pan belongs to: another one starts from its top. */
  view: string | null
  drag: GraphDrag | null
  hover: Place | null
  /** Where the cards were last drawn and how tall, and the ones still sliding or growing. */
  motionX: Motion
  motionY: Motion
  motionH: Motion
  /** What the cards' places were recorded for: the view, the blocks in their order, the carousels. Cards slide only when the last two change. */
  shape: string
  /** The motion clock, in ms: moved on by the ticker, 0 while idle. */
  clock: number
  ticking: boolean
  wheel?: GraphWheel
  /** The mark on blocks an edit from chat touched: which edit, which blocks, and the ms it still shows. */
  flashSeq?: number
  flashIds?: string[]
  flashLeft?: number
}

export type GraphKey = { type: 'key'; key: string; ctrl?: true; shift?: true; meta?: true }

/** `x` is a column of the graph's content, `y` a row of its region, 0 at the top left. */
export type GraphPointer = { type: 'pointer'; event: 'down' | 'move' | 'up' | 'enter' | 'leave'; x: number; y: number }

export type GraphInput = GraphKey | GraphPointer

export type GraphContext = {
  layout: GraphLayout
  /** The window: the content's columns, the region's rows (the breadcrumb's among them). */
  columns: number
  rows: number
  selectedId: string | null
  /** A run is in progress: a press selects, opens and pans, nothing is edited. */
  locked?: boolean
  hold?: boolean
  wheel?: GraphWheel
}

export type GraphResult = { state: GraphState; post?: GraphMessage }

export function initialGraph(): GraphState {
  return { panY: 0, seen: null, view: null, drag: null, hover: null, motionX: stillMotion(), motionY: stillMotion(), motionH: stillMotion(), shape: '', clock: 0, ticking: false }
}

function panMost(context: GraphContext): number {
  return Math.max(0, context.layout.height - graphRows(context.layout, context.rows))
}

function clampPan(state: GraphState, context: GraphContext): GraphState {
  const panY = Math.max(0, Math.min(panMost(context), Math.trunc(state.panY) || 0))
  return panY === state.panY ? state : { ...state, panY }
}

/** Brings local state in line with what is drawn now. Returns `state` itself when nothing changes. */
export function syncGraph(state: GraphState, context: GraphContext): GraphState {
  const { layout } = context
  let next = state
  if (next.hover !== null && (context.locked || !layout.slots.some(slot => slot.mark !== null && samePlace(slot.place, next.hover)))) next = { ...next, hover: null }
  if (next.drag?.kind === 'card') {
    const { id } = next.drag
    if (context.locked || !cardOf(layout, id)) next = { ...next, drag: null }
  }
  // A selected card that moved or grew is followed as a new selection is; so is a window that changed size.
  const card = cardOf(layout, context.selectedId)
  const seen = card ? `${card.id}@${card.x},${card.y},${card.w},${card.h}/${context.columns}x${context.rows}` : context.selectedId
  const fresh = next.view !== layout.viewRootId
  if (fresh || seen !== next.seen) next = { ...next, view: layout.viewRootId, seen, panY: panTo(layout, context.rows, fresh ? 0 : next.panY, card?.id ?? null) }
  const { wheel } = context
  const had = next.wheel
  if (wheel !== undefined && (had === undefined || had.from !== wheel.from || had.rows !== wheel.rows)) {
    // The first sum seen (a Client just mounted, a count begun anew) is where the count starts, not rows to move by.
    next = { ...next, wheel, panY: next.panY + (had !== undefined && had.from === wheel.from ? wheel.rows - had.rows : 0) }
  }
  return clampPan(next, context)
}

/** Key events named as the key catcher names them. Few arrive: the pane takes the keyboard back at once after a click. */
const NAMED_KEYS: Record<string, string> = { return: ENTER, enter: ENTER, up: 'w', left: 'a', down: 's', right: 'd' }

export function graphKey(input: Pick<GraphKey, 'key' | 'shift'>): string | undefined {
  const key = (Object.hasOwn(NAMED_KEYS, input.key) ? NAMED_KEYS[input.key] : undefined) ?? (input.key.length === 1 && input.shift ? input.key.toUpperCase() : input.key)
  return Object.hasOwn(KEY_OPS, key) ? key : undefined
}

function inWindow(context: GraphContext, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < context.columns && y < context.rows
}

/** The card in hand, once it has left the cell it was pressed on. */
export function dragging(state: Pick<GraphState, 'drag'>): string | null {
  return state.drag?.kind === 'card' && state.drag.active ? state.drag.id : null
}

/** Where the card in hand would land right now; null with none in hand, off the graph, or far from any slot. */
export function dragTarget(state: Pick<GraphState, 'drag' | 'panY'>, context: GraphContext): GraphDrop | null {
  const { drag } = state
  if (drag?.kind !== 'card' || !drag.active || !inWindow(context, drag.x, drag.y) || drag.y < context.layout.top) return null
  return dropTarget(context.layout, drag.id, drag.x, drag.y - context.layout.top + state.panY)
}

/** The same word for the same thing: a release must find it again. */
function pressOn(hit: GraphHit | null): string {
  if (hit === null || hit.kind === 'card') return ''
  if (hit.kind === 'crumb') return `crumb:${hit.crumb.id ?? ''}`
  if (hit.kind === 'chip') return `chip:${hit.chip.id}:${hit.chip.knob}`
  if (hit.kind === 'gutter') return `gutter:${hit.gutter.id}:${hit.gutter.side}`
  return `slot:${hit.slot.place.parentId ?? ''}:${hit.slot.place.index}`
}

/** Null where a run's lock leaves the press nothing to do. */
function pressPost(hit: GraphHit, context: GraphContext): GraphMessage | null {
  if (hit.kind === 'crumb') return hit.crumb.id === undefined ? null : { kind: 'view', id: hit.crumb.id }
  if (hit.kind === 'gutter') return { kind: 'slide', id: hit.gutter.id, first: slideBy(context.layout, hit.gutter)[hit.gutter.id] ?? 0 }
  if (context.locked) return null
  if (hit.kind === 'chip') return { kind: 'knob', id: hit.chip.id, slot: Number(hit.chip.key) }
  if (hit.kind === 'slot') return { kind: 'addAt', at: hit.slot.place }
  return null
}

function opens(card: GraphCard, context: GraphContext): boolean {
  return card.kind !== 'leaf' && card.id !== context.layout.viewRootId
}

function reducePointer(state: GraphState, input: GraphPointer, context: GraphContext): GraphResult {
  const { layout } = context
  const { x, y } = input
  const hitAt = (): GraphHit | null => (inWindow(context, x, y) ? graphAt(layout, x, y, state.panY) : null)

  if (input.event === 'down') {
    const base: GraphState = state.drag === null && state.hover === null ? state : { ...state, drag: null, hover: null }
    const hit = hitAt()
    const pan: GraphDrag = { kind: 'pan', downX: x, downY: y, panY: base.panY }
    if (hit === null) return { state: { ...base, drag: pan } }
    if (hit.kind !== 'card') {
      const post = pressPost(hit, context)
      return { state: { ...base, drag: post ? { kind: 'press', on: pressOn(hit), post } : pan } }
    }
    const { card } = hit
    if (card.id !== context.selectedId) return { state: { ...base, drag: { ...pan, post: { kind: 'select', id: card.id } } } }
    // Only the selected card is picked up by a drag: not the view's frame, not while a run locks the project.
    if (!context.locked && card.type !== 'unmapped' && card.id !== layout.viewRootId) return { state: { ...base, drag: { kind: 'card', id: card.id, downX: x, downY: y, x, y, active: false, open: opens(card, context) } } }
    return { state: { ...base, drag: opens(card, context) ? { ...pan, post: { kind: 'view', id: card.id } } : pan } }
  }

  const { drag } = state
  if (!drag) {
    const hit = input.event === 'move' && !context.locked ? hitAt() : null
    const hover = hit?.kind === 'slot' ? hit.slot.place : null
    return hover === state.hover || samePlace(hover, state.hover) ? { state } : { state: { ...state, hover } }
  }
  // Crossing the region's edge changes nothing: the instance holds the pointer until `up`.
  if (input.event === 'enter' || input.event === 'leave') return { state }
  if (drag.kind === 'press') {
    if (input.event !== 'up') return { state }
    return { state: { ...state, drag: null }, post: pressOn(hitAt()) === drag.on ? drag.post : { kind: 'touch' } }
  }
  if (drag.kind === 'pan') {
    const still = !drag.moved && x === drag.downX && y === drag.downY
    if (input.event === 'up') return { state: { ...state, drag: null }, post: drag.post !== undefined && still ? drag.post : { kind: 'touch' } }
    if (still) return { state }
    const moved = clampPan({ ...state, drag: drag.moved ? drag : { ...drag, moved: true }, panY: drag.panY - (y - drag.downY) }, context)
    return moved.panY === state.panY && moved.drag === state.drag ? { state } : { state: moved }
  }
  const held: GraphDrag = { ...drag, x, y, active: drag.active || x !== drag.downX || y !== drag.downY }
  if (input.event === 'move') return held.x === drag.x && held.y === drag.y ? { state } : { state: { ...state, drag: held } }

  // up: a drag commits with one move, or cancels; a second click on a container opens it.
  const dropped: GraphState = { ...state, drag: null }
  if (!held.active) return { state: dropped, post: held.open ? { kind: 'view', id: held.id } : { kind: 'touch' } }
  const target = dragTarget({ ...state, drag: held }, context)
  return target?.to ? { state: dropped, post: { kind: 'move', id: drag.id, to: target.to } } : { state: dropped, post: { kind: 'touch' } }
}

function reduceKey(state: GraphState, input: GraphKey, context: GraphContext): GraphResult {
  // A key lets go of whatever the pointer holds.
  const base: GraphState = state.drag === null ? state : { ...state, drag: null }
  // A request waits in the prompt box: whatever is typed is meant for it, never for the graph.
  if (input.ctrl || input.meta || context.hold) return { state: base }
  const key = graphKey(input)
  return key !== undefined ? { state: base, post: { kind: 'key', key } } : { state: base }
}

export function graphReduce(state: GraphState, input: GraphInput, context: GraphContext): GraphResult {
  return input.type === 'pointer' ? reducePointer(state, input, context) : reduceKey(state, input, context)
}

/** A drag held at the window's edge pans one row per this long. */
export const DRAG_SCROLL_MS = 96

/** 0 where there is no more graph that way. */
export function dragScroll(state: Pick<GraphState, 'drag' | 'panY'>, context: GraphContext): -1 | 0 | 1 {
  const { drag } = state
  if (drag?.kind !== 'card' || !drag.active) return 0
  return drag.y <= context.layout.top && state.panY > 0 ? -1 : drag.y >= context.rows - 1 && state.panY < panMost(context) ? 1 : 0
}

function positions(layout: GraphLayout, axis: 'x' | 'y' | 'h'): Record<string, number> {
  const out: Record<string, number> = {}
  for (const card of layout.cards) out[card.id] = card[axis]
  return out
}

/** The view, then what makes cards slide when it changes: the blocks in their order and the carousels' windows. */
function shapeOf(layout: GraphLayout): string {
  return `${layout.viewRootId ?? ''}\n${layout.blocks.map(block => `${block.parentId ?? ''}/${block.id}`).join(' ')}|${JSON.stringify(layout.scroll)}`
}

/** The places as they are, with nothing on its way; `motion` itself when they are the ones it holds. */
function atRest(motion: Motion, places: Record<string, number>): Motion {
  return stepMotion(motion, places, 0) === motion ? motion : { ys: places, tweens: {} }
}

/** The arm a carousel slid into its window sets off as far from its place as the arms beside it are from theirs, so it slides in with them. Returns `motion` itself with no such card. */
function withIncoming(motion: Motion, layout: GraphLayout, clock: number): Motion {
  const ys = { ...motion.ys }
  const away: Record<string, number> = {}
  for (const card of layout.cards) {
    if (motion.ys[card.id] !== undefined || card.parentId === undefined) continue
    let from = away[card.parentId]
    if (from === undefined && layout.carousels[card.parentId]) {
      const beside = layout.cards.find(one => one.parentId === card.parentId && motion.ys[one.id] !== undefined)
      if (beside) from = (motion.ys[beside.id] ?? beside.x) + rowOffset(motion.tweens[beside.id], clock) - beside.x
    }
    if (from === undefined || from === 0) continue
    away[card.id] = from
    ys[card.id] = card.x + from
  }
  return Object.keys(away).length > 0 ? { ys, tweens: motion.tweens } : motion
}

/** Cards slide when the project changed under them or a carousel slid; a moved selection and another view are drawn in place, so the keys never wait on a tween. Returns `state` itself when no place changed. */
export function moveGraph(state: GraphState, layout: GraphLayout): GraphState {
  const shape = shapeOf(layout)
  const slides = shape !== state.shape && state.shape.split('\n')[0] === (layout.viewRootId ?? '') && state.shape !== ''
  const take = (motion: Motion, axis: 'x' | 'y' | 'h'): Motion => (slides ? stepMotion(motion, positions(layout, axis), state.clock) : atRest(motion, positions(layout, axis)))
  const motionX = take(slides ? withIncoming(state.motionX, layout, state.clock) : state.motionX, 'x')
  const motionY = take(state.motionY, 'y')
  const motionH = take(state.motionH, 'h')
  return motionX === state.motionX && motionY === state.motionY && motionH === state.motionH && shape === state.shape ? state : { ...state, motionX, motionY, motionH, shape }
}

export function graphMoving(state: Pick<GraphState, 'motionX' | 'motionY' | 'motionH' | 'clock'>): boolean {
  return motionActive(state.motionX, state.clock) || motionActive(state.motionY, state.clock) || motionActive(state.motionH, state.clock)
}

/** How long the mark on freshly edited blocks shows, and how long its first, louder part lasts. */
export const FLASH_MS = 800
export const FLASH_STRONG_MS = 400

/** A `seq` not seen before starts the mark. Returns `state` itself otherwise. */
export function flashGraph(state: GraphState, flash: GraphProps['flash']): GraphState {
  if (!flash) return (state.flashSeq ?? 0) === 0 ? state : { ...state, flashSeq: 0 }
  if (flash.seq === state.flashSeq) return state
  return { ...state, flashSeq: flash.seq, flashIds: flash.ids, flashLeft: flash.ids.length > 0 ? FLASH_MS : 0 }
}

export function graphFlash(state: Pick<GraphState, 'flashIds' | 'flashLeft'>): { ids: string[]; strong: boolean } | null {
  const left = state.flashLeft ?? 0
  return left > 0 && state.flashIds && state.flashIds.length > 0 ? { ids: state.flashIds, strong: left > FLASH_MS - FLASH_STRONG_MS } : null
}

export function graphTicking(state: GraphState, context: GraphContext): boolean {
  return graphMoving(state) || (state.flashLeft ?? 0) > 0 || dragScroll(state, context) !== 0
}

/** When every card has arrived and nothing pans, `ticking` goes false and the clock rests. */
export function tickGraph(state: GraphState, context: GraphContext): GraphState {
  const clock = state.clock + FRAME_MS
  const way = dragScroll(state, context)
  const panned = way !== 0 && clock % DRAG_SCROLL_MS === 0 ? clampPan({ ...state, panY: state.panY + way }, context) : state
  const motionX = settleMotion(state.motionX, clock)
  const motionY = settleMotion(state.motionY, clock)
  const motionH = settleMotion(state.motionH, clock)
  const flashLeft = Math.max(0, (state.flashLeft ?? 0) - FRAME_MS)
  if (way !== 0 || flashLeft > 0 || motionActive(motionX, clock) || motionActive(motionY, clock) || motionActive(motionH, clock)) return { ...panned, clock, motionX, motionY, motionH, flashLeft }
  return { ...panned, flashLeft: 0, flashIds: [], clock: 0, motionX: { ys: motionX.ys, tweens: {} }, motionY: { ys: motionY.ys, tweens: {} }, motionH: { ys: motionH.ys, tweens: {} }, ticking: false }
}

export function graphOffsets(state: Pick<GraphState, 'motionX' | 'motionY' | 'motionH' | 'clock'>): Record<string, { dx: number; dy: number; dh: number }> {
  const xs = rowOffsets(state.motionX, state.clock)
  const ys = rowOffsets(state.motionY, state.clock)
  const hs = rowOffsets(state.motionH, state.clock)
  const out: Record<string, { dx: number; dy: number; dh: number }> = {}
  for (const id of new Set([...Object.keys(xs), ...Object.keys(ys), ...Object.keys(hs)])) out[id] = { dx: xs[id] ?? 0, dy: ys[id] ?? 0, dh: hs[id] ?? 0 }
  return out
}

export function dragHint(state: Pick<GraphState, 'drag' | 'panY'>, context: GraphContext): string {
  if (dragging(state) === null) return ''
  const target = dragTarget(state, context)
  if (!target) return 'no slot here: release cancels'
  if (!target.to) return 'already here'
  return target.to.parentId === undefined ? 'drop here' : `drop into ${target.to.parentId}`
}

/** Each with its mark first: a table in the help pages, not on the graph. */
export const LEGEND: readonly (readonly [string, string])[] = [
  ['↓', 'hands each result on as it arrives'],
  ['all ⇓', 'waits for all results first'],
  ['IF  ELSE', 'on a border: the condition of that arm of a branch'],
  ['OR  ∥', 'between arms: one of them runs / they run at the same time'],
  ['◀ N ▶', 'more arms than fit, N out of sight on that side'],
  ['▸', 'a container drawn closed (too deep or too narrow to show what it holds): o opens it as the view, b goes back up'],
  ['!', 'the block has a problem (a closed container: a block inside it has); the detail pane says what'],
  ['2/4 done', 'in a run: agents ended well of agents started, then the ones that failed'],
]

export const MOUSE_HELP: readonly string[] = [
  'Click a card to select it. Click the selected container again to open it as the view; click a crumb to go back to that view.',
  'Click a [+] for a new block there (the lit one is where n adds it). Click a chip to step it, ◀ or ▶ to slide the arms.',
  'Drag the selected card to move it. Drag anything else, or turn the wheel, to scroll.',
  'In the detail pane, click a field to edit it: the goal and the args are on the start block.',
]
