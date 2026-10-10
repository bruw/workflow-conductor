import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { lint } from '../src/design/lints'
import { buildHandoff } from '../src/design/handoff'
import { EFFORTS, findNode, flatten, parseDesign, serializeDesign } from '../src/design/model'
import type { Design, NodeType } from '../src/design/model'
import type { NodePatch } from '../src/design/ops'
import {
  BLANK_TEMPLATE_ID,
  DESIGN_DIR,
  DESIGN_PANE_ID,
  DESIGN_PANE_TITLE,
  INHERIT,
  MODEL_CHOICES,
  applyMessage,
  applyOp,
  canvasProps,
  designFile,
  designName,
  initialUi,
  knobFields,
  openDesign,
  patchNode,
  pickBlock,
  startDesign,
  typePicker,
} from '../src/design/session'
import type { DesignUi, Step, ToolbarOp } from '../src/design/session'
import { TEACH, fuzzy } from '../src/design/teach'
import { TEMPLATES } from '../src/design/templates'
import { PICKER_MAX, parseCanvasMessage } from '../src/ui/canvas-model'
import { GLYPH } from '../src/ui/theme'

// The designer: the hooks module owns the Design, applies ops, saves the file
// and draws the inspector and toolbar. The canvas (./canvas.tsx) is a Client
// that owns only view state and posts messages here.

const COMMAND = 'conductor'
const CANVAS_KEY = 'canvas'
const TITLE_KEY = 'design-title'
const PICKER_KEY = 'design-add'
/** Where the ring rests: on a Button, so letters are hotkeys; on an Input they would be typed. */
const HOME_KEY = 'key:down'
/** How long after the command's answer the handoff prompt is submitted. */
export const SUBMIT_DELAY_MS = 64
/** A redraw's worth of wait before the ring moves to an element just drawn. */
export const FOCUS_DELAY_MS = 48
/** The verbs of /conductor this module answers; run.tsx answers the rest. */
export const DESIGN_VERBS = /^\s*(design|run|list)(\s|$)/
/** One digit or one lowercase letter each: all a Button's `hotkey` takes (no space, no `?`). */
const TOOLBAR: readonly { op: ToolbarOp | 'edit'; hotkey: string; label: string }[] = [
  { op: 'down', hotkey: 'j', label: 'down' },
  { op: 'up', hotkey: 'k', label: 'up' },
  { op: 'grab', hotkey: 'g', label: 'grab' },
  { op: 'addAfter', hotkey: 'a', label: 'add' },
  { op: 'addInside', hotkey: 'i', label: 'inside' },
  { op: 'remove', hotkey: 'x', label: 'delete' },
  { op: 'edit', hotkey: 'e', label: 'edit' },
  { op: 'card', hotkey: 'h', label: 'help' },
]
const CANVAS_MIN_ROWS = 8
// The open picker: its own line and its matches.
const PICKER_ROWS = PICKER_MAX + 1
const EDIT_HINT = 'click the title field, or press tab to reach it'
// Rows of the pane that are not canvas: header, inspector, toolbar, pane chrome.
const RESERVED_ROWS = 20

const designAtom = atom({ plugin: 'conductor', key: 'design' } as const, null)
const uiAtom = atom({ plugin: 'conductor', key: 'designUi' } as const, initialUi())

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 160)

