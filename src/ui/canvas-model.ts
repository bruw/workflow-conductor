// The canvas view model: the rows the canvas draws, the reducer for its local
// state, and the messages it posts to the hooks module. Pure TypeScript: no
// `$`, no engine imports, so all of it is unit-testable without the engine.

import { canHoldChildren, findNode, flatten, isNodeType } from '../design/model'
import type { Design, DesignNode, NodeType } from '../design/model'
import { removeNode } from '../design/ops'
import type { Place } from '../design/ops'
import { TEACH, fuzzy } from '../design/teach'
import type { AgentStatus, NodeRun, RunStatus } from '../run/events'
import { FAILED, bar, fmtTokens, spinnerFrame } from './rail'
import { GLYPH } from './theme'
import { FRAME_MS, motionActive, placeRows, rowOffsets, settleMotion, stepMotion, stillMotion } from './tween'
import type { Motion } from './tween'

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
  /** Open or close the agent list of a node (or of UNMAPPED_ROW_ID) in the run overlay. */
  | { kind: 'toggleRun'; id: string }
  /** An edit key pressed while editing is locked: the hooks module says why nothing happened. */
  | { kind: 'locked' }

/** `run` while a run of this design is in progress: editing is locked. */
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
  /** The node the toolbar's grab holds: drawn lifted. */
  grabbedId?: string | null
  /** The run of this design, drawn over its rows. */
  run?: RunOverlay
}

/** What the overlay knows of one agent. */
export type OverlayAgent = { agentId: string; label: string; nodeId?: string; status: AgentStatus; tokens: number }

