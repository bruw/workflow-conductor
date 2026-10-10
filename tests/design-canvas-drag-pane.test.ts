import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { flatten, parseDesign } from '../src/design/model'
import type { Design } from '../src/design/model'
import { DESIGN_PANE_ID, DESIGN_PANE_TITLE } from '../src/design/session'
import type { DesignUi } from '../src/design/session'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/project'
const PANE = { title: DESIGN_PANE_TITLE, isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
// A column on a row's title: clear of the glyph, which folds.
const TITLE = 10

type Seen = { design: Design | null; ui: DesignUi | undefined }
const watch = (on: On): Seen => {
  const seen: Seen = { design: null, ui: undefined }
  on('state.set', (_$, e, next) => {
    if (e.plugin === 'conductor' && e.key === 'design') seen.design = e.value
    if (e.plugin === 'conductor' && e.key === 'designUi') seen.ui = e.value

    return next(e)
  })

  return seen
}

for (const surface of SURFACES) {
  test(`canvas pointer: click, drag to reorder and re-nest, fold, on ${surface}`, async ($, on) => {
    const files = new Map<string, string>()
    const writes: string[] = []
    const state = watch(on)
    on('session.root', () => ({ value: ROOT }))
    on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
    on('fs.read', (_$, e) => {
      const text = files.get(e.path)
      if (text === undefined) throw new Error(`ENOENT ${e.path}`)
      return { value: text }
    })
    on('fs.write', (_$, e) => {
      files.set(e.path, e.text)
      writes.push(e.text)

      return { value: undefined }
    })
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.focus', () => ({}))

    const ids = () => flatten(state.design ?? { version: 1, name: '', description: '', nodes: [] }).map(row => `${'  '.repeat(row.depth)}${row.node.id}`)
    const saved = () => {
      const parsed = parseDesign(writes.at(-1) ?? '')
      if (!parsed.ok) throw new Error(parsed.error)
      return flatten(parsed.design).map(row => row.node.id)
    }

    await $.command.run({ command: 'conductor', args: 'design demo', ...RUN })
    const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: DESIGN_PANE_ID, props: PANE })
    await ui.press({ key: 'template:review' })
    expect(ids()).toEqual(['n1', 'n2', '  n3', '  n4', 'n5'])

    // The canvas's lines, top to bottom: each is one outer Text; rows are told by their id.
    const lines = async () => {
      const out: string[] = []
      for (const one of await ui.findAll({ type: 'Text', in: 'canvas' })) {
        const id = /^(?:[│├╰ ]*)\S (n\d+) {2}/.exec(one.text ?? '')
        if (id?.[1] && one.props.wrap === 'truncate-end') out.push(id[1])
      }
      return out
    }
    const lit = async () => (await ui.findAll({ type: 'Text', in: 'canvas' })).filter(one => one.props.inverse === true).map(one => one.text)
    expect(await lines()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])

    // A click selects: the inspector follows, nothing is written.
    const before = writes.length
    await ui.pointer({ type: 'down', x: TITLE, y: 4, button: 'left' })
    await ui.pointer({ type: 'up', x: TITLE, y: 4, button: 'left' })
    expect(state.ui?.selectedId).toBe('n5')
    expect((await ui.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('synthesize')
    expect(writes).toHaveLength(before)

    // Press n1 and carry it down: it is lifted (inverse) into the gap the others open.
    await ui.pointer({ type: 'down', x: TITLE, y: 0, button: 'left' })
    await ui.pointer({ type: 'move', x: TITLE, y: 1, button: 'left' })
    await ui.pointer({ type: 'move', x: TITLE, y: 2, button: 'left' })
    await ui.pointer({ type: 'move', x: TITLE, y: 3, button: 'left' })
    expect(await lit()).toEqual(['● n1  scout diff '])
    expect(await ui.find({ type: 'Text', text: /release to drop/, in: 'canvas' })).toBeDefined()
    // Nothing moves in the design until the drop.
    expect(ids()).toEqual(['n1', 'n2', '  n3', '  n4', 'n5'])
    expect(writes).toHaveLength(before)
    await ui.advance(200)
    expect(await lines()).toEqual(['n2', 'n3', 'n4', 'n1', 'n5'])

    // Drop: one move, one write. Straight down from the top level lands after the pipeline.
    await ui.pointer({ type: 'up', x: TITLE, y: 3, button: 'left' })
    expect(ids()).toEqual(['n2', '  n3', '  n4', 'n1', 'n5'])
    expect(writes).toHaveLength(before + 1)
    expect(saved()).toEqual(['n2', 'n3', 'n4', 'n1', 'n5'])
    expect(state.ui?.selectedId).toBe('n1')
    await ui.advance(200)
    expect(await lines()).toEqual(['n2', 'n3', 'n4', 'n1', 'n5'])
    expect(await lit()).toEqual(['n1  scout diff'])
    expect(await ui.find({ type: 'Text', text: /release to/, in: 'canvas' })).toBe(undefined)

    // The same slot a level to the right is the pipeline's end: n5 up one line and in.
    await ui.pointer({ type: 'down', x: TITLE, y: 4, button: 'left' })
    await ui.pointer({ type: 'move', x: TITLE, y: 3, button: 'left' })
    await ui.pointer({ type: 'move', x: TITLE + 3, y: 3, button: 'left' })
    await ui.pointer({ type: 'up', x: TITLE + 3, y: 3, button: 'left' })
    expect(ids()).toEqual(['n2', '  n3', '  n4', '  n5', 'n1'])
    expect(writes).toHaveLength(before + 2)

    // A drop on the hint line cancels: no move, no write.
    await ui.pointer({ type: 'down', x: TITLE, y: 4, button: 'left' })
    await ui.pointer({ type: 'move', x: TITLE, y: 2, button: 'left' })
    await ui.pointer({ type: 'leave', x: TITLE, y: 2 })
    await ui.pointer({ type: 'move', x: TITLE, y: 6, button: 'left' })
    expect(await ui.find({ type: 'Text', text: /release to cancel/, in: 'canvas' })).toBeDefined()
    await ui.pointer({ type: 'up', x: TITLE, y: 6, button: 'left' })
    expect(ids()).toEqual(['n2', '  n3', '  n4', '  n5', 'n1'])
    expect(writes).toHaveLength(before + 2)

    // Fold the pipeline by its glyph: its stages go, the rows under it slide up and settle.
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left' })
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left' })
    expect(await ui.find({ type: 'Text', text: /\[\+3\]/, in: 'canvas' })).toBeDefined()
    await ui.advance(200)
    expect(await lines()).toEqual(['n2', 'n1'])
    // The clock can run on with nothing left to move: the drawing stays as it is.
    const settled = (await ui.findAll({ type: 'Text', in: 'canvas' })).map(one => one.text)
    await ui.advance(1000)
    expect((await ui.findAll({ type: 'Text', in: 'canvas' })).map(one => one.text)).toEqual(settled)
    expect(writes).toHaveLength(before + 2)

    await ui.unmount()
  })
}
