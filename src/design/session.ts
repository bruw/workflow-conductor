// What the design pane does to its state, as pure steps: opening a design,
// starting one from a template, and applying a message from the graph, a key,
// or an edit made in the detail pane. The hooks module reads state, calls one
// of these, writes state and saves. Pure TypeScript: no `$`, no engine imports.

import type { AgentStatus, NodeRun, RunState } from '../run/events'
import { UNMAPPED_ID, canOpen, graphColumns, moveTarget, navigate, parentView, viewFor } from '../ui/graph-layout'
import type { Direction, GraphLayout } from '../ui/graph-layout'
import { LEGEND, MOUSE_HELP, graphLayout } from '../ui/graph-model'
import type { GraphMessage, GraphProps } from '../ui/graph-model'
import type { RunOverlay } from '../ui/graph-paint'
import { KEY_OPS, LOCKED_OPS } from '../ui/keys'
import type { KeyOp } from '../ui/keys'
import { fmtDuration, fmtTokens } from '../ui/rail'
import { clip, wrapText } from '../ui/text'
import { REDO_HINT, UNDO_HINT } from './history'
import { agentsCount, lint, preflight } from './lints'
import { NODE_TYPES, blockCount, canHoldChildren, emptyDesign, findNode, flatten, isBlank, kindsOf, parseDesign, toKebab, typeName } from './model'
import type { Design, DesignNode, NodeType } from './model'
import { addNode, addPlace, moveNode, placeFor, removeNode, retypeNode, stepKnob, updateNode } from './ops'
import type { NodePatch, OpResult, Place } from './ops'
import { PALETTE, defaultName, fieldWord, searchBlocks, startsName, teachOf, useWhen } from './teach'
import type { BlockRef } from './teach'
import type { Template } from './templates'
import { TEMPLATES } from './templates'

export const DESIGN_PANE_ID = 'conductor-design'
export const DESIGN_PANE_TITLE = 'Conductor design'
export const DESIGN_DIR = '.claude/workflow-designs'
export const BLANK_TEMPLATE_ID = 'blank'
export const DEFAULT_DESIGN_NAME = 'untitled'

/**
 * `closed`: nothing opened yet. `pick`: the start screen, a saved design or a template to choose.
 * `ready`: a design is loaded. `error`: the saved file could not be read.
 */
export type DesignStatus = 'closed' | 'pick' | 'ready' | 'error'

export type DesignUi = {
  /** The file's name (kebab-case, no extension). */
  name: string
  status: DesignStatus
  /** Why the saved file was refused (`error`). */
  error: string | null
  /** A node id, or UNMAPPED_ID while a run has agents no block claims. The graph draws it from props. */
  selectedId: string | null
  /** The help page shown in the detail pane, from 1; 0 while it is closed. `?` turns the page, round again after the last; `x` closes it. */
  help: number
  /** The last refused edit or failed save, shown in the pane until the next edit. */
  notice: string | null
  /**
   * The add list: where the block will go, what was typed, and which match is marked (`pick`, from 0). Opened by a key it
   * knows the block it was opened on (`anchorId`) and which side of it the place is (`where`): `n` again goes round them.
   * With `retypeId` it picks that block's type instead.
   */
  /**
   * The add list. `block`: the type whose kinds it lists while nothing is typed (a block was opened); `nav`: the keys
   * typed since it opened, kept in case they turn out to start a name; `lead`: the ones that did, which open `query`
   * and are not in the filter's field (`typePicker`).
   */
  picker: { at: Place; query: string; retypeId?: string; anchorId?: string; where?: AddWhere; pick?: number; block?: NodeType; nav?: string; lead?: string } | null
  /** The container a first delete asked about; a second one on it removes it. */
  confirmId: string | null
  /** The container opened as the view (`o`): the graph shows only it. Null at the root. */
  viewRootId: string | null
  /** By container id: the first arm its carousel shows. The layout moves it to hold the selected arm; what it settled on is kept here. */
  carousels: Record<string, number>
  /** The detail pane is hidden (`i`) and the graph has its width. Kept across designs. */
  detailHidden: boolean
  /** The design was started from a template and nothing has written it to its file yet. */
  unsaved: boolean
  /** The ring is in a field of the selected block, or on its way to one. */
  editing: boolean
  /** Blocks an edit from chat just touched: the graph marks them for a moment. `seq` counts the edits; the ids are emptied once shown. */
  flash: { ids: string[]; seq: number } | null
  /** During a run the selection goes to the block that is running, until the person moves it themselves. */
  follow: boolean
  /** Claude was asked to draft this design and nothing has arrived yet: the empty graph says so. */
  drafting: boolean
  /** The block just added: its title field opens empty (the default title shown dim), ready to be typed over. */
  freshId: string | null
  /** The block last selected in each design opened this session, by design name: reopening one goes back to it. */
  picks: Record<string, string>
  /** The design's description (its goal) is being typed in: its field is in the detail pane. */
  describing: boolean
  /** The results of a finished run were put away (by the first edit after it, or the key): the design is shown bare until the next run. */
  runCleared: boolean
  /** The saved designs, as read when the start screen was opened: it lists them above the templates. */
  saved: SavedDesign[]
  /** A request (`r`, `q`) waits in the prompt box and the pane still holds the keyboard: no key is acted on until the person takes the keys to the prompt. */
  handed: boolean
  /** The start screen's marked entry, from 0, over `startEntries`: the saved designs, the templates, Blank. */
  startMark: number
}

/** A saved design as the start screen and `/conductor list` name it. */
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
  return parsed.ok ? { name, blocks: blockCount(parsed.design), description: parsed.design.description.replace(/\s+/g, ' ').trim() } : { name, blocks: -1, description: 'not a valid design file' }
}

/** `demo · 9 blocks · Review the current diff…`: one line of `/conductor list`. */
export function savedLine(one: SavedDesign): string {
  return `${one.name} · ${blocksWord(one.blocks)}${one.description === '' ? '' : ` · ${one.description}`}`
}

/** The name a new design gets when none was given: `untitled`, or the first `untitled-N` no saved design has. */
export function freeName(taken: readonly string[]): string {
  if (!taken.includes(DEFAULT_DESIGN_NAME)) return DEFAULT_DESIGN_NAME
  for (let n = 2; ; n++) if (!taken.includes(`${DEFAULT_DESIGN_NAME}-${n}`)) return `${DEFAULT_DESIGN_NAME}-${n}`
}

/** What the tracker is told of a design handed off: its name, its block ids in design order, and their titles (the status line names the running one). */
export function handoffOf(name: string, design: Design): { name: string; nodeIds: string[]; titles: Record<string, string> } {
  const rows = flatten(design)
  return { name, nodeIds: rows.map(row => row.node.id), titles: Object.fromEntries(rows.map(row => [row.node.id, row.node.name])) }
}

