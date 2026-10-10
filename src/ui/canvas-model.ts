// The canvas view model: the rows the canvas draws, the reducer for its local
// state, and the messages it posts to the hooks module. Pure TypeScript: no
// `$`, no engine imports, so all of it is unit-testable without the engine.

import { canHoldChildren, findNode, flatten, isNodeType } from '../design/model'
import type { Design, DesignNode, NodeType } from '../design/model'
import type { Place } from '../design/ops'
import { TEACH, fuzzy } from '../design/teach'
import { GLYPH } from './theme'

// ---------------------------------------------------------------------------
// Messages: Client → hooks module (surface.post → ui.message)

export type CanvasMessage =
  | { kind: 'select'; id: string | null }
  /** `delta` is keyboard steps (negative is up); `to` is an exact place (a pointer drop). */
  | { kind: 'move'; id: string; delta?: number; to?: Place; collapsed?: string[] }
  | { kind: 'add'; type: NodeType; at: Place }
  /** `select` is the row the canvas moved its selection to. */
  | { kind: 'remove'; id: string; select?: string | null }
  | { kind: 'edit'; id: string }
  | { kind: 'toggleCard' }

export type CanvasMode = 'design' | 'run'

/** What the hooks module hands the Client. `rev` changes when the hooks module sets the selection itself. */
export type CanvasProps = {
  design: Design
  lints: LintMark[]
  mode: CanvasMode
  selectedId: string | null
  rev: number
  /** Lines the canvas may take, hint line included; 0 for no limit. */
  maxRows: number
}

export type LintMark = { nodeId: string; message: string }

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
export function parseCanvasMessage(data: unknown): CanvasMessage | undefined {
  if (!isRecord(data)) return undefined
  const { kind, id } = data
  if (kind === 'toggleCard') return { kind }
  if (kind === 'select') return id === null || typeof id === 'string' ? { kind, id } : undefined
  if (kind === 'add') {
    const at = readPlace(data.at)
    return isNodeType(data.type) && at ? { kind, type: data.type, at } : undefined
  }
  if (typeof id !== 'string') return undefined
  if (kind === 'edit') return { kind, id }
  if (kind === 'remove') {
    const { select } = data
    return select === null || typeof select === 'string' ? { kind, id, select } : { kind, id }
  }
  if (kind === 'move') {
    const message: CanvasMessage = { kind, id }
    if (typeof data.delta === 'number' && Number.isFinite(data.delta)) message.delta = data.delta
    const to = readPlace(data.to)
    if (to) message.to = to
    if (Array.isArray(data.collapsed)) message.collapsed = data.collapsed.filter((one): one is string => typeof one === 'string')
    return message.delta !== undefined || message.to ? message : undefined
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Rows

/** The id the `+ add` row is selected under; no node id has this form. */
export const ADD_ROW_ID = '+'

export type DesignRow = {
  kind: 'node' | 'add'
  /** The node's id, or ADD_ROW_ID. */
  id: string
  /** Everything drawn before the glyph: the rail for the row's depth and position. */
  rail: string
  glyph: string
  title: string
  /** From knobs: `×4`, `×3 votes`, `until …`; '' when there is none. */
  badge: string
  typeName: string
  /** The lint's reason when the node has one. */
  lint: string | undefined
  selected: boolean
  grabbed: boolean
  depth: number
  parentId: string | undefined
  /** Position among its siblings. */
  index: number
  container: boolean
  collapsed: boolean
  /** Nodes hidden inside a collapsed container. */
  hidden: number
}

export type RowOptions = {
  selectedId?: string | null
  grabbedId?: string | null
  collapsed?: Iterable<string>
  lints?: readonly LintMark[]
}

const BADGE_TEXT_MAX = 24

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The knobs worth a glance on the row itself. */
export function badgeOf(node: DesignNode): string {
  const knobs = node.knobs ?? {}
  const parts: string[] = []
  if (knobs.fanout) {
    const count = /^[×x]\s*(\d+)/.exec(knobs.fanout)
    parts.push(count ? `×${count[1]}` : `× ${clip(knobs.fanout, BADGE_TEXT_MAX)}`)
  }
  if (knobs.votes !== undefined) parts.push(`×${knobs.votes} votes`)
  if (knobs.until) parts.push(`until ${clip(knobs.until, BADGE_TEXT_MAX)}`)
  return parts.join(' ')
}

function countNodes(nodes: readonly DesignNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children ?? []), 0)
}

