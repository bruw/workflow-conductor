// What the project pane does to its state, as pure steps: opening a project, starting one from a template, applying a
// message from the graph, a key or an edit. The hooks module reads state, calls one of these, writes state and saves.

import type { AgentStatus, NodeRun, RunState } from '../run/events'
import { UNMAPPED_ID, canOpen, graphColumns, moveTarget, navigate, parentView, viewFor } from '../ui/graph-layout'
import type { Direction, GraphLayout } from '../ui/graph-layout'
import { LEGEND, MOUSE_HELP, graphLayout } from '../ui/graph-model'
import type { GraphMessage, GraphProps } from '../ui/graph-model'
import type { RunOverlay } from '../ui/graph-paint'
import { KEY_OPS, LOCKED_OPS } from '../ui/keys'
import type { KeyOp } from '../ui/keys'
import { fmtDuration, fmtCount } from '../ui/rail'
import { clip, wrapText } from '../ui/text'
import { REDO_HINT, UNDO_HINT } from './history'
import { lint } from './lints'
import { NODE_TYPES, blockCount, canHoldChildren, emptyProject, findNode, flatten, goalOf, isBlank, isProjectName, kindsOf, parseProject, toKebab, typeName } from './model'
import type { ParseResult, Project, ProjectNode, NodeType } from './model'
import { addNode, addPlace, moveNode, placeFor, removeNode, retypeNode, stepKnob, updateNode } from './ops'
import type { NodePatch, OpResult, Place } from './ops'
import { PALETTE, defaultName, fieldWord, searchBlocks, startsName, teachOf, useWhen } from './teach'
import type { BlockRef } from './teach'
import type { Template } from './templates'
import { TEMPLATES } from './templates'

export const PROJECT_PANE_ID = 'conductor-project'
export const PROJECT_PANE_TITLE = 'Conductor project'
export const PROJECT_DIR = '.claude/workflow-conductor'
export const BLANK_TEMPLATE_ID = 'blank'
export const DEFAULT_PROJECT_NAME = 'untitled'

/** `pick`: the start screen. `error`: the saved file could not be read. */
export type ProjectStatus = 'closed' | 'pick' | 'ready' | 'error'

export type ProjectUi = {
  /** The file's name: kebab-case, no extension. */
  name: string
  status: ProjectStatus
  error: string | null
  /** A node id, or UNMAPPED_ID while a run has agents no block claims. */
  selectedId: string | null
  /** The help page shown in the detail pane, from 1; 0 while it is closed. */
  help: number
  /** The last refused edit or failed save, shown in the pane until the next edit. */
  notice: string | null
  /**
   * The add list. `anchorId` and `where`: the block it was opened on and which side of it the place is. `retypeId`: it picks that block's type instead.
   * `block`: the type whose kinds it lists while nothing is typed; `nav`: the keys typed since it opened, in case they start a name; `lead`: the ones that did, which open `query`.
   */
  picker: { at: Place; query: string; retypeId?: string; anchorId?: string; where?: AddWhere; pick?: number; block?: NodeType; nav?: string; lead?: string } | null
  /** The container a first delete asked about; a second one on it removes it. */
  confirmId: string | null
  /** The container opened as the view (`o`). Null at the root. */
  viewRootId: string | null
  /** By container id: the first arm its carousel shows. The layout moves it to hold the selected arm; what it settled on is kept here. */
  carousels: Record<string, number>
  /** The detail pane is hidden (`i`). Kept across projects. */
  detailHidden: boolean
  /** The project was started from a template and nothing has written it to its file yet. */
  unsaved: boolean
  /** The ring is in a field of the selected block, or on its way to one. */
  editing: boolean
  /** Blocks an edit from chat just touched: the graph marks them for a moment. `seq` counts the edits; the ids are emptied once shown. */
  flash: { ids: string[]; seq: number } | null
  /** During a run the selection goes to the block that is running, until the person moves it themselves. */
  follow: boolean
  /** `wait`: nothing has arrived yet, and the splash is shown. `show`: the draft is laid out block by block, and editing is locked until Claude's turn ends. */
  drafting: 'wait' | 'show' | null
  /** While a draft is laid out: how many of its blocks the graph shows so far, in reading order. Null: all of them. */
  reveal: number | null
  /** The block just added: its title field opens empty (the default title shown dim), ready to be typed over. */
  freshId: string | null
  /** The block last selected in each project opened this session, by project name: reopening one goes back to it. */
  picks: Record<string, string>
  /** The results of a finished run were put away (by the first edit after it, or the key): the project is shown bare until the next run. */
  runCleared: boolean
  /** The saved projects, as read when the start screen was opened: it lists them above the templates. */
  saved: SavedProject[]
  /** A request (`r`, `q`) waits in the prompt box and the pane still holds the keyboard: no key is acted on until the person takes the keys to the prompt. */
  handed: boolean
  /** The start screen's marked entry, from 0, over `startEntries`: the saved projects, the templates, Blank. */
  startMark: number
  /** The start screen was opened from this project (`p`, a press on the header's name): it lists the projects, and `p` goes back to this one. */
  back: string | null
}

export type SavedProject = { name: string; blocks: number; goal: string }

/** Names kept for replays: such a project lives in the session only, is never saved and never listed. */
export const SCRATCH_PREFIX = 'replay-'

export function isSaved(name: string): boolean {
  return !name.startsWith(SCRATCH_PREFIX)
}

export function savedProject(name: string, text: string): SavedProject {
  return savedEntry(name, parseProject(text))
}

export function savedEntry(name: string, parsed: ParseResult): SavedProject {
  return parsed.ok ? { name, blocks: blockCount(parsed.project), goal: goalOf(parsed.project) } : { name, blocks: -1, goal: 'not a valid project file' }
}

export function freeName(taken: readonly string[]): string {
  if (!taken.includes(DEFAULT_PROJECT_NAME)) return DEFAULT_PROJECT_NAME
  for (let n = 2; ; n++) if (!taken.includes(`${DEFAULT_PROJECT_NAME}-${n}`)) return `${DEFAULT_PROJECT_NAME}-${n}`
}

/** What the tracker is told of a project handed off. A run of a script that is not labelled by id is put on the blocks by `match`. */
export function handoffOf(name: string, project: Project): { name: string; nodeIds: string[]; titles: Record<string, string>; match: Record<string, string[]> } {
  const rows = flatten(project)
  return {
    name,
    nodeIds: rows.map(row => row.node.id),
    titles: Object.fromEntries(rows.map(row => [row.node.id, row.node.name])),
    match: Object.fromEntries(rows.flatMap(row => (row.node.match ? [[row.node.id, row.node.match]] : []))),
  }
}

/** The room the graph is drawn in. The keys walk the layout made for it. */
export type GraphBox = { columns: number; rows: number }

/** The room assumed where none was told (nothing drawn yet). */
export const GRAPH_BOX: GraphBox = { columns: 100, rows: 40 }

export type RunContext = {
  /** A run of this project is in progress, or Claude is drafting it: every edit is refused. */
  locked?: boolean
  /** The lock is a draft's, not a run's. */
  drafting?: boolean
  run?: RunState
  /** The graph's region as last drawn. */
  graph?: GraphBox
}

export const LOCK_NOTICE = 'run in progress · editing locked'
export const DRAFT_LOCK_NOTICE = 'Claude is drafting · editing opens when it is done'
export function lockNotice(context: Pick<RunContext, 'drafting'>): string {
  return context.drafting ? DRAFT_LOCK_NOTICE : LOCK_NOTICE
}

