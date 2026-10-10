import { expect, test } from 'claude-code/testing'

import type { Design, DesignNode, NodeType } from '../src/design/model'
import { judgePanel, review } from '../src/design/templates'
import {
  ADD_BLOCK,
  ADD_FIRST,
  BOARD_DEFAULT_W,
  BOARD_MAX_W,
  BRANCH_MIN_W,
  EMPTY_HINT,
  EXPANDED_W,
  GAP_H,
  GAP_V,
  LEAF_H,
  LEAF_MAX_W,
  LEAF_MIN_RUN_W,
  LEAF_MIN_W,
  UNMAPPED_ID,
  cappedLines,
  cardAt,
  chooseOrientation,
  dropTarget,
  eachOf,
  edgeKind,
  expandRows,
  fanOf,
  firstLines,
  layoutBoard,
  navigate,
  slotAt,
  slotVisible,
  stackOf,
  wrapText,
} from '../src/ui/board-layout'
import type { BoardCard, BoardLayout, BoardSlot } from '../src/ui/board-layout'

// Review template: n1 agent, n2 pipeline ×4 [n3 agent, n4 verify ×3 votes], n5 agent.
const design = review()
const H = layoutBoard(design, { orientation: 'horizontal' })
const V = layoutBoard(design, { orientation: 'vertical', width: 60 })

