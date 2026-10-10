// What the design pane does to its state, as pure steps: opening a design,
// starting one from a template, and applying a canvas message or an inspector
// edit. The hooks module reads state, calls one of these, writes state and
// saves. Pure TypeScript: no `$`, no engine imports.

import type { AgentStatus, NodeRun, RunState } from '../run/events'
import { UNMAPPED_ID, cappedLines, chooseOrientation, clip, expandRows, layoutBoard, navigate, wrapText } from '../ui/board-layout'
import type { Orientation } from '../ui/board-layout'
import type { BoardMessage, BoardOp, BoardProps } from '../ui/board-model'
import type { RunOverlay } from '../ui/board-paint'
import { lint } from './lints'
import { canHoldChildren, emptyDesign, findNode, flatten, parseDesign, toKebab } from './model'
import type { Design, NodeType } from './model'
import { addNode, moveBy, moveNode, removeNode, updateNode } from './ops'
import type { NodePatch, OpResult, Place } from './ops'
import { fuzzy } from './teach'
import { TEMPLATES } from './templates'

export const DESIGN_PANE_ID = 'conductor-design'
export const DESIGN_PANE_TITLE = 'Conductor design'
export const DESIGN_DIR = '.claude/workflow-designs'
export const BLANK_TEMPLATE_ID = 'blank'
export const DEFAULT_DESIGN_NAME = 'untitled'
/** Block types the add picker offers at once: all of them. */
export const PICKER_MAX = 12

/**
 * `closed`: nothing opened yet. `pick`: no saved design, choosing a template.
 * `ready`: a design is loaded. `error`: the saved file could not be read.
 */
export type DesignStatus = 'closed' | 'pick' | 'ready' | 'error'

export type DesignUi = {
  /** The file's name (kebab-case, no extension). */
  name: string
  status: DesignStatus
  /** Why the saved file was refused (`error`). */
  error: string | null
  /** A node id, or UNMAPPED_ID while a run has agents no block claims. The board draws it from props. */
  selectedId: string | null
  showCard: boolean
  /** The last refused edit or failed save, shown in the pane until the next edit. */
  notice: string | null
  /** The node the keyboard's grab holds: arrows move it instead of the selection. */
  grabbedId: string | null
  /** The add picker: where the block will go and what was typed. */
  picker: { at: Place; query: string } | null
  /** The container a first delete asked about; a second one on it removes it. */
  confirmId: string | null
  /** Compact mode: every card that is not selected is one row. */
  compact: boolean
  /** The selected block's fields are being typed in: an inline pane shows them only meanwhile. */
  editing: boolean
}

/** What stands in the way of an edit, and what an arrow key needs to know. */
export type RunContext = {
  /** A run of this design is in progress: every edit is refused. */
  locked?: boolean
  /** The run laid over this design, when there is one. */
  run?: RunState
  /** How the board is drawn: what the arrows mean. */
  orientation?: Orientation
}

export const LOCK_NOTICE = 'run in progress · editing locked'
/** Shown while a run is active: the handoff left the keyboard in the prompt, and the command reopens the pane with it. */
export const RUN_KEYS_HINT = 'keys in the prompt? /conductor brings them back here'

/** What a toolbar key asks for. The board sends the same as `key` messages. */
export type ToolbarOp = BoardOp

export type Step = { design: Design | null; ui: DesignUi; changed: boolean }

export function initialUi(): DesignUi {
  return { name: DEFAULT_DESIGN_NAME, status: 'closed', error: null, selectedId: null, showCard: false, notice: null, grabbedId: null, picker: null, confirmId: null, compact: false, editing: false }
}

/** Whether `run` is laid over the design the pane shows: it was started from that design and has begun. */
export function overlaysDesign(run: RunState, runDesign: string | null, ui: DesignUi): boolean {
  return runDesign !== null && runDesign === ui.name && ui.status === 'ready' && run.status !== 'idle'
}

/** The run as the board takes it: every node's counts, and the sum of the agents no block claims. */
export function runOverlay(run: RunState, now = 0): RunOverlay {
  let unmapped: NodeRun | null = null
  if (run.unmapped.length > 0) {
    // Agents the state no longer holds still count, as done.
    const sum: NodeRun = { total: run.unmapped.length, running: 0, done: 0, failed: 0, tokens: 0 }
    for (const id of run.unmapped) {
      const agent = run.agents[id]
      sum[agent?.status ?? 'done']++
      sum.tokens += agent?.tokens ?? 0
    }
    unmapped = sum
  }
  return { status: run.status, byNode: run.byNode, unmapped, now }
}

