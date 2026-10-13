import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderChildren } from 'claude-code'

import { FLASH_CLEAR_MS, TOOL_FULL_NAME, TOOL_NAME, TOOL_SCHEMA, applyOps, attachNote, changeWords, changedNote, clearFlash, projectOfPath, diffProjects, draftBrief, editReport, knownAfterEdit, readReport, replaceProject, showEdit, staleNote, toolDescription, unplacedNote } from '../src/project/chat'
import { UNDO_HINT, remember, travel } from '../src/project/history'
import type { History } from '../src/project/history'
import { lint, preflightLine, problemFields } from '../src/project/lints'
import * as partial29 from '../fixtures/partial-29'
import * as review41 from '../fixtures/review-41'
import { handoffPrompt, handoffTarget, reviewPrompt } from '../src/project/handoff'
import { ASK_PREFIX, resetText } from '../src/project/offer'
import { replayEvents } from '../src/run/replay'
import type { ReplayFixture } from '../src/run/replay'
import { emptyProject, findNode, flatten, goalOf, isBlank, kindsOf, parseProject, serializeProject, typeName } from '../src/project/model'
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
  TEXT_KNOBS,
  WIDE_MIN_COLUMNS,
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
  factsLine,
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
  scriptFile,
  restoreProject,
  runOverlay,
  runSummary,
  savedProject,
  startProject,
  startEntries,
  filterText,
  typePicker,
  viewRootOf,
  withoutKeys,
} from '../src/project/session'
import type { ProjectUi, GraphBox, PickRow, RunContext, SavedProject, Step, TextKnob } from '../src/project/session'
import { FIELD_LABEL, PALETTE_GROUPS, TEACH, fieldWord as fieldLabel, groupOf, hasLogic, hasName, knobsOf, pickName, placeholderOf, teachOf, useWhen } from '../src/project/teach'
import type { BlockRef } from '../src/project/teach'
import { TEMPLATES } from '../src/project/templates'
import { emptyRunState } from '../src/run/events'
import { replayProjectEvents } from '../src/run/replay'
import type { Tracker } from '../src/run/tracker'
import { NOT_SET, UNMAPPED_ID, canOpen } from '../src/ui/graph-layout'
import { parseGraphMessage } from '../src/ui/graph-model'
import { ENTER, KEY_OPS, PASTE_NOTICE, burstKeys, legendItems, legendRows, unboundNotice, LEGEND_GAP } from '../src/ui/keys'
import type { KeyOp, LegendAction, LegendItem } from '../src/ui/keys'
import { FAILED, fmtTokens } from '../src/ui/rail'
import { BEAT_MS, GESTURE_MS, SCENE_COLUMNS, SCENE_ROWS, SMALL_SVG_H, SMALL_SVG_W, SMALL_W, SOLO_ROWS, SPLASH_MS, draftPose, gestureOf, nextPose, runPose, smallPersona, smallPersonaSvg, splashScene, waitScene } from '../src/ui/persona'
import type { PersonaSpan, Pose } from '../src/ui/persona'
import { cellWidth, clip, cutCells, firstLines, oneLine, padCells, sanitize, wrapText } from '../src/ui/text'
import { ACCENT, FADED, GLYPH, PANE_ID, PANE_TITLE, RULE, TEXT } from '../src/ui/theme'
import { wordmark } from '../src/ui/wordmark'

import { offerDrafted, offerHanded, offerPrompted, setOfferBoard, takeOffered } from './offer'

// The designer: the hooks module owns the Project and everything chosen on it
// (selection, view, add list), applies ops, saves the file and draws the screen:
// header, the graph's region, the detail pane with the keys that act on it, the
// footer with the graph's keys. The graph (./canvas.tsx) is a Client that draws
// the project from props, owns only its pan and a drag in flight, and posts
// here. Keys are typed into the key catcher: one Input, not drawn, that the ring
// rests on while no field is open; the ones that walk the graph do so over the
// layout the Client draws (`graphBox`).

const COMMAND = 'conductor'
const CANVAS_KEY = 'canvas'
/** The splash's scene (./splash.tsx): it counts its own beats. */
const SPLASH_KEY = 'splash'
/** Under the splash's scene. */
const SPLASH_NOTE = 'designed for full screen'
const NAME_KEY = 'project-name'
const LOGIC_KEY = 'project-logic'
/** The add list's filter: `project-add:<n>`, drawn under a new `n` to empty it of the keys it took. */
const PICKER_KEY = 'project-add'
const TYPE_KEY = 'project-type'
/** A field at rest, read and not typed in: `project-rest:project-notes@n5`. A press on it opens the fields on that one. */
const REST_KEY = 'project-rest:'
/** A row of the start screen: `start:saved:demo`, `start:template:review`. */
const START_KEY = 'start:'
const DRAFT_LABEL = '[Draft using claude]'
/** The project's name in the header: a press lists the projects. */
const NAME_BUTTON_KEY = 'projects-button'
/** A button of the pane's last row, before its key: `act:r`. */
const ACT_KEY = 'act:'
/** Why a list's arrow is refused its move: the ring stays where it is, and the mark moves. */
const ARROWS_CHOOSE = 'the arrows choose a row'
/** Saved projects the start screen lists at once where it is short of rows: a window around the marked one. */
const SAVED_ROWS = 8
/** Project files read for a listing, at most. */
const SAVED_MAX = 60
/** The address of a knob's text field: `project-knob:prompt`. */
const KNOB_KEY = 'project-knob:'
/**
 * A block's field is addressed by the field and the block (`project-notes@n5`): the engine keeps what was typed in an
 * Input under its address, so text typed for one block can never be shown, or sent, under another.
 */
const fieldKey = (base: string, id: string): string => `${base}@${id}#${editGen}`
const baseOf = (element: string): string => element.split('@')[0] ?? element
/**
 * How many times the fields have been closed in this load, in their address: the engine keeps what was typed in an
 * Input under its address, so fields opened again are new ones and show the block as it is now (after an undo, say).
 */
let editGen = 0
/** Whether the last drawing drew the fields to type in: the drawing after they close counts `editGen` on. */
let fieldsDrawn = false
/** Whether the ring on this element means a field is being typed in. */
const isField = (element: string | undefined): boolean => {
  const base = baseOf(element ?? '')
  return base === NAME_KEY || base === LOGIC_KEY || base.startsWith(KNOB_KEY)
}
/** A field as a message names it: `logic`, `once per`. */
const fieldWord = (base: string): string => fieldLabel(base === NAME_KEY ? 'name' : base === LOGIC_KEY ? 'logic' : base.slice(KNOB_KEY.length))
/** The field `e` opens a block on: its name's, and on the start block, which has none, the goal's. */
const firstField = (node: { type: ProjectNode['type'] }): string => (hasName(node) ? NAME_KEY : `${KNOB_KEY}goal`)
/**
 * The key catcher: where the ring rests while no field is open. An Input, so it is given every printable key with its
 * case (a Button's hotkey cannot see Shift). It is the pane's first focus stop, always: the engine keeps the ring by
 * its place among the stops, and the first place never moves when the fields after it come and go. What it holds is
 * keys, not text to read: it is in the tree and not drawn (`display: none`), so it takes no cell and the terminal's
 * cursor does not stand on it. It is emptied by drawing it under a new key (`keys:<load>.<n>`) with no text: only
 * once the typing has paused, since a key typed in the frame it is drawn anew is dropped.
 */
const CATCH_KEY = 'keys'
/**
 * This load of the module, in the catcher's key: the engine keeps what was typed in an Input under its key, and a
 * module loaded again counts from 0 again, so a key of the load before would come back with its old text.
 */
const LOAD = Date.now().toString(36)
let catchGen = 0
const catcherKey = (): string => `${CATCH_KEY}:${LOAD}.${catchGen}`
const isCatcher = (element: string | undefined): boolean => (element ?? '').startsWith(`${CATCH_KEY}:`)
/** The catcher's key as the last drawing drew it ('' where it drew none): what the ring is moved to. */
let drawnCatcher = ''
let pickGen = 0
const pickerKey = (): string => `${PICKER_KEY}:${LOAD}.${pickGen}`
const isPickerField = (element: string | undefined): boolean => (element ?? '').startsWith(`${PICKER_KEY}:`)
/** The start screen's field for a saved project's new name: `rename:<load>.<n>`, drawn under a new `n` each time it opens. */
const RENAME_KEY = 'rename'
let renameGen = 0
const renameKey = (): string => `${RENAME_KEY}:${LOAD}.${renameGen}`
const isRenameField = (element: string | undefined): boolean => (element ?? '').startsWith(`${RENAME_KEY}:`)
/** The field a resting field's address stands for (`project-notes`); null for any other element. */
const restBase = (element: string | undefined): string | null => (element !== undefined && element.startsWith(REST_KEY) ? baseOf(element.slice(REST_KEY.length)) : null)
/**
 * The door: a second small Input, the stop right after the catcher while a block's fields are shown. The person's
 * Down arrow (or Tab) from the catcher lands on it, and that opens the fields (at rest they are text, with nothing to
 * land on); being an Input, it takes what is typed until the ring is on the title, and none of it is lost. With the
 * fields open, a step back from the first field that lands on it is the way back to the graph. Emptied as the catcher is.
 */
const DOOR_KEY = 'door'
let doorGen = 0
const doorKey = (): string => `${DOOR_KEY}:${LOAD}.${doorGen}`
const isDoor = (element: string | undefined): boolean => (element ?? '').startsWith(`${DOOR_KEY}:`)
/** Whether an element is a field of the detail pane or the add list's filter: where the ring may rest besides the catcher. */
const isDetailStop = (element: string | undefined): boolean => element !== undefined && (isField(element) || isPickerField(element) || isRenameField(element) || restBase(element) !== null)
/** How long after the command's answer the handoff prompt is submitted. */
export const SUBMIT_DELAY_MS = 64
/** How many times the ring is sent to an element before the field is given up. */
const LAND_TRIES = 5
/** A redraw's worth of wait before the ring moves to an element just drawn. */
export const FOCUS_DELAY_MS = 48
/** How often the prompt box is read while a request waits in it. */
export const BOX_POLL_MS = 600
/** The header's rows: the persona's two, the name on the first. */
const HEAD_ROWS = 2
const EDIT_HINT = 'click a field of the block, or press the Down arrow to reach the name'
/** The graph's region is never asked to be shorter than this while the detail pane, under it, has rows to give. */
const GRAPH_LEAST_ROWS = 3
/** Stacked, the detail pane at rest takes this share of the rows between header and footer. */
const DETAIL_REST_SHARE = 0.45
/** The detail pane's last rows name the keys that act on it: at most this many docked, one inline or where the pane is short. */
const HINT_ROWS = 2
/** Cells between two buttons of the pane's last row. */
const ACTION_GAP = 4
/** What is said stands in the rule over the footer, docked: this many cells of rule are kept at each side of it. */
const SAID_RULE_W = 3
/** Rows asked for when the pane sits inline above the prompt. */
export const PANE_ROWS = 28
/**
 * The terminal's width as the last command saw it (`e.presentation.columns`): the
 * only place a hook is told it. Undefined until a command has run in this load.
 */
let terminalColumns: number | undefined
/** The timer that puts the header's persona at rest after a gesture. */
let restPersona: { cancel: () => void } | null = null
/** Whether the splash's time is running in this load. */
let splashing = false
/** The splash stays on its last beat this long before the designer is drawn. */
const SPLASH_REST_MS = 150
/**
 * What `$.ui.open` is asked: with the keyboard (`focus`), or shown without it (an
 * edit from chat opens the pane and the person goes on typing in the prompt).
 * The dock is asked for all of the terminal but a sliver for the transcript.
 */
export const paneArgs = (focus: boolean): { id: string; title: string; rows: number; columns?: number; focus?: true } => {
  const columns = dockColumns(terminalColumns)

  return { id: PROJECT_PANE_ID, title: PROJECT_PANE_TITLE, rows: PANE_ROWS, ...(columns === undefined ? {} : { columns }), ...(focus ? { focus: true as const } : {}) }
}
/** What `r` leaves on the message row where its request could not be sent and waits in the prompt box instead. */
const runNotice = (line: string, isFilled: boolean): string => `run: ${isFilled ? 'the request is in the prompt · Enter sends it' : `type in the prompt: ${line.trim()}`}`
const askNotice = (line: string, isFilled: boolean): string => (isFilled ? 'ask: the question is in the prompt · change it as you like, then Enter' : `ask: type in the prompt: ${line.trim()}`)
/** What the start screen's draft button puts in the prompt box: the person adds what the workflow should do. */
const draftLine = (): string => `/${COMMAND} `
const draftNotice = (line: string, isFilled: boolean): string => (isFilled ? 'draft: say in the prompt what the workflow should do, then Enter' : `draft: type in the prompt: ${line.trim()} <what you want>`)

/**
 * Undo and redo, per project, for the session: every change to a project leaves the project before it here.
 * Module variables, not state: fifty projects are too much to store, and a drawing may read them.
 */
const histories: Record<string, History> = {}
/**
 * How many times each project changed in this load, by hand or from chat, and the count Claude last saw
 * (in a `read`, or in the answer to its own edit). When they differ the board changed by hand since.
 */
const revisions: Record<string, number> = {}
const seenByClaude: Record<string, number> = {}
/**
 * The project as Claude last saw it, kept in step with `seenByClaude`: what a prompt sent after a change by hand is
 * compared with, to say the change. None where Claude does not hold the whole project (it never read it, or the
 * conversation that held it was compacted or cleared): the prompt then says to read again.
 */
const seenProjects: Record<string, Project> = {}
/** Claude has the project as it stands, whole: the revision it is compared against later, and the project a later change is said from. */
const sawProject = (name: string, project: Project): void => {
  seenByClaude[name] = revisions[name] ?? 0
  seenProjects[name] = project
}
const forgetSeenProjects = (): void => {
  for (const name of Object.keys(seenProjects)) delete seenProjects[name]
}
/** The revision the model was last told is stale, so it is told once per change and not with every prompt. */
const warnedAt: Record<string, number> = {}
/** Another conversation (a /clear, a resume): Claude has seen no project in it, whole or in part, and was told of no change. */
const forgetConversation = (): void => {
  forgetSeenProjects()
  for (const book of [seenByClaude, warnedAt]) for (const name of Object.keys(book)) delete book[name]
}
/** A change was made: it counts as a revision, and the project before it is what `u` returns to. */
const record = (name: string, before: Project | null, what: string | undefined): void => {
  revisions[name] = (revisions[name] ?? 0) + 1
  if (before) histories[name] = remember(histories[name], before, what ?? 'an edit')
}
/** `u` and `y`: the project a step back or forward, shown. Ids are never reused: the counter never goes back. */
const timeTravel = (project: Project | null, ui: ProjectUi, way: 'undo' | 'redo', context: RunContext): Step => {
  if (!project || ui.status !== 'ready') return { project, ui, changed: false }
  if (context.locked || ui.handed) return applyOp(project, ui, way, context)
  const moved = travel(histories[ui.name], project, way)
  if (!moved) return { project, ui: nothingToRestore(ui, way), changed: false }
  histories[ui.name] = moved.history
  revisions[ui.name] = (revisions[ui.name] ?? 0) + 1
  const target: Project = { ...moved.entry.project, nextId: Math.max(nextIdNumber(moved.entry.project), nextIdNumber(project)) }
  return restoreProject(project, ui, target, way, moved.entry.what, context)
}
/** One key: the two that travel the history, or any other. */
const keyStep = (project: Project | null, ui: ProjectUi, op: KeyOp, context: RunContext): Step =>
  op === 'undo' || op === 'redo' ? timeTravel(project, ui, op, context) : applyOp(project, ui, op, context)
