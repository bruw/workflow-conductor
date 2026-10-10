import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { FLASH_CLEAR_MS, TOOL_FULL_NAME, TOOL_NAME, TOOL_SCHEMA, applyOps, clearFlash, designOfPath, diffDesigns, draftBrief, editReport, guideText, readReport, replaceDesign, showEdit, toolDescription } from '../src/design/chat'
import { lint, preflightLine } from '../src/design/lints'
import { buildHandoff, handoffPrompt, handoffTarget, reviewPrompt } from '../src/design/handoff'
import { EFFORTS, NODE_TYPES, emptyDesign, findNode, flatten, parseDesign, serializeDesign } from '../src/design/model'
import type { Design, NodeType } from '../src/design/model'
import type { NodePatch } from '../src/design/ops'
import {
  BLANK_TEMPLATE_ID,
  BOARD_MIN_ROWS,
  DEFAULT_DESIGN_NAME,
  HELP_PAGES,
  LOCK_NOTICE,
  RUN_KEYS_HINT,
  TEXT_KNOBS,
  VOTE_CHOICES,
  agentsOf,
  bareTarget,
  carryUi,
  compactOf,
  dockColumns,
  elapsedOf,
  helpPage,
  initialTimes,
  overlaysDesign,
  runOverlay,
  runSummary,
  DESIGN_DIR,
  DESIGN_PANE_ID,
  DESIGN_PANE_TITLE,
  INHERIT,
  MODEL_CHOICES,
  applyMessage,
  applyOp,
  describeDesign,
  freeName,
  handoffOf,
  isSaved,
  placeLabel,
  retypeBlock,
  retypeChoices,
  savedDesign,
  savedLine,
  boardProps,
  boardView,
  inspectorCollapsed,
  inspectorSummary,
  designFile,
  designName,
  initialUi,
  openDesign,
  patchNode,
  pickBlock,
  startDesign,
  typePicker,
  wrapRows,
} from '../src/design/session'
import type { DesignUi, RunContext, SavedDesign, Step, TextKnob, ToolbarOp } from '../src/design/session'
import { FIELD_LABEL, FIELD_PLACEHOLDER, TEACH, fuzzy, knobsOf, useWhen } from '../src/design/teach'
import { TEMPLATES } from '../src/design/templates'
import { emptyRunState } from '../src/run/events'
import { replayDesignEvents } from '../src/run/replay'
import type { Tracker } from '../src/run/tracker'
import { UNMAPPED_ID, clip, wrapText } from '../src/ui/board-layout'
import { parseBoardMessage } from '../src/ui/board-model'
import { FAILED, fmtTokens } from '../src/ui/rail'
import { GLYPH } from '../src/ui/theme'

// The designer: the hooks module owns the Design and everything chosen on it
// (selection, grab, picker), applies ops, saves the file and draws the toolbar
// and inspector. The flow board (./canvas.tsx) is a Client that draws the
// design from props, owns only its pan and a drag in flight, and posts here.

const COMMAND = 'conductor'
const CANVAS_KEY = 'canvas'
const TITLE_KEY = 'design-title'
const NOTES_KEY = 'design-notes'
const PICKER_KEY = 'design-add'
/** The field of the design's description (its goal), under the header while `d` has it open. */
const DESC_KEY = 'design-description'
const GOAL_PLACEHOLDER = 'what this workflow is for, in a sentence: Claude reads it as the goal'
/** Saved designs the picker lists; the rest are a count. */
const SAVED_ROWS = 8
/** Design files read for a listing, at most. */
const SAVED_MAX = 60
/** The address of a knob's text field: `design-knob:prompt`. */
const KNOB_KEY = 'design-knob:'
/** Whether the ring on this element means a field is being typed in. */
const isField = (element: string | undefined): boolean => element === TITLE_KEY || element === NOTES_KEY || (element ?? '').startsWith(KNOB_KEY)
/** Where the ring rests: on a Button, so letters are hotkeys (on an Input they would be typed). On `edit`, so Enter edits, as it does on the board. */
const HOME_KEY = 'key:edit'
/** Where it rests while a run locks editing: `edit` is not drawn then. */
const HOME_LOCKED_KEY = 'key:down'
/** The keys that still do something while a run locks editing. */
const LOCKED_OPS: readonly ToolbarOp[] = ['left', 'down', 'up', 'right', 'compact', 'card']
/** The key that goes to the next lint is drawn only while there is one; the key that puts a run's results away only while they show. */
const LINT_OPS: readonly ToolbarOp[] = ['nextLint']
const RUN_OVER_OPS: readonly ToolbarOp[] = ['clearRun']
/** Block types the add picker lists with their hint at once; the rest are a count, and typing narrows. */
const PICK_ROWS = { dock: 12, inline: 4 } as const
/** How long after the command's answer the handoff prompt is submitted. */
export const SUBMIT_DELAY_MS = 64
/** A redraw's worth of wait before the ring moves to an element just drawn. */
export const FOCUS_DELAY_MS = 48
/** What /conductor this module answers: its verbs, `replay design`, and no argument at all (a run shown on its design); run.tsx answers the rest. */
export const DESIGN_VERBS = /^\s*((design|run|list|draft)(\s|$)|replay\s+design(\s|$)|$)/
/** One digit or one lowercase letter each: all a Button's `hotkey` takes (no space, no `?`). One row of them. */
const TOOLBAR: readonly { op: ToolbarOp; hotkey: string; label: string }[] = [
  { op: 'left', hotkey: 'h', label: '←' },
  { op: 'down', hotkey: 'j', label: '↓' },
  { op: 'up', hotkey: 'k', label: '↑' },
  { op: 'right', hotkey: 'l', label: '→' },
  { op: 'addAfter', hotkey: 'a', label: 'add' },
  { op: 'addInside', hotkey: 'i', label: 'in' },
  { op: 'remove', hotkey: 'x', label: 'del' },
  { op: 'grab', hotkey: 'g', label: 'grab' },
  { op: 'edit', hotkey: 'e', label: 'edit' },
  { op: 'describe', hotkey: 'd', label: 'goal' },
  { op: 'compact', hotkey: 'z', label: 'compact' },
  { op: 'card', hotkey: 'c', label: '?' },
  { op: 'nextLint', hotkey: 'n', label: 'next lint' },
  { op: 'review', hotkey: 'v', label: 'ask Claude' },
  { op: 'run', hotkey: 'r', label: 'run' },
  { op: 'clearRun', hotkey: 'q', label: 'clear run' },
]
/** A key's address in the pane. `run` keeps the one it had as a Button of its own. */
const keyOf = (op: ToolbarOp): string => (op === 'run' ? 'design-run' : `key:${op}`)
const EDIT_HINT = 'click the title field, or press tab to reach it'
/** The board gets at least this many rows (a card inside a container): the pane scrolls before the board shrinks further. */
const BOARD_ROOM_MIN = 8
/** The board's rows under an inline pane's help card. */
const BOARD_HELP_ROWS = 3
/** Docked, the board keeps at least this share of the pane's rows whatever the inspector holds. */
const BOARD_SHARE = 0.55
/** Rows asked for when the pane sits inline above the prompt: a nested container and the inspector under it. */
export const PANE_ROWS = 28
/** Columns asked for when the pane is docked beside the transcript: the toolbar on one row, and room for a card's notes. */
export const PANE_COLUMNS = 86
/**
 * The terminal's width as the last command saw it (`e.presentation.columns`): the
 * only place a hook is told it. Undefined until a command has run in this load.
 */
