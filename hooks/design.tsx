import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { lint } from '../src/design/lints'
import { EFFORTS, findNode, flatten, serializeDesign } from '../src/design/model'
import type { NodePatch } from '../src/design/ops'
import {
  BLANK_TEMPLATE_ID,
  DESIGN_DIR,
  DESIGN_PANE_ID,
  DESIGN_PANE_TITLE,
  INHERIT,
  MODEL_CHOICES,
  applyMessage,
  canvasProps,
  designFile,
  designName,
  initialUi,
  knobFields,
  openDesign,
  patchNode,
  startDesign,
} from '../src/design/session'
import { TEACH } from '../src/design/teach'
import { TEMPLATES } from '../src/design/templates'
import { PICKER_MAX, parseCanvasMessage } from '../src/ui/canvas-model'
import { GLYPH } from '../src/ui/theme'

// The designer: the hooks module owns the Design, applies ops, saves the file
// and draws the inspector and toolbar. The canvas (./canvas.tsx) is a Client
// that owns only view state and posts messages here.

const COMMAND = 'conductor-design'
const CANVAS_KEY = 'canvas'
const TITLE_KEY = 'design-title'
const CANVAS_MIN_ROWS = 8
// The open picker: its own line and its matches.
const PICKER_ROWS = PICKER_MAX + 1
const EDIT_HINT = 'click the title field; the canvas cannot pass the keys on'
// Rows of the pane that are not canvas: header, inspector, toolbar, pane chrome.
const RESERVED_ROWS = 20

const designAtom = atom({ plugin: 'conductor', key: 'design' } as const, null)
const uiAtom = atom({ plugin: 'conductor', key: 'designUi' } as const, initialUi())

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 160)

export const registerDesign = (on: On): void => {
  // The engine takes one unmatched hook per event from a plugin, and run.tsx
  // holds session.start's. This matcher is true of every session.
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    await $.command.register({
      name: 'conductor-design',
      description: 'Design a workflow: /conductor-design [name]',
    })

    return next(e)
  })

  on('command.run', { command: 'conductor-design' }, async ($, e) => {
    const name = designName(e.args)
    const path = designFile(await $.session.root(), name)
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
          <Text color="subtle">{`${GLYPH.railEnd} /${COMMAND} <name> opens a design`}</Text>
        </Box>
      )
    }

    if (ui.status === 'error') {
      return (
        <Box flexDirection="column" paddingLeft={1}>
          {header}
          <Text color="error">{`${file} could not be used: ${ui.error ?? 'unknown reason'}`}</Text>
          <Text color="subtle">{`The file was left as it is. Fix or remove it, then run /${COMMAND} ${ui.name} again.`}</Text>
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

    const fields = node ? knobFields(node.type) : undefined
    const models = node?.knobs?.model && !MODEL_CHOICES.includes(node.knobs.model) ? [...MODEL_CHOICES, node.knobs.model] : MODEL_CHOICES

    return (
      <Box flexDirection="column" paddingLeft={1}>
        {header}
        {'Client' in els ? (
          <els.Client key={CANVAS_KEY} module="./canvas.tsx" width="100%" height={canvasHeight} props={canvasProps(design, ui, room)} />
        ) : (
          <Box flexDirection="column">
            {flatten(design).map(row => (
              <Text>{`${'  '.repeat(row.depth)}${TEACH[row.node.type].glyph} ${row.node.id}  ${row.node.title}`}</Text>
            ))}
            <Text color="subtle">The canvas is edited in the terminal or the desktop app.</Text>
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
                  onSubmit={value => edit(node.id, { title: value.trim() || node.title })}
                />
                <els.Input
                  key="design-notes"
                  label="notes"
                  placeholder="anything the blocks cannot express"
                  value={node.notes ?? ''}
                  submitLabel="save"
                  onSubmit={value => edit(node.id, { notes: value.trim() })}
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
        <Box flexDirection="row" gap={2} marginTop={1}>
          <Button key="design-run" label="Run" variant="primary" onPress={() => $.prompt.fill({ text: `/conductor run ${ui.name}` })} />
          <Text color="subtle">{file}</Text>
        </Box>
        {'Client' in els && <Text color="subtle">click the canvas to give it the keys · esc hands them back</Text>}
      </Box>
    )
  })
}