/** Agents listed in the inspector for one block; the rest are a count. */
export const AGENT_ROWS_MAX = 12

export type AgentLine = { agentId: string; title: string; status: AgentStatus; tokens: number }

const ORDER: Record<AgentStatus, number> = { failed: 0, running: 1, done: 2 }

/** The label without the node id it starts with: `n3: verify auth` → `verify auth`. */
export function agentTitle(agent: { label: string; agentId: string; nodeId?: string }): string {
  const label = agent.nodeId === undefined ? agent.label : agent.label.replace(/^n\d+\b[:\s]*/, '')
  return label.trim() || agent.agentId
}

/** The agents of one block (or, for UNMAPPED_ID, the ones no block claims): failures first, cut at AGENT_ROWS_MAX. */
export function agentsOf(run: RunState, id: string): { shown: AgentLine[]; rest: number } {
  const all = id === UNMAPPED_ID ? run.unmapped.map(one => run.agents[one]).filter(one => one !== undefined) : Object.values(run.agents).filter(agent => agent.nodeId === id)
  const sorted = [...all].sort((a, b) => ORDER[a.status] - ORDER[b.status])
  const shown = sorted.slice(0, AGENT_ROWS_MAX).map(agent => ({ agentId: agent.agentId, title: agentTitle(agent), status: agent.status, tokens: agent.tokens }))
  return { shown, rest: sorted.length - shown.length }
}

export function designName(args: string): string {
  return toKebab(args.trim() || DEFAULT_DESIGN_NAME)
}

/** The design's file under the project root. */
export function designFile(root: string, name: string): string {
  return `${root.replace(/\/+$/, '')}/${DESIGN_DIR}/${name}.json`
}

/** Opens `name`: `text` is the saved file's content, undefined when there is none. */
export function openDesign(name: string, text: string | undefined): Step {
  const ui: DesignUi = { ...initialUi(), name }
  if (text === undefined) return { design: null, ui: { ...ui, status: 'pick' }, changed: false }
  const parsed = parseDesign(text)
  if (!parsed.ok) return { design: null, ui: { ...ui, status: 'error', error: parsed.error }, changed: false }
  return { design: parsed.design, ui: { ...ui, status: 'ready', selectedId: parsed.design.nodes[0]?.id ?? null }, changed: false }
}

/** Starts the design from a template (or blank), named after the file. Only from the picker. */
export function startDesign(ui: DesignUi, templateId: string): Step {
  if (ui.status !== 'pick') return { design: null, ui, changed: false }
  const template = TEMPLATES.find(one => one.id === templateId)
  const design: Design = template ? { ...template.make(), name: ui.name } : emptyDesign(ui.name)
  return {
    design,
    ui: { ...ui, status: 'ready', error: null, notice: null, selectedId: design.nodes[0]?.id ?? null },
    changed: true,
  }
}

function settle(design: Design, ui: DesignUi, result: OpResult, selectedId: string | null): Step {
  if (result.error) return { design, ui: { ...ui, notice: result.error }, changed: false }
  const kept = selectedId !== null && findNode(result.design, selectedId) ? selectedId : null
  return { design: result.design, ui: { ...ui, selectedId: kept, notice: null }, changed: result.design !== design }
}

