// The flow board's model: what the hooks module hands the Client, the messages
// the Client posts back, and the reducer for the little the Client keeps to
// itself (the pan, a drag in flight, cards sliding). Selection, the grab, the
// picker and the delete question live in the hooks module's state: the board
// draws them from props. Pure TypeScript: no `$`, no engine imports.

import type { Design } from '../design/model'
import type { Place } from '../design/ops'
import { cardAt, dropTarget, layoutBoard, slotAt } from './board-layout'
import type { BoardLayout, DropTarget, Orientation } from './board-layout'
import { EDGE_GLYPH, affordances } from './board-paint'
import type { RunOverlay } from './board-paint'
import { FRAME_MS, motionActive, rowOffsets, settleMotion, stepMotion, stillMotion } from './tween'
import type { Motion } from './tween'

// ---------------------------------------------------------------------------
// Props and messages

/** What a key or a toolbar Button asks for. */
export type BoardOp = 'left' | 'right' | 'up' | 'down' | 'grab' | 'addAfter' | 'addInside' | 'remove' | 'edit' | 'card' | 'cancel'

export const BOARD_OPS: readonly BoardOp[] = ['left', 'right', 'up', 'down', 'grab', 'addAfter', 'addInside', 'remove', 'edit', 'card', 'cancel']

/** Client → hooks module (surface.post → ui.message). One per input: two posts in a frame can drop one. */
export type BoardMessage =
  | { kind: 'select'; id: string | null }
  /** A drop: `to` is the place once the card is lifted out, as `moveNode` takes it. */
  | { kind: 'move'; id: string; to: Place }
  /** A click on a `+`: open the type picker for that place. */
  | { kind: 'addAt'; at: Place }
  /** A click on `del`: a container that holds blocks is asked about first. */
  | { kind: 'remove'; id: string }
  | { kind: 'edit'; id: string }
  /** A key pressed while the board has the keyboard; arrows mean what they do in this orientation. */
  | { kind: 'key'; op: BoardOp; orientation: Orientation }

export type LintMark = { nodeId: string; message: string }

/** `run` while a run of this design is in progress: editing is locked. */
export type BoardMode = 'design' | 'run'

/** What the hooks module hands the Client. */
export type BoardProps = {
  design: Design
  lints: LintMark[]
  mode: BoardMode
  selectedId: string | null
  /** The card the keyboard's grab holds: drawn lifted. */
  grabbedId: string | null
  /** The container whose delete waits for a second ask. */
  confirmId: string | null
  /** The place the add picker is open for. */
  pickerAt: Place | null
  orientation: Orientation
  /** The room the pane gives the board; `rows` counts the legend line. */
  columns: number
  rows: number
  /** The run of this design, drawn over its cards. */
  run?: RunOverlay
}

/** Rows of the board's region that are not the board: the legend. */
export const LEGEND_ROWS = 1

