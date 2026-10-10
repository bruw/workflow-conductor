import { expect, test } from 'claude-code/testing'

import type { Design } from '../src/design/model'
import { review } from '../src/design/templates'
import {
  ADD_ROW_ID,
  PICKER_MAX,
  badgeOf,
  buildDesignRows,
  canvasReduce,
  hintLine,
  initialCanvas,
  layoutCanvas,
  parseCanvasMessage,
  scrollTop,
  syncCanvas,
  windowCanvas,
} from '../src/ui/canvas-model'
import type { CanvasKey, CanvasMessage, CanvasState } from '../src/ui/canvas-model'

const key = (name: string, mods: Partial<CanvasKey> = {}): CanvasKey => ({ type: 'key', key: name, ...mods })

// Review template: n1 agent, n2 pipeline [n3 agent, n4 verify], n5 agent.
const design = review()
const at = (selectedId: string, more: Partial<CanvasState> = {}): CanvasState => ({ ...initialCanvas(), rev: 1, selectedId, ...more })

// Runs keys in order; returns the final state and every message posted.
const press = (state: CanvasState, keys: CanvasKey[], on: Design = design): { state: CanvasState; posts: CanvasMessage[] } => {
  const posts: CanvasMessage[] = []
  let current = state
  for (const one of keys) {
    const result = canvasReduce(current, one, { design: on })
    current = result.state
    if (result.post) posts.push(result.post)
  }
  return { state: current, posts }
}

const deep: Design = {
  version: 1,
  name: 'deep',
  description: '',
  nodes: [
    {
      id: 'n1',
      type: 'pipeline',
      title: 'outer',
      children: [
        { id: 'n2', type: 'loop', title: 'inner', children: [{ id: 'n3', type: 'agent', title: 'a' }, { id: 'n4', type: 'agent', title: 'b' }] },
        { id: 'n5', type: 'parallel', title: 'last', children: [{ id: 'n6', type: 'agent', title: 'c' }] },
      ],
    },
    { id: 'n7', type: 'agent', title: 'end' },
  ],
}

