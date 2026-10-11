// What the design pane does to its state, as pure steps: opening a design,
// starting one from a template, and applying a canvas message or an inspector
// edit. The hooks module reads state, calls one of these, writes state and
// saves. Pure TypeScript: no `$`, no engine imports.

import type { AgentStatus, NodeRun, RunState } from '../run/events'
import { UNMAPPED_ID, chooseOrientation, clip, expandRows, layoutBoard, navigate, wrapText } from '../ui/board-layout'
import type { Orientation } from '../ui/board-layout'
import { LEGEND } from '../ui/board-model'
import type { BoardMessage, BoardOp, BoardProps, Placement } from '../ui/board-model'
import type { RunOverlay } from '../ui/board-paint'
import { fmtDuration, fmtTokens } from '../ui/rail'
import { REDO_HINT, UNDO_HINT } from './history'
import { lint, lintIds } from './lints'
import { NODE_TYPES, canHoldChildren, emptyDesign, findNode, flatten, parseDesign, toKebab } from './model'
import type { Design, NodeType } from './model'
import { addNode, moveBy, moveNode, removeNode, retypeNode, updateNode } from './ops'
import type { NodePatch, OpResult, Place } from './ops'
import { TEACH, fuzzy, useWhen } from './teach'
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
  /** The help card's page, from 1; 0 while it is closed. `c` turns the page, and closes it after the last. */
  help: number
  /** The last refused edit or failed save, shown in the pane until the next edit. */
  notice: string | null
  /** The node the keyboard's grab holds: arrows move it instead of the selection. */
  grabbedId: string | null
  /** The add picker: where the block will go and what was typed. With `retypeId` it picks that block's type instead. */
  picker: { at: Place; query: string; retypeId?: string } | null
  /** The container a first delete asked about; a second one on it removes it. */
  confirmId: string | null
  /** Compact mode (every card that is not selected is one row), for each placement of the pane. Kept across designs. */
  compact: { dock: boolean; inline: boolean }
  /** The selected block's fields are being typed in: an inline pane shows them only meanwhile. */
  editing: boolean
  /** Blocks an edit from chat just touched: the board marks them for a moment. `seq` counts the edits; the ids are emptied once shown. */
  flash: { ids: string[]; seq: number } | null
  /** During a run the selection goes to the block that is running, until the person moves it themselves. */
  follow: boolean
  /** Claude was asked to draft this design and nothing has arrived yet: the empty board says so. */
  drafting: boolean
  /** The block just added: its title field opens empty (the default title shown dim), ready to be typed over. */
  freshId: string | null
  /** The block last selected in each design opened this session, by design name: reopening one goes back to it. */
  picks: Record<string, string>
  /** The design's description (its goal) is being typed in: its field is drawn under the header. */
  describing: boolean
  /** The results of a finished run were put away (by the first edit after it, or the key): the design is shown bare until the next run. */
  runCleared: boolean
  /** The saved designs, as read when the picker was opened: it lists them above the templates. */
  saved: SavedDesign[]
  /** A request (`r`, `v`) waits in the prompt box and the pane still holds the keyboard: no key is acted on until the person takes the keys to the prompt. */
  handed: boolean
}

/** A saved design as the picker and `/conductor list` name it. */
export type SavedDesign = { name: string; blocks: number; description: string }

/** Names kept for replays: such a design lives in the session only, is never saved and never listed. */
export const SCRATCH_PREFIX = 'replay-'

/** Whether a design of this name is written to disk: a replay's is not. */
export function isSaved(name: string): boolean {
  return !name.startsWith(SCRATCH_PREFIX)
}

/** A design file's content as a list entry; a file that does not read as a design is listed as such. */
export function savedDesign(name: string, text: string): SavedDesign {
  const parsed = parseDesign(text)
  return parsed.ok ? { name, blocks: flatten(parsed.design).length, description: parsed.design.description.replace(/\s+/g, ' ').trim() } : { name, blocks: -1, description: 'not a valid design file' }
}

/** `demo · 9 blocks · Review the current diff…`, one line of `/conductor list` and of the picker. */
export function savedLine(one: SavedDesign): string {
  const count = one.blocks < 0 ? 'unreadable' : `${one.blocks} ${one.blocks === 1 ? 'block' : 'blocks'}`
  return `${one.name} · ${count}${one.description === '' ? '' : ` · ${one.description}`}`
}

/** The name a new design gets when none was given: `untitled`, or the first `untitled-N` no saved design has. */
export function freeName(taken: readonly string[]): string {
  if (!taken.includes(DEFAULT_DESIGN_NAME)) return DEFAULT_DESIGN_NAME
  for (let n = 2; ; n++) if (!taken.includes(`${DEFAULT_DESIGN_NAME}-${n}`)) return `${DEFAULT_DESIGN_NAME}-${n}`
}

