import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { flatten, parseDesign } from '../src/design/model'
import type { Design } from '../src/design/model'
import { DESIGN_PANE_ID, DESIGN_PANE_TITLE } from '../src/design/session'
import type { DesignUi } from '../src/design/session'
import { layoutBoard } from '../src/ui/board-layout'
import type { BoardCard, BoardLayout, BoardSlot } from '../src/ui/board-layout'
import { affordances } from '../src/ui/board-paint'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/project'
// Inline: wide and short, so the board flows left to right and the whole review template fits.
const PANE = { title: DESIGN_PANE_TITLE, isFocused: true, bodyColumns: 140, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } } as const
const EMPTY: Design = { version: 1, name: '', description: '', nodes: [] }

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

type Drawn = { children?: (Drawn | string)[] }
const flat = (node: Drawn | string): string => (typeof node === 'string' ? node : (node.children ?? []).map(flat).join(''))

for (const surface of SURFACES) {
  test(`board: click to select, + to insert, drag to reorder and re-nest, del with a second ask, keys, on ${surface}`, async ($, on) => {
    const files = new Map<string, string>()
    const writes: string[] = []
    const state = watch(on)
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
      writes.push(e.text)

      return { value: undefined }
    })
    const opened: { rows?: number; columns?: number }[] = []
    on('ui.open', (_$, e) => {
      opened.push({ rows: e.rows, columns: e.columns })

      return { value: { isPlaced: true } }
    })
    on('ui.focus', () => ({}))

    const ids = () => flatten(state.design ?? EMPTY).map(row => `${'  '.repeat(row.depth)}${row.node.id}`)
    const saved = () => {
      const parsed = parseDesign(writes.at(-1) ?? '')
      if (!parsed.ok) throw new Error(parsed.error)
      return flatten(parsed.design).map(row => row.node.id)
    }
    // Where things are on the board now: the same layout the board draws from.
    const layout = (): BoardLayout => layoutBoard(state.design ?? EMPTY, { orientation: 'horizontal' })
    const card = (id: string): BoardCard => {
      const found = layout().cards.find(one => one.id === id)
      if (!found) throw new Error(`no card ${id}`)
      return found
    }
    const slot = (index: number, parentId?: string): BoardSlot => {
      const found = layout().slots.find(one => one.place.parentId === parentId && one.place.index === index)
      if (!found?.mark) throw new Error(`no + at ${parentId ?? 'top'}:${index}`)
      return found
    }

    await $.command.run({ command: 'conductor', args: 'design demo', ...RUN })
    // The pane asks for the rows a nested container and the inspector need, and a dock wide enough for one.
    expect(opened).toEqual([{ rows: 28, columns: 76 }])
    const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: DESIGN_PANE_ID, props: PANE })
    await ui.press({ key: 'template:review' })
    expect(ids()).toEqual(['n1', 'n2', '  n3', '  n4', 'n5'])
    const screen = async (): Promise<string[]> => ((await ui.drawn({ in: 'canvas' })) as Drawn).children?.map(flat) ?? []
    const click = async (x: number, y: number): Promise<void> => {
      await ui.pointer({ type: 'down', x, y, button: 'left' })
      await ui.pointer({ type: 'up', x, y, button: 'left' })
    }
    const texts = async (pick: (props: Record<string, unknown>) => boolean) => (await ui.findAll({ type: 'Text', in: 'canvas' })).filter(one => pick(one.props)).map(one => one.text ?? '')

    // Inline: left to right, the whole template in view, nothing panned.
    expect((await ui.find({ type: 'Client' }))?.props.props).toMatchObject({ orientation: 'horizontal', selectedId: 'n1' })
    const first = await screen()
    expect(first[0]).toMatch(/^┏ n1 agent ━━━━┓ {4}╭ n2 pipeline ×4 · review ─+╮ {5}╭ n5 agent ────╮$/)
    expect(first.at(-1)).toBe('─▶ hands each result on · ═▶ waits for all · + add · drag a card to move it')

    // A click selects: the inspector follows, the card gets the heavy border, nothing is written.
    const before = writes.length
    await click(card('n5').x + 4, 1)
    expect(state.ui?.selectedId).toBe('n5')
    expect((await ui.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('synthesize')
    expect((await screen())[0]).toMatch(/^╭ n1 agent ────╮ .* ┏ n5 agent ━━━━┓$/)
    // The innermost card under the pointer is the one selected.
    await click(card('n4').x + 4, card('n4').y + 1)
    expect(state.ui?.selectedId).toBe('n4')
    await click(card('n2').x + 6, 0)
    expect(state.ui?.selectedId).toBe('n2')
    expect(writes).toHaveLength(before)

    // A + between two cards opens the type picker for that place; a pick lands the block there.
    const gap = slot(1)
    await click(gap.mark?.x ?? 0, gap.mark?.y ?? 0)
    expect(state.ui?.picker).toEqual({ at: { index: 1 }, query: '' })
    expect(await ui.find({ type: 'Input', key: 'design-add' })).toBeDefined()
    expect(await texts(props => props.inverse === true)).toEqual([' + '])
    await ui.press({ key: 'pick:critic' })
    expect(ids()).toEqual(['n1', 'n6', 'n2', '  n3', '  n4', 'n5'])
    expect(state.ui).toMatchObject({ selectedId: 'n6', picker: null })
    expect(writes).toHaveLength(before + 1)
    await ui.advance(200)
    expect((await screen())[0]).toMatch(/^╭ n1 agent ────╮ {4}┏ n6 critic ━━━┓ {4}╭ n2 pipeline/)
    // The + at the end of a container adds inside it.
    const inner = slot(2, 'n2')
    await click(inner.mark?.x ?? 0, inner.mark?.y ?? 0)
    expect(state.ui?.picker).toEqual({ at: { parentId: 'n2', index: 2 }, query: '' })
    await ui.press({ key: 'design-add-cancel' })
    expect(state.ui?.picker).toBe(null)
    expect(writes).toHaveLength(before + 1)

    // Drag n6 to the end of the top level: lifted where it stood, a bar at the slot, and nothing moves until the drop.
    const end = slot(4)
    await ui.pointer({ type: 'down', x: card('n6').x + 3, y: 1, button: 'left' })
    await ui.pointer({ type: 'move', x: card('n6').x + 9, y: 1, button: 'left' })
    await ui.pointer({ type: 'move', x: end.mark?.x ?? 0, y: 1, button: 'left' })
    const held = await screen()
    expect(held[0]).toMatch(/^╭ n1 agent ────╮ {4}╭ n6 critic ╌╌╌╮/)
    expect(held[1]).toMatch(/ ┃ +n6 critic $/)
    expect(held.at(-1)).toBe('release to drop n6')
    expect(held.slice(0, -1).join('\n')).not.toMatch(/\+/)
    expect(ids()).toEqual(['n1', 'n6', 'n2', '  n3', '  n4', 'n5'])
    expect(writes).toHaveLength(before + 1)
    await ui.pointer({ type: 'up', x: end.mark?.x ?? 0, y: 1, button: 'left' })
    expect(ids()).toEqual(['n1', 'n2', '  n3', '  n4', 'n5', 'n6'])
    expect(saved()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    expect(writes).toHaveLength(before + 2)
    expect(state.ui?.selectedId).toBe('n6')
    // The cards slide to their new places and settle; then the drawing stays as it is, with no clock running it.
    await ui.advance(200)
    const settled = await screen()
    expect(settled[0]).toMatch(/╭ n5 agent ────╮ {4}┏ n6 critic ━━━┓$/)
    expect(settled.at(-1)).toMatch(/^─▶ hands each result on/)
    await ui.advance(1000)
    expect(await screen()).toEqual(settled)

    // Drag it into the pipeline, between its two stages.
    const between = slot(1, 'n2')
    await ui.pointer({ type: 'down', x: card('n6').x + 3, y: 1, button: 'left' })
    await ui.pointer({ type: 'move', x: between.mark?.x ?? 0, y: card('n4').y + 1, button: 'left' })
    expect((await screen()).at(-1)).toBe('release to drop n6 into n2')
    await ui.pointer({ type: 'up', x: between.mark?.x ?? 0, y: card('n4').y + 1, button: 'left' })
    expect(ids()).toEqual(['n1', 'n2', '  n3', '  n6', '  n4', 'n5'])
    expect(writes).toHaveLength(before + 3)
    await ui.advance(200)
    // And back out, before the pipeline: its left edge is the drop-only slot of the place before it... of n1.
    await ui.pointer({ type: 'down', x: card('n6').x + 3, y: card('n6').y + 1, button: 'left' })
    await ui.pointer({ type: 'move', x: 0, y: 1, button: 'left' })
    await ui.pointer({ type: 'up', x: 0, y: 1, button: 'left' })
    expect(ids()).toEqual(['n6', 'n1', 'n2', '  n3', '  n4', 'n5'])
    expect(writes).toHaveLength(before + 4)
    await ui.advance(200)

    // A drop outside any slot cancels: past the board's rows, and back where the card stood.
    await ui.pointer({ type: 'down', x: card('n1').x + 3, y: 1, button: 'left' })
    await ui.pointer({ type: 'move', x: card('n1').x + 3, y: 3, button: 'left' })
    await ui.pointer({ type: 'leave', x: card('n1').x + 3, y: 3 })
    await ui.pointer({ type: 'move', x: card('n1').x + 3, y: 30, button: 'left' })
    expect((await screen()).at(-1)).toBe('no slot here · release to cancel')
    await ui.pointer({ type: 'up', x: card('n1').x + 3, y: 30, button: 'left' })
    await ui.pointer({ type: 'down', x: card('n1').x + 3, y: 1, button: 'left' })
    await ui.pointer({ type: 'move', x: card('n1').x + 6, y: 2, button: 'left' })
    await ui.pointer({ type: 'up', x: card('n1').x + 6, y: 2, button: 'left' })
    expect(ids()).toEqual(['n6', 'n1', 'n2', '  n3', '  n4', 'n5'])
    expect(writes).toHaveLength(before + 4)
    expect(state.ui?.selectedId).toBe('n1')

    // The selected card carries edit and del. del on a leaf removes it at once.
    const del = (id: string, confirm = false) => {
      const act = affordances(card(id), confirm).find(one => one.kind === 'remove')
      if (!act) throw new Error(`no del on ${id}`)
      return act
    }
    expect((await screen())[3]).toMatch(/┗━ edit ━ del ━┛/)
    await click(del('n1').x + 1, del('n1').y)
    expect(ids()).toEqual(['n6', 'n2', '  n3', '  n4', 'n5'])
    expect(state.ui?.selectedId).toBe('n2')
    expect(writes).toHaveLength(before + 5)
    await ui.advance(200)
    // On a container that holds blocks the first click asks, on the card itself; the second removes.
    await click(del('n2').x + 1, del('n2').y)
    expect(ids()).toEqual(['n6', 'n2', '  n3', '  n4', 'n5'])
    expect(state.ui).toMatchObject({ selectedId: 'n2', confirmId: 'n2' })
    expect(state.ui?.notice).toMatch(/n2 holds 2 blocks/)
    expect((await screen()).some(line => / edit ━ delete all\? ━┛/.test(line))).toBe(true)
    expect(await texts(props => props.color === 'error')).toEqual([' delete all? '])
    expect(writes).toHaveLength(before + 5)
    // A click elsewhere forgets the question.
    await click(card('n6').x + 3, 1)
    expect(state.ui).toMatchObject({ selectedId: 'n6', confirmId: null })
    await click(card('n2').x + 6, 0)
    await click(del('n2').x + 1, del('n2').y)
    expect(state.ui?.confirmId).toBe('n2')
    await click(del('n2', true).x + 1, del('n2', true).y)
    expect(ids()).toEqual(['n6', 'n5'])
    expect(state.ui).toMatchObject({ selectedId: 'n5', confirmId: null, notice: null })
    expect(writes).toHaveLength(before + 6)
    await ui.advance(200)

    // edit selects the card and hands the keys to the title field (the engine moves the ring).
    const edit = affordances(card('n5')).find(one => one.kind === 'edit')
    await click((edit?.x ?? 0) + 1, edit?.y ?? 0)
    expect(state.ui).toMatchObject({ selectedId: 'n5', confirmId: null })
    await ui.input({ key: 'design-title', text: 'write up' })
    expect((await screen())[1]).toMatch(/┃ write up +┃/)

    // The keyboard path, once a click gave the board the keys: arrows along the flow, a/x/g as on the toolbar.
    await ui.key({ key: 'left' })
    expect(state.ui?.selectedId).toBe('n6')
    await ui.key({ key: 'l' })
    expect(state.ui?.selectedId).toBe('n5')
    await ui.key({ key: 'g' })
    expect(state.ui?.grabbedId).toBe('n5')
    await ui.key({ key: 'h' })
    expect(ids()).toEqual(['n5', 'n6'])
    await ui.key({ key: 'g' })
    expect(state.ui?.grabbedId).toBe(null)
    await ui.key({ key: 'a' })
    expect(state.ui?.picker).toEqual({ at: { index: 1 }, query: '' })
    await ui.press({ key: 'pick:pipeline' })
    expect(ids()).toEqual(['n5', 'n7', 'n6'])
    // An empty container is a box with one + in it; i adds inside, x removes it without asking.
    await ui.advance(200)
    expect((await screen())[1]).toMatch(/┃ +\+ +┃/)
    await ui.key({ key: 'i' })
    expect(state.ui?.picker).toEqual({ at: { parentId: 'n7', index: 0 }, query: '' })
    await ui.press({ key: 'design-add-cancel' })
    await ui.key({ key: 'x' })
    expect(ids()).toEqual(['n5', 'n6'])

    await ui.unmount()
  })

  test(`board: an empty design is one + that opens the picker, on ${surface}`, async ($, on) => {
    const files = new Map<string, string>()
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

    await $.command.run({ command: 'conductor', args: 'design blank', ...RUN })
    const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: DESIGN_PANE_ID, props: PANE })
    // No saved design: the template picker, not a board.
    expect(await ui.find({ type: 'Client' })).toBe(undefined)
    await ui.press({ key: 'template:blank' })
    expect(state.design?.nodes).toEqual([])
    const rows = ((await ui.drawn({ in: 'canvas' })) as Drawn).children?.map(flat) ?? []
    expect(rows[0]).toBe(' +  add the first block')
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left' })
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left' })
    expect(state.ui?.picker).toEqual({ at: { index: 0 }, query: '' })
    await ui.press({ key: 'pick:agent' })
    expect(state.design?.nodes.map(node => node.id)).toEqual(['n1'])
    expect(state.ui?.selectedId).toBe('n1')

    await ui.unmount()
  })
}