/**
 * What is being typed and not saved yet: into the fields of one block of one project (by field, `project-notes`).
 * Not state: a keystroke must not redraw the pane. Nothing here is ever dropped
 * unsaid: `flushDrafts` saves it on every way out of a field that a hook hears of, or sees a drawing later.
 */
type Drafts = { name: string; id: string | null; values: Record<string, string> }
const noDrafts = (): Drafts => ({ name: '', id: null, values: {} })
let drafts: Drafts = noDrafts()
const hasDrafts = (): boolean => drafts.id !== null && Object.keys(drafts.values).length > 0
/** What one field's text changes of its block. */
const fieldPatch = (node: { name: string }, base: string, value: string): NodePatch =>
  base === NAME_KEY ? { name: value.trim() || node.name } : base === LOGIC_KEY ? { logic: value.trim() } : ({ knobs: { [base.slice(KNOB_KEY.length)]: value.trim() } } as NodePatch)
/** Where the pane's last drawing sat: a drawing sets it. */
let paneShape = ''
/** The focus stops of the last drawing, in words: when they change under a ring at rest, the ring is put back on the catcher. */
let ringStops = ''
/**
 * The element the ring is on, as far as a hook was told: the person's moves (`ui.focus`) and the mod's own. Undefined
 * when nothing is known (a fresh load). A field that is typed in while the ring is known to be elsewhere got the ring
 * by its place among the stops, unasked: what is typed there is not its text.
 */
let ringOn: string | undefined
/** The element the mod is moving the ring to and has not heard back of ('' with none): what is typed there meanwhile is its text. */
let ringTo = ''
/**
 * What each open field's Input was drawn with, by its address (`value`), and what was typed for the field since: the
 * letters that came by the catcher or the door while the ring was on its way (`head`: they stand right after that
 * text), and the ones typed at its end in the field itself (`tail`).
 *
 * Three engine facts shape this. An Input keeps what is typed in it for as long as the `value` drawn does not change.
 * When that does change the text is replaced, but the cursor stays where it was, so the next letter lands in the
 * middle. And a letter typed into an Input in the very frame it is drawn under another address is dropped. So a
 * field is drawn with the one text it opened with for as long as it is typed in, whatever is typed (the pane is drawn
 * again on every keystroke, to give the field the rows its text now takes); letters that reached the mod by another
 * way are kept beside it, and the field is drawn anew, with all of it, only once the typing has paused (`tidySoon`).
 */
let pins: Record<string, { value: string; head: string; tail: string }> = {}
/** The text an open field is drawn with: the one it opened with. */
const pinned = (element: string, value: string): string => (pins[element] ??= { value, head: '', tail: '' }).value
/**
 * The whole text of a field, from what its Input says it holds. `loose` when the letters kept beside it can no longer
 * be placed (the text it opened with was cut into): the field is then drawn anew at once.
 */
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
/** The open fields are drawn anew, under new addresses, each with all of its text: the ring, kept by its place, is on the same field after as before. */
const redrawFields = (): void => {
  editGen++
  for (const pin of Object.values(pins)) pin.head = ''
  const swap = (key: string): string => key.replace(/#\d+$/, `#${editGen}`)
  if (ringOn !== undefined && isField(ringOn)) ringOn = swap(ringOn)
  if (isField(ringTo)) ringTo = swap(ringTo)
}
/** Counts every key typed in the pane: what waits for the typing to pause looks at it. */
let typingSeq = 0
/** How long after the last key the Inputs are tidied. */
const TIDY_MS = 600
/** The catcher is emptied once it holds more keys than this. */
const CATCH_FULL = 40
/** What the door's text held when it was last read, as `caught`. */
let doored = { element: '', taken: 0 }
/** The saved projects as last read, by name, for the start screen's preview: null for a file that is no project. */
const previews: Record<string, Project | null> = {}
/** How many saved projects the last listing left out: those past `SAVED_MAX`. */
let savedPast = 0
/** The project the list of projects was opened from, as it stood: one no file holds yet comes back from here. */
let behind: { project: Project; ui: ProjectUi } | null = null
/**
 * What the catcher's text held when it was last read, by the key it was drawn under: the characters after that are the
 * new ones. `sent` is the text Enter was last pressed on, until the next key: Enter empties the catcher (seen live,
 * 2.1.296), so what it holds next is counted from the start again.
 */
let caught: { element: string; taken: number; sent: string | null } = { element: '', taken: 0, sent: null }
/** The same for the add list's filter: how many of its characters were keys (`w s n b`), not text. */
let picked = { element: '', taken: 0 }
/** The filter Enter was last pressed in, as `savedField`: what is typed there once the list has closed is for whatever opened next. */
let pickedField = { element: '', value: '', taken: 0 }
/** The field Enter was last pressed in, its text, and how many characters typed after it were taken as keys: what is typed there before the ring has left is keys. */
let savedField = { element: '', value: '', taken: 0 }
/** Where in a field's text the characters not yet taken start, once Enter was pressed in it: after the text Enter sent, where the field still holds it (Enter empties some fields). */
const afterEnter = (sent: { value: string; taken: number }, value: string): number => (value.startsWith(sent.value) ? sent.value.length : 0) + sent.taken
/** The graph's region as the last drawing gave it to the Client: the keys walk the layout made for the same room. */
let graphBox: GraphBox | undefined
/** Where that region stands in the pane's body, in cells: the wheel over it scrolls the graph. Null while no graph is drawn. */
let graphArea: { top: number; left: number; columns: number; rows: number } | null = null
/** Every row the wheel has asked for over the graph in this load, summed: the Client moves its pan by what was added since it last drew. */
let wheelRows = 0
/** The keys typed, applied one at a time in the order they came. */
let keyChain: Promise<void> = Promise.resolve()
/** A save of drafts was asked from a drawing and has not run yet. */
let flushAsked = false
/** A poll of the prompt box is running, for a request (`r`, `q`) that waits there. */
let boxWatched = false
/** The run tracker, as `registerProject` was given it: a key that hands a project off tells it. */
let runTracker: Tracker | undefined
/** The ticker of a draft: the splash's beats while it is awaited, the laying out of its blocks once it has landed. */
let draftTicker: { cancel: () => void } | null = null

// The run's state. Both hooks modules declare these (an atom must be spelled in the
// file that reads it): run.tsx writes them through the tracker, project.tsx reads them.
const runAtom = atom({ plugin: 'conductor', key: 'run' } as const, emptyRunState())
const clockAtom = atom({ plugin: 'conductor', key: 'runClock' } as const, 0)
/** The project the tracked run was started from (a handoff); null for any other run. */
const runProjectAtom = atom({ plugin: 'conductor', key: 'runProject' } as const, null)
const projectAtom = atom({ plugin: 'conductor', key: 'project' } as const, null)
const uiAtom = atom({ plugin: 'conductor', key: 'projectUi' } as const, initialUi())
/** When the run began and ended: run.tsx stamps it. */
/** Whether this session has seen the splash: the pane's first drawing shows it, once. */
const splashedAtom = atom({ plugin: 'conductor', key: 'splashed' } as const, false)
/** The beats counted since a draft was asked for: the splash that waits for it and the header's persona move on them. */
const draftBeatAtom = atom({ plugin: 'conductor', key: 'draftBeat' } as const, 0)
/** The gesture the header's persona holds; at rest it is `idle`. */
const personaAtom = atom({ plugin: 'conductor', key: 'persona' } as const, 'idle')
const timesAtom = atom({ plugin: 'conductor', key: 'runTimes' } as const, initialTimes())
/** The tracked run's script file (run.tsx writes it), and the project an `attach` drew of that run. */
const runScriptAtom = atom({ plugin: 'conductor', key: 'runScript' } as const, null)

const reason = (error: unknown): string => cutCells(sanitize(error instanceof Error ? error.message : String(error)), 160)

/** A project's script, when it has one: the file beside it (`scriptFile`). */
const scriptOf = async ($: EngineInterface, root: string, name: string): Promise<string | null> => {
  const path = scriptFile(root, name)

  return (await $.fs.exists(path).catch(() => false)) ? path : null
}

/** Copies a run's script beside its project; a run of that very file copies nothing. False when it could not be done, never a throw. */
const keepScript = async ($: EngineInterface, from: string, to: string): Promise<boolean> => {
  if (from === to) return true
  try {
    await $.fs.write(to, await $.fs.read(from))

    return true
  } catch {
    return false
  }
}

/**
 * The run tracked now becomes `project`'s, which the board already shows: the tracker places its agents again, and
 * the write that follows reads the run's project and the board (run.tsx `write`), so both are set before it.
 * The labels no block took; null with no run.
 */
const showRunOn = async ($: EngineInterface, tracker: Tracker, name: string, project: Project): Promise<string[] | null> => {
  await update($, uiAtom, held => ({ ...held, follow: true, runCleared: false }))
  await update($, runProjectAtom, () => name)

  return tracker.adopt(handoffOf(name, project))
}

/**
 * The saved project a run's workflow is named as (the projects' name rule), put on the board for that run: what was
 * typed into a field and not sent is saved first, the board's own copy is taken where it shows the project, else the
 * file is opened in its place, and the selection is set to follow the run. Null when no saved project has the name.
 * The caller tells the tracker next (its write reads the run's project and the board, so both are set here), then
 * opens the pane (`paneArgs`).
 */
const projectOfRun = async ($: EngineInterface, workflow: string | undefined): Promise<{ name: string; project: Project } | null> => {
  if (workflow === undefined) return null
  const name = projectName(workflow)
  const path = projectFile(await $.session.root(), name)
  if (!isSaved(name) || !(await $.fs.exists(path).catch(() => false))) return null
  await flushDrafts($)
  const shown = await read($, uiAtom)
  let project = shown.name === name && shown.status === 'ready' ? await read($, projectAtom) : null
  if (project === null) {
    const opened = openProject(name, await $.fs.read(path).catch(() => ''), shown)
    if (opened.project === null) return null
    project = opened.project
    await update($, projectAtom, () => opened.project)
    await update($, uiAtom, () => opened.ui)
  }
  await update($, uiAtom, held => ({ ...held, follow: true, runCleared: false }))
  await update($, runProjectAtom, () => name)

  return { name, project }
}

/**
 * What run.tsx asks of the board when a run starts. `$` does not cross files (`claude plugin validate` refuses a `$`
 * passed to an imported function), so the session's start hook below gives these theirs, as the tracker's host gets its.
 */
export type RunBoard = { projectOfRun: (workflow: string | undefined) => Promise<{ name: string; project: Project } | null>; keepScript: (from: string, to: string) => Promise<boolean> }
let runBoard: RunBoard | undefined
/** Undefined until the session has started. */
export const runBoardOf = (): RunBoard | undefined => runBoard

/** Whether a run of the project shown locks it now, or Claude's draft of it does. */
const lockedNow = async ($: EngineInterface): Promise<boolean> => {
  const run = await read($, runAtom)
  const ui = await read($, uiAtom)
  return ui.drafting === 'show' || (run.status === 'running' && overlaysProject(run, await read($, runProjectAtom), ui))
}

let flushing: Promise<string | null> = Promise.resolve(null)
/** What the last save of drafts said, for a moment: a drawing may have asked for it just before the action that would have (a click on the graph redraws the pane first). */
let justSaid: string | null = null
const SAID_MS = 400
/**
 * Saves what was typed into fields and not sent with Enter: one edit like any other (announced, undone with `u`, written
 * to the file). Called before anything else acts on the project, on every way out of a field: the ring moving, a click on
 * the graph, a key, a type picked, a command, a prompt sent, an edit from chat, the pane closing, the keyboard gone.
 * Resolves to what was said of it, or null when there was nothing to save. One at a time, in the order asked.
 */
const flushDrafts = ($: EngineInterface): Promise<string | null> => {
  const run = flushing.then(async (): Promise<string | null> => {
    if (!hasDrafts()) return null
    const pending = drafts
    drafts = noDrafts()
    const ui = await read($, uiAtom)
    let project: Project | null = await read($, projectAtom)
    // The project they were typed for is no longer the one shown, or a run locks it: nothing can be saved, and it is said.
    const lost = `unsaved text in ${Object.keys(pending.values).map(fieldWord).join(', ')} discarded`
    if (!project || ui.status !== 'ready' || ui.name !== pending.name) {
      $.ui.toast(`conductor: ${lost} (project ${pending.name} is no longer on the board)`)

      return null
    }
    if (await lockedNow($)) {
      await update($, uiAtom, held => ({ ...held, notice: `${lost} · ${held.drafting === 'show' ? DRAFT_LOCK_NOTICE : LOCK_NOTICE}` }))

      return null
    }
    const said: string[] = []
    let titled = false
    const node = pending.id === null ? undefined : findNode(project, pending.id)
    if (node) {
      let patch: NodePatch = {}
      for (const [base, text] of Object.entries(pending.values)) {
        const part = fieldPatch(node, base, text)
        patch = { ...patch, ...part, ...(patch.knobs || part.knobs ? { knobs: { ...patch.knobs, ...part.knobs } } : {}) }
      }
      const step = patchNode(project, ui, node.id, patch)
      if (step.changed && step.project) {
        record(ui.name, project, step.what)
        project = step.project
        said.push(step.what ?? `${node.id} changed`)
        titled = patch.name !== undefined
      }
    }
    if (said.length === 0) return null
    let notice = `${said.join('; ')} · ${UNDO_HINT}`
    try {
      if (isSaved(ui.name)) await $.fs.write(projectFile(await $.session.root(), ui.name), serializeProject(project))
    } catch (error) {
      notice = `not saved: ${reason(error)}`
    }
    const saved = project
    await update($, projectAtom, () => saved)
    await update($, uiAtom, held => ({ ...held, notice, runCleared: true, unsaved: false, freshId: titled ? null : held.freshId }))
    justSaid = notice
    $.clock.after(SAID_MS, () => {
      if (justSaid === notice) justSaid = null
    })

    return notice
  })
  flushing = run.catch(() => null)

  return run
}
/** After a flush, an action that left nothing said keeps what the flush said (`n1 changed: notes · [u] Undo`). */
const keepSaid = async ($: EngineInterface, flushed: string | null): Promise<void> => {
  const said = flushed ?? justSaid
  justSaid = null
  if (said !== null) await update($, uiAtom, held => (held.notice === null ? { ...held, notice: said } : held))
}

/**
 * Puts the ring where it belongs while no field is asked for: on the add list's filter while it is open, else on the
 * catcher. The catcher is the first stop, so the ring is there by its place already but for the ways out of the detail
 * pane (a field's Enter, a type picked, a run ending under a ring that stood in a field).
 */
const settleRing = ($: EngineInterface, tries = 1): void => {
  $.clock.after(FOCUS_DELAY_MS, () => {
    void (async (): Promise<void> => {
      const ui = await read($, uiAtom)
      // A name is being typed on the start screen: the ring is that field's.
      if ((ui.status !== 'ready' && ui.status !== 'pick') || ui.editing || (ui.renaming ?? null) !== null) return
      const key = ui.status === 'ready' && ui.picker !== null && !(await lockedNow($)) ? pickerKey() : drawnCatcher
      const moved = await $.ui.focus({ requestId: PROJECT_PANE_ID, key }).catch(() => ({ deny: 'no' }))
      if (moved.deny === undefined) ringOn = key
      else if (tries > 0) settleRing($, tries - 1)
    })()
  })
}

/**
 * The ring goes back to the catcher, now (it is always drawn, so there is nothing to wait for): the next letter is a
 * key again. Only then are the fields closed: they are drawn as text from there on, and the ring, kept by its place,
 * must not be left on what takes their place.
 */
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

/**
 * Moves the ring to an element of the detail pane: at once where it is drawn already, else a redraw later, tried
 * again once more. Where it cannot be reached at all the field is given up and `hint` is said.
 */
const landOn = ($: EngineInterface, target: () => string, hint: string): void => {
  const land = async (tries: number, last: string): Promise<void> => {
    const key = target()
    // Said before the move is asked: a letter that reaches the element before the answer does is its text.
    ringTo = key
    const moved = await $.ui.focus({ requestId: PROJECT_PANE_ID, key }).catch((error: unknown) => ({ deny: reason(error) }))
    if (moved.deny === undefined && key === target()) {
      ringOn = key
      if (ringTo === key) ringTo = ''
      $.ui.invalidate('ui.render')

      return
    }
    // Refused: not drawn yet, or drawn anew under another address meanwhile (letters typed on the way do that): that one counts from the start.
    const left = key === last ? tries - 1 : LAND_TRIES
    if (left > 0) return void $.clock.after(left > LAND_TRIES - 2 ? FOCUS_DELAY_MS : FOCUS_DELAY_MS * 2, () => void land(left, key))
    if (ringTo === key) ringTo = ''
    await update($, uiAtom, held => ({ ...held, editing: false, freshId: null, renaming: null, notice: hint }))
  }
  void land(LAND_TRIES, '')
}

/**
 * Opens the fields of the selected block for typing, the ring on `base` (its first field when none is named): what `e`
 * does, for the ways that are not a key (the Down arrow from the catcher, a click on a field at rest).
 */
const openFields = async ($: EngineInterface, base?: string): Promise<void> => {
  const ui = await read($, uiAtom)
  const project = await read($, projectAtom)
  const node = project === null || ui.selectedId === null ? undefined : findNode(project, ui.selectedId)
  if (ui.status !== 'ready' || !node || ui.handed || (await lockedNow($))) return
  if (!ui.editing || ui.help > 0 || ui.picker !== null) await update($, uiAtom, held => ({ ...held, editing: true, help: 0, picker: null, detailHidden: false, confirmId: null }))
  landOn($, () => fieldKey(base ?? firstField(node), node.id), `edit: ${EDIT_HINT}`)
}

/**
 * Whether the pane is taking the keyboard back after a click on the graph and the ring is not on the catcher yet.
 * A letter typed then finds the ring where the pane's take left it; on a Button (a field at rest) the engine gives
 * the letter to the prompt box, and the keyboard with it: `prompt.edit` hears of it and makes it the key it was.
 */
let landing = false
/** `landing` is given up after this long, whatever became of the ring. */
const LANDING_MS = 400
/**
 * A click gave the graph the keyboard, and nothing tells a hook when the graph loses it again (Escape is the
 * engine's). So the pane takes the keys back at once, for its catcher (`picks`: for the add list's filter): from there
 * the pane is told whether it holds them, and can say so truthfully. Refused (the prompt box holds text): the graph
 * keeps the keyboard, so it answers no key until the person takes them to the prompt (`handed`).
 */
const retake = async ($: EngineInterface, picks: boolean): Promise<void> => {
  landing = true
  $.clock.after(LANDING_MS, () => {
    landing = false
  })
  await $.ui.open(paneArgs(true)).catch(() => undefined)
  // The ring is asked onto the catcher at once, before the fields close: left where it was, it would rest on what
  // takes a field's place until it is moved. The pane taking the keyboard is itself a move of the ring, and a move
  // asked while that one lands is refused ("the focus moved meanwhile"): it is asked again below, with no wait.
  const early = picks || drawnCatcher === '' ? { deny: 'no' } : await $.ui.focus({ requestId: PROJECT_PANE_ID, key: drawnCatcher }).catch((error: unknown) => ({ deny: reason(error) }))
  if (early.deny === undefined) ringOn = drawnCatcher
  // The ring leaves the field it was in, if any: on the catcher nothing is being typed.
  await update($, uiAtom, held => (held.editing || held.freshId !== null ? { ...held, editing: false, freshId: null } : held))
  // Moving the ring is also how the pane learns whether it got the keyboard: a site that does not hold it is refused.
  // (`$.ui.panes()` asked right after the open still says no.) One more try, since the pane may not be drawn yet.
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

/**
 * A key was typed. Once none has been for TIDY_MS the Inputs are tidied: the catcher and the door emptied of the keys
 * they took, and a field that has letters kept beside it drawn anew with all of its text. Never while the typing goes
 * on: a letter typed in the frame an Input is drawn anew would be dropped.
 */
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
    const again = (target: () => string): void => {
      void $.ui
        .focus({ requestId: PROJECT_PANE_ID, key: drawnCatcher })
        .then(() => landOn($, target, `edit: ${EDIT_HINT}`))
        .catch(() => undefined)
    }
    if (Object.entries(pins).some(([element, pin]) => pin.head !== '' && isField(element))) {
      redrawFields()
      tidied = true
      const [base = '', id = ''] = (at ?? '').replace(/#\d+$/, '').split('@')
      if (at !== undefined && isField(at)) again(() => fieldKey(base, id))
    }
    if (tidied) $.ui.invalidate('ui.render')
  })
}
/** The run laid over the project shown, as the steps need it. */
const runContext = async ($: EngineInterface): Promise<RunContext> => {
  const now = await read($, runAtom)
  const ui = await read($, uiAtom)
  const held = overlaysProject(now, await read($, runProjectAtom), ui)
  // A draft being laid out locks the project as a run does.
  const laying = ui.drafting === 'show'

  return { ...(held ? { run: now, locked: now.status === 'running' || laying } : laying ? { locked: true } : {}), ...(laying ? { drafting: true } : {}), ...(graphBox ? { graph: graphBox } : {}) }
}