/** What the tracker is told of a design handed off: its name, its block ids in design order, and their titles (the status line names the running one). */
export function handoffOf(name: string, design: Design): { name: string; nodeIds: string[]; titles: Record<string, string> } {
  const rows = flatten(design)
  return { name, nodeIds: rows.map(row => row.node.id), titles: Object.fromEntries(rows.map(row => [row.node.id, row.node.title])) }
}

/** What stands in the way of an edit, and what an arrow key needs to know. */
export type RunContext = {
  /** A run of this design is in progress: every edit is refused. */
  locked?: boolean
  /** The run laid over this design, when there is one. */
  run?: RunState
  /** How the board is drawn: what the arrows mean. */
  orientation?: Orientation
  /** Where the pane sits: which of the two compact settings `z` flips. */
  placement?: Placement
}

export const LOCK_NOTICE = 'run in progress · editing locked'
/** Shown while a run is active and the pane does not hold the keyboard (the handoff left it in the prompt): the command reopens the pane with it. */
export const RUN_KEYS_HINT = 'type /conductor to use the keys here'

/** What a toolbar key asks for. The board sends the same as `key` messages. */
export type ToolbarOp = BoardOp

/** `what` says a change in words (`deleted n7 "verify"`): the undo history keeps it. */
export type Step = { design: Design | null; ui: DesignUi; changed: boolean; what?: string }

/** What is said while a request waits in the prompt box and the pane could not hand the keys over. */
export const HANDED_NOTICE = 'keys are off here while the prompt box holds text · Esc returns to the prompt'
/** The cue drawn while the pane does not hold the keyboard. */
export const KEYS_CUE = 'keys are in the prompt · click the board or /conductor'