/** A run laid over the design: counts by node id, and the agents the open nodes list. */
export type RunOverlay = {
  status: RunStatus
  byNode: Record<string, NodeRun>
  /** By agentId. May hold only the agents of open nodes and the unmapped ones. */
  agents: Record<string, OverlayAgent>
  /** AgentIds whose label names no node of the design. */
  unmapped: string[]
  /** Nodes whose agent list the person opened. */
  expandedRunNodes: string[]
  /** Nodes the person closed although a failure would open them. */
  collapsedRunNodes?: string[]
  /** The run's tick clock, for the spinner frame. */
  now?: number
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
  if (kind === 'toggleCard' || kind === 'locked') return { kind }
  if (kind === 'toggleRun') return typeof id === 'string' ? { kind, id } : undefined
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

/** The id of the group row that lists the agents no node claims. */
export const UNMAPPED_ROW_ID = 'unmapped'
export const NOT_RUN = '· not run'
/** Agents listed under one open node; the rest are a `… N more` line. */
export const AGENT_ROWS_MAX = 12

export type RunColor = 'claude' | 'success' | 'error' | 'inactive'

/** What the run overlay adds to a row. */
export type RowRun = {
  /** Spinner frame, `✓`, `✗`, or the row's own glyph while it has no agent. */
  glyph: string
  color: RunColor
  /** `settled/total`; '' with no agent. */
  counts: string
  tokens: string
  bar: string
  /** NOT_RUN once the run is over and the node got no agent; else ''. */
  note: string
  /** Whether its agents are listed under it. */
  open: boolean
}

export type DesignRow = {
  /** `agent`: one agent under an open node. `group`: the unmapped agents. Both only with a run overlay. */
  kind: 'node' | 'add' | 'agent' | 'group'
  /** The node's id, ADD_ROW_ID, UNMAPPED_ROW_ID, or `agent:<agentId>`. */
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
  /** Present only when a run is laid over the design. */
  run?: RowRun
}

export type RowOptions = {
  selectedId?: string | null
  grabbedId?: string | null
  collapsed?: Iterable<string>
  lints?: readonly LintMark[]
  run?: RunOverlay
  /** False keeps every agent list shut (the picker counts rows without them). */
  agentRows?: boolean
}

const NO_RUN: NodeRun = { total: 0, running: 0, done: 0, failed: 0, tokens: 0 }

function addRuns(a: NodeRun, b: NodeRun | undefined): NodeRun {
  if (!b) return a
  return { total: a.total + b.total, running: a.running + b.running, done: a.done + b.done, failed: a.failed + b.failed, tokens: a.tokens + b.tokens }
}

/** A node's own agents plus those of everything it holds. */
function runOfNode(node: DesignNode, byNode: Record<string, NodeRun>): NodeRun {
  return (node.children ?? []).reduce((sum, child) => addRuns(sum, runOfNode(child, byNode)), addRuns(NO_RUN, byNode[node.id]))
}

function unmappedAgents(run: RunOverlay): OverlayAgent[] {
  return run.unmapped.map(id => run.agents[id]).filter((one): one is OverlayAgent => one !== undefined)
}

/** Whether a node's (or the unmapped group's) agents are listed: opened by hand, or by a failure unless closed by hand. */
export function runNodeOpen(run: RunOverlay, id: string): boolean {
  if (run.expandedRunNodes.includes(id)) return true
  if ((run.collapsedRunNodes ?? []).includes(id)) return false
  if (id === UNMAPPED_ROW_ID) return unmappedAgents(run).some(agent => agent.status === 'failed')
  return (run.byNode[id]?.failed ?? 0) > 0
}

function statusMark(status: AgentStatus | 'none', now: number | undefined, glyph: string): { glyph: string; color: RunColor } {
  if (status === 'running') return { glyph: spinnerFrame(now ?? 0), color: 'claude' }
  if (status === 'failed') return { glyph: FAILED, color: 'error' }
  if (status === 'done') return { glyph: '✓', color: 'success' }
  return { glyph, color: 'inactive' }
}

const MINI_BAR = 6
const OVER: readonly RunStatus[] = ['done', 'failed']

function rowRun(sum: NodeRun, run: RunOverlay, glyph: string, open: boolean, spawns: boolean): RowRun {
  const status = sum.running > 0 ? 'running' : sum.failed > 0 ? 'failed' : sum.total > 0 ? 'done' : 'none'
  const settled = sum.done + sum.failed
  const ran = sum.total > 0
  return {
    ...statusMark(status, run.now, glyph),
    counts: ran ? `${settled}/${sum.total}` : '',
    tokens: ran ? fmtTokens(sum.tokens) : '',
    bar: ran ? bar(settled, sum.total, MINI_BAR) : '',
    note: !ran && spawns && OVER.includes(run.status) ? NOT_RUN : '',
    open: open && ran,
  }
}

const ORDER: Record<AgentStatus, number> = { failed: 0, running: 1, done: 2 }

/** The label without the node id it starts with: `n3: verify auth` → `verify auth`. */
export function agentTitle(agent: Pick<OverlayAgent, 'label' | 'agentId' | 'nodeId'>): string {
  const label = agent.nodeId === undefined ? agent.label : agent.label.replace(/^n\d+\b[:\s]*/, '')
  return label.trim() || agent.agentId
}

/** The lines under an open row: its agents, failures first, cut at AGENT_ROWS_MAX. */
function agentRows(agents: OverlayAgent[], total: number, parentId: string, depth: number, stem: string, more: boolean, run: RunOverlay): DesignRow[] {
  const sorted = [...agents].sort((a, b) => ORDER[a.status] - ORDER[b.status])
  const shown = sorted.slice(0, AGENT_ROWS_MAX)
  const rest = Math.max(total, sorted.length) - shown.length
  const base = { badge: '', typeName: '', lint: undefined, selected: false, grabbed: false, depth, parentId, index: 0, container: false, collapsed: false, hidden: 0 }
  const rows: DesignRow[] = shown.map(agent => ({
    ...base,
    kind: 'agent',
    id: `agent:${agent.agentId}`,
    rail: '',
    glyph: '',
    title: agentTitle(agent),
    run: { ...statusMark(agent.status, run.now, ''), counts: '', tokens: fmtTokens(agent.tokens), bar: '', note: '', open: false },
  }))
  if (rest > 0) {
    rows.push({ ...base, kind: 'agent', id: `more:${parentId}`, rail: '', glyph: '', title: `${rest} more`, run: { glyph: '…', color: 'inactive', counts: '', tokens: '', bar: '', note: '', open: false } })
  }
  for (const [at, row] of rows.entries()) {
    row.rail = `${stem}${at === rows.length - 1 && !more ? GLYPH.railEnd : GLYPH.railBranch} `
    row.glyph = row.run?.glyph ?? ''
  }
  return rows
}

const BADGE_TEXT_MAX = 24

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** A free-text fanout longer than this is left to the inspector; a longer badge is the first thing a narrow row cuts. */
export const BADGE_SHORT = 12

/**
 * The knobs worth a glance on the row itself. A fanout shows as its count (`×4`), or as
 * its text when that is short; never when the title already carries a `×N`.
 */
export function badgeOf(node: DesignNode): string {
  const knobs = node.knobs ?? {}
  const parts: string[] = []
  if (knobs.fanout && !/×\s*\d+/.test(node.title)) {
    const count = /^[×x]\s*(\d+)/.exec(knobs.fanout)
    if (count) parts.push(`×${count[1]}`)
    else if (knobs.fanout.trim().length <= BADGE_SHORT) parts.push(`× ${knobs.fanout.trim()}`)
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
  const { run } = options
  const listed = options.agentRows !== false
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
    const row: DesignRow = {
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
    }
    rows.push(row)
    if (!run) continue

    // A `code` node spawns nothing, so it is never "not run".
    row.run = rowRun(runOfNode(node, run.byNode), run, teach.glyph, listed && runNodeOpen(run, node.id), node.type !== 'code')
    const own = run.byNode[node.id]
    if (!row.run.open || !own || own.total === 0) {
      row.run.open = false
      continue
    }
    let stem = `${GLYPH.rail}  `
    for (const ancestor of path.slice(1, depth + 1)) stem += ancestor.last ? '   ' : `${GLYPH.rail}  `
    const agents = Object.values(run.agents).filter(agent => agent.nodeId === node.id)
    rows.push(...agentRows(agents, own.total, node.id, depth + 1, stem, !isCollapsed && (node.children?.length ?? 0) > 0, run))
  }

  // What the implementation ran that the design does not hold.
  if (run && run.unmapped.length > 0) {
    const agents = unmappedAgents(run)
    const sum = agents.reduce<NodeRun>((all, agent) => addRuns(all, { ...NO_RUN, total: 1, [agent.status]: 1, tokens: agent.tokens }), { ...NO_RUN })
    // Agents the overlay was not handed still count.
    const total = Math.max(sum.total, run.unmapped.length)
    const open = listed && runNodeOpen(run, UNMAPPED_ROW_ID)
    rows.push({
      kind: 'group',
      id: UNMAPPED_ROW_ID,
      rail: '',
      glyph: '?',
      title: 'unmapped',
      badge: `×${run.unmapped.length}`,
      typeName: '',
      lint: undefined,
      selected: options.selectedId === UNMAPPED_ROW_ID,
      grabbed: false,
      depth: 0,
      parentId: undefined,
      index: design.nodes.length,
      container: false,
      collapsed: false,
      hidden: 0,
      run: rowRun({ ...sum, total, done: sum.done + (total - sum.total) }, run, '?', open, false),
    })
    if (open) rows.push(...agentRows(agents, total, UNMAPPED_ROW_ID, 1, `${GLYPH.rail}  `, false, run))
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
  /** The row the pointer holds, from `down` until the drop has landed. */
  drag: DragState | null
  /** Where the rows were last drawn, and the ones still sliding to their place. */
  motion: Motion
  /** The motion clock, in ms: moved on by the ticker, 0 while idle. */
  clock: number
  /** Whether the shared ticker runs. */
  ticking: boolean
}

/** Where a dragged row would land: the place, the line it opens a gap at, and its depth there. */
export type DropTarget = { place: Place; slot: number; depth: number }

export type DragState = {
  id: string
  /** Where the pointer went down, in region cells. */
  downX: number
  downY: number
  /** Where the pointer is now. */
  x: number
  y: number
  /** The scroll window's first line when the pointer went down. */
  top: number
  /** False until the pointer leaves the row it went down on: until then it is a click. */
  active: boolean
  /** Set at the drop: the row waits here, lifted, until the design that holds the move arrives. */
  settling: DropTarget | null
}

export type CanvasKey = { type: 'key'; key: string; ctrl?: true; shift?: true; meta?: true }

/** `x` and `y` are cells of the canvas's region, 0 at its top left. */
export type CanvasPointer = { type: 'pointer'; event: 'down' | 'move' | 'up' | 'enter' | 'leave'; x: number; y: number }

export type CanvasInput = CanvasKey | CanvasPointer

export type CanvasContext = {
  design: Design
  /** Lines the canvas can show; 0 or less means no limit. */
  capacity?: number
  /** The run laid over the rows, when there is one: its agent lines count as lines. */
  run?: RunOverlay
  /** A run is in progress: edits are refused, a click opens a row's agents. */
  locked?: boolean
}

export type CanvasResult = { state: CanvasState; post?: CanvasMessage }

export const PICKER_MAX = 5

export function initialCanvas(): CanvasState {
  return { selectedId: ADD_ROW_ID, grabbedId: null, collapsed: [], picker: null, top: 0, rev: -1, drag: null, motion: stillMotion(), clock: 0, ticking: false }
}

function samePlace(a: Place, b: Place): boolean {
  return a.parentId === b.parentId && a.index === b.index
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
export function syncCanvas(state: CanvasState, props: Pick<CanvasProps, 'design' | 'selectedId' | 'rev'> & Partial<Pick<CanvasProps, 'mode' | 'run'>>): CanvasState {
  const { design } = props
  const group = props.run !== undefined && props.run.unmapped.length > 0
  const exists = (id: string | null): id is string => id !== null && (findNode(design, id) !== undefined || (group && id === UNMAPPED_ROW_ID))
  let next = state

  // A run that starts takes whatever was held or half typed out of the hand.
  if (props.mode === 'run' && (next.grabbedId !== null || next.picker !== null || next.drag !== null)) {
    next = { ...next, grabbedId: null, picker: null, drag: null }
  }

  if (props.rev !== state.rev) {
    next = { ...next, rev: props.rev, selectedId: props.selectedId ?? ADD_ROW_ID, picker: null, drag: null }
  }
  if (next.drag !== null) {
    const { id, settling } = next.drag
    const now = flatten(design).find(row => row.node.id === id)
    // A dropped row stays lifted until the design shows it where it was dropped.
    const landed = settling !== null && now !== undefined && samePlace(settling.place, now.parentId === undefined ? { index: now.index } : { parentId: now.parentId, index: now.index })
    if (!now || landed) next = { ...next, drag: null }
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

const LOCKED_KEYS = /^(space|return|enter|x|delete|a|A|i)$/

function reduceKey(state: CanvasState, input: CanvasKey, context: CanvasContext): CanvasResult {
  const { design } = context
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
  if (context.locked && LOCKED_KEYS.test(key)) return { state, post: { kind: 'locked' } }
  if (key === 'o' && context.run) return state.selectedId === ADD_ROW_ID ? { state } : { state, post: { kind: 'toggleRun', id: state.selectedId } }

  if (step !== 0) return select(rows[Math.max(0, Math.min(rows.length - 1, at + step))]?.id ?? state.selectedId)
  if (key === 'g' || key === 'home') return select(rows[0]?.id ?? ADD_ROW_ID)
  if (key === 'G' || key === 'end') return select(ADD_ROW_ID)
  if (key === '?') return { state, post: { kind: 'toggleCard' } }
  if (key === 'a' || key === 'A' || key === 'i') return { state: openPicker(state, rows, key !== 'a' || input.shift === true, design) }
  if (row.kind === 'add') return key === 'return' || key === 'enter' ? { state: openPicker(state, rows, false, design) } : { state }

  if (key === 'space') return { state: { ...state, grabbedId: row.id } }
  if (key === 'return' || key === 'enter') return { state, post: { kind: 'edit', id: row.id } }
  if (key === 'x' || key === 'delete') {
    // A container that holds blocks is confirmed by the hooks module, which then moves the selection itself.
    if ((findNode(design, row.id)?.children?.length ?? 0) > 0) return { state, post: { kind: 'remove', id: row.id } }
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
  // A key lets go of whatever the pointer holds.
  const result = input.type === 'pointer' ? reducePointer(state, input, context) : reduceKey(state.drag ? { ...state, drag: null } : state, input, context)
  if (result.state === state) return result
  // The window stays put under a row in flight: the pointer's line must keep meaning the same row.
  if (isDragging(result.state.drag)) return result
  const layout = layoutCanvas(buildDesignRows(context.design, { collapsed: result.state.collapsed, selectedId: result.state.selectedId }), result.state.picker)
  const top = scrollTop(result.state.top, layout, context.capacity ?? 0)
  const { drag } = result.state
  if (top === result.state.top && (!drag || drag.top === top)) return result
  return { ...result, state: { ...result.state, top, drag: drag ? { ...drag, top } : null } }
}

// ---------------------------------------------------------------------------
// Pointer: click to select, press and move to drag a row (with its subtree)

/** Columns one level of nesting takes on the rail. */
export const INDENT = 3

function isDragging(drag: DragState | null): boolean {
  return drag !== null && (drag.active || drag.settling !== null)
}

/**
 * Where a row dropped at `line` lands. `rest` is the rows without the dragged
 * subtree, `+ add` last. The line picks the slot (the row lands before
 * `rest[slot]`); where a slot is ambiguous (the end of a container against
 * after it), `depth` picks, clamped to what the slot allows. Null when the
 * line is outside the list.
 */
export function dropTarget(rest: readonly DesignRow[], line: number, depth: number): DropTarget | null {
  const count = rest.length - 1
  if (count < 0 || line < 0 || line > count + 1) return null
  const slot = Math.min(line, count)
  const above = rest[slot - 1]
  const below = rest[slot]
  const shallowest = below && below.kind === 'node' ? below.depth : 0
  const deepest = above ? (above.container && !above.collapsed ? above.depth + 1 : above.depth) : 0
  const at = Math.max(shallowest, Math.min(deepest, depth))

  let parentId: string | undefined
  if (at > 0) {
    for (let i = slot - 1; i >= 0; i--) {
      const row = rest[i]
      if (row && row.depth === at - 1) {
        parentId = row.id
        break
      }
    }
    // Only a container opens a deeper slot, so this does not happen; refuse rather than guess.
    if (parentId === undefined) return null
  }
  const index = rest.slice(0, slot).filter(row => row.depth === at && row.parentId === parentId).length
  return { place: parentId === undefined ? { index } : { parentId, index }, slot, depth: at }
}

export type DragView = {
  /** The dragged row, folded: its subtree travels inside it. */
  lifted: DesignRow
  /** The rows without it, as they would be drawn. */
  rest: DesignRow[]
  /** Null over an invalid place: no gap is shown and a drop there does nothing. */
  target: DropTarget | null
}

/** What a drag in flight looks like; null when no row is being dragged. */
export function dragView(design: Design, state: Pick<CanvasState, 'drag' | 'collapsed'>, options: { lints?: readonly LintMark[]; capacity?: number } = {}): DragView | null {
  const { drag } = state
  if (drag === null || !isDragging(drag)) return null
  const lifted = buildDesignRows(design, { collapsed: [...state.collapsed, drag.id], lints: options.lints ?? [] }).find(row => row.id === drag.id)
  if (!lifted) return null
  const rest = buildDesignRows(removeNode(design, drag.id).design, { collapsed: state.collapsed, lints: options.lints ?? [] })
  if (drag.settling) return { lifted, rest, target: drag.settling }
  const capacity = options.capacity ?? 0
  const outside = drag.y < 0 || (capacity > 0 && drag.y >= capacity)
  const depth = lifted.depth + Math.round((drag.x - drag.downX) / INDENT)
  return { lifted, rest, target: outside ? null : dropTarget(rest, drag.top + drag.y, depth) }
}

/** A drag held on the first or last visible row scrolls the window one row per this long. */
export const DRAG_SCROLL_MS = 96

/**
 * Which way a drag in flight should scroll the window: -1 while the pointer rests on the
 * first visible row with rows cut off above, 1 on the last with rows cut off below, else 0.
 */
export function dragScroll(state: Pick<CanvasState, 'drag' | 'collapsed'>, design: Design, capacity: number): -1 | 0 | 1 {
  const { drag } = state
  if (drag === null || !drag.active || drag.settling !== null || capacity <= 0) return 0
  // The lines of a drag: the rows without the dragged subtree, and the lifted row.
  const lines = buildDesignRows(removeNode(design, drag.id).design, { collapsed: state.collapsed }).length + 1
  if (drag.y === 0 && drag.top > 0) return -1
  if (drag.y === capacity - 1 && drag.top < lines - capacity) return 1
  return 0
}

function reducePointer(state: CanvasState, input: CanvasPointer, context: CanvasContext): CanvasResult {
  const { design } = context
  const capacity = context.capacity ?? 0
  const { x, y } = input

  if (input.event === 'down') {
    const base: CanvasState = state.drag === null && state.grabbedId === null ? state : { ...state, drag: null, grabbedId: null }
    // A press outside an open picker closes it and does nothing else.
    if (base.picker) return { state: { ...base, picker: null } }
    if (y < 0 || (capacity > 0 && y >= capacity)) return { state: base }
    const rows = buildDesignRows(design, { collapsed: base.collapsed, selectedId: base.selectedId, run: context.run })
    const top = scrollTop(base.top, layoutCanvas(rows, null), capacity)
    const row = rows[top + y]
    if (!row || row.kind === 'agent') return { state: base }
    // The unmapped group only opens and closes; so does every row while a run is in progress.
    if (row.kind === 'group' || (context.locked && row.kind === 'node')) {
      return { state: { ...base, selectedId: row.id }, post: { kind: 'toggleRun', id: row.id } }
    }
    if (context.locked) return { state: base, post: { kind: 'locked' } }

    const result = (next: CanvasState): CanvasResult =>
      row.id === state.selectedId ? { state: next } : { state: next, post: { kind: 'select', id: row.kind === 'add' ? null : row.id } }
    const picked: CanvasState = { ...base, selectedId: row.id }
    if (row.kind === 'add') return result(openPicker(picked, rows, false, design))
    // The glyph (and the cell after it) of a container folds and unfolds it.
    if (row.container && x >= row.rail.length && x <= row.rail.length + 1) {
      const collapsed = row.collapsed ? base.collapsed.filter(id => id !== row.id) : [...base.collapsed, row.id]
      return result({ ...picked, collapsed })
    }
    return result({ ...picked, drag: { id: row.id, downX: x, downY: y, x, y, top, active: false, settling: null } })
  }

  const { drag } = state
  // Crossing the region's edge changes nothing: the instance holds the pointer until `up`.
  if (!drag || drag.settling || input.event === 'enter' || input.event === 'leave') return { state }
  const held: DragState = { ...drag, x, y, active: drag.active || y !== drag.downY }
  if (input.event === 'move') return held.x === drag.x && held.y === drag.y ? { state } : { state: { ...state, drag: held } }

  // up: a click was settled at `down`; a drag commits with one move, or cancels.
  const dropped: CanvasState = { ...state, drag: null }
  if (!held.active) return { state: dropped }
  const view = dragView(design, { drag: held, collapsed: state.collapsed }, { capacity })
  if (!view || !view.target) return { state: dropped }
  const { lifted, target } = view
  const from: Place = lifted.parentId === undefined ? { index: lifted.index } : { parentId: lifted.parentId, index: lifted.index }
  if (samePlace(from, target.place)) return { state: dropped }
  return { state: { ...state, drag: { ...held, settling: target } }, post: { kind: 'move', id: drag.id, to: target.place } }
}

// ---------------------------------------------------------------------------
// Layout: rows plus the open picker, and the window that fits the region

export type CanvasLine =
  | { kind: 'row'; row: DesignRow }
  | { kind: 'picker'; rail: string; query: string }
  | { kind: 'match'; rail: string; type: NodeType; glyph: string; name: string; hint: string; active: boolean }
  | { kind: 'empty'; rail: string }
  /** The dragged row, in the gap its drop would fill, indented for `depth`. */
  | { kind: 'lifted'; row: DesignRow; rail: string }
  /** A line no row is on while rows slide. */
  | { kind: 'blank' }

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

// ---------------------------------------------------------------------------
// One row's cells: what fits a width, and what gives way when it does not

const TYPE_COLUMN_MIN = 26
const TYPE_COLUMN_MAX = 44
// The run overlay's columns, right of the type: a small bar, settled/total, tokens.
const TYPE_WIDTH = 20
const COUNT_WIDTH = 7
const TOKEN_WIDTH = 7
/** Below this width the bar is left out. */
export const BAR_MIN_COLUMNS = 72
/** A type name is cut no shorter than this; with less room it is left out. */
const TYPE_CLIP_MIN = 6
/** A title is cut no shorter than this while a badge still stands beside it. */
const TITLE_MIN = 8

/** The texts of one row, left to right. With a run, `name` to `type` fill the width left of the run's columns exactly. */
export type RowCells = {
  /** `id  title` (the title alone for a group or an agent), cut to fit as a last resort. */
  name: string
  /** With its leading spaces; '' when there is none or no room. */
  badge: string
  fold: string
  lint: string
  /** The gap and the type name. */
  type: string
  /** The bar and the space after it; '' below BAR_MIN_COLUMNS. */
  bar: string
  counts: string
  tokens: string
  note: string
}

/**
 * Fits a row into `columns`. As the width shrinks, in this order: the bar goes, a long
 * badge is cut (and goes when the title would be cut for it), the type name is cut and
 * then left out, the title is cut. Counts and
 * tokens keep their width and end at the row's last cell.
 */
export function rowCells(row: DesignRow, columns: number): RowCells {
  const { run } = row
  const width = columns > 0 ? columns : 80
  const withBar = run !== undefined && width >= BAR_MIN_COLUMNS
  const right = run ? (withBar ? MINI_BAR + 1 : 0) + COUNT_WIDTH + TOKEN_WIDTH : 0
  // With a run, the type column moves left to leave room for the run's columns.
  const typeColumn = Math.max(TYPE_COLUMN_MIN, Math.min(TYPE_COLUMN_MAX, width - (run ? TYPE_WIDTH + right + 1 : 18)))
  const total = run ? Math.min(width, typeColumn + TYPE_WIDTH + right) : width
  const blank = { badge: '', fold: '', lint: '', type: '', bar: '', counts: '', note: '' }

  if (row.kind === 'agent') {
    // Tokens end where the node rows' tokens end.
    const room = Math.max(4, total - TOKEN_WIDTH - row.rail.length - 2)
    return { ...blank, name: clip(row.title, room).padEnd(room), tokens: (run?.tokens ?? '').padStart(TOKEN_WIDTH) }
  }

  const middle = Math.max(0, total - right)
  const fold = row.collapsed ? ` [+${row.hidden}]` : ''
  const lint = row.lint ? ` ${GLYPH.lint}` : ''
  const fixed = row.rail.length + 2 + fold.length + lint.length
  // The unmapped group is no node: it has a name and no id.
  let name = row.kind === 'group' ? row.title : `${row.id}  ${row.title}`
  let badge = row.badge
  const lead = (): number => (badge === '' ? 0 : badge.length + 2)
  // With a run, a cell stays free between the type and the run's columns.
  const after = run ? 1 : 0

  // A long badge is cut before the type gives way; a short one (a count) never is.
  const spare = middle - 2 - fixed - name.length - Math.min(row.typeName.length, TYPE_WIDTH) - after
  if (badge.length > BADGE_SHORT && lead() > spare) badge = clip(badge, Math.max(BADGE_SHORT, spare - 2))
  // The title is cut last: a badge already cut goes before that, and so does a short one
  // that would leave the title almost nothing.
  const reserve = run ? 2 : 0
  const titleRoom = (): number => middle - reserve - fixed - lead()
  if (name.length > titleRoom()) {
    if (row.badge.length > BADGE_SHORT || titleRoom() < TITLE_MIN) badge = ''
    name = clip(name, Math.max(1, titleRoom()))
  }

  const used = fixed + name.length + lead()
  const left = Math.max(0, middle - used)
  const gap = Math.min(left, Math.max(2, typeColumn - used))
  const room = left - gap - after
  const typeName = row.typeName.length <= room ? row.typeName : room >= TYPE_CLIP_MIN ? `${row.typeName.slice(0, room - 1)}…` : ''
  const type = `${' '.repeat(gap)}${typeName}`
  const live = run !== undefined && run.note === ''

  return {
    name,
    badge: badge === '' ? '' : `  ${badge}`,
    fold,
    lint,
    type: run ? type.padEnd(left) : typeName === '' ? '' : type,
    bar: live && withBar ? `${run.bar.padEnd(MINI_BAR)} ` : '',
    counts: live ? run.counts.padStart(COUNT_WIDTH) : '',
    tokens: live ? run.tokens.padStart(TOKEN_WIDTH) : '',
    note: run?.note ?? '',
  }
}

// ---------------------------------------------------------------------------
// The whole view: what canvas.tsx draws for a state, and its motion

function liftedRail(depth: number): string {
  return depth <= 0 ? '' : `${GLYPH.rail}  ${' '.repeat(INDENT * (depth - 1))}${GLYPH.railBranch} `
}

export type CanvasView = {
  rows: DesignRow[]
  layout: CanvasLayout
  /** The first line of the window to ask `windowCanvas` for. */
  top: number
  /** The row the pointer holds: it follows the pointer and never tweens. */
  pinned: string | null
  /** Whether a drag is in flight, and whether a drop now would move the row. */
  dragging: 'valid' | 'invalid' | null
}

/** The lines for a state: the rows and picker, or, during a drag, the rest of the rows with the lifted row in its gap. */
export function viewCanvas(state: CanvasState, props: Pick<CanvasProps, 'design' | 'lints'> & Partial<Pick<CanvasProps, 'run' | 'grabbedId'>>, capacity: number = 0): CanvasView {
  const drag = dragView(props.design, state, { lints: props.lints, capacity })
  if (drag && drag.target) {
    const { slot, depth } = drag.target
    const lines: CanvasLine[] = drag.rest.map(row => ({ kind: 'row', row }))
    lines.splice(slot, 0, { kind: 'lifted', row: drag.lifted, rail: liftedRail(depth) })
    return { rows: drag.rest, layout: { lines, focus: slot, focusEnd: slot }, top: state.drag?.top ?? state.top, pinned: drag.lifted.id, dragging: 'valid' }
  }
  // Over an invalid place the rows stand as they are, the dragged one lit where it came from.
  const rows = buildDesignRows(props.design, {
    selectedId: state.selectedId,
    grabbedId: drag ? drag.lifted.id : (state.grabbedId ?? props.grabbedId ?? null),
    collapsed: state.collapsed,
    lints: props.lints,
    run: props.run,
    // The picker's place is counted in rows without agent lines.
    agentRows: state.picker === null,
  })
  return { rows, layout: layoutCanvas(rows, state.picker), top: drag ? (state.drag?.top ?? state.top) : state.top, pinned: null, dragging: drag ? 'invalid' : null }
}

/** The line each row belongs on: what the motion animator compares between drawings. */
export function lineYs(lines: readonly CanvasLine[]): Record<string, number> {
  const ys: Record<string, number> = {}
  for (const [at, line] of lines.entries()) if (line.kind === 'row' || line.kind === 'lifted') ys[line.row.id] = at
  return ys
}

/**
 * Takes the lines about to be drawn into the motion state: rows whose line
 * changed start sliding. Returns `state` itself when nothing moved.
 */
export function moveCanvas(state: CanvasState, view: Pick<CanvasView, 'layout' | 'pinned'>): CanvasState {
  const motion = stepMotion(state.motion, lineYs(view.layout.lines), state.clock, view.pinned)
  return motion === state.motion ? state : { ...state, motion }
}

/** Whether rows are sliding. */
export function canvasMoving(state: Pick<CanvasState, 'motion' | 'clock'>): boolean {
  return motionActive(state.motion, state.clock)
}

/** Whether the ticker should run: rows are sliding, or a drag is held at an edge that scrolls. */
export function canvasTicking(state: CanvasState, context: Pick<CanvasContext, 'design' | 'capacity'>): boolean {
  return canvasMoving(state) || dragScroll(state, context.design, context.capacity ?? 0) !== 0
}

/**
 * One tick of the shared ticker: the clock moves a frame, and a drag held at an edge
 * scrolls a row every DRAG_SCROLL_MS. When every row has arrived and nothing scrolls,
 * `ticking` goes false and the clock rests.
 */
export function tickCanvas(state: CanvasState, context?: Pick<CanvasContext, 'design' | 'capacity'>): CanvasState {
  const clock = state.clock + FRAME_MS
  const way = context ? dragScroll(state, context.design, context.capacity ?? 0) : 0
  const drag = state.drag !== null && way !== 0 && clock % DRAG_SCROLL_MS === 0 ? { ...state.drag, top: state.drag.top + way } : state.drag
  const motion = settleMotion(state.motion, clock)
  if (way !== 0 || motionActive(motion, clock)) return { ...state, drag, clock, motion }
  return { ...state, clock: 0, motion: { ys: motion.ys, tweens: {} }, ticking: false }
}

/** The layout with every sliding row on the line it is passing; emptied lines are blank. */
export function animateLayout(layout: CanvasLayout, state: Pick<CanvasState, 'motion' | 'clock'>): CanvasLayout {
  const offsets = rowOffsets(state.motion, state.clock)
  if (Object.keys(offsets).length === 0) return layout
  const placed = placeRows(layout.lines, line => (line.kind === 'row' ? (offsets[line.row.id] ?? 0) : 0))
  return { ...layout, lines: placed.map(line => line ?? { kind: 'blank' }) }
}

/**
 * The dim line under the canvas, only for what the toolbar does not say: a drag
 * in flight and the canvas's own picker. '' otherwise: the toolbar shows the keys.
 */
export function hintLine(state: Pick<CanvasState, 'picker'>, dragging: CanvasView['dragging'] = null): string {
  if (dragging === 'valid') return 'release to drop · left/right picks the depth · release below the rows to cancel'
  if (dragging === 'invalid') return 'no place here: release to cancel'
  if (state.picker) return 'type to filter · ↑/↓ choose · enter add · backspace on empty cancels'
  return ''
}