const card = (layout: BoardLayout, id: string): BoardCard => {
  const found = layout.cards.find(one => one.id === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}
const slot = (layout: BoardLayout, index: number, parentId?: string): BoardSlot => {
  const found = layout.slots.find(one => one.place.parentId === parentId && one.place.index === index)
  if (!found) throw new Error(`no slot ${parentId ?? 'top'}:${index}`)
  return found
}
const node = (id: string, type: NodeType, more: Partial<DesignNode> = {}): DesignNode => ({ id, type, title: id, ...more })
const of = (...nodes: DesignNode[]): Design => ({ version: 1, name: 'd', description: '', nodes })
const inside = (outer: BoardCard, inner: BoardCard): boolean => inner.x > outer.x && inner.y > outer.y && inner.x + inner.w < outer.x + outer.w && inner.y + inner.h < outer.y + outer.h
const overlap = (a: BoardCard, b: BoardCard): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const LONG = 'Asks what is missing: an angle not searched, a claim unverified, a source unread. Gaps become one more round of reading, and the round after that, until a round finds nothing new to read.'

test('horizontal: top-level cards run left to right in order, a gap for the edge between each', () => {
  expect(H.orientation).toBe('horizontal')
  const [n1, n2, n5] = [card(H, 'n1'), card(H, 'n2'), card(H, 'n5')]
  expect([n1.y, n2.y, n5.y]).toEqual([0, 0, 0])
  expect(n1.x).toBe(0)
  expect(n2.x).toBe(n1.w + GAP_H)
  expect(n5.x).toBe(n2.x + n2.w + GAP_H)
  expect(H.width).toBeGreaterThanOrEqual(n5.x + n5.w)
  // The pipeline fans out: its stacked borders are rows under its box.
  expect(H.height).toBe(n2.h + n2.stack)
  expect([n1.h, n5.h]).toEqual([LEAF_H, LEAF_H])
})

test('vertical: the same design runs top to bottom, every card as wide as the board', () => {
  expect(V.orientation).toBe('vertical')
  const [n1, n2, n3, n4, n5] = ['n1', 'n2', 'n3', 'n4', 'n5'].map(id => card(V, id)) as [BoardCard, BoardCard, BoardCard, BoardCard, BoardCard]
  expect([n1.x, n2.x, n5.x]).toEqual([0, 0, 0])
  expect([n1.w, n2.w, n5.w, V.width]).toEqual([60, 60, 60, 60])
  // A container's children fill it: a border and a column of air on either side.
  expect([n3.x, n3.w, n4.w]).toEqual([2, 56, 56])
  // One connector row between two cards; a fan-out's stacked borders come before it.
  expect(n2.y).toBe(n1.y + n1.h + GAP_V)
  expect(n4.y).toBe(n3.y + n3.h + GAP_V)
  expect(n5.y).toBe(n2.y + n2.h + n2.stack + GAP_V)
  expect(GAP_V).toBe(1)
  // The last row is the top level's +.
  expect(V.height).toBe(n5.y + n5.h + 1)
  // The width follows the pane, up to a limit; with none given there is a default.
  expect(layoutBoard(design, { orientation: 'vertical', width: 83 }).width).toBe(83)
  expect(card(layoutBoard(design, { orientation: 'vertical', width: 300 }), 'n1').w).toBe(BOARD_MAX_W)
  expect(layoutBoard(design, { orientation: 'vertical' }).width).toBe(BOARD_DEFAULT_W)
})

test('a card says its title and the start of its notes; the selected one grows to say them all', () => {
  // Not selected, top to bottom: the title and up to two lines of notes, the second cut with an ellipsis.
  expect(card(V, 'n1').lines).toEqual([
    { text: 'scout diff', role: 'title' },
    { text: 'Cheap and mechanical. Its list of dimensions is the', role: 'note' },
    { text: 'work-list for the pipeline.', role: 'note' },
  ])
  expect(card(V, 'n4').lines.at(-1)).toEqual({ text: 'to refuted when unsure. Keep a finding only if at…', role: 'note' })
  expect(card(V, 'n4').lines.map(line => line.text)).toEqual(['adversarial verify', ...firstLines(design.nodes[1]?.children?.[1]?.notes ?? '', 52, 2)])
  expect(card(V, 'n4')).toMatchObject({ h: 5, expanded: false, foot: '3 votes' })
  expect(card(V, 'n1').foot).toBe('low')
  // With no notes the prompt stands in; with neither the card is its title alone.
  expect(card(layoutBoard(of(node('n1', 'agent', { knobs: { prompt: 'Do the thing' } })), { orientation: 'vertical' }), 'n1').lines.map(line => line.text)).toEqual(['n1', 'Do the thing'])
  expect(card(layoutBoard(of(node('n1', 'agent')), { orientation: 'vertical' }), 'n1')).toMatchObject({ h: 3, lines: [{ text: 'n1', role: 'title' }] })

  // Selected: every line of the notes, then the knobs and what it hands on; nothing left on the border for the words.
  const open = layoutBoard(design, { orientation: 'vertical', width: 60, selectedId: 'n4' })
  const n4 = card(open, 'n4')
  expect(n4.expanded).toBe(true)
  expect(n4.lines.map(line => line.role)).toEqual(['title', 'note', 'note', 'note', 'summary'])
  expect(n4.lines.filter(line => line.role === 'note').map(line => line.text).join(' ')).toBe(design.nodes[1]?.children?.[1]?.notes)
  expect(n4.lines.at(-1)?.text).toBe('3 votes · out: { refuted: boolean, reason }')
  expect(n4.foot).toBe('')
  expect(n4.h).toBe(7)
  for (const line of n4.lines.filter(one => one.role === 'note')) expect(line.text.length).toBeLessThanOrEqual(n4.w - 4)
  // Everything after it moves down by what it grew; nothing overlaps.
  expect(card(open, 'n5').y - card(V, 'n5').y).toBe(n4.h - card(V, 'n4').h)
  expect(card(open, 'n2').h - card(V, 'n2').h).toBe(n4.h - card(V, 'n4').h)

  // Long notes stop at the cap, with a row that counts what is left.
  const long = of(node('n1', 'critic', { notes: LONG }))
  const capped = card(layoutBoard(long, { orientation: 'vertical', width: 40, selectedId: 'n1', noteRows: 4 }), 'n1')
  expect(capped.lines.map(line => line.role)).toEqual(['title', 'note', 'note', 'note', 'more'])
  expect(capped.lines.at(-1)?.text).toBe(`… ${wrapText(LONG, 36).length - 3} more lines`)
  expect(capped.h).toBe(7)
  // The cap follows the room the board has.
  expect([expandRows('vertical', 45), expandRows('vertical', 12), expandRows('vertical', 6)]).toEqual([10, 4, 3])
  expect([expandRows('horizontal', 11), expandRows('horizontal', 30)]).toEqual([2, 4])

  // A selected container says its notes above what it holds.
  const boxed = layoutBoard(design, { orientation: 'vertical', width: 60, selectedId: 'n2' })
  expect(card(boxed, 'n2').lines.map(line => line.role)).toEqual(['note', 'note', 'note'])
  expect(card(boxed, 'n3').y).toBe(card(boxed, 'n2').y + 1 + 3)

  // Left to right the selected card grows wider so its notes can wrap, and a little taller; the knobs stay on its border.
  const wide = layoutBoard(design, { orientation: 'horizontal', selectedId: 'n4', noteRows: 2 })
  expect(card(wide, 'n4')).toMatchObject({ w: EXPANDED_W, h: 5, foot: '3 votes' })
  expect(card(wide, 'n4').lines.map(line => line.role)).toEqual(['title', 'note', 'note'])
  expect(card(wide, 'n4').lines.at(-1)?.text.endsWith('…')).toBe(true)
  expect(card(H, 'n4').lines).toEqual([
    { text: 'adversarial verify', role: 'title' },
    { text: 'Each skeptic trie…', role: 'note' },
  ])
})

test('wrapping: between words, a long word cut, the last shown line marked when there is more', () => {
  expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four'])
  expect(wrapText('abcdefghijkl mn', 5)).toEqual(['abcde', 'fghij', 'kl mn'])
  expect(wrapText('a\nb', 10)).toEqual(['a', 'b'])
  expect(wrapText('', 10)).toEqual([])
  expect(firstLines('one two three four', 9, 2)).toEqual(['one two', 'three…'])
  expect(firstLines('one two three', 9, 2)).toEqual(['one two', 'three'])
  expect(firstLines('one two threeeeee four', 9, 2)).toEqual(['one two', 'threeeee…'])
  expect(cappedLines('one two three four', 9, 2)).toEqual({ lines: ['one two'], more: 2 })
  expect(cappedLines('one two three four', 9, 3)).toEqual({ lines: ['one two', 'three', 'four'], more: 0 })
})

test('compact: every leaf that is not selected is one row; containers keep their boxes', () => {
  const c = layoutBoard(design, { orientation: 'vertical', width: 60, compact: true, selectedId: 'n3' })
  expect(['n1', 'n4', 'n5'].map(id => card(c, id))).toMatchObject([
    { line: true, h: 1, w: 60, stack: 0, lines: [] },
    { line: true, h: 1, w: 56, stack: 0 },
    { line: true, h: 1 },
  ])
  expect(card(c, 'n3')).toMatchObject({ line: false, expanded: true })
  expect(card(c, 'n3').h).toBeGreaterThan(3)
  expect(card(c, 'n2')).toMatchObject({ line: false, container: true, stack: 2 })
  expect(card(c, 'n2').y).toBe(2)
  expect(c.height).toBeLessThan(V.height - 6)
  const none = layoutBoard(design, { orientation: 'vertical', width: 60, compact: true })
  // n1, connector, n2's box around two rows and a connector, its two stacked borders, connector, n5, the + row.
  expect(none.height).toBe(1 + 1 + 5 + 2 + 1 + 1 + 1)
  // Left to right too: a row as wide as its words.
  const h = layoutBoard(design, { orientation: 'horizontal', compact: true })
  expect(card(h, 'n1')).toMatchObject({ line: true, h: 1, w: 'n1 agent · scout diff'.length + 7 })
  expect(h.edges.find(edge => edge.from === 'n3')?.y).toBe(card(h, 'n3').y)
})

test('a container is a box around its children; a pipeline chains its stages along the flow', () => {
  for (const layout of [H, V]) {
    const [n2, n3, n4] = [card(layout, 'n2'), card(layout, 'n3'), card(layout, 'n4')]
    expect(n2.container).toBe(true)
    expect(n2.inside).toBe(2)
    expect(inside(n2, n3) && inside(n2, n4)).toBe(true)
    expect(n3.parentId).toBe('n2')
    expect([n3.depth, n4.index]).toEqual([1, 1])
    expect(overlap(n3, n4)).toBe(false)
  }
  expect(card(H, 'n4').x).toBe(card(H, 'n3').x + card(H, 'n3').w + GAP_H)
  expect(card(H, 'n4').y).toBe(card(H, 'n3').y)
  expect(card(V, 'n4').x).toBe(card(V, 'n3').x)
  // Parents come before their children, so the innermost card under a cell is the last that holds it.
  expect(H.cards.map(one => one.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])
  expect(cardAt(H, card(H, 'n3').x + 1, card(H, 'n3').y + 1)?.id).toBe('n3')
  expect(cardAt(H, card(H, 'n2').x, card(H, 'n2').y + 1)?.id).toBe('n2')
  expect(cardAt(H, card(H, 'n1').x + card(H, 'n1').w + 1, 1)).toBe(undefined)
})

test('parallel, sweep and branch stack their branches across the flow, with no edge between them', () => {
  const stacked = of(node('n1', 'parallel', { children: [node('n2', 'agent'), node('n3', 'agent'), node('n4', 'agent')] }), node('n5', 'agent'))
  const h = layoutBoard(stacked, { orientation: 'horizontal' })
  expect([card(h, 'n2').x, card(h, 'n3').x, card(h, 'n4').x]).toEqual([2, 2, 2])
  expect([card(h, 'n2').y, card(h, 'n3').y, card(h, 'n4').y]).toEqual([1, 1 + LEAF_H, 1 + 2 * LEAF_H])
  // Top to bottom the branches stand side by side and share the box's width; the last takes what is left over.
  const v = layoutBoard(stacked, { orientation: 'vertical', width: 60 })
  expect(new Set([card(v, 'n2').y, card(v, 'n3').y, card(v, 'n4').y]).size).toBe(1)
  expect([card(v, 'n2').w, card(v, 'n3').w, card(v, 'n4').w]).toEqual([18, 18, 18])
  expect(card(v, 'n3').x).toBe(card(v, 'n2').x + card(v, 'n2').w + 1)
  expect(card(v, 'n4').x + card(v, 'n4').w).toBe(card(v, 'n1').x + card(v, 'n1').w - 2)
  expect(card(layoutBoard(stacked, { orientation: 'vertical', width: 61 }), 'n4').w).toBe(19)
  // Too many to share it: each keeps a least width, the box grows past the pane and the board pans.
  const crowd = layoutBoard(of(node('n1', 'parallel', { children: ['n2', 'n3', 'n4', 'n5'].map(id => node(id, 'agent')) })), { orientation: 'vertical', width: 40 })
  expect(card(crowd, 'n2').w).toBe(BRANCH_MIN_W)
  expect(crowd.width).toBe(4 * BRANCH_MIN_W + 3 + 4)
  for (const layout of [h, v]) {
    expect(layout.edges.map(edge => `${edge.from}>${edge.to}`)).toEqual(['n1>n5'])
    expect(card(layout, 'n1').h).toBeGreaterThan(3)
  }
  for (const type of ['sweep', 'branch'] as const) {
    const other = layoutBoard(of(node('n1', type, { children: [node('n2', 'agent'), node('n3', 'agent')] })), { orientation: 'horizontal' })
    expect(card(other, 'n3').y).toBe(card(other, 'n2').y + LEAF_H)
    expect(other.edges).toEqual([])
  }
  // A loop chains its body like a pipeline.
  const loop = layoutBoard(of(node('n1', 'loop', { children: [node('n2', 'agent'), node('n3', 'agent')] })), { orientation: 'horizontal' })
  expect(card(loop, 'n3').y).toBe(card(loop, 'n2').y)
  expect(loop.edges).toHaveLength(1)
})

test('fan-out: a count in the header, borders stacked under the box, and what each run is for', () => {
  expect(fanOf({ knobs: { fanout: '×4 dimensions' } })).toBe('×4')
  expect(fanOf({ knobs: { fanout: '4 search angles' } })).toBe('×4')
  expect(fanOf({ knobs: { fanout: 'changed files' } })).toBe('×n')
  expect(fanOf({ knobs: { votes: 3 } })).toBe('×3')
  expect(fanOf({})).toBe('')
  // Two is one more border, three or more (or a count not stated) two; never a third.
  expect(['', '×1', '×2', '×3', '×40', '×n'].map(stackOf)).toEqual([0, 0, 1, 2, 2, 2])
  expect(eachOf({ knobs: { fanout: '×4 dimensions' } })).toBe('dimensions')
  expect(eachOf({ knobs: { fanout: '4 search angles: by container, by time' } })).toBe('search angles: by container, by time')
  expect(eachOf({ knobs: { fanout: 'deduped sources' } })).toBe('deduped sources')
  expect(eachOf({ knobs: { fanout: '×3' } })).toBe('3')
  for (const layout of [H, V]) {
    expect(card(layout, 'n2')).toMatchObject({ fan: '×4', stack: 2, header: 'n2 pipeline ×4', title: 'review', each: 'dimensions' })
    expect(card(layout, 'n4')).toMatchObject({ fan: '×3', stack: 2, header: 'n4 verify ×3', each: '' })
    expect(card(layout, 'n1')).toMatchObject({ fan: '', stack: 0, header: 'n1 agent' })
  }
  // The rows under a box are kept clear for its stacked borders.
  expect(card(V, 'n5').y).toBe(card(V, 'n2').y + card(V, 'n2').h + 2 + GAP_V)
  // What a container hands on is its schema knob: `out:` on its bottom border. A leaf's fan-out is said there as `each:`.
  const out = layoutBoard(of(node('n1', 'pipeline', { knobs: { fanout: 'files', schema: '{ ok }', until: 'dry' }, children: [node('n2', 'agent', { knobs: { fanout: '×3 tries', model: 'opus' } })] })), { orientation: 'vertical' })
  expect(card(out, 'n1').foot).toBe('until dry · out: { ok }')
  expect(card(out, 'n2').foot).toBe('opus · each: tries')
})

test('edges: a pipeline streams between its stages; elsewhere many results are a barrier, one is a plain hand-off', () => {
  const kinds = (layout: BoardLayout) => Object.fromEntries(layout.edges.map(edge => [`${edge.from}>${edge.to}`, edge.kind]))
  for (const layout of [H, V]) expect(kinds(layout)).toEqual({ 'n1>n2': 'stream', 'n3>n4': 'stream', 'n2>n5': 'barrier' })
  expect(kinds(layoutBoard(judgePanel(), { orientation: 'horizontal' }))).toEqual({ 'n1>n3': 'barrier', 'n3>n4': 'barrier' })
  expect(edgeKind('pipeline', { type: 'agent', knobs: { fanout: '×9' } })).toBe('stream')
  expect(edgeKind('loop', { type: 'agent', knobs: { fanout: '×9' } })).toBe('barrier')
  expect(edgeKind(undefined, { type: 'sweep' })).toBe('barrier')
  expect(edgeKind(undefined, { type: 'code' })).toBe('stream')
  // Left to right an edge sits in the gap, on the row under the top border.
  expect(H.edges.find(edge => edge.from === 'n1')).toMatchObject({ axis: 'h', x: card(H, 'n1').w + 1, y: 1 })
  // Top to bottom it is the one row between two cards (under a fan-out's stacked borders), at the same column on every level.
  expect(V.edges.find(edge => edge.from === 'n1')).toMatchObject({ axis: 'v', x: 2, y: card(V, 'n2').y - 1 })
  expect(V.edges.find(edge => edge.from === 'n2')).toMatchObject({ axis: 'v', x: 2, y: card(V, 'n5').y - 1 })
  expect(V.edges.find(edge => edge.from === 'n3')).toMatchObject({ axis: 'v', x: card(V, 'n3').x + 2, y: card(V, 'n4').y - 1 })
})

test('slots: one per insertion index; where its + stands says which list it adds to', () => {
  const places = (layout: BoardLayout) => layout.slots.filter(one => one.mark !== null).map(one => `${one.place.parentId ?? 'top'}:${one.place.index}`)
  for (const layout of [H, V]) expect(places(layout).sort()).toEqual(['n2:1', 'n2:2', 'top:1', 'top:2', 'top:3'])
  expect(H.slots.filter(one => one.mark === null).map(one => `${one.place.parentId ?? 'top'}:${one.place.index}`).sort()).toEqual(['n2:0', 'top:0'])
  expect(slot(H, 1).mark).toEqual({ x: card(H, 'n1').w + 1, y: 2, label: '+' })
  expect(slotAt(H, card(H, 'n1').w + 1, 2)?.place).toEqual({ index: 1 })
  expect(slotAt(H, card(H, 'n1').w + 2, 2)?.place).toEqual({ index: 1 })
  expect(slotAt(H, card(H, 'n1').w + 1, 0)).toBe(undefined)

  // Top to bottom: between two cards the + is on the connector's row, three cells right of the line, at every level.
  const [n2, n3, n4, n5] = [card(V, 'n2'), card(V, 'n3'), card(V, 'n4'), card(V, 'n5')]
  expect(slot(V, 1)).toMatchObject({ x: 0, y: n2.y - 1, w: 60, h: 1, end: false, bar: 'row', mark: { x: 5, y: n2.y - 1, label: '+' } })
  expect(slot(V, 1, 'n2')).toMatchObject({ x: n3.x, y: n4.y - 1, w: 56, mark: { x: n3.x + 5, y: n4.y - 1, label: '+' } })
  // The end of a container's list is on that container's own bottom border.
  expect(slot(V, 2, 'n2')).toMatchObject({ end: true, x: 0, y: n2.y + n2.h - 1, w: 60, mark: { x: 3, y: n2.y + n2.h - 1, label: '+' } })
  // The end of the top level is a row of its own, with words.
  expect(slot(V, 3)).toMatchObject({ end: true, y: n5.y + n5.h, mark: { x: 1, y: n5.y + n5.h, label: ADD_BLOCK } })
  expect(slotAt(V, 8, n5.y + n5.h)?.place).toEqual({ index: 3 })
  // Before the first card of a list a slot only takes a drop.
  expect(slot(V, 0, 'n2')).toMatchObject({ mark: null, y: n3.y })

  // An empty design is one slot that says what it is for; an empty container holds one, as wide as its inside.
  const blank = layoutBoard(of(), { orientation: 'horizontal' })
  expect(blank.slots).toHaveLength(1)
  expect(blank.slots[0]).toMatchObject({ place: { index: 0 }, end: true, mark: { x: 1, y: 0, label: EMPTY_HINT } })
  expect(layoutBoard(of(), { orientation: 'vertical' }).slots[0]).toMatchObject({ place: { index: 0 }, mark: { x: 1, y: 0, label: EMPTY_HINT } })
  for (const orientation of ['horizontal', 'vertical'] as const) {
    const hollow = layoutBoard(of(node('n1', 'sweep', { children: [], knobs: { fanout: '4 angles' } })), { orientation, width: 50 })
    const box = card(hollow, 'n1')
    expect(slot(hollow, 0, 'n1')).toMatchObject({ place: { parentId: 'n1', index: 0 }, end: true, y: 1, mark: { x: 3, y: 1, label: ADD_FIRST } })
    // A proper box: a top border, the one row, a bottom border, and its stacked borders under that.
    expect(box).toMatchObject({ h: 3, stack: 2 })
    expect(box.w).toBeGreaterThanOrEqual(ADD_FIRST.length + 5)
    expect(hollow.height).toBeGreaterThanOrEqual(5)
  }
  expect(card(layoutBoard(of(node('n1', 'sweep', { children: [] })), { orientation: 'vertical', width: 50 }), 'n1').w).toBe(50)
})

test('which + are drawn with no pointer on them: around the selection, the ends that matter, an empty box', () => {
  const shown = (layout: BoardLayout, selectedId: string | null) =>
    layout.slots
      .filter(one => slotVisible(layout, one, selectedId))
      .map(one => `${one.place.parentId ?? 'top'}:${one.place.index}`)
      .sort()
  for (const layout of [H, V]) {
    // Nothing selected: only the end of the top level.
    expect(shown(layout, null)).toEqual(['top:3'])
    // A card in the middle of the top level: before it, after it, and the end.
    expect(shown(layout, 'n1')).toEqual(['top:1', 'top:3'])
    expect(shown(layout, 'n5')).toEqual(['top:2', 'top:3'])
    // A card in a container: around it, the end of its container, the end of the top level; not the top level's other gaps.
    expect(shown(layout, 'n3')).toEqual(['n2:1', 'n2:2', 'top:3'])
    expect(shown(layout, 'n4')).toEqual(['n2:1', 'n2:2', 'top:3'])
    // A container: around it, and the end of its own list.
    expect(shown(layout, 'n2')).toEqual(['n2:2', 'top:1', 'top:2', 'top:3'])
    expect(shown(layout, 'nope')).toEqual(['top:3'])
  }
  // A slot that only takes a drop is never drawn; an empty container's slot always is.
  expect(slotVisible(V, slot(V, 0), 'n1')).toBe(false)
  const hollow = layoutBoard(of(node('n1', 'agent'), node('n2', 'pipeline', { children: [] })), { orientation: 'vertical' })
  expect(shown(hollow, null)).toEqual(['n2:0', 'top:2'])
})

test('card widths left to right: bounded, titles never grow a card without limit, a run asks a little more', () => {
  const long = of(node('n1', 'agent', { title: 'a very long title that would otherwise make this card enormous' }), node('n2', 'agent', { title: 'x' }))
  const layout = layoutBoard(long, { orientation: 'horizontal' })
  expect(card(layout, 'n1').w).toBe(LEAF_MAX_W)
  expect(card(layout, 'n2').w).toBe(LEAF_MIN_W)
  expect(card(layoutBoard(long, { orientation: 'horizontal', run: true }), 'n2').w).toBe(LEAF_MIN_RUN_W)
  // Notes show on the card but never widen it; the knobs are on its border.
  expect(card(H, 'n5')).toMatchObject({ w: LEAF_MIN_W, foot: '' })
  expect(card(H, 'n1')).toMatchObject({ w: LEAF_MIN_W, foot: 'low' })
})

test('agents no block claims get a card of their own after the design', () => {
  const h = layoutBoard(design, { orientation: 'horizontal', run: true, unmapped: 2 })
  const stray = card(h, UNMAPPED_ID)
  expect(stray).toMatchObject({ type: 'unmapped', header: 'unmapped ×2', y: 0, stack: 1 })
  expect(stray.x).toBeGreaterThan(card(h, 'n5').x + card(h, 'n5').w)
  expect(h.width).toBe(stray.x + stray.w)
  const v = layoutBoard(design, { orientation: 'vertical', run: true, unmapped: 2, width: 60 })
  expect(card(v, UNMAPPED_ID)).toMatchObject({ y: card(v, 'n5').y + card(v, 'n5').h + 1, w: 60 })
  expect(v.height).toBe(card(v, UNMAPPED_ID).y + 3 + 1)
  expect(layoutBoard(design, { orientation: 'horizontal', run: true }).cards.some(one => one.id === UNMAPPED_ID)).toBe(false)
})

test('orientation: a dock is vertical; inline is horizontal unless only vertical fits', () => {
  expect(chooseOrientation(design, 'vertical', 200, 50)).toBe('vertical')
  expect(chooseOrientation(design, 'horizontal', 120, 12)).toBe('horizontal')
  expect(chooseOrientation(design, 'horizontal', 40, 12)).toBe('horizontal')
  // Three stacked branches are too tall for eight rows sideways, and stand side by side upright when the columns hold them.
  const tall = of(node('n1', 'parallel', { children: [node('n2', 'agent'), node('n3', 'agent'), node('n4', 'agent')] }))
  expect(layoutBoard(tall, { orientation: 'horizontal' }).height).toBeGreaterThan(8)
  expect(chooseOrientation(tall, 'horizontal', 120, 8)).toBe('vertical')
  expect(chooseOrientation(tall, 'horizontal', 30, 8)).toBe('horizontal')
  expect(chooseOrientation(tall, 'horizontal', 120, 20)).toBe('horizontal')
})

test('dropTarget: the nearest slot, its place as moveNode takes it, and none far from any', () => {
  const at = (id: string, x: number, y: number) => dropTarget(H, id, x, y)
  const [n1, n2, n3, n4, n5] = ['n1', 'n2', 'n3', 'n4', 'n5'].map(id => card(H, id)) as [BoardCard, BoardCard, BoardCard, BoardCard, BoardCard]
  // n5 dropped in the gap after n1 lands second; on n1's left edge, first.
  expect(at('n5', n1.w + 1, 2)?.to).toEqual({ index: 1 })
  expect(at('n5', 0, 1)?.to).toEqual({ index: 0 })
  // n1 dropped after n2: the index counts the list without n1.
  expect(at('n1', n5.x - 2, 1)?.to).toEqual({ index: 1 })
  expect(at('n1', n5.x + n5.w + 1, 1)?.to).toEqual({ index: 2 })
  // Into the pipeline: between its stages, and at its end.
  expect(at('n5', n4.x - 2, n4.y + 1)?.to).toEqual({ parentId: 'n2', index: 1 })
  expect(at('n1', n4.x + n4.w + 2, n4.y + 1)?.to).toEqual({ parentId: 'n2', index: 2 })
  expect(at('n1', n3.x, n3.y + 1)?.to).toEqual({ parentId: 'n2', index: 0 })
  // Out of it: n3 dropped after n2.
  expect(at('n3', n5.x - 2, 1)?.to).toEqual({ index: 2 })
  // Next to where it already is: a slot, but no move.
  expect(at('n1', n1.w + 1, 1)).toMatchObject({ to: null })
  expect(at('n4', n4.x - 2, n4.y + 1)).toMatchObject({ to: null })
  // A container never drops into itself: the nearest slot outside it is taken instead.
  expect(at('n2', n4.x - 2, n4.y + 1)?.slot.place.parentId).toBe(undefined)
  // Top to bottom: the connector's row is the slot between two cards, a container's bottom border the end of its list.
  const v = (id: string, x: number, y: number) => dropTarget(V, id, x, y)
  expect(v('n5', 20, card(V, 'n2').y - 1)?.to).toEqual({ index: 1 })
  expect(v('n5', 20, card(V, 'n4').y - 1)?.to).toEqual({ parentId: 'n2', index: 1 })
  expect(v('n1', 20, card(V, 'n2').y + card(V, 'n2').h - 1)?.to).toEqual({ parentId: 'n2', index: 2 })
  expect(v('n1', 20, card(V, 'n3').y)?.to).toEqual({ parentId: 'n2', index: 0 })
  expect(v('n3', 20, V.height - 1)?.to).toEqual({ index: 3 })
  // Far below everything: no slot.
  expect(at('n1', 4, H.height + 10)).toBe(null)
  expect(at('nope', 4, 1)).toBe(null)
  expect(n2.container).toBe(true)
})

test('navigate: arrows follow the flow, go into a container across it, and back out', () => {
  const go = (id: string | null, way: 'left' | 'right' | 'up' | 'down', orientation: 'horizontal' | 'vertical' = 'horizontal') => navigate(design, id, way, orientation)
  // Horizontal: left/right along the flow, down into the pipeline, up out of it.
  expect(go('n1', 'right')).toBe('n2')
  expect(go('n2', 'right')).toBe('n5')
  expect(go('n2', 'down')).toBe('n3')
  expect(go('n3', 'right')).toBe('n4')
  expect(go('n4', 'right')).toBe('n5')
  expect(go('n4', 'left')).toBe('n3')
  expect(go('n3', 'left')).toBe('n2')
  expect(go('n3', 'up')).toBe('n2')
  expect(go('n5', 'left')).toBe('n2')
  expect(go('n5', 'right')).toBe('n5')
  expect(go('n1', 'left')).toBe('n1')
  expect(go('n1', 'down')).toBe('n1')
  // Vertical: the same moves, turned.
  expect(go('n1', 'down', 'vertical')).toBe('n2')
  expect(go('n2', 'right', 'vertical')).toBe('n3')
  expect(go('n3', 'down', 'vertical')).toBe('n4')
  expect(go('n4', 'down', 'vertical')).toBe('n5')
  expect(go('n4', 'left', 'vertical')).toBe('n2')
  // With nothing selected: the first block going forward, the last going back.
  expect(go(null, 'right')).toBe('n1')
  expect(go(null, 'left')).toBe('n5')
  expect(navigate(of(), null, 'right', 'horizontal')).toBe(null)
  // Stacked branches are walked across the flow; forward along it leaves the stack.
  const stacked = of(node('n1', 'parallel', { children: [node('n2', 'agent'), node('n3', 'agent')] }), node('n4', 'agent'))
  expect(navigate(stacked, 'n1', 'down', 'horizontal')).toBe('n2')
  expect(navigate(stacked, 'n2', 'down', 'horizontal')).toBe('n3')
  expect(navigate(stacked, 'n3', 'up', 'horizontal')).toBe('n2')
  expect(navigate(stacked, 'n2', 'up', 'horizontal')).toBe('n1')
  expect(navigate(stacked, 'n3', 'right', 'horizontal')).toBe('n4')
  expect(navigate(stacked, 'n2', 'left', 'horizontal')).toBe('n1')
})