/** A change is kept for `u`, counted as a revision, and saved. */
const store = async ($: EngineInterface, step: Step, before: Project | null): Promise<ProjectUi> => {
  if (!step.changed || !step.project) return step.ui
  if (step.what !== undefined) record(step.ui.name, before, step.what)
  try {
    if (isSaved(step.ui.name)) await $.fs.write(projectFile(await $.session.root(), step.ui.name), serializeProject(step.project))
  } catch (error) {
    return { ...step.ui, notice: `not saved: ${reason(error)}` }
  }

  return step.ui
}

/** The header's persona makes a gesture and, a moment after the last one, is at rest again. */
const gesture = ($: EngineInterface, pose: Pose): void => {
  restPersona?.cancel()
  void update($, personaAtom, () => pose)
  restPersona = $.clock.after(GESTURE_MS, () => {
    restPersona = null
    void update($, personaAtom, () => 'idle' as const)
  })
}

/** The header's persona goes to its next pose and holds it: a step for each key that moves the selection. */
const beat = ($: EngineInterface): void => {
  restPersona?.cancel()
  restPersona = null
  void update($, personaAtom, pose => nextPose(pose))
}

/**
 * The splash is on: it is over after its time, and the ring is then put where the designer has it. Started by the
 * drawing that shows it; a reload in the middle of it starts it again.
 */
const startSplash = ($: EngineInterface): void => {
  if (splashing) return
  splashing = true
  $.clock.after(SPLASH_MS + SPLASH_REST_MS, () => {
    // Given back: a /clear starts the session's state over (the splash is unseen again) while this module lives on.
    splashing = false
    void update($, splashedAtom, () => true).then(() => settleRing($))
  })
}

/** A key or a choice in the detail pane: the state is read as it is now, stepped, saved, written back. */
const commit = async ($: EngineInterface, make: (project: Project | null, held: ProjectUi, context: RunContext) => Step): Promise<Step> => {
  const before = await read($, projectAtom)
  const held = await read($, uiAtom)
  const step = make(before, held, await runContext($))
  const nextUi = await store($, step, before)
  if (step.project !== before) await update($, projectAtom, () => step.project)
  if (nextUi !== held) await update($, uiAtom, () => nextUi)
  const pose = step.changed ? gestureOf(before, step.project) : null
  if (pose !== null) gesture($, pose)

  return { ...step, ui: nextUi }
}

/**
 * A request (`r`, `q`) waits in the prompt box under a line that says so, or the keys are off while the box holds text
 * (`handed`): the line goes, and the keys are keys again, once the box is empty.
 */
const watchBox = ($: EngineInterface): void => {
  if (boxWatched) return
  boxWatched = true
  const look = (): void => {
    $.clock.after(BOX_POLL_MS, () => {
      void (async (): Promise<void> => {
        const ui = await read($, uiAtom)
        const waits = ui.handed || (ui.notice !== null && /^(run|ask|draft): /.test(ui.notice))
        const box = waits ? await $.prompt.read().catch(() => ({ text: '', cursor: 0 })) : null
        if (box !== null && box.text.trim() !== '') return look()
        boxWatched = false
        if (waits) await update($, uiAtom, held => ({ ...held, handed: false, notice: held.notice !== null && (/^(run|ask|draft): /.test(held.notice) || held.notice === HANDED_NOTICE) ? null : held.notice }))
      })()
    })
  }
  look()
}

/** Says one thing on the message row. */
const say = async ($: EngineInterface, notice: string): Promise<void> => {
  await update($, uiAtom, held => ({ ...held, notice }))
}

/**
 * Project `name` is handed to Claude (`r`, or its sentence sent as a prompt): saved where only the board held it, the
 * next run to start counted against it, and its hand-off left with the offer tool, which the sentence tells Claude to
 * call first. False where there is nothing to hand off (no such project, or an empty one).
 */
const handOff = async ($: EngineInterface, name: string): Promise<boolean> => {
  const shown = await read($, uiAtom)
  const path = projectFile(await $.session.root(), name)
  // A template nobody edited yet is on the board only: handing it off is what saves it.
  const onBoard = shown.name === name && shown.status === 'ready' ? await read($, projectAtom) : null
  if (onBoard !== null && !(await $.fs.exists(path))) await $.fs.write(path, serializeProject(onBoard)).catch(() => undefined)
  if (!(await $.fs.exists(path))) return false
  if (onBoard !== null && shown.unsaved) await update($, uiAtom, held => ({ ...held, unsaved: false }))
  const parsed = parseProject(await $.fs.read(path).catch(() => ''))
  if (!parsed.ok || isBlank(parsed.project)) return false
  runTracker?.handoff(handoffOf(name, parsed.project))
  offerHanded(name)
  // The selection follows the run that starts.
  await update($, uiAtom, held => ({ ...held, follow: true, runCleared: false, notice: held.notice?.startsWith('run: ') ? null : held.notice }))

  return true
}

/**
 * `q` and the start screen's draft button put a request in the prompt box, for the person to finish and send; `r`
 * (Implement and Run) sends its own at once, and Claude's turn starts: it confirms the design and asks what to run
 * it on, in chat. Either way what the person types next is for the prompt. No call hands the keyboard from a pane to
 * the prompt, so the pane is closed and shown again without it. Where that did not take the keys away, no key is
 * acted on until the person does (`handed`).
 */
