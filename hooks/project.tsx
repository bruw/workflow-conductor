import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderChildren } from 'claude-code'

import { FLASH_CLEAR_MS, TOOL_FULL_NAME, TOOL_NAME, TOOL_SCHEMA, TOOL_TITLE, applyOps, attachNote, callLine, changeWords, changedNote, clearFlash, projectOfPath, diffProjects, draftBrief, editReport, knownAfterEdit, readReport, replaceProject, resultLine, showEdit, staleNote, toolDescription, unplacedNote } from '../src/project/chat'
import { UNDO_HINT, remember, travel } from '../src/project/history'
import type { History } from '../src/project/history'
import { lint, preflightLine, problemFields } from '../src/project/lints'
import * as partial29 from '../fixtures/partial-29'
import * as review41 from '../fixtures/review-41'
import { handoffPrompt, handoffTarget, reviewPrompt } from '../src/project/handoff'
import { replayEvents } from '../src/run/replay'
import type { ReplayFixture } from '../src/run/replay'
import { emptyProject, findNode, flatten, goalOf, isBlank, isProjectName, kindsOf, parseProject, sameProject, serializeProject, typeName } from '../src/project/model'
import type { Project, ProjectNode, NodeType } from '../src/project/model'
import { nextIdNumber, quickKnob } from '../src/project/ops'
import type { NodePatch } from '../src/project/ops'
import {
  AGENT_ROWS_MAX,
  DEFAULT_PROJECT_NAME,
  DRAFT_LOCK_NOTICE,
  DRAFT_WAIT_NOTE,
  PROJECT_DIR,
  PROJECT_PANE_ID,
  PROJECT_PANE_TITLE,
  HANDED_NOTICE,
  HELP_PAGES,
  KEYS_CUE,
  LOCK_NOTICE,
  REVEAL_STEPS,
  SCRATCH_PREFIX,
  FIELD_KNOBS,
  addHeading,
  agentsOf,
  applyMessage,
  applyOp,
  bareTarget,
  firstBlocks,
  isProjectEntry,
  blocksWord,
  carryUi,
  projectFile,
  projectName,
  detailWidth,
  dockColumns,
  elapsedOf,
  fitHelp,
  freeName,
  graphProps,
  handoffOf,
  helpColumn,
  helpPage,
  initialTimes,
  initialUi,
  isDefaultName,
  isSaved,
  listWindow,
  movePick,
  moveStartMark,
  nothingToRestore,
  noticeInforms,
  openProject,
  openRetype,
  overlaysProject,
  patchNode,
  pickBlock,
  pickerMatches,
  previewProps,
  restoreProject,
  runOverlay,
  runSummary,
  savedEntry,
  startProject,
  startEntries,
  filterText,
  fitsFull,
  typePicker,
  viewRootOf,
  withoutKeys,
} from '../src/project/session'
import type { ProjectUi, GraphBox, PickRow, RunContext, SavedProject, Step, TextKnob } from '../src/project/session'
import { FIELD_LABEL, PALETTE_GROUPS, TEACH, fieldWord, groupOf, hasLogic, hasName, knobsOf, pickName, placeholderOf, teachOf, useWhen } from '../src/project/teach'
import type { BlockRef } from '../src/project/teach'
import { TEMPLATES } from '../src/project/templates'
import { emptyRunState } from '../src/run/events'
import type { RunState } from '../src/run/events'
import { replayProjectEvents } from '../src/run/replay'
import type { Tracker } from '../src/run/tracker'
import { NOT_SET, UNMAPPED_ID, canOpen } from '../src/ui/graph-layout'
import { parseGraphMessage } from '../src/ui/graph-model'
import { EXPAND_W, EXPAND_WORD, WHY_TEXT, currentStep, initialShell, planStrip, stripItems, whyCompact, wouldDock } from '../src/ui/compact'
import type { CompactWhy, Minimized, StripPart, StripTone } from '../src/ui/compact'
import { ENTER, FOCUS_HINT, KEY_OPS, MINIMIZE_KEYS, PASTE_NOTICE, burstKeys, legendItems, legendRows, unboundNotice, LEGEND_GAP } from '../src/ui/keys'
import type { KeyOp, LegendAction, LegendItem } from '../src/ui/keys'
import { FAILED, fmtCount } from '../src/ui/rail'
import { BEAT_MS, SCENE_COLUMNS, SCENE_ROWS, SOLO_ROWS, SPLASH_MS, splashScene, waitScene } from '../src/ui/persona'
import type { PersonaSpan } from '../src/ui/persona'
import { cellWidth, clip, cutCells, firstLines, oneLine, padCells, sanitize, wrapText } from '../src/ui/text'
import { ACCENT, FADED, GLYPH, PANE_ID, PANE_TITLE, RULE, TEXT } from '../src/ui/theme'
import { wordmark } from '../src/ui/wordmark'

import { offerDrafted, offerHanded, offerPrompted, offerRan, setOfferBoard, takeOffered } from './offer'

// The designer: owns the Project and what is chosen on it, applies ops, saves the file and draws the screen.
// Keys are typed into the key catcher, an Input that is not drawn; the graph (./canvas.tsx) is a Client that posts here.

const COMMAND = 'conductor'
const CANVAS_ELEMENT = 'canvas'
const SPLASH_ELEMENT = 'splash'
const SPLASH_NOTE = 'designed for full screen'
const NAME_FIELD = 'project-name'
const LOGIC_FIELD = 'project-logic'
/** Drawn under a new `n` (`project-add:<n>`) to empty it of the keys it took. */
const PICKER_ELEMENT = 'project-add'
const TYPE_ELEMENT = 'project-type'
const REST_PREFIX = 'project-rest:'
const START_PREFIX = 'start:'
const DRAFT_LABEL = '[Draft using claude]'
const NAME_BUTTON = 'projects-button'
const ACTION_BUTTON_PREFIX = 'act:'
const MINIMIZE_BUTTON = 'project-minimize'
const ARROWS_CHOOSE = 'the arrows choose a row'
/** Saved projects the start screen lists at once where it is short of rows. */
const SAVED_ROWS = 8
const SAVED_MAX = 60
const KNOB_PREFIX = 'project-knob:'
/** The engine keeps what was typed in an Input under its address, so a field's address names its block. */
const fieldKey = (base: string, id: string): string => `${base}@${id}#${editGen}`
const baseOf = (element: string): string => element.split('@')[0] ?? element
/** Counts the times the fields closed: fields opened again have new addresses and show the block as it is. */
let editGen = 0
let fieldsDrawn = false
const isField = (element: string | undefined): boolean => {
  const base = baseOf(element ?? '')
  return base === NAME_FIELD || base === LOGIC_FIELD || base.startsWith(KNOB_PREFIX)
}
const draftFieldWord = (base: string): string => fieldWord(base === NAME_FIELD ? 'name' : base === LOGIC_FIELD ? 'logic' : base.slice(KNOB_PREFIX.length))
const firstField = (node: { type: ProjectNode['type'] }): string => (hasName(node) ? NAME_FIELD : `${KNOB_PREFIX}goal`)
/**
 * Where the ring rests while no field is open: an Input (a Button's hotkey cannot see Shift), first among the stops, since the engine keeps the ring by its place.
 * Not drawn (`display: none`). Emptied by drawing it under a new key, once the typing has paused: a key typed in the frame it is drawn anew is dropped.
 */
const CATCH_ELEMENT = 'keys'
/** This load, in the catcher's key: a module loaded again counts from 0, and the engine would bring back an old key's text. */
const LOAD = Date.now().toString(36)
let catchGen = 0
const catcherKey = (): string => `${CATCH_ELEMENT}:${LOAD}.${catchGen}`
const isCatcher = (element: string | undefined): boolean => (element ?? '').startsWith(`${CATCH_ELEMENT}:`)
/** '' where the last drawing drew none. */
let drawnCatcher = ''
let pickGen = 0
const pickerKey = (): string => `${PICKER_ELEMENT}:${LOAD}.${pickGen}`
const isPickerField = (element: string | undefined): boolean => (element ?? '').startsWith(`${PICKER_ELEMENT}:`)
const restBase = (element: string | undefined): string | null => (element !== undefined && element.startsWith(REST_PREFIX) ? baseOf(element.slice(REST_PREFIX.length)) : null)
/** The door: an Input right after the catcher while a block's fields are shown. Down or Tab from the catcher lands on it, which opens the fields; a step back onto it returns to the graph. */
const DOOR_ELEMENT = 'door'
let doorGen = 0
const doorKey = (): string => `${DOOR_ELEMENT}:${LOAD}.${doorGen}`
const isDoor = (element: string | undefined): boolean => (element ?? '').startsWith(`${DOOR_ELEMENT}:`)
const isDetailStop = (element: string | undefined): boolean => element !== undefined && (isField(element) || isPickerField(element) || restBase(element) !== null)
/** How long after the command's answer the handoff prompt is submitted. */
export const SUBMIT_DELAY_MS = 64
/** How many times the ring is sent to an element before the field is given up. */
const LAND_TRIES = 5
/** A redraw's worth of wait before the ring moves to an element just drawn. */
export const FOCUS_DELAY_MS = 48
export const BOX_POLL_MS = 600
/** The mark's two rows. */
const HEAD_ROWS = 2
const EDIT_HINT = 'click a field of the block, or press the Down arrow to reach the name'
const MAIN_LEAST_ROWS = 5
/** The detail pane's last rows name its keys: one row where the pane is short. */
const HINT_ROWS = 2
const ACTION_GAP = 4
/** Cells of rule kept at each side of what is said over the footer. */
const SAID_RULE_W = 3
/** Rows asked for when the pane sits inline above the prompt. */
export const PANE_ROWS = 28
/** A command's `e.presentation.columns` is the only place a hook is told the terminal's width: undefined until one has run. */
let terminalColumns: number | undefined
let splashing = false
/** The splash stays on its last beat this long before the designer is drawn. */
const SPLASH_REST_MS = 150
/** Without `focus` the pane is shown and the person goes on typing in the prompt (an edit from chat). */
export const paneArgs = (focus: boolean): { id: string; title: string; rows: number; columns?: number; focus?: true } => {
  const columns = dockColumns(terminalColumns)

  return { id: PROJECT_PANE_ID, title: PROJECT_PANE_TITLE, rows: PANE_ROWS, ...(columns === undefined ? {} : { columns }), ...(focus ? { focus: true as const } : {}) }
}
const runNotice = (line: string, isFilled: boolean): string => `run: ${isFilled ? 'the request is in the prompt · Enter sends it' : `type in the prompt: ${line.trim()}`}`
const askNotice = (line: string, isFilled: boolean): string => (isFilled ? 'ask: the question is in the prompt · change it as you like, then Enter' : `ask: type in the prompt: ${line.trim()}`)
const draftLine = (): string => `/${COMMAND} `
const draftNotice = (line: string, isFilled: boolean): string => (isFilled ? 'draft: say in the prompt what the workflow should do, then Enter' : `draft: type in the prompt: ${line.trim()} <what you want>`)
/** A run, ask or draft notice waits on the prompt box, as does a refusal worded as one. */
const isRequestNotice = (notice: string | null): boolean => notice !== null && /^(run|ask|draft): /.test(notice)

/** Undo and redo, per project. Module variables, not state: fifty projects are too much to store, and a drawing may read them. */
const histories: Record<string, History> = {}
/** Changes per project in this load, and the count Claude last saw: they differ when the board changed by hand since. */
const revisions: Record<string, number> = {}
const seenByClaude: Record<string, number> = {}
/** The project as Claude last saw it whole; none where it never read it, or the conversation was compacted or cleared. */
const seenProjects: Record<string, Project> = {}
const sawProject = (name: string, project: Project): void => {
  seenByClaude[name] = revisions[name] ?? 0
  seenProjects[name] = project
}
const forgetSeenProjects = (): void => {
  for (const name of Object.keys(seenProjects)) delete seenProjects[name]
}
/** The model is told a project is stale once per change, not with every prompt. */
const warnedAt: Record<string, number> = {}
const forgetConversation = (): void => {
  forgetSeenProjects()
  for (const book of [seenByClaude, warnedAt]) for (const name of Object.keys(book)) delete book[name]
}
const record = (name: string, before: Project | null, what: string | undefined): void => {
  revisions[name] = (revisions[name] ?? 0) + 1
  if (before) histories[name] = remember(histories[name], before, what ?? 'an edit')
}
/** Ids are never reused: the counter never goes back. */
const timeTravel = (project: Project | null, ui: ProjectUi, way: 'undo' | 'redo', context: RunContext): Step => {
  if (!project || ui.status !== 'ready') return { project, ui, changed: false }
  if (context.locked || ui.handed) return applyOp(project, ui, way, context)
  const moved = travel(histories[ui.name], project, way)
  if (!moved) return { project, ui: nothingToRestore(ui, way), changed: false }
  histories[ui.name] = moved.history
  revisions[ui.name] = (revisions[ui.name] ?? 0) + 1
  const target: Project = { ...moved.entry.project, name: project.name, nextId: Math.max(nextIdNumber(moved.entry.project), nextIdNumber(project)) }
  return restoreProject(project, ui, target, way, moved.entry.what, context)
}
const keyStep = (project: Project | null, ui: ProjectUi, op: KeyOp, context: RunContext): Step =>
  op === 'undo' || op === 'redo' ? timeTravel(project, ui, op, context) : applyOp(project, ui, op, context)
/** Typed and not saved yet. Not state: a keystroke must not redraw the pane. `flushDrafts` saves it on every way out of a field. */
type Drafts = { name: string; id: string | null; values: Record<string, string> }
const noDrafts = (): Drafts => ({ name: '', id: null, values: {} })
let drafts: Drafts = noDrafts()
const hasDrafts = (): boolean => drafts.id !== null && Object.keys(drafts.values).length > 0
const fieldPatch = (node: { name: string }, base: string, value: string): NodePatch =>
  base === NAME_FIELD ? { name: value.trim() || node.name } : base === LOGIC_FIELD ? { logic: value.trim() } : ({ knobs: { [base.slice(KNOB_PREFIX.length)]: value.trim() } } as NodePatch)
let paneShape = ''
/** When the focus stops change under a ring at rest, the ring is put back on the catcher. */
let ringStops = ''
/** Undefined when unknown. A field typed in while the ring is known to be elsewhere got it by its place among the stops: what is typed there is not its text. */
let ringOn: string | undefined
/** The element the ring is moving to ('' with none): what is typed there meanwhile is its text. */
let ringTo = ''
/**
 * A field's drawn `value`, the letters that came by the catcher or the door (`head`) and those typed at its end (`tail`). An Input keeps its text while
 * `value` holds; a changed `value` replaces the text but not the cursor, and a letter typed in the frame of a new address is dropped: so a field keeps the text it opened with until the typing pauses.
 */
