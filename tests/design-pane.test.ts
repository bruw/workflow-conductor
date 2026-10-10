import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { flatten, parseDesign, serializeDesign } from '../src/design/model'
import type { Design } from '../src/design/model'
import { DESIGN_PANE_ID, DESIGN_PANE_TITLE, designFile } from '../src/design/session'
import type { DesignUi } from '../src/design/session'
import { review } from '../src/design/templates'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/project'
const FILE = designFile(ROOT, 'demo')
const PANE = { title: DESIGN_PANE_TITLE, isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

// What the mod last wrote to $.state, seen from beneath it.
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
  test(`designer: template, add, rename, move, remove, each saved, on ${surface}`, async ($, on) => {
    // The world beneath the mod: a project root and a file system in memory.
    const files = new Map<string, string>()
    const writes: { path: string; text: string }[] = []
    const fills: string[] = []
    const state = watch(on)
    const focused: string[] = []
    mock.clock(on)
    on('session.root', () => ({ value: ROOT }))
    on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
    on('fs.read', (_$, e) => {
      const text = files.get(e.path)
      if (text === undefined) throw new Error(`ENOENT ${e.path}`)
      return { value: text }
    })
    on('fs.write', (_$, e) => {
      files.set(e.path, e.text)
      writes.push({ path: e.path, text: e.text })

      return { value: undefined }
    })
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.focus', (_$, e) => {
      focused.push(e.element ?? '')
      return {}
    })
    on('prompt.fill', (_$, e) => {
      fills.push(e.text)
      return { isFilled: true }
    })
    const saved = () => {
      const last = writes.at(-1)
      const parsed = parseDesign(last?.text ?? '')
      if (!parsed.ok) throw new Error(parsed.error)
      return parsed.design
    }
    const ids = async () => flatten(state.design ?? review()).map(row => `${'  '.repeat(row.depth)}${row.node.id}`)

    // Open by command: nothing saved under that name, so the template picker shows.
    const answer = await $.command.run({ command: 'conductor', args: 'design demo', ...RUN })
    expect(answer.text).toMatch(/pick a template/)
    expect(state.ui?.status).toBe('pick')

    const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: DESIGN_PANE_ID, props: PANE })
    expect((await ui.findAll({ type: 'Button' })).map(one => one.key)).toEqual([
      'template:review',
      'template:research',
      'template:migrate',
      'template:judge-panel',
      'template:blank',
    ])
    expect(await ui.find({ type: 'Client' })).toBe(undefined)
    expect(writes).toEqual([])

    // Pick the review template: the design is created, named after the file, and saved.
    await ui.press({ key: 'template:review' })
    expect(await ids()).toEqual(['n1', 'n2', '  n3', '  n4', 'n5'])
    expect(state.ui).toMatchObject({ status: 'ready', name: 'demo', selectedId: 'n1' })
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe(FILE)
    expect(writes[0]?.text).toBe(serializeDesign({ ...review(), name: 'demo' }))

    // The canvas is a Client now, with the inspector under it.
    const client = await ui.find({ type: 'Client' })
    expect(client?.key).toBe('canvas')
    expect(client?.props.module).toMatch(/canvas\.tsx$/)
    expect(await ui.find({ type: 'Text', text: 'n1  scout diff', in: 'canvas' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '│  ╰ ', in: 'canvas' })).toBeDefined()
    // The canvas has no hint line of its own: the toolbar shows the keys.
    expect(await ui.find({ type: 'Text', text: /j\/k move/, in: 'canvas' })).toBe(undefined)
    expect((await ui.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('scout diff')
    expect(await ui.find({ type: 'Text', text: 'One subagent call' })).toBeDefined()

    // Move the selection with the keyboard: the inspector follows.
    await ui.key({ key: 'j' })
    expect(state.ui?.selectedId).toBe('n2')
    expect((await ui.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('review')
    expect(await ui.find({ type: 'Select', key: 'design-model' })).toBe(undefined)
    await ui.key({ key: 'k' })
    expect(await ui.find({ type: 'Select', key: 'design-model' })).toBeDefined()
    expect(await ui.find({ type: 'Select', key: 'design-isolation' })).toBeDefined()

    // Add a node through the picker: after n1, filtered to "critic".
    await ui.key({ key: 'a' })
    expect(await ui.find({ type: 'Text', text: 'type a block name', in: 'canvas' })).toBeDefined()
    for (const char of 'crit') await ui.key({ key: char })
    expect(await ui.find({ type: 'Text', text: '+ crit', in: 'canvas' })).toBeDefined()
    await ui.key({ key: 'return' })
    expect(await ids()).toEqual(['n1', 'n6', 'n2', '  n3', '  n4', 'n5'])
    expect(state.design?.nodes[1]).toMatchObject({ id: 'n6', type: 'critic', title: 'critic' })
    expect(state.ui).toMatchObject({ selectedId: 'n6' })
    expect(writes).toHaveLength(2)
    expect(saved().nodes[1]).toMatchObject({ id: 'n6', type: 'critic' })
    expect(saved().nextId).toBe(7)
    // The canvas took the new node as its selection: its row is the lit one.
    const lit = (await ui.findAll({ type: 'Text', in: 'canvas' })).filter(one => one.props.inverse === true)
    expect(lit.map(one => one.text)).toEqual(['n6  critic'])
    expect(lit[0]?.props.color).toBe('claude')

    // Rename it in the inspector.
    expect((await ui.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('critic')
    await ui.input({ key: 'design-title', text: 'gap check' })
    expect(state.design?.nodes[1]?.title).toBe('gap check')
    expect(saved().nodes[1]?.title).toBe('gap check')
    expect(await ui.find({ type: 'Text', text: 'n6  gap check', in: 'canvas' })).toBeDefined()
    await ui.input({ key: 'design-notes', text: 'ask what is missing' })
    await ui.select({ key: 'design-effort', value: 'low' })
    expect(saved().nodes[1]).toMatchObject({ notes: 'ask what is missing', knobs: { effort: 'low' } })
    await ui.select({ key: 'design-effort', value: 'inherit' })
    expect(saved().nodes[1]?.knobs).toBe(undefined)

    // Grab it and move it down: one step enters the pipeline, as its first stage.
    await ui.key({ key: ' ' })
    await ui.key({ key: 'j' })
    expect(await ids()).toEqual(['n1', 'n2', '  n6', '  n3', '  n4', 'n5'])
    expect(saved().nodes[1]?.children?.[0]?.id).toBe('n6')
    await ui.key({ key: ' ' })

    // A move posted with an exact place (what a pointer drop will send) lands the same way.
    await ui.post({ kind: 'move', id: 'n6', to: { index: 0 } })
    expect(await ids()).toEqual(['n6', 'n1', 'n2', '  n3', '  n4', 'n5'])

    // Remove another node: n1, the row under the selection.
    await ui.key({ key: 'j' })
    expect(state.ui?.selectedId).toBe('n1')
    await ui.key({ key: 'x' })
    expect(await ids()).toEqual(['n6', 'n2', '  n3', '  n4', 'n5'])
    expect(state.ui).toMatchObject({ selectedId: 'n2' })
    expect(flatten(saved()).map(row => row.node.id)).toEqual(['n6', 'n2', 'n3', 'n4', 'n5'])
    expect(await ui.find({ type: 'Text', text: 'n1  scout diff', in: 'canvas' })).toBe(undefined)

    // Every change was one write of the whole design to the same file; ids are never reused.
    expect(new Set(writes.map(one => one.path))).toEqual(new Set([FILE]))
    expect(files.get(FILE)).toBe(serializeDesign(state.design ?? review()))
    expect(saved().nextId).toBe(7)

    // The card, the edit key and the Run button.
    expect(await ui.find({ key: 'design-card' })).toBe(undefined)
    await ui.key({ key: '?' })
    expect(await ui.find({ key: 'design-card' })).toBeDefined()
    await ui.post({ kind: 'toggleCard' })
    expect(await ui.find({ key: 'design-card' })).toBe(undefined)
    await ui.key({ key: 'return' })
    expect(state.ui).toMatchObject({ selectedId: 'n2' })
    await ui.press({ key: 'design-run' })
    expect(fills).toEqual(['/conductor run demo'])

    // A refused edit changes nothing and writes nothing; junk is ignored.
    const before = writes.length
    await ui.post({ kind: 'move', id: 'n2', to: { parentId: 'n3', index: 0 } })
    await ui.post({ kind: 'remove', id: 'n99' })
    await ui.post({ nonsense: true })
    expect(writes).toHaveLength(before)
    expect(state.ui?.notice).toMatch(/no node n99/)

    await ui.unmount()
  })

  test(`designer: the toolbar's hotkey Buttons drive it with no Client act, on ${surface}`, async ($, on) => {
    const files = new Map<string, string>()
    const writes: string[] = []
    const fills: string[] = []
    const focused: string[] = []
    const state = watch(on)
    mock.clock(on)
    on('session.root', () => ({ value: ROOT }))
    on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
    on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
    on('fs.write', (_$, e) => {
      files.set(e.path, e.text)
      writes.push(e.text)

      return { value: undefined }
    })
    const opened: (true | undefined)[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.focus)

      return { value: { isPlaced: true } }
    })
    on('ui.focus', (_$, e) => {
      focused.push(e.element ?? '')
      return {}
    })
    on('prompt.fill', (_$, e) => {
      fills.push(e.text)
      return { isFilled: true }
    })
    const saved = () => {
      const parsed = parseDesign(writes.at(-1) ?? '')
      if (!parsed.ok) throw new Error(parsed.error)
      return parsed.design
    }
    const ids = () => flatten(saved()).map(row => `${'  '.repeat(row.depth)}${row.node.id}`)

    await $.command.run({ command: 'conductor', args: 'design demo', ...RUN })
    // The pane asks for the keyboard, so the hotkeys are armed as it opens.
    expect(opened).toEqual([true])
    const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: DESIGN_PANE_ID, props: PANE })
    await ui.press({ key: 'template:review' })
    expect(ids()).toEqual(['n1', 'n2', '  n3', '  n4', 'n5'])

    // The toolbar is the hint line: one plain dim Button per key.
    const keys = (await ui.findAll({ type: 'Button' })).filter(one => typeof one.props.hotkey === 'string')
    expect(keys.map(one => `${String(one.props.hotkey)}:${one.key ?? ''}`)).toEqual([
      'j:key:down',
      'k:key:up',
      'g:key:grab',
      'a:key:addAfter',
      'i:key:addInside',
      'x:key:remove',
      'e:key:edit',
      'h:key:card',
      'r:design-run',
    ])
    expect(keys.every(one => one.props.plain === true && one.props.dimColor === true)).toBe(true)

    // j and k move the selection; the inspector follows and the canvas is told (rev).
    const rev = state.ui?.rev ?? 0
    await ui.press({ key: 'key:down' })
    expect(state.ui).toMatchObject({ selectedId: 'n2', rev: rev + 1 })
    expect((await ui.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('review')
    expect((await ui.find({ type: 'Client' }))?.props.props).toMatchObject({ selectedId: 'n2', rev: rev + 1 })
    await ui.press({ key: 'key:down' })
    expect(state.ui?.selectedId).toBe('n3')
    await ui.press({ key: 'key:up' })
    await ui.press({ key: 'key:up' })
    await ui.press({ key: 'key:up' })
    expect(state.ui?.selectedId).toBe('n1')
    expect(writes).toHaveLength(1)

    // a: the picker's field takes the ring; typing filters, Enter adds the first match.
    await ui.press({ key: 'key:addAfter' })
    expect(state.ui?.picker).toEqual({ at: { index: 1 }, query: '' })
    expect((await ui.find({ type: 'Input', key: 'design-add' }))?.props.autoFocus).toBe(true)
    // While it is open no hotkey is armed: letters go to the field.
    expect((await ui.findAll({ type: 'Button' })).filter(one => one.props.hotkey !== undefined)).toEqual([])
    await ui.input({ key: 'design-add', text: 'crit', kind: 'change' })
    expect(state.ui?.picker?.query).toBe('crit')
    expect((await ui.findAll({ type: 'Button' })).map(one => one.key)[0]).toBe('pick:critic')
    await ui.input({ key: 'design-add', text: 'crit' })
    expect(ids()).toEqual(['n1', 'n6', 'n2', '  n3', '  n4', 'n5'])
    expect(saved().nodes[1]).toMatchObject({ id: 'n6', type: 'critic' })
    expect(state.ui).toMatchObject({ selectedId: 'n6', picker: null })
    expect(await ui.find({ type: 'Input', key: 'design-add' })).toBe(undefined)

    // i: inside the selected container, at its end, by pressing a match; refused on a leaf.
    await ui.press({ key: 'key:addInside' })
    expect(state.ui?.picker).toBe(null)
    expect(state.ui?.notice).toMatch(/holds no blocks/)
    await ui.press({ key: 'key:down' })
    await ui.press({ key: 'key:addInside' })
    expect(state.ui?.picker).toEqual({ at: { parentId: 'n2', index: 2 }, query: '' })
    await ui.press({ key: 'pick:agent' })
    expect(ids()).toEqual(['n1', 'n6', 'n2', '  n3', '  n4', '  n7', 'n5'])
    expect(state.ui?.selectedId).toBe('n7')
    // The picker closes without adding.
    await ui.press({ key: 'key:addAfter' })
    await ui.press({ key: 'design-add-cancel' })
    expect(state.ui?.picker).toBe(null)
    expect(writes).toHaveLength(3)

    // e: the ring goes to the title field (the kit raises no ui.focus to see); Enter there renames.
    await ui.press({ key: 'key:edit' })
    await ui.input({ key: 'design-title', text: 'second look' })
    expect(saved().nodes[2]?.children?.[2]).toMatchObject({ id: 'n7', title: 'second look' })

    // g grabs: j/k then move the block, g drops it.
    await ui.press({ key: 'key:grab' })
    expect(state.ui?.grabbedId).toBe('n7')
    expect((await ui.find({ type: 'Button', key: 'key:grab' }))?.props.label).toBe('drop')
    await ui.press({ key: 'key:up' })
    expect(ids()).toEqual(['n1', 'n6', 'n2', '  n3', '  n7', '  n4', 'n5'])
    expect(state.ui?.selectedId).toBe('n7')
    await ui.press({ key: 'key:grab' })
    expect(state.ui?.grabbedId).toBe(null)

    // x on a container that holds blocks asks once; moving away forgets the question.
    await ui.press({ key: 'key:up' })
    await ui.press({ key: 'key:up' })
    expect(state.ui?.selectedId).toBe('n2')
    const before = writes.length
    await ui.press({ key: 'key:remove' })
    expect(state.ui).toMatchObject({ confirmId: 'n2', selectedId: 'n2' })
    expect(state.ui?.notice).toMatch(/n2 holds 3 blocks: x again/)
    await ui.press({ key: 'key:down' })
    await ui.press({ key: 'key:up' })
    expect(state.ui?.confirmId).toBe(null)
    await ui.press({ key: 'key:remove' })
    expect(writes).toHaveLength(before)
    await ui.press({ key: 'key:remove' })
    expect(ids()).toEqual(['n1', 'n6', 'n5'])
    expect(state.ui).toMatchObject({ selectedId: 'n5', confirmId: null, notice: null })
    // A leaf goes at once.
    await ui.press({ key: 'key:remove' })
    expect(ids()).toEqual(['n1', 'n6'])
    expect(state.ui?.selectedId).toBe('n6')
    expect(files.get(FILE)).toBe(serializeDesign(state.design ?? review()))

    // h shows the card; r puts the handoff command in the prompt for the person to send.
    await ui.press({ key: 'key:card' })
    expect(await ui.find({ key: 'design-card' })).toBeDefined()
    await ui.press({ key: 'design-run' })
    expect(fills).toEqual(['/conductor run demo'])
    expect(state.ui?.notice).toBe('run: /conductor run demo is in the prompt · Enter sends it')
    // Sending that command spends the hint: it must not sit under the run it started.
    await $.command.run({ command: 'conductor', args: 'run demo', ...RUN })
    expect(state.ui?.notice).toBe(null)

    await ui.unmount()
  })

  test(`designer: a saved design opens as it is, and a broken file is reported, not replaced, on ${surface}`, async ($, on) => {
    const stored = serializeDesign({ ...review(), name: 'kept' })
    const files = new Map<string, string>([
      [designFile(ROOT, 'kept'), stored],
      [designFile(ROOT, 'broken'), '{ "version": 1, "name": '],
    ])
    const writes: string[] = []
    const state = watch(on)
    on('session.root', () => ({ value: ROOT }))
    on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
    on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
    on('fs.write', (_$, e) => {
      writes.push(e.path)

      return { value: undefined }
    })
    on('ui.open', () => ({ value: { isPlaced: true } }))

    const opened = await $.command.run({ command: 'conductor', args: 'design Kept', ...RUN })
    expect(opened.text).toMatch(/Design kept opened/)
    expect(state.ui).toMatchObject({ status: 'ready', name: 'kept', selectedId: 'n1' })
    expect(serializeDesign(state.design ?? review())).toBe(stored)

    // A short pane: the canvas gets a fixed height and scrolls inside it once the picker opens.
    const short = await $.ui.mount({
      plugin: 'conductor',
      surface,
      component: 'Pane',
      requestId: DESIGN_PANE_ID,
      props: PANE,
      viewport: { columns: 160, rows: 28 },
    })
    const canvas = await short.find({ type: 'Client' })
    expect(canvas?.props.height).toBe(8)
    expect(canvas?.props.props).toMatchObject({ maxRows: 8, selectedId: 'n1', mode: 'design' })
    const lines = async () => ((await short.drawn({ in: 'canvas' })) as { children?: unknown[] }).children?.length
    // Six rows and no hint line under them.
    expect(await lines()).toBe(6)
    await short.key({ key: 'a' })
    expect(await lines()).toBe(8)
    expect(await short.find({ type: 'Text', text: /^↓5 type to filter/, in: 'canvas' })).toBeDefined()
    await short.key({ key: 'backspace' })
    expect(await lines()).toBe(6)
    expect(writes).toEqual([])
    await short.unmount()

    const broken = await $.command.run({ command: 'conductor', args: 'design broken', ...RUN })
    expect(broken.text).toMatch(/could not be opened/)
    expect(state.ui).toMatchObject({ status: 'error', name: 'broken' })
    expect(state.design).toBe(null)

    const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: DESIGN_PANE_ID, props: PANE })
    const report = await ui.find({ type: 'Text', text: /broken\.json could not be used: not valid JSON/ })
    expect(report?.props.color).toBe('error')
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
    expect(await ui.find({ type: 'Client' })).toBe(undefined)
    expect(writes).toEqual([])
    expect(files.get(designFile(ROOT, 'broken'))).toBe('{ "version": 1, "name": ')
    await ui.unmount()
  })
}