const request = async ($: EngineInterface, kind: 'run' | 'ask' | 'draft'): Promise<void> => {
  const ui = await read($, uiAtom)
  const now = await read($, projectAtom)
  if (kind === 'run' && !isSaved(ui.name)) return say($, 'run: a replay is not a saved project, there is nothing to hand off')
  if (kind === 'run' && (now === null || isBlank(now))) return say($, 'run: the project is empty, add a block first')
  const line = kind === 'run' ? handoffPrompt(ui.name) : kind === 'ask' ? reviewPrompt(ui.name) : draftLine()
  /** The request waits in the prompt box, under a line that says so. False where it could not be put there. */
  const fill = async (): Promise<boolean> => {
    const filled = await $.prompt.fill({ text: line }).catch(() => ({ isFilled: false }))
    await say($, kind === 'run' ? runNotice(line, filled.isFilled) : kind === 'ask' ? askNotice(line, filled.isFilled) : draftNotice(line, filled.isFilled))
    if (filled.isFilled) watchBox($)

    return filled.isFilled
  }
  if (kind === 'run') {
    // The mod's own prompt does not come by its `prompt.submit` hook: the hand-off is made here.
    if (!(await handOff($, ui.name))) return say($, `run: ${ui.name} could not be handed off`)
    // Said before the handoff, never a gate: how much the project implies.
    if (now !== null) $.ui.toast(`conductor: ${ui.name} handed to Claude · ${preflightLine(now)}`)
    // Sent as the person's own words (they pressed the key), from a clock callback, as a command's is: never from
    // inside the chain of keys, which it would hold for the turn. Refused (the prompt box holds text): the request
    // is left there for the person to send.
    $.clock.after(SUBMIT_DELAY_MS, () => {
      void $.prompt
        .submit({ text: line, asUser: true })
        .then(entered => (entered.drop === undefined ? undefined : fill()))
        .catch(() => fill())
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
    void $.ui
      .focus({ requestId: PROJECT_PANE_ID, key: drawnCatcher })
      .catch(() => ({ deny: 'no' }))
      .then(moved => (moved.deny === undefined ? update($, uiAtom, held => ({ ...held, handed: true, notice: HANDED_NOTICE })) : undefined))
      // Watched until the box is empty, also where the watch above ended before this was known.
      .then(() => watchBox($))
  })
}

/** The draft's ticker stops. */
const stopDraftTicker = (): void => {
  draftTicker?.cancel()
  draftTicker = null
}

/**
 * One beat while Claude drafts. Awaited (`wait`), the splash moves on it. Landed (`show`), the graph shows more of
 * the project with each: the new blocks marked, the selection on the last of them so the graph scrolls there. Once
 * all of it is shown the selection goes back to the start block, and only the header's persona keeps the beat until
 * Claude's turn ends.
 */
const draftBeat = async ($: EngineInterface): Promise<void> => {
  const ui = await read($, uiAtom)
  if ((ui.drafting ?? null) === null) return stopDraftTicker()
  await update($, draftBeatAtom, beat => beat + 1)
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

/**
 * Claude was asked for a draft (`/conductor <description>`, or "Conductor" answered before a workflow): the splash
 * is shown until the project lands, whatever the pane showed, which is kept under it. The keyboard stays in the
 * prompt, where Claude's questions are answered.
 */
const beginDraft = async ($: EngineInterface): Promise<void> => {
  await flushDrafts($)
  await update($, draftBeatAtom, () => 0)
  await update($, uiAtom, held => ({ ...held, drafting: 'wait' as const, reveal: null, editing: false, freshId: null, picker: null, confirmId: null, renaming: null, deleteAsk: null, handed: false, notice: null }))
  await $.ui.open(paneArgs(false)).catch(() => undefined)
  startDraftTicker($)
}

/**
 * The draft is over: Claude's turn ended, or the wait was given up. A project that landed is whole on the graph and
 * can be edited; with `keys` its board takes the keyboard, where nothing is being typed in the prompt. With none
 * landed the pane shows what it showed before.
 */
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

/**
 * Enter in a field of a block: its text and whatever was typed in the block's other fields are saved as one edit,
 * and the ring goes back to the catcher. The ring is claimed for the catcher first: a letter typed on Enter's heels
 * is then no text of the field.
 */
const saveField = async ($: EngineInterface, id: string, base: string, value: string): Promise<void> => {
  ringOn = drawnCatcher
  savedField = { element: fieldKey(base, id), value, taken: 0 }
  const ui = await read($, uiAtom)
  const mine = drafts.id === id && drafts.name === ui.name
  drafts = { name: ui.name, id, values: { ...(mine ? drafts.values : {}), [base]: value } }
  await home($)
  await flushDrafts($)
}

/** A choice in the add list: the block is added and its title is the next thing typed; a type picked for a block sends the ring back to the catcher. */
const pick = async ($: EngineInterface, choice: Partial<PickRow>): Promise<void> => {
  await flushDrafts($)
  const step = await commit($, (before, held, context) => pickBlock(before, held, choice, context))
  // A block opened on its kinds: the filter is drawn anew, empty, for the kinds' list.
  if (step.ui.picker?.block !== undefined && step.ui.picker.query === '') pickGen++
  const fresh = step.changed && step.ui.editing ? step.ui.freshId : null
  if (fresh !== null) landOn($, () => fieldKey(NAME_KEY, fresh), `edit: ${EDIT_HINT}`)
  else if (!step.ui.picker) await home($)
}

/** Starts the project the start screen was opened for, from a template (or blank). */
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
  // A project nobody named says once how it gets a name (the line goes with the next thing said).
  await update($, uiAtom, () => ({ ...step.ui, help: 0, notice: isDefaultName(step.ui.name) ? `named ${step.ui.name} for now · once it is saved, p lists it and e renames it there` : null }))
  settleRing($)
}

/** The name of every saved project under `root`, in order: all of them, also those a list leaves out. */
const savedNames = async ($: EngineInterface, root: string): Promise<string[]> => {
  const entries = await $.fs.list(`${root.replace(/\/+$/, '')}/${PROJECT_DIR}`).catch(() => [])

  return entries
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
    .map(entry => entry.name.slice(0, -'.json'.length))
    .filter(isSaved)
    .sort()
}

/** The saved projects under `root`, each read: its line for a list, and its project kept for the start screen's graph. */
const readSaved = async ($: EngineInterface, root: string): Promise<SavedProject[]> => {
  const dir = `${root.replace(/\/+$/, '')}/${PROJECT_DIR}`
  const names = await savedNames($, root)
  savedPast = Math.max(0, names.length - SAVED_MAX)
  const saved: SavedProject[] = []
  for (const one of names.slice(0, SAVED_MAX)) {
    const text = await $.fs.read(`${dir}/${one}.json`).catch(() => '')
    const parsed = parseProject(text)
    previews[one] = parsed.ok ? parsed.project : null
    saved.push(savedProject(one, text))
  }

  return saved
}

/** `p`, or a press on the header's name: the start screen over the project shown, its row marked. The project is kept for the way back. */
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

/** Back from the list of projects to the one it was opened from: as its file has it now, or as it stood where no file holds it yet. */
const closeProjectList = async ($: EngineInterface): Promise<void> => {
  const held = await read($, uiAtom)
  const name = held.back ?? null
  if (held.status !== 'pick' || name === null) return
  const kept = behind !== null && behind.ui.name === name ? behind : null
  const text = isSaved(name) ? await $.fs.read(projectFile(await $.session.root(), name)).catch(() => undefined) : undefined
  const step = typeof text === 'string' ? openProject(name, text, held) : null
  behind = null
  if (step !== null && step.project !== null) {
    // The view it was left in, where that container is still there.
    const project = step.project
    const viewRootId = kept !== null && kept.ui.viewRootId !== null && findNode(project, kept.ui.viewRootId) ? kept.ui.viewRootId : null
    await update($, projectAtom, () => project)
    await update($, uiAtom, () => ({ ...step.ui, viewRootId, carousels: kept?.ui.carousels ?? {}, runCleared: kept?.ui.runCleared ?? false, follow: kept?.ui.follow ?? true }))
  } else if (step !== null) {
    // Its file is no project any more: said as it is when opened by name.
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

/** A saved project picked on the start screen: read again as it is now, and shown. */
const openSaved = async ($: EngineInterface, name: string): Promise<void> => {
  const held = await read($, uiAtom)
  const text = await $.fs.read(projectFile(await $.session.root(), name)).catch(() => undefined)
  const step = openProject(name, typeof text === 'string' ? text : undefined, held)
  if (step.ui.status === 'pick') {
    await update($, uiAtom, ui => ({ ...ui, notice: `${name} is gone: it could not be read` }))

    return
  }
  await update($, projectAtom, () => step.project)
  await update($, uiAtom, () => step.ui)
  settleRing($)
}

/** The recorded runs, by the name the start screen lists them under (`RECORDINGS`). */
const FIXTURES: Record<string, ReplayFixture> = { 'review-41': review41, 'partial-29': partial29 }

/** Why no replay may start now: it would take the place of a real run, whose agents would then be counted nowhere. Null when one may. */
const replayRefusal = (): string | null => {
  if (runTracker === undefined || !runTracker.busy()) return null

  return runTracker.awaitsRun() ? 'a project handed to Claude waits for its run: a replay can start once that run ends' : 'a workflow is running: a replay can start once the run ends'
}

/** A made-up run replayed over a template's project, which is named `replay-<template>` and lives in the session only: no file is written, and none is listed. */
const replayOver = async ($: EngineInterface, templateId: string): Promise<void> => {
  const template = TEMPLATES.find(one => one.id === templateId)
  if (!template || runTracker === undefined) return
  const refusal = replayRefusal()
  if (refusal !== null) return say($, refusal)
  const name = projectName(`replay-${template.id}`)
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

/** A recorded run replayed in the run view, which is opened for it: it belongs to no project. */
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

/** Every stored "Always" and "Never" answer goes, whichever of Conductor's questions it was given to: both are asked again. */
const forgetAnswers = async ($: EngineInterface): Promise<void> => {
  const keys = (await $.store.keys().catch(() => [])).filter(key => key.startsWith(ASK_PREFIX))
  for (const key of keys) await $.store.delete(key).catch(() => undefined)
  await say($, resetText(keys.length))
}

/** A row of the start screen is opened: by Enter on the marked one, or by a click on any. */
const openEntry = async ($: EngineInterface, at?: number): Promise<void> => {
  const ui = await read($, uiAtom)
  if (ui.status !== 'pick') return
  const entry = startEntries(ui.saved ?? [])[at ?? ui.startMark ?? 0]
  if (!entry) return
  // The rows under the projects open none: a replay, or the stored answers forgotten.
  if (entry.kind === 'replay') return replayOver($, entry.id)
  if (entry.kind === 'recording') return replayRecording($, entry.id)
  if (entry.kind === 'reset') return forgetAnswers($)
  const back = ui.back ?? null
  // The project the list was opened from: back to it, as it stood.
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

/** What this session knows of a project, by its name: its undo history, its revisions, what Claude saw of it. */
const books = (): Record<string, unknown>[] => [histories, revisions, seenByClaude, seenProjects, warnedAt] as Record<string, unknown>[]

/** The start screen's list is read again (a project was renamed or deleted), the mark on `name` where it is listed. */
const relist = async ($: EngineInterface, name: string | null, notice: string): Promise<void> => {
  const root = await $.session.root()
  const saved = await readSaved($, root)
  const names = await savedNames($, root)
  await update($, uiAtom, held => {
    const at = name === null ? -1 : saved.findIndex(one => one.name === name)
    const last = startEntries(saved).length - 1

    // The name a new project would get is one no saved project has now.
    return { ...held, name: held.status === 'pick' && names.includes(held.name) ? freeName(names) : held.name, saved, startMark: Math.max(0, Math.min(last, at >= 0 ? at : (held.startMark ?? 0))), renaming: null, deleteAsk: null, notice }
  })
}

/** Deletes a saved project, its script with it. What is said of it; nothing is deleted where it says a refusal. */
const deleteSaved = async ($: EngineInterface, name: string): Promise<string> => {
  const root = await $.session.root()
  const path = projectFile(root, name)
  if (!isSaved(name) || !(await $.fs.exists(path))) return `${name} is gone already: nothing to delete`
  if ((await read($, runProjectAtom)) === name && (await read($, runAtom)).status === 'running') return `${name} is being run: it can be deleted once the run ends`
  const removed = await $.process.run(['rm', '--', path]).catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: reason(error) }))
  if (removed.exitCode !== 0) return `${name} could not be deleted: ${cutCells(oneLine(removed.stderr), 120) || 'rm failed'}`
  // Its script goes with it. One that stays behind is said: the project is gone all the same.
  const script = await scriptOf($, root, name)
  const scriptGone = script === null || (await $.process.run(['rm', '--', script]).catch(() => ({ exitCode: 1 }))).exitCode === 0
  for (const book of books()) delete book[name]
  delete previews[name]
  // The list was opened from it: there is no way back to it.
  if (behind !== null && behind.ui.name === name) behind = null
  await update($, uiAtom, held => ({ ...held, back: held.back === name ? null : (held.back ?? null), picks: Object.fromEntries(Object.entries(held.picks ?? {}).filter(([key]) => key !== name)) }))

  return scriptGone ? `deleted ${name}${script === null ? '' : ' and its script'}` : `deleted ${name}, but its script ${PROJECT_DIR}/${name}.workflow.js could not be removed`
}

/** Renames a saved project: the file, its script, and what this session knows of it. `done` is the new name; a refusal renames nothing. */
const renameSaved = async ($: EngineInterface, oldName: string, typed: string): Promise<{ done: string | null; text: string }> => {
  if (typed.trim() === '') return { done: null, text: 'rename: no name was typed' }
  const newName = projectName(typed)
  if (oldName === newName) return { done: null, text: `${oldName} keeps its name` }
  if (!isSaved(newName)) return { done: null, text: `rename: names starting with ${SCRATCH_PREFIX} are kept for replays` }
  const root = await $.session.root()
  const oldPath = projectFile(root, oldName)
  const newPath = projectFile(root, newName)
  if (!(await $.fs.exists(oldPath))) return { done: null, text: `${oldName} is gone: nothing to rename` }
  if (await $.fs.exists(newPath)) return { done: null, text: `rename: a project named ${newName} exists` }
  if ((await read($, runProjectAtom)) === oldName && (await read($, runAtom)).status === 'running') return { done: null, text: `${oldName} is being run: it can be renamed once the run ends` }
  const parsed = parseProject(await $.fs.read(oldPath).catch(() => ''))
  if (!parsed.ok) return { done: null, text: `rename: ${oldName} is not a valid project file` }
  try {
    await $.fs.write(newPath, serializeProject({ ...parsed.project, name: newName }))
  } catch (error) {
    return { done: null, text: `rename: ${newName} could not be saved: ${reason(error)}` }
  }
  const removed = await $.process.run(['rm', '--', oldPath]).catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: reason(error) }))
  if (removed.exitCode !== 0) return { done: newName, text: `${newName} was written, but ${PROJECT_DIR}/${oldName}.json could not be removed` }
  // Its script moves with it. One that stays behind is said: the project is renamed all the same.
  const script = await scriptOf($, root, oldName)
  const scriptMoved = script === null || (await $.process.run(['mv', '--', script, scriptFile(root, newName)]).catch(() => ({ exitCode: 1 }))).exitCode === 0
  for (const book of books()) {
    if (oldName in book) book[newName] = book[oldName]
    delete book[oldName]
  }
  delete previews[oldName]
  // The project the list was opened from: the way back is to its new name.
  if (behind !== null && behind.ui.name === oldName) behind = { project: { ...behind.project, name: newName }, ui: { ...behind.ui, name: newName } }
  await update($, uiAtom, held => {
    const picks = { ...(held.picks ?? {}) }
    const left = picks[oldName]
    delete picks[oldName]

    return { ...held, back: held.back === oldName ? newName : (held.back ?? null), picks: left === undefined ? picks : { ...picks, [newName]: left } }
  })

  return { done: newName, text: scriptMoved ? `renamed ${oldName} to ${newName}` : `renamed ${oldName} to ${newName}, but its script could not be moved with it` }
}

/** Enter in the start screen's name field: the project is renamed, the list read again, and the ring goes back to the catcher. */
const renameEnter = ($: EngineInterface, oldName: string, value: string): void => {
  keyChain = keyChain
    .then(async (): Promise<void> => {
      if (((await read($, uiAtom)).renaming ?? null) !== oldName) return
      const answer = await renameSaved($, oldName, value)
      await relist($, answer.done ?? oldName, answer.text)
      await home($)
    })
    .catch((error: unknown) => {
      $.ui.toast(`conductor: ${reason(error)}`)
    })
    .then(() => $.ui.invalidate('ui.render'))
}

/**
 * One key on the start screen: `w` / `s` move the mark (the arrows do too: the `ui.focus` hook), Enter opens the
 * marked row, `?` turns the help pages and `x` closes them. On a saved project `e` renames it (its name becomes a
 * field) and `x` deletes it, asked twice. Opened from a project, `p` and `b` go back to it.
 */
const startKey = async ($: EngineInterface, key: string): Promise<boolean> => {
  const ui = await read($, uiAtom)
  // A name is being typed: a letter that reached the catcher on the ring's way to the field is no key. One that comes
  // once the ring has been there found it back on the catcher (a click took it): the name is left as it was.
  if ((ui.renaming ?? null) !== null) {
    if (isRenameField(ringTo)) return true
    await update($, uiAtom, held => ({ ...held, renaming: null }))
  }
  if (key === ENTER) {
    await openEntry($)

    return false
  }
  const op = KEY_OPS[key]
  const helping = (ui.help ?? 0) > 0
  const marked = startEntries(ui.saved ?? [])[ui.startMark ?? 0]
  const asked = ui.deleteAsk ?? null
  // Any key but a second `x` takes the question back.
  if (asked !== null && !(op === 'remove' && !helping)) await update($, uiAtom, held => ({ ...held, deleteAsk: null, notice: null }))
  if (op === 'up' || op === 'down') beat($)
  if (op === 'up' || op === 'down') await update($, uiAtom, held => ({ ...moveStartMark(held, op === 'up' ? -1 : 1), help: 0 }))
  else if (op === 'help') await update($, uiAtom, held => ({ ...held, notice: null, help: ((held.help ?? 0) % HELP_PAGES) + 1 }))
  else if (op === 'remove' && helping) await update($, uiAtom, held => ({ ...held, help: 0 }))
  // Opened from a project: the key that opened the list goes back to it, and so does `b`.
  else if ((op === 'projects' || op === 'back') && (ui.back ?? null) !== null) {
    await closeProjectList($)

    return false
  } else if ((op === 'remove' || (op === 'edit' && key !== ENTER)) && marked?.kind !== 'saved') await say($, `${op === 'remove' ? 'delete' : 'rename'}: mark a saved project first`)
  else if (op === 'remove' && marked) {
    if (asked === marked.id) await relist($, null, await deleteSaved($, marked.id))
    else await update($, uiAtom, held => ({ ...held, deleteAsk: marked.id, notice: `delete ${marked.id} (${blocksWord(marked.blocks)}) and its script? x again deletes it · any other key keeps it` }))
  } else if (op === 'edit' && marked) {
    renameGen++
    await update($, uiAtom, held => ({ ...held, renaming: marked.id, help: 0, notice: null }))
    landOn($, renameKey, 'rename: click the name to type in it')

    return false
  } else await say($, unboundNotice(key))

  return true
}