export type AddWhere = 'after' | 'inside' | 'before'

/** `what` says a change in words (`deleted n7 "verify"`): the undo history keeps it. */
export type Step = { project: Project | null; ui: ProjectUi; changed: boolean; what?: string }

/** What is said while a request waits in the prompt box and the pane could not hand the keys over. */
export const HANDED_NOTICE = 'keys are off here while the prompt box holds text · Esc returns to the prompt'
/** The cue drawn while the pane does not hold the keyboard. */
export const KEYS_CUE = 'Input: prompt · click the graph or /conductor'

/** A notice as it may follow the cue while the keys are in the prompt: without the key it ends on, and not at all when it names any other key. */
export function withoutKeys(text: string): string | null {
  // A request waiting in the prompt box speaks of the prompt's own Enter: true while the keys are there.
  if (/^(run|ask|draft): /.test(text)) return text
  const bare = text.endsWith(` · ${UNDO_HINT}`) ? text.slice(0, -UNDO_HINT.length - 3) : text.endsWith(` · ${REDO_HINT}`) ? text.slice(0, -REDO_HINT.length - 3) : text
  return /\[[^\]]+\]|(^|[\s(])[a-zA-Z?+]( again|: | adds )/.test(bare) || /\b(Enter|Esc|Tab|Shift)\b/i.test(bare) ? null : bare
}

export function isDefaultName(name: string): boolean {
  return name === DEFAULT_PROJECT_NAME || new RegExp(`^${DEFAULT_PROJECT_NAME}-\\d+$`).test(name)
}

/** A notice that only informs is drawn plain; anything else is a refusal or a question. */
export function noticeInforms(text: string): boolean {
  return text.endsWith(UNDO_HINT) || text.endsWith(REDO_HINT) || /^(run|ask|undone|redone): /.test(text) || text.startsWith('named ')
}

export function initialUi(): ProjectUi {
  return {
    name: DEFAULT_PROJECT_NAME,
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
    drafting: null,
    reveal: null,
    freshId: null,
    picks: {},
    runCleared: false,
    saved: [],
    handed: false,
    startMark: 0,
    back: null,
  }
}

/** What outlives the project shown: whether the detail pane is hidden, and the selection each project was left with. */
export function carryUi(previous: ProjectUi, next: ProjectUi): ProjectUi {
  const picks = { ...(previous.picks ?? {}) }
  if (previous.status === 'ready' && previous.selectedId !== null && previous.selectedId !== UNMAPPED_ID) picks[previous.name] = previous.selectedId
  return { ...next, detailHidden: previous.detailHidden === true, picks }
}

export function overlaysProject(run: RunState, runProject: string | null, ui: ProjectUi): boolean {
  return runProject !== null && runProject === ui.name && ui.status === 'ready' && run.status !== 'idle' && ui.runCleared !== true
}

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

/** `n3: verify auth` → `verify auth`. */
export function agentTitle(agent: { label: string; agentId: string; nodeId?: string }): string {
  const label = agent.nodeId === undefined ? agent.label : agent.label.replace(/^n\d+\b[:\s]*/, '')
  return label.trim() || agent.agentId
}

/** For UNMAPPED_ID, the agents no block claims. Failures first. */
export function agentsOf(run: RunState, id: string): { shown: AgentLine[]; rest: number } {
  const all = id === UNMAPPED_ID ? run.unmapped.map(one => run.agents[one]).filter(one => one !== undefined) : Object.values(run.agents).filter(agent => agent.nodeId === id)
  const sorted = [...all].sort((a, b) => ORDER[a.status] - ORDER[b.status])
  const shown = sorted.slice(0, AGENT_ROWS_MAX).map(agent => ({ agentId: agent.agentId, title: agentTitle(agent), status: agent.status, tokens: agent.tokens }))
  return { shown, rest: sorted.length - shown.length }
}

/** Null where words were given and none of them can be kept: never another project's name in their place. */
export function projectName(args: string): string | null {
  return toKebab(args.trim() || DEFAULT_PROJECT_NAME) || null
}

export function projectFile(root: string, name: string): string {
  return `${root.replace(/\/+$/, '')}/${PROJECT_DIR}/${name}.json`
}

/** `text` is the saved file's content, undefined when there is none. A project opened before in this session comes back with the block it was left on. */
export function openProject(name: string, text: string | undefined, previous?: ProjectUi): Step {
  const ui: ProjectUi = { ...(previous ? carryUi(previous, initialUi()) : initialUi()), name }
  if (text === undefined) return { project: null, ui: { ...ui, status: 'pick' }, changed: false }
  if (!isProjectName(name)) return { project: null, ui: { ...ui, status: 'error', error: "the file's name must be lowercase letters, digits and dashes (a-z, 0-9, -)" }, changed: false }
  const parsed = parseProject(text)
  if (!parsed.ok) return { project: null, ui: { ...ui, status: 'error', error: parsed.error }, changed: false }
  // The file's name is the project's: a copy of a file, or one renamed by hand, still says the name it was made under.
  const project = parsed.project.name === name ? parsed.project : { ...parsed.project, name }
  const left = ui.picks[name]
  const selectedId = left !== undefined && findNode(project, left) ? left : firstPick(project)
  return { project, ui: { ...ui, status: 'ready', selectedId }, changed: false }
}

/** The start block: its goal is the first thing a new project is asked for. */
function firstPick(project: Project): string | null {
  return project.nodes[0]?.id ?? null
}

export function startProject(ui: ProjectUi, templateId: string): Step {
  if (ui.status !== 'pick') return { project: null, ui, changed: false }
  const template = TEMPLATES.find(one => one.id === templateId)
  const project: Project = template ? { ...template.make(), name: ui.name } : emptyProject(ui.name)
  return {
    project,
    ui: { ...ui, status: 'ready', error: null, notice: null, selectedId: firstPick(project), unsaved: true },
    // Nothing is written until the first edit: a template looked at and left is not a saved project.
    changed: false,
  }
}

/** The first `count` blocks in reading order: what the graph shows of a draft while it is laid out block by block. */
export function firstBlocks(project: Project, count: number): Project {
  if (count >= flatten(project).length) return project
  let left = Math.max(0, count)
  const take = (nodes: readonly ProjectNode[]): ProjectNode[] => {
    const out: ProjectNode[] = []
    for (const node of nodes) {
      if (left <= 0) break
      left--
      out.push(node.children ? { ...node, children: take(node.children) } : node)
    }
    return out
  }
  return { ...project, nodes: take(project.nodes) }
}

/** A draft is laid out a beat a step, more blocks to a step where it is large: all of it is on the graph within this many steps. */
export const REVEAL_STEPS = 12

export type StartEntry = { kind: 'saved' | 'template' | 'blank' | 'replay' | 'recording'; id: string; title: string; blocks: number; note: string }

/** The recorded runs the start screen replays in the run view, by the name of their fixture. */
export const RECORDINGS = ['review-41', 'partial-29'] as const