/** Applies one message from the board. A refused edit leaves the design as it was and sets `notice`. */
export function applyMessage(design: Design | null, ui: DesignUi, message: BoardMessage, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (message.kind === 'key') return applyOp(design, ui, message.op, { ...context, orientation: message.orientation })
  if (message.kind === 'select') {
    const strays = message.id === UNMAPPED_ID && (context.run?.unmapped.length ?? 0) > 0
    const selectedId = message.id !== null && (strays || findNode(design, message.id)) ? message.id : null
    return { design, ui: { ...ui, selectedId, confirmId: null, editing: ui.editing && selectedId === ui.selectedId, grabbedId: ui.grabbedId === selectedId ? ui.grabbedId : null }, changed: false }
  }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE, grabbedId: null, confirmId: null, picker: null, editing: false }, changed: false }
  switch (message.kind) {
    case 'edit': {
      const found = findNode(design, message.id) !== undefined
      return { design, ui: { ...ui, selectedId: found ? message.id : ui.selectedId, confirmId: null, editing: found || ui.editing }, changed: false }
    }
    case 'move':
      return settle(design, { ...ui, confirmId: null, grabbedId: null }, moveNode(design, message.id, message.to), message.id)
    case 'addAt': {
      const parent = message.at.parentId === undefined ? undefined : findNode(design, message.at.parentId)
      if (message.at.parentId !== undefined && (!parent || !canHoldChildren(parent.type))) {
        return { design, ui: { ...ui, notice: `${message.at.parentId} holds no blocks` }, changed: false }
      }
      return { design, ui: { ...ui, notice: null, confirmId: null, grabbedId: null, picker: { at: message.at, query: '' } }, changed: false }
    }
    case 'remove':
      if (!findNode(design, message.id)) return { design, ui: { ...ui, notice: `no node ${message.id}` }, changed: false }
      // The same two asks as the toolbar's delete, on the card that was clicked.
      return applyOp(design, { ...ui, selectedId: message.id, confirmId: ui.confirmId === message.id ? message.id : null }, 'remove', context)
  }
}

/** An inspector edit of one node. */
export function patchNode(design: Design | null, ui: DesignUi, id: string, patch: NodePatch, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE, editing: false }, changed: false }
  // A field was sent: the typing is over.
  return settle(design, { ...ui, editing: false }, updateNode(design, id, patch), ui.selectedId)
}

/** Where `a` puts a block: after the selection, as its sibling; at the end with none. */
export function placeAfter(design: Design, selectedId: string | null): Place {
  const row = selectedId === null ? undefined : flatten(design).find(one => one.node.id === selectedId)
  if (!row) return { index: design.nodes.length }
  return row.parentId === undefined ? { index: row.index + 1 } : { parentId: row.parentId, index: row.index + 1 }
}

function confirmText(design: Design, id: string): string {
  const inside = flatten({ ...design, nodes: findNode(design, id)?.children ?? [] }).length
  return `${id} holds ${inside} ${inside === 1 ? 'block' : 'blocks'}: delete again removes them all (no undo)`
}

/** The row the selection lands on once `id` and what it holds are gone: the next one, else the one before. */
function afterRemoval(design: Design, id: string): string | null {
  const rows = flatten(design)
  const at = rows.findIndex(row => row.node.id === id)
  const here = rows[at]
  if (!here) return null
  const next = rows.slice(at + 1).find(row => row.depth <= here.depth)
  return next?.node.id ?? rows[at - 1]?.node.id ?? null
}

/**
 * Applies one toolbar key (or the same key sent by the board). The arrows move the
 * selection along the flow and into and out of containers, as the board is drawn;
 * with a block grabbed they move the block, a step per press.
 */
