// The graph's model: what the hooks module hands the Client, the messages the
// Client posts back, and the reducer for the little the Client keeps to itself
// (the pan, a drag in flight, the slot under the pointer, cards sliding, the
// mark on blocks just edited). Selection, the view, the carousels' offsets, the
// add list and the delete question live in the hooks module's state: the graph
// draws them from props. Pure TypeScript: no `$`, no engine imports.

import type { Design } from '../design/model'
import type { Place } from '../design/ops'
import { cardOf, dropTarget, graphAt, graphRows, layoutGraph, panTo, samePlace, slideBy } from './graph-layout'
import type { GraphCard, GraphDrop, GraphHit, GraphLayout } from './graph-layout'
import type { RunOverlay } from './graph-paint'
import { ENTER, KEY_OPS } from './keys'
import { FRAME_MS, motionActive, rowOffset, rowOffsets, settleMotion, stepMotion, stillMotion } from './tween'
import type { Motion } from './tween'

// ---------------------------------------------------------------------------
// Props and messages

/** Client → hooks module (surface.post → ui.message). One per input: two posts in a frame can drop one. */
export type GraphMessage =
  | { kind: 'select'; id: string | null }
  /** A drop: `to` is the place once the card is lifted out, as `moveNode` takes it. */
  | { kind: 'move'; id: string; to: Place }
  /** A click on a `[+]`: open the add list for that place. */
  | { kind: 'addAt'; at: Place }
  /** A click on a chip of the selected card: its knob steps, as its digit does. */
  | { kind: 'knob'; id: string; slot: number }
  /** A click on a crumb (`id` null: the whole design), or a second click on the selected container: that view. */
  | { kind: 'view'; id: string | null }
  /** A click on a carousel's gutter: container `id` shows its arms from `first`. */
  | { kind: 'slide'; id: string; first: number }
  /** A press let go that asked for nothing else: the click still gave the graph the keyboard, and the hooks module must hear of it. */
  | { kind: 'touch' }
  /** A key pressed while the graph has the keyboard, as the key catcher would have got it: the character, or `enter`. */
  | { kind: 'key'; key: string }

/** `run` while a run of this design is in progress: editing is locked. */
export type GraphMode = 'design' | 'run'

/** The wheel's rows as the hooks module counts them. A count begun anew (the module loaded again) has another `from`. */
export type GraphWheel = { from: string; rows: number }

/** What the hooks module hands the Client. */
export type GraphProps = {
  design: Design
  mode: GraphMode
  selectedId: string | null
  /** The container shown as the view; null for the whole design. */
  viewRootId: string | null
  /** Each block's own problems, by id. */
  problems: Record<string, number>
  /** The place the add list is open for. */
  openAt: Place | null
  /** By container id: the first arm its carousel is asked to show. */
  scroll: Record<string, number>
  /** The columns the graph is laid out in (centred in a wider region) and the rows of its region. */
  columns: number
  rows: number
  /** Agents of the run no block claims. */
  unmapped: number
  /** Every row the wheel has asked for over the graph, summed since `from` (a name for where the count began): the pan moves by what was added since the last drawing. */
  wheel: GraphWheel
  /** What an empty graph says in place of its `[+]`: Claude is drafting it. */
  emptyNote?: string
  /** The run of this design, drawn over its cards. */
  run?: RunOverlay
  /** Blocks an edit from chat just touched: marked for FLASH_MS. A new `seq` is a new edit. */
  flash?: { ids: string[]; seq: number }
  /** A request waits in the prompt box and the keys could not be handed to it: the graph answers no key until the person takes them there. */
  hold?: boolean
  /** The pane does not hold the keyboard: an empty graph names no key, and no `[+]` is lit as the one `n` adds at. */
  quiet?: boolean
}