/**
 * The rows the canvas draws, top to bottom, ending with the `+ add` row.
 * Top-level glyphs sit on the rail; nested rows hang off it:
 *
 *   ◆ n2 review
 *   │  ├ ● n3 review
 *   │  ╰ ◇ n4 verify
 *   ╰─ + add
 */
export function buildDesignRows(design: Design, options: RowOptions = {}): DesignRow[] {
  const collapsed = new Set(options.collapsed ?? [])
  const lints = new Map<string, string>()
  for (const one of options.lints ?? []) if (!lints.has(one.nodeId)) lints.set(one.nodeId, one.message)

  const rows: DesignRow[] = []
  // Per depth, the ancestor on the current path: whether it is the last of its siblings.
  const path: { id: string; last: boolean }[] = []
  let hiddenBelow: number | undefined

  for (const { node, depth, parentId, index } of flatten(design)) {
    if (hiddenBelow !== undefined) {
      if (depth > hiddenBelow) continue
      hiddenBelow = undefined
    }
    const siblings = parentId === undefined ? design.nodes : (findNode(design, parentId)?.children ?? [])
    const last = index === siblings.length - 1
    path.length = depth
    path.push({ id: node.id, last })

    let rail = ''
    if (depth > 0) {
      rail = `${GLYPH.rail}  `
      for (const ancestor of path.slice(1, depth)) rail += ancestor.last ? '   ' : `${GLYPH.rail}  `
      rail += `${last ? GLYPH.railEnd : GLYPH.railBranch} `
    }
    const isCollapsed = collapsed.has(node.id) && canHoldChildren(node.type)
    if (isCollapsed) hiddenBelow = depth
    const teach = TEACH[node.type]
    rows.push({
      kind: 'node',
      id: node.id,
      rail,
      glyph: teach.glyph,
      title: node.title,
      badge: badgeOf(node),
      typeName: teach.name,
      lint: lints.get(node.id),
      selected: options.selectedId === node.id,
      grabbed: options.grabbedId === node.id,
      depth,
      parentId,
      index,
      container: canHoldChildren(node.type),
      collapsed: isCollapsed,
      hidden: isCollapsed ? countNodes(node.children ?? []) : 0,
    })
  }

  rows.push({
    kind: 'add',
    id: ADD_ROW_ID,
    rail: `${GLYPH.railEnd}─ `,
    glyph: '+',
    title: 'add',
    badge: '',
    typeName: '',
    lint: undefined,
    selected: options.selectedId === ADD_ROW_ID,
    grabbed: false,
    depth: 0,
    parentId: undefined,
    index: design.nodes.length,
    container: false,
    collapsed: false,
    hidden: 0,
  })
  return rows
}

// ---------------------------------------------------------------------------
// Local state and its reducer

export type PickerState = {
  query: string
  /** Which match is highlighted. */
  index: number
  at: Place
  /** The visible row the picker is drawn under; -1 for the very top. */
  after: number
  /** Depth of the place, for the picker's rail. */
  depth: number
}

export type CanvasState = {
  /** A node id, or ADD_ROW_ID. */
  selectedId: string
  grabbedId: string | null
  collapsed: string[]
  picker: PickerState | null
  /** First line of the scroll window. */
  top: number
  /** The props `rev` this state last took its selection from. */
  rev: number
}

export type CanvasKey = { type: 'key'; key: string; ctrl?: true; shift?: true; meta?: true }

/** Pointer input joins this union in the next phase. */
export type CanvasInput = CanvasKey

export type CanvasContext = {
  design: Design
  /** Lines the canvas can show; 0 or less means no limit. */
  capacity?: number
}

export type CanvasResult = { state: CanvasState; post?: CanvasMessage }

export const PICKER_MAX = 5

export function initialCanvas(): CanvasState {
  return { selectedId: ADD_ROW_ID, grabbedId: null, collapsed: [], picker: null, top: 0, rev: -1 }
}