let terminalColumns: number | undefined
/**
 * What `$.ui.open` is asked: with the keyboard (`focus`), or shown without it (an
 * edit from chat opens the pane and the person goes on typing in the prompt).
 * The dock's width is asked so that the transcript keeps about half the terminal.
 */
const paneArgs = (focus: boolean): { id: string; title: string; rows: number; columns: number; focus?: true } => ({
  id: DESIGN_PANE_ID,
  title: DESIGN_PANE_TITLE,
  rows: PANE_ROWS,
  columns: dockColumns(PANE_COLUMNS, terminalColumns),
  ...(focus ? { focus: true as const } : {}),
})
/** What `r` leaves under the board: what the design implies, then what to do with the request now in the prompt box. */
const runNotice = (design: Design | null, line: string, isFilled: boolean): string =>
  `run: ${design ? `${preflightLine(design)} · ` : ''}${isFilled ? 'say what to run it on in the prompt, then Enter' : `type in the prompt: ${line.trim()} …`}`
/**
 * What is being typed into the selected block's fields and not sent yet, by field key.
 * Enter on any one field saves them all: a title typed, then Tab, then Enter on
 * another field, is kept. Not state: a keystroke must not redraw the pane.
 */
let drafts: { id: string | null; values: Record<string, string> } = { id: null, values: {} }
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
const timesAtom = atom({ plugin: 'conductor', key: 'runTimes' } as const, initialTimes())

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 160)