/** A notice as it may follow the cue while the keys are in the prompt: without the key it ends on, and not at all when it names any other key. */
export function withoutKeys(text: string): string | null {
  // A request waiting in the prompt box speaks of the prompt's own Enter: true while the keys are there.
  if (/^(run|ask): /.test(text)) return text
  const bare = text.replace(new RegExp(` · (${UNDO_HINT}|${REDO_HINT})$`), '')
  return /(^|[\s(])[a-z]( again|: | [a-z] | adds )/.test(bare) || /\b(Enter|Esc|Tab)\b/i.test(bare) ? null : bare
}

/** Whether a design name is the one given when none was asked for: `untitled`, `untitled-2`. */
export function isDefaultName(name: string): boolean {
  return name === DEFAULT_DESIGN_NAME || new RegExp(`^${DEFAULT_DESIGN_NAME}-\\d+$`).test(name)
}

/** Whether a notice only informs (a change that was made, a request filled): drawn plain; anything else is a refusal or a question. */
export function noticeInforms(text: string): boolean {
  return text.endsWith(UNDO_HINT) || text.endsWith(REDO_HINT) || /^(run|ask|undone|redone): /.test(text) || text.startsWith('named ')
}

/** Inline the pane is short, so it starts compact; docked it has the height for whole cards. */
export const COMPACT_DEFAULT: DesignUi['compact'] = { dock: false, inline: true }

export function initialUi(): DesignUi {
  return {
    name: DEFAULT_DESIGN_NAME,
    status: 'closed',
    error: null,
    selectedId: null,
    help: 0,
    notice: null,
    grabbedId: null,
    picker: null,
    confirmId: null,
    compact: { ...COMPACT_DEFAULT },
    editing: false,
    flash: null,
    follow: true,
    drafting: false,
    freshId: null,
    picks: {},
    describing: false,
    runCleared: false,
    saved: [],
    handed: false,
  }
}

/** Whether the board is compact where the pane sits now. A state stored before the setting was per placement reads as the defaults. */
export function compactOf(ui: Pick<DesignUi, 'compact'>, placement: Placement): boolean {
  const held: unknown = ui.compact
  if (typeof held !== 'object' || held === null) return COMPACT_DEFAULT[placement]
  const set = (held as Partial<DesignUi['compact']>)[placement]
  return typeof set === 'boolean' ? set : COMPACT_DEFAULT[placement]
}

/**
 * What outlives the design shown: `next` (the state for another design) with the
 * compact settings of `previous` and the selection each design was left with.
 */
export function carryUi(previous: DesignUi, next: DesignUi): DesignUi {
  const picks = { ...(previous.picks ?? {}) }
  if (previous.status === 'ready' && previous.selectedId !== null && previous.selectedId !== UNMAPPED_ID) picks[previous.name] = previous.selectedId
  return { ...next, compact: { dock: compactOf(previous, 'dock'), inline: compactOf(previous, 'inline') }, picks }
}

/** Whether `run` is laid over the design the pane shows: it was started from that design and has begun. */
export function overlaysDesign(run: RunState, runDesign: string | null, ui: DesignUi): boolean {
  return runDesign !== null && runDesign === ui.name && ui.status === 'ready' && run.status !== 'idle' && ui.runCleared !== true
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

/**
 * Opens `name`: `text` is the saved file's content, undefined when there is none.
 * `previous` is the pane's state so far: its compact settings stay, and a design
 * opened before in this session comes back with the block it was left on.
 */
export function openDesign(name: string, text: string | undefined, previous?: DesignUi): Step {
  const ui: DesignUi = { ...(previous ? carryUi(previous, initialUi()) : initialUi()), name }
  if (text === undefined) return { design: null, ui: { ...ui, status: 'pick' }, changed: false }
  const parsed = parseDesign(text)
  if (!parsed.ok) return { design: null, ui: { ...ui, status: 'error', error: parsed.error }, changed: false }
  const left = ui.picks[name]
  const selectedId = left !== undefined && findNode(parsed.design, left) ? left : (parsed.design.nodes[0]?.id ?? null)
  return { design: parsed.design, ui: { ...ui, status: 'ready', selectedId }, changed: false }
}

/** Starts the design from a template (or blank), named after the file. Only from the picker. */
export function startDesign(ui: DesignUi, templateId: string): Step {
  if (ui.status !== 'pick') return { design: null, ui, changed: false }
  const template = TEMPLATES.find(one => one.id === templateId)
  const design: Design = template ? { ...template.make(), name: ui.name } : emptyDesign(ui.name)
  return {
    design,
    ui: { ...ui, status: 'ready', error: null, notice: null, selectedId: design.nodes[0]?.id ?? null },
    // Nothing is written until the first edit: a template looked at and left is not a saved design.
    changed: false,
  }
}

/** Where a block stands, in words: `after n4 (in n2)`, `first in n2`, `at the start`. */
export function whereIs(design: Design, id: string): string {
  const row = flatten(design).find(one => one.node.id === id)
  if (!row) return ''
  const parent = row.parentId === undefined ? undefined : findNode(design, row.parentId)
  const before = (parent ? (parent.children ?? []) : design.nodes)[row.index - 1]
  if (before) return parent ? `after ${before.id} (in ${parent.id})` : `after ${before.id}`
  return parent ? `first in ${parent.id}` : 'to the start'
}

function settle(design: Design, ui: DesignUi, result: OpResult, selectedId: string | null, what: string | ((after: Design) => string) = ''): Step {
  if (result.error) return { design, ui: { ...ui, notice: result.error }, changed: false }
  // An edit that leaves every block as it was (Enter on a field nobody changed) is no change: nothing to save, nothing to undo.
  const changed = result.design !== design && JSON.stringify(result.design) !== JSON.stringify(design)
  const after = changed ? result.design : design
  const kept = selectedId !== null && findNode(after, selectedId) ? selectedId : null
  const said = !changed ? '' : typeof what === 'string' ? what : what(after)
  // The first edit after a run puts its results away: nothing is edited under stale counts. (While it runs, no edit gets here.)
  // Every change is announced, and the announcement ends with the way back.
  return { design: after, ui: { ...ui, selectedId: kept, notice: said === '' ? null : `${said} · ${UNDO_HINT}`, runCleared: changed ? true : ui.runCleared }, changed, ...(said === '' ? {} : { what: said }) }
}

/**
 * The design as it was a step back or forward (`target`), shown: the selection stays where it can, else
 * goes to a block the step brought back, so the board scrolls to what changed.
 */
export function restoreDesign(design: Design | null, ui: DesignUi, target: Design, way: 'undo' | 'redo', what: string, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE }, changed: false }
  const had = new Set(flatten(design).map(row => row.node.id))
  const back = flatten(target).find(row => !had.has(row.node.id))?.node.id
  const selectedId = back ?? (ui.selectedId !== null && findNode(target, ui.selectedId) ? ui.selectedId : (target.nodes[0]?.id ?? null))
  const notice = way === 'undo' ? `undone: ${what} · ${REDO_HINT}` : `redone: ${what} · ${UNDO_HINT}`
  return { design: target, ui: { ...ui, selectedId, notice, grabbedId: null, confirmId: null, picker: null, editing: false, freshId: null, describing: false, runCleared: true }, changed: true }
}

/** What `u` or `y` says with nothing that way. */
export function nothingToRestore(ui: DesignUi, way: 'undo' | 'redo'): DesignUi {
  return { ...ui, confirmId: null, notice: way === 'undo' ? 'nothing to undo' : 'nothing to redo' }
}