/** The room the graph is drawn in: its region's columns and rows. The keys walk the layout made for it. */
export type GraphBox = { columns: number; rows: number }

/** The room assumed where none was told (nothing drawn yet). */
export const GRAPH_BOX: GraphBox = { columns: 100, rows: 40 }

/** What stands in the way of an edit, and what a key that walks the graph needs to know. */
export type RunContext = {
  /** A run of this design is in progress: every edit is refused. */
  locked?: boolean
  /** The run laid over this design, when there is one. */
  run?: RunState
  /** The graph's region as last drawn. */
  graph?: GraphBox
}

export const LOCK_NOTICE = 'run in progress · editing locked'

/** Which side of the block it was opened on the add list's place is. */
export type AddWhere = 'after' | 'inside' | 'before'

/** `what` says a change in words (`deleted n7 "verify"`): the undo history keeps it. */
export type Step = { design: Design | null; ui: DesignUi; changed: boolean; what?: string }

/** What is said while a request waits in the prompt box and the pane could not hand the keys over. */
export const HANDED_NOTICE = 'keys are off here while the prompt box holds text · Esc returns to the prompt'
/** The cue drawn while the pane does not hold the keyboard. */
export const KEYS_CUE = 'Input: prompt · click the graph or /conductor'

/** A notice as it may follow the cue while the keys are in the prompt: without the key it ends on, and not at all when it names any other key. */
export function withoutKeys(text: string): string | null {
  // A request waiting in the prompt box speaks of the prompt's own Enter: true while the keys are there.
  if (/^(run|ask): /.test(text)) return text
  const bare = text.endsWith(` · ${UNDO_HINT}`) ? text.slice(0, -UNDO_HINT.length - 3) : text.endsWith(` · ${REDO_HINT}`) ? text.slice(0, -REDO_HINT.length - 3) : text
  return /\[[^\]]+\]|(^|[\s(])[a-zA-Z?+]( again|: | adds )/.test(bare) || /\b(Enter|Esc|Tab|Shift)\b/i.test(bare) ? null : bare
}

/** Whether a design name is the one given when none was asked for: `untitled`, `untitled-2`. */
export function isDefaultName(name: string): boolean {
  return name === DEFAULT_DESIGN_NAME || new RegExp(`^${DEFAULT_DESIGN_NAME}-\\d+$`).test(name)
}

/** Whether a notice only informs (a change that was made, a request filled): drawn plain; anything else is a refusal or a question. */
export function noticeInforms(text: string): boolean {
  return text.endsWith(UNDO_HINT) || text.endsWith(REDO_HINT) || /^(run|ask|undone|redone): /.test(text) || text.startsWith('named ')
}

export function initialUi(): DesignUi {
  return {
    name: DEFAULT_DESIGN_NAME,
    status: 'closed',
    error: null,
    selectedId: null,
    help: 0,
    notice: null,
    picker: null,
    confirmId: null,
    viewRootId: null,
    carousels: {},
    detailHidden: false,
    unsaved: false,
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
    startMark: 0,
  }
}

/**
 * What outlives the design shown: `next` (the state for another design) with the detail
 * pane hidden or not as in `previous`, and the selection each design was left with.
 */
export function carryUi(previous: DesignUi, next: DesignUi): DesignUi {
  const picks = { ...(previous.picks ?? {}) }
  if (previous.status === 'ready' && previous.selectedId !== null && previous.selectedId !== UNMAPPED_ID) picks[previous.name] = previous.selectedId
  return { ...next, detailHidden: previous.detailHidden === true, picks }
}

/** Whether `run` is laid over the design the pane shows: it was started from that design and has begun. */
export function overlaysDesign(run: RunState, runDesign: string | null, ui: DesignUi): boolean {
  return runDesign !== null && runDesign === ui.name && ui.status === 'ready' && run.status !== 'idle' && ui.runCleared !== true
}

/** The run as the graph takes it: every node's counts, and the sum of the agents no block claims. */
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

/** Agents listed in the detail pane for one block; the rest are a count. */
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
 * `previous` is the pane's state so far: its detail pane stays hidden or shown, and a design
 * opened before in this session comes back with the block it was left on.
 */
export function openDesign(name: string, text: string | undefined, previous?: DesignUi): Step {
  const ui: DesignUi = { ...(previous ? carryUi(previous, initialUi()) : initialUi()), name }
  if (text === undefined) return { design: null, ui: { ...ui, status: 'pick' }, changed: false }
  const parsed = parseDesign(text)
  if (!parsed.ok) return { design: null, ui: { ...ui, status: 'error', error: parsed.error }, changed: false }
  const left = ui.picks[name]
  const selectedId = left !== undefined && findNode(parsed.design, left) ? left : firstPick(parsed.design)
  return { design: parsed.design, ui: { ...ui, status: 'ready', selectedId }, changed: false }
}

/** The block a design opens on: its first (the args block), or none while it has no block of its own, so that the detail pane says how to start. */
function firstPick(design: Design): string | null {
  return isBlank(design) ? null : (design.nodes[0]?.id ?? null)
}

/** Starts the design from a template (or blank), named after the file. Only from the start screen. */
export function startDesign(ui: DesignUi, templateId: string): Step {
  if (ui.status !== 'pick') return { design: null, ui, changed: false }
  const template = TEMPLATES.find(one => one.id === templateId)
  const design: Design = template ? { ...template.make(), name: ui.name } : emptyDesign(ui.name)
  return {
    design,
    ui: { ...ui, status: 'ready', error: null, notice: null, selectedId: firstPick(design), unsaved: true },
    // Nothing is written until the first edit: a template looked at and left is not a saved design.
    changed: false,
  }
}

/** One row of the start screen: a saved design, a template, or Blank (last). */
export type StartEntry = { kind: 'saved' | 'template' | 'blank'; id: string; title: string; blocks: number; note: string }

/** The start screen's rows, in the order `w` / `s` walk them: the saved designs, the templates, Blank. */
export function startEntries(saved: readonly SavedDesign[], templates: readonly Template[] = TEMPLATES): StartEntry[] {
  return [
    ...saved.map(one => ({ kind: 'saved' as const, id: one.name, title: one.name, blocks: one.blocks, note: one.description })),
    ...templates.map(one => ({ kind: 'template' as const, id: one.id, title: one.title, blocks: blockCount(one.make()), note: one.blurb })),
    { kind: 'blank' as const, id: BLANK_TEMPLATE_ID, title: 'Blank', blocks: 0, note: 'An empty design' },
  ]
}

/** The start screen's mark moved by `by` rows; it stops at the ends. Returns `ui` itself where it stays. */
export function moveStartMark(ui: DesignUi, by: number): DesignUi {
  const last = startEntries(ui.saved ?? []).length - 1
  const startMark = Math.max(0, Math.min(last, (ui.startMark ?? 0) + by))
  return startMark === (ui.startMark ?? 0) ? ui : { ...ui, startMark, notice: null }
}