export const registerDesign = (on: On, tracker: Tracker): void => {
  // run.tsx registers /conductor and answers its own verbs; it passes these on.
  on('command.run', { command: 'conductor', args: DESIGN_VERBS }, async ($, e, next) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    terminalColumns = e.presentation?.columns ?? terminalColumns
    // No argument: a run in progress on its design (run.tsx's phase view when it came from none).
    // With no run in progress: the design last opened, with the keyboard; the picker when there is none.
    const bare = verb === '' ? bareTarget((await read($, runAtom)).status, await read($, runDesignAtom), await read($, uiAtom)) : null
    if (bare !== null && bare.view === 'run') return next(e)
    const shown = bare !== null && bare.view === 'design' && bare.live ? bare.name : null
    const root = await $.session.root()

    if (verb === 'replay') {
      const [, templateId, speed] = rest
      const template = TEMPLATES.find(one => one.id === templateId)
      if (!template || (speed !== undefined && speed !== 'fast' && speed !== 'slow')) {
        return { text: `Usage: /${COMMAND} replay design <${TEMPLATES.map(one => one.id).join('|')}> [fast|slow]` }
      }
      // A replay's design lives in the session only (`isSaved`): no file is written, and none is listed.
      const name = designName(`replay-${template.id}`)
      const made: Design = { ...template.make(), name }
      await update($, designAtom, () => made)
      await update($, uiAtom, held => ({ ...carryUi(held, initialUi()), name, status: 'ready' as const, selectedId: made.nodes[0]?.id ?? null }))
      await $.ui.open(paneArgs(true))
      // A replay reuses its run id: the clock of the one before must not time this one.
      await update($, timesAtom, () => initialTimes())
      tracker.handoff(handoffOf(name, made))
      tracker.replay(replayDesignEvents(made, name), speed ?? 'fast')

      return { text: `Replaying a made-up run over the ${template.id} template (${speed ?? 'fast'}); token counts are made up, and nothing is saved.` }
    }

    // Bare `design` (and bare /conductor with nothing opened yet): the saved designs to pick from, above the templates.
    const fresh = rest.join('').trim() === '' && (verb === 'design' || (bare !== null && bare.view === 'design' && !bare.live && bare.name === DEFAULT_DESIGN_NAME && (await read($, uiAtom)).status === 'closed'))
    const saved: SavedDesign[] = []
    if (verb === 'list' || fresh) {
      const dir = `${root.replace(/\/+$/, '')}/${DESIGN_DIR}`
      const entries = await $.fs.list(dir).catch(() => [])
      const names = entries
        .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
        .map(entry => entry.name.slice(0, -'.json'.length))
        .filter(isSaved)
        .sort()
      for (const one of names.slice(0, SAVED_MAX)) saved.push(savedDesign(one, await $.fs.read(`${dir}/${one}.json`).catch(() => '')))
    }

    if (verb === 'list') {
      if (saved.length === 0) return { text: `No saved designs yet: /${COMMAND} design <name> starts one.` }

      return { text: [`Saved designs (${DESIGN_DIR}), open one with /${COMMAND} design <name>:`, ...saved.map(one => `  ${savedLine(one)}`)].join('\n') }
    }

    if (verb === 'draft') {
      const [first = '', ...words] = rest
      const brief = words.join(' ').trim()
      if (first === '' || brief === '') return { text: `Usage: /${COMMAND} draft <name> <what the workflow should do>` }
      const name = designName(first)
      const path = designFile(root, name)
      if (await $.fs.exists(path)) {
        const saved = parseDesign(await $.fs.read(path).catch(() => ''))
        // A draft never writes over work: an existing design is changed by asking in chat.
        if (!saved.ok || saved.design.nodes.length > 0) {
          return { text: `A design named ${name} exists (${DESIGN_DIR}/${name}.json). Open it with /${COMMAND} design ${name} and ask for changes in chat, or draft under another name.` }
        }
      }
      const blank: Design = { ...emptyDesign(name), description: brief }
      try {
        await $.fs.write(path, serializeDesign(blank))
      } catch (error) {
        return { text: `Design ${name} could not be saved: ${reason(error)}` }
      }
      await update($, designAtom, () => blank)
      // The empty board says Claude is drafting until the first blocks land.
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
      if (!(await $.fs.exists(path))) return { text: `No design named ${name} (${DESIGN_DIR}/${name}.json). /${COMMAND} design ${name} starts one.` }
      let body: string
      try {
        body = await $.fs.read(path)
      } catch (error) {
        return { text: `Design ${name} could not be read: ${reason(error)}` }
      }
      const parsed = parseDesign(body)
      if (!parsed.ok) return { text: `Design ${name} is not valid, nothing was handed off: ${parsed.error}` }
      if (parsed.design.nodes.length === 0) return { text: `Design ${name} is empty: add a block before running it.` }

      const handoff = buildHandoff(parsed.design, path)
      // The next run to start is this design's: its agents count against these ids.
      tracker.handoff(handoffOf(name, parsed.design))
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
      const facts = preflightLine(parsed.design, { blocks: false })
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
    const path = designFile(root, name)
    // The run's design, or the one last worked on, is often already loaded: it is shown as it stands.
    if (verb === '' && previous.name === name && previous.status === 'ready' && (await read($, designAtom)) !== null) {
      // A field left open when the keyboard went to the prompt is closed: the keys are keys again.
      if (previous.editing || previous.describing) await update($, uiAtom, held => ({ ...held, editing: false, describing: false, freshId: null }))
      await $.ui.open(paneArgs(true))

      return { text: shown !== null ? `Design ${name} opened with its run.` : `Design ${name} opened.` }
    }
    if (fresh && saved.length > 0) {
      // Coming back: the saved designs first. A template starts a new design under a name none of them has.
      const started = openDesign(freeName(saved.map(one => one.name)), undefined, previous)
      await update($, designAtom, () => null)
      await update($, uiAtom, () => ({ ...started.ui, saved }))
      await $.ui.open(paneArgs(true))

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
    await update($, designAtom, () => step.design)
    await update($, uiAtom, () => step.ui)
    // With the keyboard, the toolbar's hotkeys work at once: no click on the canvas.
    await $.ui.open(paneArgs(true))

    if (step.ui.status === 'error') return { text: `Design ${name} could not be opened: ${step.ui.error}` }

    return { text: step.ui.status === 'pick' ? `No design named ${name} yet: pick a template in the pane.` : `Design ${name} opened.` }
  })

  // The tool Claude edits a design with. The matcher is always true: run.tsx holds the unmatched session.start.
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    await $.tool.register({ name: TOOL_NAME, description: toolDescription(), inputSchema: TOOL_SCHEMA, isDeferred: false })

    return next(e)
  })

  // The hand-off as a prompt: `r` fills the box with the request, the person says what to run it on
  // and sends it. The conventions go with the prompt as hidden context (the same text
  // `/conductor run` answers with), and the run that starts is counted against the design.
  on('prompt.submit', { text: /^\s*Implement and run the "/ }, async ($, e, next) => {
    const name = handoffTarget(e.text)
    if (name === null || !isSaved(name)) return next(e)
    const path = designFile(await $.session.root(), name)
    if (!(await $.fs.exists(path))) return next(e)
    const parsed = parseDesign(await $.fs.read(path).catch(() => ''))
    if (!parsed.ok || parsed.design.nodes.length === 0) return next(e)
    tracker.handoff(handoffOf(name, parsed.design))
    await update($, uiAtom, held => ({ ...held, follow: true, runCleared: false, notice: held.notice?.startsWith('run: ') ? null : held.notice }))
    // `/conductor run` recorded the conventions with its own answer: once is enough.
    if (delivered === name) {
      delivered = null

      return next(e)
    }

    return next({ ...e, context: [...(e.context ?? []), ...buildHandoff(parsed.design, path).context] })
  })

  // The design tool. Every edit is made by src/design/chat.ts on the mod's own
  // state, so the board redraws from the atoms and nothing unchecked is saved.
  on('tool.call', { tool: TOOL_FULL_NAME }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const action = input.action
    if (action === 'guide') return { result: guideText() }
    if (action !== 'read' && action !== 'apply' && action !== 'write') return { deny: 'action must be one of read, apply, write, guide' }

    const ui = await read($, uiAtom)
    const asked = typeof input.name === 'string' && input.name.trim() !== '' ? designName(input.name) : null
    const name = asked ?? (ui.status === 'ready' ? ui.name : null)
    if (name === null) return { deny: `No design is open on the board and no name was given. Pass name, or ask the user to open one with /${COMMAND} design <name>.` }
    const path = designFile(await $.session.root(), name)
    const isOpen = ui.status === 'ready' && ui.name === name
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
    if (action === 'read') return { result: readReport(design, { open: isOpen, selectedId: isOpen ? ui.selectedId : null, locked }) }
    // The lock the board applies to the person's own edits.
    if (locked) return { deny: `Design ${name} is being run: editing is locked until the run ends, for the board and for you alike. Tell the user; do not retry.` }

    const edit = action === 'apply' ? applyOps(design, input.ops, input.description) : replaceDesign(design, input.nodes, input.description)
    if (!edit.ok) return { deny: edit.error }
    try {
      if (isSaved(name)) await $.fs.write(path, serializeDesign(edit.design))
    } catch (error) {
      return { deny: `Design ${name} could not be saved, nothing was changed: ${reason(error)}` }
    }
    await update($, designAtom, () => edit.design)
    await update($, uiAtom, held => showEdit(held, name, edit.design, edit))
    const seq = (await read($, uiAtom)).flash?.seq ?? 0
    // Shown, but the keyboard stays where the person is typing.
    await $.ui.open(paneArgs(false)).catch(() => undefined)
    $.clock.after(FLASH_CLEAR_MS, () => {
      void update($, uiAtom, held => clearFlash(held, seq))
    })

    return { result: editReport(edit.design, edit) }
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
    const answer = await next(e)
    const ui = await read($, uiAtom)
    if (answer.deny !== undefined || answer.isError === true || ui.name !== name || ui.status === 'closed') return answer
    const parsed = parseDesign(await $.fs.read(designFile(root, name)).catch(() => ''))
    if (!parsed.ok) {
      $.ui.toast(`conductor: ${name}.json is not a valid design (${parsed.error.slice(0, 80)}); the board keeps the last good one`)

      return answer
    }
    const before = ui.status === 'ready' ? await read($, designAtom) : null
    await update($, designAtom, () => parsed.design)
    await update($, uiAtom, held => showEdit(held, name, parsed.design, diffDesigns(before, parsed.design)))
    const seq = (await read($, uiAtom)).flash?.seq ?? 0
    $.clock.after(FLASH_CLEAR_MS, () => {
      void update($, uiAtom, held => clearFlash(held, seq))
    })

    return answer
  })

  on('ui.message', { requestId: DESIGN_PANE_ID, element: CANVAS_KEY }, async ($, e, next) => {
    const message = parseBoardMessage(e.data)
    if (!message) return next(e)

    const design = await read($, designAtom)
    const ui = await read($, uiAtom)
    const run = await read($, runAtom)
    const over = overlaysDesign(run, await read($, runDesignAtom), ui)
    const locked = over && run.status === 'running'
    const step = applyMessage(design, ui, message, over ? { run, locked } : {})
    let nextUi = step.ui
    if (step.changed && step.design) {
      try {
        if (isSaved(nextUi.name)) await $.fs.write(designFile(await $.session.root(), nextUi.name), serializeDesign(step.design))
      } catch (error) {
        nextUi = { ...nextUi, notice: `not saved: ${reason(error)}` }
      }
    }
    // `r` on the board is the toolbar's run: the request goes into the prompt box, for the person to finish and send.
    if (message.kind === 'key' && message.op === 'run' && !locked) {
      if (!isSaved(nextUi.name)) nextUi = { ...nextUi, notice: 'run: a replay is not a saved design, there is nothing to hand off' }
      else {
        const line = handoffPrompt(nextUi.name)
        const filled = await $.prompt.fill({ text: line }).catch(() => ({ isFilled: false }))
        nextUi = { ...nextUi, notice: runNotice(step.design, line, filled.isFilled) }
      }
    }
    // `v`: the question goes into the prompt box; the design tool gives Claude the design, the selection and the lints.
    if (message.kind === 'key' && message.op === 'review') {
      const filled = await $.prompt.fill({ text: reviewPrompt(nextUi.name) }).catch(() => ({ isFilled: false }))
      nextUi = { ...nextUi, notice: filled.isFilled ? 'ask: the question is in the prompt: change it as you like, then Enter' : `ask: type in the prompt: ${reviewPrompt(nextUi.name).trim()}` }
    }
    // Writing the atoms redraws the pane, which hands the board its next props.
    if (step.design !== design) await update($, designAtom, () => step.design)
    if (nextUi !== ui) await update($, uiAtom, () => nextUi)
    // "Edit" and a `+` need a field to type in. The board holds the keyboard after
    // the click that reached here, so the pane takes it back first; the field exists
    // once the update above is drawn, so the ring moves there a frame later.
    const edits = (message.kind === 'edit' || (message.kind === 'key' && message.op === 'edit')) && nextUi.editing
    const picks = nextUi.picker !== null && ui.picker === null
    const describes = nextUi.describing && !ui.describing
    if (edits || picks || describes) {
      await $.ui.open(paneArgs(true))
      const key = edits ? TITLE_KEY : picks ? PICKER_KEY : DESC_KEY
      // The field may not be drawn yet on the first try (the pane redraws for the update above): one more try, then the hint.
      const land = async (tries: number): Promise<void> => {
        const moved = await $.ui.focus({ requestId: DESIGN_PANE_ID, key }).catch((error: unknown) => ({ deny: reason(error) }))
        if (moved.deny === undefined) return
        if (tries > 0) $.clock.after(FOCUS_DELAY_MS * 2, () => void land(tries - 1))
        else if (edits) await update($, uiAtom, held => ({ ...held, notice: `edit: ${EDIT_HINT}` }))
      }
      $.clock.after(FOCUS_DELAY_MS, () => void land(1))
    }

    return {}
  })

  // The ring on one of the two fields is "editing": the engine wraps a focused
  // field over as many rows as its text takes, so the pane makes room for that
  // (and an inline pane shows its fields at all). The person moving the ring off
  // them ends it; the mod's own moves (a field's Enter sends the ring home) are
  // settled where they are made.
  on('ui.focus', { requestId: DESIGN_PANE_ID }, async ($, e, next) => {
    const moved = await next(e)
    if (moved.deny !== undefined) return moved
    const onField = isField(e.element)
    const held = await read($, uiAtom)
    if (held.status === 'ready' && held.editing !== onField && (onField || e.origin.kind === 'person')) await update($, uiAtom, ui => ({ ...ui, editing: onField }))
    // The goal's field closes when the person moves the ring off it.
    if (held.status === 'ready' && held.describing && e.element !== DESC_KEY && e.origin.kind === 'person') await update($, uiAtom, ui => ({ ...ui, describing: false }))

    return moved
  })

  on('ui.render', { component: 'Pane', requestId: DESIGN_PANE_ID }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const ui = await read($, uiAtom)
    const design = await read($, designAtom)
    const file = `${DESIGN_DIR}/${ui.name}.json`
    const columns = Math.max(20, (e.props.bodyColumns || 80) - 2)
    // The run laid over this design, when it was started from it.
    const run = await read($, runAtom)
    const over = overlaysDesign(run, await read($, runDesignAtom), ui)
    const locked = over && run.status === 'running'
    // The tick clock is read only while it matters, so an idle pane is not redrawn by it.
    const overlay = over ? runOverlay(run, locked ? await read($, clockAtom) : 0) : undefined
    const placement = e.props.placement === 'inline' ? 'inline' : 'dock'
    // Whether the pane holds the keyboard: Escape hands it to the prompt, and a field left open then is closed to the eye.
    const focused = e.props.isFocused !== false
    const compact = compactOf(ui, placement)
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 48
    const node = design === null || ui.selectedId === null ? undefined : findNode(design, ui.selectedId)
    const lints = design ? lint(design) : []
    // The header is one row, always: the name, how many lints stand, and at the right the run in as many words as fit.
    const lintMark = lints.length > 0 ? `${GLYPH.lint} ${lints.length}` : ''
    const fullTitle = `wf: ${ui.name}`
    const summary = over ? runSummary(run, elapsedOf(await read($, timesAtom), run), columns - Math.min(fullTitle.length, 16) - (lintMark === '' ? 0 : lintMark.length + 2) - 2) : null
    const headRight = summary !== null ? summary.text : 'design'
    const titleText = clip(fullTitle, Math.max(8, columns - headRight.length - (lintMark === '' ? 0 : lintMark.length + 2) - 2))
    // What the design is for. Docked it has a row under the header; inline (few rows) it follows the name.
    const goal = (design?.description ?? '').replace(/\s+/g, ' ').trim()
    const describing = ui.describing === true && !locked && design !== null
    const goalRoom = columns - titleText.length - (lintMark === '' ? 0 : lintMark.length + 2) - headRight.length - 7
    const goalInline = placement === 'inline' && !describing && goalRoom >= 16 ? clip(goal === '' ? 'd: say what it is for' : goal, goalRoom) : ''
    // Its field, while typed in, wraps its text: a few rows for that.
    const goalRows = describing ? 1 + Math.min(4, 1 + wrapText(goal, Math.max(8, columns - 4)).length) : placement === 'dock' ? 1 : 0
    const lintLines = node ? lints.filter(one => one.nodeId === node.id).flatMap(one => wrapText(`${GLYPH.lint} ${one.message}`, columns)) : []
    const agents = over && ui.selectedId !== null ? agentsOf(run, ui.selectedId) : null
    const agentRows = agents ? agents.shown.length + (agents.rest > 0 ? 1 : 0) : 0
    const picking = ui.picker !== null && !locked
    // The help card takes the inspector's place, a page at a time: it never squeezes the board.
    const help = !picking && ui.help > 0 ? helpPage(ui.help, node?.type, file, columns) : null
    // An inline pane has few rows: its inspector is one line until a field is being typed in.
    const collapsed = inspectorCollapsed(placement, { editing: ui.editing && focused })
    // What is said right under the board: a refused edit, the delete question, what a grab's keys do, the lock.
    const message: { text: string; color: 'warning' | 'subtle' } | null =
      ui.notice !== null && (ui.notice !== LOCK_NOTICE || locked)
        ? { text: ui.notice, color: 'warning' }
        : ui.grabbedId !== null && !locked
          ? { text: `${ui.grabbedId} grabbed: h j k l move it, g drops it`, color: 'subtle' }
          : locked
            ? { text: focused ? LOCK_NOTICE : `${LOCK_NOTICE} · ${RUN_KEYS_HINT}`, color: 'subtle' }
            : null
    // The fields this block's type calls for (teach.ts says which): text ones a row each, pickers on one row.
    const knobs = node ? knobsOf(node) : []
    const textKnobs = TEXT_KNOBS.filter(key => knobs.includes(key))
    // What was typed for another block is not this block's.
    if (drafts.id !== null && drafts.id !== node?.id) drafts = { id: null, values: {} }
    // A field shows what is being typed in it (a draft) until it is sent.
    const typed = (key: string, saved: string): string => (node && drafts.id === node.id ? (drafts.values[key] ?? saved) : saved)
    const texts: { key: string; label: string; value: string; placeholder?: string; patch: (value: string) => NodePatch }[] = node
      ? [
          // A block just added opens with its title field empty: the default title shows dim and stays if nothing is typed.
          { key: TITLE_KEY, label: FIELD_LABEL.title, value: typed(TITLE_KEY, ui.freshId === node.id ? '' : node.title), placeholder: node.title, patch: value => ({ title: value.trim() || node.title }) },
          { key: NOTES_KEY, label: FIELD_LABEL.notes, value: typed(NOTES_KEY, node.notes ?? ''), placeholder: FIELD_PLACEHOLDER.notes, patch: value => ({ notes: value.trim() }) },
          ...textKnobs.map((knob: TextKnob) => ({
            key: `${KNOB_KEY}${knob}`,
            label: FIELD_LABEL[knob],
            value: typed(`${KNOB_KEY}${knob}`, node.knobs?.[knob] ?? ''),
            placeholder: FIELD_PLACEHOLDER[knob],
            patch: (value: string): NodePatch => ({ knobs: { [knob]: value.trim() } as NodePatch['knobs'] }),
          })),
        ]
      : []
    const pickers = { model: knobs.includes('model'), effort: knobs.includes('effort'), isolation: knobs.includes('isolation'), votes: knobs.includes('votes') }
    // The type picker is on every block's row.
    const pickerRow = true
    // A field at rest is one line, cut with `…`. Docked each has its row; inline (few rows) the short ones go two to a row.
    const short = texts.filter(one => one.key !== NOTES_KEY && one.key !== `${KNOB_KEY}prompt`)
    const fieldLines = placement === 'dock' ? texts.map(one => [one]) : [...short.flatMap((one, i) => (i % 2 === 0 ? [short.slice(i, i + 2)] : [])), ...texts.filter(one => !short.includes(one)).map(one => [one])]
    const fieldRows = fieldLines.length
    // A field beside its label is one row, also while typed in (its box has a width of its own): no rows are held for wrapping.
    const typing = 0
    const matches = picking && ui.picker ? fuzzy(ui.picker.query) : []
    const listed = matches.slice(0, PICK_ROWS[placement])
    // The keys drawn: while a run locks editing only what still works; the lint key while a lint stands; the key that puts a run's results away while they show.
    const toolbar = TOOLBAR.filter(one => (locked ? LOCKED_OPS.includes(one.op) : (!LINT_OPS.includes(one.op) || lints.length > 0) && (!RUN_OVER_OPS.includes(one.op) || over))).map(one => ({
      ...one,
      label:
        one.op === 'grab' && ui.grabbedId !== null
          ? 'drop'
          : one.op === 'remove' && ui.confirmId !== null
            ? 'sure?'
            : one.op === 'compact' && compact
              ? 'full'
              : one.op === 'card' && ui.help > 0
                ? ui.help < HELP_PAGES ? 'next' : 'close'
                : one.label,
    }))
    // Rows of the pane that are not the board, as they are drawn below. The header is one row;
    // the key row wraps where the pane is narrower than its keys.
    const keyRows = picking ? 1 + (matches[0] ? 1 : 0) + Math.max(1, listed.length) + 1 : wrapRows(toolbar.map(one => one.label.length + 3), 1, columns)
    // The headline says the type in two rows: what it does, and when to use it.
    const headRows = placement === 'dock' ? 2 : 0
    // What is said under the board may take a second row (the preflight with its lint ids), never more.
    const messageLines = message !== null ? wrapText(message.text, columns).slice(0, 2) : []
    let chrome = 1 + goalRows + messageLines.length + keyRows
    if (!picking) {
      chrome += placement === 'dock' ? 1 : 0
      if (help) chrome += help.length + 1
      else if (node && collapsed) chrome += 1
      else if (node && locked) chrome += 2 + lintLines.length + agentRows
      else if (node) chrome += headRows + (placement === 'dock' ? agentRows : 0) + lintLines.length + fieldRows + typing + (pickerRow ? 1 : 0)
      else chrome += 1 + agentRows
    }
    // The board's region is as tall as the board until that passes the room
    // there is; from there its height is fixed and the board pans inside it.
    // An inline pane with a field, the picker or the help card open may shrink the board to a card's worth of rows.
    // Under the help card, read for a moment, three rows of it are enough to keep the place.
    const least = placement === 'inline' && help !== null ? BOARD_HELP_ROWS : placement === 'inline' && (!collapsed || picking) ? BOARD_MIN_ROWS : BOARD_ROOM_MIN
    const room = Math.max(least, placement === 'dock' ? Math.ceil(bodyRows * BOARD_SHARE) : 0, bodyRows - chrome)
    // Which way the board flows is decided for the pane at rest (header, key row, one line of inspector): opening the inspector must not turn it.
    const turnRoom = Math.max(BOARD_ROOM_MIN, bodyRows - 3)
    const context = async (): Promise<RunContext> => {
      const now = await read($, runAtom)
      const held = overlaysDesign(now, await read($, runDesignAtom), await read($, uiAtom))
      const shown = await read($, designAtom)
      // The arrows mean what they do on the board as it is drawn now.
      const orientation = shown ? boardView(shown, placement, columns, room, { run: held ? runOverlay(now) : undefined, compact: compactOf(await read($, uiAtom), placement), turnRoom, fill: placement === 'inline' }).orientation : undefined

      return held ? { run: now, locked: now.status === 'running', orientation, placement } : { orientation, placement }
    }
    // One row: the name, the lint count, (inline) what the design is for, and at the right the run in the words that fit,
    // or the plain label `design` (nothing to press). Every part is cut to its room here, so the row never wraps.
    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" flexShrink={0}>
          <Text bold>{titleText}</Text>
          {lintMark !== '' && <Text key="design-lint-count" color="warning">{`  ${lintMark}`}</Text>}
          {goalInline !== '' && <Text key="design-goal-inline" color="subtle">{`  — ${goalInline}`}</Text>}
        </Box>
        <Box flexShrink={0}>
          {summary !== null ? <Text key="design-run-summary" color={summary.color}>{summary.text}</Text> : <Text color="subtle">design</Text>}
        </Box>
      </Box>
    )

    if (ui.status === 'closed') {
      return (
        <Box flexDirection="column">
          <Text bold>{`${GLYPH.diamond} ${DESIGN_PANE_TITLE}`}</Text>
          <Text color="subtle">{`${GLYPH.railEnd} /${COMMAND} design <name> opens a design`}</Text>
        </Box>
      )
    }

    if (ui.status === 'error') {
      return (
        <Box flexDirection="column" paddingLeft={1}>
          {header}
          <Text color="error">{`${file} could not be used: ${ui.error ?? 'unknown reason'}`}</Text>
          <Text color="subtle">{`The file was left as it is. Fix or remove it, then run /${COMMAND} design ${ui.name} again.`}</Text>
        </Box>
      )
    }

    if (ui.status === 'pick' || !design) {
      const start = async (templateId: string): Promise<void> => {
        const step = startDesign(await read($, uiAtom), templateId)
        if (!step.design) return
        let nextUi = step.ui
        try {
          if (isSaved(nextUi.name)) await $.fs.write(designFile(await $.session.root(), nextUi.name), serializeDesign(step.design))
        } catch (error) {
          nextUi = { ...nextUi, notice: `not saved: ${reason(error)}` }
        }
        await update($, designAtom, () => step.design)
        await update($, uiAtom, () => nextUi)
        // The template Button that held the ring is gone; without this the ring
        // falls on the title field and the first keys are typed into it.
        $.clock.after(FOCUS_DELAY_MS, () => {
          void $.ui.focus({ requestId: DESIGN_PANE_ID, key: HOME_KEY }).catch(() => undefined)
        })
      }

      // A saved design picked from the list: read again as it is now, and shown.
      const openSaved = async (name: string): Promise<void> => {
        const held = await read($, uiAtom)
        const path = designFile(await $.session.root(), name)
        const text = await $.fs.read(path).catch(() => undefined)
        const step = openDesign(name, typeof text === 'string' ? text : undefined, held)
        if (step.ui.status === 'pick') {
          await update($, uiAtom, ui => ({ ...ui, notice: `${name} is gone: it could not be read` }))

          return
        }
        await update($, designAtom, () => step.design)
        await update($, uiAtom, () => step.ui)
        $.clock.after(FOCUS_DELAY_MS, () => {
          void $.ui.focus({ requestId: DESIGN_PANE_ID, key: HOME_KEY }).catch(() => undefined)
        })
      }
      const saved = ui.saved ?? []
      const nameRoom = Math.max(...saved.slice(0, SAVED_ROWS).map(one => one.name.length), 0)

      return (
        <Box flexDirection="column" paddingLeft={1}>
          {header}
          {saved.length > 0 && <Text key="design-saved-head" color="subtle">Open a saved design:</Text>}
          {saved.slice(0, SAVED_ROWS).map((one, index) => (
            <Box flexDirection="row" gap={1}>
              <Button key={`open:${one.name}`} label={one.name.padEnd(nameRoom)} autoFocus={index === 0 ? true : undefined} onPress={() => openSaved(one.name)} />
              <Text color="subtle" wrap="truncate-end">{savedLine({ ...one, name: '' }).replace(/^ · /, '')}</Text>
            </Box>
          ))}
          {saved.length > SAVED_ROWS && <Text color="subtle">{`… ${saved.length - SAVED_ROWS} more: /${COMMAND} list names them, /${COMMAND} design <name> opens one`}</Text>}
          {ui.notice !== null && <Text color="warning">{ui.notice}</Text>}
          <Text color="subtle">{saved.length > 0 ? `Or start a new one (${ui.name}) from a template:` : `No design named ${ui.name} yet. Start from:`}</Text>
          {TEMPLATES.map(template => (
            <Box flexDirection="row" gap={1}>
              <Button
                key={`template:${template.id}`}
                label={template.title}
                autoFocus={saved.length === 0 && template === TEMPLATES[0] ? true : undefined}
                onPress={() => start(template.id)}
              />
              <Text color="subtle" wrap="truncate-end">{template.blurb}</Text>
            </Box>
          ))}
          <Box flexDirection="row" gap={1}>
            <Button key={`template:${BLANK_TEMPLATE_ID}`} label="Blank" onPress={() => start(BLANK_TEMPLATE_ID)} />
            <Text color="subtle">An empty design</Text>
          </Box>
          <Text key="design-draft-route" color="subtle">{`or type: /${COMMAND} draft ${saved.length > 0 ? '<name>' : ui.name} <what you want>  (Claude drafts it on the board)`}</Text>
        </Box>
      )
    }

    // Inline the region keeps its height whatever is selected: the board pans inside it, the prompt below does not move.
    const view = boardView(design, placement, columns, room, { run: overlay, selectedId: ui.selectedId, compact, turnRoom, fill: placement === 'inline' })

    // An inspector edit: read the state as it is now, patch, save, write back.
    const edit = async (id: string, patch: NodePatch): Promise<void> => {
      const before = await read($, designAtom)
      const step = patchNode(before, await read($, uiAtom), id, patch, await context())
      let nextUi = step.ui
      if (step.changed && step.design) {
        try {
          if (isSaved(nextUi.name)) await $.fs.write(designFile(await $.session.root(), nextUi.name), serializeDesign(step.design))
        } catch (error) {
          nextUi = { ...nextUi, notice: `not saved: ${reason(error)}` }
        }
      }
      if (step.design !== before) await update($, designAtom, () => step.design)
      await update($, uiAtom, () => nextUi)
    }

    // A toolbar key or a picker choice: the same read, step, save, write back.
    const commit = async (make: (design: Design, held: DesignUi, context: RunContext) => Step): Promise<Step> => {
      const before = await read($, designAtom)
      const held = await read($, uiAtom)
      const step = make(before ?? design, held, await context())
      let nextUi = step.ui
      if (step.changed && step.design) {
        try {
          if (isSaved(nextUi.name)) await $.fs.write(designFile(await $.session.root(), nextUi.name), serializeDesign(step.design))
        } catch (error) {
          nextUi = { ...nextUi, notice: `not saved: ${reason(error)}` }
        }
      }
      if (step.design !== before) await update($, designAtom, () => step.design)
      if (nextUi !== held) await update($, uiAtom, () => nextUi)

      return { ...step, ui: nextUi }
    }
    // The ring is moved a redraw after the state that draws its target was written, always: the same
    // wait whatever held the ring before (a Button, a Select just used, a field), so the same outcome.
    // A target not drawn yet is tried once more before the hint is shown.
    const focus = (key: string, hint: string): void => {
      const land = async (tries: number): Promise<void> => {
        const moved = await $.ui.focus({ requestId: DESIGN_PANE_ID, key }).catch((error: unknown) => ({ deny: reason(error) }))
        if (moved.deny === undefined) return
        if (tries > 0) $.clock.after(FOCUS_DELAY_MS * 2, () => void land(tries - 1))
        else await update($, uiAtom, held => ({ ...held, notice: hint }))
      }
      $.clock.after(FOCUS_DELAY_MS, () => void land(1))
    }
    // After a field's Enter or a picker's choice the ring goes back to the toolbar, so the next letter is a key again.
    const home = (): void => {
      $.clock.after(FOCUS_DELAY_MS, () => {
        void $.ui.focus({ requestId: DESIGN_PANE_ID, key: locked ? HOME_LOCKED_KEY : HOME_KEY }).catch(() => undefined)
      })
    }
    // The request to run the design goes into the prompt box, for the person to finish (what to run it on)
    // and send; what the design implies is said under the board. The conventions go with the prompt when
    // it is sent (the `prompt.submit` hook above): a pane's handler cannot answer as a command does.
    const handOff = async (): Promise<void> => {
      const now = await read($, designAtom)
      if (!isSaved(ui.name)) {
        await update($, uiAtom, held => ({ ...held, notice: 'run: a replay is not a saved design, there is nothing to hand off' }))

        return
      }
      const line = handoffPrompt(ui.name)
      const filled = await $.prompt.fill({ text: line }).catch(() => ({ isFilled: false }))
      await update($, uiAtom, held => ({ ...held, notice: runNotice(now, line, filled.isFilled) }))
    }
    // The question for Claude goes into the prompt box, not sent: the design tool hands it the design, the selection and the lints.
    const ask = async (): Promise<void> => {
      const line = reviewPrompt(ui.name)
      const filled = await $.prompt.fill({ text: line }).catch(() => ({ isFilled: false }))
      await update($, uiAtom, held => ({ ...held, notice: filled.isFilled ? 'ask: the question is in the prompt: change it as you like, then Enter' : `ask: type in the prompt: ${line.trim()}` }))
    }
    const press = async (op: ToolbarOp): Promise<void> => {
      const step = await commit((before, held, ctx) => applyOp(before, held, op, ctx))
      if (op === 'run') return handOff()
      if (op === 'review') return ask()
      if (op === 'edit') {
        if (step.ui.editing && node) focus(TITLE_KEY, `edit: ${EDIT_HINT}`)
        return
      }
      if (op === 'describe') {
        if (step.ui.describing) focus(DESC_KEY, 'goal: press tab to reach the field')
        return
      }
      if (op === 'cancel') home()
      if (step.ui.picker && (op === 'addAfter' || op === 'addInside')) focus(PICKER_KEY, 'add: press tab to reach the field')
    }
    const pick = async (choice: { type?: NodeType; query?: string }): Promise<void> => {
      const step = await commit((before, held, ctx) => pickBlock(before, held, choice, ctx))
      // A block was added: its title is the next thing typed. Anything else: back to the keys.
      if (step.changed && step.ui.editing) focus(TITLE_KEY, `edit: ${EDIT_HINT}`)
      else if (!step.ui.picker) home()
    }
    // Enter on one field sends every field typed in since the block was selected: nothing typed is lost to a Tab.
    const save = async (key: string, value: string): Promise<void> => {
      if (!node) return
      const sent: Record<string, string> = { ...(drafts.id === node.id ? drafts.values : {}), [key]: value }
      drafts = { id: null, values: {} }
      let patch: NodePatch = {}
      for (const one of texts) {
        const text = sent[one.key]
        if (text === undefined) continue
        const part = one.patch(text)
        patch = { ...patch, ...part, ...(patch.knobs || part.knobs ? { knobs: { ...patch.knobs, ...part.knobs } } : {}) }
      }
      await edit(node.id, patch)
      home()
    }
    const rows = flatten(design)

    // The selected block's agents, while a run is laid over the design: right under its headline, above the fields.
    const agentList =
      agents && agents.shown.length > 0 ? (
        <Box key="design-agents" flexDirection="column">
          {agents.shown.map(agent => (
            <Text wrap="truncate-end" color={agent.status === 'failed' ? 'error' : agent.status === 'running' ? 'claude' : undefined}>
              {`${agent.status === 'failed' ? FAILED : agent.status === 'running' ? GLYPH.dot : GLYPH.done} ${agent.title}  ${agent.status} · ${fmtTokens(agent.tokens)} tokens`}
            </Text>
          ))}
          {agents.rest > 0 && <Text color="subtle">{`… ${agents.rest} more`}</Text>}
        </Box>
      ) : null
    const models = node?.knobs?.model && !MODEL_CHOICES.includes(node.knobs.model) ? [...MODEL_CHOICES, node.knobs.model] : MODEL_CHOICES
    const votes = node?.knobs?.votes !== undefined && !VOTE_CHOICES.includes(node.knobs.votes) ? [...VOTE_CHOICES, node.knobs.votes] : VOTE_CHOICES
    // The type in two rows, at the moment it matters: what it does, and when to use it.
    const headline = node ? (
      <Box key="design-headline" flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold>{`${node.id} · ${TEACH[node.type].name}`}</Text>
          <Text color="subtle">{`: ${TEACH[node.type].hint}`}</Text>
        </Text>
        <Text color="subtle" wrap="truncate-end">{useWhen(node.type)}</Text>
      </Box>
    ) : null
    const lintList = lintLines.map(line => <Text color="warning">{line}</Text>)

    return (
      <Box flexDirection="column" paddingLeft={1}>
        {header}
        {describing && 'Input' in els ? (
          // The field has rows of its own, with nothing beside it: so placed, a focused field wraps a long text and all of it can be read while typing.
          <Box key="design-goal-field" flexDirection="column">
            <Text color="subtle">goal: what this workflow is for (Enter saves)</Text>
            <Box flexDirection="column">
              <els.Input
                key={DESC_KEY}
                placeholder={GOAL_PLACEHOLDER}
                value={design.description}
                submitLabel=""
                onSubmit={async value => {
                  await commit((before, held, ctx) => describeDesign(before, held, value, ctx))
                  home()
                }}
              />
            </Box>
          </Box>
        ) : placement === 'dock' ? (
          <Text key="design-goal" color={goal === '' ? 'subtle' : undefined} wrap="truncate-end">
            {goal === '' ? `goal: not said yet · d: say what this workflow is for` : `goal: ${goal}`}
          </Text>
        ) : null}
        {'Client' in els ? (
          <els.Client key={CANVAS_KEY} module="./canvas.tsx" width="100%" height={view.rows} props={boardProps(design, ui, view, overlay, placement)} />
        ) : (
          <Box flexDirection="column">
            {rows.map(row => (
              <Text color={row.node.id === ui.selectedId ? 'claude' : undefined} bold={row.node.id === ui.selectedId ? true : undefined}>
                {`${row.node.id === ui.selectedId ? GLYPH.diamond : ' '} ${'  '.repeat(row.depth)}${TEACH[row.node.type].glyph} ${row.node.id}  ${row.node.title}`}
              </Text>
            ))}
          </Box>
        )}
        {message !== null && (
          <Box key="design-message" flexDirection="column">
            {messageLines.map(line => (
              <Text color={message.color} wrap="truncate-end">{line}</Text>
            ))}
          </Box>
        )}
        {picking && ui.picker ? (
          <Box key="design-picker" flexDirection="column">
            {'Input' in els && (
              <els.Input
                key={PICKER_KEY}
                label={`+ add ${placeLabel(design, ui.picker.at)}`}
                placeholder="type to narrow"
                value={ui.picker.query}
                submitLabel={matches[0] ? `add ${matches[0]}` : 'no match'}
                autoFocus
                onInput={value => update($, uiAtom, held => typePicker(held, value))}
                onSubmit={value => pick({ query: value })}
              />
            )}
            {matches[0] && <Text key="design-pick-when" wrap="truncate-end">{`${matches[0]} · ${useWhen(matches[0])}`}</Text>}
            {matches.length === 0 && <Text color="subtle">no block type matches</Text>}
            {listed.map(type => (
              <Box flexDirection="row" gap={1}>
                <Button key={`pick:${type}`} plain dimColor={type === matches[0] ? undefined : true} label={type.padEnd(14)} onPress={() => pick({ type })} />
                <Text color="subtle" wrap="truncate-end">{TEACH[type].hint}</Text>
              </Box>
            ))}
            <Box flexDirection="row" gap={2}>
              <Button key="design-add-cancel" plain dimColor label="cancel" onPress={() => press('cancel')} />
              {matches.length > listed.length && <Text color="subtle">{`… ${matches.length - listed.length} more types: type to narrow`}</Text>}
            </Box>
          </Box>
        ) : (
          <Box key="design-toolbar" flexDirection="row" flexWrap="wrap" columnGap={1}>
            {toolbar.map(one => (
              <Button key={keyOf(one.op)} hotkey={one.hotkey} autoFocus={keyOf(one.op) === (locked ? HOME_LOCKED_KEY : HOME_KEY) ? true : undefined} plain dimColor label={one.label} onPress={() => press(one.op)} />
            ))}
          </Box>
        )}
        {!picking && placement === 'dock' && <Text color="subtle">{'─'.repeat(columns)}</Text>}
        {picking ? null : help ? (
          <Box key="design-card" flexDirection="column">
            {help.map(line => (
              <Text>{line}</Text>
            ))}
            <Text color="subtle">{`help ${ui.help}/${HELP_PAGES} · c: ${ui.help < HELP_PAGES ? 'next page' : 'close'}`}</Text>
          </Box>
        ) : node && collapsed ? (
          <Box key="design-inspector" flexDirection="column">
            <Text key="design-summary" wrap="truncate-end">
              {lintLines.length > 0 && <Text color="warning">{`${GLYPH.lint} `}</Text>}
              <Text bold>{inspectorSummary(node, columns - 12)}</Text>
              <Text color="subtle">{agents && agents.shown.length > 0 ? ` · ${agents.shown.length + agents.rest} agents` : locked ? '' : ' · e: edit'}</Text>
            </Text>
          </Box>
        ) : node && locked ? (
          <Box key="design-inspector" flexDirection="column">
            {headline}
            {lintList}
            {agentList}
          </Box>
        ) : node ? (
          <Box key="design-inspector" flexDirection="column">
            {placement === 'dock' && headline}
            {lintList}
            {placement === 'dock' && agentList}
            {'Input' in els && (
              <Box flexDirection="column">
                {fieldLines.map(line => (
                  <Box flexDirection="row" columnGap={2}>
                    {line.map(one => (
                      // The label is drawn here, not by the field: a field's own label is squeezed by a long value
                      // (it lost its space, then wrapped onto a second row). This one never shrinks.
                      <Box flexDirection="row" width={line.length > 1 ? '50%' : '100%'}>
                        <Box flexShrink={0}>
                          <Text color="subtle">{`${one.label}: `}</Text>
                        </Box>
                        {/* A width of its own: left to grow, the field measured the whole row and its `⏎ save` wrapped under a long text. */}
                        <Box width={Math.max(12, (line.length > 1 ? Math.floor(columns / 2) - 1 : columns) - one.label.length - 3)}>
                          <els.Input
                            key={one.key}
                            placeholder={one.placeholder}
                            value={one.value}
                            submitLabel=""
                            onInput={value => {
                              drafts = { id: node.id, values: { ...(drafts.id === node.id ? drafts.values : {}), [one.key]: value } }
                            }}
                            onSubmit={value => save(one.key, value)}
                          />
                        </Box>
                      </Box>
                    ))}
                  </Box>
                ))}
              </Box>
            )}
            {'Select' in els && pickerRow && (
              <Box flexDirection="row" gap={2}>
                <els.Select
                  key="design-type"
                  label="type"
                  value={node.type}
                  options={retypeChoices(node).map(value => ({ value }))}
                  onSelect={async value => {
                    const type = NODE_TYPES.find(one => one === value)
                    if (type) await commit((before, held, ctx) => retypeBlock(before, held, node.id, type, ctx))
                    home()
                  }}
                />
                {pickers.model && (
                  <els.Select
                    key="design-model"
                    label="model"
                    value={node.knobs?.model ?? INHERIT}
                    options={[{ value: INHERIT }, ...models.map(value => ({ value }))]}
                    onSelect={async value => {
                      await edit(node.id, { knobs: { model: value === INHERIT ? '' : value } })
                      home()
                    }}
                  />
                )}
                {pickers.effort && (
                  <els.Select
                    key="design-effort"
                    label="effort"
                    value={node.knobs?.effort ?? INHERIT}
                    options={[{ value: INHERIT }, ...EFFORTS.map(value => ({ value }))]}
                    onSelect={async value => {
                      await edit(node.id, { knobs: { effort: EFFORTS.find(one => one === value) } })
                      home()
                    }}
                  />
                )}
                {pickers.isolation && (
                  <els.Select
                    key="design-isolation"
                    label="isolation"
                    value={node.knobs?.isolation ?? 'none'}
                    options={[{ value: 'none' }, { value: 'worktree' }]}
                    onSelect={async value => {
                      await edit(node.id, { knobs: { isolation: value === 'worktree' ? 'worktree' : undefined } })
                      home()
                    }}
                  />
                )}
                {pickers.votes && (
                  <els.Select
                    key="design-votes"
                    label="votes"
                    value={node.knobs?.votes === undefined ? 'none' : String(node.knobs.votes)}
                    options={[{ value: 'none' }, ...votes.map(count => ({ value: String(count) }))]}
                    onSelect={async value => {
                      await edit(node.id, { knobs: { votes: value === 'none' ? undefined : Number(value) } })
                      home()
                    }}
                  />
                )}
              </Box>
            )}
          </Box>
        ) : ui.selectedId === UNMAPPED_ID && agents ? (
          <Box key="design-inspector" flexDirection="column">
            <Text wrap="truncate-end">
              <Text bold>unmapped</Text>
              <Text color="subtle">: agents whose label names no block of this design</Text>
            </Text>
            {collapsed ? <Text color="subtle">{`${agents.shown.length + agents.rest} agents`}</Text> : agentList}
          </Box>
        ) : ui.drafting && design.nodes.length === 0 ? null : (
          // While Claude drafts, the board says so, once.
          <Text color="subtle" wrap="truncate-end">
            {design.nodes.length > 0 ? 'Click a card to select it, or + to add a block there.' : `Empty design: click + on the board, or press a, to add the first block. Or ask Claude in the prompt to draft it.`}
          </Text>
        )}
      </Box>
    )
  })
}