/** Applies one message from the board. A refused edit leaves the design as it was and sets `notice`. */
export function applyMessage(design: Design | null, ui: DesignUi, message: BoardMessage, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (message.kind === 'key') return applyOp(design, ui, message.op, { ...context, orientation: message.orientation, placement: message.placement })
  // A press that asked for nothing: the hooks module only needed to hear of it (the click gave the board the keyboard).
  if (message.kind === 'touch') return { design, ui, changed: false }
  if (message.kind === 'select') {
    const strays = message.id === UNMAPPED_ID && (context.run?.unmapped.length ?? 0) > 0
    const selectedId = message.id !== null && (strays || findNode(design, message.id)) ? message.id : null
    const same = selectedId === ui.selectedId
    // The person chose a block: the selection stops following the run.
    return { design, ui: { ...ui, selectedId, follow: false, confirmId: null, describing: false, picker: null, notice: same ? ui.notice : null, editing: ui.editing && same, freshId: same ? ui.freshId : null, grabbedId: ui.grabbedId === selectedId ? ui.grabbedId : null }, changed: false }
  }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE, grabbedId: null, confirmId: null, picker: null, editing: false, freshId: null }, changed: false }
  switch (message.kind) {
    case 'edit': {
      const found = findNode(design, message.id) !== undefined
      return { design, ui: { ...ui, selectedId: found ? message.id : ui.selectedId, confirmId: null, editing: found || ui.editing }, changed: false }
    }
    case 'move':
      return settle(design, { ...ui, confirmId: null, grabbedId: null }, moveNode(design, message.id, message.to), message.id, after => `moved ${message.id} ${whereIs(after, message.id)}`)
    case 'addAt': {
      const parent = message.at.parentId === undefined ? undefined : findNode(design, message.at.parentId)
      if (message.at.parentId !== undefined && (!parent || !canHoldChildren(parent.type))) {
        return { design, ui: { ...ui, notice: `${message.at.parentId} holds no blocks` }, changed: false }
      }
      return { design, ui: { ...ui, notice: null, confirmId: null, grabbedId: null, picker: { at: message.at, query: '' } }, changed: false }
    }
    case 'remove':
      if (!findNode(design, message.id)) return { design, ui: { ...ui, notice: `no block ${message.id}` }, changed: false }
      // The same two asks as the toolbar's delete, on the card that was clicked.
      return applyOp(design, { ...ui, selectedId: message.id, confirmId: ui.confirmId === message.id ? message.id : null }, 'remove', context)
  }
}

/** An inspector edit of one node. */
export function patchNode(design: Design | null, ui: DesignUi, id: string, patch: NodePatch, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE, editing: false, freshId: null }, changed: false }
  // A field was sent: the typing is over.
  const fields = [...(patch.title !== undefined ? ['title'] : []), ...('notes' in patch ? ['notes'] : []), ...Object.keys(patch.knobs ?? {})]
  return settle(design, { ...ui, editing: false, freshId: null }, updateNode(design, id, patch), ui.selectedId, `${id} changed${fields.length > 0 && fields.length <= 3 ? `: ${fields.join(', ')}` : ''}`)
}

/** The inspector's type picker: the block becomes another type, keeping its title, notes, knobs and what it holds. */
export function retypeBlock(design: Design | null, ui: DesignUi, id: string, type: NodeType, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE, editing: false, freshId: null }, changed: false }
  const node = findNode(design, id)
  const retyped = retypeNode(design, id, type)
  // A block still called after its old type (the title it was added with) takes the new type's name.
  const renamed = !retyped.error && node && node.type !== type && node.title === node.type ? updateNode(retyped.design, id, { title: type }) : retyped
  return settle(design, { ...ui, editing: false, freshId: null, picker: null }, renamed, ui.selectedId, `${id} is now ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`)
}

/** The types a block may become: all of them, or only containers while it holds blocks. */
export function retypeChoices(node: { type: NodeType; children?: readonly unknown[] }): NodeType[] {
  return (node.children?.length ?? 0) > 0 ? NODE_TYPES.filter(type => canHoldChildren(type)) : [...NODE_TYPES]
}

/** The design's description as typed in its field under the header. */
export function describeDesign(design: Design | null, ui: DesignUi, text: string, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE, describing: false }, changed: false }
  const description = text.replace(/\s+/g, ' ').trim()
  const calm: DesignUi = { ...ui, describing: false, notice: null }
  return description === design.description ? { design, ui: calm, changed: false } : { design: { ...design, description }, ui: { ...calm, notice: `goal changed · ${UNDO_HINT}`, runCleared: true }, changed: true, what: 'goal changed' }
}

/**
 * Where the add picker's block will go, in words: `after n4 (in n2)`, `first in n2`,
 * `at the end`. The place is a list and an index; the words name the neighbour.
 */