/** The layout the props describe: the hooks module sizes the region from the same call. */
export function boardLayout(props: Pick<BoardProps, 'design' | 'orientation' | 'run'>): BoardLayout {
  return layoutBoard(props.design, { orientation: props.orientation, run: props.run !== undefined, unmapped: props.run?.unmapped?.total ?? 0 })
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
export function parseBoardMessage(data: unknown): BoardMessage | undefined {
  if (!isRecord(data)) return undefined
  const { kind, id } = data
  if (kind === 'select') return id === null || typeof id === 'string' ? { kind, id } : undefined
  if (kind === 'addAt') {
    const at = readPlace(data.at)
    return at ? { kind, at } : undefined
  }
  if (kind === 'key') {
    const op = BOARD_OPS.find(one => one === data.op)
    return op ? { kind, op, orientation: data.orientation === 'vertical' ? 'vertical' : 'horizontal' } : undefined
  }
  if (typeof id !== 'string') return undefined
  if (kind === 'edit' || kind === 'remove') return { kind, id }
  if (kind === 'move') {
    const to = readPlace(data.to)
    return to ? { kind, id, to } : undefined
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Local state and its reducer

export type BoardDrag =
  /** A card under a held button: a click until the pointer leaves the cell it went down on. */
  | { kind: 'card'; id: string; downX: number; downY: number; x: number; y: number; active: boolean }
  /** The background under a held button: the board pans with the pointer. */
  | { kind: 'pan'; downX: number; downY: number; panX: number; panY: number }

export type BoardState = {
  /** The board cell at the window's top left. */
  panX: number
  panY: number
  /** The selection the pan last made room for: the card's id and where it stood. */
  seen: string | null
  drag: BoardDrag | null
  /** Where the cards were last drawn, and the ones still sliding to their place. */
  motionX: Motion
  motionY: Motion
  /** The motion clock, in ms: moved on by the ticker, 0 while idle. */
  clock: number
  /** Whether the shared ticker runs. */
  ticking: boolean
}

export type BoardKey = { type: 'key'; key: string; ctrl?: true; shift?: true; meta?: true }

/** `x` and `y` are cells of the board's region, 0 at its top left. */
export type BoardPointer = { type: 'pointer'; event: 'down' | 'move' | 'up' | 'enter' | 'leave'; x: number; y: number }

export type BoardInput = BoardKey | BoardPointer

export type BoardContext = {
  layout: BoardLayout
  /** The window, legend not counted. */
  columns: number
  rows: number
  selectedId: string | null
  confirmId?: string | null
  /** A run is in progress: a press selects and pans, nothing is edited. */
  locked?: boolean
}

export type BoardResult = { state: BoardState; post?: BoardMessage }

export function initialBoard(): BoardState {
  return { panX: 0, panY: 0, seen: null, drag: null, motionX: stillMotion(), motionY: stillMotion(), clock: 0, ticking: false }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function clampPan(state: BoardState, context: BoardContext): BoardState {
  const panX = clamp(state.panX, 0, Math.max(0, context.layout.width - context.columns))
  const panY = clamp(state.panY, 0, Math.max(0, context.layout.height - context.rows))
  return panX === state.panX && panY === state.panY ? state : { ...state, panX, panY }
}

/** The pan that shows `start..start+size`, moved as little as possible; a span wider than the window shows its start. */
export function reveal(pan: number, start: number, size: number, room: number): number {
  if (size >= room || start < pan) return start
  return start + size > pan + room ? start + size - room : pan
}

/**
 * Brings local state in line with what is drawn now: the pan stays inside the
 * board, a new selection is scrolled into view, and a drag whose card is gone
 * (or that a starting run locked out) is let go. Returns `state` itself when
 * nothing changes.
 */
export function syncBoard(state: BoardState, context: BoardContext): BoardState {
  let next = state
  if (next.drag?.kind === 'card') {
    const { id } = next.drag
    if (context.locked || !context.layout.cards.some(card => card.id === id)) next = { ...next, drag: null }
  }
  // A selected card that moved (a drop, a block added before it) is followed as a new selection is.
  const card = context.layout.cards.find(one => one.id === context.selectedId)
  const seen = card ? `${card.id}@${card.x},${card.y}` : context.selectedId
  if (seen !== next.seen) {
    next = { ...next, seen }
    if (card) {
      next = { ...next, panX: reveal(next.panX, card.x, card.w + (card.shadow ? 1 : 0), context.columns), panY: reveal(next.panY, card.y, card.h, context.rows) }
    }
  }
  return clampPan(next, context)
}

const KEY_OPS: Record<string, BoardOp> = {
  left: 'left',
  h: 'left',
  right: 'right',
  l: 'right',
  up: 'up',
  k: 'up',
  down: 'down',
  j: 'down',
  a: 'addAfter',
  i: 'addInside',
  x: 'remove',
  delete: 'remove',
  g: 'grab',
  space: 'grab',
  ' ': 'grab',
  return: 'edit',
  enter: 'edit',
  e: 'edit',
  '?': 'card',
  c: 'card',
  escape: 'cancel',
}

function inWindow(context: BoardContext, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < context.columns && y < context.rows
}

/** Whether a card is in the pointer's hand and has left the cell it was pressed on. */
export function dragging(state: Pick<BoardState, 'drag'>): string | null {
  return state.drag?.kind === 'card' && state.drag.active ? state.drag.id : null
}

/** Where the card in hand would land right now; null with none in hand, off the board, or far from any slot. */
export function dragTarget(state: Pick<BoardState, 'drag' | 'panX' | 'panY'>, context: BoardContext): DropTarget | null {
  const { drag } = state
  if (drag?.kind !== 'card' || !drag.active || !inWindow(context, drag.x, drag.y)) return null
  return dropTarget(context.layout, drag.id, drag.x + state.panX, drag.y + state.panY)
}

function reducePointer(state: BoardState, input: BoardPointer, context: BoardContext): BoardResult {
  const { layout } = context
  const { x, y } = input

  if (input.event === 'down') {
    const base: BoardState = state.drag === null ? state : { ...state, drag: null }
    if (!inWindow(context, x, y)) return { state: base }
    const cx = x + base.panX
    const cy = y + base.panY
    if (!context.locked) {
      const selected = layout.cards.find(card => card.id === context.selectedId)
      const act = selected ? affordances(selected, context.confirmId === selected.id).find(one => cy === one.y && cx >= one.x && cx < one.x + one.w) : undefined
      if (selected && act) return { state: base, post: { kind: act.kind, id: selected.id } }
      const slot = slotAt(layout, cx, cy)
      if (slot) return { state: base, post: { kind: 'addAt', at: slot.place } }
    }
    const pan: BoardDrag = { kind: 'pan', downX: x, downY: y, panX: base.panX, panY: base.panY }
    const card = cardAt(layout, cx, cy)
    if (!card) return { state: { ...base, drag: pan } }
    const next: BoardState = { ...base, drag: context.locked || card.type === 'unmapped' ? pan : { kind: 'card', id: card.id, downX: x, downY: y, x, y, active: false } }
    return card.id === context.selectedId ? { state: next } : { state: next, post: { kind: 'select', id: card.id } }
  }

  const { drag } = state
  // Crossing the region's edge changes nothing: the instance holds the pointer until `up`.
  if (!drag || input.event === 'enter' || input.event === 'leave') return { state }
  if (drag.kind === 'pan') {
    if (input.event === 'up') return { state: { ...state, drag: null } }
    const moved = clampPan({ ...state, panX: drag.panX - (x - drag.downX), panY: drag.panY - (y - drag.downY) }, context)
    return moved.panX === state.panX && moved.panY === state.panY ? { state } : { state: moved }
  }
  const held: BoardDrag = { ...drag, x, y, active: drag.active || x !== drag.downX || y !== drag.downY }
  if (input.event === 'move') return held.x === drag.x && held.y === drag.y ? { state } : { state: { ...state, drag: held } }

  // up: a click was settled at `down`; a drag commits with one move, or cancels.
  const target = dragTarget({ ...state, drag: held }, context)
  const dropped: BoardState = { ...state, drag: null }
  return target?.to ? { state: dropped, post: { kind: 'move', id: drag.id, to: target.to } } : { state: dropped }
}

function reduceKey(state: BoardState, input: BoardKey, context: BoardContext): BoardResult {
  // A key lets go of whatever the pointer holds.
  const base: BoardState = state.drag === null ? state : { ...state, drag: null }
  if (input.ctrl || input.meta) return { state: base }
  const op = KEY_OPS[input.key]
  return op ? { state: base, post: { kind: 'key', op, orientation: context.layout.orientation } } : { state: base }
}

/** One input against the board's local state: the next state, and the message to post when the hooks module has to act on it. */
export function boardReduce(state: BoardState, input: BoardInput, context: BoardContext): BoardResult {
  return input.type === 'pointer' ? reducePointer(state, input, context) : reduceKey(state, input, context)
}

// ---------------------------------------------------------------------------
// Motion: cards slide to their new place; a card held at the window's edge pans the board

/** A drag held at the window's edge pans one step per this long. */
export const DRAG_SCROLL_MS = 96
const SCROLL_STEP = { x: 2, y: 1 } as const

/** Which way a card held at the window's edge pans the board; 0 where there is no more board that way. */
export function dragScroll(state: Pick<BoardState, 'drag' | 'panX' | 'panY'>, context: BoardContext): { dx: -1 | 0 | 1; dy: -1 | 0 | 1 } {
  const { drag } = state
  if (drag?.kind !== 'card' || !drag.active) return { dx: 0, dy: 0 }
  const maxX = Math.max(0, context.layout.width - context.columns)
  const maxY = Math.max(0, context.layout.height - context.rows)
  const dx = drag.x <= 0 && state.panX > 0 ? -1 : drag.x >= context.columns - 1 && state.panX < maxX ? 1 : 0
  const dy = drag.y <= 0 && state.panY > 0 ? -1 : drag.y >= context.rows - 1 && state.panY < maxY ? 1 : 0
  return { dx, dy }
}

function positions(layout: BoardLayout, axis: 'x' | 'y'): Record<string, number> {
  const out: Record<string, number> = {}
  for (const card of layout.cards) out[card.id] = card[axis]
  return out
}

/** Takes the cards' places about to be drawn into the motion state: a card whose place changed starts sliding. Returns `state` itself when none moved. */
export function moveBoard(state: BoardState, layout: BoardLayout): BoardState {
  const motionX = stepMotion(state.motionX, positions(layout, 'x'), state.clock)
  const motionY = stepMotion(state.motionY, positions(layout, 'y'), state.clock)
  return motionX === state.motionX && motionY === state.motionY ? state : { ...state, motionX, motionY }
}

/** Whether cards are sliding. */
export function boardMoving(state: Pick<BoardState, 'motionX' | 'motionY' | 'clock'>): boolean {
  return motionActive(state.motionX, state.clock) || motionActive(state.motionY, state.clock)
}

/** Whether the ticker should run: cards are sliding, or a drag is held at an edge that pans. */
export function boardTicking(state: BoardState, context: BoardContext): boolean {
  const way = dragScroll(state, context)
  return boardMoving(state) || way.dx !== 0 || way.dy !== 0
}

/** One tick of the shared ticker. When every card has arrived and nothing pans, `ticking` goes false and the clock rests. */
export function tickBoard(state: BoardState, context: BoardContext): BoardState {
  const clock = state.clock + FRAME_MS
  const way = dragScroll(state, context)
  const panning = way.dx !== 0 || way.dy !== 0
  const step = panning && clock % DRAG_SCROLL_MS === 0
  const panned = step ? clampPan({ ...state, panX: state.panX + way.dx * SCROLL_STEP.x, panY: state.panY + way.dy * SCROLL_STEP.y }, context) : state
  const motionX = settleMotion(state.motionX, clock)
  const motionY = settleMotion(state.motionY, clock)
  if (panning || motionActive(motionX, clock) || motionActive(motionY, clock)) return { ...panned, clock, motionX, motionY }
  return { ...panned, clock: 0, motionX: { ys: motionX.ys, tweens: {} }, motionY: { ys: motionY.ys, tweens: {} }, ticking: false }
}

/** Every sliding card's distance from its place, in cells. */
export function boardOffsets(state: Pick<BoardState, 'motionX' | 'motionY' | 'clock'>): Record<string, { dx: number; dy: number }> {
  const xs = rowOffsets(state.motionX, state.clock)
  const ys = rowOffsets(state.motionY, state.clock)
  const out: Record<string, { dx: number; dy: number }> = {}
  for (const id of new Set([...Object.keys(xs), ...Object.keys(ys)])) out[id] = { dx: xs[id] ?? 0, dy: ys[id] ?? 0 }
  return out
}

// ---------------------------------------------------------------------------
// The legend: the one line under the board

/** What the two edge styles mean, then what the pointer can do; during a drag, what a release would do. */
export function legendLine(state: Pick<BoardState, 'drag' | 'panX' | 'panY'>, context: BoardContext): string {
  const held = dragging(state)
  if (held !== null) {
    const target = dragTarget(state, context)
    if (!target) return 'no slot here · release to cancel'
    if (!target.to) return `${held} is already here · release to leave it`
    return `release to drop ${held}${target.to.parentId === undefined ? '' : ` into ${target.to.parentId}`}`
  }
  const glyphs = EDGE_GLYPH[context.layout.orientation === 'horizontal' ? 'h' : 'v']
  const parts = [`${glyphs.stream} hands each result on`, `${glyphs.barrier} waits for all`]
  if (!context.locked) parts.push('+ add', 'drag a card to move it')
  const more = `${state.panX > 0 ? '◀' : ''}${state.panY > 0 ? '▲' : ''}${state.panY < context.layout.height - context.rows ? '▼' : ''}${state.panX < context.layout.width - context.columns ? '▶' : ''}`
  if (more !== '') parts.push(`${more} more: drag the background`)
  return parts.join(' · ')
}
