import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { lint } from '../src/design/lints'
import { buildHandoff } from '../src/design/handoff'
import { EFFORTS, findNode, flatten, parseDesign, serializeDesign } from '../src/design/model'
import type { Design, NodeType } from '../src/design/model'
import type { NodePatch } from '../src/design/ops'
import {
  BLANK_TEMPLATE_ID,
  BOARD_MIN_ROWS,
  LOCK_NOTICE,
  PICKER_MAX,
  RUN_KEYS_HINT,
  agentsOf,
  overlaysDesign,
  runOverlay,
  DESIGN_DIR,
  DESIGN_PANE_ID,
  DESIGN_PANE_TITLE,
  INHERIT,
  MODEL_CHOICES,
  applyMessage,
  applyOp,
  boardProps,
  boardView,
  inspectorCollapsed,
  inspectorNotes,
  inspectorSummary,
  inspectorTyping,
  designFile,
  designName,
  initialUi,
  knobFields,
  openDesign,
  patchNode,
  pickBlock,
  startDesign,
  typePicker,
  wrapRows,
} from '../src/design/session'
import type { DesignUi, RunContext, Step, ToolbarOp } from '../src/design/session'
import { TEACH, fuzzy } from '../src/design/teach'
import { TEMPLATES } from '../src/design/templates'
import { emptyRunState } from '../src/run/events'
import { replayDesignEvents } from '../src/run/replay'
import type { Tracker } from '../src/run/tracker'
import { UNMAPPED_ID } from '../src/ui/board-layout'
import { LEGEND, parseBoardMessage } from '../src/ui/board-model'
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
/** Where the ring rests: on a Button, so letters are hotkeys (on an Input they would be typed). On `edit`, so Enter edits, as it does on the board. */
const HOME_KEY = 'key:edit'
/** How long after the command's answer the handoff prompt is submitted. */
export const SUBMIT_DELAY_MS = 64
/** A redraw's worth of wait before the ring moves to an element just drawn. */
export const FOCUS_DELAY_MS = 48
/** What /conductor this module answers: its verbs, `replay design`, and no argument at all (a run shown on its design); run.tsx answers the rest. */
export const DESIGN_VERBS = /^\s*((design|run|list)(\s|$)|replay\s+design(\s|$)|$)/
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
  { op: 'compact', hotkey: 'z', label: 'compact' },
  { op: 'card', hotkey: 'c', label: '?' },
]
const EDIT_HINT = 'click the title field, or press tab to reach it'
/** The board gets at least this many rows (a card inside a container): the pane scrolls before the board shrinks further. */
const BOARD_ROOM_MIN = 8
/** Docked, the board keeps at least this share of the pane's rows whatever the inspector holds. */
const BOARD_SHARE = 0.55
/** Rows asked for when the pane sits inline above the prompt: a nested container and the inspector under it. */
export const PANE_ROWS = 28
/** Columns asked for when the pane is docked beside the transcript: the toolbar on one row, and room for a card's notes. */
export const PANE_COLUMNS = 86
const PANE_OPEN = { id: DESIGN_PANE_ID, title: DESIGN_PANE_TITLE, focus: true, rows: PANE_ROWS, columns: PANE_COLUMNS } as const

// The run's state. Both hooks modules declare these (an atom must be spelled in the
// file that reads it): run.tsx writes them through the tracker, design.tsx reads them.
const runAtom = atom({ plugin: 'conductor', key: 'run' } as const, emptyRunState())
const clockAtom = atom({ plugin: 'conductor', key: 'runClock' } as const, 0)
/** The design the tracked run was started from (a handoff); null for any other run. */
const runDesignAtom = atom({ plugin: 'conductor', key: 'runDesign' } as const, null)
const designAtom = atom({ plugin: 'conductor', key: 'design' } as const, null)
const uiAtom = atom({ plugin: 'conductor', key: 'designUi' } as const, initialUi())

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 160)