/** `count` rows of a list of `total` around the marked one: the first row shown. */
export function listWindow(total: number, count: number, marked: number): number {
  return Math.max(0, Math.min(total - count, marked - Math.floor((count - 1) / 2)))
}

/** `9 blocks`, `1 block`; `unreadable` for a file that is no design. */
export function blocksWord(blocks: number): string {
  return blocks < 0 ? 'unreadable' : `${blocks} ${blocks === 1 ? 'block' : 'blocks'}`
}

/** A design shown and not to be changed (the start screen's preview): the graph's props with nothing selected and every edit locked out. */
export function previewProps(design: Design, box: GraphBox = GRAPH_BOX): GraphProps {
  return { design, mode: 'run', selectedId: null, viewRootId: null, problems: {}, openAt: null, scroll: {}, columns: graphColumns(box.columns), rows: Math.max(1, box.rows), unmapped: 0, wheel: { from: '', rows: 0 } }
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

function settle(design: Design, ui: DesignUi, result: OpResult, selectedId: string | null, what: string | ((after: Design) => string) = '', context: RunContext = {}): Step {
  if (result.error) return { design, ui: { ...ui, notice: result.error }, changed: false }
  // An edit that leaves every block as it was (Enter on a field nobody changed) is no change: nothing to save, nothing to undo.
  const changed = result.design !== design && JSON.stringify(result.design) !== JSON.stringify(design)
  const after = changed ? result.design : design
  const kept = selectedId !== null && findNode(after, selectedId) ? selectedId : null
  const said = !changed ? '' : typeof what === 'string' ? what : what(after)
  // The first edit after a run puts its results away: nothing is edited under stale counts. (While it runs, no edit gets here.)
  // Every change is announced, and the announcement ends with the way back.
  const next: DesignUi = { ...ui, selectedId: kept, notice: said === '' ? null : `${said} · ${UNDO_HINT}`, runCleared: changed ? true : ui.runCleared, unsaved: changed ? false : ui.unsaved }
  return { design: after, ui: shown(after, next, context), changed, ...(said === '' ? {} : { what: said }) }
}

// ---------------------------------------------------------------------------
// The view: a container opened with `o`, and the graph laid out for it

/** Whether block `id` is `rootId` or stands somewhere inside it. */
export function insideOf(design: Design, rootId: string, id: string): boolean {
  const root = findNode(design, rootId)
  return root !== undefined && (root.id === id || flatten({ ...design, nodes: root.children ?? [] }).some(row => row.node.id === id))
}

/**
 * The container the view shows, as the state stands, in a region of `columns`: `viewRootId` while that block is
 * there, holds blocks and draws the selection. Where it does not draw it (a run followed, an edit from chat, undo:
 * the person's own keys never leave the view) the view follows: the whole design (null) when that draws the
 * selected block, else the outermost container that does.
 */
export function viewRootOf(design: Design | null, ui: Pick<DesignUi, 'viewRootId' | 'selectedId'>, columns: number = GRAPH_BOX.columns): string | null {
  if (design === null) return null
  const root = ui.viewRootId ? findNode(design, ui.viewRootId) : undefined
  const held = root && canHoldChildren(root.type) ? root.id : null
  if (ui.selectedId === null || ui.selectedId === UNMAPPED_ID || !findNode(design, ui.selectedId)) return held
  return viewFor(design, held, ui.selectedId, graphColumns(columns))
}

/** What the graph gets as props, but for the wheel's rows (the hooks module counts them): the design, what is chosen on it, and the room. */
export function graphProps(design: Design, ui: DesignUi, box: GraphBox = GRAPH_BOX, run?: RunOverlay): GraphProps {
  const locked = run?.status === 'running'
  const problems: Record<string, number> = {}
  for (const one of lint(design)) problems[one.nodeId] = (problems[one.nodeId] ?? 0) + 1
  const props: GraphProps = {
    design,
    mode: locked ? 'run' : 'design',
    selectedId: ui.selectedId,
    viewRootId: viewRootOf(design, ui, box.columns),
    problems,
    openAt: locked || ui.picker?.retypeId !== undefined ? null : (ui.picker?.at ?? null),
    scroll: ui.carousels ?? {},
    columns: graphColumns(box.columns),
    rows: Math.max(1, box.rows),
    unmapped: run?.unmapped?.total ?? 0,
    wheel: { from: '', rows: 0 },
  }
  if (ui.flash && ui.flash.ids.length > 0) props.flash = ui.flash
  if (ui.handed) props.hold = true
  if (ui.drafting && isBlank(design)) props.emptyNote = DRAFTING_NOTE
  if (run) props.run = run
  return props
}

/** The graph as the Client draws it for this state: what the keys walk. */
export function graphOf(design: Design, ui: DesignUi, context: RunContext = {}): GraphLayout {
  return graphLayout(graphProps(design, ui, context.graph, context.run ? runOverlay(context.run) : undefined))
}

/**
 * The state as the graph will show it: the view that draws the selection, and every carousel's window where the
 * layout left it (so it stays there when the selection goes elsewhere). Returns `ui` itself when both stand.
 */
function shown(design: Design, ui: DesignUi, context: RunContext = {}): DesignUi {
  const layout = graphOf(design, ui, context)
  const carousels = { ...(ui.carousels ?? {}), ...layout.scroll }
  return layout.viewRootId === (ui.viewRootId ?? null) && JSON.stringify(carousels) === JSON.stringify(ui.carousels ?? {}) ? ui : { ...ui, viewRootId: layout.viewRootId, carousels }
}

/** The containers from the top level down to the view's root, outermost first: the breadcrumb after the design's name. */
export function crumbs(design: Design, rootId: string | null): { id: string; title: string }[] {
  if (rootId === null) return []
  const rows = flatten(design)
  const out: { id: string; title: string }[] = []
  for (let row = rows.find(one => one.node.id === rootId); row; row = row.parentId === undefined ? undefined : rows.find(one => one.node.id === row?.parentId)) out.unshift({ id: row.node.id, title: row.node.name })
  return out
}

/** A block as a message names it: `n4 Deep read`. */
export function blockName(node: { id: string; name: string }): string {
  return `${node.id} ${clip(node.name, 24)}`
}

/**
 * The design as it was a step back or forward (`target`), shown: the selection stays where it can, else
 * goes to a block the step brought back, so the graph scrolls to what changed.
 */
export function restoreDesign(design: Design | null, ui: DesignUi, target: Design, way: 'undo' | 'redo', what: string, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE }, changed: false }
  const had = new Set(flatten(design).map(row => row.node.id))
  const back = flatten(target).find(row => !had.has(row.node.id))?.node.id
  const selectedId = back ?? (ui.selectedId !== null && findNode(target, ui.selectedId) ? ui.selectedId : (target.nodes[0]?.id ?? null))
  const notice = way === 'undo' ? `undone: ${what} · ${REDO_HINT}` : `redone: ${what} · ${UNDO_HINT}`
  const next: DesignUi = { ...ui, selectedId, notice, confirmId: null, picker: null, editing: false, freshId: null, describing: false, runCleared: true, unsaved: false }
  return { design: target, ui: shown(target, next, context), changed: true }
}