let pins: Record<string, { value: string; head: string; tail: string }> = {}
const pinned = (element: string, value: string): string => (pins[element] ??= { value, head: '', tail: '' }).value
/** `loose` when the letters kept beside the field cannot be placed: the field is then drawn anew at once. */
const fieldText = (element: string, typed: string): { text: string; loose: boolean } => {
  const pin = pins[element]
  if (!pin) return { text: typed, loose: false }
  if (typed.startsWith(pin.value)) {
    pin.tail = typed.slice(pin.value.length)

    return { text: `${pin.value}${pin.head}${pin.tail}`, loose: false }
  }
  if (pin.head === '') return { text: typed, loose: false }
  // A cut at its end is made at the end of the whole; anything else keeps the letters after it.
  const whole = `${pin.value}${pin.head}`
  return { text: pin.value.startsWith(typed) ? whole.slice(0, Math.max(0, whole.length - (pin.value.length - typed.length))) : `${typed}${pin.head}`, loose: true }
}
/** New addresses for the open fields: the ring, kept by its place, stays on the same field. */
const redrawFields = (): void => {
  editGen++
  for (const pin of Object.values(pins)) pin.head = ''
  const swap = (key: string): string => key.replace(/#\d+$/, `#${editGen}`)
  if (ringOn !== undefined && isField(ringOn)) ringOn = swap(ringOn)
  if (isField(ringTo)) ringTo = swap(ringTo)
}
/** Counts every key typed in the pane, for what waits for the typing to pause. */
let typingSeq = 0
const TIDY_MS = 600
/** The catcher is emptied once it holds more keys than this. */
const CATCH_FULL = 40
let doored = { element: '', taken: 0 }
/** For the start screen's preview: null for a file that is no project. */
const previews: Record<string, Project | null> = {}
let savedPast = 0
/** The project the list of projects was opened from: one no file holds yet comes back from here. */
let behind: { project: Project; ui: ProjectUi } | null = null
/** `sent` is the text Enter was last pressed on, until the next key: Enter empties the catcher, so what it holds next is counted from the start. */
let caught: { element: string; taken: number; sent: string | null } = { element: '', taken: 0, sent: null }
/** The same for the add list's filter: how many of its characters were keys, not text. */
let picked = { element: '', taken: 0 }
/** What is typed in the filter once the list has closed is for whatever opened next. */
let pickedField = { element: '', value: '', taken: 0 }
/** What is typed in a field after Enter, before the ring has left, is keys. */
let savedField = { element: '', value: '', taken: 0 }
/** Where the characters not yet taken start: after the text Enter sent, where the field still holds it (Enter empties some fields). */
const afterEnter = (sent: { value: string; taken: number }, value: string): number => (value.startsWith(sent.value) ? sent.value.length : 0) + sent.taken
/** The keys walk the layout the Client made for the same room. */
let graphBox: GraphBox | undefined
/** Where the graph stands in the pane's body, in cells, for the wheel; null while none is drawn. */
let graphArea: { top: number; left: number; columns: number; rows: number } | null = null
/** Summed over this load: the Client moves its pan by what was added since it last drew. */
let wheelRows = 0
/** The keys typed, applied one at a time in the order they came. */
let keyChain: Promise<void> = Promise.resolve()
let flushAsked = false
let boxWatched = false
let runTracker: Tracker | undefined
let draftTicker: { cancel: () => void } | null = null

// Both hooks modules declare these (an atom must be spelled in the file that reads it): run.tsx writes them through the tracker.
const runAtom = atom({ plugin: 'workflow-conductor', key: 'run' } as const, emptyRunState())
const clockAtom = atom({ plugin: 'workflow-conductor', key: 'runClock' } as const, 0)
/** Null for a run that no handoff started. */
const runProjectAtom = atom({ plugin: 'workflow-conductor', key: 'runProject' } as const, null)
const projectAtom = atom({ plugin: 'workflow-conductor', key: 'project' } as const, null)
const uiAtom = atom({ plugin: 'workflow-conductor', key: 'projectUi' } as const, initialUi())
const splashedAtom = atom({ plugin: 'workflow-conductor', key: 'splashed' } as const, false)
const draftBeatAtom = atom({ plugin: 'workflow-conductor', key: 'draftBeat' } as const, 0)
const timesAtom = atom({ plugin: 'workflow-conductor', key: 'runTimes' } as const, initialTimes())
const shellAtom = atom({ plugin: 'workflow-conductor', key: 'shell' } as const, initialShell())
const runScriptAtom = atom({ plugin: 'workflow-conductor', key: 'runScript' } as const, null)

class StaleFile extends Error {
  constructor(
    readonly name: string,
    readonly text: string,
  ) {
    super(`project ${name} was changed in another session`)
  }
}

/** The file holds no valid project: a save does not write over it unless the person says so (`f`). */
class InvalidFile extends Error {
  constructor(readonly name: string) {
    super(`${name}.json is not a valid project`)
  }
}

/** Projects whose last save met an invalid file: the board holds the edits, unsaved, until a save gets through. */
const heldOver = new Set<string>()
const invalidNotice = (name: string): string => `not saved: ${name}.json is not a valid project now · the board keeps your edit · [f] Write over it`

/** What this session last read from or wrote to each project's file. Another session sharing the root may save over it. */
const onDisk: Record<string, Project> = {}
/** The revision at which each project last changed in another session, so Claude is not told the user did it. */
const elsewhereAt: Record<string, number> = {}
const changedElsewhere = (name: string): void => {
  revisions[name] = (revisions[name] ?? 0) + 1
  elsewhereAt[name] = revisions[name]
}
/** A file taken onto the board or for Claude. */
const loadedDisk = (name: string, project: Project): void => {
  const known = onDisk[name]
  if (known !== undefined && !sameProject(known, project)) changedElsewhere(name)
  onDisk[name] = project
  heldOver.delete(name)
}

// Spelled whole, not built by `projectFile`, so that a reader of the call sees where every save lands.
// `board` stands in for `onDisk` where a reload with changed source lost it; null for a project not saved yet.
const saveProject = async ($: EngineInterface, name: string, project: Project, board: Project | null, overwrite = false): Promise<void> => {
  // The name is spelled into the path: anything but kebab-case could reach outside the projects' directory.
  if (!isProjectName(name)) throw new Error(`not a project name: ${name}`)
  const root = await $.session.root()
  const path = `${root.replace(/\/+$/, '')}/.claude/workflow-conductor/${name}.json`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
  if (text !== undefined) {
    const known = onDisk[name] ?? board
    const now = parseProject(text)
    if (!now.ok) {
      if (!overwrite) {
        heldOver.add(name)
        throw new InvalidFile(name)
      }
    } else if (known === null || !sameProject(now.project, known)) throw new StaleFile(name, text)
  }
  await $.fs.write(path, serializeProject(project))
  onDisk[name] = project
  heldOver.delete(name)
}

type Shown = Pick<Step, 'project' | 'ui'>

type Refused = { project: Project; what: string }

/**
 * The board takes what another session saved in place of the edit that met it. One undo brings back the board with
 * `refused`, the edit, made on it, and saves that over the other session's; the next undo goes to before the edit.
 */
const takeSaved = (stale: StaleFile, board: Project | null, refused: Refused | null, held: ProjectUi): Shown => {
  changedElsewhere(stale.name)
  const opened = openProject(stale.name, stale.text, held)
  // A StaleFile is thrown only over a file that parses.
  if (opened.project === null) return { project: board, ui: { ...held, notice: invalidNotice(stale.name) } }
  if (board) {
    const history = refused ? remember(histories[stale.name], board, refused.what) : histories[stale.name]
    histories[stale.name] = remember(history, refused?.project ?? board, 'the file changed in another session')
  }
  onDisk[stale.name] = opened.project
  const back = board ? ' · [u] Back to yours' : ''

  return { project: opened.project, ui: { ...opened.ui, notice: `not saved: ${stale.name} was changed in another session, the board shows it now${back}` } }
}

const showSaved = async ($: EngineInterface, stale: StaleFile, board: Project | null, refused: Refused | null, held: ProjectUi): Promise<string | null> => {
  const shown = takeSaved(stale, board, refused, held)
  await update($, projectAtom, () => shown.project)
  await update($, uiAtom, () => shown.ui)

  return shown.ui.notice
}

const reason = (error: unknown): string => cutCells(sanitize(error instanceof Error ? error.message : String(error)), 160)

/** Both atoms are set before `adopt`: the tracker's write reads the run's project and the board. Returns the labels no block took; null with no run. */
const showRunOn = async ($: EngineInterface, tracker: Tracker, name: string, project: Project): Promise<string[] | null> => {
  await update($, uiAtom, held => ({ ...held, follow: true, runCleared: false }))
  await update($, runProjectAtom, () => name)

  return tracker.adopt(handoffOf(name, project))
}

/** Null when no saved project has the workflow's name. The caller tells the tracker next: its write reads what is set here. */
const projectOfRun = async ($: EngineInterface, workflow: string | undefined): Promise<{ name: string; project: Project } | null> => {
  if (workflow === undefined) return null
  const name = projectName(workflow)
  if (name === null) return null
  const path = projectFile(await $.session.root(), name)
  if (!isSaved(name) || !(await $.fs.exists(path).catch(() => false))) return null
  await flushDrafts($)
  const shown = await read($, uiAtom)
  let project = shown.name === name && shown.status === 'ready' ? await read($, projectAtom) : null
  if (project === null) {
    const opened = openProject(name, await $.fs.read(path).catch(() => ''), shown)
    if (opened.project === null) return null
    project = opened.project
    loadedDisk(name, project)
    await update($, projectAtom, () => opened.project)
    await update($, uiAtom, () => opened.ui)
  }
  await update($, uiAtom, held => ({ ...held, follow: true, runCleared: false }))
  await update($, runProjectAtom, () => name)

  return { name, project }
}

/** `$` does not cross files (`claude plugin validate` refuses a `$` passed to an imported function), so the session's start hook gives run.tsx these. */
export type RunBoard = { projectOfRun: (workflow: string | undefined) => Promise<{ name: string; project: Project } | null> }
let runBoard: RunBoard | undefined
export const runBoardOf = (): RunBoard | undefined => runBoard

const lockedNow = async ($: EngineInterface): Promise<boolean> => {
  const run = await read($, runAtom)
  const ui = await read($, uiAtom)
  return ui.drafting === 'show' || (run.status === 'running' && overlaysProject(run, await read($, runProjectAtom), ui))
}

let flushing: Promise<string | null> = Promise.resolve(null)
/** Kept for a moment: a drawing may have asked for the save just before the action that would have. */
let justSaid: string | null = null
const SAID_MS = 400
/** Saves what was typed and not sent with Enter, as one edit, before anything else acts on the project. One at a time, in the order asked. */
// `keep`: a field that met another session's save is kept, with its text, to be sent again onto that save.
const flushDrafts = ($: EngineInterface, keep = false): Promise<string | null> => {
  const run = flushing.then(async (): Promise<string | null> => {
    if (!hasDrafts()) return null
    const pending = drafts
    drafts = noDrafts()
    const ui = await read($, uiAtom)
    let project: Project | null = await read($, projectAtom)
    // The project typed for is not the one shown, or a run locks it: nothing can be saved, and it is said.
    const lost = `unsaved text in ${Object.keys(pending.values).map(draftFieldWord).join(', ')} discarded`
    if (!project || ui.status !== 'ready' || ui.name !== pending.name) {
      $.ui.toast(`conductor: ${lost} (project ${pending.name} is no longer on the board)`)

      return null
    }
    if (await lockedNow($)) {
      await update($, uiAtom, held => ({ ...held, notice: `${lost} · ${held.drafting === 'show' ? DRAFT_LOCK_NOTICE : LOCK_NOTICE}` }))

      return null
    }
    const before = project
    const said: string[] = []
    let titled = false
    let label: string | undefined
    const node = pending.id === null ? undefined : findNode(project, pending.id)
    if (node) {
      let patch: NodePatch = {}
      for (const [base, text] of Object.entries(pending.values)) {
        const part = fieldPatch(node, base, text)
        patch = { ...patch, ...part, ...(patch.knobs || part.knobs ? { knobs: { ...patch.knobs, ...part.knobs } } : {}) }
      }
      const step = patchNode(project, ui, node.id, patch)
      if (step.changed && step.project) {
        label = step.what
        project = step.project
        said.push(step.what ?? `${node.id} changed`)
        titled = patch.name !== undefined
      }
    }
    if (said.length === 0) return null
    let notice = `${said.join('; ')} · ${UNDO_HINT}`
    let stale: StaleFile | null = null
    try {
      if (isSaved(ui.name)) await saveProject($, ui.name, project, before)
    } catch (error) {
      if (error instanceof StaleFile) stale = error
      else notice = error instanceof InvalidFile ? invalidNotice(ui.name) : `not saved: ${reason(error)}`
    }
    if (stale !== null) {
      notice = (await showSaved($, stale, before, { project, what: label ?? 'an edit' }, ui)) ?? notice
      const theirs = await read($, projectAtom)
      if (keep && pending.id !== null && theirs !== null && findNode(theirs, pending.id)) {
        drafts = pending
        notice = `not saved: ${ui.name} was changed in another session, the board shows it now · Enter: your text onto it`
        await update($, uiAtom, held => ({ ...held, notice, editing: true, selectedId: pending.id }))
      }
    } else {
      record(ui.name, before, label)
      const saved = project
      await update($, projectAtom, () => saved)
      await update($, uiAtom, held => ({ ...held, notice, runCleared: true, unsaved: false, freshId: titled ? null : held.freshId }))
    }
    justSaid = notice
    $.clock.after(SAID_MS, () => {
      if (justSaid === notice) justSaid = null
    })

    return notice
  })
  flushing = run.catch(() => null)

  return run
}
/** An action that left nothing said keeps what the flush said. */
const keepSaid = async ($: EngineInterface, flushed: string | null): Promise<void> => {
  const said = flushed ?? justSaid
  justSaid = null
  if (said !== null) await update($, uiAtom, held => (held.notice === null ? { ...held, notice: said } : held))
}

/** The catcher is the first stop, so the ring is there by its place but for the ways out of the detail pane. */
const settleRing = ($: EngineInterface, tries = 1): void => {
  $.clock.after(FOCUS_DELAY_MS, () => {
    void (async (): Promise<void> => {
      const ui = await read($, uiAtom)
      if ((ui.status !== 'ready' && ui.status !== 'pick' && ui.status !== 'error') || ui.editing) return
      const key = ui.status === 'ready' && ui.picker !== null && !(await lockedNow($)) ? pickerKey() : drawnCatcher
      const moved = await $.ui.focus({ requestId: PROJECT_PANE_ID, key }).catch(() => ({ deny: 'no' }))
      if (moved.deny === undefined) ringOn = key
      else if (tries > 0) settleRing($, tries - 1)
    })()
  })
}

/** The ring goes to the catcher before the fields close: kept by its place, it must not be left on what takes their place. */
const home = async ($: EngineInterface): Promise<void> => {
  const key = drawnCatcher
  ringTo = ''
  const moved = await $.ui.focus({ requestId: PROJECT_PANE_ID, key }).catch(() => ({ deny: 'no' }))
  if (moved.deny === undefined) ringOn = key
  // Not drawn at this moment (the add list stands in its place): once it is.
  else settleRing($)
  await update($, uiAtom, held => (held.editing || held.freshId !== null ? { ...held, editing: false, freshId: null } : held))
  $.ui.invalidate('ui.render')
}

/** What to land on: its key is made anew on each try, as letters typed meanwhile draw it under another. */
type Spot = { base: string; id: string } | 'picker'
const spotKey = (spot: Spot): string => (spot === 'picker' ? pickerKey() : fieldKey(spot.base, spot.id))

/** Where the element cannot be reached at all the field is given up and `fallback` is said. */
const landOn = async ($: EngineInterface, spot: Spot, fallback: string, tries = LAND_TRIES, last = ''): Promise<void> => {
  const key = spotKey(spot)
  // Said before the move is asked: a letter that reaches the element before the answer does is its text.
  ringTo = key
  const moved = await $.ui.focus({ requestId: PROJECT_PANE_ID, key }).catch((error: unknown) => ({ deny: reason(error) }))
  if (moved.deny === undefined && key === spotKey(spot)) {
    ringOn = key
    if (ringTo === key) ringTo = ''
    $.ui.invalidate('ui.render')

    return
  }
  // Refused: not drawn yet, or drawn anew under another address meanwhile (letters typed on the way do that): that one counts from the start.
  const left = key === last ? tries - 1 : LAND_TRIES
  if (left > 0) {
    $.clock.after(left > LAND_TRIES - 2 ? FOCUS_DELAY_MS : FOCUS_DELAY_MS * 2, () => void landOn($, spot, fallback, left, key))

    return
  }
  if (ringTo === key) ringTo = ''
  await update($, uiAtom, held => ({ ...held, editing: false, freshId: null, notice: fallback }))
}

/** What `e` does, for the ways that are not a key: the Down arrow from the catcher, a click on a field at rest. */
const openFields = async ($: EngineInterface, base?: string): Promise<void> => {
  const ui = await read($, uiAtom)
  const project = await read($, projectAtom)
  const node = project === null || ui.selectedId === null ? undefined : findNode(project, ui.selectedId)
  if (ui.status !== 'ready' || !node || ui.handed || (await lockedNow($))) return
  if (!ui.editing || ui.help > 0 || ui.picker !== null) await update($, uiAtom, held => ({ ...held, editing: true, help: 0, picker: null, detailHidden: false, confirmId: null }))
  void landOn($, { base: base ?? firstField(node), id: node.id }, `edit: ${EDIT_HINT}`)
}

/** After a click on the graph, until the ring is on the catcher: the engine gives a letter typed on a Button to the prompt box, and the keyboard with it (`prompt.edit` makes it a key). */
let landing = false
/** `landing` is given up after this long, whatever became of the ring. */
const LANDING_MS = 400
/** Nothing tells a hook when the graph loses the keyboard a click gave it, so the pane takes the keys back at once; refused (the prompt box holds text), no key is answered (`handed`). */
const retake = async ($: EngineInterface, picks: boolean): Promise<void> => {
  landing = true
  $.clock.after(LANDING_MS, () => {
    landing = false
  })
  await $.ui.open(paneArgs(true)).catch(() => undefined)
  // Asked before the fields close, or the ring would rest on what takes a field's place; a move refused while the pane's take lands is asked again below.
  const early = picks || drawnCatcher === '' ? { deny: 'no' } : await $.ui.focus({ requestId: PROJECT_PANE_ID, key: drawnCatcher }).catch((error: unknown) => ({ deny: reason(error) }))
  if (early.deny === undefined) ringOn = drawnCatcher
  await update($, uiAtom, held => (held.editing || held.freshId !== null ? { ...held, editing: false, freshId: null } : held))
  // Moving the ring is how the pane learns whether it holds the keyboard (`$.ui.panes()` asked right after the open still says no). One more try: the pane may not be drawn yet.
  const land = async (tries: number): Promise<void> => {
    const key = picks ? pickerKey() : drawnCatcher
    const moved = await $.ui.focus({ requestId: PROJECT_PANE_ID, key }).catch((error: unknown) => ({ deny: reason(error) }))
    const holds = moved.deny === undefined
    if (!holds && tries > 0) {
      $.clock.after(FOCUS_DELAY_MS * 2, () => void land(tries - 1))

      return
    }
    landing = false
    if (holds) ringOn = key
    const now = await read($, uiAtom)
    if (holds === now.handed) await update($, uiAtom, held => ({ ...held, handed: !holds, notice: !holds ? HANDED_NOTICE : held.notice === HANDED_NOTICE ? null : held.notice }))
    else $.ui.invalidate('ui.render')
  }
  // The filter exists once the list is drawn: the ring moves there a frame later.
  if (picks) $.clock.after(FOCUS_DELAY_MS, () => void land(1))
  else await land(1)
}

/** Tidies the Inputs once no key has been typed for TIDY_MS: a letter typed in the frame an Input is drawn anew would be dropped. */
const tidySoon = ($: EngineInterface): void => {
  const mine = ++typingSeq
  $.clock.after(TIDY_MS, () => {
    if (mine !== typingSeq) return
    let tidied = false
    if (caught.taken > CATCH_FULL && caught.element === drawnCatcher) {
      catchGen++
      tidied = true
    }
    if (doored.taken > 0) {
      doorGen++
      doored = { element: '', taken: 0 }
      tidied = true
    }
    // Drawn anew, a field keeps the cursor of the one before it, short of the end by the letters added. The ring is
    // stepped off it and on again: landing puts the cursor at the end.
    const at = ringOn
    const again = (spot: Spot): void => {
      const off = $.ui.focus({ requestId: PROJECT_PANE_ID, key: drawnCatcher })
      void off.then(() => landOn($, spot, `edit: ${EDIT_HINT}`)).catch(() => undefined)
    }
    if (Object.entries(pins).some(([element, pin]) => pin.head !== '' && isField(element))) {
      redrawFields()
      tidied = true
      const [base = '', id = ''] = (at ?? '').replace(/#\d+$/, '').split('@')
      if (at !== undefined && isField(at)) again({ base, id })
    }
    if (tidied) $.ui.invalidate('ui.render')
  })
}
const runContext = async ($: EngineInterface): Promise<RunContext> => {
  const now = await read($, runAtom)
  const ui = await read($, uiAtom)
  const held = overlaysProject(now, await read($, runProjectAtom), ui)
  // A draft being laid out locks the project as a run does.
  const laying = ui.drafting === 'show'

  return { ...(held ? { run: now, locked: now.status === 'running' || laying } : laying ? { locked: true } : {}), ...(laying ? { drafting: true } : {}), ...(graphBox ? { graph: graphBox } : {}) }
}

/** `kept` is the project's undo history from before the step. */
const store = async ($: EngineInterface, step: Step, before: Project | null, kept: History | undefined): Promise<Shown> => {
  if (!step.changed || !step.project) return step
  const name = step.ui.name
  const board = before?.name === name ? before : null
  let notice: string | undefined
  try {
    if (isSaved(name)) await saveProject($, name, step.project, board)
  } catch (error) {
    if (error instanceof InvalidFile) notice = invalidNotice(name)
    else if (!(error instanceof StaleFile)) notice = `not saved: ${reason(error)}`
    else {
      // An undo or redo has moved the history already, for a step that is not taken; it is not offered again.
      const travelled = board !== null && histories[name] !== kept
      if (travelled) {
        if (kept === undefined) delete histories[name]
        else histories[name] = kept
      }
      const refused = !travelled && step.what !== undefined ? { project: step.project, what: step.what } : null
      return takeSaved(error, board, refused, step.ui)
    }
  }
  if (step.what !== undefined) record(step.ui.name, before, step.what)

  return { project: step.project, ui: notice === undefined ? step.ui : { ...step.ui, notice } }
}

/** Started by the drawing that shows the splash; a reload in the middle of it starts it again. */
const startSplash = ($: EngineInterface): void => {
  if (splashing) return
  splashing = true
  $.clock.after(SPLASH_MS + SPLASH_REST_MS, () => {
    // Given back: a /clear starts the session's state over (the splash is unseen again) while this module lives on.
    splashing = false
    void update($, splashedAtom, () => true).then(() => settleRing($))
  })
}

const commit = async ($: EngineInterface, make: (project: Project | null, held: ProjectUi, context: RunContext) => Step): Promise<Step> => {
  const before = await read($, projectAtom)
  const held = await read($, uiAtom)
  const kept = histories[held.name]
  const step = make(before, held, await runContext($))
  const shown = await store($, step, before, kept)
  if (shown.project !== before) await update($, projectAtom, () => shown.project)
  if (shown.ui !== held) await update($, uiAtom, () => shown.ui)

  return { ...step, ...shown }
}

/** Polls the prompt box while a request waits in it or the keys are off (`handed`): once it is empty the line goes and the keys are keys again. */
const watchBox = ($: EngineInterface): void => {
  if (boxWatched) return
  boxWatched = true
  const look = (): void => {
    $.clock.after(BOX_POLL_MS, () => {
      void (async (): Promise<void> => {
        const ui = await read($, uiAtom)
        const waits = ui.handed || isRequestNotice(ui.notice)
        const box = waits ? await $.prompt.read().catch(() => ({ text: '', cursor: 0 })) : null
        if (box !== null && box.text.trim() !== '') return look()
        boxWatched = false
        if (waits) await update($, uiAtom, held => ({ ...held, handed: false, notice: (isRequestNotice(held.notice) || held.notice === HANDED_NOTICE) ? null : held.notice }))
      })()
    })
  }
  look()
}

const MINIMIZE_WORDS: readonly string[] = ['min', 'minimize']
const EXPAND_WORDS: readonly string[] = ['max', 'expand']
/** A Button's hotkey has no case, so `M` presses it too. */
const EXPAND_ELEMENT = 'conductor-expand'
const EXPAND_HOTKEY = 'm'
/** The strip's cells below which the band drops its focus hint. */
const BAND_HINT_MIN = 48
const STRIP_TONES: Record<StripTone, string> = { text: TEXT, faded: FADED, claude: 'claude', success: 'success', error: 'error' }
/** The run's project as read from its file, for a band whose board has another one open; its file is locked while the run is on. */
let stripProject: { name: string; runId: string | undefined; project: Project | null } | null = null
/** The terminal's size at which the band last opened the pane by itself: not tried again until the size changes. */
let autoTried = ''

/** Until the pane is gone its drawings ask for no other minimize, and do not take the pane back. */
let minimizing = false
/** The pane is given this long to be drawn with the room it has before a pane short of room is minimized. */
const MINIMIZE_DELAY_MS = 32
/** Opened by the person from the band: short of room it stays and says why, since a dock can be widened only while it is on screen. */
let heldOpen = false

/** The band shows a run's progress, so the person minimizes only while one is on, or while a replay's is on the board. */
const MINIMIZE_IDLE = 'minimize: the designer minimizes while a workflow runs or replays'
const minimizes = (run: RunState, over: boolean): boolean => run.status === 'running' || (over && runTracker?.replayed() === true)
const canMinimize = async ($: EngineInterface): Promise<boolean> => {
  const run = await read($, runAtom)
  return minimizes(run, overlaysProject(run, await read($, runProjectAtom), await read($, uiAtom)))
}

/** From a clock callback: a drawing asks for it too, and a drawing closes nothing. */
const minimize = ($: EngineInterface, by: Exclude<Minimized, 'no'>, why: CompactWhy | null = null): void => {
  if (minimizing) return
  minimizing = true
  heldOpen = false
  $.clock.after(by === 'auto' ? MINIMIZE_DELAY_MS : 0, () => {
    void (async (): Promise<void> => {
      await flushDrafts($)
      await update($, uiAtom, held => (held.editing || held.picker !== null || held.help > 0 ? { ...held, editing: false, freshId: null, picker: null, help: 0 } : held))
      await update($, shellAtom, () => ({ minimized: by, why }))
      await $.ui.close({ id: PROJECT_PANE_ID }).catch(() => undefined)
    })()
      .catch(() => undefined)
      .then(() => {
        minimizing = false
        $.ui.invalidate('ui.render')
      })
  })
}

/** `asked` opens the pane with the keyboard (a key or a click), else without (the terminal was widened); a pane still short of room minimizes itself anew. */
const expand = async ($: EngineInterface, asked: boolean, columns?: number): Promise<void> => {
  terminalColumns = columns ?? terminalColumns
  heldOpen = asked
  const opened = await $.ui.open(paneArgs(asked)).catch(() => undefined)
  if (opened?.isPlaced === false) return
  // A press in the band holds the keyboard: the pane is shown without it and takes the keys once drawn, as after a click on the graph.
  if (asked) $.clock.after(FOCUS_DELAY_MS * 2, () => void retake($, false).catch(() => undefined))
}

const stripProjectOf = async ($: EngineInterface, name: string, runId: string | undefined): Promise<Project | null> => {
  if (stripProject?.name === name && stripProject.runId === runId) return stripProject.project
  const parsed = isSaved(name) ? parseProject(await $.fs.read(projectFile(await $.session.root(), name)).catch(() => '')) : null
  stripProject = { name, runId, project: parsed?.ok === true ? parsed.project : null }
  return stripProject.project
}

/** A pane opened with nobody asking, in a terminal too narrow for it to be placed: the designer is in the band instead. */
const bandIfWaiting = async ($: EngineInterface, opened: { isPlaced: boolean } | undefined): Promise<void> => {
  if (opened?.isPlaced === false) await update($, shellAtom, held => (held.minimized === 'no' ? { minimized: 'auto' as const, why: 'narrow' as const } : held))
}

const say = async ($: EngineInterface, notice: string): Promise<void> => {
  await update($, uiAtom, held => ({ ...held, notice }))
}

/** The hand-off is left with the offer tool, which the sentence tells Claude to call first. False where there is nothing to hand off. */
const handOff = async ($: EngineInterface, name: string): Promise<boolean> => {
  const shown = await read($, uiAtom)
  const path = projectFile(await $.session.root(), name)
  // A template nobody edited yet is on the board only: handing it off is what saves it.
  const onBoard = shown.name === name && shown.status === 'ready' ? await read($, projectAtom) : null
  if (onBoard !== null && !(await $.fs.exists(path).catch(() => true))) await saveProject($, name, onBoard, null).catch(() => undefined)
  if (!(await $.fs.exists(path).catch(() => false))) return false
  if (onBoard !== null && shown.unsaved) await update($, uiAtom, held => ({ ...held, unsaved: false }))
  const parsed = parseProject(await $.fs.read(path).catch(() => ''))
  if (!parsed.ok || isBlank(parsed.project)) return false
  runTracker?.handoff(handoffOf(name, parsed.project))
  offerHanded(name)
  await update($, uiAtom, held => ({ ...held, follow: true, runCleared: false, notice: held.notice?.startsWith('run: ') ? null : held.notice }))

  return true
}

/** No call hands the keyboard from a pane to the prompt, so the pane is closed and shown again without it; where the keys stayed, none is acted on until the person takes them (`handed`). */
const request = async ($: EngineInterface, kind: 'run' | 'ask' | 'draft'): Promise<void> => {
  const ui = await read($, uiAtom)
  const now = await read($, projectAtom)
  if (kind === 'run' && !isSaved(ui.name)) return say($, 'run: a replay is not a saved project, there is nothing to hand off')
  if (kind === 'run' && (now === null || isBlank(now))) return say($, 'run: the project is empty, add a block first')
  const line = kind === 'run' ? handoffPrompt(ui.name) : kind === 'ask' ? reviewPrompt(ui.name) : draftLine()
  const fill = async (): Promise<boolean> => {
    const filled = await $.prompt.fill({ text: line }).catch(() => ({ isFilled: false }))
    await say($, kind === 'run' ? runNotice(line, filled.isFilled) : kind === 'ask' ? askNotice(line, filled.isFilled) : draftNotice(line, filled.isFilled))
    if (filled.isFilled) watchBox($)

    return filled.isFilled
  }
  if (kind === 'run') {
    // The mod's own prompt does not come by its `prompt.submit` hook: the hand-off is made here.
    if (!(await handOff($, ui.name))) return say($, `run: ${ui.name} could not be handed off`)
    const problems = now === null ? null : preflightLine(now)
    if (now !== null) $.ui.toast(`conductor: ${ui.name} handed to Claude${problems === null ? '' : ` · ${problems}`}`)
    // From a clock callback, never from inside the chain of keys, which it would hold for the turn.
    // Refused (the prompt box holds text): the request is left there for the person to send.
    $.clock.after(SUBMIT_DELAY_MS, () => {
      const submitted = $.prompt.submit({ text: line, asUser: true })
      void submitted.then(entered => (entered.drop === undefined ? undefined : fill())).catch(() => fill())
    })
    await $.ui.close({ id: PROJECT_PANE_ID }).catch(() => undefined)
    await $.ui.open(paneArgs(false)).catch(() => undefined)

    return
  }
  if (!(await fill())) return
  await $.ui.close({ id: PROJECT_PANE_ID }).catch(() => undefined)
  await $.ui.open(paneArgs(false)).catch(() => undefined)
  // The ring can be moved only in a site that holds the keyboard: if it still can, the keys did not go.
  $.clock.after(FOCUS_DELAY_MS * 2, () => {
    const focused = $.ui.focus({ requestId: PROJECT_PANE_ID, key: drawnCatcher })
    void focused
      .catch(() => ({ deny: 'no' }))
      .then(moved => (moved.deny === undefined ? update($, uiAtom, held => ({ ...held, handed: true, notice: HANDED_NOTICE })) : undefined))
      .then(() => watchBox($))
  })
}

const stopDraftTicker = (): void => {
  draftTicker?.cancel()
  draftTicker = null
}

const draftBeat = async ($: EngineInterface): Promise<void> => {
  const ui = await read($, uiAtom)
  if ((ui.drafting ?? null) === null) return stopDraftTicker()
  await update($, draftBeatAtom, beats => beats + 1)
  const project = await read($, projectAtom)
  const shownSoFar = ui.reveal ?? null
  if (ui.drafting !== 'show' || shownSoFar === null || project === null) return
  const rows = flatten(project)
  const upTo = shownSoFar + Math.max(1, Math.ceil(rows.length / REVEAL_STEPS))
  const fresh = rows.slice(shownSoFar, upTo).map(row => row.node.id)
  const done = upTo >= rows.length
  let seq = 0
  await update($, uiAtom, held => {
    if (held.drafting !== 'show' || held.reveal !== shownSoFar) return held
    seq = (held.flash?.seq ?? 0) + 1
    return { ...held, reveal: done ? null : upTo, selectedId: done ? (project.nodes[0]?.id ?? null) : (fresh.at(-1) ?? held.selectedId), flash: { ids: fresh, seq } }
  })
  if (done && seq > 0) {
    $.clock.after(FLASH_CLEAR_MS, () => {
      void update($, uiAtom, held => clearFlash(held, seq))
    })
  }
}

const startDraftTicker = ($: EngineInterface): void => {
  if (draftTicker !== null) return
  draftTicker = $.clock.every(BEAT_MS, () => {
    void draftBeat($).catch(() => undefined)
  })
}

/** The keyboard stays in the prompt, where Claude's questions are answered. */
const beginDraft = async ($: EngineInterface): Promise<void> => {
  await flushDrafts($)
  await update($, draftBeatAtom, () => 0)
  await update($, uiAtom, held => ({ ...held, drafting: 'wait' as const, reveal: null, editing: false, freshId: null, picker: null, confirmId: null, handed: false, notice: null }))
  await $.ui.open(paneArgs(false)).catch(() => undefined)
  startDraftTicker($)
}

/** With `keys` a landed project's board takes the keyboard, where nothing is being typed in the prompt. */
const endDraft = async ($: EngineInterface, keys: boolean): Promise<void> => {
  const ui = await read($, uiAtom)
  if ((ui.drafting ?? null) === null) return
  stopDraftTicker()
  const landed = ui.drafting === 'show'
  await update($, uiAtom, held => ({ ...held, drafting: null, reveal: null, flash: held.flash ? { ids: [], seq: held.flash.seq } : null }))
  $.ui.invalidate('ui.render')
  if (!landed || !keys) return
  const box = await $.prompt.read().catch(() => ({ text: '?', cursor: 0 }))
  if (box.text.trim() !== '') return
  await $.ui.open(paneArgs(true)).catch(() => undefined)
  settleRing($)
}

/** The ring is claimed for the catcher first: a letter typed on Enter's heels is then no text of the field. */
const saveField = async ($: EngineInterface, id: string, base: string, value: string): Promise<void> => {
  ringOn = drawnCatcher
  savedField = { element: fieldKey(base, id), value, taken: 0 }
  const ui = await read($, uiAtom)
  const mine = drafts.id === id && drafts.name === ui.name
  drafts = { name: ui.name, id, values: { ...(mine ? drafts.values : {}), [base]: value } }
  await home($)
  await flushDrafts($, true)
  if (drafts.id === id && drafts.name === ui.name) await landOn($, { base, id }, (await read($, uiAtom)).notice ?? '')
}

const pick = async ($: EngineInterface, choice: Partial<PickRow>): Promise<void> => {
  await flushDrafts($)
  const step = await commit($, (before, held, context) => pickBlock(before, held, choice, context))
  // A block opened on its kinds: the filter is drawn anew, empty, for the kinds' list.
  if (step.ui.picker?.block !== undefined && step.ui.picker.query === '') pickGen++
  const fresh = step.changed && step.ui.editing ? step.ui.freshId : null
  if (fresh !== null) void landOn($, { base: NAME_FIELD, id: fresh }, `edit: ${EDIT_HINT}`)
  else if (!step.ui.picker) await home($)
}

const startFrom = async ($: EngineInterface, templateId: string): Promise<void> => {
  const held = await read($, uiAtom)
  const root = await $.session.root()
  // The name was chosen when the list opened: a project saved under it since (a rename) is never written over.
  const taken = isSaved(held.name) && (await $.fs.exists(projectFile(root, held.name)).catch(() => false))
  const step = startProject(taken ? { ...held, name: freeName(await savedNames($, root)) } : held, templateId)
  if (!step.project) return
  // Not written yet: the first edit (or handing it off) saves it. A project looked at and left leaves no file.
  delete histories[step.ui.name]
  await update($, projectAtom, () => step.project)
  await update($, uiAtom, () => ({ ...step.ui, help: 0, notice: isDefaultName(step.ui.name) ? `named ${step.ui.name} for now · once it is saved, p lists it and e renames it there` : null }))
  settleRing($)
}

const savedNames = async ($: EngineInterface, root: string): Promise<string[]> => {
  const entries = await $.fs.list(`${root.replace(/\/+$/, '')}/${PROJECT_DIR}`).catch(() => [])

  return entries
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
    .map(entry => entry.name.slice(0, -'.json'.length))
    .filter(isSaved)
    .sort()
}

const readSaved = async ($: EngineInterface, root: string): Promise<SavedProject[]> => {
  const dir = `${root.replace(/\/+$/, '')}/${PROJECT_DIR}`
  const names = await savedNames($, root)
  savedPast = Math.max(0, names.length - SAVED_MAX)
  const saved: SavedProject[] = []
  for (const one of names.slice(0, SAVED_MAX)) {
    const text = await $.fs.read(`${dir}/${one}.json`).catch(() => '')
    const parsed = parseProject(text)
    previews[one] = parsed.ok ? parsed.project : null
    saved.push(savedEntry(one, parsed))
  }

  return saved
}

const openProjectList = async ($: EngineInterface): Promise<void> => {
  await flushDrafts($)
  const held = await read($, uiAtom)
  if (held.status !== 'ready' && held.status !== 'error') return
  const project = await read($, projectAtom)
  const root = await $.session.root()
  const saved = await readSaved($, root)
  behind = project !== null && held.status === 'ready' ? { project, ui: { ...held, editing: false, freshId: null, picker: null, confirmId: null, help: 0, notice: null } } : null
  // A template picked there starts a new project, under a name no saved one has.
  const started = openProject(freeName(await savedNames($, root)), undefined, held)
  await update($, projectAtom, () => null)
  await update($, uiAtom, () => ({ ...started.ui, saved, startMark: Math.max(0, saved.findIndex(one => one.name === held.name)), back: held.name }))
  settleRing($)
}

const closeProjectList = async ($: EngineInterface): Promise<void> => {
  const held = await read($, uiAtom)
  const name = held.back ?? null
  if (held.status !== 'pick' || name === null) return
  const kept = behind !== null && behind.ui.name === name ? behind : null
  const text = isSaved(name) ? await $.fs.read(projectFile(await $.session.root(), name)).catch(() => undefined) : undefined
  const step = typeof text === 'string' ? openProject(name, text, held) : null
  behind = null
  if (step !== null && step.project !== null) {
    const project = step.project
    loadedDisk(name, project)
    const viewRootId = kept !== null && kept.ui.viewRootId !== null && findNode(project, kept.ui.viewRootId) ? kept.ui.viewRootId : null
    await update($, projectAtom, () => project)
    await update($, uiAtom, () => ({ ...step.ui, viewRootId, carousels: kept?.ui.carousels ?? {}, runCleared: kept?.ui.runCleared ?? false, follow: kept?.ui.follow ?? true }))
  } else if (step !== null) {
    // Its file is no project: said as it is when opened by name.
    await update($, projectAtom, () => null)
    await update($, uiAtom, () => step.ui)
  } else if (kept !== null) {
    await update($, projectAtom, () => kept.project)
    await update($, uiAtom, ui => ({ ...kept.ui, detailHidden: ui.detailHidden === true, picks: ui.picks ?? {} }))
  } else {
    await update($, uiAtom, ui => ({ ...ui, back: null, notice: `${name} is gone: it could not be read` }))

    return
  }
  settleRing($)
}

const openSaved = async ($: EngineInterface, name: string): Promise<void> => {
  const held = await read($, uiAtom)
  const text = await $.fs.read(projectFile(await $.session.root(), name)).catch(() => undefined)
  const step = openProject(name, typeof text === 'string' ? text : undefined, held)
  if (step.ui.status === 'pick') {
    await update($, uiAtom, ui => ({ ...ui, notice: `${name} is gone: it could not be read` }))

    return
  }
  if (step.project !== null) loadedDisk(name, step.project)
  await update($, projectAtom, () => step.project)
  await update($, uiAtom, () => step.ui)
  settleRing($)
}

const FIXTURES: Record<string, ReplayFixture> = { 'review-41': review41, 'partial-29': partial29 }

/** A replay would take the place of a real run, whose agents would then be counted nowhere. Null when one may start. */
const replayRefusal = (): string | null => {
  if (runTracker === undefined || !runTracker.busy()) return null

  return runTracker.awaitsRun() ? 'a project handed to Claude waits for its run: a replay can start once that run ends' : 'a workflow is running: a replay can start once the run ends'
}

/** The project is named `replay-<template>` and lives in the session only: no file is written, and none is listed. */
const replayOver = async ($: EngineInterface, templateId: string): Promise<void> => {
  const template = TEMPLATES.find(one => one.id === templateId)
  if (!template || runTracker === undefined) return
  const refusal = replayRefusal()
  if (refusal !== null) return say($, refusal)
  const name = `${SCRATCH_PREFIX}${template.id}`
  const made: Project = { ...template.make(), name }
  // Another project under the same name: what could be undone in the one before is not its history.
  delete histories[name]
  behind = null
  await update($, projectAtom, () => made)
  await update($, uiAtom, held => ({ ...carryUi(held, initialUi()), name, status: 'ready' as const, selectedId: made.nodes[0]?.id ?? null, notice: 'replaying a made-up run: token counts are made up, nothing is saved' }))
  settleRing($)
  // A replay reuses its run id: the clock of the one before must not time this one.
  await update($, timesAtom, () => initialTimes())
  if (runTracker.replay(replayProjectEvents(made, name), 'fast', handoffOf(name, made))) return
  // A run began while the board was put up: the tracker kept it.
  const late = replayRefusal()
  if (late !== null) await say($, late)
}

const replayRecording = async ($: EngineInterface, id: string): Promise<void> => {
  const fixture = FIXTURES[id]
  if (!fixture || runTracker === undefined) return
  const refusal = replayRefusal()
  if (refusal !== null) return say($, refusal)
  runTracker.replay(replayEvents(id, fixture), 'fast')
  const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE }).catch(() => undefined)
  if (opened?.isPlaced) runTracker.paneOpened()
  await say($, `replaying ${id} in the run view: token counts are made up`)
}