export function placeLabel(design: Design, at: Place): string {
  const parent = at.parentId === undefined ? undefined : findNode(design, at.parentId)
  const list = parent ? (parent.children ?? []) : design.nodes
  const before = list[at.index - 1]
  if (before) return parent ? `after ${before.id} (in ${parent.id})` : at.index >= list.length ? `after ${before.id} (at the end)` : `after ${before.id}`
  return parent ? `first in ${parent.id}` : list.length === 0 ? 'the first block' : 'at the start'
}

/** The block the lint key goes to: the next one with a lint after the selection, in the design's order, round again from the top. Null with no lints. */
export function nextLint(design: Design, selectedId: string | null): string | null {
  const marked = new Set(lintIds(lint(design)))
  const rows = flatten(design).map(row => row.node.id)
  const from = selectedId === null ? -1 : rows.indexOf(selectedId)
  return [...rows.slice(from + 1), ...rows.slice(0, from + 1)].find(id => marked.has(id)) ?? null
}

/** Where `a` puts a block: after the selection, as its sibling; at the end with none. */
export function placeAfter(design: Design, selectedId: string | null): Place {
  const row = selectedId === null ? undefined : flatten(design).find(one => one.node.id === selectedId)
  if (!row) return { index: design.nodes.length }
  return row.parentId === undefined ? { index: row.index + 1 } : { parentId: row.parentId, index: row.index + 1 }
}

function confirmText(design: Design, id: string): string {
  const inside = flatten({ ...design, nodes: findNode(design, id)?.children ?? [] }).length
  return `${id} holds ${inside} ${inside === 1 ? 'block' : 'blocks'}: x again deletes them all (u undoes it)`
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
  // A request waits in the prompt box: a key typed now is meant for it. Nothing is done, and the way out is said.
  if (ui.handed) return { design, ui: ui.notice === HANDED_NOTICE ? ui : { ...ui, notice: HANDED_NOTICE }, changed: false }
  const calm: DesignUi = { ...ui, confirmId: null, notice: null, editing: false, freshId: null, describing: false, picker: null }
  const placement = context.placement ?? 'dock'
  const node = ui.selectedId === null ? undefined : findNode(design, ui.selectedId)
  if (context.locked && (op === 'grab' || op === 'addAfter' || op === 'addInside' || op === 'remove' || op === 'edit' || op === 'describe' || op === 'undo' || op === 'redo')) {
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
        const id = calm.grabbedId
        return settle(design, calm, moveBy(design, id, op === 'right' || op === 'down' ? 1 : -1), id, after => `moved ${id} ${whereIs(after, id)}`)
      }
      const selectedId = navigate(design, node?.id ?? null, op, context.orientation ?? 'horizontal', compactOf(ui, placement))
      // The person moved the selection: it stops following the run.
      return { design, ui: { ...calm, grabbedId: null, selectedId, follow: false }, changed: false }
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
      // A single block goes at once: `u` brings it back.
      return settle(design, { ...calm, grabbedId: null }, removeNode(design, node.id), afterRemoval(design, node.id), `deleted ${node.id} "${clip(node.title, 24)}"${held > 0 ? ` and what it held` : ''}`)
    }
    case 'undo':
    case 'redo':
      // The hooks module holds the history: it answers these before they get here.
      return { design, ui: calm, changed: false }
    case 'edit':
      return { design, ui: node ? { ...calm, editing: true } : { ...calm, notice: 'edit: select a block first' }, changed: false }
    case 'compact':
      // For the placement the pane is in: the other one keeps its own setting.
      return { design, ui: { ...calm, compact: { dock: compactOf(ui, 'dock'), inline: compactOf(ui, 'inline'), [placement]: !compactOf(ui, placement) } }, changed: false }
    case 'card':
      // Page by page, then closed.
      return { design, ui: { ...calm, help: ((ui.help ?? 0) + 1) % (HELP_PAGES + 1) }, changed: false }
    case 'run':
    case 'review':
      // The hooks module puts the request in the prompt box; nothing changes here.
      return { design, ui: calm, changed: false }
    case 'describe':
      // The description's field opens under the header; the hooks module moves the ring to it.
      return { design, ui: { ...calm, grabbedId: null, describing: true }, changed: false }
    case 'nextLint': {
      const id = nextLint(design, node?.id ?? null)
      if (id === null) return { design, ui: { ...calm, notice: 'no lints: nothing to go to' }, changed: false }
      return { design, ui: { ...calm, grabbedId: null, selectedId: id, follow: false }, changed: false }
    }
    case 'clearRun':
      // The results of a run that is over are put away; while it runs they stay.
      return { design, ui: context.locked ? { ...calm, notice: LOCK_NOTICE } : { ...calm, runCleared: true }, changed: false }
    case 'cancel':
      return { design, ui: { ...calm, grabbedId: null, picker: null }, changed: false }
  }
}