/** What `u` or `y` says with nothing that way. */
export function nothingToRestore(ui: DesignUi, way: 'undo' | 'redo'): DesignUi {
  return { ...ui, confirmId: null, notice: way === 'undo' ? 'nothing to undo' : 'nothing to redo' }
}

/** How a move is said: `moved n7 into n4`, `moved n7 out of n4`, or its new place among the blocks it stays with (`moved n7 after n3`). */
function movedWords(before: Design, after: Design, id: string): string {
  const from = flatten(before).find(row => row.node.id === id)?.parentId
  const to = flatten(after).find(row => row.node.id === id)?.parentId
  if (from === to) return `moved ${id} ${whereIs(after, id)}`
  // Out: to the top level, or to a container around the one it was in.
  if (from !== undefined && (to === undefined || insideOf(after, to, from))) return `moved ${id} out of ${from}`
  return `moved ${id} into ${to ?? 'the top level'}`
}

/** Applies one message from the graph. A refused edit leaves the design as it was and sets `notice`. */
export function applyMessage(design: Design | null, ui: DesignUi, message: GraphMessage, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (message.kind === 'key') {
    const op = KEY_OPS[message.key]
    return op ? applyOp(design, ui, op, context) : { design, ui, changed: false }
  }
  // A press that asked for nothing: the hooks module only needed to hear of it (the click gave the graph the keyboard).
  // It is still a click away from the add list or the goal's field: they close.
  if (message.kind === 'touch') return { design, ui: ui.picker !== null || ui.describing ? { ...ui, picker: null, describing: false } : ui, changed: false }
  // What only changes what is shown works while a run locks the design too.
  const calm: DesignUi = { ...ui, confirmId: null, describing: false, picker: null, editing: false, freshId: null }
  if (message.kind === 'select') {
    const strays = message.id === UNMAPPED_ID && (context.run?.unmapped.length ?? 0) > 0
    const selectedId = message.id !== null && (strays || findNode(design, message.id)) ? message.id : null
    const same = selectedId === ui.selectedId
    // The person chose a block: the selection stops following the run.
    return { design, ui: shown(design, { ...calm, selectedId, follow: false, notice: same ? ui.notice : null, editing: ui.editing && same, freshId: same ? ui.freshId : null }, context), changed: false }
  }
  if (message.kind === 'view') {
    const now = viewRootOf(design, ui, context.graph?.columns)
    if (message.id === now) return { design, ui, changed: false }
    const trail = crumbs(design, now)
    const at = message.id === null ? -1 : trail.findIndex(one => one.id === message.id)
    if (message.id !== null && at < 0 && !canOpen(design, now, message.id)) return { design, ui: { ...ui, notice: `${message.id} holds no blocks to open` }, changed: false }
    // A crumb: up to that view, the selection on the container the way down went through. Else a container, opened: it is selected.
    const selectedId = message.id === null || at >= 0 ? (trail[at + 1]?.id ?? ui.selectedId) : message.id
    const root = message.id === null ? undefined : findNode(design, message.id)
    const notice = !root ? 'back to the whole design' : at >= 0 ? `back to ${blockName(root)}` : `opened ${blockName(root)} · b: back`
    return { design, ui: shown(design, { ...calm, viewRootId: message.id, selectedId, follow: false, notice }, context), changed: false }
  }
  if (message.kind === 'slide') {
    const stack = findNode(design, message.id)
    const window = graphOf(design, ui, context).carousels[message.id]
    if (!stack || !window) return { design, ui, changed: false }
    const first = Math.max(0, Math.min(window.count - window.shown, message.first))
    // The window always holds the selected arm. Slid out from under it, the selection steps back to the container the arms are in.
    const arm = ui.selectedId === null ? -1 : (stack.children ?? []).findIndex(child => insideOf(design, child.id, ui.selectedId ?? ''))
    const leaves = arm >= 0 && (arm < first || arm >= first + window.shown)
    const slid: DesignUi = { ...ui, carousels: { ...(ui.carousels ?? {}), [stack.id]: first } }
    return { design, ui: leaves ? shown(design, { ...slid, ...calm, carousels: slid.carousels, selectedId: stack.id, follow: false, notice: null }, context) : slid, changed: false }
  }
  if (context.locked) return { design, ui: { ...calm, notice: LOCK_NOTICE }, changed: false }
  switch (message.kind) {
    case 'move':
      return settle(design, { ...ui, confirmId: null }, moveNode(design, message.id, message.to), message.id, after => movedWords(design, after, message.id), context)
    case 'addAt': {
      const parent = message.at.parentId === undefined ? undefined : findNode(design, message.at.parentId)
      if (message.at.parentId !== undefined && (!parent || !canHoldChildren(parent.type))) {
        return { design, ui: { ...ui, notice: `${message.at.parentId} holds no blocks` }, changed: false }
      }
      return { design, ui: { ...calm, notice: null, help: 0, detailHidden: false, picker: { at: message.at, query: '' } }, changed: false }
    }
    case 'knob': {
      const stepped = stepKnob(design, message.id, message.slot)
      return settle(design, calm, stepped, ui.selectedId, `${message.id} ${stepped.knob ?? ''}: ${stepped.value ?? ''}`, context)
    }
  }
}

/** An edit of one node made in the detail pane. */
export function patchNode(design: Design | null, ui: DesignUi, id: string, patch: NodePatch, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE, editing: false, freshId: null }, changed: false }
  // A field was sent: the typing is over.
  const fields = [...(patch.name !== undefined ? ['name'] : []), ...('logic' in patch ? ['logic'] : []), ...Object.keys(patch.knobs ?? {})].map(fieldWord)
  return settle(design, { ...ui, editing: false, freshId: null }, updateNode(design, id, patch), ui.selectedId, `${id} changed${fields.length > 0 && fields.length <= 3 ? `: ${fields.join(', ')}` : ''}`, context)
}

/**
 * A type and kind picked for a block: the block becomes that, keeping its name, its logic, what it holds and every
 * knob that was typed (`retypeNode` says what a kind's own knobs do).
 */