function ancestorsOf(design: Design, id: string): string[] {
  const byId = new Map(flatten(design).map(row => [row.node.id, row.parentId]))
  const out: string[] = []
  for (let parent = byId.get(id); parent !== undefined; parent = byId.get(parent)) out.push(parent)
  return out
}

/**
 * Brings local state in line with new props: takes the selection the hooks
 * module set (a new `rev`), and drops whatever names a node that is gone.
 */
export function syncCanvas(state: CanvasState, props: Pick<CanvasProps, 'design' | 'selectedId' | 'rev'>): CanvasState {
  const { design } = props
  const exists = (id: string | null): id is string => id !== null && findNode(design, id) !== undefined
  let next = state

  if (props.rev !== state.rev) {
    next = { ...next, rev: props.rev, selectedId: props.selectedId ?? ADD_ROW_ID, picker: null }
  }
  if (next.selectedId !== ADD_ROW_ID && !exists(next.selectedId)) {
    next = { ...next, selectedId: design.nodes[0]?.id ?? ADD_ROW_ID }
  }
  if (next.grabbedId !== null && (!exists(next.grabbedId) || next.grabbedId !== next.selectedId)) {
    next = { ...next, grabbedId: null }
  }
  // The selected row is always visible: open whatever hides it.
  const hiding = new Set(ancestorsOf(design, next.selectedId))
  const collapsed = next.collapsed.filter(id => exists(id) && !hiding.has(id))
  if (collapsed.length !== next.collapsed.length) next = { ...next, collapsed }
  return next
}

// Keys that arrive by name. Anything else longer than a character is a paste,
// which arrives as one key holding the whole text.
const NAMED_KEYS = /^(up|down|left|right|return|enter|tab|backspace|delete|insert|escape|space|home|end|pageup|pagedown|f\d{1,2})$/

function isPrintable(input: CanvasKey): boolean {
  if (input.ctrl || input.meta) return false
  return input.key.length === 1 || !NAMED_KEYS.test(input.key)
}

function openPicker(state: CanvasState, rows: DesignRow[], inside: boolean, design: Design): CanvasState {
  const at = rows.findIndex(row => row.id === state.selectedId)
  const row = rows[at]
  const blank = { query: '', index: 0 }
  if (!row || row.kind === 'add') {
    const end = rows.length - 1
    return { ...state, grabbedId: null, picker: { ...blank, at: { index: rows[end]?.index ?? 0 }, after: end - 1, depth: 0 } }
  }
  if (inside && row.container) {
    // Open the container so the new node is seen where it lands: as its last child.
    const collapsed = state.collapsed.filter(id => id !== row.id)
    return {
      ...state,
      collapsed,
      grabbedId: null,
      picker: { ...blank, at: { parentId: row.id, index: findNode(design, row.id)?.children?.length ?? 0 }, after: -2, depth: row.depth + 1 },
    }
  }
  const place: Place = row.parentId === undefined ? { index: row.index + 1 } : { parentId: row.parentId, index: row.index + 1 }
  return { ...state, grabbedId: null, picker: { ...blank, at: place, after: lastOfSubtree(rows, at), depth: row.depth } }
}

// Index of the last visible row belonging to the subtree rooted at rows[at].
function lastOfSubtree(rows: DesignRow[], at: number): number {
  const depth = rows[at]?.depth ?? 0
  let last = at
  for (let i = at + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.kind === 'add' || row.depth <= depth) break
    last = i
  }
  return last
}

function reducePicker(state: CanvasState, picker: PickerState, input: CanvasKey): CanvasResult {
  const { key } = input
  const cancel: CanvasResult = { state: { ...state, picker: null } }
  // Escape and ctrl+c rarely get here: the engine takes both to hand the keys
  // back to the prompt. Backspace on an empty query is the cancel that always works.
  if (key === 'escape' || (input.ctrl && (key === 'c' || key === 'g'))) return cancel

  const matches = fuzzy(picker.query)
  if (key === 'return' || key === 'enter') {
    const type = matches[Math.min(picker.index, matches.length - 1)]
    if (!type) return { state }
    return { state: { ...state, picker: null }, post: { kind: 'add', type, at: picker.at } }
  }
  if (key === 'backspace') {
    if (picker.query === '') return cancel
    return { state: { ...state, picker: { ...picker, query: picker.query.slice(0, -1), index: 0 } } }
  }
  const step = key === 'down' || key === 'tab' || (input.ctrl && key === 'n') ? 1 : key === 'up' || (input.ctrl && key === 'p') ? -1 : 0
  if (step !== 0) {
    const index = Math.max(0, Math.min(matches.length - 1, picker.index + step))
    return { state: { ...state, picker: { ...picker, index } } }
  }
  if (key !== 'space' && !isPrintable(input)) return { state }
  const text = key === 'space' ? ' ' : key.replace(/[\r\n\t]+/g, ' ')
  return { state: { ...state, picker: { ...picker, query: picker.query + text, index: 0 } } }
}