/** The picker's query as the person types it. */
/** Opens the picker on a block's type: the same list as adding, narrowed to what the block may become. */
export function openRetype(design: Design | null, ui: DesignUi, id: string, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready' || !findNode(design, id)) return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE }, changed: false }
  return { design, ui: { ...ui, notice: null, confirmId: null, grabbedId: null, editing: false, freshId: null, describing: false, picker: { at: { index: 0 }, query: '', retypeId: id } }, changed: false }
}

export function typePicker(ui: DesignUi, query: string): DesignUi {
  return ui.picker ? { ...ui, picker: { ...ui.picker, query } } : ui
}

/** Adds from the open picker: `type` when a match was pressed, else the best match for `query`. */
export function pickBlock(design: Design | null, ui: DesignUi, choice: { type?: NodeType; query?: string }, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready' || !ui.picker) return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, picker: null, notice: LOCK_NOTICE }, changed: false }
  const retypeId = ui.picker.retypeId
  const allowed = retypeId === undefined ? undefined : retypeChoices(findNode(design, retypeId) ?? { type: 'agent' })
  const type = choice.type ?? fuzzy(choice.query ?? ui.picker.query).find(one => allowed === undefined || allowed.includes(one))
  if (type === undefined) return { design, ui: { ...ui, notice: 'no block matches that' }, changed: false }
  if (retypeId !== undefined) return retypeBlock(design, ui, retypeId, type, context)
  const result = addNode(design, { type }, ui.picker.at)
  const step = settle(design, ui, result, result.id ?? ui.selectedId, after => `added ${result.id ?? ''} ${type} ${placeLabel(after, ui.picker?.at ?? { index: 0 }).replace(/ \(at the end\)$/, '')}`)
  // The new block is selected and its title is the next thing typed.
  return step.changed ? { ...step, ui: { ...step.ui, picker: null, editing: true, freshId: result.id ?? null, drafting: false } } : step
}

/** The Select value that clears a knob. */
export const INHERIT = 'inherit'
export const MODEL_CHOICES: readonly string[] = ['haiku', 'sonnet', 'opus']
/** The votes the picker offers; a count set elsewhere is added to them. */
export const VOTE_CHOICES: readonly number[] = [1, 2, 3, 5, 7]
/** The knobs typed as text, each in a field of its own; the rest are pickers. */
export const TEXT_KNOBS = ['prompt', 'fanout', 'until', 'schema', 'agentType'] as const
export type TextKnob = (typeof TEXT_KNOBS)[number]

/** How the board sits in the pane: which way it flows, how many rows its region takes, and the most it could have had. */
export type BoardView = { orientation: Orientation; columns: number; rows: number; room: number; /** The rows the whole board takes, in view or not. */ height: number }

/** The room the board is sized for is never less than this: one leaf card and a row to add under it. */
export const BOARD_MIN_ROWS = 5

/** What of the pane's state shapes the board: the run over it, the selected block (its card is taller), compact mode. */
export type ViewState = {
  run?: RunOverlay
  selectedId?: string | null
  compact?: boolean
  /** The rows the flow's direction is decided by, when not `room`: an inline pane's board loses rows while a field is typed in, and must not turn for it. */
  turnRoom?: number
  /** The region takes all of `room` whatever the board's height: an inline pane then keeps its height as the selection moves. */
  fill?: boolean
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
  // The caller keeps `room` at BOARD_MIN_ROWS or more, except under an inline help card, where three rows hold the place.
  const most = Math.max(3, room)
  // Decided for the compact board, whatever `z` is set to: switching compact must not turn the flow.
  const orientation = chooseOrientation(design, placement === 'dock' ? 'vertical' : 'horizontal', columns, Math.max(BOARD_MIN_ROWS, state.turnRoom ?? room), { ...options, compact: true })
  const { height } = layoutBoard(design, { ...options, orientation, selectedId: state.selectedId ?? null, noteRows: expandRows(orientation, most) })
  return { orientation, columns, rows: state.fill ? most : Math.min(most, height), room: most, height }
}

/** What an empty board says while Claude drafts the design. */
export const DRAFTING_NOTE = 'Claude is drafting this design: blocks appear here as they are written'

/** What the board gets as props. */
export function boardProps(design: Design, ui: DesignUi, view: BoardView, run?: RunOverlay, placement: Placement = 'dock'): BoardProps {
  const locked = run?.status === 'running'
  const props: BoardProps = {
    design,
    lints: lint(design).map(one => ({ nodeId: one.nodeId, message: one.message })),
    mode: locked ? 'run' : 'design',
    selectedId: ui.selectedId,
    grabbedId: locked ? null : ui.grabbedId,
    confirmId: locked ? null : ui.confirmId,
    pickerAt: locked || ui.picker?.retypeId !== undefined ? null : (ui.picker?.at ?? null),
    orientation: view.orientation,
    placement,
    compact: compactOf(ui, placement),
    columns: view.columns,
    rows: view.rows,
    room: view.room,
  }
  if (ui.flash && ui.flash.ids.length > 0) props.flash = ui.flash
  if (ui.handed) props.hold = true
  if (ui.drafting && design.nodes.length === 0) props.emptyNote = DRAFTING_NOTE
  if (run) props.run = run
  return props
}