export function retypeBlock(design: Design | null, ui: DesignUi, id: string, to: BlockRef, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE, editing: false, freshId: null }, changed: false }
  const node = findNode(design, id)
  const retyped = retypeNode(design, id, to.type, to.kind)
  // A block still called after its old type or kind (the name it was added with) takes the new one's.
  const renamed = !retyped.error && node && node.name === defaultName(node) && defaultName(to) !== node.name ? updateNode(retyped.design, id, { name: defaultName(to) }) : retyped
  return settle(design, { ...ui, editing: false, freshId: null, picker: null }, renamed, ui.selectedId, `${id} is now ${typeName(to)}`, context)
}

/** The types a block may become: all of them but `args`, or only containers while it holds blocks. The args block becomes nothing else. */
export function retypeChoices(node: { type: NodeType; children?: readonly unknown[] }): NodeType[] {
  if (node.type === 'args') return []
  return NODE_TYPES.filter(type => type !== 'args' && ((node.children?.length ?? 0) === 0 || canHoldChildren(type)))
}

/** The design's description (its goal) as typed in its field in the detail pane. */
export function describeDesign(design: Design | null, ui: DesignUi, text: string, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE, describing: false }, changed: false }
  const description = text.replace(/\s+/g, ' ').trim()
  const calm: DesignUi = { ...ui, describing: false, notice: null }
  return description === design.description ? { design, ui: calm, changed: false } : { design: { ...design, description }, ui: { ...calm, notice: `goal changed · ${UNDO_HINT}`, runCleared: true, unsaved: false }, changed: true, what: 'goal changed' }
}

const FIRST_BLOCK = 'the first block'

/**
 * Where the add list's block will go, in words: `after n4 (in n2)`, `first in n2`,
 * `at the end`. The place is a list and an index; the words name the neighbour.
 */
export function placeLabel(design: Design, at: Place): string {
  const parent = at.parentId === undefined ? undefined : findNode(design, at.parentId)
  const list = parent ? (parent.children ?? []) : design.nodes
  const before = list[at.index - 1]
  if (before) return parent ? `after ${before.id} (in ${parent.id})` : at.index >= list.length ? `after ${before.id} (at the end)` : `after ${before.id}`
  return parent ? `first in ${parent.id}` : list.length === 0 ? FIRST_BLOCK : 'at the start'
}

/** Where a new block goes beside or in block `id`: after it or before it, as its sibling, or inside it, as its last. At the end with no such block. */
export function placeBy(design: Design, id: string | null, where: AddWhere): Place {
  const row = id === null ? undefined : flatten(design).find(one => one.node.id === id)
  if (!row) return { index: design.nodes.length }
  if (where === 'inside') return { parentId: row.node.id, index: row.node.children?.length ?? 0 }
  const index = where === 'after' ? row.index + 1 : row.index
  return row.parentId === undefined ? { index } : { parentId: row.parentId, index }
}

/** The sides `n` goes round for a block: after it, inside it (a container), before it. Nothing goes before the args block. */
export function addSides(node: Pick<DesignNode, 'type'>): AddWhere[] {
  if (node.type === 'args') return ['after']
  return canHoldChildren(node.type) ? ['after', 'inside', 'before'] : ['after', 'before']
}

/**
 * The add list as `n` opens it on a block: after it, or inside it when it is a container that holds nothing yet,
 * or the one the view shows (`frame`: beside it is out of sight).
 */
export function openAdd(design: Design, node: DesignNode | undefined, frame: boolean = false): NonNullable<DesignUi['picker']> {
  if (!node) return { at: addPlace(design, null, null), query: '' }
  // The same place the graph lights its `[+]` at.
  const at = addPlace(design, node.id, frame ? node.id : null)
  return { at, query: '', anchorId: node.id, where: at.parentId === node.id ? 'inside' : 'after' }
}

/** `n` pressed in the add list: the place goes round the sides of the block it was opened on. Returns `ui` itself where there is no such block. */
export function cyclePlace(design: Design, ui: DesignUi): DesignUi {
  const picker = ui.picker
  const node = picker?.anchorId === undefined ? undefined : findNode(design, picker.anchorId)
  if (!picker || !node || picker.retypeId !== undefined) return ui
  const sides = addSides(node)
  const where = sides[(sides.indexOf(picker.where ?? 'after') + 1) % sides.length] ?? 'after'
  return { ...ui, picker: { ...picker, where, at: placeBy(design, node.id, where) } }
}