test('rows of a nested template: rail, depth, glyph, badge, type, add row', async () => {
  const rows = buildDesignRows(design, { selectedId: 'n2', grabbedId: 'n2', lints: [{ nodeId: 'n4', message: 'why' }] })

  expect(rows.map(row => row.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', ADD_ROW_ID])
  expect(rows.map(row => row.depth)).toEqual([0, 0, 1, 1, 0, 0])
  expect(rows.map(row => row.rail)).toEqual(['', '', '│  ├ ', '│  ╰ ', '', '╰─ '])
  expect(rows.map(row => row.glyph)).toEqual(['●', '◆', '●', '◇', '●', '+'])
  expect(rows.map(row => row.typeName)).toEqual(['agent', 'pipeline', 'agent', 'adversarial verify', 'agent', ''])
  expect(rows.map(row => row.title)).toEqual(['scout diff', 'review', 'review', 'adversarial verify', 'synthesize', 'add'])
  expect(rows.map(row => row.badge)).toEqual(['', '×4', '', '×3 votes', '', ''])
  expect(rows.map(row => row.lint)).toEqual([undefined, undefined, undefined, 'why', undefined, undefined])
  expect(rows.map(row => row.selected)).toEqual([false, true, false, false, false, false])
  expect(rows.map(row => row.grabbed)).toEqual([false, true, false, false, false, false])
  expect(rows.map(row => row.kind)).toEqual(['node', 'node', 'node', 'node', 'node', 'add'])
  expect(rows[1]).toMatchObject({ container: true, collapsed: false, hidden: 0, parentId: undefined, index: 1 })
  expect(rows[3]).toMatchObject({ container: false, parentId: 'n2', index: 1 })
  expect(rows[5]).toMatchObject({ index: 3, parentId: undefined })
})

test('rails two levels deep keep the line of an ancestor that has later siblings', async () => {
  const rows = buildDesignRows(deep)

  expect(rows.map(row => `${row.rail}${row.id}`)).toEqual([
    'n1',
    '│  ├ n2',
    '│  │  ├ n3',
    '│  │  ╰ n4',
    '│  ╰ n5',
    '│     ╰ n6',
    'n7',
    '╰─ +',
  ])
})

test('a collapsed container hides its subtree and counts it', async () => {
  const rows = buildDesignRows(deep, { collapsed: ['n1'] })

  expect(rows.map(row => row.id)).toEqual(['n1', 'n7', ADD_ROW_ID])
  expect(rows[0]).toMatchObject({ collapsed: true, hidden: 5 })
  expect(buildDesignRows(deep, { collapsed: ['n2', 'n7'] }).map(row => row.id)).toEqual(['n1', 'n2', 'n5', 'n6', 'n7', ADD_ROW_ID])
  expect(buildDesignRows({ ...deep, nodes: [] }).map(row => row.id)).toEqual([ADD_ROW_ID])
})

test('badges come from fanout, votes and until', async () => {
  const node = (knobs: object) => ({ id: 'n1', type: 'agent' as const, title: 't', knobs })

  expect(badgeOf(node({ fanout: '×4 dimensions' }))).toBe('×4')
  expect(badgeOf(node({ fanout: 'changed files' }))).toBe('× changed files')
  expect(badgeOf(node({ votes: 3 }))).toBe('×3 votes')
  expect(badgeOf(node({ until: '2 dry rounds' }))).toBe('until 2 dry rounds')
  expect(badgeOf(node({ fanout: 'x12', until: 'budget < 50k' }))).toBe('×12 until budget < 50k')
  expect(badgeOf(node({ until: 'a'.repeat(60) })).length).toBeLessThan(40)
  expect(badgeOf({ id: 'n1', type: 'agent', title: 't' })).toBe('')
})

test('sync takes the selection props set, and drops what names a node that is gone', async () => {
  const first = syncCanvas(initialCanvas(), { design, selectedId: 'n1', rev: 1 })
  expect(first).toMatchObject({ selectedId: 'n1', rev: 1 })

  // Same rev: the local cursor wins over the props.
  expect(syncCanvas({ ...first, selectedId: 'n3' }, { design, selectedId: 'n1', rev: 1 }).selectedId).toBe('n3')
  // New rev: the hooks module's selection wins, and whatever hides it opens.
  const moved = syncCanvas({ ...first, collapsed: ['n2'], picker: { query: 'x', index: 0, at: { index: 0 }, after: 0, depth: 0 } }, { design, selectedId: 'n4', rev: 2 })
  expect(moved).toMatchObject({ selectedId: 'n4', rev: 2, collapsed: [], picker: null })

  const gone = syncCanvas({ ...first, selectedId: 'n9', grabbedId: 'n9', collapsed: ['n9', 'n2'] }, { design, selectedId: null, rev: 1 })
  expect(gone).toMatchObject({ selectedId: 'n1', grabbedId: null, collapsed: ['n2'] })
  expect(syncCanvas(first, { design: { ...design, nodes: [] }, selectedId: null, rev: 1 }).selectedId).toBe(ADD_ROW_ID)
  expect(syncCanvas(first, { design, selectedId: null, rev: 5 }).selectedId).toBe(ADD_ROW_ID)
})

test('j, k and the arrows move the selection and post it', async () => {
  const down = press(at('n1'), [key('j'), key('down')])
  expect(down.state.selectedId).toBe('n3')
  expect(down.posts).toEqual([{ kind: 'select', id: 'n2' }, { kind: 'select', id: 'n3' }])

  const up = press(at('n3'), [key('k'), key('up'), key('k')])
  expect(up.state.selectedId).toBe('n1')
  expect(up.posts).toEqual([{ kind: 'select', id: 'n2' }, { kind: 'select', id: 'n1' }])

  const end = press(at('n5'), [key('j'), key('j')])
  expect(end.state.selectedId).toBe(ADD_ROW_ID)
  expect(end.posts).toEqual([{ kind: 'select', id: null }])

  expect(press(at('n3'), [key('G')]).state.selectedId).toBe(ADD_ROW_ID)
  expect(press(at('n3'), [key('g')]).posts).toEqual([{ kind: 'select', id: 'n1' }])
})

test('space grabs; j and k then post moves; space drops', async () => {
  const grabbed = press(at('n3'), [key(' ')])
  expect(grabbed.state.grabbedId).toBe('n3')
  expect(grabbed.posts).toEqual([])

  const moved = press(grabbed.state, [key('j'), key('k'), key('down'), key('x'), key('a')])
  expect(moved.state).toEqual(grabbed.state)
  expect(moved.posts).toEqual([
    { kind: 'move', id: 'n3', delta: 1, collapsed: [] },
    { kind: 'move', id: 'n3', delta: -1, collapsed: [] },
    { kind: 'move', id: 'n3', delta: 1, collapsed: [] },
  ])

  expect(press(grabbed.state, [key('space')]).state.grabbedId).toBe(null)
  expect(press(grabbed.state, [key('c', { ctrl: true })]).state.grabbedId).toBe(null)
  // The add row cannot be grabbed.
  expect(press(at(ADD_ROW_ID), [key(' ')]).state.grabbedId).toBe(null)
  // A move tells the hooks module which containers are folded, so the node steps over them.
  expect(press(at('n1', { collapsed: ['n2'] }), [key(' '), key('j')]).posts).toEqual([{ kind: 'move', id: 'n1', delta: 1, collapsed: ['n2'] }])
})

test('h and l fold and unfold a container; h on a child goes to its parent', async () => {
  const folded = press(at('n2'), [key('h')])
  expect(folded.state.collapsed).toEqual(['n2'])
  expect(folded.posts).toEqual([])
  expect(press(folded.state, [key('j')]).state.selectedId).toBe('n5')
  expect(press(folded.state, [key('l')]).state.collapsed).toEqual([])
  expect(press(folded.state, [key('right')]).state.collapsed).toEqual([])
  expect(press(at('n2'), [key('left')]).state.collapsed).toEqual(['n2'])

  const parent = press(at('n4'), [key('h')])
  expect(parent.state.selectedId).toBe('n2')
  expect(parent.posts).toEqual([{ kind: 'select', id: 'n2' }])
  expect(press(at('n1'), [key('h'), key('l')]).state).toEqual(at('n1'))
})

test('enter posts edit, x posts remove, ? toggles the card', async () => {
  expect(press(at('n3'), [key('return')]).posts).toEqual([{ kind: 'edit', id: 'n3' }])
  expect(press(at('n3'), [key('?')]).posts).toEqual([{ kind: 'toggleCard' }])

  const middle = press(at('n3'), [key('x')])
  expect(middle.posts).toEqual([{ kind: 'remove', id: 'n3', select: 'n4' }])
  expect(middle.state.selectedId).toBe('n4')

  // A container that holds blocks is asked about by the hooks module: the selection stays until it answers.
  const held = press(at('n2'), [key('x')])
  expect(held.posts).toEqual([{ kind: 'remove', id: 'n2' }])
  expect(held.state.selectedId).toBe('n2')
  // The last node: the selection steps back.
  expect(press(at('n5'), [key('x')]).posts).toEqual([{ kind: 'remove', id: 'n5', select: 'n4' }])
  expect(press(at('n4'), [key('delete')]).posts).toEqual([{ kind: 'remove', id: 'n4', select: 'n5' }])
  expect(press(at(ADD_ROW_ID), [key('x')]).posts).toEqual([])

  const only: Design = { ...design, nodes: [{ id: 'n1', type: 'agent', title: 'solo' }] }
  expect(press(at('n1'), [key('x')], only).posts).toEqual([{ kind: 'remove', id: 'n1', select: null }])
})

test('a opens the picker at the insertion point', async () => {
  // After a leaf: its next sibling slot, drawn right under it.
  expect(press(at('n1'), [key('a')]).state.picker).toEqual({ query: '', index: 0, at: { index: 1 }, after: 0, depth: 0 })
  expect(press(at('n3'), [key('a')]).state.picker).toEqual({ query: '', index: 0, at: { parentId: 'n2', index: 1 }, after: 2, depth: 1 })
  // After a container: past its whole subtree.
  expect(press(at('n2'), [key('a')]).state.picker).toMatchObject({ at: { index: 2 }, after: 3, depth: 0 })
  // A (or i) on a container: inside it, as its last child, unfolding it.
  const inside = press(at('n2', { collapsed: ['n2'] }), [key('A')])
  expect(inside.state.picker).toMatchObject({ at: { parentId: 'n2', index: 2 }, depth: 1 })
  expect(inside.state.collapsed).toEqual([])
  expect(press(at('n2'), [key('a', { shift: true })]).state.picker?.at).toEqual({ parentId: 'n2', index: 2 })
  expect(press(at('n1'), [key('i')]).state.picker?.at).toEqual({ index: 1 })
  // On the add row, a and enter both append at the end.
  expect(press(at(ADD_ROW_ID), [key('a')]).state.picker).toMatchObject({ at: { index: 3 }, after: 4, depth: 0 })
  expect(press(at(ADD_ROW_ID), [key('return')]).state.picker?.at).toEqual({ index: 3 })
  expect(press(at(ADD_ROW_ID), [key('a')], { ...design, nodes: [] }).state.picker).toMatchObject({ at: { index: 0 }, after: -1 })
})

test('the picker filters as typed, enter adds, and it cancels three ways', async () => {
  const typed = press(at('n1'), [key('a'), key('p'), key('i'), key('p'), key('e')])
  expect(typed.state.picker?.query).toBe('pipe')
  expect(typed.posts).toEqual([])

  const added = press(typed.state, [key('return')])
  expect(added.posts).toEqual([{ kind: 'add', type: 'pipeline', at: { index: 1 } }])
  expect(added.state.picker).toBe(null)

  // j and k are text here; the arrows choose among matches.
  const second = press(at('n1'), [key('a'), key('l'), key('o'), key('o'), key('p'), key('down'), key('return')])
  expect(second.posts).toEqual([{ kind: 'add', type: 'loop-until-dry', at: { index: 1 } }])
  expect(press(at('n1'), [key('a'), key('j'), key('k')]).state.picker?.query).toBe('jk')
  expect(press(at('n1'), [key('a'), key('down'), key('down'), key('up'), key('return')]).posts).toEqual([{ kind: 'add', type: 'pipeline', at: { index: 1 } }])
  expect(press(at('n1'), [key('a'), key('up'), key('return')]).posts).toEqual([{ kind: 'add', type: 'agent', at: { index: 1 } }])
  // A paste arrives as one key; space is text.
  expect(press(at('n1'), [key('a'), key('per'), key(' '), key('item')]).state.picker?.query).toBe('per item')
  expect(press(at('n1'), [key('a'), key('pageup'), key('left')]).state.picker?.query).toBe('')

  // No match: enter does nothing.
  const none = press(at('n1'), [key('a'), key('z'), key('z'), key('q'), key('return')])
  expect(none.posts).toEqual([])
  expect(none.state.picker?.query).toBe('zzq')

  expect(press(typed.state, [key('backspace')]).state.picker?.query).toBe('pip')
  expect(press(typed.state, [key('escape')]).state.picker).toBe(null)
  expect(press(typed.state, [key('c', { ctrl: true })]).state.picker).toBe(null)
  expect(press(at('n1'), [key('a'), key('backspace')]).state.picker).toBe(null)
  expect(press(typed.state, [key('c', { ctrl: true })]).posts).toEqual([])
})

test('keys that mean nothing change nothing', async () => {
  for (const one of [key('z'), key('pasted text'), key('j', { ctrl: true }), key('tab')]) {
    const result = canvasReduce(at('n2'), one, { design })
    expect(result.state).toEqual(at('n2'))
    expect(result.post).toBe(undefined)
  }
})

test('layout puts the picker and its matches under the row it adds after', async () => {
  const open = press(at('n3'), [key('a')]).state
  const layout = layoutCanvas(buildDesignRows(design, { selectedId: open.selectedId }), open.picker)

  expect(layout.lines.map(line => (line.kind === 'row' ? line.row.id : line.kind))).toEqual([
    'n1', 'n2', 'n3', 'picker', 'match', 'match', 'match', 'match', 'match', 'n4', 'n5', ADD_ROW_ID,
  ])
  expect(layout.focus).toBe(3)
  expect(layout.focusEnd).toBe(3 + PICKER_MAX)
  expect(layout.lines[3]).toMatchObject({ kind: 'picker', rail: '│  ├─ ', query: '' })
  expect(layout.lines[4]).toMatchObject({ kind: 'match', type: 'agent', active: true, glyph: '●', name: 'agent' })
  expect(layout.lines[5]).toMatchObject({ kind: 'match', type: 'pipeline', active: false })

  // The match list follows the highlight past its first page.
  const far = { ...open, picker: open.picker && { ...open.picker, index: 6 } }
  const paged = layoutCanvas(buildDesignRows(design), far.picker).lines.filter(line => line.kind === 'match')
  expect(paged.map(line => line.kind === 'match' && line.type)).toEqual(['parallel', 'loop', 'branch', 'subworkflow', 'code'])
  expect(paged.map(line => line.kind === 'match' && line.active)).toEqual([false, false, false, false, true])

  const none = press(at('n1'), [key('a'), key('z'), key('z'), key('q')]).state
  expect(layoutCanvas(buildDesignRows(design), none.picker).lines.map(line => line.kind)).toEqual(['row', 'picker', 'empty', 'row', 'row', 'row', 'row', 'row'])

  // Inside a container: under its last child.
  const inside = press(at('n2'), [key('A')]).state
  expect(layoutCanvas(buildDesignRows(design), inside.picker).focus).toBe(4)
  // With no picker the focus is the selected row.
  expect(layoutCanvas(buildDesignRows(design, { selectedId: 'n5' }), null)).toMatchObject({ focus: 4, focusEnd: 4 })
})

test('the scroll window follows the focus, moving as little as it can', async () => {
  const lines = layoutCanvas(buildDesignRows(design), null).lines
  const focus = (n: number) => ({ lines, focus: n, focusEnd: n })

  expect(lines.length).toBe(6)
  expect(scrollTop(0, focus(5), 0)).toBe(0)
  expect(scrollTop(0, focus(5), 10)).toBe(0)
  expect(scrollTop(0, focus(2), 3)).toBe(0)
  expect(scrollTop(0, focus(3), 3)).toBe(1)
  expect(scrollTop(1, focus(2), 3)).toBe(1)
  expect(scrollTop(3, focus(1), 3)).toBe(1)
  expect(scrollTop(9, focus(5), 3)).toBe(3)
  // A block taller than the window keeps its first line in view.
  expect(scrollTop(0, { lines, focus: 1, focusEnd: 5 }, 3)).toBe(1)

  const view = windowCanvas(layoutCanvas(buildDesignRows(design, { selectedId: 'n4' }), null), 0, 3)
  expect(view.lines.map(line => line.kind === 'row' && line.row.id)).toEqual(['n2', 'n3', 'n4'])
  expect(view).toMatchObject({ top: 1, above: 1, below: 2 })
  expect(windowCanvas(layoutCanvas(buildDesignRows(design), null), 0, 0)).toMatchObject({ top: 0, above: 0, below: 0 })
})

test('the reducer keeps the window on the selection', async () => {
  let state = at('n1')
  const tops: number[] = []
  for (const one of [key('j'), key('j'), key('j'), key('j'), key('j'), key('k'), key('g')]) {
    state = canvasReduce(state, one, { design, capacity: 3 }).state
    tops.push(state.top)
  }
  expect(tops).toEqual([0, 0, 1, 2, 3, 3, 0])

  // Opening the picker scrolls so its matches show.
  const open = canvasReduce(at('n5'), key('a'), { design, capacity: 8 }).state
  expect(open.top).toBe(3)
})

test('the hint line speaks only for a drag and the canvas picker: the toolbar shows the keys', async () => {
  expect(hintLine({ picker: null })).toBe('')
  expect(hintLine({ picker: { query: '', index: 0, at: { index: 0 }, after: 0, depth: 0 } })).toMatch(/enter add.*backspace on empty cancels/)
  expect(hintLine({ picker: null }, 'valid')).toMatch(/release to drop/)
  expect(hintLine({ picker: null }, 'invalid')).toMatch(/release to cancel/)
})

test('posted data is read back as a message, or refused', async () => {
  const good: CanvasMessage[] = [
    { kind: 'select', id: 'n1' },
    { kind: 'select', id: null },
    { kind: 'move', id: 'n1', delta: -1, collapsed: ['n2'] },
    { kind: 'move', id: 'n1', to: { parentId: 'n2', index: 0 } },
    { kind: 'add', type: 'verify', at: { index: 2 } },
    { kind: 'remove', id: 'n1', select: null },
    { kind: 'remove', id: 'n1' },
    { kind: 'edit', id: 'n1' },
    { kind: 'toggleCard' },
  ]
  for (const message of good) expect(parseCanvasMessage(JSON.parse(JSON.stringify(message)))).toEqual(message)

  const bad: unknown[] = [
    null,
    'select',
    [],
    { kind: 'nope' },
    { kind: 'select' },
    { kind: 'move', id: 'n1' },
    { kind: 'move', delta: 1 },
    { kind: 'add', type: 'robot', at: { index: 0 } },
    { kind: 'add', type: 'agent' },
    { kind: 'add', type: 'agent', at: { index: -1 } },
    { kind: 'add', type: 'agent', at: { index: 0, parentId: 3 } },
    { kind: 'remove' },
    { kind: 'edit', id: 4 },
  ]
  for (const data of bad) expect(parseCanvasMessage(data)).toBe(undefined)
})