/** In the order `w` / `s` walk them. Under the projects: what is not a project to open. */
export function startEntries(saved: readonly SavedProject[], templates: readonly Template[] = TEMPLATES): StartEntry[] {
  // Each template is made once: its count is said on two rows.
  const blocks = templates.map(one => blockCount(one.make()))
  return [
    ...saved.map(one => ({ kind: 'saved' as const, id: one.name, title: one.name, blocks: one.blocks, note: one.goal })),
    ...templates.map((one, at) => ({ kind: 'template' as const, id: one.id, title: one.title, blocks: blocks[at] ?? 0, note: one.blurb })),
    { kind: 'blank' as const, id: BLANK_TEMPLATE_ID, title: 'Blank', blocks: 0, note: 'An empty project' },
    ...templates.map((one, at) => ({ kind: 'replay' as const, id: one.id, title: one.title, blocks: blocks[at] ?? 0, note: 'A made-up run over the template, nothing saved' })),
    ...RECORDINGS.map(one => ({ kind: 'recording' as const, id: one, title: one, blocks: 0, note: 'A recorded run, in the run view' })),
  ]
}

/** The rows a block count is said of. */
export function isProjectEntry(entry: Pick<StartEntry, 'kind'>): boolean {
  return entry.kind === 'saved' || entry.kind === 'template' || entry.kind === 'replay'
}

/** Returns `ui` itself where the mark stays. */
export function moveStartMark(ui: ProjectUi, by: number): ProjectUi {
  const last = startEntries(ui.saved ?? []).length - 1
  const startMark = Math.max(0, Math.min(last, (ui.startMark ?? 0) + by))
  return startMark === (ui.startMark ?? 0) ? ui : { ...ui, startMark, notice: null }
}

/** `count` rows of a list of `total` around the marked one: the first row shown. */
export function listWindow(total: number, count: number, marked: number): number {
  return Math.max(0, Math.min(total - count, marked - Math.floor((count - 1) / 2)))
}

export function blocksWord(blocks: number): string {
  return blocks < 0 ? 'unreadable' : `${blocks} ${blocks === 1 ? 'block' : 'blocks'}`
}

/** The start screen's preview: nothing selected and every edit locked out. */
export function previewProps(project: Project, box: GraphBox = GRAPH_BOX): GraphProps {
  return { project, mode: 'run', selectedId: null, viewRootId: null, problems: {}, openAt: null, scroll: {}, columns: graphColumns(box.columns), rows: Math.max(1, box.rows), unmapped: 0, wheel: { from: '', rows: 0 } }
}

export function whereIs(project: Project, id: string): string {
  const row = flatten(project).find(one => one.node.id === id)
  if (!row) return ''
  const parent = row.parentId === undefined ? undefined : findNode(project, row.parentId)
  const before = (parent ? (parent.children ?? []) : project.nodes)[row.index - 1]
  if (before) return parent ? `after ${before.id} (in ${parent.id})` : `after ${before.id}`
  return parent ? `first in ${parent.id}` : 'to the start'
}

function settle(project: Project, ui: ProjectUi, result: OpResult, selectedId: string | null, what: string | ((after: Project) => string) = '', context: RunContext = {}): Step {
  if (result.error) return { project, ui: { ...ui, notice: result.error }, changed: false }
  // An edit that leaves every block as it was (Enter on a field nobody changed) is no change: nothing to save, nothing to undo.
  const changed = result.project !== project && JSON.stringify(result.project) !== JSON.stringify(project)
  const after = changed ? result.project : project
  const kept = selectedId !== null && findNode(after, selectedId) ? selectedId : null
  const said = !changed ? '' : typeof what === 'string' ? what : what(after)
  // The first edit after a run puts its results away: nothing is edited under stale counts.
  const next: ProjectUi = { ...ui, selectedId: kept, notice: said === '' ? null : `${said} · ${UNDO_HINT}`, runCleared: changed ? true : ui.runCleared, unsaved: changed ? false : ui.unsaved }
  return { project: after, ui: shown(after, next, context), changed, ...(said === '' ? {} : { what: said }) }
}

// The view: a container opened with `o`, and the graph laid out for it

export function insideOf(project: Project, rootId: string, id: string): boolean {
  const root = findNode(project, rootId)
  return root !== undefined && (root.id === id || flatten({ ...project, nodes: root.children ?? [] }).some(row => row.node.id === id))
}

/**
 * `viewRootId` while that block draws the selection. Where it does not (a run followed, an edit from chat, undo: the person's own keys
 * never leave the view), the view follows: the whole project when that draws the selected block, else the outermost container that does.
 */
export function viewRootOf(project: Project | null, ui: Pick<ProjectUi, 'viewRootId' | 'selectedId'>, columns: number = GRAPH_BOX.columns): string | null {
  if (project === null) return null
  const root = ui.viewRootId ? findNode(project, ui.viewRootId) : undefined
  const held = root && canHoldChildren(root.type) ? root.id : null
  if (ui.selectedId === null || ui.selectedId === UNMAPPED_ID || !findNode(project, ui.selectedId)) return held
  return viewFor(project, held, ui.selectedId, graphColumns(columns))
}

