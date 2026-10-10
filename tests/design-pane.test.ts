import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { flatten, parseDesign, serializeDesign } from '../src/design/model'
import type { Design } from '../src/design/model'
import { PANE_COLUMNS } from '../hooks/design'
import { DESIGN_PANE_ID, DESIGN_PANE_TITLE, designFile } from '../src/design/session'
import { KEY_OPS } from '../src/ui/board-model'
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

// The board as drawn: one string per row.
type Drawn = { children?: (Drawn | string)[] }
const flat = (node: Drawn | string): string => (typeof node === 'string' ? node : (node.children ?? []).map(flat).join(''))
const screen = async (ui: { drawn: (query: { in: string }) => Promise<unknown> }): Promise<string[]> => ((await ui.drawn({ in: 'canvas' })) as Drawn).children?.map(flat) ?? []

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

    // The board is a Client, with the inspector under it. A docked pane flows top to bottom.
    const client = await ui.find({ type: 'Client' })
    expect(client?.key).toBe('canvas')
    expect(client?.props.module).toMatch(/canvas\.tsx$/)
    expect(client?.props.props).toMatchObject({ mode: 'design', orientation: 'vertical', selectedId: 'n1', grabbedId: null, pickerAt: null })
    const first = await screen(ui)
    // The selected card has the heavy border; the pipeline is a box around its stages.
    expect(first[0]).toMatch(/^┏━━ n1 agent ━+┓$/)
    expect(first[1]).toMatch(/^┃ scout diff +┃$/)
    // Cards fill the pane's columns; the selected one says its notes in full.
    expect([...(first[0] ?? '')]).toHaveLength(PANE.bodyColumns - 2)
    expect(first[2]).toMatch(/^┃ Cheap and mechanical\. Its list of dimensions is the work-list for the +┃$/)
    expect(first[3]).toMatch(/^┃ pipeline\. +┃$/)
    expect(first.some(line => /^│ ╭── n3 agent ─+╮ │$/.test(line))).toBe(true)
    // No legend row and no file row: the board ends with the top level's +, the pane with the inspector.
    expect(first.at(-1)).toBe(' + add block ')
    expect(first).toHaveLength(Number(client?.props.height))
    const chrome = (await ui.findAll({ type: 'Text' })).map(one => one.text ?? '').join('\n')
    expect(chrome).not.toMatch(/hands each result|drag a card|workflow-designs|gives it the keys/)
    expect((await ui.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('scout diff')
    expect(await ui.find({ type: 'Text', text: 'One subagent call' })).toBeDefined()

    // Move the selection with the keyboard: the inspector follows.
    await ui.key({ key: 'j' })
    expect(state.ui?.selectedId).toBe('n2')
    expect((await ui.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('review')
    expect(await ui.find({ type: 'Select', key: 'design-model' })).toBe(undefined)
    // Across the flow: into the pipeline, and back out.
    await ui.key({ key: 'right' })
    expect(state.ui?.selectedId).toBe('n3')
    await ui.key({ key: 'left' })
    expect(state.ui?.selectedId).toBe('n2')
    await ui.key({ key: 'k' })
    expect(await ui.find({ type: 'Select', key: 'design-model' })).toBeDefined()
    expect(await ui.find({ type: 'Select', key: 'design-isolation' })).toBeDefined()

    // Add a node through the picker: after n1, filtered to "critic". The slot it will take is lit.
    await ui.key({ key: 'a' })
    expect(state.ui?.picker).toEqual({ at: { index: 1 }, query: '' })
    expect((await ui.find({ type: 'Client' }))?.props.props).toMatchObject({ pickerAt: { index: 1 } })
    expect((await ui.findAll({ type: 'Text', in: 'canvas' })).filter(one => one.props.inverse === true).map(one => one.text)).toEqual([' + '])
    // Every block type is on offer at once.
    expect((await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('pick:'))).toHaveLength(12)
    await ui.input({ key: 'design-add', text: 'crit' })
    expect(await ids()).toEqual(['n1', 'n6', 'n2', '  n3', '  n4', 'n5'])
    expect(state.design?.nodes[1]).toMatchObject({ id: 'n6', type: 'critic', title: 'critic' })
    expect(state.ui).toMatchObject({ selectedId: 'n6', picker: null })
    expect(writes).toHaveLength(2)
    expect(saved().nodes[1]).toMatchObject({ id: 'n6', type: 'critic' })
    expect(saved().nextId).toBe(7)
    // The board draws the new node selected.
    await ui.advance(200)
    const lit = (await ui.findAll({ type: 'Text', in: 'canvas' })).filter(one => one.text?.includes('n6 critic'))
    // Selected is the heavy border and bold, in the critic's own colour.
    expect(lit.map(one => one.props)).toEqual([{ color: 'permission', bold: true }])

    // Rename it in the inspector.
    expect((await ui.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('critic')
    await ui.input({ key: 'design-title', text: 'gap check' })
    expect(state.design?.nodes[1]?.title).toBe('gap check')
    expect(saved().nodes[1]?.title).toBe('gap check')
    expect((await screen(ui)).some(line => /^┃ gap check +┃$/.test(line))).toBe(true)
    await ui.input({ key: 'design-notes', text: 'ask what is missing' })
    await ui.select({ key: 'design-effort', value: 'low' })
    expect(saved().nodes[1]).toMatchObject({ notes: 'ask what is missing', knobs: { effort: 'low' } })
    await ui.select({ key: 'design-effort', value: 'inherit' })
    expect(saved().nodes[1]?.knobs).toBe(undefined)

    // Grab it and move it down: one step enters the pipeline, as its first stage.
    await ui.key({ key: 'g' })
    expect(state.ui?.grabbedId).toBe('n6')
    await ui.key({ key: 'j' })
    expect(await ids()).toEqual(['n1', 'n2', '  n6', '  n3', '  n4', 'n5'])
    expect(saved().nodes[1]?.children?.[0]?.id).toBe('n6')
    await ui.key({ key: 'g' })
    expect(state.ui?.grabbedId).toBe(null)

    // A move posted with an exact place (what a pointer drop sends) lands the same way.
    await ui.post({ kind: 'move', id: 'n6', to: { index: 0 } })
    expect(await ids()).toEqual(['n6', 'n1', 'n2', '  n3', '  n4', 'n5'])

    // Remove another node: n1, the card under the selection.
    await ui.key({ key: 'j' })
    expect(state.ui?.selectedId).toBe('n1')
    await ui.key({ key: 'x' })
    expect(await ids()).toEqual(['n6', 'n2', '  n3', '  n4', 'n5'])
    expect(state.ui).toMatchObject({ selectedId: 'n2' })
    expect(flatten(saved()).map(row => row.node.id)).toEqual(['n6', 'n2', 'n3', 'n4', 'n5'])
    await ui.advance(200)
    expect((await screen(ui)).join('\n')).not.toMatch(/n1 agent|scout diff/)

    // Every change was one write of the whole design to the same file; ids are never reused.
    expect(new Set(writes.map(one => one.path))).toEqual(new Set([FILE]))
    expect(files.get(FILE)).toBe(serializeDesign(state.design ?? review()))
    expect(saved().nextId).toBe(7)

    // The card, the edit key and the Run button.
    expect(await ui.find({ key: 'design-card' })).toBe(undefined)
    await ui.key({ key: 'c' })
    expect(await ui.find({ key: 'design-card' })).toBeDefined()
    // The help card is where the legend and the file's path now are.
    const help = (await ui.findAll({ type: 'Text' })).map(one => one.text ?? '').join('\n')
    expect(help).toMatch(/hands each result on[\s\S]*waits for all[\s\S]*\+ adds a block[\s\S]*drag a card[\s\S]*\.claude\/workflow-designs\/demo\.json/)
    await ui.post({ kind: 'key', op: 'card', orientation: 'vertical' })
    expect(await ui.find({ key: 'design-card' })).toBe(undefined)
    await ui.key({ key: 'return' })
    expect(state.ui).toMatchObject({ selectedId: 'n2' })
    await ui.press({ key: 'design-run' })
    expect(fills).toEqual(['/conductor run demo'])
    // r on the board is the same run.
    await ui.key({ key: 'r' })
    expect(fills).toEqual(['/conductor run demo', '/conductor run demo'])
    expect(state.ui?.notice).toBe('run: /conductor run demo is in the prompt · Enter sends it')

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

    // The toolbar is one row of plain dim Buttons, one per key: no legend beside it.
    const keys = (await ui.findAll({ type: 'Button' })).filter(one => typeof one.props.hotkey === 'string')
    expect(keys.map(one => `${String(one.props.hotkey)}:${one.key ?? ''}`)).toEqual([
      'h:key:left',
      'j:key:down',
      'k:key:up',
      'l:key:right',
      'a:key:addAfter',
      'i:key:addInside',
      'x:key:remove',
      'g:key:grab',
      'e:key:edit',
      'z:key:compact',
      'c:key:card',
      'r:design-run',
    ])
    expect(keys.every(one => one.props.plain === true && one.props.dimColor === true)).toBe(true)
    // `x: label`, a cell apart: the row fits the body of the dock the pane asks for.
    const width = keys.reduce((sum, one) => sum + String(one.props.label).length + 3, 0) + keys.length - 1
    expect(width).toBeLessThanOrEqual(PANE_COLUMNS - 4)
    expect(width).toBeLessThanOrEqual(80)
    // The ring rests on edit, so Enter edits here as it does on the board.
    expect(keys.filter(one => one.props.autoFocus === true).map(one => one.key)).toEqual(['key:edit'])

    // The arrows move the selection as the docked board flows: down the flow, right into a box.
    await ui.press({ key: 'key:down' })
    expect(state.ui).toMatchObject({ selectedId: 'n2' })
    expect((await ui.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('review')
    expect((await ui.find({ type: 'Client' }))?.props.props).toMatchObject({ selectedId: 'n2' })
    await ui.press({ key: 'key:right' })
    expect(state.ui?.selectedId).toBe('n3')
    await ui.press({ key: 'key:down' })
    expect(state.ui?.selectedId).toBe('n4')
    await ui.press({ key: 'key:left' })
    expect(state.ui?.selectedId).toBe('n2')
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

    // g grabs: the arrows then move the block, g drops it. The board draws it lifted.
    await ui.press({ key: 'key:grab' })
    expect(state.ui?.grabbedId).toBe('n7')
    expect((await ui.find({ type: 'Button', key: 'key:grab' }))?.props.label).toBe('drop')
    expect((await ui.find({ type: 'Client' }))?.props.props).toMatchObject({ grabbedId: 'n7' })
    await ui.press({ key: 'key:up' })
    expect(ids()).toEqual(['n1', 'n6', 'n2', '  n3', '  n7', '  n4', 'n5'])
    expect(state.ui?.selectedId).toBe('n7')
    await ui.press({ key: 'key:grab' })
    expect(state.ui?.grabbedId).toBe(null)

    // x on a container that holds blocks asks once, on the toolbar and on the card; moving away forgets the question.
    await ui.press({ key: 'key:left' })
    expect(state.ui?.selectedId).toBe('n2')
    const before = writes.length
    await ui.press({ key: 'key:remove' })
    expect(state.ui).toMatchObject({ confirmId: 'n2', selectedId: 'n2' })
    expect(state.ui?.notice).toMatch(/n2 holds 3 blocks: delete again/)
    expect((await ui.find({ type: 'Button', key: 'key:remove' }))?.props.label).toBe('sure?')
    expect((await ui.find({ type: 'Client' }))?.props.props).toMatchObject({ confirmId: 'n2' })
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

    // z: compact mode. Every card but the selected one is a row; the board is much shorter; z again brings them back.
    const full = Number((await ui.find({ type: 'Client' }))?.props.height)
    const kept = writes.length
    await ui.press({ key: 'key:compact' })
    await ui.advance(200)
    expect(state.ui?.compact).toBe(true)
    expect((await ui.find({ type: 'Client' }))?.props.props).toMatchObject({ compact: true, selectedId: 'n6' })
    expect((await ui.find({ type: 'Button', key: 'key:compact' }))?.props.label).toBe('full')
    const rows = await screen(ui)
    expect(rows[0]).toMatch(/^╶── n1 agent · scout diff ─+╴$/)
    expect(rows.some(line => /^┏━▼ n6 critic ━+┓$/.test(line))).toBe(true)
    expect(rows).toHaveLength(Number((await ui.find({ type: 'Client' }))?.props.height))
    expect(rows.length).toBeLessThan(full)
    expect(writes).toHaveLength(kept)
    await ui.press({ key: 'key:compact' })
    expect(state.ui?.compact).toBe(false)
    expect((await ui.find({ type: 'Button', key: 'key:compact' }))?.props.label).toBe('compact')
    expect(Number((await ui.find({ type: 'Client' }))?.props.height)).toBe(full)

    // c shows the card; r puts the handoff command in the prompt for the person to send.
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

  test(`designer: every key does the same from the toolbar and from the board, on ${surface}`, async ($, on) => {
    const files = new Map<string, string>()
    const fills: string[] = []
    const state = watch(on)
    mock.clock(on)
    on('session.root', () => ({ value: ROOT }))
    on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
    on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
    on('fs.write', (_$, e) => {
      files.set(e.path, e.text)

      return { value: undefined }
    })
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.focus', () => ({}))
    on('prompt.fill', (_$, e) => {
      fills.push(e.text)
      return { isFilled: true }
    })
    let letters: string[] = []

    // The same keys, once through the toolbar's Buttons and once typed at the board; what the pane holds after each is recorded.
    const drive = async (name: string, via: 'toolbar' | 'board'): Promise<unknown[]> => {
      await $.command.run({ command: 'conductor', args: `design ${name}`, ...RUN })
      const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: DESIGN_PANE_ID, props: PANE })
      await ui.press({ key: 'template:review' })
      const buttons = new Map((await ui.findAll({ type: 'Button' })).filter(one => typeof one.props.hotkey === 'string').map(one => [String(one.props.hotkey), one.key ?? '']))
      letters = [...buttons.keys()]
      const seen: unknown[] = []
      fills.length = 0
      const tap = async (letter: string): Promise<void> => {
        if (via === 'toolbar') await ui.press({ key: buttons.get(letter) ?? '' })
        else await ui.key({ key: letter })
        await ui.advance(200)
        const held = state.ui
        seen.push({
          letter,
          // The kit's pane holds no keyboard until a ui.open, so its $.ui.focus is refused on the toolbar's path
          // and the pane says to click the field: that one notice is the kit's, and is left out of the comparison.
          ui: { ...held, name: '', notice: held?.notice?.startsWith('edit: click') ? null : (held?.notice?.replaceAll(name, '<name>') ?? null) },
          ids: flatten(state.design ?? review()).map(row => `${'  '.repeat(row.depth)}${row.node.id}`),
          fills: fills.map(text => text.replaceAll(name, '<name>')),
          // What the board is told to draw; its rows are left out, since that notice takes one.
          board: await ui.find({ type: 'Client' }).then(one => ({ ...(one?.props.props as Record<string, unknown>), design: null, rows: 0, room: 0 })),
        })
      }
      // Move about, grab and carry, compact and back, the card and back, edit.
      for (const letter of ['j', 'l', 'j', 'h', 'k', 'g', 'j', 'g', 'z', 'z', 'c', 'c', 'e']) await tap(letter)
      // a and i open the picker, where no key is armed: it is closed by its own Buttons.
      await tap('a')
      await ui.press({ key: 'design-add-cancel' })
      // i is refused on a leaf; out to its container, it opens the picker inside.
      await tap('i')
      await tap('h')
      await tap('i')
      await ui.press({ key: 'pick:agent' })
      // x on a leaf, then twice on the container that holds blocks; r.
      await tap('x')
      await tap('h')
      await tap('x')
      await tap('x')
      await tap('r')
      await ui.unmount()

      return seen
    }
    const toolbar = await drive('one', 'toolbar')
    const board = await drive('two', 'board')
    // Step by step, so a difference names the key that made it.
    for (const [i, step] of toolbar.entries()) expect(board[i]).toEqual(step)
    expect(toolbar).toHaveLength(22)
    // Every letter the toolbar has is one the board answers, and the board answers no other letter.
    expect(letters.sort()).toEqual(Object.keys(KEY_OPS).filter(key => key.length === 1).sort())
    expect(letters).toHaveLength(12)

    await $.command.run({ command: 'conductor', args: 'design one', ...RUN })
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

    // A short pane: the board gets a fixed height (more than half the pane) and pans inside it, following the selection.
    const short = await $.ui.mount({
      plugin: 'conductor',
      surface,
      component: 'Pane',
      requestId: DESIGN_PANE_ID,
      props: { ...PANE, scroll: { offset: 0, bodyRows: 20 } },
    })
    const board = await short.find({ type: 'Client' })
    expect(board?.props.height).toBe(11)
    expect(board?.props.props).toMatchObject({ rows: 11, room: 11, selectedId: 'n1', mode: 'design', orientation: 'vertical' })
    // The last row says how much more there is below; nothing is said above at the top.
    const top = await screen(short)
    expect(top).toHaveLength(11)
    expect(top[0]).toMatch(/^┏━━ n1 agent/)
    expect(top.at(-1)).toMatch(/^ ▼ \d more below *$/)
    expect(top.join('\n')).not.toMatch(/n5 agent|more above/)
    // Into the pipeline, to its second stage: its header scrolls off and stays pinned on the first row, with what is above.
    await short.key({ key: 'j' })
    await short.key({ key: 'l' })
    await short.key({ key: 'j' })
    expect(state.ui?.selectedId).toBe('n4')
    await short.advance(200)
    const middle = await screen(short)
    expect(middle).toHaveLength(11)
    expect(middle[0]).toMatch(/^╭── n2 pipeline ×4 · review .* ▲ \d more above ─╮$/)
    expect(middle.some(line => /^│ ┏━▼ n4 verify ×3 ━+┓ │$/.test(line))).toBe(true)
    // The whole selected card is in view, its bottom border and stacked borders too.
    expect(middle.some(line => /^│ ┗━+ edit ━ del ━┛ │$/.test(line))).toBe(true)
    await short.key({ key: 'j' })
    await short.advance(200)
    const bottom = await screen(short)
    expect(bottom).toHaveLength(11)
    expect(bottom.some(line => /^┏━▼ n5 agent/.test(line))).toBe(true)
    expect(bottom.join('\n')).not.toMatch(/n1 agent/)
    expect(bottom[0]).toMatch(/▲ \d more above/)
    expect(bottom.at(-1)).toMatch(/^ \+ add block *$/)
    expect(writes).toEqual([])
    await short.unmount()

    // Inline (wide, short) the same design flows left to right, and asks for no more rows than it has.
    const wide = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: DESIGN_PANE_ID, props: { ...PANE, bodyColumns: 120, placement: 'inline', scroll: { offset: 0, bodyRows: 14 } } })
    // Fourteen rows: the header, the key row and one line of inspector leave the board eleven; it needs ten.
    expect((await wide.find({ type: 'Client' }))?.props).toMatchObject({ height: 10, props: { orientation: 'horizontal', rows: 10, room: 11, columns: 118 } })
    expect((await screen(wide))[1]).toMatch(/^│ scout diff +│ ─▶ │ ╭ n3 agent ─+╮ +╭ n4 verify ×3 ─+╮ +│ ═▶ ┃ synthesize +┃ \+ $/)
    // The inspector is one line: the block, its title, how its notes start. No fields, no rule.
    expect(await wide.find({ type: 'Input', key: 'design-title' })).toBe(undefined)
    expect(await wide.find({ type: 'Input', key: 'design-notes' })).toBe(undefined)
    expect(await wide.find({ type: 'Select', key: 'design-model' })).toBe(undefined)
    expect((await wide.find({ type: 'Text', text: /^n5 · agent · synthesize — Runs once over all surviving findings/ }))).toBeDefined()
    expect(await wide.find({ type: 'Text', text: /^─{20,}$/ })).toBe(undefined)
    // e opens it: the fields are there to type in, and the board gives up rows for them.
    await wide.press({ key: 'key:edit' })
    expect(state.ui?.editing).toBe(true)
    expect((await wide.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('synthesize')
    expect((await wide.find({ type: 'Input', key: 'design-notes' }))?.props.value).toMatch(/^Runs once over all surviving findings/)
    // Header, key row, headline, two fields with room to type, the knobs: the board keeps the six rows left, and stays sideways.
    expect((await wide.find({ type: 'Client' }))?.props).toMatchObject({ height: 6, props: { orientation: 'horizontal', room: 6 } })
    expect(await wide.find({ type: 'Select', key: 'design-model' })).toBeDefined()
    // Sending a field closes it again.
    await wide.input({ key: 'design-notes', text: 'Runs once.' })
    expect(writes).toHaveLength(1)
    expect(state.ui?.editing).toBe(false)
    expect(await wide.find({ type: 'Input', key: 'design-title' })).toBe(undefined)
    expect(await wide.find({ type: 'Text', text: 'n5 · agent · synthesize — Runs once.' })).toBeDefined()
    expect((await wide.find({ type: 'Client' }))?.props.height).toBe(10)
    // The board's own e opens it too; moving the selection closes it.
    await wide.key({ key: 'e' })
    expect(state.ui?.editing).toBe(true)
    expect(await wide.find({ type: 'Input', key: 'design-notes' })).toBeDefined()
    await wide.key({ key: 'h' })
    expect(state.ui).toMatchObject({ editing: false, selectedId: 'n2' })
    expect(await wide.find({ type: 'Input', key: 'design-notes' })).toBe(undefined)
    await wide.unmount()
    writes.length = 0

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