export function applyOp(design: Design | null, ui: DesignUi, op: ToolbarOp, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  const calm: DesignUi = { ...ui, confirmId: null, notice: null, editing: false }
  const node = ui.selectedId === null ? undefined : findNode(design, ui.selectedId)
  if (context.locked && (op === 'grab' || op === 'addAfter' || op === 'addInside' || op === 'remove' || op === 'edit')) {
    return { design, ui: { ...calm, grabbedId: null, picker: null, notice: LOCK_NOTICE }, changed: false }
  }
  // Nothing is grabbed while locked, so the arrows move the selection.
  if (context.locked && calm.grabbedId !== null) calm.grabbedId = null
  switch (op) {
    case 'left':
    case 'right':
    case 'up':
    case 'down': {
      if (calm.grabbedId !== null && findNode(design, calm.grabbedId)) {
        return settle(design, calm, moveBy(design, calm.grabbedId, op === 'right' || op === 'down' ? 1 : -1), calm.grabbedId)
      }
      const selectedId = navigate(design, node?.id ?? null, op, context.orientation ?? 'horizontal')
      return { design, ui: { ...calm, grabbedId: null, selectedId }, changed: false }
    }
    case 'grab':
      if (!node) return { design, ui: { ...calm, grabbedId: null, notice: 'grab: select a block first' }, changed: false }
      return { design, ui: { ...calm, grabbedId: ui.grabbedId === node.id ? null : node.id }, changed: false }
    case 'addAfter':
      return { design, ui: { ...calm, grabbedId: null, picker: { at: placeAfter(design, node?.id ?? null), query: '' } }, changed: false }
    case 'addInside':
      if (!node) return { design, ui: { ...calm, grabbedId: null, picker: { at: { index: design.nodes.length }, query: '' } }, changed: false }
      if (!canHoldChildren(node.type)) return { design, ui: { ...calm, notice: `${node.id} is a ${node.type}: it holds no blocks; a adds after it` }, changed: false }
      return { design, ui: { ...calm, grabbedId: null, picker: { at: { parentId: node.id, index: node.children?.length ?? 0 }, query: '' } }, changed: false }
    case 'remove': {
      if (!node) return { design, ui: { ...calm, notice: 'delete: select a block first' }, changed: false }
      const held = node.children?.length ?? 0
      if (held > 0 && ui.confirmId !== node.id) {
        return { design, ui: { ...calm, confirmId: node.id, notice: confirmText(design, node.id) }, changed: false }
      }
      return settle(design, { ...calm, grabbedId: null }, removeNode(design, node.id), afterRemoval(design, node.id))
    }
    case 'edit':
      return { design, ui: node ? { ...calm, editing: true } : { ...calm, notice: 'edit: select a block first' }, changed: false }
    case 'compact':
      return { design, ui: { ...calm, compact: !ui.compact }, changed: false }
    case 'card':
      return { design, ui: { ...calm, showCard: !ui.showCard }, changed: false }
    case 'run':
      // The hooks module puts the handoff command in the prompt; nothing changes here.
      return { design, ui: calm, changed: false }
    case 'cancel':
      return { design, ui: { ...calm, grabbedId: null, picker: null }, changed: false }
  }
}

/** The picker's query as the person types it. */
export function typePicker(ui: DesignUi, query: string): DesignUi {
  return ui.picker ? { ...ui, picker: { ...ui.picker, query } } : ui
}

/** Adds from the open picker: `type` when a match was pressed, else the best match for `query`. */
export function pickBlock(design: Design | null, ui: DesignUi, choice: { type?: NodeType; query?: string }, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready' || !ui.picker) return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, picker: null, notice: LOCK_NOTICE }, changed: false }
  const type = choice.type ?? fuzzy(choice.query ?? ui.picker.query)[0]
  if (type === undefined) return { design, ui: { ...ui, notice: 'no block matches that' }, changed: false }
  const result = addNode(design, { type }, ui.picker.at)
  const step = settle(design, ui, result, result.id ?? ui.selectedId)
  return step.changed ? { ...step, ui: { ...step.ui, picker: null } } : step
}

const AGENT_LIKE: readonly NodeType[] = ['agent', 'verify', 'judge-panel', 'loop-until-dry', 'sweep', 'critic']

/** Which knob pickers the inspector shows for a type: the ones a script could honour there. */
export function knobFields(type: NodeType): { model: boolean; effort: boolean; isolation: boolean } {
  const spawns = AGENT_LIKE.includes(type)
  return { model: spawns, effort: spawns, isolation: type === 'agent' }
}

/** The Select value that clears a knob. */
export const INHERIT = 'inherit'
export const MODEL_CHOICES: readonly string[] = ['haiku', 'sonnet', 'opus']

/** How the board sits in the pane: which way it flows, how many rows its region takes, and the most it could have had. */
export type BoardView = { orientation: Orientation; columns: number; rows: number; room: number }

/** The room the board is sized for is never less than this: one leaf card and a row to add under it. */
export const BOARD_MIN_ROWS = 5

/** What of the pane's state shapes the board: the run over it, the selected block (its card is taller), compact mode. */
export type ViewState = {
  run?: RunOverlay
  selectedId?: string | null
  compact?: boolean
  /** The rows the flow's direction is decided by, when not `room`: an inline pane's board loses rows while a field is typed in, and must not turn for it. */
  turnRoom?: number
}

