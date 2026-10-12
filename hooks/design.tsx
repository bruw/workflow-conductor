import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderChildren } from 'claude-code'

import { FLASH_CLEAR_MS, TOOL_FULL_NAME, TOOL_NAME, TOOL_SCHEMA, applyOps, attachNote, changeWords, changedNote, clearFlash, designOfPath, diffDesigns, draftBrief, editReport, knownAfterEdit, readReport, replaceDesign, showEdit, staleNote, toolDescription, unplacedNote } from '../src/design/chat'
import { UNDO_HINT, remember, travel } from '../src/design/history'
import type { History } from '../src/design/history'
import { lint, preflightLine, problemFields, problemParts } from '../src/design/lints'
import { buildHandoff, handoffPrompt, handoffTarget, reviewPrompt } from '../src/design/handoff'
import { emptyDesign, findNode, flatten, goalOf, isBlank, kindsOf, parseDesign, serializeDesign, typeName, withGoal } from '../src/design/model'
import type { Design, DesignNode, NodeType } from '../src/design/model'
import { nextIdNumber, quickKnob } from '../src/design/ops'
import type { NodePatch } from '../src/design/ops'
import {
  AGENT_ROWS_MAX,
  DEFAULT_DESIGN_NAME,
  DESIGN_DIR,
  DESIGN_PANE_ID,
  DESIGN_PANE_TITLE,
  HANDED_NOTICE,
  HELP_PAGES,
  KEYS_CUE,
  LOCK_NOTICE,
  SCRATCH_PREFIX,
  TEXT_KNOBS,
  WIDE_MIN_COLUMNS,
  addHeading,
  agentsOf,
  applyMessage,
  applyOp,
  bareTarget,
  blocksWord,
  carryUi,
  designFile,
  designName,
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
  openDesign,
  openRetype,
  overlaysDesign,
  patchNode,
  pickBlock,
  pickerMatches,
  previewProps,
  scriptFile,
  restoreDesign,
  runOverlay,
  runSummary,
  savedDesign,
  savedLine,
  startDesign,
  startEntries,
  filterText,
  typePicker,
  viewRootOf,
  withoutKeys,
} from '../src/design/session'
import type { DesignUi, GraphBox, PickRow, RunContext, SavedDesign, Step, TextKnob } from '../src/design/session'
import { FIELD_LABEL, PALETTE_GROUPS, TEACH, fieldWord as fieldLabel, groupOf, hasLogic, hasName, knobsOf, pickName, placeholderOf, teachOf, useWhen } from '../src/design/teach'
import type { BlockRef } from '../src/design/teach'
import { TEMPLATES } from '../src/design/templates'
import { emptyRunState } from '../src/run/events'
import { replayDesignEvents } from '../src/run/replay'
import type { Tracker } from '../src/run/tracker'
import { NOT_SET, UNMAPPED_ID, canOpen, typeLabel } from '../src/ui/graph-layout'
import { parseGraphMessage } from '../src/ui/graph-model'
import { ENTER, KEY_OPS, PASTE_NOTICE, burstKeys, legendItems, legendRows, unboundNotice, LEGEND_CORE_W, LEGEND_GAP } from '../src/ui/keys'
import type { KeyOp, LegendItem } from '../src/ui/keys'
import { FAILED, fmtTokens } from '../src/ui/rail'
import { GESTURE_MS, SCENE_COLUMNS, SCENE_ROWS, SMALL_W, SOLO_ROWS, SPLASH_MS, gestureOf, runPose, smallPersona, splashScene } from '../src/ui/persona'
import type { PersonaSpan, Pose } from '../src/ui/persona'
import { clip, firstLines, wrapText } from '../src/ui/text'
import { ACCENT, FADED, GLYPH, PANE_TITLE, RULE } from '../src/ui/theme'

import { offerDrafted, offerPrompted, offerSettled, takeOffered } from './offer'

// The designer: the hooks module owns the Design and everything chosen on it
// (selection, view, add list), applies ops, saves the file and draws the screen:
// header, the graph's region, the detail pane with the keys that act on it, the
// footer with the graph's keys. The graph (./canvas.tsx) is a Client that draws
// the design from props, owns only its pan and a drag in flight, and posts
// here. Keys are typed into the key catcher: one Input, not drawn, that the ring
// rests on while no field is open; the ones that walk the graph do so over the
// layout the Client draws (`graphBox`).

const COMMAND = 'conductor'
const CANVAS_KEY = 'canvas'
/** The splash's scene (./splash.tsx): it counts its own beats. */
const SPLASH_KEY = 'splash'
/** Under the splash's scene. */
const SPLASH_NOTE = 'designed for full screen'
const NAME_KEY = 'design-name'
const LOGIC_KEY = 'design-logic'
/** The add list's filter: `design-add:<n>`, drawn under a new `n` to empty it of the keys it took. */
const PICKER_KEY = 'design-add'
const TYPE_KEY = 'design-type'
/** A field at rest, read and not typed in: `design-rest:design-notes@n5`. A press on it opens the fields on that one. */
const REST_KEY = 'design-rest:'
/** A row of the start screen: `start:saved:demo`, `start:template:review`. */
const START_KEY = 'start:'
/** Saved designs the start screen lists at once where it is short of rows: a window around the marked one. */
const SAVED_ROWS = 8
/** Design files read for a listing, at most. */
const SAVED_MAX = 60
/** The address of a knob's text field: `design-knob:prompt`. */
const KNOB_KEY = 'design-knob:'
/**
 * A block's field is addressed by the field and the block (`design-notes@n5`): the engine keeps what was typed in an
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
const firstField = (node: { type: DesignNode['type'] }): string => (hasName(node) ? NAME_KEY : `${KNOB_KEY}goal`)
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
/**
 * The block picker's label: `design-label:design-type`. A Button, so that a click on the word opens the list of blocks
 * as a click on its value does. Neither it nor the picker keeps the ring: on a Button the Left arrow is the engine's
 * (it opens the agents list, and the pane goes), so the ring rests on fields alone and `t` opens the list.
 */
const LABEL_KEY = 'design-label:'
/** The field a resting field's address stands for (`design-notes`); null for any other element. */
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
const isDetailStop = (element: string | undefined): boolean => element !== undefined && (isField(element) || isPickerField(element) || restBase(element) !== null)
/** How long after the command's answer the handoff prompt is submitted. */
export const SUBMIT_DELAY_MS = 64
/** How many times the ring is sent to an element before the field is given up. */
const LAND_TRIES = 5
/** A redraw's worth of wait before the ring moves to an element just drawn. */
export const FOCUS_DELAY_MS = 48
/** How often the prompt box is read while a request waits in it. */
export const BOX_POLL_MS = 600
/** What /conductor this module answers: its verbs, `replay design`, and no argument at all (a run shown on its design); run.tsx answers the rest. */
export const DESIGN_VERBS = /^\s*((design|run|list|draft|delete|rename)(\s|$)|replay\s+design(\s|$)|$)/
/** The header's rows: the persona's two, the name on the first. */
const HEAD_ROWS = 2
const EDIT_HINT = 'click a field of the block, or press the Down arrow to reach the name'
/** The graph's region is never asked to be shorter than this while the detail pane, under it, has rows to give. */
const GRAPH_LEAST_ROWS = 3
/** Stacked, the detail pane at rest takes this share of the rows between header and footer. */
const DETAIL_REST_SHARE = 0.45
/** The detail pane's last rows name the keys that act on it: at most this many docked, one inline or where the pane is short. */
const HINT_ROWS = 2
/** The footer's legend, docked: one row where the pane is wide enough for its keys (`LEGEND_CORE_W`), else wrapped onto this many. */
const LEGEND_WRAP_ROWS = 2
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

  return { id: DESIGN_PANE_ID, title: DESIGN_PANE_TITLE, rows: PANE_ROWS, ...(columns === undefined ? {} : { columns }), ...(focus ? { focus: true as const } : {}) }
}
/** What `r` leaves on the message row: what the design implies, then what to do with the request now in the prompt box. */
const runNotice = (design: Design | null, line: string, isFilled: boolean): string =>
  `run: ${design ? `${preflightLine(design)} · ` : ''}${isFilled ? 'finish the prompt, then Enter' : `type in the prompt: ${line.trim()} …`}`
const askNotice = (line: string, isFilled: boolean): string => (isFilled ? 'ask: the question is in the prompt · change it as you like, then Enter' : `ask: type in the prompt: ${line.trim()}`)

/**
 * Undo and redo, per design, for the session: every change to a design leaves the design before it here.
 * Module variables, not state: fifty designs are too much to store, and a drawing may read them.
 */
const histories: Record<string, History> = {}
/**
 * How many times each design changed in this load, by hand or from chat, and the count Claude last saw
 * (in a `read`, or in the answer to its own edit). When they differ the board changed by hand since.
 */
const revisions: Record<string, number> = {}
const seenByClaude: Record<string, number> = {}
/**
 * The design as Claude last saw it, kept in step with `seenByClaude`: what a prompt sent after a change by hand is
 * compared with, to say the change. None where Claude does not hold the whole design (it never read it, or the
 * conversation that held it was compacted or cleared): the prompt then says to read again.
 */
const seenDesigns: Record<string, Design> = {}
/** Claude has the design as it stands, whole: the revision it is compared against later, and the design a later change is said from. */
const sawDesign = (name: string, design: Design): void => {
  seenByClaude[name] = revisions[name] ?? 0
  seenDesigns[name] = design
}
const forgetSeenDesigns = (): void => {
  for (const name of Object.keys(seenDesigns)) delete seenDesigns[name]
}
/** The revision the model was last told is stale, so it is told once per change and not with every prompt. */
const warnedAt: Record<string, number> = {}
/** Another conversation (a /clear, a resume): Claude has seen no design in it, whole or in part, and was told of no change. */
const forgetConversation = (): void => {
  forgetSeenDesigns()
  for (const book of [seenByClaude, warnedAt]) for (const name of Object.keys(book)) delete book[name]
}
/** A change was made: it counts as a revision, and the design before it is what `u` returns to. */
const record = (name: string, before: Design | null, what: string | undefined): void => {
  revisions[name] = (revisions[name] ?? 0) + 1
  if (before) histories[name] = remember(histories[name], before, what ?? 'an edit')
}
/** `u` and `y`: the design a step back or forward, shown. Ids are never reused: the counter never goes back. */
const timeTravel = (design: Design | null, ui: DesignUi, way: 'undo' | 'redo', context: RunContext): Step => {
  if (!design || ui.status !== 'ready') return { design, ui, changed: false }
  if (context.locked || ui.handed) return applyOp(design, ui, way, context)
  const moved = travel(histories[ui.name], design, way)
  if (!moved) return { design, ui: nothingToRestore(ui, way), changed: false }
  histories[ui.name] = moved.history
  revisions[ui.name] = (revisions[ui.name] ?? 0) + 1
  const target: Design = { ...moved.entry.design, nextId: Math.max(nextIdNumber(moved.entry.design), nextIdNumber(design)) }
  return restoreDesign(design, ui, target, way, moved.entry.what, context)
}
/** One key: the two that travel the history, or any other. */
const keyStep = (design: Design | null, ui: DesignUi, op: KeyOp, context: RunContext): Step =>
  op === 'undo' || op === 'redo' ? timeTravel(design, ui, op, context) : applyOp(design, ui, op, context)
/**
 * What is being typed and not saved yet: into the fields of one block of one design (by field, `design-notes`).
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
 * again on every keystroke, to show the whole text under the field); letters that reached the mod by another way are
 * kept beside it, and the field is drawn anew, with all of it, only once the typing has paused (`tidySoon`).
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
/** The saved designs as last read, by name, for the start screen's preview: null for a file that is no design. */
const previews: Record<string, Design | null> = {}
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
/** The design whose hand-off context a `/conductor run` already recorded: the prompt hook must not attach it a second time. */
let delivered: string | null = null