export const registerDesign = (on: On): void => {
  // run.tsx registers /conductor and answers its own verbs; it passes these on.
  on('command.run', { command: 'conductor', args: DESIGN_VERBS }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const root = await $.session.root()

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

    const name = designName(rest.join(' '))
    const path = designFile(root, name)
    const previous = await read($, uiAtom)
    let step = openDesign(name, undefined, previous.rev)
    if (await $.fs.exists(path)) {
      try {
        step = openDesign(name, await $.fs.read(path), previous.rev)
      } catch (error) {
        // Unreadable is not absent: never offer a template over a file that is there.
        step = { ...step, ui: { ...step.ui, status: 'error', error: `could not be read: ${reason(error)}` } }
      }
    }
    await update($, designAtom, () => step.design)
    await update($, uiAtom, () => step.ui)
    // With the keyboard, the toolbar's hotkeys work at once: no click on the canvas.
    await $.ui.open({ id: DESIGN_PANE_ID, title: DESIGN_PANE_TITLE, focus: true })

    if (step.ui.status === 'error') return { text: `Design ${name} could not be opened: ${step.ui.error}` }

    return { text: step.ui.status === 'pick' ? `No design named ${name} yet: pick a template in the pane.` : `Design ${name} opened.` }
  })

  on('ui.message', { requestId: DESIGN_PANE_ID, element: CANVAS_KEY }, async ($, e, next) => {
    const message = parseCanvasMessage(e.data)
    if (!message) return next(e)

    const design = await read($, designAtom)
    const ui = await read($, uiAtom)
    const step = applyMessage(design, ui, message)
    let nextUi = step.ui
    if (step.changed && step.design) {
      try {
        await $.fs.write(designFile(await $.session.root(), nextUi.name), serializeDesign(step.design))
      } catch (error) {
        nextUi = { ...nextUi, notice: `not saved: ${reason(error)}` }
      }
    }
    // "Edit" hands the keyboard to the inspector's title field, where the engine lets it.
    if (message.kind === 'edit') {
      const moved = await $.ui.focus({ requestId: DESIGN_PANE_ID, key: TITLE_KEY }).catch((error: unknown) => ({ deny: reason(error) }))
      if (moved.deny !== undefined) nextUi = { ...nextUi, notice: `edit: ${EDIT_HINT}` }
    }
    // Writing the atoms redraws the pane, which hands the canvas its next props.
    if (step.design !== design) await update($, designAtom, () => step.design)
    if (nextUi !== ui) await update($, uiAtom, () => nextUi)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: DESIGN_PANE_ID }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const ui = await read($, uiAtom)
    const design = await read($, designAtom)
    const file = `${DESIGN_DIR}/${ui.name}.json`
    const columns = Math.max(20, Math.min(e.props.bodyColumns || 80, 100) - 2)
    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{`wf: ${ui.name}`}</Text>
        <Text color="subtle">{'design ▸ run'}</Text>
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

    const node = ui.selectedId === null ? undefined : findNode(design, ui.selectedId)
    const lints = lint(design)
    // The canvas is as tall as what it draws until that passes the room there
    // is; from there its height is fixed and it scrolls inside it.
    const room = Math.max(CANVAS_MIN_ROWS, (e.viewport?.rows ?? 48) - RESERVED_ROWS)
    const need = flatten(design).length + 2 + PICKER_ROWS
    const canvasHeight = need > room ? room : undefined

    // An inspector edit: read the state as it is now, patch, save, write back.
    const edit = async (id: string, patch: NodePatch): Promise<void> => {
      const before = await read($, designAtom)
      const step = patchNode(before, await read($, uiAtom), id, patch)
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
    const commit = async (make: (design: Design, held: DesignUi) => Step): Promise<Step> => {
      const before = await read($, designAtom)
      const held = await read($, uiAtom)
      const step = make(before ?? design, held)
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
    const press = async (op: ToolbarOp | 'edit'): Promise<void> => {
      if (op === 'edit') {
        if (!node) {
          await update($, uiAtom, held => ({ ...held, notice: 'edit: select a block first' }))
          return
        }
        return focus(TITLE_KEY, `edit: ${EDIT_HINT}`)
      }
      const step = await commit((before, held) => applyOp(before, held, op))
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
      const step = await commit((before, held) => pickBlock(before, held, choice))
      if (!step.ui.picker) home()
    }
    // The same path as typing it. A plugin's own $.command.run skips its own
    // hooks (the engine then says no hook answered), so the command is put in
    // the prompt box for the person to send.
    const handOff = async (): Promise<void> => {
      const line = `/${COMMAND} run ${ui.name}`
      const filled = await $.prompt.fill({ text: line }).catch(() => ({ isFilled: false }))
      const notice = filled.isFilled ? `run: ${line} is in the prompt: esc, then Enter sends it` : `run: type ${line} in the prompt`
      await update($, uiAtom, held => ({ ...held, notice }))
    }
    const rows = flatten(design)
    const matches = ui.picker ? fuzzy(ui.picker.query).slice(0, PICKER_MAX) : []

    const fields = node ? knobFields(node.type) : undefined
    const models = node?.knobs?.model && !MODEL_CHOICES.includes(node.knobs.model) ? [...MODEL_CHOICES, node.knobs.model] : MODEL_CHOICES

    return (
      <Box flexDirection="column" paddingLeft={1}>
        {header}
        {'Client' in els ? (
          <els.Client key={CANVAS_KEY} module="./canvas.tsx" width="100%" height={canvasHeight} props={canvasProps(design, ui, room)} />
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
          <Box key="design-toolbar" flexDirection="row" flexWrap="wrap" columnGap={2}>
            {TOOLBAR.map(one => (
              <Button
                key={`key:${one.op}`}
                hotkey={one.hotkey}
                autoFocus={one === TOOLBAR[0] ? true : undefined}
                plain
                dimColor
                label={one.op === 'grab' && ui.grabbedId !== null ? 'drop' : one.label}
                onPress={() => press(one.op)}
              />
            ))}
            <Button key="design-run" hotkey="r" plain dimColor label="run" onPress={handOff} />
          </Box>
        )}
        <Text color="subtle">{'─'.repeat(columns)}</Text>
        {node ? (
          <Box key="design-inspector" flexDirection="column">
            <Text wrap="truncate-end">
              <Text color="claude" bold>{`${node.id} · ${TEACH[node.type].name}`}</Text>
              <Text color="subtle">{`: ${TEACH[node.type].hint}`}</Text>
            </Text>
            {lints
              .filter(one => one.nodeId === node.id)
              .map(one => (
                <Text color="warning">{`${GLYPH.lint} ${one.message}`}</Text>
              ))}
            {ui.showCard && (
              <Box key="design-card" flexDirection="column">
                {TEACH[node.type].card.map(line => (
                  <Text color="subtle">{line}</Text>
                ))}
              </Box>
            )}
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
                  key="design-notes"
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
        ) : (
          <Text color="subtle">{design.nodes.length === 0 ? 'Empty design: press a on the canvas to add the first block.' : 'Press a to add a block at the end.'}</Text>
        )}
        {ui.notice !== null && <Text color="warning">{ui.notice}</Text>}
        <Text color="subtle" wrap="truncate-end">
          {ui.grabbedId !== null ? `${ui.grabbedId} grabbed: j/k move it, g drops it · ` : ''}
          {`${file}${'Client' in els ? ' · click the canvas for the pointer · esc hands the keys back' : ''}`}
        </Text>
      </Box>
    )
  })
}