const openEntry = async ($: EngineInterface, at?: number): Promise<void> => {
  const ui = await read($, uiAtom)
  if (ui.status !== 'pick') return
  const entry = startEntries(ui.saved ?? [])[at ?? ui.startMark ?? 0]
  if (!entry) return
  if (entry.kind === 'replay') return replayOver($, entry.id)
  if (entry.kind === 'recording') return replayRecording($, entry.id)
  const back = ui.back ?? null
  if (entry.kind === 'saved' && entry.id === back) return closeProjectList($)
  // A project started from a template and never edited has no file: left for another, nothing of it is kept.
  const dropped = back !== null && behind !== null && behind.ui.name === back && behind.ui.unsaved ? back : null
  if (entry.kind === 'saved') await openSaved($, entry.id)
  else await startFrom($, entry.id)
  const now = await read($, uiAtom)
  if (now.status !== 'ready') return
  behind = null
  if (dropped !== null && now.notice === null) await say($, `${dropped} was not saved: nothing of it was kept`)
}

const startKey = async ($: EngineInterface, key: string): Promise<boolean> => {
  const ui = await read($, uiAtom)
  if (key === ENTER) {
    await openEntry($)

    return false
  }
  const op = KEY_OPS[key]
  if (op === 'minimize') {
    if (!(await canMinimize($))) {
      await say($, MINIMIZE_IDLE)

      return true
    }
    minimize($, 'person')

    return false
  }
  const helping = (ui.help ?? 0) > 0
  if (op === 'up' || op === 'down') await update($, uiAtom, held => ({ ...moveStartMark(held, op === 'up' ? -1 : 1), help: 0 }))
  else if (op === 'help') await update($, uiAtom, held => ({ ...held, notice: null, help: ((held.help ?? 0) % HELP_PAGES) + 1 }))
  else if (op === 'remove' && helping) await update($, uiAtom, held => ({ ...held, help: 0 }))
  else if ((op === 'projects' || op === 'back') && (ui.back ?? null) !== null) {
    await closeProjectList($)

    return false
  } else await say($, unboundNotice(key))

  return true
}