/** The add list's heading: `New block after n4 Deep read` (the legend says the key that changes the place), `Type of n4 Deep read (now agent verify)`; `· which loop?` while it lists a block's kinds. */
export function addHeading(design: Design, picker: NonNullable<DesignUi['picker']>): string {
  const retyped = picker.retypeId === undefined ? undefined : findNode(design, picker.retypeId)
  // A block was opened: the list is of its kinds.
  const kinds = picker.block !== undefined && picker.query === '' ? ` · which ${picker.block}?` : ''
  if (retyped) return `Type of ${blockName(retyped)} (now ${typeName(retyped)})${kinds}`
  const node = picker.anchorId === undefined ? undefined : findNode(design, picker.anchorId)
  if (node) return `New block ${picker.where ?? 'after'} ${blockName(node)}${kinds}`
  const place = placeLabel(design, picker.at)
  return `${place === FIRST_BLOCK ? 'The first block' : `New block ${place}`}${kinds}`
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

/** What each digit steps, as a refusal names it. */
const QUICK_NAMES = ['model', 'effort', 'votes'] as const

/** The way each key that walks or moves goes. */
const WAYS: Partial<Record<KeyOp, Direction>> = { left: 'left', right: 'right', up: 'up', down: 'down', moveLeft: 'left', moveRight: 'right', moveUp: 'up', moveDown: 'down' }

/**
 * Applies one key (typed into the key catcher, or sent by the graph). `w a s d` move the selection over the
 * graph as it is drawn, never out of the view; `W A S D` move the block one place, as the layout reads them.
 */
export function applyOp(design: Design | null, ui: DesignUi, op: KeyOp, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  // A request waits in the prompt box: a key typed now is meant for it. Nothing is done, and the way out is said.
  if (ui.handed) return { design, ui: ui.notice === HANDED_NOTICE ? ui : { ...ui, notice: HANDED_NOTICE }, changed: false }
  const calm: DesignUi = { ...ui, confirmId: null, notice: null, editing: false, freshId: null, describing: false, picker: null, viewRootId: viewRootOf(design, ui, context.graph?.columns) }
  const node = ui.selectedId === null ? undefined : findNode(design, ui.selectedId)
  if (context.locked && !LOCKED_OPS.includes(op)) return { design, ui: { ...calm, notice: LOCK_NOTICE }, changed: false }
  switch (op) {
    case 'left':
    case 'right':
    case 'up':
    case 'down': {
      const selectedId = navigate(design, graphOf(design, calm, context), ui.selectedId === UNMAPPED_ID ? null : (node?.id ?? null), WAYS[op] ?? 'down')
      // The person moved the selection: it stops following the run.
      return { design, ui: shown(design, { ...calm, selectedId, follow: false }, context), changed: false }
    }
    case 'moveUp':
    case 'moveDown':
    case 'moveLeft':
    case 'moveRight': {
      if (!node) return { design, ui: { ...calm, notice: 'move: select a block first' }, changed: false }
      const target = moveTarget(design, graphOf(design, calm, context), node.id, WAYS[op] ?? 'down')
      // Nowhere to go that way: the reason is said, nothing moves.
      if (target.to === null) return { design, ui: { ...calm, notice: target.reason }, changed: false }
      return settle(design, calm, moveNode(design, node.id, target.to), node.id, after => movedWords(design, after, node.id), context)
    }
    case 'add':
      return { design, ui: { ...calm, help: 0, detailHidden: false, picker: openAdd(design, node, node !== undefined && node.id === calm.viewRootId) }, changed: false }
    case 'remove': {
      // While a help page is open `x` closes it, and deletes nothing.
      if ((ui.help ?? 0) > 0) return { design, ui: { ...calm, help: 0 }, changed: false }
      if (!node) return { design, ui: { ...calm, notice: 'delete: select a block first' }, changed: false }
      const held = node.children?.length ?? 0
      if (held > 0 && ui.confirmId !== node.id) {
        return { design, ui: { ...calm, confirmId: node.id, notice: confirmText(design, node.id) }, changed: false }
      }
      // A single block goes at once: `u` brings it back.
      return settle(design, calm, removeNode(design, node.id), afterRemoval(design, node.id), `deleted ${node.id} "${clip(node.name, 24)}"${held > 0 ? ` and what it held` : ''}`, context)
    }
    case 'knob1':
    case 'knob2':
    case 'knob3': {
      const slot = op === 'knob1' ? 1 : op === 'knob2' ? 2 : 3
      if (!node) return { design, ui: { ...calm, notice: `${QUICK_NAMES[slot - 1]}: select a block first` }, changed: false }
      const stepped = stepKnob(design, node.id, slot)
      return settle(design, calm, stepped, node.id, `${node.id} ${stepped.knob ?? ''}: ${stepped.value ?? ''}`, context)
    }
    case 'open':
      if (!node) return { design, ui: { ...calm, notice: 'open: select a container first' }, changed: false }
      if (calm.viewRootId === node.id) return { design, ui: { ...calm, notice: `${blockName(node)} is the view · b: back` }, changed: false }
      if (!canOpen(design, calm.viewRootId, node.id)) return { design, ui: { ...calm, notice: `${node.id} is ${/^[aeiou]/.test(node.type) ? 'an' : 'a'} ${node.type}: it holds no blocks to open` }, changed: false }
      return { design, ui: shown(design, { ...calm, viewRootId: node.id, follow: false, notice: `opened ${blockName(node)} · b: back` }, context), changed: false }
    case 'back': {
      const root = calm.viewRootId === null ? undefined : findNode(design, calm.viewRootId)
      if (!root) return { design, ui: { ...calm, notice: 'the view is the whole design already' }, changed: false }
      // One level up: the container around the one shown, and the selection on the one it came out of.
      const outerId = parentView(design, root.id)
      const outer = outerId === null ? undefined : findNode(design, outerId)
      return { design, ui: shown(design, { ...calm, viewRootId: outerId, selectedId: root.id, follow: false, notice: outer ? `back to ${blockName(outer)}` : 'back to the whole design' }, context), changed: false }
    }
    case 'detail':
      return { design, ui: { ...calm, detailHidden: !ui.detailHidden, help: 0, notice: ui.detailHidden ? null : 'details hidden' }, changed: false }
    case 'undo':
    case 'redo':
      // The hooks module holds the history: it answers these before they get here.
      return { design, ui: calm, changed: false }
    case 'edit':
      // The hooks module moves the ring to the title's field.
      return { design, ui: node ? { ...calm, editing: true, help: 0, detailHidden: false } : { ...calm, notice: 'edit: select a block first' }, changed: false }
    case 'help':
      // Page by page, round again from the first: `x` closes them.
      return { design, ui: { ...calm, detailHidden: false, help: ((ui.help ?? 0) % HELP_PAGES) + 1 }, changed: false }
    case 'run':
    case 'review':
      // The hooks module puts the request in the prompt box; nothing changes here.
      return { design, ui: calm, changed: false }
    case 'goal':
      // The goal's field takes the detail pane; the ring lands on it.
      return { design, ui: { ...calm, describing: true, help: 0, detailHidden: false }, changed: false }
    case 'clearRun':
      // The results of a run that is over are put away; while it runs they stay.
      return { design, ui: context.locked ? { ...calm, notice: LOCK_NOTICE } : { ...calm, runCleared: true }, changed: false }
    case 'cancel':
      return { design, ui: calm, changed: false }
  }
}

/** Opens the add list on a block's type: the same list as adding, narrowed to what the block may become. */
export function openRetype(design: Design | null, ui: DesignUi, id: string, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready' || !findNode(design, id)) return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, notice: LOCK_NOTICE }, changed: false }
  return { design, ui: { ...ui, notice: null, confirmId: null, editing: false, freshId: null, describing: false, help: 0, picker: { at: { index: 0 }, query: '', retypeId: id } }, changed: false }
}

/** A row of the add list: a block to add, or (`opens`) a block type whose kinds the list shows next. */
export type PickRow = BlockRef & { opens?: boolean }

/**
 * The rows the open add list shows. With something typed: every block whose name holds it, at the block's
 * level or the kind's, each named in full (`agent verify`). With nothing typed: the blocks, and one that has
 * kinds opens on them (`opens`); once a block was opened, its kinds. A block being retyped lists its own kinds
 * first, and only what it may become.
 */
export function pickerMatches(design: Design | null, picker: NonNullable<DesignUi['picker']>): PickRow[] {
  const retyped = picker.retypeId === undefined || design === null ? undefined : findNode(design, picker.retypeId)
  const allowed = picker.retypeId === undefined ? null : retypeChoices(retyped ?? { type: 'agent' })
  const may = (row: BlockRef): boolean => allowed === null || allowed.includes(row.type)
  const kinds = (type: NodeType): PickRow[] => kindsOf(type).map(kind => ({ type, kind }))
  if (picker.query.trim() !== '') return searchBlocks(picker.query).filter(may)
  if (picker.block !== undefined) return kinds(picker.block)
  const blocks: PickRow[] = PALETTE.map((entry): PickRow => (kindsOf(entry.type).length > 0 ? { type: entry.type, opens: true } : { type: entry.type })).filter(may)
  return retyped ? [...kinds(retyped.type), ...blocks.filter(row => row.type !== retyped.type)] : blocks
}

/** The keys the add list keeps for itself while nothing is typed in its filter: up, down, and the place. */
export const PICKER_KEYS = 'wsn'
/** One more while it lists a block's kinds: back to the blocks. */
export const PICKER_BACK = 'b'
/** The key that closes the add list, wherever it is typed: no block's or kind's name holds it. */
export const PICKER_CLOSE = 'x'

/** The add list with no key remembered. */
function forgetNav(picker: NonNullable<DesignUi['picker']>): NonNullable<DesignUi['picker']> {
  const { nav: _nav, lead: _lead, ...rest } = picker
  return rest
}

/**
 * What the add list's filter says now (`whole`: all of its text, without the keys already taken from it).
 * While the filter is empty `w` / `s` move the mark, `n` changes the place (on a
 * list a key opened on a block) and `b` goes back from a block's kinds to the blocks; any other character
 * starts the filter, and from there every character narrows it. `x` closes the list, always. `taken` counts
 * the characters used as keys.
 *
 * Names start with those letters too (`sweep`, `scout`, `budget`), so the keys just taken are remembered: when
 * they and the next character are how a block's or a kind's name starts, they were the filter all along. They
 * then open the filter's text as its `lead`: the field they were typed in no longer holds them (it was drawn
 * anew when they were taken as keys), so the pane says them before the field, and whoever reads the field puts
 * them before its text (`filterText`).
 */
export function typePicker(design: Design | null, ui: DesignUi, whole: string): { ui: DesignUi; taken: number } {
  if (!ui.picker) return { ui, taken: 0 }
  if (whole.includes(PICKER_CLOSE)) return { ui: { ...ui, picker: null, notice: null }, taken: whole.length }
  let next = ui
  let query = whole
  let taken = 0
  let lead = ''
  while (ui.picker.query === '' && query !== '') {
    const key = query.charAt(0)
    const picker = next.picker ?? ui.picker
    const run = picker.nav ?? ''
    if (run !== '' && startsName(`${run}${key}`)) {
      lead = run
      break
    }
    if (key === PICKER_BACK && picker.block !== undefined) {
      const { block: _block, ...blocks } = picker
      next = { ...next, picker: { ...blocks, pick: 0, nav: `${run}${key}` } }
    } else if (!PICKER_KEYS.includes(key)) break
    else if (key === 'n') {
      const cycled = design === null ? next : cyclePlace(design, next)
      // On a list with no block to go round, `n` is a letter like any other.
      if (cycled === next || !cycled.picker) break
      next = { ...cycled, picker: forgetNav(cycled.picker) }
    } else {
      const last = Math.max(0, pickerMatches(design, picker).length - 1)
      next = { ...next, picker: { ...picker, nav: `${run}${key}`, pick: Math.max(0, Math.min(last, (picker.pick ?? 0) + (key === 's' ? 1 : -1))) } }
    }
    query = query.slice(1)
    taken++
  }
  const picker = next.picker ?? ui.picker
  const text = `${lead}${query}`
  if (text === picker.query) return { ui: next, taken }
  // A lead stays for as long as the text goes on from it.
  const kept = lead !== '' ? lead : picker.lead !== undefined && text.length > picker.lead.length && text.startsWith(picker.lead) ? picker.lead : ''
  return { ui: { ...next, picker: { ...forgetNav(picker), query: text, pick: 0, ...(kept === '' ? {} : { lead: kept }) } }, taken }
}

/**
 * All of the filter's text, from what its field holds (less the keys taken from it): the lead goes before it.
 * A field emptied takes the lead with it, so the filter can be cleared by deleting.
 */
export function filterText(ui: DesignUi, field: string): string {
  return field === '' ? '' : `${ui.picker?.lead ?? ''}${field}`
}

/**
 * Enter or a press in the open add list: `choice` when a row was pressed, else the marked row for what was typed.
 * A block that has kinds opens on them; any other row is added (or, on a block being retyped, becomes its type).
 */
export function pickBlock(design: Design | null, ui: DesignUi, choice: Partial<PickRow> = {}, context: RunContext = {}): Step {
  if (!design || ui.status !== 'ready' || !ui.picker) return { design, ui, changed: false }
  if (context.locked) return { design, ui: { ...ui, picker: null, notice: LOCK_NOTICE }, changed: false }
  const picker = ui.picker
  const row: PickRow | undefined = choice.type !== undefined ? { ...choice, type: choice.type } : pickerMatches(design, picker)[picker.pick ?? 0]
  if (row === undefined) return { design, ui: { ...ui, notice: 'no block matches that' }, changed: false }
  if (row.opens) return { design, ui: { ...ui, notice: null, picker: { ...forgetNav(picker), block: row.type, query: '', pick: 0 } }, changed: false }
  const block: BlockRef = row.kind === undefined ? { type: row.type } : { type: row.type, kind: row.kind }
  if (picker.retypeId !== undefined) return retypeBlock(design, ui, picker.retypeId, block, context)
  const result = addNode(design, block, picker.at)
  // The place is said as the block got it: args go first whatever was asked, and nothing goes before them.
  const at = placeFor(design, block.type, picker.at)
  const step = settle(design, ui, result, result.id ?? ui.selectedId, after => `added ${result.id ?? ''} ${typeName(block)} ${placeLabel(after, at).replace(/ \(at the end\)$/, '')}`, context)
  // The new block is selected and its title is the next thing typed.
  return step.changed ? { ...step, ui: { ...step.ui, picker: null, editing: true, freshId: result.id ?? null, drafting: false } } : step
}

/** The knobs typed as text, each in a field of its own in the detail pane; model, effort and votes are stepped on the card. */
export const TEXT_KNOBS = ['prompt', 'condition', 'oncePer', 'stopCondition', 'output', 'agentType'] as const
export type TextKnob = (typeof TEXT_KNOBS)[number]

/** What an empty graph says while Claude drafts the design. */
export const DRAFTING_NOTE = 'Claude is drafting this design: blocks appear here as they are written'

// ---------------------------------------------------------------------------
// The screen's shape

/** Docked with at least this many body columns the graph and the detail pane stand side by side; narrower, or inline, one under the other. */
export const WIDE_MIN_COLUMNS = 100
/** The detail pane beside the graph: about this share of the columns, within these bounds. */
export const DETAIL_SHARE = 0.3
export const DETAIL_MIN_W = 38
export const DETAIL_MAX_W = 52

/** The detail pane's width beside the graph, for a pane with `columns` to draw in. */
export function detailWidth(columns: number): number {
  return Math.max(DETAIL_MIN_W, Math.min(DETAIL_MAX_W, Math.floor(columns * DETAIL_SHARE)))
}

/** The design's facts, on the footer's first row: the agents it starts, `agents = 18`, or `agents ≥ 12` where the count is open. */
export function factsLine(design: Design): string {
  const { agents, unknowns } = preflight(design)
  return agentsCount(agents, unknowns)
}

// ---------------------------------------------------------------------------
// The help pages, the run's summary, following the run, the dock's width

/** The help pages: the selected block's type, the graph's marks, the keys, the mouse and the file. */
export const HELP_PAGES = 4

/** What every key does, in the order of the brief's table: the third help page, a table of key and what it does. */
export const KEY_HELP: readonly (readonly [string, string])[] = [
  ['w a s d', 'move the selection'],
  ['Shift+W S', 'move the block one place up / down, into and out of the containers on its way'],
  ['Shift+A D', 'swap an arm with the one beside it'],
  ['Enter  e', 'edit: the ring goes to the name. In a field Tab walks the fields, Enter saves and returns to the graph, Esc saves and hands the keys to the prompt'],
  ['Tab', 'the same field, by the ring\'s own step'],
  ['n  +', 'a new block after this one: pick a block, then its kind, or type either name; n again in the list: inside, before'],
  ['x', 'delete (a container that holds blocks asks: x again); closes the add list and these pages'],
  ['1 2 3', 'step the model, the effort, the votes (the chips on the selected card)'],
  ['o  b', 'open the selected container as the view / back up one level'],
  ['i', 'hide or show this pane'],
  ['u  y', 'undo / redo'],
  ['g', 'the goal: what the workflow is for'],
  ['q', 'ask Claude to review the design (fills the prompt)'],
  ['r', 'run: puts the request in the prompt; add what to run it on, then Enter'],
  ['c', 'put away the results of a run that is over (the first edit does too)'],
  ['?  h', 'these pages, one after the other'],
]

/** One row of a help page: its title, a row of a paragraph, a blank row between two, or a row of a table (`key` empty where its text goes on). */
export type HelpRow = { kind: 'title' | 'text' | 'blank'; text: string } | { kind: 'key'; key: string; text: string }

/** Paragraphs as rows no wider than `columns`, a blank row between two. */
function paragraphs(texts: readonly string[], columns: number): HelpRow[] {
  return texts.flatMap((text, index) => [...(index > 0 ? [{ kind: 'blank' as const, text: '' }] : []), ...wrapText(text, columns).map(line => ({ kind: 'text' as const, text: line }))])
}

/** A table of two columns: the first as wide as its longest entry, the second wrapped beside it. */
function table(pairs: readonly (readonly [string, string])[], columns: number): HelpRow[] {
  const room = Math.max(8, columns - helpKeyWidth(pairs))
  return pairs.flatMap(([key, text]) => wrapText(text, room).map((line, index) => ({ kind: 'key' as const, key: index === 0 ? key : '', text: line })))
}

/** The cells a table's first column takes, the gap after it counted. */
export function helpKeyWidth(pairs: readonly (readonly [string, string])[] = KEY_HELP): number {
  return Math.max(...pairs.map(([key]) => key.length)) + 2
}

/** The cells the first column of help page `page` takes; 0 for a page that holds no table. */
export function helpColumn(page: number): number {
  return page === 2 ? helpKeyWidth(LEGEND) : page === 3 ? helpKeyWidth(KEY_HELP) : 0
}

/** What the first help page says on the start screen, where no block is selected and no design is open. */
export const START_HELP: readonly string[] = [
  'A design is a workflow drawn as a graph of blocks: agents, the code between them, and the containers that run them in a row, at once or in a loop.',
  'w and s choose a row, Enter opens it. A saved design opens as it was left; a template starts a new design, and Blank an empty one.',
  'Nothing is written until the first edit. /conductor design <name> names a new design first, /conductor rename <old> <new> names it later.',
  '/conductor draft <name> <what you want> has Claude draft a design on the board; in an open design, a plain message to Claude changes it.',
]

/** One help page as rows no wider than `columns`: its title, then paragraphs or a table. `page` counts from 1; `start` is the start screen's first page. */
export function helpPage(page: number, block: BlockRef | undefined, file: string, columns: number, start: boolean = false): HelpRow[] {
  const width = Math.max(12, columns)
  const title = (text: string): HelpRow[] => [{ kind: 'title', text: clip(text, width) }, { kind: 'blank', text: '' }]
  const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
  if (start && page === 1) return [...title('Starting a design'), ...paragraphs(START_HELP, width)]
  if (start && page === 4) return [...title('Mouse'), ...paragraphs(MOUSE_HELP, width)]
  if (page === 1) return block ? [...title(`The ${typeName(block)} block`), ...paragraphs([`${cap(teachOf(block).hint)}.`, `${cap(useWhen(block))}.`, ...teachOf(block).card], width)] : [...title('The selected block'), ...paragraphs(['Select a block to read about its type.'], width)]
  if (page === 2) return [...title('What the graph shows'), ...table(LEGEND, width)]
  if (page === 3) return [...title('Keys'), ...table(KEY_HELP, width)]
  return [...title('Mouse and file'), ...paragraphs([...MOUSE_HELP, `This design is saved in ${file}.`], width)]
}

/**
 * A help page cut to `rows` rows: the blank rows between its paragraphs go first (the one under the title last),
 * then what is left is cut.
 */
export function fitHelp(page: readonly HelpRow[], rows: number): HelpRow[] {
  const out = [...page]
  for (let at = out.length - 1; at >= 0 && out.length > rows; at--) if (out[at]?.kind === 'blank') out.splice(at, 1)
  return out.slice(0, Math.max(0, rows))
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
 * (and with it the graph's scroll) is on the block that is running. Returns `ui`
 * itself when nothing changes, and always once the person has moved the selection.
 */
export function followRun(ui: DesignUi, design: Design | null, run: RunState, runDesign: string | null): DesignUi {
  if (!ui.follow || !design || ui.status !== 'ready' || runDesign === null || ui.name !== runDesign || run.status !== 'running') return ui
  const id = runningBlock(design, run)
  if (id === null || id === ui.selectedId) return ui
  return { ...ui, selectedId: id, confirmId: null, editing: false, freshId: null }
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
  return { ...ui, follow: false, selectedId: id, confirmId: null, editing: false, freshId: null }
}

/** The columns of the terminal the dock leaves to the transcript: a sliver, the prompt stays full width. */
export const DOCK_MARGIN = 30

/**
 * The columns to ask the dock for: the terminal's less DOCK_MARGIN. Undefined with the
 * width unknown: nothing is asked, and the dock keeps the width it has.
 */
export function dockColumns(terminal: number | undefined): number | undefined {
  if (terminal === undefined || !Number.isFinite(terminal) || terminal <= 0) return undefined
  return Math.max(40, Math.floor(terminal) - DOCK_MARGIN)
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