/** The layout the props describe: the hooks module walks the same one the Client draws. */
export function graphLayout(props: Pick<GraphProps, 'design' | 'mode' | 'selectedId' | 'viewRootId' | 'problems' | 'openAt' | 'scroll' | 'columns' | 'rows' | 'unmapped'>): GraphLayout {
  return layoutGraph(props.design, {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPlace(value: unknown): Place | undefined {
  if (!isRecord(value)) return undefined
  const { parentId, index } = value
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return undefined
  if (parentId !== undefined && typeof parentId !== 'string') return undefined
  return parentId === undefined ? { index } : { parentId, index }
}

/** A posted value as a message, or undefined when it is not one. Never throws. */
export function parseGraphMessage(data: unknown): GraphMessage | undefined {
  if (!isRecord(data)) return undefined
  const { kind, id } = data
  if (kind === 'touch') return { kind }
  if (kind === 'select' || kind === 'view') return id === null || typeof id === 'string' ? { kind, id } : undefined
  if (kind === 'addAt') {
    const at = readPlace(data.at)
    return at ? { kind, at } : undefined
  }
  if (kind === 'key') return typeof data.key === 'string' && data.key in KEY_OPS ? { kind, key: data.key } : undefined
  if (typeof id !== 'string') return undefined
  if (kind === 'knob') return typeof data.slot === 'number' && [1, 2, 3].includes(data.slot) ? { kind, id, slot: data.slot } : undefined
  if (kind === 'slide') return typeof data.first === 'number' && Number.isInteger(data.first) && data.first >= 0 ? { kind, id, first: data.first } : undefined
  if (kind === 'move') {
    const to = readPlace(data.to)
    return to ? { kind, id, to } : undefined
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Local state and its reducer

export type GraphDrag =
  /**
   * The selected card under a held button: nothing until the pointer leaves the cell it went down on, then the card is
   * in hand. Let go where it went down, a container (`open`) is opened as the view.
   */
  | { kind: 'card'; id: string; downX: number; downY: number; x: number; y: number; active: boolean; open: boolean }
  /**
   * Anything else under a held button (the background, a card that is not selected): the graph pans up and down with
   * the pointer. `post` is what a release on the cell it went down on asks for: the card pressed is selected.
   */
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
  /** The slot under a pointer no button holds: its `[+]` is lit. */
  hover: Place | null
  /** Where the cards were last drawn and how tall, and the ones still sliding or growing. */
  motionX: Motion
  motionY: Motion
  motionH: Motion
  /** What the cards' places were recorded for: the view, the blocks in their order, the carousels. Cards slide only when the last two change. */
  shape: string
  /** The motion clock, in ms: moved on by the ticker, 0 while idle. */
  clock: number
  /** Whether the shared ticker runs. */
  ticking: boolean
  /** The wheel's sum as last taken from the props. */
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
  /** A request waits in the prompt box: no key is answered. */
  hold?: boolean
  /** The wheel's sum, from the props. */
  wheel?: GraphWheel
}

export type GraphResult = { state: GraphState; post?: GraphMessage }

export function initialGraph(): GraphState {
  return { panY: 0, seen: null, view: null, drag: null, hover: null, motionX: stillMotion(), motionY: stillMotion(), motionH: stillMotion(), shape: '', clock: 0, ticking: false }
}

/** The last row the window may start at. */
function panMost(context: GraphContext): number {
  return Math.max(0, context.layout.height - graphRows(context.layout, context.rows))
}

function clampPan(state: GraphState, context: GraphContext): GraphState {
  const panY = Math.max(0, Math.min(panMost(context), Math.trunc(state.panY) || 0))
  return panY === state.panY ? state : { ...state, panY }
}

/**
 * Brings local state in line with what is drawn now: another view starts from its top, a new
 * selection is scrolled into view, the wheel's rows are taken, the pan stays inside the graph, and
 * a drag whose card is gone (or that a starting run locked out) is let go. Returns `state` itself
 * when nothing changes.
 */
export function syncGraph(state: GraphState, context: GraphContext): GraphState {
  const { layout } = context
  let next = state
  if (next.hover !== null && (context.locked || !layout.slots.some(slot => slot.mark !== null && samePlace(slot.place, next.hover)))) next = { ...next, hover: null }
  if (next.drag?.kind === 'card') {
    const { id } = next.drag
    if (context.locked || !cardOf(layout, id)) next = { ...next, drag: null }
  }
  // A selected card that moved or grew (a drop, a block added before it, its notes opening) is followed as a new selection is.
  // The window's size is part of it: a region that grew or shrank shows its selected card whole again.
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

/**
 * The keys the graph is given once a click gave it the keyboard, named as the key catcher gets them
 * (the pane takes the keyboard back at once, so these are the few typed in between): a letter with
 * Shift is its capital, Enter is `enter`, the arrows are `w a s d`.
 */
const NAMED_KEYS: Record<string, string> = { return: ENTER, enter: ENTER, up: 'w', left: 'a', down: 's', right: 'd' }

/** The key of the table a key event of the graph stands for; undefined when it is none. */
export function graphKey(input: Pick<GraphKey, 'key' | 'shift'>): string | undefined {
  const key = NAMED_KEYS[input.key] ?? (input.key.length === 1 && input.shift ? input.key.toUpperCase() : input.key)
  return key in KEY_OPS ? key : undefined
}

function inWindow(context: GraphContext, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < context.columns && y < context.rows
}

/** Whether a card is in the pointer's hand and has left the cell it was pressed on. */
export function dragging(state: Pick<GraphState, 'drag'>): string | null {
  return state.drag?.kind === 'card' && state.drag.active ? state.drag.id : null
}

/** Where the card in hand would land right now; null with none in hand, off the graph, or far from any slot. */
export function dragTarget(state: Pick<GraphState, 'drag' | 'panY'>, context: GraphContext): GraphDrop | null {
  const { drag } = state
  if (drag?.kind !== 'card' || !drag.active || !inWindow(context, drag.x, drag.y) || drag.y < context.layout.top) return null
  return dropTarget(context.layout, drag.id, drag.x, drag.y - context.layout.top + state.panY)
}

/** What is pressed, in a word that is the same for the same thing: a release must find it again. */
function pressOn(hit: GraphHit | null): string {
  if (hit === null || hit.kind === 'card') return ''
  if (hit.kind === 'crumb') return `crumb:${hit.crumb.id ?? ''}`
  if (hit.kind === 'chip') return `chip:${hit.chip.id}:${hit.chip.knob}`
  if (hit.kind === 'gutter') return `gutter:${hit.gutter.id}:${hit.gutter.side}`
  return `slot:${hit.slot.place.parentId ?? ''}:${hit.slot.place.index}`
}

/** What a press on anything but a card asks for once it is let go; null where a run's lock leaves it nothing to do. */
function pressPost(hit: GraphHit, context: GraphContext): GraphMessage | null {
  if (hit.kind === 'crumb') return hit.crumb.id === undefined ? null : { kind: 'view', id: hit.crumb.id }
  if (hit.kind === 'gutter') return { kind: 'slide', id: hit.gutter.id, first: slideBy(context.layout, hit.gutter)[hit.gutter.id] ?? 0 }
  if (context.locked) return null
  if (hit.kind === 'chip') return { kind: 'knob', id: hit.chip.id, slot: Number(hit.chip.key) }
  if (hit.kind === 'slot') return { kind: 'addAt', at: hit.slot.place }
  return null
}

/** Whether a second click on this card, already selected, opens it as the view: a container that is not the view's frame. */
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
      // Pressed, not yet used: it takes the release on the same thing.
      const post = pressPost(hit, context)
      return { state: { ...base, drag: post ? { kind: 'press', on: pressOn(hit), post } : pan } }
    }
    const { card } = hit
    if (card.id !== context.selectedId) return { state: { ...base, drag: { ...pan, post: { kind: 'select', id: card.id } } } }
    // Only the selected card is picked up by a drag: not the view's frame, not while a run locks the design.
    if (!context.locked && card.type !== 'unmapped' && card.id !== layout.viewRootId) return { state: { ...base, drag: { kind: 'card', id: card.id, downX: x, downY: y, x, y, active: false, open: opens(card, context) } } }
    return { state: { ...base, drag: opens(card, context) ? { ...pan, post: { kind: 'view', id: card.id } } : pan } }
  }

  const { drag } = state
  if (!drag) {
    // No button held: the slot under the pointer lights its `[+]`.
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

/** One input against the graph's local state: the next state, and the message to post when the hooks module has to act on it. */
export function graphReduce(state: GraphState, input: GraphInput, context: GraphContext): GraphResult {
  return input.type === 'pointer' ? reducePointer(state, input, context) : reduceKey(state, input, context)
}

// ---------------------------------------------------------------------------
// Motion: cards slide to their new place; a card held at the window's edge pans the graph

/** A drag held at the window's edge pans one row per this long. */
export const DRAG_SCROLL_MS = 96

/** Which way a card held at the window's edge pans the graph; 0 where there is no more graph that way. */
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

/**
 * A carousel slid: the arm that came into its window, and what that arm holds, were not drawn before. They set off
 * as far from their place as the arms beside them are from theirs, so they slide in with them (the paint keeps them
 * inside the container's border). Returns `motion` itself with no such card.
 */
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

/**
 * Takes the cards' places about to be drawn into the motion state. Cards slide and grow when the
 * design changed under them (a move, a block added or deleted, an undo) or a carousel slid. A
 * selection that moved (its card opens its notes) and another view are drawn in place: the keys
 * never wait on a tween. Returns `state` itself when no place changed.
 */
export function moveGraph(state: GraphState, layout: GraphLayout): GraphState {
  const shape = shapeOf(layout)
  const slides = shape !== state.shape && state.shape.split('\n')[0] === (layout.viewRootId ?? '') && state.shape !== ''
  const take = (motion: Motion, axis: 'x' | 'y' | 'h'): Motion => (slides ? stepMotion(motion, positions(layout, axis), state.clock) : atRest(motion, positions(layout, axis)))
  const motionX = take(slides ? withIncoming(state.motionX, layout, state.clock) : state.motionX, 'x')
  const motionY = take(state.motionY, 'y')
  const motionH = take(state.motionH, 'h')
  return motionX === state.motionX && motionY === state.motionY && motionH === state.motionH && shape === state.shape ? state : { ...state, motionX, motionY, motionH, shape }
}

/** Whether cards are sliding. */
export function graphMoving(state: Pick<GraphState, 'motionX' | 'motionY' | 'motionH' | 'clock'>): boolean {
  return motionActive(state.motionX, state.clock) || motionActive(state.motionY, state.clock) || motionActive(state.motionH, state.clock)
}

/** How long the mark on freshly edited blocks shows, and how long its first, louder part lasts. */
export const FLASH_MS = 800
export const FLASH_STRONG_MS = 400

/** Takes the edit the props announce: a `seq` not seen before starts the mark. Returns `state` itself otherwise. */
export function flashGraph(state: GraphState, flash: GraphProps['flash']): GraphState {
  if (!flash) return (state.flashSeq ?? 0) === 0 ? state : { ...state, flashSeq: 0 }
  if (flash.seq === state.flashSeq) return state
  return { ...state, flashSeq: flash.seq, flashIds: flash.ids, flashLeft: flash.ids.length > 0 ? FLASH_MS : 0 }
}

/** The blocks marked right now, and whether the mark is in its louder part; null with none. */
export function graphFlash(state: Pick<GraphState, 'flashIds' | 'flashLeft'>): { ids: string[]; strong: boolean } | null {
  const left = state.flashLeft ?? 0
  return left > 0 && state.flashIds && state.flashIds.length > 0 ? { ids: state.flashIds, strong: left > FLASH_MS - FLASH_STRONG_MS } : null
}

/** Whether the ticker should run: cards are sliding, a mark is showing, or a drag is held at an edge that pans. */
export function graphTicking(state: GraphState, context: GraphContext): boolean {
  return graphMoving(state) || (state.flashLeft ?? 0) > 0 || dragScroll(state, context) !== 0
}

/** One tick of the shared ticker. When every card has arrived and nothing pans, `ticking` goes false and the clock rests. */
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

/** Every sliding or growing card's distance from its place and its size, in cells. */
export function graphOffsets(state: Pick<GraphState, 'motionX' | 'motionY' | 'motionH' | 'clock'>): Record<string, { dx: number; dy: number; dh: number }> {
  const xs = rowOffsets(state.motionX, state.clock)
  const ys = rowOffsets(state.motionY, state.clock)
  const hs = rowOffsets(state.motionH, state.clock)
  const out: Record<string, { dx: number; dy: number; dh: number }> = {}
  for (const id of new Set([...Object.keys(xs), ...Object.keys(ys), ...Object.keys(hs)])) out[id] = { dx: xs[id] ?? 0, dy: ys[id] ?? 0, dh: hs[id] ?? 0 }
  return out
}

// ---------------------------------------------------------------------------
// Words: what a release would do, and what the help pages say of the graph

/** What letting go of the card in hand would do, said beside it; '' with none in hand. */
export function dragHint(state: Pick<GraphState, 'drag' | 'panY'>, context: GraphContext): string {
  if (dragging(state) === null) return ''
  const target = dragTarget(state, context)
  if (!target) return 'no slot here: release cancels'
  if (!target.to) return 'already here'
  return target.to.parentId === undefined ? 'drop here' : `drop into ${target.to.parentId}`
}

/** What the graph's marks mean, each with its mark first: a table in the help pages, not on the graph. */
export const LEGEND: readonly (readonly [string, string])[] = [
  ['↓', 'hands each result on as it arrives'],
  ['all ⇓', 'waits for all results first'],
  ['×N', 'on a header: a fan-out, the block runs once per item, N of them (count unknown: it states none)'],
  ['IF  ELSE', 'on a border: the condition of that arm of a branch'],
  ['OR  ∥', 'between arms: one of them runs / they run at the same time'],
  ['◀ N ▶', 'more arms than fit, N out of sight on that side'],
  ['▸', 'a container drawn closed (too deep or too narrow to show what it holds): o opens it as the view, b goes back up'],
  ['!', 'the block has a problem (a closed container: a block inside it has); the detail pane says what'],
  ['2/4 done', 'in a run: agents ended well of agents started, then the ones that failed'],
]

/** What the mouse does on the graph: the help pages say it, a paragraph each. */
export const MOUSE_HELP: readonly string[] = [
  'Click a card to select it. Click the selected container again to open it as the view; click a crumb to go back to that view.',
  'Click a [+] for a new block there (the lit one is where n adds it). Click a chip to step it, ◀ or ▶ to slide the arms.',
  'Drag the selected card to move it. Drag anything else, or turn the wheel, to scroll.',
  'In the detail pane, click a field to edit it. Under the header, click the goal to edit it.',
]