/** Resolves to false when the keys typed with it are not to be applied (the keyboard went to the prompt, nothing is on the board). */
/** `f`: the board is written over a file that holds no valid project, once the person asks. */
const overwriteFile = async ($: EngineInterface, name: string): Promise<void> => {
  const project = await read($, projectAtom)
  if (!heldOver.has(name) || project === null) return say($, `f: ${name} is saved, there is nothing to write over`)
  try {
    await saveProject($, name, project, project, true)
  } catch (error) {
    // Made valid since: by another session, so the board takes it as any save does.
    if (error instanceof StaleFile) return void (await showSaved($, error, project, null, await read($, uiAtom)))
    return say($, `not saved: ${reason(error)}`)
  }
  await update($, uiAtom, held => ({ ...held, unsaved: false, runCleared: true }))
  await say($, `wrote the board over ${name}.json`)
}

const runKey = async ($: EngineInterface, key: string): Promise<boolean> => {
  const ui = await read($, uiAtom)
  const project = await read($, projectAtom)
  if (ui.drafting === 'wait') return false
  if (ui.status === 'pick') return startKey($, key)
  // A file that is no project: the one key is the way to the others.
  if (ui.status === 'error' && KEY_OPS[key] === 'projects') await openProjectList($)
  if (ui.status !== 'ready' || project === null) return false
  const { locked } = await runContext($)
  const node = ui.selectedId === null ? undefined : findNode(project, ui.selectedId)
  // A field was asked for (`e`, a new block, `n`) and the ring is on its way there: it moves a redraw later. What
  // is typed into the catcher meanwhile is that field's text, never a key: `e` then `x` types an x, it deletes nothing.
  if (!ui.handed && !locked) {
    if (ui.editing && node) {
      const mine = drafts.id === node.id && drafts.name === ui.name
      const first = firstField(node)
      const text = (mine ? drafts.values[first] : undefined) ?? (first !== NAME_FIELD ? (node.knobs?.goal ?? '') : ui.freshId === node.id ? '' : node.name)
      if (key === ENTER) await saveField($, node.id, first, text)
      else {
        // The field may be drawn already, without this letter: it is kept beside it until the typing pauses.
        const pin = pins[fieldKey(first, node.id)]
        if (pin) pin.head += key
        drafts = { name: ui.name, id: node.id, values: { ...(mine ? drafts.values : {}), [first]: pin ? `${pin.value}${pin.head}${pin.tail}` : `${text}${key}` } }
      }

      return true
    }
    if (ui.picker !== null) {
      if (key === ENTER) await pick($, {})
      else {
        await update($, uiAtom, held => typePicker(project, held, `${held.picker?.query ?? ''}${key}`).ui)
        // `x` closed the list before the ring got to its filter.
        if ((await read($, uiAtom)).picker === null) await home($)
      }

      return true
    }
  }
  const op = KEY_OPS[key]
  if (op === undefined) {
    await say($, unboundNotice(key))

    return true
  }
  if (op === 'minimize') {
    if (!(await canMinimize($))) {
      await say($, MINIMIZE_IDLE)

      return true
    }
    minimize($, 'person')

    return false
  }
  const flushed = await flushDrafts($)
  const step = await commit($, (before, held, context) => keyStep(before, held, op, context))
  await keepSaid($, flushed)
  // A request waits in the prompt box: the key was not acted on, and the pane says how to get to the prompt.
  if (ui.handed) return false
  if (op === 'projects') {
    await openProjectList($)

    return false
  }
  if (op === 'overwrite' && !locked) {
    await overwriteFile($, ui.name)

    return true
  }
  if ((op === 'run' || op === 'review') && !locked) {
    await request($, op === 'run' ? 'run' : 'ask')

    return false
  }
  const edited = op === 'edit' && step.ui.editing && step.project && step.ui.selectedId !== null ? findNode(step.project, step.ui.selectedId) : undefined
  if (edited) void landOn($, { base: firstField(edited), id: edited.id }, `edit: ${EDIT_HINT}`)
  if ((op === 'add' || op === 'retype') && step.ui.picker) {
    pickGen++
    void landOn($, 'picker', op === 'add' ? 'new block: click the filter to type in it' : 'block: click the filter to type in it')
  }

  return true
}

/** A change that is no key joins the line of keys: no key is applied between its read and its write. What it throws is its caller's. */
function inLine<T>(work: () => Promise<T>): Promise<T> {
  const done = keyChain.then(work)
  keyChain = done.then(
    () => undefined,
    () => undefined,
  )

  return done
}

const press = ($: EngineInterface, work: () => Promise<unknown>): void => {
  keyChain = keyChain
    .then(async (): Promise<void> => {
      await work()
    })
    .catch((error: unknown) => {
      $.ui.toast(`conductor: ${reason(error)}`)
    })
    .then(() => $.ui.invalidate('ui.render'))
}

/** Each key is applied on the state the one before it left. */
const queueKeys = ($: EngineInterface, keys: readonly string[] | null): void => {
  // The catcher is drawn again under its new key, empty, whatever the keys changed.
  press($, async () => {
    if (keys === null) return say($, PASTE_NOTICE)
    for (const key of keys) if (!(await runKey($, key))) return
  })
}

/** The catcher holds its whole text so far, so the new characters are the ones after those already taken; more than a burst at once is a paste. */
const catchKeys = ($: EngineInterface, element: string, kind: 'change' | 'submit', value: string): void => {
  const { sent } = caught
  // After Enter the text is new from its first character; where it still starts with all that Enter sent, from there.
  const from = caught.element !== element ? 0 : sent === null ? Math.min(value.length, caught.taken) : value.length > sent.length && value.startsWith(sent) ? sent.length : 0
  const fresh = value.slice(from)
  caught = { element, taken: value.length, sent: kind === 'submit' ? value : null }
  tidySoon($)
  const burst = burstKeys(fresh)
  queueKeys($, 'paste' in burst ? null : kind === 'submit' ? [...burst.keys, ENTER] : burst.keys)
}

/** What is typed into the door is the title's text, as what is typed into the catcher after `e` is. */
const doorKeys = ($: EngineInterface, element: string, kind: 'change' | 'submit', value: string): void => {
  const fresh = doored.element === element ? value.slice(Math.min(value.length, doored.taken)) : value
  doored = { element, taken: value.length }
  tidySoon($)
  press($, async () => {
    if (!(await read($, uiAtom)).editing) await openFields($)
    if (!(await read($, uiAtom)).editing) return
    for (const key of [...fresh, ...(kind === 'submit' && value !== '' ? [ENTER] : [])]) if (!(await runKey($, key))) return
  })
}

/** The list closed on Enter and the ring has not left its filter: what is typed there goes where a key typed now goes. False when the keys are not to be applied. */
const closedFilter = async ($: EngineInterface, element: string, value: string): Promise<boolean> => {
  if (pickedField.element !== element) return false
  const fresh = value.slice(afterEnter(pickedField, value))
  pickedField = { ...pickedField, taken: pickedField.taken + fresh.length }
  const burst = burstKeys(fresh)
  if ('paste' in burst) return false
  for (const key of burst.keys) if (!(await runKey($, key))) return false

  return true
}

/** Pressed again before the ring has left, it is Enter for what opened next. */
const filterEnter = ($: EngineInterface, element: string, value: string): void => {
  press($, async () => {
    if ((await read($, uiAtom)).picker !== null) {
      pickedField = { element, value, taken: 0 }

      return pick($, {})
    }
    if (await closedFilter($, element, value)) await runKey($, ENTER)
  })
}

/** While nothing narrows the list `w`, `s` and `n` are keys: the filter is drawn again under a new key, without them. */
const filterKeys = ($: EngineInterface, element: string, value: string): void => {
  press($, async () => {
    const project = await read($, projectAtom)
    if ((await read($, uiAtom)).picker === null) {
      await closedFilter($, element, value)

      return
    }
    const skip = picked.element === element ? Math.min(picked.taken, value.length) : 0
    let taken = 0
    await update($, uiAtom, held => {
      const typed = typePicker(project, held, filterText(held, value.slice(skip)))
      taken = typed.taken
      return typed.ui
    })
    picked = { element, taken: skip + taken }
    if (taken > 0) pickGen++
    if ((await read($, uiAtom)).picker === null) await home($)
  })
}