function reduceKey(state: CanvasState, input: CanvasKey, design: Design): CanvasResult {
  if (state.picker) return reducePicker(state, state.picker, input)

  const rows = buildDesignRows(design, { collapsed: state.collapsed })
  const at = Math.max(0, rows.findIndex(row => row.id === state.selectedId))
  const row = rows[at]
  if (!row) return { state }
  const key = input.key === ' ' ? 'space' : input.key
  const select = (id: string): CanvasResult =>
    id === state.selectedId ? { state } : { state: { ...state, selectedId: id }, post: { kind: 'select', id: id === ADD_ROW_ID ? null : id } }

  const step = key === 'j' || key === 'down' ? 1 : key === 'k' || key === 'up' ? -1 : 0
  if (state.grabbedId !== null) {
    if (step !== 0) return { state, post: { kind: 'move', id: state.grabbedId, delta: step, collapsed: state.collapsed } }
    const drop = key === 'space' || key === 'return' || key === 'enter' || key === 'escape' || (input.ctrl && key === 'c')
    return drop ? { state: { ...state, grabbedId: null } } : { state }
  }
  if (input.ctrl || input.meta) return { state }

  if (step !== 0) return select(rows[Math.max(0, Math.min(rows.length - 1, at + step))]?.id ?? state.selectedId)
  if (key === 'g' || key === 'home') return select(rows[0]?.id ?? ADD_ROW_ID)
  if (key === 'G' || key === 'end') return select(ADD_ROW_ID)
  if (key === '?') return { state, post: { kind: 'toggleCard' } }
  if (key === 'a' || key === 'A' || key === 'i') return { state: openPicker(state, rows, key !== 'a' || input.shift === true, design) }
  if (row.kind === 'add') return key === 'return' || key === 'enter' ? { state: openPicker(state, rows, false, design) } : { state }

  if (key === 'space') return { state: { ...state, grabbedId: row.id } }
  if (key === 'return' || key === 'enter') return { state, post: { kind: 'edit', id: row.id } }
  if (key === 'x' || key === 'delete') {
    // The selection lands on what takes the removed node's place.
    const after = rows[lastOfSubtree(rows, at) + 1]
    const before = rows[at - 1]
    const next = after && after.kind === 'node' ? after.id : (before?.id ?? ADD_ROW_ID)
    return { state: { ...state, selectedId: next, collapsed: state.collapsed.filter(id => id !== row.id) }, post: { kind: 'remove', id: row.id, select: next === ADD_ROW_ID ? null : next } }
  }
  if (key === 'h' || key === 'left') {
    if (row.container && !row.collapsed) return { state: { ...state, collapsed: [...state.collapsed, row.id] } }
    return row.parentId === undefined ? { state } : select(row.parentId)
  }
  if (key === 'l' || key === 'right') {
    return row.collapsed ? { state: { ...state, collapsed: state.collapsed.filter(id => id !== row.id) } } : { state }
  }
  return { state }
}

/**
 * One input against the canvas's local state: the next state, and the message
 * to post when the hooks module has to act on it.
 */
export function canvasReduce(state: CanvasState, input: CanvasInput, context: CanvasContext): CanvasResult {
  const result = reduceKey(state, input, context.design)
  if (result.state === state) return result
  const layout = layoutCanvas(buildDesignRows(context.design, { collapsed: result.state.collapsed, selectedId: result.state.selectedId }), result.state.picker)
  const top = scrollTop(result.state.top, layout, context.capacity ?? 0)
  return top === result.state.top ? result : { ...result, state: { ...result.state, top } }
}