/**
 * One key, as the catcher was given it: a character, or `enter`. Resolves to false when the keys typed with it are
 * not to be applied any more (the keyboard went to the prompt, nothing is on the board).
 */
const runKey = async ($: EngineInterface, key: string): Promise<boolean> => {
  const ui = await read($, uiAtom)
  const project = await read($, projectAtom)
  // The splash waits for Claude's draft: there is nothing to act on.
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
      // The block's first field: its name's, the goal's on the start block.
      const first = firstField(node)
      const text = (mine ? drafts.values[first] : undefined) ?? (first !== NAME_KEY ? (node.knobs?.goal ?? '') : ui.freshId === node.id ? '' : node.name)
      if (key === ENTER) await saveField($, node.id, first, text)
      else {
        // The field may be drawn already, without this letter: the letter is kept beside it, after the text it
        // opened with and before what was typed in the field itself since, until the typing pauses.
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
  if (op === 'up' || op === 'down' || op === 'left' || op === 'right') beat($)
  // What was typed into a field and not sent is saved before the key acts.
  const flushed = await flushDrafts($)
  const step = await commit($, (before, held, context) => keyStep(before, held, op, context))
  await keepSaid($, flushed)
  // A request waits in the prompt box: the key was not acted on, and the pane says how to get to the prompt.
  if (ui.handed) return false
  if (op === 'projects') {
    await openProjectList($)

    return false
  }
  if ((op === 'run' || op === 'review') && !locked) {
    await request($, op === 'run' ? 'run' : 'ask')

    return false
  }
  const edited = op === 'edit' && step.ui.editing && step.project && step.ui.selectedId !== null ? findNode(step.project, step.ui.selectedId) : undefined
  if (edited) landOn($, () => fieldKey(firstField(edited), edited.id), `edit: ${EDIT_HINT}`)
  if ((op === 'add' || op === 'retype') && step.ui.picker) {
    // A new filter, with nothing typed in it.
    pickGen++
    landOn($, pickerKey, op === 'add' ? 'new block: click the filter to type in it' : 'block: click the filter to type in it')
  }

  return true
}

/** Keys join the line: each is applied on the state the one before it left. */
const queueKeys = ($: EngineInterface, keys: readonly string[] | null): void => {
  keyChain = keyChain
    .then(async (): Promise<void> => {
      if (keys === null) return say($, PASTE_NOTICE)
      for (const key of keys) if (!(await runKey($, key))) return
    })
    .catch((error: unknown) => {
      $.ui.toast(`conductor: ${reason(error)}`)
    })
    // The catcher is drawn again under its new key, empty, whatever the keys changed.
    .then(() => $.ui.invalidate('ui.render'))
}

/**
 * What the catcher was given: its whole text so far (it is emptied only once the typing has paused), so the new
 * characters are the ones after those already taken. Up to BURST_MAX at once are keys, applied in order; more is a
 * paste. Enter (`submit`) is a key after them.
 */
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

/**
 * What the door was given: the person's Down arrow left the ring on it and the fields are opening. Whatever is typed here
 * is the title's text, as what is typed into the catcher after `e` is; Enter saves it.
 */
const doorKeys = ($: EngineInterface, element: string, kind: 'change' | 'submit', value: string): void => {
  const fresh = doored.element === element ? value.slice(Math.min(value.length, doored.taken)) : value
  doored = { element, taken: value.length }
  tidySoon($)
  keyChain = keyChain
    .then(async (): Promise<void> => {
      if (!(await read($, uiAtom)).editing) await openFields($)
      if (!(await read($, uiAtom)).editing) return
      for (const key of [...fresh, ...(kind === 'submit' && value !== '' ? [ENTER] : [])]) if (!(await runKey($, key))) return
    })
    .catch((error: unknown) => {
      $.ui.toast(`conductor: ${reason(error)}`)
    })
    .then(() => $.ui.invalidate('ui.render'))
}

/**
 * The list closed on Enter and the ring has not left its filter yet: what was typed there since is no filter text. It
 * goes where a key typed now goes (a block was added: into its title). False when the keys are not to be applied.
 */
const closedFilter = async ($: EngineInterface, element: string, value: string): Promise<boolean> => {
  if (pickedField.element !== element) return false
  const fresh = value.slice(afterEnter(pickedField, value))
  pickedField = { ...pickedField, taken: pickedField.taken + fresh.length }
  const burst = burstKeys(fresh)
  if ('paste' in burst) return false
  for (const key of burst.keys) if (!(await runKey($, key))) return false

  return true
}

/** Enter in the add list's filter: the marked type is taken. Pressed again before the ring has left, it is Enter for what opened next. */
const filterEnter = ($: EngineInterface, element: string, value: string): void => {
  keyChain = keyChain
    .then(async (): Promise<void> => {
      if ((await read($, uiAtom)).picker !== null) {
        pickedField = { element, value, taken: 0 }

        return pick($, {})
      }
      if (await closedFilter($, element, value)) await runKey($, ENTER)
    })
    .catch((error: unknown) => {
      $.ui.toast(`conductor: ${reason(error)}`)
    })
    .then(() => $.ui.invalidate('ui.render'))
}

/**
 * What the add list's filter holds: while nothing narrows the list `w` / `s` move the mark and `n` changes the
 * place; those are taken out of the text (the filter is drawn again under a new key, without them).
 */
const filterKeys = ($: EngineInterface, element: string, value: string): void => {
  keyChain = keyChain
    .then(async (): Promise<void> => {
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
      // `x` closed the list: the ring goes back to the graph.
      if ((await read($, uiAtom)).picker === null) await home($)
    })
    .catch((error: unknown) => {
      $.ui.toast(`conductor: ${reason(error)}`)
    })
    .then(() => $.ui.invalidate('ui.render'))
}

export const registerProject = (on: On, tracker: Tracker): void => {
  runTracker = tracker
  // run.tsx registers /conductor. With words /conductor is a draft: Claude makes a new project for
  // them and names it. With none it is the board: a run in progress on its project (run.tsx's phase view when it came
  // from none), else the project last opened, with the keyboard, else the start screen.
  on('command.run', { command: COMMAND }, async ($, e, next) => {
    const words = e.args.trim().replace(/\s+/g, ' ')
    terminalColumns = e.presentation?.columns ?? terminalColumns
    // Whatever was typed into a field and not sent is saved before the command acts (it may open another project).
    await flushDrafts($)
    // The person is at the prompt, sending a command: nothing waits there for the keys any more.
    if ((await read($, uiAtom)).handed) await update($, uiAtom, held => ({ ...held, handed: false, notice: held.notice === HANDED_NOTICE ? null : held.notice }))

    if (words !== '') {
      // The splash is shown until the project lands; the brief goes with this answer, and the prompt that follows starts the turn.
      await beginDraft($)
      const prompt = `Draft a workflow project: ${words}`
      // `prompt.submit` is refused inside this hook (it would wait on the turn the hook holds), so it is sent once the command has settled.
      $.clock.after(SUBMIT_DELAY_MS, () => {
        const fill = async (): Promise<void> => {
          const filled = await $.prompt.fill({ text: prompt }).catch(() => ({ isFilled: false }))
          $.ui.toast(filled.isFilled ? 'conductor: press Enter to start the draft' : `conductor: type "${prompt}" to start the draft`)
        }
        void $.prompt
          .submit({ text: prompt })
          .then(entered => (entered.drop === undefined ? undefined : fill()))
          .catch(() => fill())
      })

      return { text: 'drafting a workflow project', context: draftBrief(words) }
    }

    // A draft was awaited and the person asks for the board: the wait is given up, and one being laid out is shown whole.
    await endDraft($, false)
    const bare = bareTarget((await read($, runAtom)).status, await read($, runProjectAtom), await read($, uiAtom))
    if (bare.view === 'run') return next(e)
    const root = await $.session.root()
    const previous = await read($, uiAtom)
    // The run's project, else the project this session last had open.
    const name = bare.name
    // It is often already loaded: it is shown as it stands.
    if (previous.name === name && previous.status === 'ready' && (await read($, projectAtom)) !== null) {
      // A field left open when the keyboard went to the prompt is closed: the keys are keys again.
      if (previous.editing || previous.picker !== null) await update($, uiAtom, held => ({ ...held, editing: false, freshId: null, picker: null }))
      await $.ui.open(paneArgs(true))
      // On the catcher, never in a field.
      settleRing($)

      return { text: bare.live ? `Project ${name} opened with its run.` : `Project ${name} opened.` }
    }
    // The saved projects, each read: the start screen lists them and draws the marked one.
    const saved = await readSaved($, root)
    // Nothing was opened yet in this session: the saved projects first. A template starts a new project under a name none of them has.
    if (!bare.live && name === DEFAULT_PROJECT_NAME && previous.status === 'closed' && saved.length > 0) {
      const started = openProject(freeName(await savedNames($, root)), undefined, previous)
      await update($, projectAtom, () => null)
      await update($, uiAtom, () => ({ ...started.ui, saved, startMark: 0 }))
      await $.ui.open(paneArgs(true))
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
    // No such project (yet): the start screen. The saved ones are listed; the mark starts on the first template.
    if (step.ui.status === 'pick') step = { ...step, ui: { ...step.ui, name: saved.some(one => one.name === name) ? freeName(await savedNames($, root)) : name, saved, startMark: saved.length } }
    await update($, projectAtom, () => step.project)
    await update($, uiAtom, () => step.ui)
    // With the keyboard, the keys work at once: no click on the graph.
    await $.ui.open(paneArgs(true))
    settleRing($)

    if (step.ui.status === 'error') return { text: `Project ${name} could not be opened: ${step.ui.error}` }

    return { text: step.ui.status === 'pick' ? 'Open a saved project in the pane, or start a new one from a template.' : `Project ${name} opened.` }
  })

  // The tool Claude edits a project with, deferred: its schema is loaded when Claude asks for it, not sent with every turn.
  // The matcher is always true: run.tsx holds the unmatched session.start.
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    await $.tool.register({ name: TOOL_NAME, description: toolDescription(), inputSchema: TOOL_SCHEMA, isDeferred: true })
    runBoard = { projectOfRun: workflow => projectOfRun($, workflow), keepScript: (from, to) => keepScript($, from, to) }
    setOfferBoard({ drafting: () => beginDraft($) })
    // A load (the first, or a reload): the state outlives it, what it said of the moment does not. No field is open,
    // nothing waits in the prompt box under a `run: …` line, no draft is counted in (its ticker went with the load
    // before), and the ring starts on the catcher.
    await update($, uiAtom, held =>
      held.editing || held.picker !== null || held.handed || held.confirmId !== null || (held.drafting ?? null) !== null || (held.renaming ?? null) !== null || (held.deleteAsk ?? null) !== null || (held.notice !== null && /^(run|ask|draft): /.test(held.notice)) || held.notice === HANDED_NOTICE
        ? {
            ...held,
            editing: false,
            freshId: null,
            picker: null,
            handed: false,
            confirmId: null,
            drafting: null,
            reveal: null,
            renaming: null,
            deleteAsk: null,
            notice: held.notice !== null && (/^(run|ask|draft): /.test(held.notice) || held.notice === HANDED_NOTICE) ? null : held.notice,
          }
        : held,
    )

    return next(e)
  })

  // Every prompt: what was typed is saved, a board changed by hand is said, and the hand-off sentence typed by the
  // person (`r` sends it itself, past this hook) hands its project off.
  on('prompt.submit', { text: /^/ }, async ($, e, enter) => {
    // What was typed into a field and not sent goes with the project: Claude reads the file.
    await flushDrafts($)
    const shown = await read($, uiAtom)
    // A "Conductor" answer whose draft never came is over with its turn: a later edit from chat leaves the keyboard alone.
    offerPrompted()
    // The person's own words in the conversation (a notice of a run that ended is not): a handoff that waits for its run waits on.
    if ((e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'sdk') && !e.text.trimStart().startsWith('/')) tracker.prompted()
    // A prompt was sent: whatever waited in the box for the keys is on its way, and the line that said so is spent.
    if (shown.handed || (shown.notice !== null && /^(run|ask|draft): /.test(shown.notice))) {
      await update($, uiAtom, held => ({ ...held, handed: false, notice: held.notice === HANDED_NOTICE || (held.notice !== null && /^(run|ask|draft): /.test(held.notice)) ? null : held.notice }))
    }
    // The board changed by hand since Claude last read the project: it is told so with this prompt, once per change,
    // or it would answer from what it remembers (a review of a block deleted a minute ago). The note says the change
    // itself where the project Claude saw is at hand, so no read is spent on it; without one it says to read again.
    let context = e.context ?? []
    const revision = revisions[shown.name] ?? 0
    const seen = seenByClaude[shown.name]
    let told: Project | null = null
    if (shown.status === 'ready' && !e.text.trimStart().startsWith('/') && seen !== undefined && seen !== revision && warnedAt[shown.name] !== revision) {
      warnedAt[shown.name] = revision
      const board = await read($, projectAtom)
      const before = seenProjects[shown.name]
      const change = board !== null && before !== undefined ? changedNote(shown.name, revision, before, board, shown.selectedId) : null
      if (change !== null) told = board
      context = [...context, change ?? staleNote(shown.name, revision)]
    }
    const pass = context === (e.context ?? []) ? e : { ...e, context }
    // A change said in full counts as read once the prompt has entered with it: an edit made from it is not refused as stale.
    const next = async (input: typeof e): Promise<Awaited<ReturnType<typeof enter>>> => {
      const answer = await enter(input)
      if (told !== null && answer.drop === undefined && (revisions[shown.name] ?? 0) === revision) sawProject(shown.name, told)

      return answer
    }
    // The hand-off sentence, typed or left in the box by `r` where it could not be sent: the hand-off is made as `r` makes it.
    const name = handoffTarget(e.text)
    if (name !== null && isSaved(name)) await handOff($, name)

    return next(pass)
  })

  // Claude's turn is over. A draft laid out on the graph is done with it: the project can be edited, and its board
  // takes the keyboard. One still awaited stays so where the turn ended on a question (the answer goes in the
  // prompt); given up with Escape, it is over. From a clock callback: the pane is not opened inside this hook.
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

  // The summary that takes the conversation's place does not hold the project as Claude read it: a change made by hand
  // after it is not said against it, Claude reads again. A `precompute` installs no summary (API-NOTES S15). A cleared
  // conversation, and the one a resume leaves, hold nothing of any project.
  on('session.compact', async ($, e, next) => {
    const answer = await next(e)
    if (e.trigger !== 'precompute' && e.agentId === undefined && answer.skip === undefined) forgetSeenProjects()

    return answer
  })
  on('session.end', { reason: ['clear', 'resume'] }, async ($, e, next) => {
    forgetConversation()

    return next(e)
  })

  // The project tool. Every edit is made by src/project/chat.ts on the mod's own
  // state, so the graph redraws from the atoms and nothing unchecked is saved.
  on('tool.call', { tool: TOOL_FULL_NAME }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const action = input.action
    if (action !== 'read' && action !== 'apply' && action !== 'write' && action !== 'attach') return { deny: 'action must be one of read, apply, write, attach' }

    // Text typed into a field and not sent is the person's edit: saved first, so Claude reads it, and an edit made
    // without having read it is refused as stale (below) instead of writing over it.
    await flushDrafts($)
    const ui = await read($, uiAtom)
    const asked = typeof input.name === 'string' && input.name.trim() !== '' ? projectName(input.name) : null
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
    if (project === null) {
      if (isSaved(name) && (await $.fs.exists(path))) {
        const parsed = parseProject(await $.fs.read(path).catch(() => ''))
        if (!parsed.ok) return { deny: `${PROJECT_DIR}/${name}.json is not a valid project (${parsed.error}). Nothing was changed.` }
        project = parsed.project
      } else if (action === 'read' || !isSaved(name)) {
        return { deny: `No project named ${name}. An apply or write with that name starts it.` }
      } else project = emptyProject(name)
    }
    const locked = (await read($, runProjectAtom)) === name && (await read($, runAtom)).status === 'running'
    if (action === 'read') {
      // What Claude has now is the board as it stands: the revision it names is the one to compare against later.
      sawProject(name, project)

      return { result: readReport(project, { open: isOpen, selectedId: isOpen ? ui.selectedId : null, locked, revision: revisions[name] ?? 0 }) }
    }
    // The lock the board applies to the person's own edits. An attach is past it: the project is this run's own drawing.
    if (locked && action !== 'attach') return { deny: `Project ${name} is being run: editing is locked until the run ends, for the board and for you alike. Nothing was changed.` }

    // An edit made from memory of a board that has since changed by hand would undo the person's work.
    const known = seenByClaude[name]
    if (known !== undefined && known !== (revisions[name] ?? 0)) {
      return { deny: `The user changed project ${name} on the board by hand since you last read it (it is now revision ${revisions[name] ?? 0}, you saw ${known}), so this edit was made from a board that is gone. Nothing was changed.` }
    }
    // A whole tree written over a project Claude has not seen in this conversation would replace the person's work unread
    // (a draft Claude named as a project that exists). An attach is guarded above; a project with no block yet is free.
    if (action === 'write' && known === undefined && !isBlank(project)) {
      return { deny: `A project named ${name} exists and you have not read it in this conversation, so a write would replace it unseen. Nothing was changed. A name no project has is free to use.` }
    }
    const edit = action === 'apply' ? applyOps(project, input.ops) : replaceProject(project, input.nodes)
    if (!edit.ok) return { deny: edit.error }
    try {
      if (isSaved(name)) await $.fs.write(path, serializeProject(edit.project))
    } catch (error) {
      return { deny: `Project ${name} could not be saved, nothing was changed: ${reason(error)}` }
    }
    // The script the run is of goes beside the project: the next handoff updates that file.
    const scriptKept = ran === null || (await keepScript($, ran.path, scriptFile(root, name)))
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
    // The draft the splash waited for: a new project, laid out on the graph block by block from its start block (the
    // ticker that moved the splash goes on, and shows more of it with each beat). Any other edit made while the splash
    // waited (an existing project changed, as the person's own words asked) is shown as edits are.
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
    // Shown, but the keyboard stays where the person is typing. A draft the person asked for is theirs to review next:
    // it waits on the board for their approval, and the board takes the keyboard once Claude's turn is over (`endDraft`),
    // at once where no splash waited for it.
    const offered = action === 'write' && takeOffered()
    if (offered || drafted) offerDrafted(name)
    const opened = await $.ui.open(paneArgs(offered && !drafted)).catch(() => undefined)
    if (offered && !drafted) settleRing($)
    $.clock.after(FLASH_CLEAR_MS, () => {
      void update($, uiAtom, held => clearFlash(held, seq))
    })
    // A project that was not on the board, in a terminal too narrow for the pane to open unasked: nothing shows, so Claude says the way in.
    const report = editReport(edit.project, edit, revisions[name] ?? 0)

    const notes = [
      ...(ran === null ? [] : [attachNote(edit.project, unplaced ?? [])]),
      ...(scriptKept ? [] : [`Note: the run's script could not be copied to ${PROJECT_DIR}/${name}.workflow.js.`]),
      ...((!isOpen || ran !== null) && opened?.isPlaced === false ? [unplacedNote(name)] : []),
    ]

    return { result: [report, ...notes].join('\n') }
  })

  // The project file written with the built-in tools: the open board follows it,
  // and keeps the last good project when the file no longer reads as one.
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
    const ui = await read($, uiAtom)
    if (answer.deny !== undefined || answer.isError === true || ui.name !== name || ui.status === 'closed') return answer
    const parsed = parseProject(await $.fs.read(projectFile(root, name)).catch(() => ''))
    if (!parsed.ok) {
      $.ui.toast(`conductor: ${name}.json is not a valid project (${cutCells(oneLine(parsed.error), 80)}); the board keeps the last good one`)

      return answer
    }
    const before = ui.status === 'ready' ? await read($, projectAtom) : null
    const change = diffProjects(before, parsed.project)
    if (before !== null && JSON.stringify(before) !== JSON.stringify(parsed.project)) record(name, before, `the file ${changeWords(change) || 'changed'}`)
    sawProject(name, parsed.project)
    await update($, projectAtom, () => parsed.project)
    await update($, uiAtom, held => showEdit(held, name, parsed.project, change))
    const seq = (await read($, uiAtom)).flash?.seq ?? 0
    $.clock.after(FLASH_CLEAR_MS, () => {
      void update($, uiAtom, held => clearFlash(held, seq))
    })

    return answer
  })

  on('ui.message', { requestId: PROJECT_PANE_ID, element: CANVAS_KEY }, async ($, e, next) => {
    const message = parseGraphMessage(e.data)
    if (!message) return next(e)

    // A key the graph itself was given: the same as typed into the catcher. It held the keyboard, so the click before
    // it was not heard of (two posts in a frame can drop one): the pane takes the keys back first, as after a click.
    if (message.kind === 'key') {
      if (!(await read($, uiAtom)).handed) await retake($, false)
      queueKeys($, [message.key])

      return {}
    }
    // A click on the graph is a way out of a field: what was typed there is saved first.
    const flushed = await flushDrafts($)
    const project = await read($, projectAtom)
    const ui = await read($, uiAtom)
    const context = await runContext($)
    const step = applyMessage(project, ui, message, context)
    const nextUi = await store($, step, project)
    // Writing the atoms redraws the pane, which hands the graph its next props.
    if (step.project !== project) await update($, projectAtom, () => step.project)
    if (nextUi !== ui) await update($, uiAtom, () => nextUi)
    await keepSaid($, flushed)
    // A `[+]` needs its filter to type in. (So does a list the click left open: the catcher is not drawn under it.)
    await retake($, nextUi.picker !== null && !context.locked)

    return {}
  })

  // The wheel. The pane's tree is as tall as its body, so the engine has nothing to scroll: over the graph's rows the
  // ticks are the graph's, which pans by them (the Client takes the sum from its props). Anywhere else, and for the
  // scroll keys, the move is the engine's.
  on('ui.scroll', { requestId: PROJECT_PANE_ID }, async ($, e, next) => {
    const at = e.pointer
    const area = graphArea
    if (e.origin.kind !== 'person' || at === undefined || area === null) return next(e)
    if (at.row < area.top || at.row >= area.top + area.rows || at.column < area.left || at.column >= area.left + area.columns) return next(e)
    wheelRows += e.by
    $.ui.invalidate('ui.render')

    return {}
  })

  // Where the ring is. The person's arrows (Up, Down) and Tab walk it over every stop: a move that lands on anything
  // that is not a field (the block picker's row, the engine's own stop on the pane's close mark, where Enter would close
  // the pane) is followed at once by the mod's own move back to the catcher. A move cannot be sent elsewhere in the
  // chain: the engine refuses an element where the person's move named none. In a list (the start screen, the add
  // list) the move is refused instead: the ring stays where it is, so no row is lit by it, and the mark moves. The
  // ring on a field is "editing". The mod's own moves do not come here (they are settled where they are made).
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
      // From the name's field an arrow is the way out of it: the name is left as it was, and the mark stays.
      if ((before.renaming ?? null) !== null) await update($, uiAtom, held => ({ ...held, renaming: null, notice: null }))
      else await update($, uiAtom, held => ({ ...moveStartMark(held, (e.element ?? '').startsWith(START_KEY) ? 1 : -1), help: 0, deleteAsk: null }))
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
    // The ring left where it was: what was typed there is saved (an arrow to the next field, a click on the block).
    const flushed = person ? await flushDrafts($) : null
    // In the detail pane: on a field, or on the way to one (the door, a field at rest).
    const rest = stray ? null : restBase(e.element)
    const inDetail = !stray && !leaves && (isField(e.element) || door || rest !== null)
    const held = await read($, uiAtom)
    if (held.status === 'ready' && held.editing !== inDetail && (inDetail || person)) await update($, uiAtom, ui => ({ ...ui, editing: inDetail, freshId: inDetail ? ui.freshId : null }))
    // The person's Down arrow from the catcher: the fields open, and the ring goes on to the first. (A field at rest it came to rest on: that field.)
    if ((door && !leaves) || rest !== null) await openFields($, rest ?? undefined)
    await keepSaid($, flushed)
    // The legend and the detail pane's last rows name the keys of where the ring is.
    $.ui.invalidate('ui.render')

    return moved
  })

  // The pane is closed (the person's mark or chord, an unload): what was typed into a field goes into the project first.
  on('ui.close', { id: PROJECT_PANE_ID }, async ($, e, next) => {
    await flushDrafts($)

    return next(e)
  })

  // A letter typed while the pane takes the keyboard back after a click on the graph (`landing`), with the ring not yet
  // on the catcher: the engine gave it to the prompt box, and the keyboard with it. Seen from here it is one character
  // typed into an empty box (the matcher: no other typing in the prompt comes this way). It is not let into the box:
  // it is the key it was meant as, and the pane takes the keyboard again (from a clock callback: inside this hook the
  // take is refused).
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

  on('ui.render', { component: 'Pane', requestId: PROJECT_PANE_ID }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : null
    // The terminal draws no picture (its table's `Svg` is a fragment: nothing): there the header's persona is blocks of a font, elsewhere one picture.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const ui = await read($, uiAtom)
    const project = await read($, projectAtom)
    const file = `${PROJECT_DIR}/${ui.name}.json`
    const bodyColumns = e.props.bodyColumns || 80
    const columns = Math.max(20, bodyColumns - 2)
    // The header's persona stands at its left: the name's row has the rest.
    const headColumns = columns - SMALL_W
    // The run laid over this project, when it was started from it.
    const run = await read($, runAtom)
    const runProject = await read($, runProjectAtom)
    const over = overlaysProject(run, runProject, ui)
    // Claude's draft being laid out locks the project as a run does.
    const locked = (over && run.status === 'running') || ui.drafting === 'show'
    // The tick clock is read only while it matters, so an idle pane is not redrawn by it.
    const clock = locked ? await read($, clockAtom) : 0
    const overlay = over ? runOverlay(run, clock) : undefined
    // The header's persona: a gesture it was asked for, else what the run laid over the project calls for, else at rest.
    const asked = await read($, personaAtom)
    const draftBeats = (ui.drafting ?? null) !== null ? await read($, draftBeatAtom) : 0
    const pose: Pose = ui.drafting === 'show' ? draftPose(draftBeats) : asked !== 'idle' ? asked : ((over ? runPose(run.status, clock) : null) ?? 'idle')
    const splashed = await read($, splashedAtom)
    const dock = e.props.placement !== 'inline'
    // Docked and wide the graph and the detail pane stand side by side; otherwise the same parts are one column.
    const wide = dock && bodyColumns >= WIDE_MIN_COLUMNS
    // Whether the pane holds the keyboard: Escape hands it to the prompt, and a field left open then is closed to the eye.
    const focused = e.props.isFocused !== false
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 48
    const node = project === null || ui.selectedId === null ? undefined : findNode(project, ui.selectedId)
    const problems = project ? lint(project) : []
    // The start screen: no project is open yet, one of its rows is marked.
    const starting = ui.status === 'pick' || (ui.status === 'ready' && !project)
    const entries = starting ? startEntries(ui.saved ?? []) : []
    const mark = Math.max(0, Math.min(entries.length - 1, ui.startMark ?? 0))
    const marked = entries[mark]

    // Row 1: the project's name, what state it is in, the agents it starts. Every part is cut to its room, so the row never wraps.
    const drafting = ui.drafting === 'show' && project !== null
    // The list of projects, opened from one: the start screen, with the way back.
    const listing = starting && (ui.back ?? null) !== null
    const summary = over ? runSummary(run, elapsedOf(await read($, timesAtom), run), Math.max(8, headColumns - COMMAND.length - 3 - 10 - 3)) : null
    const begins = listing ? 'PROJECTS' : 'START'
    const state: { text: string; color: 'claude' | 'success' | 'error' | typeof FADED } =
      summary !== null
        ? { text: summary.text.replace(/^[a-z]+/, word => word.toUpperCase()), color: summary.color }
        : drafting
          ? { text: 'DRAFTING', color: 'claude' }
          : starting && marked
            ? { text: `${begins} · ${marked.kind === 'saved' ? 'saved project' : marked.kind === 'blank' ? 'blank project' : marked.kind === 'replay' ? `replay over the ${marked.title} template` : marked.kind === 'recording' ? 'recorded run' : marked.kind === 'reset' ? 'stored answers' : `from the ${marked.title} template`}`, color: FADED }
            : ui.status !== 'ready' || !project
              ? { text: 'project', color: FADED }
              : { text: `EDITING · ${!isSaved(ui.name) ? 'replay, not saved' : !ui.unsaved ? 'saved' : isBlank(project) ? 'not saved yet' : 'unsaved template'}`, color: FADED }
    // On the start screen the name is the one the marked row opens: the saved project's, or the one a new project gets.
    const shownName = oneLine(starting && marked?.kind === 'saved' ? marked.id : ui.name)
    // The name is pressed for the list of projects, and there for the way back: the mark after it says which.
    const pressable = listing || !starting
    const nameMark = !pressable ? '' : listing ? ' ▴' : ' ▾'
    // One row of keys, on the header's second row and on the detail pane's last rows: each key in brackets in the accent colour, its word dim; all of it dim while the keys are in the prompt.
    const legendRow = (row: readonly LegendItem[]) => (
      <Text wrap="truncate-end">
        {row.flatMap((item, index) => [
          <Text color={focused ? 'claude' : FADED}>{`${index > 0 ? ' '.repeat(LEGEND_GAP) : ''}[${item.keys}]`}</Text>,
          <Text color={FADED}>{` ${item.word}`}</Text>,
        ])}
      </Text>
    )
    // The header's two rows. After the name its state, quiet, then in a colour of its own the project's facts (the agents
    // it starts). Short of room the facts go first, then the state; the name keeps eight cells at the least.
    // Row 2 is the legend: one row, and what does not fit is left to the help pages.
    const headOf = (facts: string | null, keys: readonly LegendItem[] = []) => {
      const room = headColumns - COMMAND.length - 3 - nameMark.length
      const said = room - cellWidth(state.text) - 3 >= 8 ? state : null
      const left = room - (said === null ? 0 : cellWidth(said.text) + 3)
      const count = said !== null && facts !== null && left - cellWidth(facts) - 3 >= 8 ? facts : null
      const name = <Text bold color={TEXT}>{clip(shownName, Math.max(8, left - (count === null ? 0 : cellWidth(count) + 3)))}</Text>
      return [
        <Box flexDirection="row" height={1} flexShrink={0}>
          <Text bold color="claude">{COMMAND}</Text>
          <Text color={FADED}>{' / '}</Text>
          {pressable ? (
            <Button key={NAME_BUTTON_KEY} plain onPress={() => queueKeys($, ['p'])}>
              {name}
              <Text color={focused ? 'claude' : FADED}>{nameMark}</Text>
            </Button>
          ) : (
            name
          )}
          {said !== null && <Text color={FADED}>{' / '}</Text>}
          {said !== null && <Text key="project-state" color={said.color}>{said.text}</Text>}
          {count !== null && <Text color={FADED}>{' / '}</Text>}
          {count !== null && <Text key="project-facts" color="suggestion">{count}</Text>}
        </Box>,
        <Box key="project-legend" flexDirection="row" height={1} flexShrink={0}>
          {keys.length > 0 ? legendRow(legendRows(keys, headColumns, 1)[0] ?? []) : <Text color={TEXT}> </Text>}
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

    if (ui.status === 'error' && ui.drafting !== 'wait') {
      return (
        <Box flexDirection="column" paddingLeft={1}>
          {headOf(null, [{ keys: 'p', word: 'Projects', core: true }])}
          <Text color="error">{oneLine(`${file} could not be used: ${ui.error ?? 'unknown reason'}`)}</Text>
          <Text color={FADED}>{`The file was left as it is. Fix or remove it, then run /${COMMAND} again.`}</Text>
        </Box>
      )
    }

    // What the screen is made of, the same for the start screen and the designer: rows of the detail pane, the
    // legend, the footer, and the frame that holds them.
    /**
     * A part of the detail pane. `wide`: it indents itself, where the others are indented by the pane (an open field,
     * whose Input needs the pane's full width: S16). `keep`: its last row stays in view when the rows do not hold all.
     */
    type Item = { rows: number; el: RenderChildren; wide?: true; keep?: true }
    type Tint = typeof FADED | 'error' | 'warning' | 'suggestion'
    const blank: Item = { rows: 1, el: <Text color={TEXT}> </Text> }
    // The persona's pixels: blocks in its own colours, a row of spans to a row of cells.
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
    /** The first of `levels` plans that fits `rows`; the last one where none does. */
    const fit = (levels: number, rows: number, plan: (level: number) => Item[]): Item[] => {
      for (let level = 0; level < levels - 1; level++) {
        const items = plan(level)
        if (rowsOf(items) <= rows) return items
      }
      return plan(levels - 1)
    }
    // A rule across the pane: under the header and above the footer; stacked, between the graph and the detail pane too.
    const rule = () => <Text color={RULE}>{'─'.repeat(columns)}</Text>
    // The pane's last row: the keys that ask something of Claude or put a run away, as buttons, centred. One row always,
    // blank where there is none to press (the start screen), so the pane keeps its shape. One that cannot be pressed now is dim.
    const actionsOf = (actions: readonly LegendAction[]) => (
      <Box key="project-actions" flexDirection="row" justifyContent="center" height={1} flexShrink={0}>
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
                <Button key={`${ACT_KEY}${action.key}`} plain onPress={() => queueKeys($, [action.key])}>
                  {label}
                </Button>
              </Box>
            ) : (
              label
            ),
          ]
        })}
      </Box>
    )
    // The rows. Header, rules and footer keep theirs; the graph and the detail pane share the rest. Docked, a rule
    // stands under the header and one above the footer, and `stacked` (the detail pane under the graph) one between the two.
    // Inline the rows are few: no rule, what is said has the row over the buttons, and the pane never asks for more rows than it has (it would scroll, and the header leave).
    const footRows = dock ? 1 : 2
    const mainRowsFor = (stacked: boolean): number => Math.max(wide ? GRAPH_LEAST_ROWS + 2 : dock ? HINT_ROWS + 1 : 2, bodyRows - HEAD_ROWS - (dock ? 2 : 0) - (stacked ? 1 : 0) - footRows)
    // The key catcher, the ring's place while no field is open: in the tree, where it is the pane's first stop, and not drawn.
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
    // What is said (a change and its way back, a refusal, where the keys are), on one row, centred. Docked it stands in
    // the rule over the footer, so nothing moves when something is said; inline it has the row over the keys.
    type Said = { text: string; color: 'warning' | typeof FADED | undefined } | null
    const saidW = Math.max(1, columns - (dock ? 2 * (SAID_RULE_W + 1) : 0))
    const saidRow = (said: Said) => {
      // What is said may name a block: its name is the project file's.
      const text = said === null ? '' : clip(oneLine(said.text), saidW)
      if (!dock) {
        return (
          <Box key="project-message" flexDirection="column" alignItems="center" height={1}>
            <Text color={said?.color ?? TEXT} wrap="truncate-end">{text === '' ? ' ' : text}</Text>
          </Box>
        )
      }
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
    // The keys that act on the detail pane, for its last rows: two rows docked, one inline or where the pane is short.
    const hintsOf = (items: readonly LegendItem[], width: number, rows: number): LegendItem[][] => legendRows(items, width, dock && rows >= 8 ? HINT_ROWS : 1)
    // The detail pane: its content, and on its last rows the keys that act on it.
    // It is as wide as the pane, and its rows are indented by `left` cells: beside the graph those are the graph's, which
    // is laid over them; under it there are none. So a field typed in has the pane's full width, the one width the
    // engine wraps it at (S16). Taller than its rows, it is moved up until the `keep` item (the field typed in) ends in view.
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
    // One column of margin at each side: `columns` is the body's less the two. The margin is each part's own, not the
    // frame's, which would take the pane's full width from the detail pane. Beside the graph the detail pane has the
    // main rows to itself and the graph is laid over its left. `detail` is null while the detail pane is hidden.
    const margin = (children: RenderChildren) => <Box flexDirection="column" paddingLeft={1} paddingRight={1}>{children}</Box>
    const frame = (catching: boolean, head: RenderChildren, graph: RenderChildren, detail: RenderChildren | null, beside: boolean, mainRows: number, said: Said, actions: RenderChildren) => (
      <Box flexDirection="column" position="relative">
        <Box flexDirection="row" paddingLeft={1} paddingRight={1}>
          <Box key="project-persona" flexDirection="column" width={SMALL_W} flexShrink={0}>
            {Svg ? <Svg source={smallPersonaSvg(pose)} alt={`the conductor, ${pose}`} width={SMALL_SVG_W} height={SMALL_SVG_H} /> : spanRows(smallPersona(pose))}
          </Box>
          <Box flexDirection="column" width={headColumns} height={HEAD_ROWS} flexShrink={0}>
            {head}
          </Box>
        </Box>
        {/* After the header: the name there is a stop before the catcher, so the Down arrow still goes from the catcher to the detail pane. */}
        {catching && catcher()}
        {dock && margin(rule())}
        {beside ? (
          <Box flexDirection="column" height={mainRows}>
            {detail}
          </Box>
        ) : (
          <Box flexDirection="column">
            {margin(graph)}
            {dock && detail !== null && margin(rule())}
            {detail}
          </Box>
        )}
        {margin([saidRow(said), actions])}
        {beside && (
          <Box position="absolute" top={HEAD_ROWS + (dock ? 1 : 0)} left={1} flexDirection="row" height={mainRows}>
            {graph}
            <Box width={3} flexShrink={0}>
              <Text color={RULE}>{Array.from({ length: mainRows }, () => ' │ ').join('\n')}</Text>
            </Box>
          </Box>
        )}
      </Box>
    )
    // A help page as rows: its title and which page it is, then paragraphs, or a table whose first column is the key.
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
        {rows < 1 ? null : 'Client' in els ? <els.Client key={CANVAS_KEY} module="./canvas.tsx" width="100%" height={rows} props={props as never} /> : fallback}
      </Box>
    )

    // The splash, once a session: the conductor and its ensemble for a few beats, then the screen below. The keys wait
    // for that screen: no catcher is drawn under the splash. A pane too short for it goes without. While a draft is
    // awaited it is shown again, on the beats counted here, for as long as the wait lasts: the project has no name yet.
    const waiting = ui.drafting === 'wait'
    if (waiting || !splashed) {
      if (!waiting) startSplash($)
      const sceneRows = columns >= SCENE_COLUMNS && bodyRows >= SCENE_ROWS + 3 ? SCENE_ROWS : SOLO_ROWS
      if (bodyRows >= sceneRows + 3) {
        // The name as pixels where it fits under the scene; the plain word where it does not.
        const drawn = wordmark()
        const mark = columns >= drawn.width + 2 && bodyRows >= sceneRows + drawn.lines.length + 3 ? drawn : null
        return (
          <Box flexDirection="column" paddingLeft={1} paddingRight={1} height={dock ? bodyRows : undefined} justifyContent="center">
            <Box key="project-splash" flexDirection="column" alignItems="center" height={sceneRows} flexShrink={0}>
              {'Client' in els ? <els.Client key={SPLASH_KEY} module="./splash.tsx" width="100%" height={sceneRows} props={(waiting ? { rows: sceneRows, beat: draftBeats } : { rows: sceneRows }) as never} /> : spanRows((waiting ? waitScene(draftBeats, columns, sceneRows) : splashScene(2, columns, sceneRows)).lines)}
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
      // Too short for the scene: the wait is said all the same.
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
      const beside = wide
      const detailW = beside ? detailWidth(columns) : columns
      const graphW = beside ? columns - detailW - 3 : columns
      // The marked row's project, read-only: a saved one from its file (kept from the listing, read again after a reload), a template made anew.
      let shown: Project | null = null
      if (marked?.kind === 'saved') {
        if (previews[marked.id] === undefined) {
          const parsed = parseProject(await $.fs.read(projectFile(await $.session.root(), marked.id)).catch(() => ''))
          previews[marked.id] = parsed.ok ? parsed.project : null
        }
        shown = previews[marked.id] ?? null
      } else if (marked && marked.kind !== 'recording' && marked.kind !== 'reset') shown = TEMPLATES.find(one => one.id === marked.id)?.make() ?? emptyProject(ui.name)
      const mainRows = mainRowsFor(dock && !wide)
      // The keys: the list's on the detail pane's last rows, the rest in the header.
      // A name is typed in its field only while the pane holds the keyboard: Escape hands the keys to the prompt, and the field is closed to the eye.
      const renaming = Input !== null && focused ? (ui.renaming ?? null) : null
      const keys = legendItems({ ring: 'start', placed: false, retype: false, empty: true, helping, locked: false, selected: false, container: false, nested: false, results: false, undo: false, redo: false, hidden: false, back: listing, saved: marked?.kind === 'saved', renaming: renaming !== null })
      const message = focused ? ui.notice : KEYS_CUE

      // The list: the saved projects, then the templates, one row each, the marked one said in `claude`.
      const nameW = Math.min(Math.max(...entries.map(one => cellWidth(oneLine(one.title)))), Math.max(8, Math.floor(detailW / 2) - 4))
      const countW = Math.max(...entries.map(one => (isProjectEntry(one) ? blocksWord(one.blocks).length : 0)))
      const entryRow = (entry: (typeof entries)[number], at: number): Item => {
        const lit = at === mark
        // The project the list was opened from says so, and the one a run is on.
        const tags = entry.kind !== 'saved' ? [] : [...(entry.id === ui.back ? ['open'] : []), ...(entry.id === runProject && run.status === 'running' ? ['running'] : [])]
        const note = clip([...tags, ...(entry.note === '' ? [] : [oneLine(entry.note)])].join(' · '), Math.max(0, detailW - 2 - nameW - 2 - countW - 2))
        // Its name is being typed: a field in the row's place, holding the name as it is. Enter renames.
        if (Input !== null && entry.kind === 'saved' && entry.id === renaming) {
          return {
            rows: 1,
            el: (
              <Box flexDirection="row" height={1}>
                <Text color="claude" bold>{'▸ '}</Text>
                <Box width={Math.max(8, detailW - 4)}>
                  <Input key={renameKey()} placeholder="a new name" value={entry.id} submitLabel="" onSubmit={value => renameEnter($, entry.id, value)} />
                </Box>
              </Box>
            ),
          }
        }
        return {
          rows: 1,
          el: (
            <Box flexDirection="row" height={1}>
              <Button key={`${START_KEY}${entry.kind}:${entry.id}`} plain onPress={() => openEntry($, at)}>
                <Text color="claude" bold>{lit ? '▸ ' : '  '}</Text>
                <Text color={lit ? 'claude' : TEXT} bold>{padCells(clip(oneLine(entry.title), nameW), nameW)}</Text>
                <Text color={FADED}>{`  ${(isProjectEntry(entry) ? blocksWord(entry.blocks) : '').padEnd(countW)}`}</Text>
                <Text color={FADED}>{note === '' ? '' : `  ${note}`}</Text>
              </Button>
            </Box>
          ),
        }
      }
      // Claude drafts one: the command, with the name a new project gets, goes to the prompt box for the person to finish.
      const draftRow: Item = {
        rows: 1,
        el: (
          <Box flexDirection="row" height={1}>
            <Button key={`${START_KEY}draft`} plain onPress={() => request($, 'draft')}>
              <Text color="claude" bold>{DRAFT_LABEL}</Text>
            </Button>
          </Box>
        ),
      }
      const detailRows = beside ? mainRows : Math.max(Math.min(HINT_ROWS + 1, mainRows), Math.min(mainRows - Math.max(GRAPH_LEAST_ROWS, Math.floor(mainRows * (1 - DETAIL_REST_SHARE) * 0.6)), helping ? mainRows : entries.length + 8))
      const hints = hintsOf(keys.detail, detailW, detailRows)
      const contentRows = Math.max(0, detailRows - hints.length)
      // Where the rows that open no project start: the first replay.
      const extras = Math.max(saved.length, entries.findIndex(one => one.kind === 'replay'))
      const listed = fit(4, contentRows, level => {
        const gaps = level < 1 ? [blank] : []
        const ways = level < 2 ? [...gaps, draftRow] : [draftRow]
        // Short of rows, the saved projects are a window around the marked one; the templates are always all there.
        const room = level < 3 ? saved.length : Math.max(1, Math.min(SAVED_ROWS, contentRows - (entries.length - saved.length) - 5))
        const from = room >= saved.length ? 0 : listWindow(saved.length, room, Math.min(mark, saved.length - 1))
        const more = saved.length - Math.min(room, saved.length)
        // Past the cap none is listed: said where the list is cut.
        const cut = savedPast > 0 ? `${savedPast} more not listed: the list holds ${SAVED_MAX}` : ''
        return [
          ...(saved.length > 0 ? [label('Saved projects'), ...entries.slice(from, from + Math.min(room, saved.length)).map((entry, index) => entryRow(entry, from + index)), ...(more > 0 ? [line(`… ${more} more: w and s reach them${cut === '' ? '' : ` · ${cut}`}`, FADED)] : cut === '' ? [] : [line(`… ${cut}`, FADED)]), ...gaps] : []),
          label('New from a template'),
          ...entries.slice(saved.length, extras).map((entry, index) => entryRow(entry, saved.length + index)),
          ...ways,
          // Under every way to a project: the replays, and last the row that forgets the stored answers.
          ...gaps,
          label('Replay a run'),
          ...entries.slice(extras, -1).map((entry, index) => entryRow(entry, extras + index)),
          ...entries.slice(-1).map(entry => entryRow(entry, entries.length - 1)),
        ]
      })
      const content = helping ? helpItems(ui.help, undefined, detailW, contentRows, true) : listed

      const box: GraphBox = { columns: graphW, rows: Math.max(1, beside ? mainRows : mainRows - detailRows) }
      const graphRows = beside ? mainRows : mainRows - detailRows
      graphBox = box
      // Above it: the header's rows, and docked the rule under them.
      graphArea = graphRows < 1 || !('Client' in els) ? null : { top: HEAD_ROWS + (dock ? 1 : 0), left: 1, columns: graphW, rows: graphRows }
      drawnCatcher = Input !== null ? catcherKey() : ''
      fieldsDrawn = false
      const stops = [ui.status, ui.name, saved.length, helping, listing, renaming ?? ''].join('|')
      if (stops !== ringStops) {
        ringStops = stops
        if (focused) settleRing($)
      }
      const preview = graphBoxOf(graphW, graphRows, shown ? { ...previewProps(shown, box), wheel: { from: LOAD, rows: wheelRows } } : null, null)
      return frame(
        true,
        // The agents the marked row's project starts, where it has blocks to count.
        headOf(shown !== null && !isBlank(shown) ? factsLine(shown) : null, keys.header),
        shown ? preview : <Box key="project-graph" width={graphW} height={graphRows} flexShrink={0} />,
        detailBox(detailRows, hints, content, beside ? 1 + graphW + 3 : 0),
        beside,
        mainRows,
        message === null ? null : { text: message, color: focused ? 'warning' : FADED },
        actionsOf(keys.actions),
      )
    }
    if (!project) return <Box />

    // What takes the detail pane in place of the selected block: the add list (a block to add, or a block's type),
    // a help page. The first is the pane's only while it holds the keyboard: Escape hands the keys
    // to the prompt and no hook hears of it, so drawn without it they are closed to the eye.
    const picking = ui.picker !== null && !locked && focused
    const helping = !picking && ui.help > 0
    // While Claude's draft is laid out the graph has the pane's width: there is nothing to edit yet.
    const hidden = (ui.detailHidden === true || drafting) && !picking && !helping

    // The widths. Beside the graph the detail pane has about a third, and one column of rule stands between them.
    const beside = wide && !hidden
    const detailW = beside ? detailWidth(columns) : columns
    const graphW = beside ? columns - detailW - 3 : columns
    // The cells before the detail pane's first: beside the graph its margin, the graph and the rule; under it none.
    const detailLeft = beside ? 1 + graphW + 3 : 0
    // The width the engine wraps a field at: the cells from there to the pane's edge, less the four it keeps for its Enter mark (S16).
    const fieldW = Math.max(1, columns + 2 - detailLeft - 4)
    // The view follows the selection where something other than the person's keys moved it out of sight.
    const viewRoot = viewRootOf(project, ui, graphW)

    // The keys that work now, in their fixed order: the graph's on the header's second row, the detail pane's on its last rows.
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
    })

    // What is said on the message row: a change just made (with the way back), a refused edit, the delete question, the lock.
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
        : afterCue !== null && /^(run|ask|draft): /.test(afterCue)
          ? `${KEYS_CUE.split(' · ')[0] ?? KEYS_CUE} · ${afterCue}`
          : KEYS_CUE
    const message: Said = focused ? said : { text: cue, color: FADED }
    const mainRows = mainRowsFor(dock && !wide && !hidden)

    // The fields this block's type calls for (teach.ts says which), in the detail pane's order: the knobs typed as text.
    const parent = node ? flatten(project).find(row => row.node.id === node.id)?.parentId : undefined
    const around = parent === undefined ? undefined : findNode(project, parent)
    const knobs = node ? knobsOf(node, around?.type) : []
    const textKnobs = TEXT_KNOBS.filter(key => knobs.includes(key))
    // A field shows what is being typed in it (a draft) until it is saved: only the block, of the project, it was typed for.
    const typed = (key: string, saved: string): string => (node && drafts.id === node.id && drafts.name === ui.name ? (drafts.values[key] ?? saved) : saved)
    // Drafts and the keyboard, as this drawing finds them. Text typed and not saved is saved as soon as a drawing sees
    // that its field can no longer be typed in: the pane lost the keyboard (Escape, which no hook hears; a chat turn),
    // the pane changed shape (a resize moves it between dock and inline and takes the keys), another block is shown.
    const shape = `${dock ? 'dock' : 'inline'}/${columns}`
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
          // The start block is named for what it is: its fields are the goal and the args.
          ...(hasName(node) ? [{ key: NAME_KEY, knob: 'name', label: FIELD_LABEL.name, value: typed(NAME_KEY, ui.freshId === node.id ? '' : node.name), placeholder: node.name }] : []),
          // A phase is its name and no more: it has a logic field only for logic it already carries.
          ...(hasLogic(node) ? [{ key: LOGIC_KEY, knob: 'logic', label: FIELD_LABEL.logic, value: typed(LOGIC_KEY, node.logic ?? ''), placeholder: placeholderOf(node, 'logic') }] : []),
          ...textKnobs.map((knob: TextKnob) => ({
            key: `${KNOB_KEY}${knob}`,
            knob,
            label: FIELD_LABEL[knob],
            value: typed(`${KNOB_KEY}${knob}`, node.knobs?.[knob] ?? ''),
            // What the empty field is for, as the block's kind says it (an arm's condition: as its branch's does).
            placeholder: placeholderOf(node, knob, around),
          })),
        ]
      : []
    const agents = over && ui.selectedId !== null ? agentsOf(run, ui.selectedId) : null
    const matches = picking && ui.picker ? pickerMatches(project, ui.picker) : []
    const marker = matches[Math.min(ui.picker?.pick ?? 0, Math.max(0, matches.length - 1))]
    const editable = node !== undefined && !locked
    // The fields are text to read until they are opened (`e`, Enter, the Down arrow, a click on one): only then are they drawn to type in.
    const fielding = editable && ui.editing && focused && !picking && !helping && Input !== null
    // The fields closed since the last drawing: the ones opened next are new ones.
    if (fieldsDrawn && !fielding) editGen++
    fieldsDrawn = fielding
    if (!fielding && Object.keys(pins).length > 0) pins = {}
    // The catcher is in the tree wherever the ring may rest on it: not with the add list, which takes its place among the stops.
    const catching = Input !== null && !picking
    drawnCatcher = catching ? catcherKey() : ''
    // The ring is kept by its place among the stops. Where this drawing's stops are not the last one's (a run ended and
    // the fields are back, the add list closed) and no field is asked for, the ring is put on the catcher.
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
    // A keystroke in a field: kept as a draft of that block's field, and the pane is drawn again, to give the field the rows its text now takes.
    const typeIn = (key: string, element: string, value: string): void => {
      if (!node) return
      // The ring is known to be elsewhere, yet a letter reached this field: it was left here by a change of the stops, or
      // Enter was just pressed here and the ring is on its way out. The letter is no text of this field: after Enter it
      // is a key; otherwise it is dropped, and the ring goes where it belongs.
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
      landOn($, pickerKey, 'block: click the filter to type in it')
    }

    // The detail pane's parts. A thin rule stands under its heading; a blank row between two fields and two sections, while there are rows for it.
    const thin: Item = { rows: 1, el: <Text color={RULE}>{'─'.repeat(detailW)}</Text> }
    /** A wrapped text cut to `most` rows, `…` on the last. */
    const capped = (rows: readonly string[], most: number): string[] => (rows.length <= most ? [...rows] : rows.slice(0, most).map((row, index) => (index === most - 1 ? `${clip(row, detailW - 1)}…` : row)))
    // The ring's field, or the one it is on its way to: the one drawn at full width, wrapped.
    const ringAt = ringTo !== '' ? ringTo : ringOn
    const activeBase = fielding && isField(ringAt) ? baseOf(ringAt ?? '') : null
    // The heading's row: the block's type and kind, which a press changes (`t` opens the same list), and at the right the id.
    // The door stands at its right end: two cells, empty, seen only for the moment the ring is on it. It is first in
    // the tree (the row runs backward), so the Down arrow from the catcher lands on it and not on the type.
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
                  {/* The block is picked from the same list one is added from: every block and kind on a row with what it does. */}
                  {/* The start block has no type to pick: it becomes no other block. */}
                  {editable && node.type !== 'start' ? (
                    <Button key={TYPE_KEY} plain onPress={() => retype(node)}>
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
    // A field a problem is about, while it is empty, is marked on its label: the pane says no more of the problem.
    const required = (one: (typeof texts)[number]) => (one.value.trim() === '' && named.has(one.knob) ? [<Text color="error">{' [Required]'}</Text>] : [])
    const fieldLabel = (one: (typeof texts)[number]) => (
      <Text wrap="truncate-end">
        <Text color="suggestion">{cap(one.label)}</Text>
        {required(one)}
      </Text>
    )
    // A field at rest: its label, then all of its value, wrapped. One press anywhere on it opens the fields on this one.
    const restField = (one: (typeof texts)[number], most: number): Item => {
      const value = oneLine(one.value)
      const rows = value === '' ? [] : capped(wrapText(value, detailW), most)
      const lost = value === '' && named.has(one.knob)
      const body = value === '' ? [<Text color={lost ? 'error' : FADED}>{NOT_SET}</Text>] : rows.flatMap((row, index) => (index === 0 ? [<Text color={TEXT}>{row}</Text>] : ['\n', <Text color={TEXT}>{row}</Text>]))
      return {
        rows: 1 + Math.max(1, rows.length),
        el: (
          <Box flexDirection="column" flexShrink={0}>
            <Button key={`${REST_KEY}${fieldKey(one.key, node?.id ?? '')}`} plain onPress={() => openFields($, one.key)}>
              {[<Text color="suggestion">{cap(one.label)}</Text>, ...required(one), '\n', ...body]}
            </Button>
          </Box>
        ),
      }
    }
    // A field open for typing, under its label. The ring's own is drawn at the pane's full width, where the engine wraps
    // it (S16), behind a label of spaces as wide as the indent: the engine ends a label with `: `, which the rule
    // beside the graph covers. With no indent it has no label. The others stand in the column, one line each, cut.
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
    // What Claude set and the pane has no control for, read only: the worktree, the subagent it runs as.
    const setItems: Item[] = node
      ? [
          ...(node.knobs?.isolation === 'worktree' ? [line(`${'Isolation'.padEnd(PICKER_LABEL_W)}worktree`, FADED)] : []),
          ...((node.knobs?.agentType ?? '') !== '' ? [line(clip(`${'Agent type'.padEnd(PICKER_LABEL_W)}${oneLine(node.knobs?.agentType ?? '')}`, detailW), FADED)] : []),
        ]
      : []
    // The selected block's agents, while a run is laid over the project.
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
              {`${agent.status === 'failed' ? FAILED : agent.status === 'running' ? GLYPH.dot : GLYPH.done} ${oneLine(agent.title)}  ${agent.status} · ${fmtTokens(agent.tokens)}`}
            </Text>
          ),
        })),
        ...(shown.length < all ? [line(`… ${all - shown.length} more`, FADED)] : []),
      ]
    }
    // The selected block, as far as the rows go. With all of them: a blank row between two sections, every text whole.
    // Short of rows, the blank rows go first; then what the type means (the help page says it); then the long texts
    // are cut, to fewer rows each time. An open field is never cut: the ring's own has all its rows, the others one.
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

    // The add list. As it opens: every block on a row, name and hint, in two groups; a block that has kinds says so
    // (`▸`) and opens on them. With something typed, or a block opened: a row per block and kind, named in full
    // (`AGENT verify`). The marked row opens to all of its hint and when to use it, and a block to the kinds it has.
    const rowName = (row: PickRow): string => (row.opens ? `${row.type} ▸` : pickName(row))
    const NAME_W = Math.max(...matches.map(row => rowName(row).length), 0) + 2
    const typeRow = (row: PickRow, opened: boolean): Item => {
      const lit = row === marker
      // A block's own row says what the block is; a row of one of its kinds what that kind is.
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
            <Button key={`pick:${row.type}:${row.opens ? '+' : (row.kind ?? '')}`} plain onPress={() => pick($, row)}>
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

    // Nothing selected: the project's goal, and how to go on.
    const goal = goalOf(project)
    const idle = (): Item[] => [
      label('Goal'),
      ...lines(wrapText(goal === '' ? 'Not said yet.' : sanitize(goal), detailW).slice(0, 6), goal === '' ? FADED : undefined),
      // While Claude drafts, the graph says so, once.
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

    // The detail pane's rows. Beside the graph it has all of them. Under it, it has a fixed share at rest, so nothing
    // shifts with the selection; while a field, the add list or a help page is open it takes what that needs.
    // Hidden, it has none: the graph has them all.
    const openNeed = picking ? rowsOf(addList(0)) : helping ? rowsOf(helpItems(ui.help, node, detailW, 99, false)) : rowsOf(inspector(0))
    // Inline, at rest, it is its last row alone: the keys that open it.
    const restRows = dock ? Math.max(Math.min(HINT_ROWS + 1, mainRows), Math.min(mainRows - GRAPH_LEAST_ROWS, Math.floor(mainRows * DETAIL_REST_SHARE))) : 1
    const opened = picking || helping || fielding
    const detailRows = hidden ? 0 : wide ? mainRows : opened ? Math.max(restRows, Math.min(openNeed + HINT_ROWS, mainRows - (dock ? GRAPH_LEAST_ROWS : 0))) : restRows
    const hints = hintsOf(keys.detail, detailW, detailRows)
    const contentRows = Math.max(0, detailRows - hints.length)
    // The graph's region: every row the rest leaves, whatever the graph's own height (it pans inside), so the region never changes size with the selection.
    const graphRows = Math.max(0, beside ? mainRows : mainRows - detailRows)
    const box: GraphBox = { columns: graphW, rows: Math.max(1, graphRows) }
    graphBox = box
    // Above it: the header's rows, and docked the rule under them.
    graphArea = graphRows < 1 || !('Client' in els) ? null : { top: HEAD_ROWS + (dock ? 1 : 0), left: 1, columns: graphW, rows: graphRows }

    // What the detail pane holds above the rows of its keys.
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

    // The graph's region: the one part that changes size. Inside a container opened with `o` the graph's own first row says where the view is.
    const graph = graphBoxOf(
      graphW,
      graphRows,
      // A draft being laid out: its blocks so far, and no problem marked on a project that is not all there yet.
      { ...graphProps(drafting && (ui.reveal ?? null) !== null ? firstBlocks(project, ui.reveal ?? 0) : project, ui, box, overlay), ...(drafting ? { problems: {} } : {}), wheel: { from: LOAD, rows: wheelRows }, ...(focused ? {} : { quiet: true }) },
      flatten(project)
        .slice(0, graphRows)
        .map(row => (
          <Text color={row.node.id === ui.selectedId ? 'claude' : TEXT} bold={row.node.id === ui.selectedId ? true : undefined} wrap="truncate-end">
            {`${row.node.id === ui.selectedId ? GLYPH.diamond : ' '} ${'  '.repeat(row.depth)}${TEACH[row.node.type].glyph} ${row.node.id}  ${oneLine(row.node.name)}`}
          </Text>
        )),
    )

    return frame(catching, headOf(factsLine(project), keys.header), graph, hidden ? null : detailBox(detailRows, hints, content, detailLeft), beside, mainRows, message, actionsOf(keys.actions))
  })
}