// ---------------------------------------------------------------------------
// The inspector's shape

/** The most rows a field being typed in may take beyond its first, in a pane with `bodyRows` rows: the board keeps most of the height. */
export function inspectorNoteRows(bodyRows: number): number {
  return Math.max(2, Math.min(8, Math.floor(bodyRows / 6)))
}

/**
 * Rows a focused field takes beyond its first: the engine wraps a focused
 * field's text, so the board gives up the rows the saved text fills and a few
 * more to type into. `text` is the longest text of the block's fields.
 */
export function inspectorTyping(text: string, columns: number, bodyRows: number): number {
  // The field's line holds its label before the text and the submit hint after it.
  const rows = Math.max(1, wrapText(text.trim(), Math.max(8, columns - 16)).length)
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

// ---------------------------------------------------------------------------
// The help card, the run's summary, following the run, the dock's width

/** The help card's pages: the selected block's type, the board's marks, the mouse and the keys. */
export const HELP_PAGES = 3

/** One page of the help card, as lines no wider than `columns`. `page` counts from 1. */
export function helpPage(page: number, type: NodeType | undefined, file: string, columns: number): string[] {
  const marks = LEGEND.slice(0, 6)
  const hands = LEGEND.slice(6)
  const lines =
    page === 1
      ? type
        ? [`${TEACH[type].name}: ${TEACH[type].hint}`, useWhen(type), ...TEACH[type].card]
        : ['Select a block to read about its type.']
      : page === 2
        ? marks
        : [
            ...hands,
            'd: the goal (the design\'s description) · n: next block with a lint · z: compact, one row a card · c: this help',
            'r: puts the request to run the design in the prompt: add what to run it on, then Enter · v: asks Claude to review the design',
            'q: puts away the results of a run that is over (the first edit does too)',
            `file: ${file}`,
          ]
  return lines.flatMap(line => wrapText(line, Math.max(12, columns)))
}

/**
 * The run in one line for the pane's header, in the longest wording `room` cells
 * hold. What goes first when it is tight: the long words, then the time, the
 * tokens, the failures, the count; the status always stays.
 * `run running · 5/9 agents done · 1 failed · 57.4k tokens · 4.5s` … `running · 5/9` … `running`.
 */
export function runSummary(run: RunState, elapsedMs: number | null, room: number = Infinity): { text: string; color: 'claude' | 'success' | 'error' } {
  const agents = Object.values(run.agents)
  const done = agents.filter(agent => agent.status === 'done').length
  const failed = agents.filter(agent => agent.status === 'failed').length
  const tokens = agents.reduce((sum, agent) => sum + agent.tokens, 0)
  const status = run.status === 'running' ? 'running' : 'finished'
  const fails = failed > 0 ? [`${failed} failed`] : []
  const time = elapsedMs !== null && elapsedMs >= 0 ? [fmtDuration(elapsedMs)] : []
  const count = `${done}/${agents.length}`
  const wordings = [
    [status, `${count} agents done`, ...fails, `${fmtTokens(tokens)} tokens`, ...time],
    [status, `${count} done`, ...fails, fmtTokens(tokens), ...time],
    [status, `${count} done`, ...fails, fmtTokens(tokens)],
    [status, `${count} done`, ...fails],
    [status, count, ...fails],
    // A failure outranks the count once only one of them fits.
    failed > 0 ? [status, ...fails] : [status, count],
    [status],
  ].map(parts => parts.join(' · '))
  const text = wordings.find(one => one.length <= room) ?? status
  return { text, color: run.status === 'running' ? 'claude' : failed > 0 || run.status === 'failed' ? 'error' : 'success' }
}

/**
 * When the tracked run began and ended, and when it was last seen running, in the
 * clock's ms: the run state itself carries no times, and a drawing reads no clock.
 */
export type RunTimes = { runId: string | null; startedAt: number | null; endedAt: number | null; seenAt: number | null }

/** The elapsed time shown moves on about this often while the run is live. */
export const ELAPSED_STEP_MS = 1000

export function initialTimes(): RunTimes {
  return { runId: null, startedAt: null, endedAt: null, seenAt: null }
}

/** The times as of the run's state at `now`. Returns `times` itself when nothing changes. */
export function stampTimes(times: RunTimes, run: RunState, now: number): RunTimes {
  if (run.status === 'idle') return times.runId === null ? times : initialTimes()
  const runId = run.runId ?? ''
  if (times.runId !== runId || times.startedAt === null) return { runId, startedAt: now, endedAt: run.status === 'running' ? null : now, seenAt: now }
  if (run.status !== 'running') return times.endedAt === null ? { ...times, endedAt: now, seenAt: now } : times
  // A run held finished can start again (the quiet period is a guess): it is timed on.
  if (times.endedAt !== null) return { ...times, endedAt: null, seenAt: now }
  return now - (times.seenAt ?? 0) >= ELAPSED_STEP_MS ? { ...times, seenAt: now } : times
}

/** How long the run has taken as last stamped; null when it is not the one timed. */
export function elapsedOf(times: RunTimes, run: RunState): number | null {
  if (times.startedAt === null || times.runId !== (run.runId ?? '')) return null
  return Math.max(0, (times.endedAt ?? times.seenAt ?? times.startedAt) - times.startedAt)
}

/**
 * The block the selection goes to while it follows the run: the last one in the
 * design's order with an agent running (the front of the work). Null with none.
 */
export function runningBlock(design: Design, run: RunState): string | null {
  const busy = flatten(design).filter(row => (run.byNode[row.node.id]?.running ?? 0) > 0)
  return busy.at(-1)?.node.id ?? null
}

/**
 * The pane's state after the run moved on: while `follow` holds, the selection
 * (and with it the board's scroll) is on the block that is running. Returns `ui`
 * itself when nothing changes, and always once the person has moved the selection.
 */
export function followRun(ui: DesignUi, design: Design | null, run: RunState, runDesign: string | null): DesignUi {
  if (!ui.follow || !design || ui.status !== 'ready' || runDesign === null || ui.name !== runDesign || run.status !== 'running') return ui
  const id = runningBlock(design, run)
  if (id === null || id === ui.selectedId) return ui
  return { ...ui, selectedId: id, confirmId: null, grabbedId: null, editing: false, freshId: null }
}

/** The first block, in the design's order, that has a failed agent of its own; null with none. */
export function failedBlock(design: Design, run: RunState): string | null {
  return flatten(design).find(row => (run.byNode[row.node.id]?.failed ?? 0) > 0)?.node.id ?? null
}

/**
 * The pane's state once the run it followed is over: the selection goes to the
 * first block with a failure (where the person has to look), and following ends.
 * Returns `ui` itself when there is nothing to do, and always after the first time.
 */
export function endRun(ui: DesignUi, design: Design | null, run: RunState, runDesign: string | null): DesignUi {
  if (!ui.follow || !design || ui.status !== 'ready' || runDesign === null || ui.name !== runDesign || (run.status !== 'done' && run.status !== 'failed')) return ui
  const id = failedBlock(design, run)
  if (id === null) return { ...ui, follow: false }
  return { ...ui, follow: false, selectedId: id, confirmId: null, grabbedId: null, editing: false, freshId: null }
}

/** The dock's width the pane asks for with nothing known of the terminal: narrow enough for a 110-column one. */
export const DOCK_COLUMNS_UNKNOWN = 56

/**
 * The columns to ask the dock for: `wanted`, but never so many that the
 * transcript is left with less than about half of a terminal `terminal` cells
 * wide. With the width unknown the request is the low one.
 */
export function dockColumns(wanted: number, terminal: number | undefined): number {
  if (terminal === undefined || !Number.isFinite(terminal) || terminal <= 0) return Math.min(wanted, DOCK_COLUMNS_UNKNOWN)
  return Math.max(40, Math.min(wanted, Math.floor(terminal * 0.55) - 3))
}

/**
 * What bare `/conductor` shows. A run in progress: its design, or the phase view
 * when it came from none. Otherwise the design this session last had open (the
 * picker for the default name when there is none); a finished run that came from
 * no design, with no design opened since, is still read in the phase view. Never
 * an empty run view. Both hooks modules ask this, so either may be asked first.
 */
export function bareTarget(status: RunState['status'], runDesign: string | null, ui: Pick<DesignUi, 'name' | 'status'>): { view: 'run' } | { view: 'design'; name: string; live: boolean } {
  if (status === 'running') return runDesign === null ? { view: 'run' } : { view: 'design', name: runDesign, live: true }
  if (ui.status !== 'closed') return { view: 'design', name: ui.name, live: false }
  if (status !== 'idle' && runDesign === null) return { view: 'run' }
  // A replay's design is the session's only: once it is gone it is never offered as a design to create.
  return { view: 'design', name: runDesign !== null && isSaved(runDesign) ? runDesign : DEFAULT_DESIGN_NAME, live: false }
}