// ---------------------------------------------------------------------------
// Layout: rows plus the open picker, and the window that fits the region

export type CanvasLine =
  | { kind: 'row'; row: DesignRow }
  | { kind: 'picker'; rail: string; query: string }
  | { kind: 'match'; rail: string; type: NodeType; glyph: string; name: string; hint: string; active: boolean }
  | { kind: 'empty'; rail: string }

export type CanvasLayout = {
  lines: CanvasLine[]
  /** The line that must stay in view: the selected row, or the picker. */
  focus: number
  /** The last line of the block around the focus (the picker's matches). */
  focusEnd: number
}

export function layoutCanvas(rows: DesignRow[], picker: PickerState | null): CanvasLayout {
  const lines: CanvasLine[] = rows.map(row => ({ kind: 'row', row }))
  if (!picker) {
    const focus = Math.max(0, rows.findIndex(row => row.selected))
    return { lines, focus, focusEnd: focus }
  }

  // -2: under the last visible row of the container the place is in.
  let after = picker.after
  if (after === -2) {
    const parent = rows.findIndex(row => row.id === picker.at.parentId)
    after = parent < 0 ? rows.length - 2 : lastOfSubtree(rows, parent)
  }
  after = Math.max(-1, Math.min(rows.length - 2, after))

  const rail = `${GLYPH.rail}  `.repeat(picker.depth)
  const matches = fuzzy(picker.query)
  const index = Math.max(0, Math.min(matches.length - 1, picker.index))
  const first = Math.max(0, Math.min(matches.length - PICKER_MAX, index - PICKER_MAX + 1))
  const block: CanvasLine[] = [{ kind: 'picker', rail: `${rail}${GLYPH.railBranch}─ `, query: picker.query }]
  for (const [offset, type] of matches.slice(first, first + PICKER_MAX).entries()) {
    const teach = TEACH[type]
    block.push({ kind: 'match', rail: `${rail}${GLYPH.rail}    `, type, glyph: teach.glyph, name: teach.name, hint: teach.hint, active: first + offset === index })
  }
  if (matches.length === 0) block.push({ kind: 'empty', rail: `${rail}${GLYPH.rail}    ` })

  lines.splice(after + 1, 0, ...block)
  return { lines, focus: after + 1, focusEnd: after + block.length }
}

/** The first line to draw so that the focus (and its block, if it fits) is in view, moving as little as possible. */
export function scrollTop(top: number, layout: Pick<CanvasLayout, 'lines' | 'focus' | 'focusEnd'>, capacity: number): number {
  const total = layout.lines.length
  if (capacity <= 0 || total <= capacity) return 0
  let next = Math.max(0, Math.min(total - capacity, top))
  if (layout.focusEnd >= next + capacity) next = layout.focusEnd - capacity + 1
  if (layout.focus < next) next = layout.focus
  return Math.max(0, Math.min(total - capacity, next))
}

export type CanvasWindow = { top: number; lines: CanvasLine[]; above: number; below: number }

/** The lines that fit `capacity`, with how many are cut off above and below. */
export function windowCanvas(layout: CanvasLayout, top: number, capacity: number): CanvasWindow {
  const first = scrollTop(top, layout, capacity)
  const lines = capacity <= 0 ? layout.lines : layout.lines.slice(first, first + capacity)
  return { top: first, lines, above: first, below: layout.lines.length - first - lines.length }
}

/** The dim hotkey line under the canvas, for the state the canvas is in. */
export function hintLine(state: Pick<CanvasState, 'picker' | 'grabbedId'>, row: DesignRow | undefined): string {
  if (state.picker) return 'type to filter · ↑/↓ choose · enter add · backspace on empty cancels'
  if (state.grabbedId !== null) return `moving ${state.grabbedId} · j/k move · space drop`
  if (!row || row.kind === 'add') return 'j/k move · a add · ? card'
  // What only this row offers comes first: the line is cut at the pane's edge.
  const fold = row.container ? (row.collapsed ? 'l expand · ' : 'h collapse · A add inside · ') : ''
  return `${fold}j/k move · space grab · a add · enter edit · x delete · ? card`
}