export const registerDesign = (on: On, tracker: Tracker): void => {
  // run.tsx registers /conductor and answers its own verbs; it passes these on.
  on('command.run', { command: 'conductor', args: DESIGN_VERBS }, async ($, e, next) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    // No argument: the run, on its design when it came from one; else run.tsx's phase view.
    const shown = verb === '' && (await read($, runAtom)).status !== 'idle' ? await read($, runDesignAtom) : null
    if (verb === '' && shown === null) return next(e)
    const root = await $.session.root()

    if (verb === 'replay') {
      const [, templateId, speed] = rest
      const template = TEMPLATES.find(one => one.id === templateId)
      if (!template || (speed !== undefined && speed !== 'fast' && speed !== 'slow')) {
        return { text: `Usage: /${COMMAND} replay design <${TEMPLATES.map(one => one.id).join('|')}> [fast|slow]` }
      }
      const name = designName(`replay-${template.id}`)
      const path = designFile(root, name)
      let made: Design = { ...template.make(), name }
      if (await $.fs.exists(path)) {
        // A design saved under that name is replayed as it is: its ids are what the labels use.
        const parsed = parseDesign(await $.fs.read(path).catch(() => ''))
        if (!parsed.ok) return { text: `Design ${name} is not valid, nothing was replayed: ${parsed.error}` }
        made = parsed.design
      } else {
        await $.fs.write(path, serializeDesign(made)).catch(() => undefined)
      }
      await update($, designAtom, () => made)
      await update($, uiAtom, () => ({ ...initialUi(), name, status: 'ready' as const, selectedId: made.nodes[0]?.id ?? null }))
      await $.ui.open(PANE_OPEN)
      tracker.handoff({ name, nodeIds: flatten(made).map(row => row.node.id) })
      tracker.replay(replayDesignEvents(made, name), speed ?? 'fast')

      return { text: `Replaying a made-up run over design ${name} (${speed ?? 'fast'}); token counts are made up.` }
    }

    if (verb === 'list') {
      const entries = await $.fs.list(`${root.replace(/\/+$/, '')}/${DESIGN_DIR}`).catch(() => [])
      const names = entries
        .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
        .map(entry => entry.name.slice(0, -'.json'.length))
        .sort()

      return { text: names.length === 0 ? `No saved designs yet: /${COMMAND} design <name> starts one.` : `Saved designs (${DESIGN_DIR}): ${names.join(', ')}` }
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
      tracker.handoff({ name, nodeIds: flatten(parsed.design).map(row => row.node.id) })
      // The designer's "run: … is in the prompt" hint is spent once the command has been sent.
      await update($, uiAtom, held => (held.notice?.startsWith('run: ') ? { ...held, notice: null } : held))
      const prompt = `Implement and run the "${name}" workflow design.`
      const fill = async (): Promise<void> => {
        const filled = await $.prompt.fill({ text: prompt }).catch(() => ({ isFilled: false }))
        $.ui.toast(filled.isFilled ? 'conductor: press Enter to start the handoff' : `conductor: type "${prompt}" to start the handoff`)
      }
      if (fillOnly) {
        await fill()

        return { text: `${handoff.text}; press Enter on the filled prompt to start`, context: handoff.context }
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

      return handoff
    }

    const name = shown ?? designName(rest.join(' '))
    const path = designFile(root, name)
    const previous = await read($, uiAtom)
    // The run's design is often the one already open: it is shown as it stands.
    if (shown !== null && previous.name === name && previous.status === 'ready' && (await read($, designAtom)) !== null) {
      await $.ui.open(PANE_OPEN)

      return { text: `Design ${name} opened with its run.` }
    }
    let step = openDesign(name, undefined)
    if (await $.fs.exists(path)) {
      try {
        step = openDesign(name, await $.fs.read(path))
      } catch (error) {
        // Unreadable is not absent: never offer a template over a file that is there.
        step = { ...step, ui: { ...step.ui, status: 'error', error: `could not be read: ${reason(error)}` } }
      }
    }
    await update($, designAtom, () => step.design)
    await update($, uiAtom, () => step.ui)
    // With the keyboard, the toolbar's hotkeys work at once: no click on the canvas.
    await $.ui.open(PANE_OPEN)

    if (step.ui.status === 'error') return { text: `Design ${name} could not be opened: ${step.ui.error}` }

    return { text: step.ui.status === 'pick' ? `No design named ${name} yet: pick a template in the pane.` : `Design ${name} opened.` }
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
        await $.fs.write(designFile(await $.session.root(), nextUi.name), serializeDesign(step.design))
      } catch (error) {
        nextUi = { ...nextUi, notice: `not saved: ${reason(error)}` }
      }
    }
    // `r` on the board is the toolbar's run: the handoff command goes into the prompt box.
    if (message.kind === 'key' && message.op === 'run') {
      const line = `/${COMMAND} run ${nextUi.name}`
      const filled = await $.prompt.fill({ text: line }).catch(() => ({ isFilled: false }))
      nextUi = { ...nextUi, notice: filled.isFilled ? `run: ${line} is in the prompt · Enter sends it` : `run: type ${line} in the prompt` }
    }
    // Writing the atoms redraws the pane, which hands the board its next props.
    if (step.design !== design) await update($, designAtom, () => step.design)
    if (nextUi !== ui) await update($, uiAtom, () => nextUi)
    // "Edit" and a `+` need a field to type in. The board holds the keyboard after
    // the click that reached here, so the pane takes it back first; the field exists
    // once the update above is drawn, so the ring moves there a frame later.
    const edits = (message.kind === 'edit' || (message.kind === 'key' && message.op === 'edit')) && nextUi.editing
    const picks = nextUi.picker !== null && ui.picker === null
    if (edits || picks) {
      await $.ui.open(PANE_OPEN)
      $.clock.after(FOCUS_DELAY_MS, () => {
        void $.ui
          .focus({ requestId: DESIGN_PANE_ID, key: edits ? TITLE_KEY : PICKER_KEY })
          .then(moved => (moved.deny !== undefined && edits ? update($, uiAtom, held => ({ ...held, notice: `edit: ${EDIT_HINT}` })) : undefined))
          .catch(() => undefined)
      })
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
    const onField = e.element === TITLE_KEY || e.element === NOTES_KEY
    const held = await read($, uiAtom)
    if (held.status === 'ready' && held.editing !== onField && (onField || e.origin.kind === 'person')) await update($, uiAtom, ui => ({ ...ui, editing: onField }))

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
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 48
    const node = design === null || ui.selectedId === null ? undefined : findNode(design, ui.selectedId)
    const lints = design ? lint(design) : []
    const agents = over && ui.selectedId !== null ? agentsOf(run, ui.selectedId) : null
    // An inline pane has few rows: its inspector is one line until a field is being typed in.
    const collapsed = inspectorCollapsed(placement, ui)
    // While a field has the ring it wraps its own text; at rest it is one line, and the notes are wrapped under it.
    const wrapped = node && !collapsed && !ui.editing ? inspectorNotes(node.notes ?? '', columns, bodyRows) : { lines: [], more: 0 }
    const typing = node && !collapsed && ui.editing ? inspectorTyping(node.notes ?? '', columns, bodyRows) : 0
    const help = ui.showCard ? [...(node ? TEACH[node.type].card : []), ...LEGEND, file] : []
    // Rows of the pane that are not the board: the header, the key row, the inspector as it is drawn below.
    // The key row is one row where the pane is wide enough for it (78 cells), and wraps where it is not.
    // The picker takes its place: a field, then a wrapping row of every block type.
    const matches = ui.picker ? fuzzy(ui.picker.query).slice(0, PICKER_MAX) : []
    const keyRows = ui.picker
      ? 1 + (matches.length === 0 ? 1 : 0) + wrapRows([...matches.map(type => TEACH[type].name.length + 2), 'cancel'.length], 2, columns)
      : wrapRows([...TOOLBAR.map(one => one.label.length + 3), 'run'.length + 3], 1, columns)
    let chrome = 1 + keyRows + help.length + (ui.notice !== null ? 1 : 0) + (locked ? 1 : 0) + (ui.grabbedId !== null ? 1 : 0)
    if (collapsed) chrome += 1
    else if (node) {
      const knobs = knobFields(node.type)
      // The rule (docked), the headline, the two fields; then what this block adds. A field at rest that holds more
      // than its line is drawn with an empty row under it (seen in real paint), counted with the wrapped notes.
      chrome += (placement === 'dock' ? 4 : 3) + lints.filter(one => one.nodeId === node.id).length + (node.knobs?.fanout ? 1 : 0) + wrapped.lines.length + (wrapped.more > 0 ? 1 : 0) + (wrapped.lines.length > 0 ? 1 : 0) + typing + (knobs.model || knobs.effort || knobs.isolation ? 1 : 0)
      if (agents) chrome += agents.shown.length + (agents.rest > 0 ? 1 : 0)
    } else chrome += (placement === 'dock' ? 2 : 1) + (agents ? agents.shown.length + (agents.rest > 0 ? 1 : 0) : 0)
    // The board's region is as tall as the board until that passes the room
    // there is; from there its height is fixed and the board pans inside it.
    // An inline pane with a field open is for typing: there the board may shrink to a card's worth of rows.
    const least = placement === 'inline' && !collapsed ? BOARD_MIN_ROWS : BOARD_ROOM_MIN
    const room = Math.max(least, placement === 'dock' ? Math.ceil(bodyRows * BOARD_SHARE) : 0, bodyRows - chrome)
    // Which way the board flows is decided for the pane at rest (header, key row, one line of inspector): opening the inspector must not turn it.
    const turnRoom = Math.max(BOARD_ROOM_MIN, bodyRows - 3)
    const context = async (): Promise<RunContext> => {
      const now = await read($, runAtom)
      const held = overlaysDesign(now, await read($, runDesignAtom), await read($, uiAtom))
      const shown = await read($, designAtom)
      // The arrows mean what they do on the board as it is drawn now.
      const orientation = shown ? boardView(shown, placement, columns, room, { run: held ? runOverlay(now) : undefined, compact: (await read($, uiAtom)).compact, turnRoom }).orientation : undefined

      return held ? { run: now, locked: now.status === 'running', orientation } : { orientation }
    }
    // The mode marker: the side that is live is lit.
    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{`wf: ${ui.name}`}</Text>
        <Text>
          <Text color={locked ? 'subtle' : 'claude'} bold={!locked}>design</Text>
          <Text color="subtle">{' ▸ '}</Text>
          <Text color={locked ? 'claude' : 'subtle'} bold={locked}>run</Text>
        </Text>
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
          await $.fs.write(designFile(await $.session.root(), nextUi.name), serializeDesign(step.design))
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

      return (
        <Box flexDirection="column" paddingLeft={1}>
          {header}
          <Text color="subtle">{`No design named ${ui.name} yet. Start from:`}</Text>
          {TEMPLATES.map(template => (
            <Box flexDirection="row" gap={1}>
              <Button
                key={`template:${template.id}`}
                label={template.title}
                autoFocus={template === TEMPLATES[0] ? true : undefined}
                onPress={() => start(template.id)}
              />
              <Text color="subtle">{template.blurb}</Text>
            </Box>
          ))}
          <Box flexDirection="row" gap={1}>
            <Button key={`template:${BLANK_TEMPLATE_ID}`} label="Blank" onPress={() => start(BLANK_TEMPLATE_ID)} />
            <Text color="subtle">An empty design</Text>
          </Box>
        </Box>
      )
    }

    const view = boardView(design, placement, columns, room, { run: overlay, selectedId: ui.selectedId, compact: ui.compact, turnRoom })

    // An inspector edit: read the state as it is now, patch, save, write back.
    const edit = async (id: string, patch: NodePatch): Promise<void> => {
      const before = await read($, designAtom)
      const step = patchNode(before, await read($, uiAtom), id, patch, await context())
      let nextUi = step.ui
      if (step.changed && step.design) {
        try {
          await $.fs.write(designFile(await $.session.root(), nextUi.name), serializeDesign(step.design))
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
          await $.fs.write(designFile(await $.session.root(), nextUi.name), serializeDesign(step.design))
        } catch (error) {
          nextUi = { ...nextUi, notice: `not saved: ${reason(error)}` }
        }
      }
      if (step.design !== before) await update($, designAtom, () => step.design)
      if (nextUi !== held) await update($, uiAtom, () => nextUi)

      return { ...step, ui: nextUi }
    }
    const focus = async (key: string, hint: string): Promise<void> => {
      const moved = await $.ui.focus({ requestId: DESIGN_PANE_ID, key }).catch((error: unknown) => ({ deny: reason(error) }))
      if (moved.deny !== undefined) await update($, uiAtom, held => ({ ...held, notice: hint }))
    }
    const press = async (op: ToolbarOp): Promise<void> => {
      const step = await commit((before, held, ctx) => applyOp(before, held, op, ctx))
      if (op === 'edit') {
        if (!step.ui.editing || !node) return
        // Collapsed, the field is drawn by the update above: the ring moves to it a frame later.
        if (!collapsed) return focus(TITLE_KEY, `edit: ${EDIT_HINT}`)
        $.clock.after(FOCUS_DELAY_MS, () => {
          void focus(TITLE_KEY, `edit: ${EDIT_HINT}`)
        })
        return
      }
      if (op === 'cancel') home()
      // The picker's field exists once the update above is drawn, so the ring
      // is moved to it a frame later, from the clock.
      if (step.ui.picker && (op === 'addAfter' || op === 'addInside')) {
        $.clock.after(FOCUS_DELAY_MS, () => {
          void focus(PICKER_KEY, 'add: press tab to reach the field')
        })
      }
    }
    // After a field's Enter the ring goes back to the toolbar, so the next letter is a key again.
    const home = (): void => {
      $.clock.after(FOCUS_DELAY_MS, () => {
        void $.ui.focus({ requestId: DESIGN_PANE_ID, key: HOME_KEY }).catch(() => undefined)
      })
    }
    const pick = async (choice: { type?: NodeType; query?: string }): Promise<void> => {
      const step = await commit((before, held, ctx) => pickBlock(before, held, choice, ctx))
      if (!step.ui.picker) home()
    }
    // The same path as typing it. A plugin's own $.command.run skips its own
    // hooks (the engine then says no hook answered), so the command is put in
    // the prompt box for the person to send.
    const handOff = async (): Promise<void> => {
      const line = `/${COMMAND} run ${ui.name}`
      const filled = await $.prompt.fill({ text: line }).catch(() => ({ isFilled: false }))
      const notice = filled.isFilled ? `run: ${line} is in the prompt · Enter sends it` : `run: type ${line} in the prompt`
      await update($, uiAtom, held => ({ ...held, notice }))
    }
    const rows = flatten(design)

    // The selected block's agents, while a run is laid over the design: right under its headline, above the fields.
    const agentList =
      agents && agents.shown.length > 0 ? (
        <Box key="design-agents" flexDirection="column">
          {agents.shown.map(agent => (
            <Text wrap="truncate-end" color={agent.status === 'failed' ? 'error' : agent.status === 'running' ? 'claude' : undefined}>
              {`${agent.status === 'failed' ? FAILED : agent.status === 'running' ? GLYPH.dot : GLYPH.done} ${agent.title}  ${fmtTokens(agent.tokens)}`}
            </Text>
          ))}
          {agents.rest > 0 && <Text color="subtle">{`… ${agents.rest} more`}</Text>}
        </Box>
      ) : null
    const fields = node ? knobFields(node.type) : undefined
    const models = node?.knobs?.model && !MODEL_CHOICES.includes(node.knobs.model) ? [...MODEL_CHOICES, node.knobs.model] : MODEL_CHOICES

    return (
      <Box flexDirection="column" paddingLeft={1}>
        {header}
        {'Client' in els ? (
          <els.Client key={CANVAS_KEY} module="./canvas.tsx" width="100%" height={view.rows} props={boardProps(design, ui, view, overlay)} />
        ) : (
          <Box flexDirection="column">
            {rows.map(row => (
              <Text color={row.node.id === ui.selectedId ? 'claude' : undefined} bold={row.node.id === ui.selectedId ? true : undefined}>
                {`${row.node.id === ui.selectedId ? GLYPH.diamond : ' '} ${'  '.repeat(row.depth)}${TEACH[row.node.type].glyph} ${row.node.id}  ${row.node.title}`}
              </Text>
            ))}
          </Box>
        )}
        {ui.picker && 'Input' in els && (
          <Box key="design-picker" flexDirection="column">
            <els.Input
              key={PICKER_KEY}
              label={ui.picker.at.parentId === undefined ? '+ add' : `+ add in ${ui.picker.at.parentId}`}
              placeholder="type a block name"
              value={ui.picker.query}
              submitLabel="add the first match"
              autoFocus
              onInput={value => update($, uiAtom, held => typePicker(held, value))}
              onSubmit={value => pick({ query: value })}
            />
            {matches.length === 0 && <Text color="subtle">no block matches</Text>}
          </Box>
        )}
        {ui.picker ? (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {matches.map(type => (
              <Button key={`pick:${type}`} plain dimColor={type === matches[0] ? undefined : true} label={`${TEACH[type].glyph} ${TEACH[type].name}`} onPress={() => pick({ type })} />
            ))}
            <Button key="design-add-cancel" plain dimColor label="cancel" onPress={() => press('cancel')} />
          </Box>
        ) : (
          <Box key="design-toolbar" flexDirection="row" flexWrap="wrap" columnGap={1}>
            {TOOLBAR.map(one => (
              <Button
                key={`key:${one.op}`}
                hotkey={one.hotkey}
                autoFocus={`key:${one.op}` === HOME_KEY ? true : undefined}
                plain
                dimColor
                label={one.op === 'grab' && ui.grabbedId !== null ? 'drop' : one.op === 'remove' && ui.confirmId !== null ? 'sure?' : one.op === 'compact' && ui.compact ? 'full' : one.label}
                onPress={() => press(one.op)}
              />
            ))}
            <Button key="design-run" hotkey="r" plain dimColor label="run" onPress={handOff} />
          </Box>
        )}
        {placement === 'dock' && <Text color="subtle">{'─'.repeat(columns)}</Text>}
        {node && collapsed ? (
          <Box key="design-inspector" flexDirection="column">
            <Text key="design-summary" wrap="truncate-end">
              {lints.some(one => one.nodeId === node.id) && <Text color="warning">{`${GLYPH.lint} `}</Text>}
              <Text bold>{inspectorSummary(node, columns - 12)}</Text>
              <Text color="subtle">{agents && agents.shown.length > 0 ? ` · ${agents.shown.length + agents.rest} agents` : locked ? '' : ' · e: edit'}</Text>
            </Text>
          </Box>
        ) : node ? (
          <Box key="design-inspector" flexDirection="column">
            <Text wrap="truncate-end">
              <Text bold>{`${node.id} · ${TEACH[node.type].name}`}</Text>
              <Text color="subtle">{`: ${TEACH[node.type].hint}`}</Text>
            </Text>
            {lints
              .filter(one => one.nodeId === node.id)
              .map(one => (
                <Text color="warning">{`${GLYPH.lint} ${one.message}`}</Text>
              ))}
            {node.knobs?.fanout && <Text color="subtle" wrap="truncate-end">{`fanout: ${node.knobs.fanout}`}</Text>}
            {agentList}
            {'Input' in els && (
              <Box flexDirection="column">
                <els.Input
                  key={TITLE_KEY}
                  label="title"
                  value={node.title}
                  submitLabel="save"
                  onSubmit={async value => {
                    await edit(node.id, { title: value.trim() || node.title })
                    home()
                  }}
                />
                <els.Input
                  key={NOTES_KEY}
                  label="notes"
                  placeholder="anything the blocks cannot express"
                  value={node.notes ?? ''}
                  submitLabel="save"
                  onSubmit={async value => {
                    await edit(node.id, { notes: value.trim() })
                    home()
                  }}
                />
              </Box>
            )}
            {wrapped.lines.length > 0 && (
              <Box key="design-notes-wrapped" flexDirection="column" paddingLeft={2}>
                {wrapped.lines.map(line => (
                  <Text>{line}</Text>
                ))}
                {wrapped.more > 0 && <Text color="subtle">{`… ${wrapped.more} more ${wrapped.more === 1 ? 'line' : 'lines'}`}</Text>}
              </Box>
            )}
            {'Select' in els && fields && (fields.model || fields.effort || fields.isolation) && (
              <Box flexDirection="row" gap={2}>
                {fields.model && (
                  <els.Select
                    key="design-model"
                    label="model"
                    value={node.knobs?.model ?? INHERIT}
                    options={[{ value: INHERIT }, ...models.map(value => ({ value }))]}
                    onSelect={value => edit(node.id, { knobs: { model: value === INHERIT ? '' : value } })}
                  />
                )}
                {fields.effort && (
                  <els.Select
                    key="design-effort"
                    label="effort"
                    value={node.knobs?.effort ?? INHERIT}
                    options={[{ value: INHERIT }, ...EFFORTS.map(value => ({ value }))]}
                    onSelect={value => edit(node.id, { knobs: { effort: EFFORTS.find(one => one === value) } })}
                  />
                )}
                {fields.isolation && (
                  <els.Select
                    key="design-isolation"
                    label="isolation"
                    value={node.knobs?.isolation ?? 'none'}
                    options={[{ value: 'none' }, { value: 'worktree' }]}
                    onSelect={value => edit(node.id, { knobs: { isolation: value === 'worktree' ? 'worktree' : undefined } })}
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
        ) : (
          <Text color="subtle" wrap="truncate-end">{design.nodes.length === 0 ? 'Empty design: click + on the board, or press a, to add the first block.' : 'Click a card to select it, or + to add a block there.'}</Text>
        )}
        {help.length > 0 && (
          <Box key="design-card" flexDirection="column">
            {help.map(line => (
              <Text color="subtle" wrap="truncate-end">{line}</Text>
            ))}
          </Box>
        )}
        {ui.notice !== null && ui.notice !== LOCK_NOTICE && <Text color="warning" wrap="truncate-end">{ui.notice}</Text>}
        {ui.notice === LOCK_NOTICE && locked && <Text color="subtle">{LOCK_NOTICE}</Text>}
        {locked && <Text color="subtle" wrap="truncate-end">{RUN_KEYS_HINT}</Text>}
        {ui.grabbedId !== null && <Text color="subtle" wrap="truncate-end">{`${ui.grabbedId} grabbed: h j k l move it, g drops it`}</Text>}
      </Box>
    )
  })
}