export const registerProject = (on: On, tracker: Tracker): void => {
  runTracker = tracker
  // run.tsx registers /conductor. With words it is a draft; with none the board: a run in progress on its project
  // (run.tsx's phase view when it came from none), else the project last opened, else the start screen.
  on('command.run', { command: COMMAND }, async ($, e, next) => {
    const typed = e.args.trim().replace(/\s+/g, ' ')
    // Two words are no description: they move the designer between its pane and the band, from the prompt.
    const shellWord = typed.toLowerCase()
    // `max` is the bare command: the board, in its pane, with the keyboard.
    const words = EXPAND_WORDS.includes(shellWord) ? '' : typed
    terminalColumns = e.presentation?.columns ?? terminalColumns
    if (MINIMIZE_WORDS.includes(shellWord)) {
      if ((await read($, shellAtom)).minimized === 'person') return { text: `The designer is minimized already: /${COMMAND} max expands it.` }
      if (!(await canMinimize($))) return { text: `${MINIMIZE_IDLE}.` }
      minimize($, 'person')

      return { text: `Designer minimized into the band above the prompt: /${COMMAND} max expands it.` }
    }
    await flushDrafts($)
    if ((await read($, uiAtom)).handed) await update($, uiAtom, held => ({ ...held, handed: false, notice: held.notice === HANDED_NOTICE ? null : held.notice }))

    if (words !== '') {
      // The brief goes with this answer, and the prompt that follows starts the turn.
      await beginDraft($)
      const prompt = `Draft a workflow project: ${words}`
      // `prompt.submit` is refused inside this hook (it would wait on the turn the hook holds), so it is sent once the command has settled.
      $.clock.after(SUBMIT_DELAY_MS, () => {
        const fill = async (): Promise<void> => {
          const filled = await $.prompt.fill({ text: prompt }).catch(() => ({ isFilled: false }))
          $.ui.toast(filled.isFilled ? 'conductor: press Enter to start the draft' : `conductor: type "${prompt}" to start the draft`)
        }
        const submitted = $.prompt.submit({ text: prompt })
        void submitted.then(entered => (entered.drop === undefined ? undefined : fill())).catch(() => fill())
      })

      return { text: 'drafting a workflow project', context: draftBrief(words) }
    }

    // A draft was awaited and the person asks for the board: the wait is given up, and one being laid out is shown whole.
    await endDraft($, false)
    const bare = bareTarget((await read($, runAtom)).status, await read($, runProjectAtom), await read($, uiAtom))
    if (bare.view === 'run') return next(e)
    const root = await $.session.root()
    const previous = await read($, uiAtom)
    const name = bare.name
    if (previous.name === name && previous.status === 'ready' && (await read($, projectAtom)) !== null) {
      // A field left open when the keyboard went to the prompt is closed: the keys are keys again.
      if (previous.editing || previous.picker !== null) await update($, uiAtom, held => ({ ...held, editing: false, freshId: null, picker: null }))
      await $.ui.open(paneArgs(true)).catch(() => undefined)
      settleRing($)

      return { text: bare.live ? `Project ${name} opened with its run.` : `Project ${name} opened.` }
    }
    const saved = await readSaved($, root)
    // Nothing was opened yet in this session: the saved projects first.
    if (!bare.live && name === DEFAULT_PROJECT_NAME && previous.status === 'closed' && saved.length > 0) {
      const started = openProject(freeName(await savedNames($, root)), undefined, previous)
      await update($, projectAtom, () => null)
      await update($, uiAtom, () => ({ ...started.ui, saved, startMark: 0 }))
      await $.ui.open(paneArgs(true)).catch(() => undefined)
      settleRing($)

      return { text: `${saved.length} saved ${saved.length === 1 ? 'project' : 'projects'}: open one in the pane, or start a new one from a template.` }
    }
    // A replay's project lives in the session only: one that is gone is not started from the start screen.
    if (!isSaved(name)) return { text: `Names starting with ${SCRATCH_PREFIX} are kept for replays: the start screen starts one (p, then a row under "Replay a run").` }
    const path = projectFile(root, name)
    let step = openProject(name, undefined, previous)
    if (await $.fs.exists(path)) {
      try {
        step = openProject(name, await $.fs.read(path), previous)
      } catch (error) {
        // Unreadable is not absent: never offer a template over a file that is there.
        step = { ...step, ui: { ...step.ui, status: 'error', error: `could not be read: ${reason(error)}` } }
      }
    }
    if (step.ui.status === 'pick') step = { ...step, ui: { ...step.ui, name: saved.some(one => one.name === name) ? freeName(await savedNames($, root)) : name, saved, startMark: saved.length } }
    if (step.project !== null) loadedDisk(name, step.project)
    await update($, projectAtom, () => step.project)
    await update($, uiAtom, () => step.ui)
    await $.ui.open(paneArgs(true)).catch(() => undefined)
    settleRing($)

    if (step.ui.status === 'error') return { text: `Project ${name} could not be opened: ${step.ui.error}` }

    return { text: step.ui.status === 'pick' ? 'Open a saved project in the pane, or start a new one from a template.' : `Project ${name} opened.` }
  })

  // The tool Claude edits a project with, deferred: its schema is loaded when Claude asks for it, not sent with every turn.
  // The matcher is always true: run.tsx holds the unmatched session.start.
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    await $.tool.register({ name: TOOL_NAME, description: toolDescription(), inputSchema: TOOL_SCHEMA, isDeferred: true })
    runBoard = { projectOfRun: workflow => projectOfRun($, workflow) }
    setOfferBoard({ drafting: () => beginDraft($) })
    // A load: the state outlives it, what it said of the moment does not.
    await update($, uiAtom, held =>
      held.editing || held.picker !== null || held.handed || held.confirmId !== null || (held.drafting ?? null) !== null || isRequestNotice(held.notice) || held.notice === HANDED_NOTICE
        ? {
            ...held,
            editing: false,
            freshId: null,
            picker: null,
            handed: false,
            confirmId: null,
            drafting: null,
            reveal: null,
            notice: (isRequestNotice(held.notice) || held.notice === HANDED_NOTICE) ? null : held.notice,
          }
        : held,
    )

    return next(e)
  })

  // `r` sends the hand-off sentence itself, past this hook; typed by the person, it hands its project off here.
  on('prompt.submit', { text: /^/ }, async ($, e, enter) => {
    await flushDrafts($)
    const shown = await read($, uiAtom)
    // A "Conductor" answer whose draft never came is over with its turn: a later edit from chat leaves the keyboard alone.
    offerPrompted()
    // The person's own words in the conversation (a notice of a run that ended is not): a handoff that waits for its run waits on.
    if ((e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'sdk') && !e.text.trimStart().startsWith('/')) tracker.prompted()
    // A prompt was sent: whatever waited in the box for the keys is on its way, and the line that said so is spent.
    if (shown.handed || isRequestNotice(shown.notice)) {
      await update($, uiAtom, held => ({ ...held, handed: false, notice: held.notice === HANDED_NOTICE || isRequestNotice(held.notice) ? null : held.notice }))
    }
    // Told with this prompt, once per change, or Claude would answer from what it remembers. The note says the change itself
    // where the project Claude saw is at hand, so no read is spent on it; without one it says to read again.
    let context = e.context ?? []
    const revision = revisions[shown.name] ?? 0
    const seen = seenByClaude[shown.name]
    let told: Project | null = null
    if (shown.status === 'ready' && !e.text.trimStart().startsWith('/') && seen !== undefined && seen !== revision && warnedAt[shown.name] !== revision) {
      warnedAt[shown.name] = revision
      const board = await read($, projectAtom)
      const before = seenProjects[shown.name]
      const elsewhere = (elsewhereAt[shown.name] ?? 0) > seen
      const change = board !== null && before !== undefined ? changedNote(shown.name, revision, before, board, shown.selectedId, elsewhere) : null
      if (change !== null) told = board
      context = [...context, change ?? staleNote(shown.name, revision, elsewhere)]
    }
    const pass = context === (e.context ?? []) ? e : { ...e, context }
    // A change said in full counts as read once the prompt has entered with it: an edit made from it is not refused as stale.
    const submit = async (input: typeof e): Promise<Awaited<ReturnType<typeof enter>>> => {
      const answer = await enter(input)
      if (told !== null && answer.drop === undefined && (revisions[shown.name] ?? 0) === revision) sawProject(shown.name, told)

      return answer
    }
    // The hand-off sentence, typed or left in the box by `r`: the hand-off is made as `r` makes it.
    const name = handoffTarget(e.text)
    // Never a throw: the prompt goes in all the same.
    if (name !== null && isSaved(name)) await handOff($, name).catch(() => false)

    return submit(pass)
  })

  // A draft still awaited stays so where the turn ended on a question; given up with Escape, it is over. From a clock callback: the pane is not opened inside this hook.
  // The matcher is always true: run.tsx holds the unmatched turn.complete.
  on('turn.complete', { isAborted: [true, false] }, async ($, e, next) => {
    if (e.agentId === undefined) {
      const drafting = (await read($, uiAtom)).drafting ?? null
      if (drafting === 'show' || (drafting === 'wait' && e.isAborted)) {
        $.clock.after(FOCUS_DELAY_MS, () => {
          void endDraft($, true).catch(() => undefined)
        })
      }
    }

    return next(e)
  })

  // A summary does not hold the project as Claude read it, so Claude reads again; a `precompute` installs no summary.
  // A cleared conversation, and the one a resume leaves, hold nothing of any project.
  on('session.compact', async ($, e, next) => {
    const answer = await next(e)
    if (e.trigger !== 'precompute' && e.agentId === undefined && answer.skip === undefined) forgetSeenProjects()

    return answer
  })
  on('session.end', { reason: ['clear', 'resume'] }, async ($, e, next) => {
    forgetConversation()

    return next(e)
  })

  // Every edit is made by src/project/chat.ts on the mod's own state, so the graph redraws from the atoms and nothing unchecked is saved.
  on('tool.call', { tool: TOOL_FULL_NAME }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const action = input.action
    if (action !== 'read' && action !== 'apply' && action !== 'write' && action !== 'attach') return { deny: 'action must be one of read, apply, write, attach' }

    // In the line of keys: no key is applied between the project being read here and the edit being written back,
    // or the key's change would be undone unsaid, and counted as seen by Claude.
    return inLine(async () => {
      // Text typed and not sent is the person's edit: saved first, so an edit made without having read it is refused as stale instead of writing over it.
      await flushDrafts($)
      const ui = await read($, uiAtom)
      const named = typeof input.name === 'string' && input.name.trim() !== ''
      const asked = named ? projectName(String(input.name)) : null
      // Never another project in its place: a name with nothing to keep is refused.
      if (named && asked === null) return { deny: '`name` must be a short kebab-case name with a letter (a to z) or a digit in it. Nothing was changed.' }
      // An attach is for the run tracked now, whose script run.tsx noted; with no name it is the project drawn of that run before.
      const ran = action === 'attach' ? await read($, runScriptAtom) : null
      const tracked = tracker.state()
      if (action === 'attach' && (ran === null || tracked.status === 'idle' || tracked.runId !== ran.runId)) return { deny: 'No workflow run is tracked now, so there is no run to attach a project to. Nothing was changed.' }
      const name = asked ?? (action === 'attach' ? (ran?.drawn ?? null) : ui.status === 'ready' ? ui.name : null)
      if (name === null) return { deny: action === 'attach' ? 'attach needs `name`: a short kebab-case name for the project. Nothing was changed.' : `No project is open on the board and no \`name\` was given, so there is no project to ${action}. Nothing was changed.` }
      const root = await $.session.root()
      const path = projectFile(root, name)
      const isOpen = ui.status === 'ready' && ui.name === name
      if (action === 'attach' && ran?.drawn !== name) {
        // The first attach of this run under this name: the run must be nobody's yet, and the name free.
        const owner = tracker.project()
        if (owner !== undefined && owner !== name) return { deny: `This run already belongs to project ${owner}. Nothing was changed.` }
        if (!isSaved(name)) return { deny: `Names starting with ${SCRATCH_PREFIX} are kept for replays. Nothing was changed. A name no project has is free to use.` }
        if (owner === name || isOpen || (await $.fs.exists(path))) return { deny: `A project named ${name} exists that this run did not create. Nothing was changed. A name no project has is free to use.` }
      }
      let project: Project | null = isOpen ? await read($, projectAtom) : null
      let isNew = false
      if (project === null) {
        if (isSaved(name) && (await $.fs.exists(path))) {
          const parsed = parseProject(await $.fs.read(path).catch(() => ''))
          if (!parsed.ok) return { deny: `${PROJECT_DIR}/${name}.json is not a valid project (${parsed.error}). Nothing was changed.` }
          // Named as its file is (`openProject`).
          project = { ...parsed.project, name }
          loadedDisk(name, project)
        } else if (action === 'read' || !isSaved(name)) {
          return { deny: `No project named ${name}. An apply or write with that name starts it.` }
        } else {
          project = emptyProject(name)
          isNew = true
        }
      }
      const locked = (await read($, runProjectAtom)) === name && (await read($, runAtom)).status === 'running'
      if (action === 'read') {
        sawProject(name, project)

        return { result: readReport(project, { open: isOpen, selectedId: isOpen ? ui.selectedId : null, locked, revision: revisions[name] ?? 0 }) }
      }
      // The lock the board applies to the person's own edits. An attach is past it: the project is this run's own drawing.
      if (locked && action !== 'attach') return { deny: `Project ${name} is being run: editing is locked until the run ends, for the board and for you alike. Nothing was changed.` }

      // An edit made from memory of a board that has since changed by hand would undo the person's work.
      const known = seenByClaude[name]
      if (known !== undefined && known !== (revisions[name] ?? 0)) {
        const who = (elsewhereAt[name] ?? 0) > known ? `Project ${name} was changed in another session` : `The user changed project ${name} on the board by hand`
        return { deny: `${who} since you last read it (it is now revision ${revisions[name] ?? 0}, you saw ${known}), so this edit was made from a project that is gone. Nothing was changed.` }
      }
      // A whole tree written over a project Claude has not seen in this conversation would replace the person's work unread
      // (a draft Claude named as a project that exists). An attach is guarded above; a project with no block yet is free.
      if (action === 'write' && known === undefined && !isBlank(project)) {
        return { deny: `A project named ${name} exists and you have not read it in this conversation, so a write would replace it unseen. Nothing was changed. A name no project has is free to use.` }
      }
      const edit = action === 'apply' ? applyOps(project, input.ops) : replaceProject(project, input.nodes)
      if (!edit.ok) return { deny: edit.error }
      try {
        if (isSaved(name)) await saveProject($, name, edit.project, isNew ? null : project)
      } catch (error) {
        if (error instanceof InvalidFile) return { deny: `Project ${name}'s file is not a valid project now, so nothing was changed. Fix ${name}.json with Edit, or ask the user to press f on the board to write the board over it.` }
        if (!(error instanceof StaleFile)) return { deny: `Project ${name} could not be saved, nothing was changed: ${reason(error)}` }
        if (isOpen) await showSaved($, error, project, null, ui)
        else changedElsewhere(name)

        return { deny: `Project ${name} was changed in another session since this one loaded it${isOpen ? ', and the board now shows that' : ''}, so this edit was made on a project that is gone. Nothing was changed.` }
      }
      // The script the run is of is the one the next handoff starts from.
      if (ran !== null) {
        offerRan(name, { runId: ran.runId, transcriptDir: tracked.transcriptDir, script: ran.path }, true)
      }
      // Undone like any edit made by hand; and Claude has seen what it just wrote.
      const said = changeWords(edit)
      if (said !== '') record(name, project, `Claude ${said}`)
      // What Claude holds of it now is what it sent and what the answer says. Where the project stored has more (text a
      // kind filled in, a block from a project it never read whole), no later change is said against it: Claude reads again.
      if (knownAfterEdit(edit.project, seenProjects[name], input)) sawProject(name, edit.project)
      else {
        delete seenProjects[name]
        seenByClaude[name] = revisions[name] ?? 0
      }
      await update($, projectAtom, () => edit.project)
      await update($, uiAtom, held => showEdit(held, name, edit.project, edit))
      // The draft the splash waited for is laid out block by block; any other edit made meanwhile is shown as edits are.
      const awaited = ui.drafting === 'wait'
      const drafted = awaited && action === 'write' && isBlank(project)
      if (awaited) {
        await update($, uiAtom, held =>
          drafted ? { ...held, drafting: 'show' as const, reveal: 1, selectedId: edit.project.nodes[0]?.id ?? null, notice: null, flash: { ids: [], seq: held.flash?.seq ?? 0 } } : { ...held, drafting: null, reveal: null },
        )
      }
      if (drafted) startDraftTicker($)
      const seq = (await read($, uiAtom)).flash?.seq ?? 0
      let unplaced: string[] | null = null
      if (ran !== null) {
        await update($, runScriptAtom, held => (held !== null && held.runId === ran.runId ? { ...held, drawn: name } : held))
        unplaced = await showRunOn($, tracker, name, edit.project)
      }
      // Shown, but the keyboard stays where the person is typing. A draft the person asked for takes the keyboard once
      // Claude's turn is over (`endDraft`), at once where no splash waited for it.
      const offered = action === 'write' && takeOffered()
      if (offered || drafted) offerDrafted(name)
      const opened = await $.ui.open(paneArgs(offered && !drafted)).catch(() => undefined)
      await bandIfWaiting($, opened)
      if (offered && !drafted) settleRing($)
      $.clock.after(FLASH_CLEAR_MS, () => {
        void update($, uiAtom, held => clearFlash(held, seq))
      })
      // In a terminal too narrow for the pane to open unasked the band shows the project, and Claude says the way to the designer.
      const report = editReport(edit.project, edit, revisions[name] ?? 0)

      const notes = [
        ...(ran === null ? [] : [attachNote(edit.project, unplaced ?? [])]),
        ...((!isOpen || ran !== null) && opened?.isPlaced === false ? [unplacedNote(name)] : []),
      ]

      return { result: [report, ...notes].join('\n') }
    })
  })

  // The open board follows a project file written with the built-in tools, and keeps the last good project when the file does not read as one.
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const target = (e as unknown as { file_path?: unknown }).file_path
    const root = await $.session.root()
    const name = typeof target === 'string' ? projectOfPath(root, await $.session.cwd().catch(() => root), target) : null
    if (name === null) return next(e)
    if ((await read($, runProjectAtom)) === name && (await read($, runAtom)).status === 'running') {
      return { deny: `Project ${name} is being run: its file is locked until the run ends.` }
    }
    await flushDrafts($)
    const answer = await next(e)
    if (answer.deny !== undefined || answer.isError === true) return answer
    const parsed = parseProject(await $.fs.read(projectFile(root, name)).catch(() => ''))
    // Claude's own write: the next save is checked against it, not taken for another session's.
    if (parsed.ok) onDisk[name] = { ...parsed.project, name }
    if (parsed.ok) heldOver.delete(name)
    else heldOver.add(name)
    const ui = await read($, uiAtom)
    if (ui.name !== name || ui.status === 'closed') return answer
    if (!parsed.ok) {
      $.ui.toast(`conductor: ${oneLine(name)}.json is not a valid project (${cutCells(oneLine(parsed.error), 80)}); the board keeps the last good one`)

      return answer
    }
    const written: Project = parsed.project.name === name ? parsed.project : { ...parsed.project, name }
    const before = ui.status === 'ready' ? await read($, projectAtom) : null
    const change = diffProjects(before, written)
    if (before !== null && !sameProject(before, written)) record(name, before, `the file ${changeWords(change) || 'changed'}`)
    sawProject(name, written)
    await update($, projectAtom, () => written)
    await update($, uiAtom, held => showEdit(held, name, written, change))
    const seq = (await read($, uiAtom)).flash?.seq ?? 0
    $.clock.after(FLASH_CLEAR_MS, () => {
      void update($, uiAtom, held => clearFlash(held, seq))
    })

    return answer
  })

  on('ui.message', { requestId: PROJECT_PANE_ID, element: CANVAS_ELEMENT }, async ($, e, next) => {
    const message = parseGraphMessage(e.data)
    if (!message) return next(e)

    // A key the graph itself was given: the same as typed into the catcher. It held the keyboard, so the click before
    // it was not heard of (two posts in a frame can drop one): the pane takes the keys back first, as after a click.
    if (message.kind === 'key') {
      if (!(await read($, uiAtom)).handed) await retake($, false)
      queueKeys($, [message.key])

      return {}
    }
    // A click on the graph is a way out of a field: what was typed there is saved first. In the line of keys, as the tool's edit is.
    await inLine(async () => {
      const flushed = await flushDrafts($)
      const project = await read($, projectAtom)
      const ui = await read($, uiAtom)
      const context = await runContext($)
      const kept = histories[ui.name]
      const step = applyMessage(project, ui, message, context)
      const shown = await store($, step, project, kept)
      const nextUi = shown.ui
      if (shown.project !== project) await update($, projectAtom, () => shown.project)
      if (nextUi !== ui) await update($, uiAtom, () => nextUi)
      await keepSaid($, flushed)
      // A `[+]` needs its filter to type in. (So does a list the click left open: the catcher is not drawn under it.)
      await retake($, nextUi.picker !== null && !context.locked)
    })

    return {}
  })

  // The pane's tree is as tall as its body, so the engine has nothing to scroll: over the graph's rows the wheel pans the graph.
  // Anywhere else, and for the scroll keys, the move is the engine's.
  on('ui.scroll', { requestId: PROJECT_PANE_ID }, async ($, e, next) => {
    const at = e.pointer
    const area = graphArea
    if (e.origin.kind !== 'person' || at === undefined || area === null) return next(e)
    if (at.row < area.top || at.row >= area.top + area.rows || at.column < area.left || at.column >= area.left + area.columns) return next(e)
    wheelRows += e.by
    $.ui.invalidate('ui.render')

    return {}
  })

  // A person's move that lands on anything but a field is followed by the mod's own move back to the catcher: the engine refuses another element
  // in the chain where the person's move named none. In a list the move is refused instead, and the mark moves. The mod's own moves do not come here.
  on('ui.focus', { requestId: PROJECT_PANE_ID }, async ($, e, next) => {
    const person = e.origin.kind === 'person'
    const before = await read($, uiAtom)
    // The add list is open and the ring left its filter: the arrows choose. A step that lands on a row of the list
    // was Down; any other (the stop before the filter) was Up. The ring goes back to the filter: letters stay its text.
    if (person && before.status === 'ready' && before.picker !== null && !isPickerField(e.element)) {
      const project = await read($, projectAtom)
      await update($, uiAtom, held => movePick(project, held, (e.element ?? '').startsWith('pick:') ? 1 : -1))
      $.ui.invalidate('ui.render')

      return { deny: ARROWS_CHOOSE }
    }
    const door = person && isDoor(e.element)
    // On the door with the fields open, the person stepped back from the first field: the way to the graph.
    const leaves = door && before.editing
    const stray = person && (before.status === 'ready' || before.status === 'pick') && drawnCatcher !== '' && !isCatcher(e.element) && !isDetailStop(e.element) && !door
    // On the start screen the arrows choose, as in the add list: a step onto a row was Down, any other Up.
    if (stray && before.status === 'pick') {
      await update($, uiAtom, held => ({ ...moveStartMark(held, (e.element ?? '').startsWith(START_PREFIX) ? 1 : -1), help: 0 }))
      $.ui.invalidate('ui.render')

      return { deny: ARROWS_CHOOSE }
    }
    const was = ringOn
    // Said before the move is answered: a letter typed on its heels finds the ring known to be there.
    ringOn = stray || leaves ? drawnCatcher : e.element
    const moved = await next(e)
    if (moved.deny !== undefined) {
      ringOn = was

      return moved
    }
    if (stray || leaves) await $.ui.focus({ requestId: PROJECT_PANE_ID, key: drawnCatcher }).catch(() => settleRing($))
    const flushed = person ? await flushDrafts($) : null
    const rest = stray ? null : restBase(e.element)
    const inDetail = !stray && !leaves && (isField(e.element) || door || rest !== null)
    const held = await read($, uiAtom)
    if (held.status === 'ready' && held.editing !== inDetail && (inDetail || person)) await update($, uiAtom, ui => ({ ...ui, editing: inDetail, freshId: inDetail ? ui.freshId : null }))
    // The person's Down arrow from the catcher: the fields open, and the ring goes on to the first (or to the field at rest it came to).
    if ((door && !leaves) || rest !== null) await openFields($, rest ?? undefined)
    await keepSaid($, flushed)
    $.ui.invalidate('ui.render')

    return moved
  })

  on('ui.close', { id: PROJECT_PANE_ID }, async ($, e, next) => {
    await flushDrafts($)

    return next(e)
  })

  // A letter typed while `landing`: the engine gave it to the prompt box, and the keyboard with it. The matcher sees it as one character typed into an empty box.
  // It is not let in: it is queued as the key it was, and the pane takes the keyboard again from a clock callback (inside this hook the take is refused).
  on('prompt.edit', { text: '' }, async ($, e, next) => {
    if (!landing || e.key === undefined || e.key.ctrl === true || e.key.meta === true || [...e.inputText].length !== 1) return next(e)
    landing = false
    const key = e.inputText
    $.clock.after(FOCUS_DELAY_MS, () => {
      void retake($, false)
        .catch(() => undefined)
        .then(() => queueKeys($, [key]))
    })

    return { text: e.text, cursor: e.cursor }
  })

  // The board holds what the call's input and report say at length: the transcript draws a line for each.
  on('ui.render', { component: 'ToolUse', props: { tool: TOOL_FULL_NAME } }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    const { input, isRunning, isErrored, isInterrupted } = e.props

    return (
      <Text wrap="truncate-end">
        <Text color={isRunning ? FADED : isErrored ? 'error' : 'success'}>{`${GLYPH.dot} `}</Text>
        <Text color={TEXT} bold>
          {TOOL_TITLE}
        </Text>
        <Text color={FADED}>{` · ${callLine(input)}${isInterrupted ? ' · interrupted' : ''}`}</Text>
      </Text>
    )
  })
  // An errored row draws the engine's own error text whatever `output` says, so its line is drawn here.
  on('ui.render', { component: 'ToolResult', props: { tool: TOOL_FULL_NAME } }, async ($, e, next) => {
    const { output, isErrored } = e.props
    if (typeof output !== 'string') return next(e)
    if (!isErrored) return next({ ...e, props: { ...e.props, output: resultLine(output, false) } })
    const { Text } = $.ui.resolve(e)

    return (
      <Text wrap="truncate-end">
        <Text color={FADED}>{`  ${GLYPH.elbow}  `}</Text>
        <Text color="error">{resultLine(output, true)}</Text>
      </Text>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PROJECT_PANE_ID }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : null
    const ui = await read($, uiAtom)
    const project = await read($, projectAtom)
    const file = `${PROJECT_DIR}/${ui.name}.json`
    const bodyColumns = e.props.bodyColumns || 80
    const columns = Math.max(20, bodyColumns - 2)
    const run = await read($, runAtom)
    const runProject = await read($, runProjectAtom)
    const over = overlaysProject(run, runProject, ui)
    const locked = (over && run.status === 'running') || ui.drafting === 'show'
    // The tick clock is read only while it matters, so an idle pane is not redrawn by it.
    const clock = locked ? await read($, clockAtom) : 0
    const overlay = over ? runOverlay(run, clock) : undefined
    const draftBeats = (ui.drafting ?? null) !== null ? await read($, draftBeatAtom) : 0
    const splashed = await read($, splashedAtom)
    // Whether the pane holds the keyboard: Escape hands it to the prompt, and a field left open then is closed to the eye.
    const focused = e.props.isFocused !== false
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 48
    // A pane with no room for the screen draws none of it: the designer goes into the band, which says why.
    const shell = await read($, shellAtom)
    if (!fitsFull(bodyColumns, bodyRows)) {
      const why = whyCompact({ dock: e.props.placement !== 'inline', bodyColumns, bodyRows, fullscreen: e.viewport?.isFullscreen === true })
      if (heldOpen)
        return (
          <Box flexDirection="column">
            <Text color={FADED} wrap="truncate-end">{`${GLYPH.diamond} ${WHY_TEXT[why]}`}</Text>
            <Box flexDirection="row" justifyContent="space-between">
              <Button key={`${MINIMIZE_BUTTON}:held`} plain onPress={() => minimize($, 'person')}>
                <Text>
                  <Text color="claude">{`[${MINIMIZE_KEYS}]`}</Text>
                  <Text color={TEXT}> Minimize</Text>
                </Text>
              </Button>
              {/* A Button with a hotkey writes it before its label, so the key is this one, not drawn. */}
              <Box key="project-minimize-key" display="none">
                <Button key={`${MINIMIZE_BUTTON}:key`} hotkey={MINIMIZE_KEYS} onPress={() => minimize($, 'person')}>
                  Minimize
                </Button>
              </Box>
              <Text color={FADED}>{FOCUS_HINT}</Text>
            </Box>
          </Box>
        )
      if (!minimizing) minimize($, 'auto', why)

      return <Text color={FADED}>{`${GLYPH.diamond} ${PROJECT_PANE_TITLE}: no room here for the designer, it goes to the band above the prompt`}</Text>
    }
    heldOpen = false
    // Drawn in its pane again: the band has nothing to show. Asked of the engine, not taken from this drawing: one
    // that was on its way when the pane closed is of a pane that is gone. Written from a clock callback: a drawing changes no state.
    if (shell.minimized !== 'no' && !minimizing && (await $.ui.panes()).some(pane => pane.id === PROJECT_PANE_ID && pane.isPlaced)) {
      $.clock.after(0, () => void update($, shellAtom, held => (minimizing ? held : initialShell())))
    }
    const node = project === null || ui.selectedId === null ? undefined : findNode(project, ui.selectedId)
    const problems = project ? lint(project) : []
    const starting = ui.status === 'pick' || (ui.status === 'ready' && !project)
    const entries = starting ? startEntries(ui.saved ?? []) : []
    const mark = Math.max(0, Math.min(entries.length - 1, ui.startMark ?? 0))
    const marked = entries[mark]

    // Every part is cut to its room, so the row never wraps.
    const drafting = ui.drafting === 'show' && project !== null
    const listing = starting && (ui.back ?? null) !== null
    const summary = over ? runSummary(run, elapsedOf(await read($, timesAtom), run), Math.max(8, columns - COMMAND.length - 3 - 10 - 3)) : null
    const begins = listing ? 'PROJECTS' : 'START'
    const state: { text: string; color: 'claude' | 'success' | 'error' | typeof FADED } =
      summary !== null
        ? { text: summary.text.replace(/^[a-z]+/, word => word.toUpperCase()), color: summary.color }
        : drafting
          ? { text: 'DRAFTING', color: 'claude' }
          : starting && marked
            ? { text: `${begins} · ${marked.kind === 'saved' ? 'saved project' : marked.kind === 'blank' ? 'blank project' : marked.kind === 'replay' ? `replay over the ${marked.title} template` : marked.kind === 'recording' ? 'recorded run' : `from the ${marked.title} template`}`, color: FADED }
            : ui.status !== 'ready' || !project
              ? { text: 'project', color: FADED }
              : { text: `EDITING · ${!isSaved(ui.name) ? 'replay, not saved' : heldOver.has(ui.name) ? 'not saved: the file is invalid' : !ui.unsaved ? 'saved' : isBlank(project) ? 'not saved yet' : 'unsaved template'}`, color: FADED }
    const shownName = oneLine(starting && marked?.kind === 'saved' ? marked.id : ui.name)
    const pressable = listing || !starting
    const nameMark = !pressable ? '' : listing ? ' ▴' : ' ▾'
    const legendRow = (row: readonly LegendItem[]) => (
      <Text wrap="truncate-end">
        {row.flatMap((item, index) => [
          <Text color={focused ? 'claude' : FADED}>{`${index > 0 ? ' '.repeat(LEGEND_GAP) : ''}[${item.keys}]`}</Text>,
          <Text color={FADED}>{` ${item.word}`}</Text>,
        ])}
      </Text>
    )
    const headLegend = (row: readonly LegendItem[]) =>
      row.flatMap((item, index) => [
        ...(index > 0 ? [<Box width={LEGEND_GAP} flexShrink={0} />] : []),
        <Box flexShrink={0}>
          <Text>
            <Text color={focused ? 'claude' : FADED}>{`[${item.keys}]`}</Text>
            <Text color={FADED}>{` ${item.word}`}</Text>
          </Text>
        </Box>,
      ])
    // Short of room the state goes first; the name keeps eight cells at the least.
    const headOf = (keys: readonly LegendItem[] = []) => {
      const room = columns - COMMAND.length - 3 - nameMark.length
      const said = room - cellWidth(state.text) - 3 >= 8 ? state : null
      const left = room - (said === null ? 0 : cellWidth(said.text) + 3)
      const name = <Text bold color={TEXT}>{clip(shownName, Math.max(8, left))}</Text>
      return [
        <Box flexDirection="row" height={1} flexShrink={0}>
          <Text bold color="claude">{COMMAND}</Text>
          <Text color={FADED}>{' / '}</Text>
          {pressable ? (
            <Button key={NAME_BUTTON} plain onPress={() => queueKeys($, ['p'])}>
              {name}
              <Text color={focused ? 'claude' : FADED}>{nameMark}</Text>
            </Button>
          ) : (
            name
          )}
          {said !== null && <Text color={FADED}>{' / '}</Text>}
          {said !== null && <Text key="project-state" color={said.color}>{said.text}</Text>}
        </Box>,
        <Box key="project-legend" flexDirection="row" height={1} flexShrink={0}>
          {keys.length > 0 ? headLegend(legendRows(keys, columns, 1)[0] ?? []) : <Text color={TEXT}> </Text>}
        </Box>,
      ]
    }

    if (ui.status === 'closed' && ui.drafting !== 'wait') {
      return (
        <Box flexDirection="column">
          <Text bold color={TEXT}>{`${GLYPH.diamond} ${PROJECT_PANE_TITLE}`}</Text>
          <Text color={FADED}>{`${GLYPH.railEnd} /${COMMAND} opens the start screen`}</Text>
        </Box>
      )
    }

    /** `wide`: it indents itself (an open field's Input needs the pane's full width). `keep`: its last row stays in view when the rows do not hold all. */
    type Item = { rows: number; el: RenderChildren; wide?: true; keep?: true }
    type Tint = typeof FADED | 'error' | 'warning' | 'suggestion'
    const blank: Item = { rows: 1, el: <Text color={TEXT}> </Text> }
    const spanRows = (rows: readonly (readonly PersonaSpan[])[]) =>
      rows.map(row => (
        <Box flexDirection="row" height={1} flexShrink={0}>
          {row.map(span => (
            <Text color={span.color ?? TEXT} backgroundColor={span.ground}>{span.text}</Text>
          ))}
        </Box>
      ))
    const rowsOf = (items: readonly Item[]): number => items.reduce((sum, item) => sum + item.rows, 0)
    const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
    const line = (text: string, color?: Tint, bold?: true): Item => ({ rows: 1, el: <Text color={color ?? TEXT} bold={bold} wrap="truncate-end">{text}</Text> })
    const lines = (rows: readonly string[], color?: Tint): Item[] => rows.map(row => line(row, color))
    // A label is quiet: `claude` is kept for what can be pressed and for the selection.
    const label = (text: string): Item => line(text, 'suggestion')
    const fit = (levels: number, rows: number, plan: (level: number) => Item[]): Item[] => {
      for (let level = 0; level < levels - 1; level++) {
        const items = plan(level)
        if (rowsOf(items) <= rows) return items
      }
      return plan(levels - 1)
    }
    const rule = () => <Text color={RULE}>{'─'.repeat(columns)}</Text>
    // One row always, blank where there is none to press, so the pane keeps its shape.
    // The actions centred between two sides as wide as the focus hint, which is in the right one.
    const actionsOf = (actions: readonly LegendAction[]) => (
      <Box key="project-actions" flexDirection="row" height={1} flexShrink={0}>
        <Box width={FOCUS_HINT.length} flexShrink={0} />
        <Box flexDirection="row" flexGrow={1} justifyContent="center">
          {actions.length === 0 && <Text color={TEXT}> </Text>}
          {actions.flatMap((action, index) => {
            const label = (
              <Text>
                <Text color={action.on && focused ? 'claude' : FADED}>{`[${action.key}]`}</Text>
                <Text color={action.on ? TEXT : FADED}>{` ${action.word}`}</Text>
              </Text>
            )
            return [
              ...(index > 0 ? [<Box width={ACTION_GAP} flexShrink={0} />] : []),
              action.on ? (
                <Box flexShrink={0}>
                  <Button key={`${ACTION_BUTTON_PREFIX}${action.key}`} plain onPress={() => queueKeys($, [action.key])}>
                    {label}
                  </Button>
                </Box>
              ) : (
                label
              ),
            ]
          })}
        </Box>
        <Box width={FOCUS_HINT.length} flexShrink={0}>
          <Text color={FADED}>{FOCUS_HINT}</Text>
        </Box>
      </Box>
    )
    // Less the header, the rule under it, the rule above the buttons and their row.
    const mainRows = Math.max(MAIN_LEAST_ROWS, bodyRows - HEAD_ROWS - 2 - 1)
    const catcher = () =>
      Input && (
        <Box key="project-keys" display="none">
          <Input
            key={catcherKey()}
            autoFocus
            value=""
            placeholder=""
            submitLabel=""
            onInput={(value, input) => catchKeys($, input.element, 'change', value)}
            onSubmit={(value, input) => catchKeys($, input.element, 'submit', value)}
          />
        </Box>
      )
    // A file that is no project: its one key is typed into the catcher, drawn after the header as in the frame.
    if (ui.status === 'error' && ui.drafting !== 'wait') {
      drawnCatcher = Input !== null ? catcherKey() : ''
      fieldsDrawn = false
      return (
        <Box flexDirection="column" paddingLeft={1}>
          {headOf([{ keys: 'p', word: 'Projects', core: true }])}
          {catcher()}
          <Text color="error">{oneLine(`${file} could not be used: ${ui.error ?? 'unknown reason'}`)}</Text>
          <Text color={FADED}>{`The file was left as it is. Fix or remove it, then run /${COMMAND} again.`}</Text>
        </Box>
      )
    }
    // What is said stands in the rule over the footer, so nothing moves when something is said.
    type Said = { text: string; color: 'warning' | typeof FADED | undefined } | null
    const saidW = Math.max(1, columns - 2 * (SAID_RULE_W + 1))
    const saidRow = (said: Said) => {
      const text = said === null ? '' : clip(oneLine(said.text), saidW)
      if (text === '') return rule()
      const wide = cellWidth(text)
      const left = Math.max(0, Math.floor((columns - wide - 2) / 2))
      return (
        <Text key="project-message" wrap="truncate-end">
          <Text color={RULE}>{'─'.repeat(left)}</Text>
          <Text color={said?.color ?? TEXT}>{` ${text} `}</Text>
          <Text color={RULE}>{'─'.repeat(Math.max(0, columns - wide - 2 - left))}</Text>
        </Text>
      )
    }
    const hintsOf = (items: readonly LegendItem[], width: number, rows: number): LegendItem[][] => legendRows(items, width, rows >= 8 ? HINT_ROWS : 1)
    // As wide as the pane, its rows indented by `left` cells, the graph laid over them: a field typed in has the pane's full width, the one width the engine wraps it at.
    // Taller than its rows, it is moved up until the `keep` item ends in view.
    const detailBox = (rows: number, hints: readonly (readonly LegendItem[])[], items: readonly Item[], left: number) => {
      const room = rows - hints.length
      const kept = items.findIndex(item => item.keep)
      const up = kept < 0 ? 0 : Math.max(0, rowsOf(items.slice(0, kept + 1)) - room)
      return (
        <Box key="project-detail" flexDirection="column" height={rows} flexShrink={0}>
          {room > 0 && (
            <Box key="project-content" flexDirection="column" height={room} overflow="hidden">
              {/* Never squeezed: what does not fit is cut at the bottom, whole rows. */}
              <Box flexDirection="column" flexShrink={0} marginTop={-up}>
                {items.map(item => (item.wide ? item.el : <Box flexDirection="column" flexShrink={0} paddingLeft={left} paddingRight={1}>{item.el}</Box>))}
              </Box>
            </Box>
          )}
          <Box key="project-hints" flexDirection="column" height={hints.length} flexShrink={0} paddingLeft={left} paddingRight={1}>
            {hints.map(legendRow)}
          </Box>
        </Box>
      )
    }
    // The margin is each part's own, not the frame's, which would take the pane's full width from the detail pane.
    // `detail` is null while the detail pane is hidden: the graph has it all.
    const margin = (children: RenderChildren) => <Box flexDirection="column" paddingLeft={1} paddingRight={1}>{children}</Box>
    const frame = (catching: boolean, head: RenderChildren, graph: RenderChildren, detail: RenderChildren | null, said: Said, actions: RenderChildren) => (
      <Box flexDirection="column" position="relative">
        <Box flexDirection="row" paddingLeft={1} paddingRight={1}>
          <Box flexDirection="column" width={columns} height={HEAD_ROWS} flexShrink={0}>
            {head}
          </Box>
        </Box>
        {/* After the header: the name there is a stop before the catcher, so the Down arrow still goes from the catcher to the detail pane. */}
        {catching && catcher()}
        {margin(rule())}
        {detail !== null ? (
          <Box flexDirection="column" height={mainRows}>
            {detail}
          </Box>
        ) : (
          margin(graph)
        )}
        {margin([saidRow(said), actions])}
        {detail !== null && (
          <Box position="absolute" top={HEAD_ROWS + 1} left={1} flexDirection="row" height={mainRows}>
            {graph}
            <Box width={3} flexShrink={0}>
              <Text color={RULE}>{Array.from({ length: mainRows }, () => ' │ ').join('\n')}</Text>
            </Box>
          </Box>
        )}
      </Box>
    )
    const helpItems = (page: number, block: BlockRef | undefined, width: number, rows: number, start: boolean): Item[] => {
      const column = helpColumn(page)
      return fitHelp(helpPage(page, block, file, width, start), rows).map(row =>
        row.kind === 'title'
          ? {
              rows: 1,
              el: (
                <Box flexDirection="row" justifyContent="space-between" height={1}>
                  <Text bold color={TEXT} wrap="truncate-end">{row.text}</Text>
                  <Box flexShrink={0}>
                    <Text color={FADED}>{`Help ${page}/${HELP_PAGES}`}</Text>
                  </Box>
                </Box>
              ),
            }
          : row.kind === 'key'
            ? {
                rows: 1,
                el: (
                  <Text wrap="truncate-end">
                    <Text color={page === 3 ? 'claude' : TEXT} bold={page === 3 ? undefined : true}>{padCells(row.key, column)}</Text>
                    <Text color={TEXT}>{row.text}</Text>
                  </Text>
                ),
              }
            : row.kind === 'blank'
              ? blank
              : line(row.text),
      )
    }
    const graphBoxOf = (width: number, rows: number, props: unknown, fallback: RenderChildren) => (
      <Box key="project-graph" flexDirection="column" width={width} height={rows} flexShrink={0}>
        {rows < 1 ? null : 'Client' in els ? <els.Client key={CANVAS_ELEMENT} module="./canvas.tsx" width="100%" height={rows} props={props as never} /> : fallback}
      </Box>
    )

    // No catcher is drawn under the splash: the keys wait for the screen below. A pane too short for it goes without.
    // While a draft is awaited it is shown again, on the beats counted here.
    const waiting = ui.drafting === 'wait'
    if (waiting || !splashed) {
      if (!waiting) startSplash($)
      const sceneRows = columns >= SCENE_COLUMNS && bodyRows >= SCENE_ROWS + 3 ? SCENE_ROWS : SOLO_ROWS
      if (bodyRows >= sceneRows + 3) {
        const drawn = wordmark()
        const mark = columns >= drawn.width + 2 && bodyRows >= sceneRows + drawn.lines.length + 3 ? drawn : null
        return (
          <Box flexDirection="column" paddingLeft={1} paddingRight={1} height={bodyRows} justifyContent="center">
            <Box key="project-splash" flexDirection="column" alignItems="center" height={sceneRows} flexShrink={0}>
              {'Client' in els ? <els.Client key={SPLASH_ELEMENT} module="./splash.tsx" width="100%" height={sceneRows} props={(waiting ? { rows: sceneRows, beat: draftBeats } : { rows: sceneRows }) as never} /> : spanRows((waiting ? waitScene(draftBeats, columns, sceneRows) : splashScene(2, columns, sceneRows)).lines)}
            </Box>
            <Text color={TEXT}> </Text>
            <Box flexDirection="column" alignItems="center" flexShrink={0}>
              {mark ? spanRows(mark.lines) : <Text bold color="claude">{`${GLYPH.diamond} ${PANE_TITLE}`}</Text>}
              {mark ? <Text color={TEXT}> </Text> : null}
              <Text color={FADED} wrap="truncate-end">{waiting ? DRAFT_WAIT_NOTE : SPLASH_NOTE}</Text>
            </Box>
          </Box>
        )
      }
      if (waiting) {
        return (
          <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
            <Text bold color="claude">{`${GLYPH.diamond} ${PANE_TITLE}`}</Text>
            <Text color={FADED} wrap="truncate-end">{DRAFT_WAIT_NOTE}</Text>
          </Box>
        )
      }
    }

    if (starting) {
      const saved = ui.saved ?? []
      const helping = (ui.help ?? 0) > 0
      const detailW = detailWidth(columns)
      const graphW = columns - detailW - 3
      // A saved project is kept from the listing, and read again after a reload.
      let shown: Project | null = null
      if (marked?.kind === 'saved') {
        if (previews[marked.id] === undefined) {
          const parsed = parseProject(await $.fs.read(projectFile(await $.session.root(), marked.id)).catch(() => ''))
          previews[marked.id] = parsed.ok ? parsed.project : null
        }
        shown = previews[marked.id] ?? null
      } else if (marked && marked.kind !== 'recording') shown = TEMPLATES.find(one => one.id === marked.id)?.make() ?? emptyProject(ui.name)
      const keys = legendItems({ ring: 'start', placed: false, retype: false, empty: true, helping, locked: false, selected: false, container: false, nested: false, results: false, undo: false, redo: false, hidden: false, back: listing, minimizes: minimizes(run, over) })
      const message = focused ? ui.notice : KEYS_CUE

      const nameW = Math.min(Math.max(...entries.map(one => cellWidth(oneLine(one.title)))), Math.max(8, Math.floor(detailW / 2) - 4))
      const countW = Math.max(...entries.map(one => (isProjectEntry(one) ? blocksWord(one.blocks).length : 0)))
      const entryRow = (entry: (typeof entries)[number], at: number): Item => {
        const lit = at === mark
        const tags = entry.kind !== 'saved' ? [] : [...(entry.id === ui.back ? ['open'] : []), ...(entry.id === runProject && run.status === 'running' ? ['running'] : [])]
        const note = clip([...tags, ...(entry.note === '' ? [] : [oneLine(entry.note)])].join(' · '), Math.max(0, detailW - 2 - nameW - 2 - countW - 2))
        return {
          rows: 1,
          el: (
            <Box flexDirection="row" height={1}>
              <Button key={`${START_PREFIX}${entry.kind}:${entry.id}`} plain onPress={() => press($, () => openEntry($, at))}>
                <Text color="claude" bold>{lit ? '▸ ' : '  '}</Text>
                <Text color={lit ? 'claude' : TEXT} bold>{padCells(clip(oneLine(entry.title), nameW), nameW)}</Text>
                <Text color={FADED}>{`  ${(isProjectEntry(entry) ? blocksWord(entry.blocks) : '').padEnd(countW)}`}</Text>
                <Text color={FADED}>{note === '' ? '' : `  ${note}`}</Text>
              </Button>
            </Box>
          ),
        }
      }
      const draftRow: Item = {
        rows: 1,
        el: (
          <Box flexDirection="row" height={1}>
            <Button key={`${START_PREFIX}draft`} plain onPress={() => press($, () => request($, 'draft'))}>
              <Text color="claude" bold>{DRAFT_LABEL}</Text>
            </Button>
          </Box>
        ),
      }
      const detailRows = mainRows
      const hints = hintsOf(keys.detail, detailW, detailRows)
      const contentRows = Math.max(0, detailRows - hints.length)
      const extras = Math.max(saved.length, entries.findIndex(one => one.kind === 'replay'))
      const listed = fit(4, contentRows, level => {
        const gaps = level < 1 ? [blank] : []
        const ways = level < 2 ? [...gaps, draftRow] : [draftRow]
        // Short of rows, the saved projects are a window around the marked one; the templates are always all there.
        const room = level < 3 ? saved.length : Math.max(1, Math.min(SAVED_ROWS, contentRows - (entries.length - saved.length) - 6))
        const from = room >= saved.length ? 0 : listWindow(saved.length, room, Math.min(mark, saved.length - 1))
        const more = saved.length - Math.min(room, saved.length)
        const cut = savedPast > 0 ? `${savedPast} more not listed: the list holds ${SAVED_MAX}` : ''
        return [
          ...(saved.length > 0 ? [label('Saved projects'), line(`${PROJECT_DIR}/`, FADED), ...entries.slice(from, from + Math.min(room, saved.length)).map((entry, index) => entryRow(entry, from + index)), ...(more > 0 ? [line(`… ${more} more: w and s reach them${cut === '' ? '' : ` · ${cut}`}`, FADED)] : cut === '' ? [] : [line(`… ${cut}`, FADED)]), ...gaps] : []),
          label('New from a template'),
          ...entries.slice(saved.length, extras).map((entry, index) => entryRow(entry, saved.length + index)),
          ...ways,
          ...gaps,
          label('Replay a run'),
          ...entries.slice(extras, -1).map((entry, index) => entryRow(entry, extras + index)),
          ...entries.slice(-1).map(entry => entryRow(entry, entries.length - 1)),
        ]
      })
      const content = helping ? helpItems(ui.help, undefined, detailW, contentRows, true) : listed

      const graphRows = mainRows
      const box: GraphBox = { columns: graphW, rows: graphRows }
      graphBox = box
      // Above it: the header's rows, and the rule under them.
      graphArea = !('Client' in els) ? null : { top: HEAD_ROWS + 1, left: 1, columns: graphW, rows: graphRows }
      drawnCatcher = Input !== null ? catcherKey() : ''
      fieldsDrawn = false
      const stops = [ui.status, ui.name, saved.length, helping, listing].join('|')
      if (stops !== ringStops) {
        ringStops = stops
        if (focused) settleRing($)
      }
      const preview = graphBoxOf(graphW, graphRows, shown ? { ...previewProps(shown, box), wheel: { from: LOAD, rows: wheelRows } } : null, null)
      return frame(
        true,
        headOf(keys.header),
        shown ? preview : <Box key="project-graph" width={graphW} height={graphRows} flexShrink={0} />,
        detailBox(detailRows, hints, content, 1 + graphW + 3),
        message === null ? null : { text: message, color: focused ? 'warning' : FADED },
        actionsOf(keys.actions),
      )
    }
    if (!project) return <Box />

    // The add list is the pane's only while it holds the keyboard: Escape hands the keys to the prompt and no hook hears of it, so drawn without it the list is closed to the eye.
    const picking = ui.picker !== null && !locked && focused
    const helping = !picking && ui.help > 0
    // While Claude's draft is laid out the graph has the pane's width: there is nothing to edit yet.
    const hidden = (ui.detailHidden === true || drafting) && !picking && !helping

    const detailW = hidden ? columns : detailWidth(columns)
    const graphW = hidden ? columns : columns - detailW - 3
    const detailLeft = hidden ? 0 : 1 + graphW + 3
    // The width the engine wraps a field at: the cells from there to the pane's edge, less the four it keeps for its Enter mark.
    const fieldW = Math.max(1, columns + 2 - detailLeft - 4)
    const viewRoot = viewRootOf(project, ui, graphW)

    const history = histories[ui.name]
    const keys = legendItems({
      ring: !focused ? 'graph' : ui.picker !== null && !locked ? 'list' : ui.editing ? 'fields' : 'graph',
      placed: ui.picker?.anchorId !== undefined && ui.picker.retypeId === undefined,
      retype: ui.picker?.retypeId !== undefined,
      opens: picking && ui.picker ? pickerMatches(project, ui.picker)[ui.picker.pick ?? 0]?.opens === true : false,
      kinds: ui.picker?.block !== undefined && ui.picker.query === '',
      empty: isBlank(project),
      fixed: node?.type === 'start',
      helping,
      locked,
      selected: node !== undefined,
      container: canOpen(project, viewRoot, node?.id ?? null),
      nested: viewRoot !== null,
      results: over,
      undo: (history?.undo.length ?? 0) > 0,
      redo: (history?.redo.length ?? 0) > 0,
      hidden,
      minimizes: minimizes(run, over),
    })

    const said: Said =
      ui.notice !== null && ((ui.notice !== LOCK_NOTICE && ui.notice !== DRAFT_LOCK_NOTICE) || locked)
        ? { text: ui.notice.endsWith(UNDO_HINT) && !ui.notice.startsWith('redone: ') ? `Last change: ${ui.notice}` : ui.notice, color: noticeInforms(ui.notice) ? undefined : 'warning' }
        : locked
          ? { text: drafting ? DRAFT_LOCK_NOTICE : LOCK_NOTICE, color: FADED }
          : null
    // Without the keyboard the pane says nothing that names a key of its own: the cue takes the row, and what was said
    // follows it only stripped of its key, and only where both fit.
    const afterCue = ui.notice !== null ? withoutKeys(ui.notice) : null
    const cue =
      afterCue !== null && KEYS_CUE.length + 3 + afterCue.length <= saidW
        ? `${KEYS_CUE} · ${afterCue}`
        : isRequestNotice(afterCue)
          ? `${KEYS_CUE.split(' · ')[0] ?? KEYS_CUE} · ${afterCue}`
          : KEYS_CUE
    const message: Said = focused ? said : { text: cue, color: FADED }

    const parent = node ? flatten(project).find(row => row.node.id === node.id)?.parentId : undefined
    const around = parent === undefined ? undefined : findNode(project, parent)
    const knobs = node ? knobsOf(node, around?.type) : []
    const textKnobs = FIELD_KNOBS.filter(key => knobs.includes(key))
    const typed = (key: string, saved: string): string => (node && drafts.id === node.id && drafts.name === ui.name ? (drafts.values[key] ?? saved) : saved)
    // Text typed and not saved is saved as soon as a drawing sees its field cannot be typed in: the pane lost the keyboard (Escape, which no hook hears; a chat turn),
    // changed shape (a resize moves it between dock and inline and takes the keys), or shows another block.
    const shape = `${e.props.placement}/${columns}`
    const orphaned = hasDrafts() && (!focused || shape !== paneShape || drafts.name !== ui.name || (drafts.id !== null && drafts.id !== node?.id))
    paneShape = shape
    // The keyboard went with a field open: the field is closed, with what it held saved; `e` or a click opens it again.
    const lostKeys = !focused && ui.editing
    if ((orphaned || lostKeys) && !flushAsked) {
      flushAsked = true
      $.clock.after(0, () => {
        flushAsked = false
        void flushDrafts($).then(() => (lostKeys ? update($, uiAtom, held => (held.editing ? { ...held, editing: false, freshId: null } : held)) : undefined))
      })
    }
    const ownProblems = node ? problems.filter(one => one.nodeId === node.id) : []
    const named = new Set(ownProblems.flatMap(one => problemFields(one.rule)))
    const texts: { key: string; knob: string; label: string; value: string; placeholder: string }[] = node
      ? [
          // A block just added opens with its name field empty: the default name shows dim and stays if nothing is typed.
          ...(hasName(node) ? [{ key: NAME_FIELD, knob: 'name', label: FIELD_LABEL.name, value: typed(NAME_FIELD, ui.freshId === node.id ? '' : node.name), placeholder: node.name }] : []),
          // The start block has a logic field only for logic it already carries.
          ...(hasLogic(node) ? [{ key: LOGIC_FIELD, knob: 'logic', label: FIELD_LABEL.logic, value: typed(LOGIC_FIELD, node.logic ?? ''), placeholder: placeholderOf(node, 'logic') }] : []),
          ...textKnobs.map((knob: TextKnob) => ({
            key: `${KNOB_PREFIX}${knob}`,
            knob,
            label: FIELD_LABEL[knob],
            value: typed(`${KNOB_PREFIX}${knob}`, node.knobs?.[knob] ?? ''),
            placeholder: placeholderOf(node, knob, around),
          })),
        ]
      : []
    const agents = over && ui.selectedId !== null ? agentsOf(run, ui.selectedId) : null
    const matches = picking && ui.picker ? pickerMatches(project, ui.picker) : []
    const marker = matches[Math.min(ui.picker?.pick ?? 0, Math.max(0, matches.length - 1))]
    const editable = node !== undefined && !locked
    const fielding = editable && ui.editing && focused && !picking && !helping && Input !== null
    // The fields closed since the last drawing: the ones opened next are new ones.
    if (fieldsDrawn && !fielding) editGen++
    fieldsDrawn = fielding
    if (!fielding && Object.keys(pins).length > 0) pins = {}
    // The catcher is in the tree wherever the ring may rest on it: not with the add list, which takes its place among the stops.
    const catching = Input !== null && !picking
    drawnCatcher = catching ? catcherKey() : ''
    // Where this drawing's stops are not the last one's and no field is asked for, the ring, kept by its place, is put on the catcher.
    const stops = [ui.status, ui.name, locked, picking, helping, hidden, node?.id ?? '', knobs.join(',')].join('|')
    if (stops !== ringStops) {
      ringStops = stops
      if (focused && !ui.editing) settleRing($)
    }

    // Enter on a field. With the ring known to be elsewhere it came to rest here unasked (it is kept by its place, and the
    // stops changed under it), or Enter was pressed twice: nothing more is meant for this field, and a second Enter is a key.
    const save = async (key: string, value: string): Promise<void> => {
      if (!node) return
      const element = fieldKey(key, node.id)
      if (ringOn === undefined || ringOn === element || ringTo === element) return saveField($, node.id, key, fieldText(element, value).text)
      if (savedField.element === element) queueKeys($, [ENTER])
      settleRing($)
    }
    // The pane is drawn again on a keystroke, to give the field the rows its text takes.
    const typeIn = (key: string, element: string, value: string): void => {
      if (!node) return
      // The ring is known to be elsewhere, yet a letter reached this field: a change of the stops left it here, or Enter was just pressed and the ring is on its way out.
      // After Enter the letter is a key; otherwise it is dropped, and the ring goes where it belongs.
      const now = fieldKey(key, node.id)
      if (ringOn !== undefined && ringOn !== element && ringTo !== element && ringOn !== now && ringTo !== now) {
        if (savedField.element === element) {
          const fresh = value.slice(afterEnter(savedField, value))
          savedField = { ...savedField, taken: savedField.taken + fresh.length }
          const burst = burstKeys(fresh)
          if (fresh !== '') queueKeys($, 'paste' in burst ? null : burst.keys)
        }

        return settleRing($)
      }
      tidySoon($)
      const mine = drafts.id === node.id && drafts.name === ui.name
      let text: string
      if (element === now) {
        const whole = fieldText(element, value)
        text = whole.text
        if (whole.loose) redrawFields()
      } else {
        // The field has been drawn anew since, and this is the one before it: only what was added at its end since it was last heard of is new.
        const pin = pins[element]
        const known = pin ? `${pin.value}${pin.tail}` : null
        if (!pin || known === null || !value.startsWith(known) || value.length === known.length) return
        pin.tail = value.slice(pin.value.length)
        text = `${(mine ? drafts.values[key] : undefined) ?? ''}${value.slice(known.length)}`
        redrawFields()
      }
      drafts = { name: ui.name, id: node.id, values: { ...(mine ? drafts.values : {}), [key]: text } }
      if (!ui.editing) void update($, uiAtom, held => (held.editing ? held : { ...held, editing: true }))
      $.ui.invalidate('ui.render')
    }
    const retype = async (target: ProjectNode): Promise<void> => {
      await flushDrafts($)
      const step = await commit($, (before, held, context) => openRetype(before, held, target.id, context))
      if (!step.ui.picker) return
      pickGen++
      void landOn($, 'picker', 'block: click the filter to type in it')
    }

    const thin: Item = { rows: 1, el: <Text color={RULE}>{'─'.repeat(detailW)}</Text> }
    const capped = (rows: readonly string[], most: number): string[] => (rows.length <= most ? [...rows] : rows.slice(0, most).map((row, index) => (index === most - 1 ? `${clip(row, detailW - 1)}…` : row)))
    // The ring's field, or the one it is on its way to: the one drawn at full width, wrapped.
    const ringAt = ringTo !== '' ? ringTo : ringOn
    const activeBase = fielding && isField(ringAt) ? baseOf(ringAt ?? '') : null
    // The door stands at the heading's right end: two cells, empty. It is first in the tree (the row runs backward),
    // so the Down arrow from the catcher lands on it and not on the type.
    const DOOR_W = 2
    const typeWord = node ? typeName(node) : ''
    const heading: Item | null = node
      ? {
          rows: 1,
          el: (
            <Box key="project-heading" flexDirection="row-reverse" height={1}>
              {editable && Input && (
                <Box width={DOOR_W} flexShrink={0}>
                  <Input
                    key={doorKey()}
                    value=""
                    placeholder=""
                    submitLabel=""
                    onInput={(value, input) => doorKeys($, input.element, 'change', value)}
                    onSubmit={(value, input) => doorKeys($, input.element, 'submit', value)}
                  />
                </Box>
              )}
              <Box flexDirection="row" justifyContent="space-between" flexGrow={1} height={1}>
                <Box flexShrink={0}>
                  {/* The start block has no type to pick: it becomes no other block. */}
                  {editable && node.type !== 'start' ? (
                    <Button key={TYPE_ELEMENT} plain onPress={() => press($, () => retype(node))}>
                      <Text color={ACCENT[node.type]} bold>{`${typeWord} ▾`}</Text>
                    </Button>
                  ) : (
                    <Text color={ACCENT[node.type]} bold>{typeWord}</Text>
                  )}
                </Box>
                <Text color={FADED} wrap="truncate-end">{` ${node.id}`}</Text>
              </Box>
            </Box>
          ),
        }
      : null
    const required = (one: (typeof texts)[number]) => (one.value.trim() === '' && named.has(one.knob) ? [<Text color="error">{' [Required]'}</Text>] : [])
    const fieldLabel = (one: (typeof texts)[number]) => (
      <Text wrap="truncate-end">
        <Text color="suggestion">{cap(one.label)}</Text>
        {required(one)}
      </Text>
    )
    const restField = (one: (typeof texts)[number], most: number): Item => {
      const value = oneLine(one.value)
      const rows = value === '' ? [] : capped(wrapText(value, detailW), most)
      const lost = value === '' && named.has(one.knob)
      const body = value === '' ? [<Text color={lost ? 'error' : FADED}>{NOT_SET}</Text>] : rows.flatMap((row, index) => (index === 0 ? [<Text color={TEXT}>{row}</Text>] : ['\n', <Text color={TEXT}>{row}</Text>]))
      return {
        rows: 1 + Math.max(1, rows.length),
        el: (
          <Box flexDirection="column" flexShrink={0}>
            <Button key={`${REST_PREFIX}${fieldKey(one.key, node?.id ?? '')}`} plain onPress={() => press($, () => openFields($, one.key))}>
              {[<Text color="suggestion">{cap(one.label)}</Text>, ...required(one), '\n', ...body]}
            </Button>
          </Box>
        ),
      }
    }
    // The ring's own field is drawn at the pane's full width, where the engine wraps it, behind a label of spaces as wide as the indent:
    // the engine ends a label with `: `, which the rule beside the graph covers. The others stand in the column, one line each, cut.
    const openField = (one: (typeof texts)[number]): Item => {
      const element = fieldKey(one.key, node?.id ?? '')
      const lit = activeBase === one.key
      const shown = pinned(element, one.value)
      // Letters typed on the ring's way are not in the field until the typing pauses: they stand under it meanwhile.
      const ahead = lit ? (pins[element]?.head ?? '') : ''
      const field = (label: string | undefined, placeholder: string) =>
        Input && (
          <Input
            key={element}
            label={label}
            placeholder={placeholder}
            value={shown}
            submitLabel=""
            onInput={(value, input) => typeIn(one.key, input.element, value)}
            onSubmit={value => save(one.key, value)}
          />
        )
      return {
        rows: 1 + (lit ? Math.max(1, wrapText(one.value, fieldW).length) + (ahead === '' ? 0 : 1) : 1),
        wide: true,
        keep: lit ? true : undefined,
        el: (
          <Box flexDirection="column" flexShrink={0}>
            <Box paddingLeft={detailLeft} paddingRight={1}>{fieldLabel(one)}</Box>
            {lit ? (
              // A placeholder is one line, never wrapped: longer than the column it would push the field's start left, under the graph.
              field(detailLeft >= 2 ? ' '.repeat(detailLeft - 2) : undefined, clip(one.placeholder, fieldW))
            ) : (
              <Box flexDirection="column" height={1} paddingLeft={detailLeft} paddingRight={1}>{field(undefined, one.placeholder)}</Box>
            )}
            {ahead === '' ? null : (
              <Box paddingLeft={detailLeft} paddingRight={1}>
                <Text color={FADED} wrap="truncate-end">{clip(`+ ${ahead}`, detailW)}</Text>
              </Box>
            )}
          </Box>
        ),
      }
    }
    const PICKER_LABEL_W = 11
    const setItems: Item[] = node
      ? [
          ...(node.knobs?.isolation === 'worktree' ? [line(`${'Isolation'.padEnd(PICKER_LABEL_W)}worktree`, FADED)] : []),
          ...((node.knobs?.agentType ?? '') !== '' ? [line(clip(`${'Agent type'.padEnd(PICKER_LABEL_W)}${oneLine(node.knobs?.agentType ?? '')}`, detailW), FADED)] : []),
        ]
      : []
    const agentItems = (most: number): Item[] => {
      if (!agents || agents.shown.length === 0) return []
      const all = agents.shown.length + agents.rest
      const shown = agents.shown.slice(0, Math.max(1, all > most ? most - 1 : most))
      return [
        label('Run'),
        ...shown.map(agent => ({
          rows: 1,
          el: (
            <Text wrap="truncate-end" color={agent.status === 'failed' ? 'error' : agent.status === 'running' ? 'claude' : TEXT}>
              {`${agent.status === 'failed' ? FAILED : agent.status === 'running' ? GLYPH.dot : GLYPH.done} ${oneLine(agent.title)}  ${agent.status} · ${fmtCount(agent.tokens)}`}
            </Text>
          ),
        })),
        ...(shown.length < all ? [line(`… ${all - shown.length} more`, FADED)] : []),
      ]
    }
    // Short of rows, the blank rows go first; then what the type means; then the long texts are cut, to fewer rows each time.
    // An open field is never cut.
    const CUTS = [8, 5, 3, 2, 1] as const
    const inspector = (level: number): Item[] => {
      if (!node || !heading) return []
      const most = level < 4 ? Infinity : (CUTS[level - 4] ?? 1)
      const sections: Item[][] = []
      if (level < 3) {
        sections.push([label('Meaning'), ...lines(capped(wrapText(`${cap(teachOf(node).hint)}.`, detailW), most)), ...lines(capped(wrapText(`${cap(useWhen(node))}.`, detailW), most), FADED)])
      }
      if (editable) for (const one of texts) sections.push([fielding ? openField(one) : restField(one, most)])
      if (setItems.length > 0) sections.push(setItems)
      const ran = agentItems(Number.isFinite(most) ? Math.max(2, most) : AGENT_ROWS_MAX)
      if (ran.length > 0) sections.push(ran)
      return [heading, thin, ...sections.flatMap((section, index) => (index > 0 && level < 2 ? [blank, ...section] : section))]
    }
    const INSPECTOR_LEVELS = 4 + CUTS.length

    const rowName = (row: PickRow): string => (row.opens ? `${row.type} ▸` : pickName(row))
    const NAME_W = Math.max(...matches.map(row => rowName(row).length), 0) + 2
    const typeRow = (row: PickRow, opened: boolean): Item => {
      const lit = row === marker
      const teach = row.opens ? TEACH[row.type] : teachOf(row)
      const hint = `${cap(teach.hint)}.`
      const inside = row.opens ? `Kinds: ${kindsOf(row.type).join(' · ')}.` : `${cap(useWhen(row))}.`
      const more = lit && opened ? [...wrapText(hint, detailW - 2), ...wrapText(inside, detailW - 2)] : []
      const split = lit && opened ? wrapText(hint, detailW - 2).length : 0
      const [type, ...rest] = rowName(row).split(' ')
      return {
        rows: 1 + more.length,
        el: (
          <Box flexDirection="column" flexShrink={0}>
            <Button key={`pick:${row.type}:${row.opens ? '+' : (row.kind ?? '')}`} plain onPress={() => press($, () => pick($, row))}>
              {[
                <Text color="claude" bold>{lit ? '▸ ' : '  '}</Text>,
                <Text color={ACCENT[row.type]} bold={lit ? true : undefined}>{(type ?? '').toUpperCase()}</Text>,
                <Text color={row.opens ? FADED : ACCENT[row.type]} bold={lit && !row.opens ? true : undefined}>{`${rest.length > 0 ? ` ${rest.join(' ')}` : ''}`.padEnd(NAME_W - (type ?? '').length)}</Text>,
                ...(more.length > 0 ? [] : [<Text color={FADED}>{clip(hint, Math.max(0, detailW - 2 - NAME_W))}</Text>]),
                ...more.flatMap((line, index) => ['\n', <Text color={index < split ? TEXT : FADED}>{`  ${line}`}</Text>]),
              ]}
            </Button>
          </Box>
        ),
      }
    }
    const addList = (level: number): Item[] => {
      if (!ui.picker) return []
      // A filter ranks the blocks, best first, and a block's kinds are one list: the groups are for the list as it opens.
      const grouped = ui.picker.query === '' && ui.picker.block === undefined && ui.picker.retypeId === undefined && level < 2
      const opened = level < 3
      const groups = grouped ? PALETTE_GROUPS.map(one => ({ heading: one.heading, types: matches.filter(row => groupOf(row.type) === one.group) })).filter(one => one.types.length > 0) : [{ heading: '', types: matches }]
      return [
        ...firstLines(sanitize(addHeading(project, ui.picker)), detailW, 2).map(row => line(row, undefined, true)),
        thin,
        {
          rows: 1,
          el: (
            <Box flexDirection="row" height={1}>
              <Box flexShrink={0}>
                {/* The letters taken as keys before they turned out to start a name: said here, they are not in the field. */}
                <Text color={TEXT}>
                  <Text color="suggestion">{'Filter '}</Text>
                  {ui.picker.lead ?? ''}
                </Text>
              </Box>
              <Box width={Math.max(8, detailW - 7 - cellWidth(ui.picker.lead ?? ''))}>
                {Input && (
                  <Input
                    key={pickerKey()}
                    placeholder="type a block or a kind"
                    value={ui.picker.query.slice((ui.picker.lead ?? '').length)}
                    submitLabel=""
                    onInput={(value, input) => filterKeys($, input.element, value)}
                    onSubmit={(value, input) => filterEnter($, input.element, value)}
                  />
                )}
              </Box>
            </Box>
          ),
        },
        ...(matches.length === 0 ? [line('no block or kind has that in its name', 'warning')] : []),
        ...groups.flatMap(group => [...(level < 1 ? [blank] : []), ...(group.heading === '' ? [] : [line(group.heading, FADED)]), ...group.types.map(row => typeRow(row, opened))]),
      ]
    }

    const goal = goalOf(project)
    const idle = (): Item[] => [
      label('Goal'),
      ...lines(wrapText(goal === '' ? 'Not said yet.' : sanitize(goal), detailW).slice(0, 6), goal === '' ? FADED : undefined),
      ...(drafting
        ? []
        : [
            blank,
            label(!isBlank(project) ? 'Nothing selected' : 'An empty project'),
            ...lines(
              wrapText(
                !isBlank(project)
                  ? 'Click a card to select it, or a [+] to add a block there.'
                  : focused
                    ? 'Press n to add the first block, and say on the start block what the workflow is for; or tell Claude in the prompt what to build.'
                    : 'Click [+] on the graph to add the first block, or tell Claude in the prompt what to build.',
                detailW,
              ),
              FADED,
            ),
          ]),
    ]
    const stray = (): Item[] => [line('UNMAPPED', undefined, true), ...lines(wrapText('Agents whose label names no block of this project.', detailW), FADED), blank, ...agentItems(AGENT_ROWS_MAX)]

    const detailRows = hidden ? 0 : mainRows
    const hints = hintsOf(keys.detail, detailW, detailRows)
    const contentRows = Math.max(0, detailRows - hints.length)
    // Every row between the rules, whatever the graph's own height (it pans inside), so the region never changes size with the selection.
    const graphRows = mainRows
    const box: GraphBox = { columns: graphW, rows: graphRows }
    graphBox = box
    graphArea = !('Client' in els) ? null : { top: HEAD_ROWS + 1, left: 1, columns: graphW, rows: graphRows }

    const content: Item[] =
      picking && ui.picker
        ? fit(5, contentRows, addList)
        : helping
          ? helpItems(ui.help, node, detailW, contentRows, false)
          : node
            ? fit(INSPECTOR_LEVELS, contentRows, inspector)
            : ui.selectedId === UNMAPPED_ID && agents
              ? stray()
              : idle()

    const graph = graphBoxOf(
      graphW,
      graphRows,
      // A draft being laid out: its blocks so far, and no problem marked on a project that is not all there yet.
      { ...graphProps(drafting && (ui.reveal ?? null) !== null ? firstBlocks(project, ui.reveal ?? 0) : project, ui, box, overlay), ...(drafting ? { problems: {} } : {}), wheel: { from: LOAD, rows: wheelRows }, ...(focused ? {} : { quiet: true }) },
      // Drawn only where there is no Client: not made where there is one.
      'Client' in els
        ? null
        : flatten(project)
            .slice(0, graphRows)
            .map(row => (
              <Text color={row.node.id === ui.selectedId ? 'claude' : TEXT} bold={row.node.id === ui.selectedId ? true : undefined} wrap="truncate-end">
                {`${row.node.id === ui.selectedId ? GLYPH.diamond : ' '} ${'  '.repeat(row.depth)}${TEACH[row.node.type].glyph} ${row.node.id}  ${oneLine(row.node.name)}`}
              </Text>
            )),
    )

    return frame(catching, headOf(keys.header), graph, hidden ? null : detailBox(detailRows, hints, content, detailLeft), message, actionsOf(keys.actions))
  })

  // The compact view, drawn in the band above the prompt while the designer is minimized. Nothing while the pane is on screen:
  // beside a dock the band has the transcript's few cells, and an inline pane shares its rows.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shell = await read($, shellAtom)
    if (shell.minimized === 'no' || e.props.hasSurvey) return next(e)
    const els = $.ui.resolve(e)
    if (!('Button' in els)) return next(e)
    const { Box, Text, Button } = els
    // The pane is on screen (on its way out, or opened again): the designer is drawn there.
    if ((await $.ui.panes()).some(pane => pane.id === PROJECT_PANE_ID && pane.isPlaced)) return next(e)

    // Minimized for want of room, and the terminal now has it: the pane opens by itself, once per size.
    const size = `${e.viewport?.columns ?? 0}x${e.viewport?.rows ?? 0}`
    if (!wouldDock(e.viewport)) autoTried = ''
    else if (shell.minimized === 'auto' && autoTried !== size) {
      autoTried = size
      const columns = e.viewport?.columns
      $.clock.after(0, () => void expand($, false, columns).catch(() => undefined))
    }

    const ui = await read($, uiAtom)
    const project = ui.status === 'ready' ? await read($, projectAtom) : null
    const run = await read($, runAtom)
    // A run in progress is shown whatever project is open; one that is over, on its own project until its results are put away.
    const runProject = run.status === 'idle' ? null : await read($, runProjectAtom)
    const tracked = run.status === 'running' || (run.status !== 'idle' && project !== null && runProject === ui.name && !ui.runCleared)
    // The tick clock is read only while a run is on, so a band at rest is not redrawn by it.
    const clock = run.status === 'running' ? await read($, clockAtom) : 0
    const columns = e.props.bodyColumns
    const name = oneLine(tracked && runProject !== null ? runProject : project === null ? COMMAND : ui.name)
    const lead = `${GLYPH.diamond} ${clip(name, Math.max(8, Math.floor(columns / 4)))}  `
    // Short of room the strip keeps the cells the focus hint would take.
    const hinted = columns - cellWidth(lead) - EXPAND_W - FOCUS_HINT.length - 4 >= BAND_HINT_MIN
    const room = Math.max(8, columns - cellWidth(lead) - EXPAND_W - 2 - (hinted ? FOCUS_HINT.length + 2 : 0))
    let strip: StripPart[] | null = null
    if (tracked) {
      const items = stripItems(runProject === null ? null : runProject === ui.name && project !== null ? project : await stripProjectOf($, runProject, run.runId), run)
      strip = planStrip(items, currentStep(items, run.status === 'running'), room, clock)
    }
    const why = shell.minimized === 'auto' && shell.why !== null ? WHY_TEXT[shell.why] : 'The designer is minimized'

    const terminal = e.viewport?.columns
    // What other plugins and the engine draw in the band stays, under the strip.
    const below = (await next(e)) ?? null
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" height={1}>
          <Text bold color="claude">{lead}</Text>
          <Box flexGrow={1} flexShrink={1}>
            {strip === null ? (
              <Text color={FADED} wrap="truncate-end">{clip(why, room)}</Text>
            ) : (
              <Text wrap="truncate-end">
                {strip.map(part => (
                  <Text color={STRIP_TONES[part.tone]} bold={part.bold}>{part.text}</Text>
                ))}
              </Text>
            )}
          </Box>
          <Box flexDirection="row" flexShrink={0}>
            <Text color={FADED}>{hinted ? `  ${FOCUS_HINT}  ` : '  '}</Text>
            <Button key={EXPAND_ELEMENT} plain onPress={() => press($, () => expand($, true, terminal))}>
              <Text>
                <Text color="claude">{`[${EXPAND_HOTKEY}]`}</Text>
                <Text color={TEXT}>{` ${EXPAND_WORD}`}</Text>
              </Text>
            </Button>
            {/* The key itself: a Button with a hotkey writes it before its label (`m: `), so this one is in the tree and not drawn. */}
            <Box key="conductor-expand-key" display="none">
              <Button key={`${EXPAND_ELEMENT}:key`} hotkey={EXPAND_HOTKEY} onPress={() => press($, () => expand($, true, terminal))}>
                {EXPAND_WORD}
              </Button>
            </Box>
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}