// The run's state. Both hooks modules declare these (an atom must be spelled in the
// file that reads it): run.tsx writes them through the tracker, design.tsx reads them.
const runAtom = atom({ plugin: 'conductor', key: 'run' } as const, emptyRunState())
const clockAtom = atom({ plugin: 'conductor', key: 'runClock' } as const, 0)
/** The design the tracked run was started from (a handoff); null for any other run. */
const runDesignAtom = atom({ plugin: 'conductor', key: 'runDesign' } as const, null)
const designAtom = atom({ plugin: 'conductor', key: 'design' } as const, null)
const uiAtom = atom({ plugin: 'conductor', key: 'designUi' } as const, initialUi())
/** When the run began and ended: run.tsx stamps it. */
/** Whether this session has seen the splash: the pane's first drawing shows it, once. */
const splashedAtom = atom({ plugin: 'conductor', key: 'splashed' } as const, false)
/** The gesture the header's persona holds; at rest it is `idle`. */
const personaAtom = atom({ plugin: 'conductor', key: 'persona' } as const, 'idle')
const timesAtom = atom({ plugin: 'conductor', key: 'runTimes' } as const, initialTimes())
/** The tracked run's script file (run.tsx writes it), and the design an `attach` drew of that run. */
const runScriptAtom = atom({ plugin: 'conductor', key: 'runScript' } as const, null)

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 160)

/** A design's script, when it has one: the file beside it (`scriptFile`). */
const scriptOf = async ($: EngineInterface, root: string, name: string): Promise<string | null> => {
  const path = scriptFile(root, name)

  return (await $.fs.exists(path).catch(() => false)) ? path : null
}

/** Copies a run's script beside its design; a run of that very file copies nothing. False when it could not be done, never a throw. */
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
 * The run tracked now becomes `design`'s, which the board already shows: the tracker places its agents again, and
 * the write that follows reads the run's design and the board (run.tsx `write`), so both are set before it.
 * The labels no block took; null with no run.
 */
const showRunOn = async ($: EngineInterface, tracker: Tracker, name: string, design: Design): Promise<string[] | null> => {
  await update($, uiAtom, held => ({ ...held, follow: true, runCleared: false }))
  await update($, runDesignAtom, () => name)

  return tracker.adopt(handoffOf(name, design))
}

/**
 * The saved design a run's workflow is named as (the designs' name rule), put on the board for that run: what was
 * typed into a field and not sent is saved first, the board's own copy is taken where it shows the design, else the
 * file is opened in its place, and the selection is set to follow the run. Null when no saved design has the name.
 * The caller tells the tracker next (its write reads the run's design and the board, so both are set here), then
 * opens the pane (`paneArgs`).
 */
const designOfRun = async ($: EngineInterface, workflow: string | undefined): Promise<{ name: string; design: Design } | null> => {
  if (workflow === undefined) return null
  const name = designName(workflow)
  const path = designFile(await $.session.root(), name)
  if (!isSaved(name) || !(await $.fs.exists(path).catch(() => false))) return null
  await flushDrafts($)
  const shown = await read($, uiAtom)
  let design = shown.name === name && shown.status === 'ready' ? await read($, designAtom) : null
  if (design === null) {
    const opened = openDesign(name, await $.fs.read(path).catch(() => ''), shown)
    if (opened.design === null) return null
    design = opened.design
    await update($, designAtom, () => opened.design)
    await update($, uiAtom, () => opened.ui)
  }
  await update($, uiAtom, held => ({ ...held, follow: true, runCleared: false }))
  await update($, runDesignAtom, () => name)

  return { name, design }
}

/**
 * What run.tsx asks of the board when a run starts. `$` does not cross files (`claude plugin validate` refuses a `$`
 * passed to an imported function), so the session's start hook below gives these theirs, as the tracker's host gets its.
 */
export type RunBoard = { designOfRun: (workflow: string | undefined) => Promise<{ name: string; design: Design } | null>; keepScript: (from: string, to: string) => Promise<boolean> }
let runBoard: RunBoard | undefined
/** Undefined until the session has started. */
export const runBoardOf = (): RunBoard | undefined => runBoard

/** Whether a run of the design shown locks it now. */
const lockedNow = async ($: EngineInterface): Promise<boolean> => {
  const run = await read($, runAtom)
  return run.status === 'running' && overlaysDesign(run, await read($, runDesignAtom), await read($, uiAtom))
}

let flushing: Promise<string | null> = Promise.resolve(null)
/** What the last save of drafts said, for a moment: a drawing may have asked for it just before the action that would have (a click on the graph redraws the pane first). */
let justSaid: string | null = null
const SAID_MS = 400
/**
 * Saves what was typed into fields and not sent with Enter: one edit like any other (announced, undone with `u`, written
 * to the file). Called before anything else acts on the design, on every way out of a field: the ring moving, a click on
 * the graph, a key, a type picked, a command, a prompt sent, an edit from chat, the pane closing, the keyboard gone.
 * Resolves to what was said of it, or null when there was nothing to save. One at a time, in the order asked.
 */