/**
 * Sizes the board for the pane. A docked pane flows top to bottom, an inline one
 * left to right (unless that cannot fit the rows and top to bottom fits the
 * columns). The region is as tall as the board until that passes `room`; from
 * there it is `room` tall and the board pans inside it. Which way it flows never
 * depends on the selection or on the inspector opening: neither may turn the board.
 */
export function boardView(design: Design, placement: 'dock' | 'inline', columns: number, room: number, state: ViewState = {}): BoardView {
  const options = { run: state.run !== undefined, unmapped: state.run?.unmapped?.total ?? 0, width: columns, compact: state.compact ?? false }
  const most = Math.max(BOARD_MIN_ROWS, room)
  const orientation = chooseOrientation(design, placement === 'dock' ? 'vertical' : 'horizontal', columns, Math.max(BOARD_MIN_ROWS, state.turnRoom ?? room), options)
  const { height } = layoutBoard(design, { ...options, orientation, selectedId: state.selectedId ?? null, noteRows: expandRows(orientation, most) })
  return { orientation, columns, rows: Math.min(most, height), room: most }
}

/** What the board gets as props. */
export function boardProps(design: Design, ui: DesignUi, view: BoardView, run?: RunOverlay): BoardProps {
  const locked = run?.status === 'running'
  const props: BoardProps = {
    design,
    lints: lint(design).map(one => ({ nodeId: one.nodeId, message: one.message })),
    mode: locked ? 'run' : 'design',
    selectedId: ui.selectedId,
    grabbedId: locked ? null : ui.grabbedId,
    confirmId: locked ? null : ui.confirmId,
    pickerAt: locked ? null : (ui.picker?.at ?? null),
    orientation: view.orientation,
    compact: ui.compact,
    columns: view.columns,
    rows: view.rows,
    room: view.room,
  }
  if (run) props.run = run
  return props
}

// ---------------------------------------------------------------------------
// The inspector's shape

/** The most rows of wrapped notes the inspector shows in a pane with `bodyRows` rows: the board keeps most of the height. */
export function inspectorNoteRows(bodyRows: number): number {
  return Math.max(2, Math.min(8, Math.floor(bodyRows / 6)))
}

/**
 * The notes as the inspector shows them under the one-line field: word-wrapped
 * to the pane, cut with a count of the lines left. Nothing when they fit the
 * field's own line.
 */
export function inspectorNotes(notes: string, columns: number, bodyRows: number): { lines: string[]; more: number } {
  const text = notes.trim()
  // The field's line holds `notes: ` and the text.
  if (text === '' || (text.length <= columns - 6 && !text.includes('\n'))) return { lines: [], more: 0 }
  return cappedLines(text, Math.max(8, columns - 2), inspectorNoteRows(bodyRows))
}

/**
 * Rows a focused notes field takes beyond its first: the engine wraps a focused
 * field's text, so the board gives up the rows the saved notes fill and a few
 * more to type into, within the same bound as the wrapped notes.
 */
export function inspectorTyping(notes: string, columns: number, bodyRows: number): number {
  // The field's line holds `notes: ` before the text and the submit hint after it.
  const rows = Math.max(1, wrapText(notes.trim(), Math.max(8, columns - 16)).length)
  return Math.min(inspectorNoteRows(bodyRows), rows - 1 + 2)
}

/** The inspector as one line, for an inline pane: the block, its title, and how its notes start. */
export function inspectorSummary(node: { id: string; type: string; title: string; notes?: string }, columns: number): string {
  const head = `${node.id} · ${node.type} · ${node.title}`
  const notes = (node.notes ?? '').replace(/\s+/g, ' ').trim()
  return clip(notes === '' ? head : `${head} — ${notes}`, Math.max(8, columns))
}

/** An inline pane has few rows: its inspector is one line until a field is being typed in. */
export function inspectorCollapsed(placement: 'dock' | 'inline', ui: Pick<DesignUi, 'editing'>): boolean {
  return placement === 'inline' && !ui.editing
}

/** How many rows a wrapping row of items takes: `widths` in cells, `gap` cells between two, `columns` to a row. */
export function wrapRows(widths: readonly number[], gap: number, columns: number): number {
  let rows = 1
  let used = 0
  for (const cells of widths) {
    if (used > 0 && used + gap + cells > columns) {
      rows++
      used = cells
    } else used += (used > 0 ? gap : 0) + cells
  }
  return rows
}