/** All of the graph's props but the wheel's rows: the hooks module counts them. */
export function graphProps(project: Project, ui: ProjectUi, box: GraphBox = GRAPH_BOX, run?: RunOverlay): GraphProps {
  const locked = run?.status === 'running' || ui.drafting === 'show'
  const problems: Record<string, number> = {}
  for (const one of lint(project)) problems[one.nodeId] = (problems[one.nodeId] ?? 0) + 1
  const props: GraphProps = {
    project,
    mode: locked ? 'run' : 'project',
    selectedId: ui.selectedId,
    viewRootId: viewRootOf(project, ui, box.columns),
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
  if (ui.drafting && isBlank(project)) props.emptyNote = DRAFTING_NOTE
  if (run) props.run = run
  return props
}

/** The graph as the Client draws it for this state: what the keys walk. */
export function graphOf(project: Project, ui: ProjectUi, context: RunContext = {}): GraphLayout {
  return graphLayout(graphProps(project, ui, context.graph, context.run ? runOverlay(context.run) : undefined))
}

/** Every carousel's window is kept where the layout left it, so it stays there when the selection goes elsewhere. Returns `ui` itself when nothing moves. */
function shown(project: Project, ui: ProjectUi, context: RunContext = {}): ProjectUi {
  const layout = graphOf(project, ui, context)
  const carousels = { ...(ui.carousels ?? {}), ...layout.scroll }
  return layout.viewRootId === (ui.viewRootId ?? null) && JSON.stringify(carousels) === JSON.stringify(ui.carousels ?? {}) ? ui : { ...ui, viewRootId: layout.viewRootId, carousels }
}

/** The breadcrumb after the project's name, outermost first. */
export function crumbs(project: Project, rootId: string | null): { id: string; title: string }[] {
  if (rootId === null) return []
  const rows = flatten(project)
  const out: { id: string; title: string }[] = []
  for (let row = rows.find(one => one.node.id === rootId); row; row = row.parentId === undefined ? undefined : rows.find(one => one.node.id === row?.parentId)) out.unshift({ id: row.node.id, title: row.node.name })
  return out
}

export function blockName(node: { id: string; name: string }): string {
  return `${node.id} ${clip(node.name, 24)}`
}

/** The selection goes to a block the step brought back, so the graph scrolls to what changed; else it stays where it can. */
export function restoreProject(project: Project | null, ui: ProjectUi, target: Project, way: 'undo' | 'redo', what: string, context: RunContext = {}): Step {
  if (!project || ui.status !== 'ready') return { project, ui, changed: false }
  if (context.locked) return { project, ui: { ...ui, notice: lockNotice(context) }, changed: false }
  const had = new Set(flatten(project).map(row => row.node.id))
  const back = flatten(target).find(row => !had.has(row.node.id))?.node.id
  const selectedId = back ?? (ui.selectedId !== null && findNode(target, ui.selectedId) ? ui.selectedId : (target.nodes[0]?.id ?? null))
  const notice = way === 'undo' ? `undone: ${what} · ${REDO_HINT}` : `redone: ${what} · ${UNDO_HINT}`
  const next: ProjectUi = { ...ui, selectedId, notice, confirmId: null, picker: null, editing: false, freshId: null, runCleared: true, unsaved: false }
  return { project: target, ui: shown(target, next, context), changed: true }
}

export function nothingToRestore(ui: ProjectUi, way: 'undo' | 'redo'): ProjectUi {
  return { ...ui, confirmId: null, notice: way === 'undo' ? 'nothing to undo' : 'nothing to redo' }
}

/** `moved n7 into n4`, `moved n7 out of n4`, `moved n7 after n3`. */
function movedWords(before: Project, after: Project, id: string): string {
  const from = flatten(before).find(row => row.node.id === id)?.parentId
  const to = flatten(after).find(row => row.node.id === id)?.parentId
  if (from === to) return `moved ${id} ${whereIs(after, id)}`
  // Out: to the top level, or to a container around the one it was in.
  if (from !== undefined && (to === undefined || insideOf(after, to, from))) return `moved ${id} out of ${from}`
  return `moved ${id} into ${to ?? 'the top level'}`
}

/** A refused edit leaves the project as it was and sets `notice`. */
export function applyMessage(project: Project | null, ui: ProjectUi, message: GraphMessage, context: RunContext = {}): Step {
  if (!project || ui.status !== 'ready') return { project, ui, changed: false }
  if (message.kind === 'key') {
    const op = KEY_OPS[message.key]
    return op ? applyOp(project, ui, op, context) : { project, ui, changed: false }
  }
  // A press that asked for nothing still gave the graph the keyboard, and is a click away from the add list: it closes.
  if (message.kind === 'touch') return { project, ui: ui.picker !== null ? { ...ui, picker: null } : ui, changed: false }
  // What only changes what is shown works while a run locks the project too.
  const calm: ProjectUi = { ...ui, confirmId: null, picker: null, editing: false, freshId: null }
  if (message.kind === 'select') {
    const strays = message.id === UNMAPPED_ID && (context.run?.unmapped.length ?? 0) > 0
    const selectedId = message.id !== null && (strays || findNode(project, message.id)) ? message.id : null
    const same = selectedId === ui.selectedId
    // The person chose a block: the selection stops following the run.
    return { project, ui: shown(project, { ...calm, selectedId, follow: false, notice: same ? ui.notice : null, editing: ui.editing && same, freshId: same ? ui.freshId : null }, context), changed: false }
  }
  if (message.kind === 'view') {
    const now = viewRootOf(project, ui, context.graph?.columns)
    if (message.id === now) return { project, ui, changed: false }
    const trail = crumbs(project, now)
    const at = message.id === null ? -1 : trail.findIndex(one => one.id === message.id)
    if (message.id !== null && at < 0 && !canOpen(project, now, message.id)) return { project, ui: { ...ui, notice: `${message.id} holds no blocks to open` }, changed: false }
    // A crumb: up to that view, the selection on the container the way down went through. Else a container, opened: it is selected.
    const selectedId = message.id === null || at >= 0 ? (trail[at + 1]?.id ?? ui.selectedId) : message.id
    const root = message.id === null ? undefined : findNode(project, message.id)
    const notice = !root ? 'back to the whole project' : at >= 0 ? `back to ${blockName(root)}` : `opened ${blockName(root)} · b: back`
    return { project, ui: shown(project, { ...calm, viewRootId: message.id, selectedId, follow: false, notice }, context), changed: false }
  }
  if (message.kind === 'slide') {
    const stack = findNode(project, message.id)
    const window = graphOf(project, ui, context).carousels[message.id]
    if (!stack || !window) return { project, ui, changed: false }
    const first = Math.max(0, Math.min(window.count - window.shown, message.first))
    // The window always holds the selected arm. Slid out from under it, the selection steps back to the container the arms are in.
    const arm = ui.selectedId === null ? -1 : (stack.children ?? []).findIndex(child => insideOf(project, child.id, ui.selectedId ?? ''))
    const leaves = arm >= 0 && (arm < first || arm >= first + window.shown)
    const slid: ProjectUi = { ...ui, carousels: { ...(ui.carousels ?? {}), [stack.id]: first } }
    return { project, ui: leaves ? shown(project, { ...slid, ...calm, carousels: slid.carousels, selectedId: stack.id, follow: false, notice: null }, context) : slid, changed: false }
  }
  if (context.locked) return { project, ui: { ...calm, notice: lockNotice(context) }, changed: false }
  switch (message.kind) {
    case 'move':
      return settle(project, { ...ui, confirmId: null }, moveNode(project, message.id, message.to), message.id, after => movedWords(project, after, message.id), context)
    case 'addAt': {
      const parent = message.at.parentId === undefined ? undefined : findNode(project, message.at.parentId)
      if (message.at.parentId !== undefined && (!parent || !canHoldChildren(parent.type))) {
        return { project, ui: { ...ui, notice: `${message.at.parentId} holds no blocks` }, changed: false }
      }
      return { project, ui: { ...calm, notice: null, help: 0, detailHidden: false, picker: { at: message.at, query: '' } }, changed: false }
    }
    case 'knob': {
      const stepped = stepKnob(project, message.id, message.slot)
      return settle(project, calm, stepped, ui.selectedId, `${message.id} ${stepped.knob ?? ''}: ${stepped.value ?? ''}`, context)
    }
  }
}

export function patchNode(project: Project | null, ui: ProjectUi, id: string, patch: NodePatch, context: RunContext = {}): Step {
  if (!project || ui.status !== 'ready') return { project, ui, changed: false }
  if (context.locked) return { project, ui: { ...ui, notice: lockNotice(context), editing: false, freshId: null }, changed: false }
  const fields = [...(patch.name !== undefined ? ['name'] : []), ...('logic' in patch ? ['logic'] : []), ...Object.keys(patch.knobs ?? {})].map(fieldWord)
  return settle(project, { ...ui, editing: false, freshId: null }, updateNode(project, id, patch), ui.selectedId, `${id} changed${fields.length > 0 && fields.length <= 3 ? `: ${fields.join(', ')}` : ''}`, context)
}

/** The block keeps its name, its logic, what it holds and every knob that was typed (`retypeNode`). */
export function retypeBlock(project: Project | null, ui: ProjectUi, id: string, to: BlockRef, context: RunContext = {}): Step {
  if (!project || ui.status !== 'ready') return { project, ui, changed: false }
  if (context.locked) return { project, ui: { ...ui, notice: lockNotice(context), editing: false, freshId: null }, changed: false }
  const node = findNode(project, id)
  const retyped = retypeNode(project, id, to.type, to.kind)
  // A block still called after its old type or kind (the name it was added with) takes the new one's.
  const renamed = !retyped.error && node && node.name === defaultName(node) && defaultName(to) !== node.name ? updateNode(retyped.project, id, { name: defaultName(to) }) : retyped
  return settle(project, { ...ui, editing: false, freshId: null, picker: null }, renamed, ui.selectedId, `${id} is now ${typeName(to)}`, context)
}

export function retypeChoices(node: { type: NodeType; children?: readonly unknown[] }): NodeType[] {
  if (node.type === 'start') return []
  return NODE_TYPES.filter(type => type !== 'start' && ((node.children?.length ?? 0) === 0 || canHoldChildren(type)))
}

const FIRST_BLOCK = 'the first block'

/** `after n4 (in n2)`, `first in n2`, `at the end`: the place is a list and an index; the words name the neighbour. */
export function placeLabel(project: Project, at: Place): string {
  const parent = at.parentId === undefined ? undefined : findNode(project, at.parentId)
  const list = parent ? (parent.children ?? []) : project.nodes
  const before = list[at.index - 1]
  if (before) return parent ? `after ${before.id} (in ${parent.id})` : at.index >= list.length ? `after ${before.id} (at the end)` : `after ${before.id}`
  return parent ? `first in ${parent.id}` : list.length === 0 ? FIRST_BLOCK : 'at the start'
}

export function placeBy(project: Project, id: string | null, where: AddWhere): Place {
  const row = id === null ? undefined : flatten(project).find(one => one.node.id === id)
  if (!row) return { index: project.nodes.length }
  if (where === 'inside') return { parentId: row.node.id, index: row.node.children?.length ?? 0 }
  const index = where === 'after' ? row.index + 1 : row.index
  return row.parentId === undefined ? { index } : { parentId: row.parentId, index }
}

/** The sides `n` goes round. Nothing goes before the start block. */
export function addSides(node: Pick<ProjectNode, 'type'>): AddWhere[] {
  if (node.type === 'start') return ['after']
  return canHoldChildren(node.type) ? ['after', 'inside', 'before'] : ['after', 'before']
}

/** As `n` opens it on a block (`addPlace`). `frame`: the block is the one the view shows. */
export function openAdd(project: Project, node: ProjectNode | undefined, frame: boolean = false): NonNullable<ProjectUi['picker']> {
  if (!node) return { at: addPlace(project, null, null), query: '' }
  // The same place the graph lights its `[+]` at.
  const at = addPlace(project, node.id, frame ? node.id : null)
  return { at, query: '', anchorId: node.id, where: at.parentId === node.id ? 'inside' : 'after' }
}

/** `n` pressed in the add list. Returns `ui` itself where there is no block to go round. */
export function cyclePlace(project: Project, ui: ProjectUi): ProjectUi {
  const picker = ui.picker
  const node = picker?.anchorId === undefined ? undefined : findNode(project, picker.anchorId)
  if (!picker || !node || picker.retypeId !== undefined) return ui
  const sides = addSides(node)
  const where = sides[(sides.indexOf(picker.where ?? 'after') + 1) % sides.length] ?? 'after'
  return { ...ui, picker: { ...picker, where, at: placeBy(project, node.id, where) } }
}

/** `New block after n4 Deep read`, `Block n4 Deep read (now agent verify)`; `· which loop?` while it lists a block's kinds. */
export function addHeading(project: Project, picker: NonNullable<ProjectUi['picker']>): string {
  const retyped = picker.retypeId === undefined ? undefined : findNode(project, picker.retypeId)
  const kinds = picker.block !== undefined && picker.query === '' ? ` · which ${picker.block}?` : ''
  if (retyped) return `Block ${blockName(retyped)} (now ${typeName(retyped)})${kinds}`
  const node = picker.anchorId === undefined ? undefined : findNode(project, picker.anchorId)
  if (node) return `New block ${picker.where ?? 'after'} ${blockName(node)}${kinds}`
  const place = placeLabel(project, picker.at)
  return `${place === FIRST_BLOCK ? 'The first block' : `New block ${place}`}${kinds}`
}

function confirmText(project: Project, id: string): string {
  const inside = flatten({ ...project, nodes: findNode(project, id)?.children ?? [] }).length
  return `${id} holds ${inside} ${inside === 1 ? 'block' : 'blocks'}: x again deletes them all (u undoes it)`
}

/** Where the selection lands once `id` and what it holds are gone: the next row, else the one before. */
function afterRemoval(project: Project, id: string): string | null {
  const rows = flatten(project)
  const at = rows.findIndex(row => row.node.id === id)
  const here = rows[at]
  if (!here) return null
  const next = rows.slice(at + 1).find(row => row.depth <= here.depth)
  return next?.node.id ?? rows[at - 1]?.node.id ?? null
}

/** What each digit steps, as a refusal names it. */
const QUICK_NAMES = ['model', 'effort'] as const

const WAYS: Partial<Record<KeyOp, Direction>> = { left: 'left', right: 'right', up: 'up', down: 'down', moveLeft: 'left', moveRight: 'right', moveUp: 'up', moveDown: 'down' }

/** `w a s d` move the selection over the graph as it is drawn, never out of the view; `W A S D` move the block one place, as the layout reads them. */
export function applyOp(project: Project | null, ui: ProjectUi, op: KeyOp, context: RunContext = {}): Step {
  if (!project || ui.status !== 'ready') return { project, ui, changed: false }
  // A request waits in the prompt box: a key typed now is meant for it.
  if (ui.handed) return { project, ui: ui.notice === HANDED_NOTICE ? ui : { ...ui, notice: HANDED_NOTICE }, changed: false }
  const calm: ProjectUi = { ...ui, confirmId: null, notice: null, editing: false, freshId: null, picker: null, viewRootId: viewRootOf(project, ui, context.graph?.columns) }
  const node = ui.selectedId === null ? undefined : findNode(project, ui.selectedId)
  if (context.locked && !LOCKED_OPS.includes(op)) return { project, ui: { ...calm, notice: lockNotice(context) }, changed: false }
  switch (op) {
    case 'left':
    case 'right':
    case 'up':
    case 'down': {
      const selectedId = navigate(project, graphOf(project, calm, context), ui.selectedId === UNMAPPED_ID ? null : (node?.id ?? null), WAYS[op] ?? 'down')
      // The person moved the selection: it stops following the run.
      return { project, ui: shown(project, { ...calm, selectedId, follow: false }, context), changed: false }
    }
    case 'moveUp':
    case 'moveDown':
    case 'moveLeft':
    case 'moveRight': {
      if (!node) return { project, ui: { ...calm, notice: 'move: select a block first' }, changed: false }
      const target = moveTarget(project, graphOf(project, calm, context), node.id, WAYS[op] ?? 'down')
      if (target.to === null) return { project, ui: { ...calm, notice: target.reason }, changed: false }
      return settle(project, calm, moveNode(project, node.id, target.to), node.id, after => movedWords(project, after, node.id), context)
    }
    case 'add':
      return { project, ui: { ...calm, help: 0, detailHidden: false, picker: openAdd(project, node, node !== undefined && node.id === calm.viewRootId) }, changed: false }
    case 'retype': {
      if (!node) return { project, ui: { ...calm, notice: 'block: select a block first' }, changed: false }
      if (node.type === 'start') return { project, ui: { ...calm, notice: 'the start block stays the start block' }, changed: false }
      return openRetype(project, { ...calm, detailHidden: false }, node.id, context)
    }
    case 'remove': {
      // While a help page is open `x` closes it, and deletes nothing.
      if ((ui.help ?? 0) > 0) return { project, ui: { ...calm, help: 0 }, changed: false }
      if (!node) return { project, ui: { ...calm, notice: 'delete: select a block first' }, changed: false }
      const held = node.children?.length ?? 0
      if (held > 0 && ui.confirmId !== node.id) {
        return { project, ui: { ...calm, confirmId: node.id, notice: confirmText(project, node.id) }, changed: false }
      }
      // A single block goes at once: `u` brings it back.
      return settle(project, calm, removeNode(project, node.id), afterRemoval(project, node.id), `deleted ${node.id} "${clip(node.name, 24)}"${held > 0 ? ` and what it held` : ''}`, context)
    }
    case 'knob1':
    case 'knob2': {
      const slot = op === 'knob1' ? 1 : 2
      if (!node) return { project, ui: { ...calm, notice: `${QUICK_NAMES[slot - 1]}: select a block first` }, changed: false }
      const stepped = stepKnob(project, node.id, slot)
      return settle(project, calm, stepped, node.id, `${node.id} ${stepped.knob ?? ''}: ${stepped.value ?? ''}`, context)
    }
    case 'open':
      if (!node) return { project, ui: { ...calm, notice: 'open: select a container first' }, changed: false }
      if (calm.viewRootId === node.id) return { project, ui: { ...calm, notice: `${blockName(node)} is the view · b: back` }, changed: false }
      if (!canOpen(project, calm.viewRootId, node.id)) return { project, ui: { ...calm, notice: `${node.id} is ${/^[aeiou]/.test(node.type) ? 'an' : 'a'} ${node.type}: it holds no blocks to open` }, changed: false }
      return { project, ui: shown(project, { ...calm, viewRootId: node.id, follow: false, notice: `opened ${blockName(node)} · b: back` }, context), changed: false }
    case 'back': {
      const root = calm.viewRootId === null ? undefined : findNode(project, calm.viewRootId)
      if (!root) return { project, ui: { ...calm, notice: 'the view is the whole project already' }, changed: false }
      // One level up: the container around the one shown, and the selection on the one it came out of.
      const outerId = parentView(project, root.id)
      const outer = outerId === null ? undefined : findNode(project, outerId)
      return { project, ui: shown(project, { ...calm, viewRootId: outerId, selectedId: root.id, follow: false, notice: outer ? `back to ${blockName(outer)}` : 'back to the whole project' }, context), changed: false }
    }
    case 'detail':
      return { project, ui: { ...calm, detailHidden: !ui.detailHidden, help: 0, notice: ui.detailHidden ? null : 'details hidden' }, changed: false }
    case 'undo':
    case 'redo':
      // The hooks module holds the history: it answers these before they get here.
      return { project, ui: calm, changed: false }
    case 'edit':
      // The hooks module moves the ring to the block's first field: its name's, the goal's on the start block.
      return { project, ui: node ? { ...calm, editing: true, help: 0, detailHidden: false } : { ...calm, notice: 'edit: select a block first' }, changed: false }
    case 'help':
      return { project, ui: { ...calm, detailHidden: false, help: ((ui.help ?? 0) % HELP_PAGES) + 1 }, changed: false }
    case 'run':
    case 'review':
    case 'projects':
      // The hooks module puts the request in the prompt box, or lists the projects; nothing changes here.
      return { project, ui: calm, changed: false }
    case 'clearRun':
      return { project, ui: context.locked ? { ...calm, notice: lockNotice(context) } : { ...calm, runCleared: true }, changed: false }
    case 'minimize':
      // The hooks module closes the pane and draws the band above the prompt; nothing changes here.
      return { project, ui, changed: false }
    case 'cancel':
      return { project, ui: calm, changed: false }
  }
}

/** The same list as adding, narrowed to what the block may become. */
export function openRetype(project: Project | null, ui: ProjectUi, id: string, context: RunContext = {}): Step {
  if (!project || ui.status !== 'ready' || !findNode(project, id)) return { project, ui, changed: false }
  if (context.locked) return { project, ui: { ...ui, notice: lockNotice(context) }, changed: false }
  return { project, ui: { ...ui, notice: null, confirmId: null, editing: false, freshId: null, help: 0, picker: { at: { index: 0 }, query: '', retypeId: id } }, changed: false }
}

/** `opens`: a block type whose kinds the list shows next. */
export type PickRow = BlockRef & { opens?: boolean }

/**
 * With something typed: every block whose name holds it. With nothing typed: the blocks, and one that has kinds opens on them.
 * A block being retyped lists its own kinds first, and only what it may become.
 */
export function pickerMatches(project: Project | null, picker: NonNullable<ProjectUi['picker']>): PickRow[] {
  const retyped = picker.retypeId === undefined || project === null ? undefined : findNode(project, picker.retypeId)
  const allowed = picker.retypeId === undefined ? null : retypeChoices(retyped ?? { type: 'agent' })
  const may = (row: BlockRef): boolean => allowed === null || allowed.includes(row.type)
  const kinds = (type: NodeType): PickRow[] => kindsOf(type).map(kind => ({ type, kind }))
  if (picker.query.trim() !== '') return searchBlocks(picker.query).filter(may)
  if (picker.block !== undefined) return kinds(picker.block)
  const blocks: PickRow[] = PALETTE.map((entry): PickRow => (kindsOf(entry.type).length > 0 ? { type: entry.type, opens: true } : { type: entry.type })).filter(may)
  return retyped ? [...kinds(retyped.type), ...blocks.filter(row => row.type !== retyped.type)] : blocks
}

/** Returns `ui` itself where the mark stays. */
export function movePick(project: Project | null, ui: ProjectUi, by: number): ProjectUi {
  if (!ui.picker) return ui
  const last = Math.max(0, pickerMatches(project, ui.picker).length - 1)
  const pick = Math.max(0, Math.min(last, (ui.picker.pick ?? 0) + by))
  return pick === (ui.picker.pick ?? 0) ? ui : { ...ui, picker: { ...ui.picker, pick } }
}

/** The key the add list keeps for itself while nothing is typed in its filter: the place. */
export const PICKER_PLACE = 'n'
/** One more while it lists a block's kinds: back to the blocks. */
export const PICKER_BACK = 'b'
/** The key that closes the add list, wherever it is typed: no block's or kind's name holds it. */
export const PICKER_CLOSE = 'x'

function forgetNav(picker: NonNullable<ProjectUi['picker']>): NonNullable<ProjectUi['picker']> {
  const { nav: _nav, lead: _lead, ...rest } = picker
  return rest
}

/**
 * `whole` is all of the filter's text; `taken` counts the characters used as keys (`n`, `b`) while the filter is empty.
 * Names start with those letters too (`budget`, `branch`): keys just taken that start a name with the next character become the filter's `lead`, which the field no longer holds (`filterText`).
 */
export function typePicker(project: Project | null, ui: ProjectUi, whole: string): { ui: ProjectUi; taken: number } {
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
    } else if (key !== PICKER_PLACE) break
    else {
      const cycled = project === null ? next : cyclePlace(project, next)
      // On a list with no block to go round, `n` is a letter like any other.
      if (cycled === next || !cycled.picker) break
      next = { ...cycled, picker: forgetNav(cycled.picker) }
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

/** The lead goes before what the field holds. A field emptied takes the lead with it, so the filter can be cleared by deleting. */
export function filterText(ui: ProjectUi, field: string): string {
  return field === '' ? '' : `${ui.picker?.lead ?? ''}${field}`
}

/** `choice` when a row was pressed, else the marked row. A block that has kinds opens on them. */
export function pickBlock(project: Project | null, ui: ProjectUi, choice: Partial<PickRow> = {}, context: RunContext = {}): Step {
  if (!project || ui.status !== 'ready' || !ui.picker) return { project, ui, changed: false }
  if (context.locked) return { project, ui: { ...ui, picker: null, notice: lockNotice(context) }, changed: false }
  const picker = ui.picker
  const row: PickRow | undefined = choice.type !== undefined ? { ...choice, type: choice.type } : pickerMatches(project, picker)[picker.pick ?? 0]
  if (row === undefined) return { project, ui: { ...ui, notice: 'no block matches that' }, changed: false }
  if (row.opens) return { project, ui: { ...ui, notice: null, picker: { ...forgetNav(picker), block: row.type, query: '', pick: 0 } }, changed: false }
  const block: BlockRef = row.kind === undefined ? { type: row.type } : { type: row.type, kind: row.kind }
  if (picker.retypeId !== undefined) return retypeBlock(project, ui, picker.retypeId, block, context)
  const result = addNode(project, block, picker.at)
  // The place is said as the block got it (`placeFor`).
  const at = placeFor(project, block.type, picker.at)
  const step = settle(project, ui, result, result.id ?? ui.selectedId, after => `added ${result.id ?? ''} ${typeName(block)} ${placeLabel(after, at).replace(/ \(at the end\)$/, '')}`, context)
  // The new block is selected and its title is the next thing typed.
  return step.changed ? { ...step, ui: { ...step.ui, picker: null, editing: true, freshId: result.id ?? null, drafting: null } } : step
}

/** Each has a field of its own in the detail pane; model and effort are stepped on the card. */
export const TEXT_KNOBS = ['goal', 'args', 'condition', 'oncePer', 'stopCondition', 'output'] as const
export type TextKnob = (typeof TEXT_KNOBS)[number]

export const DRAFTING_NOTE = 'Claude is drafting this project: blocks appear here as they are written'
/** Under the splash while a draft is awaited. */
export const DRAFT_WAIT_NOTE = 'Claude is drafting your workflow · answer its questions in the prompt'

// The screen's shape

/** A pane with fewer body columns or rows than these draws no designer: it is minimized into the band above the prompt (`compact.ts`). */
export const FULL_MIN_COLUMNS = 80
export const FULL_MIN_ROWS = 20
/** From this many terminal columns the fullscreen layout docks a pane beside the transcript; under it the pane sits inline above the prompt. */
export const DOCK_MIN_TERMINAL = 110

export function fitsFull(bodyColumns: number, bodyRows: number): boolean {
  return bodyColumns >= FULL_MIN_COLUMNS && bodyRows >= FULL_MIN_ROWS
}

/** The detail pane beside the graph: about this share of the columns, within these bounds. */
export const DETAIL_SHARE = 0.3
export const DETAIL_MIN_W = 34
export const DETAIL_MAX_W = 52

export function detailWidth(columns: number): number {
  return Math.max(DETAIL_MIN_W, Math.min(DETAIL_MAX_W, Math.floor(columns * DETAIL_SHARE)))
}

// The help pages, the run's summary, following the run, the dock's width

/** The help pages: the selected block's type, the graph's marks, the keys, the mouse and the file. */
export const HELP_PAGES = 4

/** The third help page. */
export const KEY_HELP: readonly (readonly [string, string])[] = [
  ['w a s d', 'move the selection'],
  ['Shift+W S', 'move the block one place up / down, into and out of the containers on its way'],
  ['Shift+A D', 'swap an arm with the one beside it'],
  ['Enter  e', 'edit: the ring goes to the name (on the start block, to the goal). In a field Enter saves and returns to the graph, Esc saves and hands the keys to the prompt'],
  ['↑ ↓', 'in a field: the field above / below (↓ from the graph opens the first); past the first or the last: saved, back to the graph. In a list of blocks: choose'],
  ['n  +', 'a new block after this one: pick a block, then its kind, or type either name; n again in the list: inside, before'],
  ['t', 'the block and its kind: pick another from the list'],
  ['x', 'delete (a container that holds blocks asks: x again); closes the add list and these pages'],
  ['1 2', 'step the model, the effort (the chips on the selected card)'],
  ['o  b', 'open the selected container as the view / back up one level'],
  ['i', 'hide or show this pane'],
  ['m', 'minimize the designer into the band above the prompt; there, once the band has the keys (a click on it), the same key expands it again. From the prompt: /conductor min, /conductor max'],
  ['u  y', 'undo / redo'],
  ['q', 'Claude review: asks Claude to review the project (fills the prompt)'],
  ['r', 'implement and run: hands the project to Claude at once; Claude confirms the design and asks what to run it on'],
  ['c', 'put away the results of a run that is over (the first edit does too)'],
  ['p', 'the projects: the saved ones and the templates, to open another or start one; p comes back'],
  ['?  h', 'these pages, one after the other'],
]

/** `key` is empty where a table row's text goes on. */
export type HelpRow = { kind: 'title' | 'text' | 'blank'; text: string } | { kind: 'key'; key: string; text: string }

function paragraphs(texts: readonly string[], columns: number): HelpRow[] {
  return texts.flatMap((text, index) => [...(index > 0 ? [{ kind: 'blank' as const, text: '' }] : []), ...wrapText(text, columns).map(line => ({ kind: 'text' as const, text: line }))])
}

function table(pairs: readonly (readonly [string, string])[], columns: number): HelpRow[] {
  const room = Math.max(8, columns - helpKeyWidth(pairs))
  return pairs.flatMap(([key, text]) => wrapText(text, room).map((line, index) => ({ kind: 'key' as const, key: index === 0 ? key : '', text: line })))
}

/** The gap after the column is counted. */
export function helpKeyWidth(pairs: readonly (readonly [string, string])[] = KEY_HELP): number {
  return Math.max(...pairs.map(([key]) => key.length)) + 2
}

export function helpColumn(page: number): number {
  return page === 2 ? helpKeyWidth(LEGEND) : page === 3 ? helpKeyWidth(KEY_HELP) : 0
}

/** The first help page on the start screen, where no block is selected. */
export const START_HELP: readonly string[] = [
  'A project is a workflow drawn as a graph of blocks: agents, the code between them, and the containers that run them in a row, at once or in a loop.',
  'The Up and Down arrows choose a row (w and s too), Enter opens it. A saved project opens as it was left; a template starts a new project, and Blank an empty one.',
  `Nothing is written until the first edit. Each saved project is a file in ${PROJECT_DIR}/: rename or delete it there.`,
  '/conductor <what you want> has Claude draft a new project on the board and name it; in an open project, a plain message to Claude changes it.',
  'Under the templates: a replay shows a run without running one, made up over a template or recorded.',
]

/** `page` counts from 1; `start` is the start screen. */
export function helpPage(page: number, block: BlockRef | undefined, file: string, columns: number, start: boolean = false): HelpRow[] {
  const width = Math.max(12, columns)
  const title = (text: string): HelpRow[] => [{ kind: 'title', text: clip(text, width) }, { kind: 'blank', text: '' }]
  const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
  if (start && page === 1) return [...title('Starting a project'), ...paragraphs(START_HELP, width)]
  if (start && page === 4) return [...title('Mouse'), ...paragraphs(MOUSE_HELP, width)]
  if (page === 1) return block ? [...title(`The ${typeName(block)} block`), ...paragraphs([`${cap(teachOf(block).hint)}.`, `${cap(useWhen(block))}.`, ...teachOf(block).card], width)] : [...title('The selected block'), ...paragraphs(['Select a block to read about its type.'], width)]
  if (page === 2) return [...title('What the graph shows'), ...table(LEGEND, width)]
  if (page === 3) return [...title('Keys'), ...table(KEY_HELP, width)]
  return [...title('Mouse and file'), ...paragraphs([...MOUSE_HELP, `This project is saved in ${file}.`], width)]
}

/** The blank rows between paragraphs go first (the one under the title last), then what is left is cut. */
export function fitHelp(page: readonly HelpRow[], rows: number): HelpRow[] {
  const out = [...page]
  for (let at = out.length - 1; at >= 0 && out.length > rows; at--) if (out[at]?.kind === 'blank') out.splice(at, 1)
  return out.slice(0, Math.max(0, rows))
}

/** The longest wording `room` cells hold. Tight, the long words go first, then the time, the tokens, the failures, the count; the status always stays. */
export function runSummary(run: RunState, elapsedMs: number | null, room: number = Infinity): { text: string; color: 'claude' | 'success' | 'error' | 'inactive' } {
  const agents = Object.values(run.agents)
  const done = agents.filter(agent => agent.status === 'done').length
  const failed = agents.filter(agent => agent.status === 'failed').length
  const tokens = agents.reduce((sum, agent) => sum + agent.tokens, 0)
  const status = run.status === 'running' ? 'running' : run.status === 'stopped' ? 'stopped' : 'finished'
  const fails = failed > 0 ? [`${failed} failed`] : []
  const time = elapsedMs !== null && elapsedMs >= 0 ? [fmtDuration(elapsedMs)] : []
  const count = `${done}/${agents.length}`
  const wordings = [
    [status, `${count} agents done`, ...fails, `${fmtCount(tokens)} tokens`, ...time],
    [status, `${count} done`, ...fails, fmtCount(tokens), ...time],
    [status, `${count} done`, ...fails, fmtCount(tokens)],
    [status, `${count} done`, ...fails],
    [status, count, ...fails],
    // A failure outranks the count once only one of them fits.
    failed > 0 ? [status, ...fails] : [status, count],
    [status],
  ].map(parts => parts.join(' · '))
  const text = wordings.find(one => one.length <= room) ?? status
  return { text, color: run.status === 'running' ? 'claude' : failed > 0 || run.status === 'failed' ? 'error' : run.status === 'stopped' ? 'inactive' : 'success' }
}

/** In the clock's ms: the run state itself carries no times, and a drawing reads no clock. */
export type RunTimes = { runId: string | null; startedAt: number | null; endedAt: number | null; seenAt: number | null }

/** The elapsed time shown moves on about this often while the run is live. */
export const ELAPSED_STEP_MS = 1000

export function initialTimes(): RunTimes {
  return { runId: null, startedAt: null, endedAt: null, seenAt: null }
}

/** Returns `times` itself when nothing changes. */
export function stampTimes(times: RunTimes, run: RunState, now: number): RunTimes {
  if (run.status === 'idle') return times.runId === null ? times : initialTimes()
  const runId = run.runId ?? ''
  if (times.runId !== runId || times.startedAt === null) return { runId, startedAt: now, endedAt: run.status === 'running' ? null : now, seenAt: now }
  if (run.status !== 'running') {
    // The notice comes once the main loop is idle, maybe long after the run: its own time is the one shown.
    const endedAt = run.durationMs === undefined ? (times.endedAt ?? now) : times.startedAt + run.durationMs
    return endedAt === times.endedAt ? times : { ...times, endedAt, seenAt: now }
  }
  // A run held stopped can start again (the stop is inferred): it is timed on.
  if (times.endedAt !== null) return { ...times, endedAt: null, seenAt: now }
  return now - (times.seenAt ?? 0) >= ELAPSED_STEP_MS ? { ...times, seenAt: now } : times
}

/** Null when the run is not the one timed. */
export function elapsedOf(times: RunTimes, run: RunState): number | null {
  if (times.startedAt === null || times.runId !== (run.runId ?? '')) return null
  return Math.max(0, (times.endedAt ?? times.seenAt ?? times.startedAt) - times.startedAt)
}

/** The last block in the project's order with an agent running: the front of the work. */
export function runningBlock(project: Project, run: RunState): string | null {
  const busy = flatten(project).filter(row => (run.byNode[row.node.id]?.running ?? 0) > 0)
  return busy.at(-1)?.node.id ?? null
}

/** While `follow` holds, the selection is on the block that is running. Returns `ui` itself when nothing changes. */
export function followRun(ui: ProjectUi, project: Project | null, run: RunState, runProject: string | null): ProjectUi {
  if (!ui.follow || !project || ui.status !== 'ready' || runProject === null || ui.name !== runProject || run.status !== 'running') return ui
  const id = runningBlock(project, run)
  if (id === null || id === ui.selectedId) return ui
  return { ...ui, selectedId: id, confirmId: null, editing: false, freshId: null }
}

export function failedBlock(project: Project, run: RunState): string | null {
  return flatten(project).find(row => (run.byNode[row.node.id]?.failed ?? 0) > 0)?.node.id ?? null
}

/** The selection goes to the first block with a failure, where the person has to look, and following ends. */
export function endRun(ui: ProjectUi, project: Project | null, run: RunState, runProject: string | null): ProjectUi {
  if (!ui.follow || !project || ui.status !== 'ready' || runProject === null || ui.name !== runProject || run.status === 'running' || run.status === 'idle') return ui
  const id = failedBlock(project, run)
  if (id === null) return { ...ui, follow: false }
  return { ...ui, follow: false, selectedId: id, confirmId: null, editing: false, freshId: null }
}

/** The columns of the terminal the dock leaves to the transcript: a sliver, the prompt stays full width. */
export const DOCK_MARGIN = 30
/** In a terminal narrower than DOCK_ROOMY the sliver is the least the dock leaves by itself, so the graph keeps its room. */
export const DOCK_MARGIN_TIGHT = 24
export const DOCK_ROOMY = 130

/** Undefined with the width unknown: nothing is asked, and the dock keeps the width it has. */
export function dockColumns(terminal: number | undefined): number | undefined {
  if (terminal === undefined || !Number.isFinite(terminal) || terminal <= 0) return undefined
  return Math.max(40, Math.floor(terminal) - (terminal < DOCK_ROOMY ? DOCK_MARGIN_TIGHT : DOCK_MARGIN))
}

/**
 * What bare `/conductor` shows: a run in progress, as its project or the phase view; else the project this session last had open.
 * Never an empty run view. Both hooks modules ask this, so either may be asked first.
 */
export function bareTarget(status: RunState['status'], runProject: string | null, ui: Pick<ProjectUi, 'name' | 'status'>): { view: 'run' } | { view: 'project'; name: string; live: boolean } {
  if (status === 'running') return runProject === null ? { view: 'run' } : { view: 'project', name: runProject, live: true }
  if (ui.status !== 'closed') return { view: 'project', name: ui.name, live: false }
  if (status !== 'idle' && runProject === null) return { view: 'run' }
  // A replay's project lives in the session only: it is never offered as a project to create.
  return { view: 'project', name: runProject !== null && isSaved(runProject) ? runProject : DEFAULT_PROJECT_NAME, live: false }
}
