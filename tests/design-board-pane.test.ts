import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { flatten, parseDesign } from '../src/design/model'
import type { Design } from '../src/design/model'
import { DESIGN_PANE_ID, DESIGN_PANE_TITLE } from '../src/design/session'
import type { DesignUi } from '../src/design/session'
import { PANE_COLUMNS, PANE_ROWS } from '../hooks/design'
import type { BoardCard, BoardLayout, BoardSlot } from '../src/ui/board-layout'
import { boardLayout } from '../src/ui/board-model'
import type { BoardProps } from '../src/ui/board-model'
import { affordances } from '../src/ui/board-paint'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/project'
// Inline: wide and short, so the board flows left to right and the whole review template fits.
// Fourteen body rows is what a 50-row terminal gives an inline pane.
const PANE = { title: DESIGN_PANE_TITLE, isFocused: true, bodyColumns: 140, placement: 'inline', scroll: { offset: 0, bodyRows: 14 }, view: {} } as const
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
  test(`board: click to select, + to insert (shown or under the pointer), drag to reorder and re-nest, del with a second ask, keys, on ${surface}`, async ($, on) => {
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

    await $.command.run({ command: 'conductor', args: 'design demo', ...RUN })
    // The pane asks for the rows a nested container and the inspector need, and a dock wide enough for the key row and a card's notes.
    expect(opened).toEqual([{ rows: PANE_ROWS, columns: PANE_COLUMNS }])
    const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: DESIGN_PANE_ID, props: PANE })
    await ui.press({ key: 'template:review' })
    expect(ids()).toEqual(['n1', 'n2', '  n3', '  n4', 'n5'])
    const screen = async (): Promise<string[]> => ((await ui.drawn({ in: 'canvas' })) as Drawn).children?.map(flat) ?? []
    // Where things are on the board now: the very layout the board draws from, selection and all.
    const layout = async (): Promise<BoardLayout> => boardLayout((await ui.find({ type: 'Client' }))?.props.props as unknown as BoardProps)
    const card = async (id: string): Promise<BoardCard> => {
      const found = (await layout()).cards.find(one => one.id === id)
      if (!found) throw new Error(`no card ${id}`)
      return found
    }
    const slot = async (index: number, parentId?: string): Promise<BoardSlot & { mark: { x: number; y: number; label: string } }> => {
      const found = (await layout()).slots.find(one => one.place.parentId === parentId && one.place.index === index)
      if (!found?.mark) throw new Error(`no + at ${parentId ?? 'top'}:${index}`)
      return { ...found, mark: found.mark }
    }
    const click = async (x: number, y: number): Promise<void> => {
      await ui.pointer({ type: 'down', x, y, button: 'left' })
      await ui.pointer({ type: 'up', x, y, button: 'left' })
      await ui.advance(200)
    }
    const texts = async (pick: (props: Record<string, unknown>) => boolean) => (await ui.findAll({ type: 'Text', in: 'canvas' })).filter(one => pick(one.props)).map(one => one.text ?? '')
    const summary = async (): Promise<string> => (await ui.findAll({ type: 'Text' })).map(one => one.text ?? '').find(text => /^n\d+ · /.test(text)) ?? ''

    // Inline: left to right, the whole template in view in the eleven rows there are, nothing panned.
    const client = await ui.find({ type: 'Client' })
    expect(client?.props.props).toMatchObject({ orientation: 'horizontal', selectedId: 'n1', room: 11, compact: false })
    expect(Number(client?.props.height)).toBeLessThanOrEqual(11)
    const first = await screen()
    expect(first).toHaveLength(Number(client?.props.height))
    expect(first[0]).toMatch(/^┏ n1 agent ━+┓ {4}╭ n2 pipeline ×4 · review · each: dimensions ─+╮ {4}╭ n5 agent ────╮ *$/)
    // The selected card says its notes over two lines; no legend row under the board.
    expect(first[2]).toMatch(/^┃ Cheap and mechanical\. Its list of +┃/)
    expect(first.join('\n')).not.toMatch(/hands each result|drag a card|more below/)
    // The inspector is one line while nothing is typed.
    expect(await summary()).toMatch(/^n1 · agent · scout diff — Cheap and mechanical/)
    expect(await ui.find({ type: 'Input', key: 'design-title' })).toBe(undefined)

    // A click selects: the inspector's line follows, the card gets the heavy border, nothing is written.
    const before = writes.length
    await click((await card('n5')).x + 4, 1)
    expect(state.ui?.selectedId).toBe('n5')
    expect(await summary()).toMatch(/^n5 · agent · synthesize — /)
    expect((await screen())[0]).toMatch(/^╭ n1 agent ────╮ .* ┏ n5 agent ━+┓ *$/)
    // The innermost card under the pointer is the one selected.
    await click((await card('n4')).x + 4, (await card('n4')).y + 1)
    expect(state.ui?.selectedId).toBe('n4')
    await click((await card('n2')).x + 6, 0)
    expect(state.ui?.selectedId).toBe('n2')
    expect(writes).toHaveLength(before)

    // With n2 selected the + before it is drawn: a click opens the type picker for that place; a pick lands the block there.
    const gap = await slot(1)
    expect([...((await screen())[gap.mark.y] ?? '')][gap.mark.x]).toBe('+')
    await click(gap.mark.x, gap.mark.y)
    expect(state.ui?.picker).toEqual({ at: { index: 1 }, query: '' })
    expect(await ui.find({ type: 'Input', key: 'design-add' })).toBeDefined()
    expect(await texts(props => props.inverse === true)).toEqual([' + '])
    await ui.press({ key: 'pick:critic' })
    expect(ids()).toEqual(['n1', 'n6', 'n2', '  n3', '  n4', 'n5'])
    expect(state.ui).toMatchObject({ selectedId: 'n6', picker: null })
    expect(writes).toHaveLength(before + 1)
    await ui.advance(200)
    expect((await screen())[0]).toMatch(/^╭ n1 agent ────╮ {4}┏ n6 critic ━━━┓ {4}╭ n2 pipeline/)
    // The + at the end of the pipeline is not drawn while n6 is selected: it shows under the pointer, and takes the click.
    const inner = await slot(2, 'n2')
    expect([...((await screen())[inner.mark.y] ?? '')][inner.mark.x] ?? ' ').toBe(' ')
    await ui.pointer({ type: 'move', x: inner.mark.x, y: inner.mark.y })
    expect([...((await screen())[inner.mark.y] ?? '')][inner.mark.x]).toBe('+')
    await ui.pointer({ type: 'move', x: inner.mark.x + 6, y: inner.mark.y })
    expect([...((await screen())[inner.mark.y] ?? '')][inner.mark.x] ?? ' ').toBe(' ')
    await ui.pointer({ type: 'move', x: inner.mark.x, y: inner.mark.y })
    await click(inner.mark.x, inner.mark.y)
    expect(state.ui?.picker).toEqual({ at: { parentId: 'n2', index: 2 }, query: '' })
    await ui.press({ key: 'design-add-cancel' })
    expect(state.ui?.picker).toBe(null)
    expect(writes).toHaveLength(before + 1)

    // Drag n6 to the end of the top level: lifted where it stood, a bar at the slot, what a release does said at the pointer, and nothing moves until the drop.
    const end = await slot(4)
    const from = await card('n6')
    await ui.pointer({ type: 'down', x: from.x + 3, y: 1, button: 'left' })
    await ui.pointer({ type: 'move', x: from.x + 9, y: 1, button: 'left' })
    await ui.pointer({ type: 'move', x: end.mark.x, y: 1, button: 'left' })
    const held = await screen()
    expect(held[0]).toMatch(/^╭ n1 agent ────╮ {4}╭ n6 critic ╌╌╌╮/)
    expect(held[1]).toMatch(/ n6 critic · drop here $/)
    expect(await texts(props => props.color === 'claude' && props.inverse !== true)).toContain('┃')
    expect(held.join('\n')).not.toMatch(/\+/)
    expect(ids()).toEqual(['n1', 'n6', 'n2', '  n3', '  n4', 'n5'])
    expect(writes).toHaveLength(before + 1)
    await ui.pointer({ type: 'up', x: end.mark.x, y: 1, button: 'left' })
    expect(ids()).toEqual(['n1', 'n2', '  n3', '  n4', 'n5', 'n6'])
    expect(saved()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    expect(writes).toHaveLength(before + 2)
    expect(state.ui?.selectedId).toBe('n6')
    // The cards slide to their new places and settle; then the drawing stays as it is, with no clock running it.
    await ui.advance(200)
    const settled = await screen()
    expect(settled[0]).toMatch(/╭ n5 agent ────╮ {4}┏ n6 critic ━━━┓ *$/)
    await ui.advance(1000)
    expect(await screen()).toEqual(settled)

    // Drag it into the pipeline, between its two stages.
    const between = await slot(1, 'n2')
    const stage = await card('n4')
    await ui.pointer({ type: 'down', x: (await card('n6')).x + 3, y: 1, button: 'left' })
    await ui.pointer({ type: 'move', x: between.mark.x, y: stage.y + 1, button: 'left' })
    expect((await screen()).join('\n')).toMatch(/ n6 critic · drop into n2 /)
    await ui.pointer({ type: 'up', x: between.mark.x, y: stage.y + 1, button: 'left' })
    expect(ids()).toEqual(['n1', 'n2', '  n3', '  n6', '  n4', 'n5'])
    expect(writes).toHaveLength(before + 3)
    await ui.advance(200)
    // And back out, before n1: the board's left edge is the drop-only slot of the first place.
    await ui.pointer({ type: 'down', x: (await card('n6')).x + 3, y: (await card('n6')).y + 1, button: 'left' })
    await ui.pointer({ type: 'move', x: 0, y: 1, button: 'left' })
    await ui.pointer({ type: 'up', x: 0, y: 1, button: 'left' })
    expect(ids()).toEqual(['n6', 'n1', 'n2', '  n3', '  n4', 'n5'])
    expect(writes).toHaveLength(before + 4)
    await ui.advance(200)

    // A drop outside any slot cancels: past the board's rows, and back where the card stood.
    const one = await card('n1')
    await ui.pointer({ type: 'down', x: one.x + 3, y: 1, button: 'left' })
    await ui.pointer({ type: 'move', x: one.x + 3, y: 3, button: 'left' })
    await ui.pointer({ type: 'leave', x: one.x + 3, y: 3 })
    await ui.pointer({ type: 'move', x: one.x + 3, y: 30, button: 'left' })
    await ui.pointer({ type: 'up', x: one.x + 3, y: 30, button: 'left' })
    await ui.advance(200)
    const again = await card('n1')
    await ui.pointer({ type: 'down', x: again.x + 3, y: 1, button: 'left' })
    await ui.pointer({ type: 'move', x: again.x + 6, y: 2, button: 'left' })
    expect((await screen()).join('\n')).toMatch(/ n1 scout diff · already here /)
    await ui.pointer({ type: 'up', x: again.x + 6, y: 2, button: 'left' })
    expect(ids()).toEqual(['n6', 'n1', 'n2', '  n3', '  n4', 'n5'])
    expect(writes).toHaveLength(before + 4)
    expect(state.ui?.selectedId).toBe('n1')
    await ui.advance(200)

    // The selected card carries edit and del. del on a leaf removes it at once.
    const del = async (id: string, confirm = false) => {
      const act = affordances(await card(id), confirm).find(found => found.kind === 'remove')
      if (!act) throw new Error(`no del on ${id}`)
      return act
    }
    expect((await screen()).some(line => /┗ low ━+ edit ━ del ━┛/.test(line))).toBe(true)
    await click((await del('n1')).x + 1, (await del('n1')).y)
    expect(ids()).toEqual(['n6', 'n2', '  n3', '  n4', 'n5'])
    expect(state.ui?.selectedId).toBe('n2')
    expect(writes).toHaveLength(before + 5)
    // On a container that holds blocks the first click asks, on the card itself; the second removes.
    await click((await del('n2')).x + 1, (await del('n2')).y)
    expect(ids()).toEqual(['n6', 'n2', '  n3', '  n4', 'n5'])
    expect(state.ui).toMatchObject({ selectedId: 'n2', confirmId: 'n2' })
    expect(state.ui?.notice).toMatch(/n2 holds 2 blocks/)
    expect((await screen()).some(line => / edit ━ delete all\? ━┛/.test(line))).toBe(true)
    expect(await texts(props => props.color === 'error')).toEqual([' delete all? '])
    expect(writes).toHaveLength(before + 5)
    // A click elsewhere forgets the question.
    await click((await card('n6')).x + 3, 1)
    expect(state.ui).toMatchObject({ selectedId: 'n6', confirmId: null })
    await click((await card('n2')).x + 6, 0)
    await click((await del('n2')).x + 1, (await del('n2')).y)
    expect(state.ui?.confirmId).toBe('n2')
    await click((await del('n2', true)).x + 1, (await del('n2', true)).y)
    expect(ids()).toEqual(['n6', 'n5'])
    expect(state.ui).toMatchObject({ selectedId: 'n5', confirmId: null, notice: null })
    expect(writes).toHaveLength(before + 6)

    // edit selects the card, takes the keyboard back for the pane, opens the inspector and hands the keys to the title field.
    const edit = affordances(await card('n5')).find(found => found.kind === 'edit')
    opened.length = 0
    await click((edit?.x ?? 0) + 1, edit?.y ?? 0)
    expect(state.ui).toMatchObject({ selectedId: 'n5', confirmId: null, editing: true })
    expect(opened).toHaveLength(1)
    expect((await ui.find({ type: 'Input', key: 'design-title' }))?.props.value).toBe('synthesize')
    await ui.input({ key: 'design-title', text: 'write up' })
    await ui.advance(200)
    expect(state.ui?.editing).toBe(false)
    expect(await ui.find({ type: 'Input', key: 'design-title' })).toBe(undefined)
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
    // An empty container is a whole box with one slot that says what it is for; i adds inside, x removes it without asking.
    await ui.advance(200)
    const hollow = await screen()
    expect(hollow[0]).toMatch(/┏ n7 pipeline ━+┓/)
    expect(hollow[1]).toMatch(/┃ {2}\+ add first block +┃/)
    expect(hollow[2]).toMatch(/┗━+ edit ━ del ━┛/)
    await ui.key({ key: 'i' })
    expect(state.ui?.picker).toEqual({ at: { parentId: 'n7', index: 0 }, query: '' })
    await ui.press({ key: 'design-add-cancel' })
    await ui.key({ key: 'x' })
    expect(ids()).toEqual(['n5', 'n6'])
    // z on the board is the toolbar's compact.
    await ui.key({ key: 'z' })
    expect(state.ui?.compact).toBe(true)
    await ui.advance(200)
    expect((await screen()).join('\n')).toMatch(/╶─▶? ?.*n5 agent · write up ─+╴|╶── n5 agent · write up ─+╴/)
    await ui.key({ key: 'z' })
    expect(state.ui?.compact).toBe(false)

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
    expect(rows[0]).toBe(' + add the first block ')
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left' })
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left' })
    expect(state.ui?.picker).toEqual({ at: { index: 0 }, query: '' })
    await ui.press({ key: 'pick:agent' })
    expect(state.design?.nodes.map(node => node.id)).toEqual(['n1'])
    expect(state.ui?.selectedId).toBe('n1')

    await ui.unmount()
  })
}