const flushDrafts = ($: EngineInterface): Promise<string | null> => {
  const run = flushing.then(async (): Promise<string | null> => {
    if (!hasDrafts()) return null
    const pending = drafts
    drafts = noDrafts()
    const ui = await read($, uiAtom)
    let design: Design | null = await read($, designAtom)
    // The design they were typed for is no longer the one shown, or a run locks it: nothing can be saved, and it is said.
    const lost = `unsaved text in ${Object.keys(pending.values).map(fieldWord).join(', ')} discarded`
    if (!design || ui.status !== 'ready' || ui.name !== pending.name) {
      $.ui.toast(`conductor: ${lost} (design ${pending.name} is no longer on the board)`)

      return null
    }
    if (await lockedNow($)) {
      await update($, uiAtom, held => ({ ...held, notice: `${lost} · ${LOCK_NOTICE}` }))

      return null
    }
    const said: string[] = []
    let titled = false
    const node = pending.id === null ? undefined : findNode(design, pending.id)
    if (node) {
      let patch: NodePatch = {}
      for (const [base, text] of Object.entries(pending.values)) {
        const part = fieldPatch(node, base, text)
        patch = { ...patch, ...part, ...(patch.knobs || part.knobs ? { knobs: { ...patch.knobs, ...part.knobs } } : {}) }
      }
      const step = patchNode(design, ui, node.id, patch)
      if (step.changed && step.design) {
        record(ui.name, design, step.what)
        design = step.design
        said.push(step.what ?? `${node.id} changed`)
        titled = patch.name !== undefined
      }
    }
    if (said.length === 0) return null
    let notice = `${said.join('; ')} · ${UNDO_HINT}`
    try {
      if (isSaved(ui.name)) await $.fs.write(designFile(await $.session.root(), ui.name), serializeDesign(design))
    } catch (error) {
      notice = `not saved: ${reason(error)}`
    }
    const saved = design
    await update($, designAtom, () => saved)
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
      if ((ui.status !== 'ready' && ui.status !== 'pick') || ui.editing) return
      const key = ui.status === 'ready' && ui.picker !== null && !(await lockedNow($)) ? pickerKey() : drawnCatcher
      const moved = await $.ui.focus({ requestId: DESIGN_PANE_ID, key }).catch(() => ({ deny: 'no' }))
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
  const moved = await $.ui.focus({ requestId: DESIGN_PANE_ID, key }).catch(() => ({ deny: 'no' }))
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
    const moved = await $.ui.focus({ requestId: DESIGN_PANE_ID, key }).catch((error: unknown) => ({ deny: reason(error) }))
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
    await update($, uiAtom, held => ({ ...held, editing: false, freshId: null, notice: hint }))
  }
  void land(LAND_TRIES, '')
}

/**
 * Opens the fields of the selected block for typing, the ring on `base` (its first field when none is named): what `e`
 * does, for the ways that are not a key (the Down arrow from the catcher, a click on a field at rest).
 */
const openFields = async ($: EngineInterface, base?: string): Promise<void> => {
  const ui = await read($, uiAtom)
  const design = await read($, designAtom)
  const node = design === null || ui.selectedId === null ? undefined : findNode(design, ui.selectedId)
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
  const early = picks || drawnCatcher === '' ? { deny: 'no' } : await $.ui.focus({ requestId: DESIGN_PANE_ID, key: drawnCatcher }).catch((error: unknown) => ({ deny: reason(error) }))
  if (early.deny === undefined) ringOn = drawnCatcher
  // The ring leaves the field it was in, if any: on the catcher nothing is being typed.
  await update($, uiAtom, held => (held.editing || held.freshId !== null ? { ...held, editing: false, freshId: null } : held))
  // Moving the ring is also how the pane learns whether it got the keyboard: a site that does not hold it is refused.
  // (`$.ui.panes()` asked right after the open still says no.) One more try, since the pane may not be drawn yet.
  const land = async (tries: number): Promise<void> => {
    const key = picks ? pickerKey() : drawnCatcher
    const moved = await $.ui.focus({ requestId: DESIGN_PANE_ID, key }).catch((error: unknown) => ({ deny: reason(error) }))
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
        .focus({ requestId: DESIGN_PANE_ID, key: drawnCatcher })
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
/** The run laid over the design shown, as the steps need it. */
const runContext = async ($: EngineInterface): Promise<RunContext> => {
  const now = await read($, runAtom)
  const held = overlaysDesign(now, await read($, runDesignAtom), await read($, uiAtom))

  return { ...(held ? { run: now, locked: now.status === 'running' } : {}), ...(graphBox ? { graph: graphBox } : {}) }
}

/** A change is kept for `u`, counted as a revision, and saved. */
const store = async ($: EngineInterface, step: Step, before: Design | null): Promise<DesignUi> => {
  if (!step.changed || !step.design) return step.ui
  if (step.what !== undefined) record(step.ui.name, before, step.what)
  try {
    if (isSaved(step.ui.name)) await $.fs.write(designFile(await $.session.root(), step.ui.name), serializeDesign(step.design))
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
const commit = async ($: EngineInterface, make: (design: Design | null, held: DesignUi, context: RunContext) => Step): Promise<Step> => {
  const before = await read($, designAtom)
  const held = await read($, uiAtom)
  const step = make(before, held, await runContext($))
  const nextUi = await store($, step, before)
  if (step.design !== before) await update($, designAtom, () => step.design)
  if (nextUi !== held) await update($, uiAtom, () => nextUi)
  const pose = step.changed ? gestureOf(before, step.design) : null
  if (pose !== null) gesture($, pose)

  return { ...step, ui: nextUi }
}

/** A request (`r`, `q`) waits in the prompt box under a line that says so: the line goes once the box is empty again. */
const watchBox = ($: EngineInterface): void => {
  if (boxWatched) return
  boxWatched = true
  const look = (): void => {
    $.clock.after(BOX_POLL_MS, () => {
      void (async (): Promise<void> => {
        const ui = await read($, uiAtom)
        const waits = ui.notice !== null && /^(run|ask): /.test(ui.notice)
        const box = waits ? await $.prompt.read().catch(() => ({ text: '', cursor: 0 })) : null
        if (box !== null && box.text.trim() !== '') return look()
        boxWatched = false
        if (waits) await update($, uiAtom, held => ({ ...held, handed: false, notice: held.notice !== null && /^(run|ask): /.test(held.notice) ? null : held.notice === HANDED_NOTICE ? null : held.notice }))
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
 * `r` and `q` put a request in the prompt box, for the person to finish and send: from then on what they type
 * is for the prompt. No call hands the keyboard from a pane to the prompt, so the pane is closed and shown again
 * without it. Where that did not take the keys away, no key is acted on until the person does (`handed`).
 */
const request = async ($: EngineInterface, kind: 'run' | 'ask'): Promise<void> => {
  const ui = await read($, uiAtom)
  const now = await read($, designAtom)
  if (kind === 'run' && !isSaved(ui.name)) return say($, 'run: a replay is not a saved design, there is nothing to hand off')
  const line = kind === 'run' ? handoffPrompt(ui.name) : reviewPrompt(ui.name)
  const filled = await $.prompt.fill({ text: line }).catch(() => ({ isFilled: false }))
  await say($, kind === 'run' ? runNotice(now, line, filled.isFilled) : askNotice(line, filled.isFilled))
  if (!filled.isFilled) return
  watchBox($)
  await $.ui.close({ id: DESIGN_PANE_ID }).catch(() => undefined)
  await $.ui.open(paneArgs(false)).catch(() => undefined)
  // The ring can be moved only in a site that holds the keyboard: if it still can, the keys did not go.
  $.clock.after(FOCUS_DELAY_MS * 2, () => {
    void $.ui
      .focus({ requestId: DESIGN_PANE_ID, key: drawnCatcher })
      .catch(() => ({ deny: 'no' }))
      .then(moved => (moved.deny === undefined ? update($, uiAtom, held => ({ ...held, handed: true, notice: HANDED_NOTICE })) : undefined))
  })
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

/** Starts the design the start screen was opened for, from a template (or blank). */
const startFrom = async ($: EngineInterface, templateId: string): Promise<void> => {
  const step = startDesign(await read($, uiAtom), templateId)
  if (!step.design) return
  // Not written yet: the first edit (or handing it off) saves it. A design looked at and left leaves no file.
  delete histories[step.ui.name]
  await update($, designAtom, () => step.design)
  // A design nobody named says once how it gets a name (the line goes with the next thing said).
  await update($, uiAtom, () => ({ ...step.ui, help: 0, notice: isDefaultName(step.ui.name) ? `named ${step.ui.name} for now · /${COMMAND} rename ${step.ui.name} <name> names it` : null }))
  settleRing($)
}

/** A saved design picked on the start screen: read again as it is now, and shown. */
const openSaved = async ($: EngineInterface, name: string): Promise<void> => {
  const held = await read($, uiAtom)
  const text = await $.fs.read(designFile(await $.session.root(), name)).catch(() => undefined)
  const step = openDesign(name, typeof text === 'string' ? text : undefined, held)
  if (step.ui.status === 'pick') {
    await update($, uiAtom, ui => ({ ...ui, notice: `${name} is gone: it could not be read` }))

    return
  }
  await update($, designAtom, () => step.design)
  await update($, uiAtom, () => step.ui)
  settleRing($)
}

/** A row of the start screen is opened: by Enter on the marked one, or by a click on any. */
const openEntry = async ($: EngineInterface, at?: number): Promise<void> => {
  const ui = await read($, uiAtom)
  if (ui.status !== 'pick') return
  const entry = startEntries(ui.saved ?? [])[at ?? ui.startMark ?? 0]
  if (!entry) return
  if (entry.kind === 'saved') await openSaved($, entry.id)
  else await startFrom($, entry.id)
}

/** One key on the start screen: `w` / `s` move the mark (the arrows do too: the `ui.focus` hook), Enter opens the marked row, `?` turns the help pages and `x` closes them. */
const startKey = async ($: EngineInterface, key: string): Promise<boolean> => {
  if (key === ENTER) {
    await openEntry($)

    return false
  }
  const op = KEY_OPS[key]
  if (op === 'up' || op === 'down') await update($, uiAtom, held => ({ ...moveStartMark(held, op === 'up' ? -1 : 1), help: 0 }))
  else if (op === 'help') await update($, uiAtom, held => ({ ...held, notice: null, help: ((held.help ?? 0) % HELP_PAGES) + 1 }))
  else if (op === 'remove' && ((await read($, uiAtom)).help ?? 0) > 0) await update($, uiAtom, held => ({ ...held, help: 0 }))
  else await say($, unboundNotice(key))

  return true
}

/**
 * One key, as the catcher was given it: a character, or `enter`. Resolves to false when the keys typed with it are
 * not to be applied any more (the keyboard went to the prompt, nothing is on the board).
 */
const runKey = async ($: EngineInterface, key: string): Promise<boolean> => {
  const ui = await read($, uiAtom)
  const design = await read($, designAtom)
  if (ui.status === 'pick') return startKey($, key)
  if (ui.status !== 'ready' || design === null) return false
  const { locked } = await runContext($)
  const node = ui.selectedId === null ? undefined : findNode(design, ui.selectedId)
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
        await update($, uiAtom, held => typePicker(design, held, `${held.picker?.query ?? ''}${key}`).ui)
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
  // What was typed into a field and not sent is saved before the key acts.
  const flushed = await flushDrafts($)
  const step = await commit($, (before, held, context) => keyStep(before, held, op, context))
  await keepSaid($, flushed)
  // A request waits in the prompt box: the key was not acted on, and the pane says how to get to the prompt.
  if (ui.handed) return false
  if ((op === 'run' || op === 'review') && !locked) {
    await request($, op === 'run' ? 'run' : 'ask')

    return false
  }
  const edited = op === 'edit' && step.ui.editing && step.design && step.ui.selectedId !== null ? findNode(step.design, step.ui.selectedId) : undefined
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
      const design = await read($, designAtom)
      if ((await read($, uiAtom)).picker === null) {
        await closedFilter($, element, value)

        return
      }
      const skip = picked.element === element ? Math.min(picked.taken, value.length) : 0
      let taken = 0
      await update($, uiAtom, held => {
        const typed = typePicker(design, held, filterText(held, value.slice(skip)))
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

export const registerDesign = (on: On, tracker: Tracker): void => {
  // run.tsx registers /conductor and answers its own verbs; it passes these on.
  on('command.run', { command: 'conductor', args: DESIGN_VERBS }, async ($, e, next) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    terminalColumns = e.presentation?.columns ?? terminalColumns
    // Whatever was typed into a field and not sent is saved before the command acts (it may open another design, or run this one).
    await flushDrafts($)
    // No argument: a run in progress on its design (run.tsx's phase view when it came from none).
    // With no run in progress: the design last opened, with the keyboard; the start screen when there is none.
    const bare = verb === '' ? bareTarget((await read($, runAtom)).status, await read($, runDesignAtom), await read($, uiAtom)) : null
    if (bare !== null && bare.view === 'run') return next(e)
    const shown = bare !== null && bare.view === 'design' && bare.live ? bare.name : null
    const root = await $.session.root()
    // The person is at the prompt, sending a command: nothing waits there for the keys any more.
    if ((await read($, uiAtom)).handed) await update($, uiAtom, held => ({ ...held, handed: false, notice: held.notice === HANDED_NOTICE ? null : held.notice }))

    if (verb === 'delete') {
      // Asked twice: the name, then the name again with `confirm`. The file goes; this session's undo history of it too.
      const [first = '', word] = rest
      if (first === '') return { text: `Usage: /${COMMAND} delete <name>. /${COMMAND} list names the saved designs.` }
      const name = designName(first)
      const path = designFile(root, name)
      if (!isSaved(name) || !(await $.fs.exists(path))) return { text: `No saved design named ${name} (${DESIGN_DIR}/${name}.json): nothing to delete.` }
      const entry = savedDesign(name, await $.fs.read(path).catch(() => ''))
      if (word !== 'confirm' && word !== name) {
        return { text: `Delete ${savedLine(entry)}? This removes ${DESIGN_DIR}/${name}.json${(await scriptOf($, root, name)) === null ? '' : ' and its script'} and cannot be undone here. To go ahead: /${COMMAND} delete ${name} confirm` }
      }
      if ((await read($, runDesignAtom)) === name && (await read($, runAtom)).status === 'running') return { text: `Design ${name} is being run: it can be deleted once the run ends.` }
      const removed = await $.process.run(['rm', '--', path]).catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: reason(error) }))
      if (removed.exitCode !== 0) return { text: `Design ${name} could not be deleted: ${removed.stderr.trim().slice(0, 160) || 'rm failed'}` }
      // Its script goes with it. One that stays behind is said: the design is gone all the same.
      const script = await scriptOf($, root, name)
      const scriptGone = script === null || (await $.process.run(['rm', '--', script]).catch(() => ({ exitCode: 1 }))).exitCode === 0
      delete histories[name]
      delete revisions[name]
      delete seenByClaude[name]
      delete seenDesigns[name]
      delete warnedAt[name]
      // The pane was showing it: nothing is shown in its place but the way to open another.
      if ((await read($, uiAtom)).name === name) {
        await update($, designAtom, () => null)
        await update($, uiAtom, held => ({ ...carryUi(held, initialUi()), picks: Object.fromEntries(Object.entries(held.picks ?? {}).filter(([key]) => key !== name)) }))
      }

      if (!scriptGone) return { text: `Design ${name} deleted (${DESIGN_DIR}/${name}.json), but its script ${DESIGN_DIR}/${name}.workflow.js could not be removed.` }

      return { text: `Design ${name} deleted (${DESIGN_DIR}/${name}.json${script === null ? '' : ' and its script'}).` }
    }

    if (verb === 'rename') {
      const [from = '', to = '', ...more] = rest
      if (from === '' || to === '' || more.length > 0) return { text: `Usage: /${COMMAND} rename <old> <new>. /${COMMAND} list names the saved designs.` }
      const oldName = designName(from)
      const newName = designName(to)
      if (!isSaved(oldName)) return { text: `${oldName} is a replay, not a saved design: there is nothing to rename.` }
      if (!isSaved(newName)) return { text: `Names starting with ${SCRATCH_PREFIX} are kept for replays: choose another name.` }
      if (oldName === newName) return { text: `Design ${oldName} already has that name.` }
      const oldPath = designFile(root, oldName)
      const newPath = designFile(root, newName)
      const held = await read($, uiAtom)
      // A design started from a template and not edited yet is on the board only.
      const onBoard = held.name === oldName && held.status === 'ready' ? await read($, designAtom) : null
      const onDisk = await $.fs.exists(oldPath)
      if (!onDisk && onBoard === null) return { text: `No saved design named ${oldName} (${DESIGN_DIR}/${oldName}.json): nothing to rename.` }
      if (await $.fs.exists(newPath)) return { text: `A design named ${newName} exists (${DESIGN_DIR}/${newName}.json): nothing was renamed. Choose another name, or delete it first with /${COMMAND} delete ${newName}.` }
      if ((await read($, runDesignAtom)) === oldName && (await read($, runAtom)).status === 'running') return { text: `Design ${oldName} is being run: it can be renamed once the run ends.` }
      let source: Design | null = onBoard
      if (source === null) {
        const parsed = parseDesign(await $.fs.read(oldPath).catch(() => ''))
        if (!parsed.ok) return { text: `Design ${oldName} is not valid, nothing was renamed: ${parsed.error}` }
        source = parsed.design
      }
      const renamed: Design = { ...source, name: newName }
      try {
        await $.fs.write(newPath, serializeDesign(renamed))
      } catch (error) {
        return { text: `Design ${newName} could not be saved, nothing was renamed: ${reason(error)}` }
      }
      if (onDisk) {
        const removed = await $.process.run(['rm', '--', oldPath]).catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: reason(error) }))
        if (removed.exitCode !== 0) return { text: `Design ${newName} was written, but ${DESIGN_DIR}/${oldName}.json could not be removed: ${removed.stderr.trim().slice(0, 160) || 'rm failed'}` }
      }
      // Its script moves with it. One that stays behind is said: the design is renamed all the same.
      const script = await scriptOf($, root, oldName)
      const scriptMoved = script === null || (await $.process.run(['mv', '--', script, scriptFile(root, newName)]).catch(() => ({ exitCode: 1 }))).exitCode === 0
      // What this session knows of the design goes with it: its undo history, its revisions, the block it was left on.
      for (const book of [histories, revisions, seenByClaude, seenDesigns, warnedAt] as Record<string, unknown>[]) {
        if (oldName in book) book[newName] = book[oldName]
        delete book[oldName]
      }
      if (held.name === oldName && held.status !== 'closed') {
        if (onBoard !== null) await update($, designAtom, () => renamed)
        await update($, uiAtom, ui => ({ ...ui, name: newName, notice: ui.notice?.includes(`${COMMAND} rename`) ? null : ui.notice }))
      }
      await update($, uiAtom, ui => {
        const picks = { ...(ui.picks ?? {}) }
        const left = picks[oldName]
        delete picks[oldName]

        return { ...ui, picks: left === undefined ? picks : { ...picks, [newName]: left } }
      })

      if (!scriptMoved) return { text: `Design ${oldName} renamed to ${newName} (${DESIGN_DIR}/${newName}.json), but its script ${DESIGN_DIR}/${oldName}.workflow.js could not be moved with it.` }

      return { text: `Design ${oldName} renamed to ${newName} (${DESIGN_DIR}/${newName}.json${script === null ? '' : ', its script with it'}).` }
    }

    if (verb === 'replay') {
      const [, templateId, speed] = rest
      const template = TEMPLATES.find(one => one.id === templateId)
      if (!template || (speed !== undefined && speed !== 'fast' && speed !== 'slow')) {
        return { text: `Usage: /${COMMAND} replay design <${TEMPLATES.map(one => one.id).join('|')}> [fast|slow]` }
      }
      // A replay's design lives in the session only (`isSaved`): no file is written, and none is listed.
      const name = designName(`replay-${template.id}`)
      const made: Design = { ...template.make(), name }
      // Another design under the same name: what could be undone in the one before is not its history.
      delete histories[name]
      await update($, designAtom, () => made)
      await update($, uiAtom, held => ({ ...carryUi(held, initialUi()), name, status: 'ready' as const, selectedId: made.nodes[0]?.id ?? null }))
      await $.ui.open(paneArgs(true))
      settleRing($)
      // A replay reuses its run id: the clock of the one before must not time this one.
      await update($, timesAtom, () => initialTimes())
      tracker.handoff(handoffOf(name, made))
      tracker.replay(replayDesignEvents(made, name), speed ?? 'fast')

      return { text: `Replaying a made-up run over the ${template.id} template (${speed ?? 'fast'}); token counts are made up, and nothing is saved.` }
    }

    // Bare `design` (and bare /conductor with nothing opened yet): the saved designs to pick from, above the templates.
    const fresh = rest.join('').trim() === '' && (verb === 'design' || (bare !== null && bare.view === 'design' && !bare.live && bare.name === DEFAULT_DESIGN_NAME && (await read($, uiAtom)).status === 'closed'))
    const saved: SavedDesign[] = []
    // The saved designs, each read: `/conductor list` prints them, the start screen lists them and draws the marked one.
    const listSaved = async (): Promise<void> => {
      const dir = `${root.replace(/\/+$/, '')}/${DESIGN_DIR}`
      const entries = await $.fs.list(dir).catch(() => [])
      const names = entries
        .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
        .map(entry => entry.name.slice(0, -'.json'.length))
        .filter(isSaved)
        .sort()
      for (const one of names.slice(0, SAVED_MAX)) {
        const text = await $.fs.read(`${dir}/${one}.json`).catch(() => '')
        const parsed = parseDesign(text)
        previews[one] = parsed.ok ? parsed.design : null
        saved.push(savedDesign(one, text))
      }
    }
    if (verb === 'list' || fresh) await listSaved()

    if (verb === 'list') {
      if (saved.length === 0) return { text: `No saved designs yet: /${COMMAND} design <name> starts one.` }

      return { text: [`Saved designs (${DESIGN_DIR}), open one with /${COMMAND} design <name>:`, ...saved.map(one => `  ${savedLine(one)}`)].join('\n') }
    }

    if (verb === 'draft') {
      const [first = '', ...words] = rest
      const brief = words.join(' ').trim()
      if (first === '' || brief === '') return { text: `Usage: /${COMMAND} draft <name> <what the workflow should do>` }
      const name = designName(first)
      if (!isSaved(name)) return { text: `Names starting with ${SCRATCH_PREFIX} are kept for replays: choose another name.` }
      const path = designFile(root, name)
      if (await $.fs.exists(path)) {
        const saved = parseDesign(await $.fs.read(path).catch(() => ''))
        // A draft never writes over work: an existing design is changed by asking in chat.
        if (!saved.ok || !isBlank(saved.design)) {
          return { text: `A design named ${name} exists (${DESIGN_DIR}/${name}.json). Open it with /${COMMAND} design ${name} and ask for changes in chat, or draft under another name.` }
        }
      }
      const blank: Design = withGoal(emptyDesign(name), brief)
      try {
        await $.fs.write(path, serializeDesign(blank))
      } catch (error) {
        return { text: `Design ${name} could not be saved: ${reason(error)}` }
      }
      await update($, designAtom, () => blank)
      // The empty graph says Claude is drafting until the first blocks land.
      await update($, uiAtom, held => ({ ...carryUi(held, initialUi()), name, status: 'ready' as const, drafting: true }))
      await $.ui.open(paneArgs(false))
      const prompt = `Draft the "${name}" workflow design: ${brief}`
      // As the handoff: `prompt.submit` is refused inside this hook, so it is sent once the command has settled.
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

      return { text: `drafting design "${name}"`, context: draftBrief(name, brief) }
    }

    if (verb === 'run') {
      // `fill` as a last word leaves the prompt in the box for the person to send.
      const fillOnly = rest.length > 1 && rest.at(-1) === 'fill'
      const typed = (fillOnly ? rest.slice(0, -1) : rest).join(' ')
      if (typed.trim() === '') return { text: `Usage: /${COMMAND} run <name> [fill]. /${COMMAND} list names the saved designs.` }
      const name = designName(typed)
      const path = designFile(root, name)
      // A design started from a template and not edited yet is on the board only: running it is what saves it.
      const onBoard = (await read($, uiAtom)).name === name && (await read($, uiAtom)).status === 'ready' ? await read($, designAtom) : null
      if (isSaved(name) && onBoard !== null && !(await $.fs.exists(path))) await $.fs.write(path, serializeDesign(onBoard)).catch(() => undefined)
      if (onBoard !== null) await update($, uiAtom, held => (held.unsaved ? { ...held, unsaved: false } : held))
      if (!(await $.fs.exists(path))) return { text: `No design named ${name} (${DESIGN_DIR}/${name}.json). /${COMMAND} design ${name} starts one.` }
      let body: string
      try {
        body = await $.fs.read(path)
      } catch (error) {
        return { text: `Design ${name} could not be read: ${reason(error)}` }
      }
      const parsed = parseDesign(body)
      if (!parsed.ok) return { text: `Design ${name} is not valid, nothing was handed off: ${parsed.error}` }
      if (isBlank(parsed.design)) return { text: `Design ${name} is empty: add a block before running it.` }

      const handoff = buildHandoff(parsed.design, path, await scriptOf($, root, name))
      // The next run to start is this design's: its agents count against these ids.
      tracker.handoff(handoffOf(name, parsed.design))
      offerSettled(name)
      // The pane shows the design being run, whatever it showed before; the keyboard stays in the prompt.
      const shownUi = await read($, uiAtom)
      if (shownUi.name !== name || shownUi.status !== 'ready') {
        const opened = openDesign(name, body, shownUi)
        await update($, designAtom, () => opened.design)
        await update($, uiAtom, () => opened.ui)
      }
      // The designer's "run: …" line is spent once the command has been sent; the selection follows the run that starts.
      await update($, uiAtom, held => ({ ...held, follow: true, runCleared: false, notice: held.notice?.startsWith('run: ') ? null : held.notice }))
      await $.ui.open(paneArgs(false)).catch(() => undefined)
      // This answer's `context` carries the conventions: the prompt hook leaves them out when the prompt follows.
      delivered = name
      // Said before the handoff, never a gate: how much the design implies.
      const facts = preflightLine(parsed.design)
      const prompt = `Implement and run the "${name}" workflow design.`
      const fill = async (): Promise<void> => {
        // Left for the person to finish: what to run it on.
        const filled = await $.prompt.fill({ text: handoffPrompt(name) }).catch(() => ({ isFilled: false }))
        $.ui.toast(filled.isFilled ? 'conductor: say what to run it on, then Enter' : `conductor: type "${handoffPrompt(name).trim()} …" to start the handoff`)
      }
      if (fillOnly) {
        await fill()

        return { text: `${handoff.text} · ${facts}; say what to run it on in the filled prompt, then Enter`, context: handoff.context }
      }
      // The engine refuses `prompt.submit` from inside a command.run hook (it
      // would wait on the turn this hook holds), so it is sent from a clock
      // callback once this command has settled. The context is recorded first.
      $.clock.after(SUBMIT_DELAY_MS, () => {
        void $.prompt
          .submit({ text: prompt })
          .then(entered => (entered.drop === undefined ? undefined : fill()))
          .catch(() => fill())
      })

      return { text: `${handoff.text} · ${facts}`, context: handoff.context }
    }

    const previous = await read($, uiAtom)
    // Bare /conductor: the run's design, else the design this session last had open.
    const name = bare !== null && bare.view === 'design' ? bare.name : designName(rest.join(' '))
    // A replay's design is made by `/conductor replay design`, never from the start screen: its name is not offered for a new design.
    if (!isSaved(name) && !(verb === '' && previous.name === name && previous.status === 'ready')) {
      return { text: `Names starting with ${SCRATCH_PREFIX} are kept for replays (/${COMMAND} replay design <template>): choose another name for a design.` }
    }
    const path = designFile(root, name)
    // The run's design, or the one last worked on, is often already loaded: it is shown as it stands.
    if (verb === '' && previous.name === name && previous.status === 'ready' && (await read($, designAtom)) !== null) {
      // A field left open when the keyboard went to the prompt is closed: the keys are keys again.
      if (previous.editing || previous.picker !== null) await update($, uiAtom, held => ({ ...held, editing: false, freshId: null, picker: null }))
      await $.ui.open(paneArgs(true))
      // On the catcher, never in a field.
      settleRing($)

      return { text: shown !== null ? `Design ${name} opened with its run.` : `Design ${name} opened.` }
    }
    if (fresh && saved.length > 0) {
      // Coming back: the saved designs first. A template starts a new design under a name none of them has.
      const started = openDesign(freeName(saved.map(one => one.name)), undefined, previous)
      await update($, designAtom, () => null)
      await update($, uiAtom, () => ({ ...started.ui, saved, startMark: 0 }))
      await $.ui.open(paneArgs(true))
      settleRing($)

      return { text: `${saved.length} saved ${saved.length === 1 ? 'design' : 'designs'}: open one in the pane, or start a new one from a template.` }
    }
    let step = openDesign(name, undefined, previous)
    if (isSaved(name) && (await $.fs.exists(path))) {
      try {
        step = openDesign(name, await $.fs.read(path), previous)
      } catch (error) {
        // Unreadable is not absent: never offer a template over a file that is there.
        step = { ...step, ui: { ...step.ui, status: 'error', error: `could not be read: ${reason(error)}` } }
      }
    }
    // No such design yet: the start screen, for this name. The saved ones are listed all the same; the mark starts on the first template.
    if (step.ui.status === 'pick') {
      if (!fresh) await listSaved()
      step = { ...step, ui: { ...step.ui, saved, startMark: saved.length } }
    }
    await update($, designAtom, () => step.design)
    await update($, uiAtom, () => step.ui)
    // With the keyboard, the keys work at once: no click on the graph.
    await $.ui.open(paneArgs(true))
    settleRing($)

    if (step.ui.status === 'error') return { text: `Design ${name} could not be opened: ${step.ui.error}` }

    return { text: step.ui.status === 'pick' ? `No design named ${name} yet: start it from a template in the pane.` : `Design ${name} opened.` }
  })

  // The tool Claude edits a design with, deferred: its schema is loaded when Claude asks for it, not sent with every turn.
  // The matcher is always true: run.tsx holds the unmatched session.start.
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    await $.tool.register({ name: TOOL_NAME, description: toolDescription(), inputSchema: TOOL_SCHEMA, isDeferred: true })
    runBoard = { designOfRun: workflow => designOfRun($, workflow), keepScript: (from, to) => keepScript($, from, to) }
    // A load (the first, or a reload): the state outlives it, what it said of the moment does not. No field is open,
    // nothing waits in the prompt box under a `run: …` line, and the ring starts on the catcher.
    await update($, uiAtom, held =>
      held.editing || held.picker !== null || held.handed || held.confirmId !== null || (held.notice !== null && /^(run|ask): /.test(held.notice)) || held.notice === HANDED_NOTICE
        ? { ...held, editing: false, freshId: null, picker: null, handed: false, confirmId: null, notice: held.notice !== null && (/^(run|ask): /.test(held.notice) || held.notice === HANDED_NOTICE) ? null : held.notice }
        : held,
    )

    return next(e)
  })

  // The hand-off as a prompt: `r` fills the box with the request, the person says what to run it on
  // and sends it. The conventions go with the prompt as hidden context (the same text
  // `/conductor run` answers with), and the run that starts is counted against the design.
  on('prompt.submit', { text: /^/ }, async ($, e, enter) => {
    // What was typed into a field and not sent goes with the design: Claude reads the file.
    await flushDrafts($)
    const shown = await read($, uiAtom)
    // A "Conductor" answer whose draft never came is over with its turn: a later edit from chat leaves the keyboard alone.
    offerPrompted()
    // The person's own words in the conversation (a notice of a run that ended is not): a handoff that waits for its run waits on.
    if ((e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'sdk') && !e.text.trimStart().startsWith('/')) tracker.prompted()
    // A prompt was sent: whatever waited in the box for the keys is on its way, and the line that said so is spent.
    if (shown.handed || (shown.notice !== null && /^(run|ask): /.test(shown.notice))) {
      await update($, uiAtom, held => ({ ...held, handed: false, notice: held.notice === HANDED_NOTICE || (held.notice !== null && /^(run|ask): /.test(held.notice)) ? null : held.notice }))
    }
    // The board changed by hand since Claude last read the design: it is told so with this prompt, once per change,
    // or it would answer from what it remembers (a review of a block deleted a minute ago). The note says the change
    // itself where the design Claude saw is at hand, so no read is spent on it; without one it says to read again.
    let context = e.context ?? []
    const revision = revisions[shown.name] ?? 0
    const seen = seenByClaude[shown.name]
    let told: Design | null = null
    if (shown.status === 'ready' && !e.text.trimStart().startsWith('/') && seen !== undefined && seen !== revision && warnedAt[shown.name] !== revision) {
      warnedAt[shown.name] = revision
      const board = await read($, designAtom)
      const before = seenDesigns[shown.name]
      const change = board !== null && before !== undefined ? changedNote(shown.name, revision, before, board, shown.selectedId) : null
      if (change !== null) told = board
      context = [...context, change ?? staleNote(shown.name, revision)]
    }
    const pass = context === (e.context ?? []) ? e : { ...e, context }
    // A change said in full counts as read once the prompt has entered with it: an edit made from it is not refused as stale.
    const next = async (input: typeof e): Promise<Awaited<ReturnType<typeof enter>>> => {
      const answer = await enter(input)
      if (told !== null && answer.drop === undefined && (revisions[shown.name] ?? 0) === revision) sawDesign(shown.name, told)

      return answer
    }
    const name = handoffTarget(e.text)
    if (name === null || !isSaved(name)) return next(pass)
    const root = await $.session.root()
    const path = designFile(root, name)
    // A template nobody edited yet is on the board only: handing it off is what saves it.
    const onBoard = shown.name === name && shown.status === 'ready' ? await read($, designAtom) : null
    if (onBoard !== null && !(await $.fs.exists(path))) await $.fs.write(path, serializeDesign(onBoard)).catch(() => undefined)
    if (!(await $.fs.exists(path))) return next(pass)
    if (onBoard !== null && shown.unsaved) await update($, uiAtom, held => ({ ...held, unsaved: false }))
    const parsed = parseDesign(await $.fs.read(path).catch(() => ''))
    if (!parsed.ok || isBlank(parsed.design)) return next(pass)
    tracker.handoff(handoffOf(name, parsed.design))
    offerSettled(name)
    await update($, uiAtom, held => ({ ...held, follow: true, runCleared: false, notice: held.notice?.startsWith('run: ') ? null : held.notice }))
    // `/conductor run` recorded the conventions with its own answer: once is enough.
    if (delivered === name) {
      delivered = null

      return next(pass)
    }

    return next({ ...pass, context: [...context, ...buildHandoff(parsed.design, path, await scriptOf($, root, name)).context] })
  })

  // The summary that takes the conversation's place does not hold the design as Claude read it: a change made by hand
  // after it is not said against it, Claude reads again. A `precompute` installs no summary (API-NOTES S15). A cleared
  // conversation, and the one a resume leaves, hold nothing of any design.
  on('session.compact', async ($, e, next) => {
    const answer = await next(e)
    if (e.trigger !== 'precompute' && e.agentId === undefined && answer.skip === undefined) forgetSeenDesigns()

    return answer
  })
  on('session.end', { reason: ['clear', 'resume'] }, async ($, e, next) => {
    forgetConversation()

    return next(e)
  })

  // The design tool. Every edit is made by src/design/chat.ts on the mod's own
  // state, so the graph redraws from the atoms and nothing unchecked is saved.
  on('tool.call', { tool: TOOL_FULL_NAME }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const action = input.action
    if (action !== 'read' && action !== 'apply' && action !== 'write' && action !== 'attach') return { deny: 'action must be one of read, apply, write, attach' }

    // Text typed into a field and not sent is the person's edit: saved first, so Claude reads it, and an edit made
    // without having read it is refused as stale (below) instead of writing over it.
    await flushDrafts($)
    const ui = await read($, uiAtom)
    const asked = typeof input.name === 'string' && input.name.trim() !== '' ? designName(input.name) : null
    // An attach is for the run tracked now, whose script run.tsx noted; with no name it is the design drawn of that run before.
    const ran = action === 'attach' ? await read($, runScriptAtom) : null
    const tracked = tracker.state()
    if (action === 'attach' && (ran === null || tracked.status === 'idle' || tracked.runId !== ran.runId)) return { deny: 'No workflow run is tracked now, so there is no run to attach a design to. Nothing was changed.' }
    const name = asked ?? (action === 'attach' ? (ran?.drawn ?? null) : ui.status === 'ready' ? ui.name : null)
    if (name === null) return { deny: action === 'attach' ? 'attach needs `name`: a short kebab-case name for the design. Nothing was changed.' : `No design is open on the board and no \`name\` was given, so there is no design to ${action}. Nothing was changed.` }
    const root = await $.session.root()
    const path = designFile(root, name)
    const isOpen = ui.status === 'ready' && ui.name === name
    if (action === 'attach' && ran?.drawn !== name) {
      // The first attach of this run under this name: the run must be nobody's yet, and the name free.
      const owner = tracker.design()
      if (owner !== undefined && owner !== name) return { deny: `This run already belongs to design ${owner}. Nothing was changed.` }
      if (!isSaved(name)) return { deny: `Names starting with ${SCRATCH_PREFIX} are kept for replays. Nothing was changed. A name no design has is free to use.` }
      if (owner === name || isOpen || (await $.fs.exists(path))) return { deny: `A design named ${name} exists that this run did not create. Nothing was changed. A name no design has is free to use.` }
    }
    let design: Design | null = isOpen ? await read($, designAtom) : null
    if (design === null) {
      if (isSaved(name) && (await $.fs.exists(path))) {
        const parsed = parseDesign(await $.fs.read(path).catch(() => ''))
        if (!parsed.ok) return { deny: `${DESIGN_DIR}/${name}.json is not a valid design (${parsed.error}). Nothing was changed.` }
        design = parsed.design
      } else if (action === 'read' || !isSaved(name)) {
        return { deny: `No design named ${name}. An apply or write with that name starts it.` }
      } else design = emptyDesign(name)
    }
    const locked = (await read($, runDesignAtom)) === name && (await read($, runAtom)).status === 'running'
    if (action === 'read') {
      // What Claude has now is the board as it stands: the revision it names is the one to compare against later.
      sawDesign(name, design)

      return { result: readReport(design, { open: isOpen, selectedId: isOpen ? ui.selectedId : null, locked, revision: revisions[name] ?? 0 }) }
    }
    // The lock the board applies to the person's own edits. An attach is past it: the design is this run's own drawing.
    if (locked && action !== 'attach') return { deny: `Design ${name} is being run: editing is locked until the run ends, for the board and for you alike. Nothing was changed.` }

    // An edit made from memory of a board that has since changed by hand would undo the person's work.
    const known = seenByClaude[name]
    if (known !== undefined && known !== (revisions[name] ?? 0)) {
      return { deny: `The user changed design ${name} on the board by hand since you last read it (it is now revision ${revisions[name] ?? 0}, you saw ${known}), so this edit was made from a board that is gone. Nothing was changed.` }
    }
    // A whole tree written over a design Claude has not seen in this conversation would replace the person's work unread
    // (a draft Claude named as a design that exists). An attach is guarded above; a design with no block yet is free.
    if (action === 'write' && known === undefined && !isBlank(design)) {
      return { deny: `A design named ${name} exists and you have not read it in this conversation, so a write would replace it unseen. Nothing was changed. A name no design has is free to use.` }
    }
    const edit = action === 'apply' ? applyOps(design, input.ops) : replaceDesign(design, input.nodes)
    if (!edit.ok) return { deny: edit.error }
    try {
      if (isSaved(name)) await $.fs.write(path, serializeDesign(edit.design))
    } catch (error) {
      return { deny: `Design ${name} could not be saved, nothing was changed: ${reason(error)}` }
    }
    // The script the run is of goes beside the design: the next handoff updates that file.
    const scriptKept = ran === null || (await keepScript($, ran.path, scriptFile(root, name)))
    // Undone like any edit made by hand; and Claude has seen what it just wrote.
    const said = changeWords(edit)
    if (said !== '') record(name, design, `Claude ${said}`)
    // What Claude holds of it now is what it sent and what the answer says. Where the design stored has more (text a
    // kind filled in, a block from a design it never read whole), no later change is said against it: Claude reads again.
    if (knownAfterEdit(edit.design, seenDesigns[name], input)) sawDesign(name, edit.design)
    else {
      delete seenDesigns[name]
      seenByClaude[name] = revisions[name] ?? 0
    }
    await update($, designAtom, () => edit.design)
    await update($, uiAtom, held => showEdit(held, name, edit.design, edit))
    const seq = (await read($, uiAtom)).flash?.seq ?? 0
    let unplaced: string[] | null = null
    if (ran !== null) {
      await update($, runScriptAtom, held => (held !== null && held.runId === ran.runId ? { ...held, drawn: name } : held))
      unplaced = await showRunOn($, tracker, name, edit.design)
    }
    // Shown, but the keyboard stays where the person is typing. The draft the person asked for in the question before a
    // workflow is theirs to review next: its board takes the keyboard, as `/conductor design` gives it.
    const offered = action === 'write' && takeOffered()
    if (offered) offerDrafted(name)
    const opened = await $.ui.open(paneArgs(offered)).catch(() => undefined)
    if (offered) settleRing($)
    $.clock.after(FLASH_CLEAR_MS, () => {
      void update($, uiAtom, held => clearFlash(held, seq))
    })
    // A design that was not on the board, in a terminal too narrow for the pane to open unasked: nothing shows, so Claude says the way in.
    const report = editReport(edit.design, edit, revisions[name] ?? 0)

    const notes = [
      ...(ran === null ? [] : [attachNote(edit.design, unplaced ?? [])]),
      ...(scriptKept ? [] : [`Note: the run's script could not be copied to ${DESIGN_DIR}/${name}.workflow.js.`]),
      ...((!isOpen || ran !== null) && opened?.isPlaced === false ? [unplacedNote(name)] : []),
    ]

    return { result: [report, ...notes].join('\n') }
  })

  // The design file written with the built-in tools: the open board follows it,
  // and keeps the last good design when the file no longer reads as one.
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const target = (e as unknown as { file_path?: unknown }).file_path
    const root = await $.session.root()
    const name = typeof target === 'string' ? designOfPath(root, await $.session.cwd().catch(() => root), target) : null
    if (name === null) return next(e)
    if ((await read($, runDesignAtom)) === name && (await read($, runAtom)).status === 'running') {
      return { deny: `Design ${name} is being run: its file is locked until the run ends.` }
    }
    await flushDrafts($)
    const answer = await next(e)
    const ui = await read($, uiAtom)
    if (answer.deny !== undefined || answer.isError === true || ui.name !== name || ui.status === 'closed') return answer
    const parsed = parseDesign(await $.fs.read(designFile(root, name)).catch(() => ''))
    if (!parsed.ok) {
      $.ui.toast(`conductor: ${name}.json is not a valid design (${parsed.error.slice(0, 80)}); the board keeps the last good one`)

      return answer
    }
    const before = ui.status === 'ready' ? await read($, designAtom) : null
    const change = diffDesigns(before, parsed.design)
    if (before !== null && JSON.stringify(before) !== JSON.stringify(parsed.design)) record(name, before, `the file ${changeWords(change) || 'changed'}`)
    sawDesign(name, parsed.design)
    await update($, designAtom, () => parsed.design)
    await update($, uiAtom, held => showEdit(held, name, parsed.design, change))
    const seq = (await read($, uiAtom)).flash?.seq ?? 0
    $.clock.after(FLASH_CLEAR_MS, () => {
      void update($, uiAtom, held => clearFlash(held, seq))
    })

    return answer
  })

  on('ui.message', { requestId: DESIGN_PANE_ID, element: CANVAS_KEY }, async ($, e, next) => {
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
    const design = await read($, designAtom)
    const ui = await read($, uiAtom)
    const context = await runContext($)
    const step = applyMessage(design, ui, message, context)
    const nextUi = await store($, step, design)
    // Writing the atoms redraws the pane, which hands the graph its next props.
    if (step.design !== design) await update($, designAtom, () => step.design)
    if (nextUi !== ui) await update($, uiAtom, () => nextUi)
    await keepSaid($, flushed)
    // A `[+]` needs its filter to type in. (So does a list the click left open: the catcher is not drawn under it.)
    await retake($, nextUi.picker !== null && !context.locked)

    return {}
  })

  // The wheel. The pane's tree is as tall as its body, so the engine has nothing to scroll: over the graph's rows the
  // ticks are the graph's, which pans by them (the Client takes the sum from its props). Anywhere else, and for the
  // scroll keys, the move is the engine's.
  on('ui.scroll', { requestId: DESIGN_PANE_ID }, async ($, e, next) => {
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
  // chain: the engine refuses an element where the person's move named none. The ring on a field is "editing". The
  // mod's own moves do not come here (they are settled where they are made).
  on('ui.focus', { requestId: DESIGN_PANE_ID }, async ($, e, next) => {
    const person = e.origin.kind === 'person'
    const before = await read($, uiAtom)
    // The add list is open and the ring left its filter: the arrows choose. A step that lands on a row of the list
    // was Down; any other (the stop before the filter) was Up. The ring goes back to the filter: letters stay its text.
    if (person && before.status === 'ready' && before.picker !== null && !isPickerField(e.element)) {
      const moved = await next(e)
      if (moved.deny !== undefined) return moved
      const design = await read($, designAtom)
      await update($, uiAtom, held => movePick(design, held, (e.element ?? '').startsWith('pick:') ? 1 : -1))
      await $.ui.focus({ requestId: DESIGN_PANE_ID, key: pickerKey() }).catch(() => settleRing($))
      $.ui.invalidate('ui.render')

      return moved
    }
    const door = person && isDoor(e.element)
    // On the door with the fields open, the person stepped back from the first field: the way to the graph.
    const leaves = door && before.editing
    const stray = person && (before.status === 'ready' || before.status === 'pick') && drawnCatcher !== '' && !isCatcher(e.element) && !isDetailStop(e.element) && !door
    const was = ringOn
    // Said before the move is answered: a letter typed on its heels finds the ring known to be there.
    ringOn = stray || leaves ? drawnCatcher : e.element
    const moved = await next(e)
    if (moved.deny !== undefined) {
      ringOn = was

      return moved
    }
    if (stray || leaves) await $.ui.focus({ requestId: DESIGN_PANE_ID, key: drawnCatcher }).catch(() => settleRing($))
    // On the start screen the arrows choose, as in the add list: a step onto a row was Down, any other Up.
    if (stray && before.status === 'pick') await update($, uiAtom, held => ({ ...moveStartMark(held, (e.element ?? '').startsWith(START_KEY) ? 1 : -1), help: 0 }))
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

  // The pane is closed (the person's mark or chord, an unload): what was typed into a field goes into the design first.
  on('ui.close', { id: DESIGN_PANE_ID }, async ($, e, next) => {
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

  on('ui.render', { component: 'Pane', requestId: DESIGN_PANE_ID }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : null
    const ui = await read($, uiAtom)
    const design = await read($, designAtom)
    const file = `${DESIGN_DIR}/${ui.name}.json`
    const bodyColumns = e.props.bodyColumns || 80
    const columns = Math.max(20, bodyColumns - 2)
    // The header's persona stands at its left: the name's row has the rest.
    const headColumns = columns - SMALL_W
    // The run laid over this design, when it was started from it.
    const run = await read($, runAtom)
    const over = overlaysDesign(run, await read($, runDesignAtom), ui)
    const locked = over && run.status === 'running'
    // The tick clock is read only while it matters, so an idle pane is not redrawn by it.
    const clock = locked ? await read($, clockAtom) : 0
    const overlay = over ? runOverlay(run, clock) : undefined
    // The header's persona: a gesture it was asked for, else what the run laid over the design calls for, else at rest.
    const asked = await read($, personaAtom)
    const pose: Pose = asked !== 'idle' ? asked : ((over ? runPose(run.status, clock) : null) ?? 'idle')
    const splashed = await read($, splashedAtom)
    const dock = e.props.placement !== 'inline'
    // Docked and wide the graph and the detail pane stand side by side; otherwise the same parts are one column.
    const wide = dock && bodyColumns >= WIDE_MIN_COLUMNS
    // Whether the pane holds the keyboard: Escape hands it to the prompt, and a field left open then is closed to the eye.
    const focused = e.props.isFocused !== false
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 48
    const node = design === null || ui.selectedId === null ? undefined : findNode(design, ui.selectedId)
    const problems = design ? lint(design) : []
    // The start screen: no design is open yet, one of its rows is marked.
    const starting = ui.status === 'pick' || (ui.status === 'ready' && !design)
    const entries = starting ? startEntries(ui.saved ?? []) : []
    const mark = Math.max(0, Math.min(entries.length - 1, ui.startMark ?? 0))
    const marked = entries[mark]

    // Row 1: the design's name, and at the right what state it is in. Every part is cut to its room, so the row never wraps.
    const drafting = ui.drafting === true && design !== null && isBlank(design)
    const summary = over ? runSummary(run, elapsedOf(await read($, timesAtom), run), Math.max(8, columns - 24)) : null
    const state: { text: string; color: 'claude' | 'success' | 'error' | typeof FADED } =
      summary !== null
        ? { text: summary.text.replace(/^[a-z]+/, word => word.toUpperCase()), color: summary.color }
        : drafting
          ? { text: 'DRAFTING', color: 'claude' }
          : starting && marked
            ? { text: marked.kind === 'saved' ? 'START · a saved design' : marked.kind === 'blank' ? 'START · a blank design' : `START · from the ${marked.title} template`, color: FADED }
            : ui.status !== 'ready' || !design
              ? { text: 'design', color: FADED }
              : { text: `EDITING · ${!isSaved(ui.name) ? 'replay, not saved' : !ui.unsaved ? 'saved' : isBlank(design) ? 'not saved yet' : 'unsaved template'}`, color: FADED }
    // On the start screen the name is the one the marked row opens: the saved design's, or the one a new design gets.
    const shownName = starting && marked?.kind === 'saved' ? marked.id : ui.name
    // After the name, in a colour of its own, the design's facts (the agents it starts): left out where the row has no room for them.
    const headOf = (facts: string | null) => {
      const room = headColumns - COMMAND.length - 5 - state.text.length
      const count = facts !== null && room - facts.length - 3 >= 8 ? facts : null
      return (
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" flexShrink={0}>
            <Text bold color="claude">{COMMAND}</Text>
            <Text color={FADED}>{' / '}</Text>
            <Text bold>{clip(shownName, Math.max(8, room - (count === null ? 0 : count.length + 3)))}</Text>
            {count !== null && <Text color={FADED}>{' / '}</Text>}
            {count !== null && <Text key="design-facts" color="suggestion">{count}</Text>}
          </Box>
          <Box flexShrink={0}>
            <Text key="design-state" color={state.color}>{state.text}</Text>
          </Box>
        </Box>
      )
    }

    if (ui.status === 'closed') {
      return (
        <Box flexDirection="column">
          <Text bold>{`${GLYPH.diamond} ${DESIGN_PANE_TITLE}`}</Text>
          <Text color={FADED}>{`${GLYPH.railEnd} /${COMMAND} design <name> opens a design`}</Text>
        </Box>
      )
    }

    if (ui.status === 'error') {
      return (
        <Box flexDirection="column" paddingLeft={1}>
          {headOf(null)}
          <Text color="error">{`${file} could not be used: ${ui.error ?? 'unknown reason'}`}</Text>
          <Text color={FADED}>{`The file was left as it is. Fix or remove it, then run /${COMMAND} design ${ui.name} again.`}</Text>
        </Box>
      )
    }

    // What the screen is made of, the same for the start screen and the designer: rows of the detail pane, the
    // legend, the footer, and the frame that holds them.
    type Item = { rows: number; el: RenderChildren }
    type Tint = typeof FADED | 'error' | 'warning' | 'suggestion'
    const blank: Item = { rows: 1, el: <Text> </Text> }
    // The persona's pixels: half-blocks in its own colours, a row of spans to a row of cells.
    const spanRows = (rows: readonly (readonly PersonaSpan[])[]) =>
      rows.map(row => (
        <Box flexDirection="row" height={1} flexShrink={0}>
          {row.map(span => (
            <Text color={span.color} backgroundColor={span.ground}>{span.text}</Text>
          ))}
        </Box>
      ))
    const rowsOf = (items: readonly Item[]): number => items.reduce((sum, item) => sum + item.rows, 0)
    const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
    const line = (text: string, color?: Tint, bold?: true): Item => ({ rows: 1, el: <Text color={color} bold={bold} wrap="truncate-end">{text}</Text> })
    const lines = (rows: readonly string[], color?: Tint): Item[] => rows.map(row => line(row, color))
    // A label is quiet: `claude` is kept for what can be pressed and for the selection.
    const label = (text: string, color: 'suggestion' | 'error' = 'suggestion'): Item => line(text, color)
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
    // One row of keys, in the footer's legend and on the detail pane's last rows: each key in brackets in the accent colour, its word dim; all of it dim while the keys are in the prompt.
    const legendRow = (row: readonly LegendItem[]) => (
      <Text wrap="truncate-end" dimColor={focused ? undefined : true}>
        {row.flatMap((item, index) => [
          <Text color={focused ? 'claude' : FADED}>{`${index > 0 ? ' '.repeat(LEGEND_GAP) : ''}[${item.keys}]`}</Text>,
          <Text color={FADED}>{` ${item.word}`}</Text>,
        ])}
      </Text>
    )
    // The footer is its legend, centred: docked, one row where the pane is wide enough for its keys and two where it is
    // not, whatever they hold, so the footer keeps its height; inline, one row.
    const legendMost = !dock ? 1 : columns >= LEGEND_CORE_W ? 1 : LEGEND_WRAP_ROWS
    const legendOf = (items: readonly LegendItem[]) => (
      <Box key="design-legend" flexDirection="column" alignItems="center" height={legendMost} flexShrink={0}>
        {legendRows(items, columns, legendMost).map(legendRow)}
      </Box>
    )
    // The rows. Header, rules and footer keep theirs; the graph and the detail pane share the rest. Docked, a rule
    // stands under the header and one above the footer, and `stacked` (the detail pane under the graph) one between the two.
    // Inline the rows are few: no rule, what is said has the row over the keys, and the pane never asks for more rows than it has (it would scroll, and the header leave).
    const footRows = dock ? legendMost : 2
    const mainRowsFor = (stacked: boolean): number => Math.max(wide ? GRAPH_LEAST_ROWS + 2 : dock ? HINT_ROWS + 1 : 2, bodyRows - HEAD_ROWS - (dock ? 2 : 0) - (stacked ? 1 : 0) - footRows)
    // The key catcher, the ring's place while no field is open: in the tree, where it is the pane's first stop, and not drawn.
    const catcher = () =>
      Input && (
        <Box key="design-keys" display="none">
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
      const text = said === null ? '' : clip(said.text, saidW)
      if (!dock) {
        return (
          <Box key="design-message" flexDirection="column" alignItems="center" height={1}>
            <Text color={said?.color} wrap="truncate-end">{text === '' ? ' ' : text}</Text>
          </Box>
        )
      }
      if (text === '') return rule()
      const left = Math.max(0, Math.floor((columns - text.length - 2) / 2))
      return (
        <Text key="design-message" wrap="truncate-end">
          <Text color={RULE}>{'─'.repeat(left)}</Text>
          <Text color={said?.color}>{` ${text} `}</Text>
          <Text color={RULE}>{'─'.repeat(Math.max(0, columns - text.length - 2 - left))}</Text>
        </Text>
      )
    }
    // The keys that act on the detail pane, for its last rows: two rows docked, one inline or where the pane is short.
    const hintsOf = (items: readonly LegendItem[], width: number, rows: number): LegendItem[][] => legendRows(items, width, dock && rows >= 8 ? HINT_ROWS : 1)
    // The detail pane: its content, and on its last rows the keys that act on it.
    const detailBox = (width: number, rows: number, hints: readonly (readonly LegendItem[])[], items: readonly Item[]) => (
      <Box key="design-detail" flexDirection="column" width={width} height={rows} flexShrink={0}>
        {rows - hints.length > 0 && (
          <Box key="design-content" flexDirection="column" height={rows - hints.length} overflow="hidden">
            {/* Never squeezed: what does not fit is cut at the bottom, whole rows. */}
            <Box flexDirection="column" flexShrink={0}>
              {items.map(item => item.el)}
            </Box>
          </Box>
        )}
        <Box key="design-hints" flexDirection="column" height={hints.length} flexShrink={0}>
          {hints.map(legendRow)}
        </Box>
      </Box>
    )
    // One column of margin at each side: `columns` is the body's less the two. `detail` is null while the detail pane is hidden.
    const frame = (catching: boolean, head: RenderChildren, graph: RenderChildren, detail: RenderChildren | null, beside: boolean, mainRows: number, said: Said, legend: RenderChildren) => (
      <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
        {catching && catcher()}
        <Box flexDirection="row">
          <Box key="design-persona" flexDirection="column" width={SMALL_W} flexShrink={0}>
            {spanRows(smallPersona(pose))}
          </Box>
          <Box flexDirection="column" width={headColumns} height={HEAD_ROWS} flexShrink={0}>
            {head}
          </Box>
        </Box>
        {dock && rule()}
        {beside ? (
          <Box flexDirection="row" height={mainRows}>
            {graph}
            <Box width={3} flexShrink={0}>
              <Text color={RULE}>{Array.from({ length: mainRows }, () => ' │ ').join('\n')}</Text>
            </Box>
            {detail}
          </Box>
        ) : (
          <Box flexDirection="column">
            {graph}
            {dock && detail !== null && rule()}
            {detail}
          </Box>
        )}
        {saidRow(said)}
        {legend}
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
                  <Text bold wrap="truncate-end">{row.text}</Text>
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
                    <Text color={page === 3 ? 'claude' : undefined} bold={page === 3 ? undefined : true}>{row.key.padEnd(column)}</Text>
                    <Text>{row.text}</Text>
                  </Text>
                ),
              }
            : row.kind === 'blank'
              ? blank
              : line(row.text),
      )
    }
    const graphBoxOf = (width: number, rows: number, props: unknown, fallback: RenderChildren) => (
      <Box key="design-graph" flexDirection="column" width={width} height={rows} flexShrink={0}>
        {rows < 1 ? null : 'Client' in els ? <els.Client key={CANVAS_KEY} module="./canvas.tsx" width="100%" height={rows} props={props as never} /> : fallback}
      </Box>
    )

    // The splash, once a session: the conductor and its ensemble for a few beats, then the screen below. The keys wait
    // for that screen: no catcher is drawn under the splash. A pane too short for it goes without.
    if (!splashed) {
      startSplash($)
      const sceneRows = columns >= SCENE_COLUMNS && bodyRows >= SCENE_ROWS + 3 ? SCENE_ROWS : SOLO_ROWS
      if (bodyRows >= sceneRows + 3) {
        return (
          <Box flexDirection="column" paddingLeft={1} paddingRight={1} height={dock ? bodyRows : undefined} justifyContent="center">
            <Box key="design-splash" flexDirection="column" alignItems="center" height={sceneRows} flexShrink={0}>
              {'Client' in els ? <els.Client key={SPLASH_KEY} module="./splash.tsx" width="100%" height={sceneRows} props={{ rows: sceneRows } as never} /> : spanRows(splashScene(2, columns, sceneRows).lines)}
            </Box>
            <Text> </Text>
            <Box flexDirection="column" alignItems="center" flexShrink={0}>
              <Text bold color="claude">{`${GLYPH.diamond} ${PANE_TITLE}`}</Text>
              <Text color={FADED}>{SPLASH_NOTE}</Text>
            </Box>
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
      // The marked row's design, read-only: a saved one from its file (kept from the listing, read again after a reload), a template made anew.
      let shown: Design | null = null
      if (marked?.kind === 'saved') {
        if (previews[marked.id] === undefined) {
          const parsed = parseDesign(await $.fs.read(designFile(await $.session.root(), marked.id)).catch(() => ''))
          previews[marked.id] = parsed.ok ? parsed.design : null
        }
        shown = previews[marked.id] ?? null
      } else if (marked) shown = TEMPLATES.find(one => one.id === marked.id)?.make() ?? emptyDesign(ui.name)
      const mainRows = mainRowsFor(dock && !wide)
      // The keys: the list's on the detail pane's last rows, the rest in the footer.
      const keys = legendItems({ ring: 'start', placed: false, retype: false, empty: true, helping, locked: false, selected: false, container: false, nested: false, results: false, undo: false, redo: false, knobs: [], hidden: false })
      const legend = legendOf(keys.footer)
      const message = focused ? ui.notice : KEYS_CUE

      // The list: the saved designs, then the templates, one row each, the marked one said in `claude`.
      const nameW = Math.min(Math.max(...entries.map(one => one.title.length)), Math.max(8, Math.floor(detailW / 2) - 4))
      const countW = Math.max(...entries.map(one => (one.kind === 'blank' ? 0 : blocksWord(one.blocks).length)))
      const entryRow = (entry: (typeof entries)[number], at: number): Item => {
        const lit = at === mark
        const note = clip(entry.note, Math.max(0, detailW - 2 - nameW - 2 - countW - 2))
        return {
          rows: 1,
          el: (
            <Box flexDirection="row" height={1}>
              <Button key={`${START_KEY}${entry.kind}:${entry.id}`} plain onPress={() => openEntry($, at)}>
                <Text color="claude" bold>{lit ? '▸ ' : '  '}</Text>
                <Text color={lit ? 'claude' : undefined} bold>{clip(entry.title, nameW).padEnd(nameW)}</Text>
                <Text color={FADED}>{`  ${(entry.kind === 'blank' ? '' : blocksWord(entry.blocks)).padEnd(countW)}`}</Text>
                <Text color={FADED}>{note === '' ? '' : `  ${note}`}</Text>
              </Button>
            </Box>
          ),
        }
      }
      // How to name a new design first, and how to have Claude draft one: each command on a row of its own.
      const routes = [`A new design is named ${ui.name}. ${isDefaultName(ui.name) ? 'To name it first' : 'For another name'}:`, `  /${COMMAND} design <name>`, 'To have Claude draft one:', `  /${COMMAND} draft <name> <what you want>`]
      const detailRows = beside ? mainRows : Math.max(Math.min(HINT_ROWS + 1, mainRows), Math.min(mainRows - Math.max(GRAPH_LEAST_ROWS, Math.floor(mainRows * (1 - DETAIL_REST_SHARE) * 0.6)), helping ? mainRows : entries.length + 8))
      const hints = hintsOf(keys.detail, detailW, detailRows)
      const contentRows = Math.max(0, detailRows - hints.length)
      const listed = fit(4, contentRows, level => {
        const gaps = level < 1 ? [blank] : []
        const ways = level < 2 ? [...gaps, ...lines(routes.map(row => clip(row, detailW)), FADED)] : []
        // Short of rows, the saved designs are a window around the marked one; the templates are always all there.
        const room = level < 3 ? saved.length : Math.max(1, Math.min(SAVED_ROWS, contentRows - (entries.length - saved.length) - 3))
        const from = room >= saved.length ? 0 : listWindow(saved.length, room, Math.min(mark, saved.length - 1))
        const more = saved.length - Math.min(room, saved.length)
        return [
          ...(saved.length > 0 ? [label('Saved designs'), ...entries.slice(from, from + Math.min(room, saved.length)).map((entry, index) => entryRow(entry, from + index)), ...(more > 0 ? [line(`… ${more} more: w and s reach them`, FADED)] : []), ...gaps] : []),
          label('New from a template'),
          ...entries.slice(saved.length).map((entry, index) => entryRow(entry, saved.length + index)),
          ...ways,
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
      const stops = [ui.status, ui.name, saved.length, helping].join('|')
      if (stops !== ringStops) {
        ringStops = stops
        if (focused) settleRing($)
      }
      const preview = graphBoxOf(graphW, graphRows, shown ? { ...previewProps(shown, box), wheel: { from: LOAD, rows: wheelRows } } : null, null)
      return frame(
        true,
        // The agents the marked row's design starts, where it has blocks to count.
        headOf(shown !== null && !isBlank(shown) ? factsLine(shown) : null),
        shown ? preview : <Box key="design-graph" width={graphW} height={graphRows} flexShrink={0} />,
        detailBox(detailW, detailRows, hints, content),
        beside,
        mainRows,
        message === null ? null : { text: message, color: focused ? 'warning' : FADED },
        legend,
      )
    }
    if (!design) return <Box />

    // What takes the detail pane in place of the selected block: the add list (a block to add, or a block's type),
    // a help page. The first is the pane's only while it holds the keyboard: Escape hands the keys
    // to the prompt and no hook hears of it, so drawn without it they are closed to the eye.
    const picking = ui.picker !== null && !locked && focused
    const helping = !picking && ui.help > 0
    const hidden = ui.detailHidden === true && !picking && !helping

    // The widths. Beside the graph the detail pane has about a third, and one column of rule stands between them.
    const beside = wide && !hidden
    const detailW = beside ? detailWidth(columns) : columns
    const graphW = beside ? columns - detailW - 3 : columns
    // The view follows the selection where something other than the person's keys moved it out of sight.
    const viewRoot = viewRootOf(design, ui, graphW)

    // The keys that work now, in their fixed order: the graph's in the footer's right half, the detail pane's on its last rows.
    const history = histories[ui.name]
    const keys = legendItems({
      ring: !focused ? 'graph' : ui.picker !== null && !locked ? 'list' : ui.editing ? 'fields' : 'graph',
      placed: ui.picker?.anchorId !== undefined && ui.picker.retypeId === undefined,
      retype: ui.picker?.retypeId !== undefined,
      opens: picking && ui.picker ? pickerMatches(design, ui.picker)[ui.picker.pick ?? 0]?.opens === true : false,
      kinds: ui.picker?.block !== undefined && ui.picker.query === '',
      empty: isBlank(design),
      fixed: node?.type === 'start',
      helping,
      locked,
      selected: node !== undefined,
      container: canOpen(design, viewRoot, node?.id ?? null),
      nested: viewRoot !== null,
      results: over,
      undo: (history?.undo.length ?? 0) > 0,
      redo: (history?.redo.length ?? 0) > 0,
      // As the chips on the card name them.
      knobs: [1, 2].map(slot => (node ? (quickKnob(node, slot) ?? null) : null)).map(name => (name === null ? null : cap(name))),
      hidden,
    })
    const legend = legendOf(keys.footer)

    // What is said on the message row: a change just made (with the way back), a refused edit, the delete question, the lock.
    const said: Said =
      ui.notice !== null && (ui.notice !== LOCK_NOTICE || locked)
        ? { text: ui.notice.endsWith(UNDO_HINT) && !ui.notice.startsWith('redone: ') ? `Last change: ${ui.notice}` : ui.notice, color: noticeInforms(ui.notice) ? undefined : 'warning' }
        : locked
          ? { text: LOCK_NOTICE, color: FADED }
          : null
    // Without the keyboard the pane says nothing that names a key of its own: the cue takes the row, and what was said
    // follows it only stripped of its key, and only where both fit.
    const afterCue = ui.notice !== null ? withoutKeys(ui.notice) : null
    const cue =
      afterCue !== null && KEYS_CUE.length + 3 + afterCue.length <= saidW
        ? `${KEYS_CUE} · ${afterCue}`
        : afterCue !== null && /^(run|ask): /.test(afterCue)
          ? `${KEYS_CUE.split(' · ')[0] ?? KEYS_CUE} · ${afterCue}`
          : KEYS_CUE
    const message: Said = focused ? said : { text: cue, color: FADED }
    const mainRows = mainRowsFor(dock && !wide && !hidden)

    // The fields this block's type calls for (teach.ts says which), in the detail pane's order: the knobs typed as text.
    const parent = node ? flatten(design).find(row => row.node.id === node.id)?.parentId : undefined
    const around = parent === undefined ? undefined : findNode(design, parent)
    const knobs = node ? knobsOf(node, around?.type) : []
    const textKnobs = TEXT_KNOBS.filter(key => knobs.includes(key))
    // A field shows what is being typed in it (a draft) until it is saved: only the block, of the design, it was typed for.
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
    const matches = picking && ui.picker ? pickerMatches(design, ui.picker) : []
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
    // A keystroke in a field: kept as a draft of that block's field, and the pane is drawn again, to show all of the text under the field.
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
    const retype = async (target: DesignNode): Promise<void> => {
      await flushDrafts($)
      const step = await commit($, (before, held, context) => openRetype(before, held, target.id, context))
      if (!step.ui.picker) return
      pickGen++
      landOn($, pickerKey, 'block: click the filter to type in it')
    }

    // The detail pane's parts. A thin rule stands under its heading; a blank row between two fields and two sections, while there are rows for it.
    const thin: Item = { rows: 1, el: <Text color={RULE}>{'─'.repeat(detailW)}</Text> }
    /** A wrapped text cut to `most` rows, `…` on the last; `tail` keeps its end (where the typing is) and marks the start. */
    const capped = (rows: readonly string[], most: number, tail: boolean = false): string[] => {
      if (rows.length <= most) return [...rows]
      if (tail) return rows.slice(rows.length - most).map((row, index) => (index === 0 ? `…${row.slice(1)}` : row))
      return rows.slice(0, most).map((row, index) => (index === most - 1 ? `${clip(row, detailW - 1)}…` : row))
    }
    const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()
    // The ring's field, or the one it is on its way to: all of its text is drawn under it as it is typed.
    const ringAt = ringTo !== '' ? ringTo : ringOn
    const activeBase = fielding && isField(ringAt) ? baseOf(ringAt ?? '') : null
    // The door stands at the right end of the heading's row: two cells, empty, seen only for the moment the ring is on it.
    const DOOR_W = 2
    const heading: Item | null = node
      ? {
          rows: 1,
          el: (
            <Box key="design-heading" flexDirection="row" justifyContent="space-between" height={1}>
              <Text wrap="truncate-end">
                <Text color={ACCENT[node.type]} bold>{typeLabel(node)}</Text>
                {hasName(node) && <Text color={FADED}>{' / '}</Text>}
                {hasName(node) && <Text bold>{clip(node.name, Math.max(4, detailW - typeLabel(node).length - node.id.length - 5 - DOOR_W))}</Text>}
              </Text>
              <Box flexDirection="row" flexShrink={0}>
                <Text color={FADED}>{node.id}</Text>
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
              </Box>
            </Box>
          ),
        }
      : null
    const fieldLabel = (one: (typeof texts)[number]) => (
      <Text wrap="truncate-end">
        <Text color="suggestion">{cap(one.label)}</Text>
        {one.value.trim() === '' && named.has(one.knob) ? <Text color="error">{' [not set]'}</Text> : null}
      </Text>
    )
    // A field at rest: its label, then all of its value, wrapped. One press anywhere on it opens the fields on this one.
    const restField = (one: (typeof texts)[number], most: number): Item => {
      const value = oneLine(one.value)
      const rows = value === '' ? [] : capped(wrapText(value, detailW), most)
      const lost = value === '' && named.has(one.knob)
      const body = value === '' ? [<Text color={lost ? 'error' : FADED}>{NOT_SET}</Text>] : rows.flatMap((row, index) => (index === 0 ? [<Text>{row}</Text>] : ['\n', <Text>{row}</Text>]))
      return {
        rows: 1 + Math.max(1, rows.length),
        el: (
          <Box flexDirection="column" flexShrink={0}>
            <Button key={`${REST_KEY}${fieldKey(one.key, node?.id ?? '')}`} plain onPress={() => openFields($, one.key)}>
              {[<Text color="suggestion">{cap(one.label)}</Text>, '\n', ...body]}
            </Button>
          </Box>
        ),
      }
    }
    // A field open for typing: one line (the engine's field wraps only at the pane's full width), and, where the text is
    // longer than the line, all of it wrapped under the field: as typed so far under the ring's own, dim under the others.
    const openField = (one: (typeof texts)[number], most: number, others: boolean): Item => {
      const element = fieldKey(one.key, node?.id ?? '')
      const lit = activeBase === one.key
      const whole = oneLine(one.value)
      const shown = pinned(element, one.value)
      // Under it too while the field itself does not show all of it: letters typed on the ring's way stand beside it until the typing pauses.
      const under = (lit || others) && (whole.length > detailW - 4 || (pins[element]?.head ?? '') !== '') ? capped(wrapText(one.value, detailW), most, lit) : []
      return {
        rows: 2 + under.length,
        el: (
          <Box flexDirection="column" flexShrink={0}>
            {fieldLabel(one)}
            {/* A row of its own, under its label: the whole width is the text's. */}
            <Box flexDirection="column" flexShrink={0} height={1}>
              {Input && (
                <Input
                  key={element}
                  placeholder={one.placeholder}
                  value={shown}
                  submitLabel=""
                  onInput={(value, input) => typeIn(one.key, input.element, value)}
                  onSubmit={value => save(one.key, value)}
                />
              )}
            </Box>
            {under.map(row => (
              // To the full width: a row that got shorter leaves no cells of the one before it.
              <Text color={lit ? undefined : FADED} wrap="truncate-end">{row.padEnd(detailW)}</Text>
            ))}
          </Box>
        ),
      }
    }
    // Under the fields, one to a row, a label and its value: the block's type, which a press changes; and, read only, the
    // worktree its file asks for (Claude sets that knob, the pane has no control for it).
    const PICKER_LABEL_W = 11
    const typeLine = (target: DesignNode): Item => ({
      rows: 1,
      el: (
        // The row is the first of the block's own. A step back from the name lands on it and is passed on to the graph
        // (the `ui.focus` hook): it is pressed with the pointer, and `t` opens the same list.
        <Box flexDirection="row" flexShrink={0}>
          <Box width={PICKER_LABEL_W} flexShrink={0}>
            <Button key={`${LABEL_KEY}${TYPE_KEY}`} plain onPress={() => retype(target)}>
              <Text color="suggestion">{'Block'.padEnd(PICKER_LABEL_W)}</Text>
            </Button>
          </Box>
          {/* The block is picked from the same list one is added from: every block and kind on a row with what it does. */}
          <Button key={TYPE_KEY} plain label={`${typeName(target)} ▾`} onPress={() => retype(target)} />
        </Box>
      ),
    })
    // The start block has no type to pick: it becomes no other block.
    const blockItems: Item[] = node && editable && node.type !== 'start' ? [typeLine(node)] : []
    // What Claude set and the pane has no control for, read only: the worktree, the subagent it runs as.
    const setItems: Item[] = node
      ? [
          ...(node.knobs?.isolation === 'worktree' ? [line(`${'Isolation'.padEnd(PICKER_LABEL_W)}worktree`, FADED)] : []),
          ...((node.knobs?.agentType ?? '') !== '' ? [line(clip(`${'Agent type'.padEnd(PICKER_LABEL_W)}${node.knobs?.agentType ?? ''}`, detailW), FADED)] : []),
        ]
      : []
    // The selected block's agents, while a run is laid over the design.
    const agentItems = (most: number): Item[] => {
      if (!agents || agents.shown.length === 0) return []
      const all = agents.shown.length + agents.rest
      const shown = agents.shown.slice(0, Math.max(1, all > most ? most - 1 : most))
      return [
        label('Run'),
        ...shown.map(agent => ({
          rows: 1,
          el: (
            <Text wrap="truncate-end" color={agent.status === 'failed' ? 'error' : agent.status === 'running' ? 'claude' : undefined}>
              {`${agent.status === 'failed' ? FAILED : agent.status === 'running' ? GLYPH.dot : GLYPH.done} ${agent.title}  ${agent.status} · ${fmtTokens(agent.tokens)}`}
            </Text>
          ),
        })),
        ...(shown.length < all ? [line(`… ${all - shown.length} more`, FADED)] : []),
      ]
    }
    // The selected block, as far as the rows go. With all of them: a blank row between two sections, every text whole.
    // Short of rows, with the fields open, the whole texts under the ones the ring is not in go first (each is in its
    // field, cut: they are said twice); then the blank rows; then what the type means (the help page says it); then
    // the long texts are cut, to fewer rows each time.
    const CUTS = [8, 5, 3, 2, 1] as const
    const inspector = (level: number): Item[] => {
      if (!node || !heading) return []
      const most = level < 4 ? Infinity : (CUTS[level - 4] ?? 1)
      // The block and its kind come first, always: what the rest of the pane is about.
      const sections: Item[][] = blockItems.length > 0 ? [blockItems] : []
      if (level < 3) {
        sections.push([label('Meaning'), ...lines(capped(wrapText(`${cap(teachOf(node).hint)}.`, detailW), most)), ...lines(capped(wrapText(`${cap(useWhen(node))}.`, detailW), most), FADED)])
      }
      for (const one of ownProblems) {
        const parts = problemParts(one.message)
        sections.push([label('Error', 'error'), ...lines(capped(wrapText(parts.error, detailW), most)), ...(parts.fix === '' ? [] : [label('Fix'), ...lines(capped(wrapText(parts.fix, detailW), most))])])
      }
      if (editable) for (const one of texts) sections.push([fielding ? openField(one, most, level < 1) : restField(one, most)])
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
                ...more.flatMap((line, index) => ['\n', <Text color={index < split ? undefined : FADED}>{`  ${line}`}</Text>]),
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
        ...firstLines(addHeading(design, ui.picker), detailW, 2).map(row => line(row, undefined, true)),
        thin,
        {
          rows: 1,
          el: (
            <Box flexDirection="row" height={1}>
              <Box flexShrink={0}>
                {/* The letters taken as keys before they turned out to start a name: said here, they are not in the field. */}
                <Text>
                  <Text color="suggestion">{'Filter '}</Text>
                  {ui.picker.lead ?? ''}
                </Text>
              </Box>
              <Box width={Math.max(8, detailW - 7 - (ui.picker.lead ?? '').length)}>
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

    // Nothing selected: the design's goal, and how to go on.
    const goal = goalOf(design)
    const idle = (): Item[] => [
      label('Goal'),
      ...lines(wrapText(goal === '' ? 'Not said yet.' : goal, detailW).slice(0, 6), goal === '' ? FADED : undefined),
      // While Claude drafts, the graph says so, once.
      ...(drafting
        ? []
        : [
            blank,
            label(!isBlank(design) ? 'Nothing selected' : 'An empty design'),
            ...lines(
              wrapText(
                !isBlank(design)
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
    const stray = (): Item[] => [line('UNMAPPED', undefined, true), ...lines(wrapText('Agents whose label names no block of this design.', detailW), FADED), blank, ...agentItems(AGENT_ROWS_MAX)]

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
      { ...graphProps(design, ui, box, overlay), wheel: { from: LOAD, rows: wheelRows }, ...(focused ? {} : { quiet: true }) },
      flatten(design)
        .slice(0, graphRows)
        .map(row => (
          <Text color={row.node.id === ui.selectedId ? 'claude' : undefined} bold={row.node.id === ui.selectedId ? true : undefined} wrap="truncate-end">
            {`${row.node.id === ui.selectedId ? GLYPH.diamond : ' '} ${'  '.repeat(row.depth)}${TEACH[row.node.type].glyph} ${row.node.id}  ${row.node.name}`}
          </Text>
        )),
    )

    return frame(catching, headOf(factsLine(design)), graph, hidden ? null : detailBox(detailW, detailRows, hints, content), beside, mainRows, message, legend)
  })
}
