import { expect, test } from 'claude-code/testing'

import type { Design, DesignNode, NodeType } from '../src/design/model'
import { judgePanel, review } from '../src/design/templates'
import { GAP_H, GAP_V, LEAF_H, LEAF_MAX_W, LEAF_MIN_RUN_W, LEAF_MIN_W, UNMAPPED_ID, cardAt, chooseOrientation, dropTarget, edgeKind, fanOf, layoutBoard, navigate, slotAt } from '../src/ui/board-layout'
import type { BoardCard, BoardLayout } from '../src/ui/board-layout'

// Review template: n1 agent, n2 pipeline ×4 [n3 agent, n4 verify ×3 votes], n5 agent.
const design = review()
const H = layoutBoard(design, { orientation: 'horizontal' })
const V = layoutBoard(design, { orientation: 'vertical' })

const card = (layout: BoardLayout, id: string): BoardCard => {
  const found = layout.cards.find(one => one.id === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}
const node = (id: string, type: NodeType, more: Partial<DesignNode> = {}): DesignNode => ({ id, type, title: id, ...more })
const of = (...nodes: DesignNode[]): Design => ({ version: 1, name: 'd', description: '', nodes })
const inside = (outer: BoardCard, inner: BoardCard): boolean => inner.x > outer.x && inner.y > outer.y && inner.x + inner.w < outer.x + outer.w && inner.y + inner.h < outer.y + outer.h
const overlap = (a: BoardCard, b: BoardCard): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('horizontal: top-level cards run left to right in order, a gap for the edge between each', () => {
  expect(H.orientation).toBe('horizontal')
  const [n1, n2, n5] = [card(H, 'n1'), card(H, 'n2'), card(H, 'n5')]
  expect([n1.y, n2.y, n5.y]).toEqual([0, 0, 0])
  expect(n1.x).toBe(0)
  expect(n2.x).toBe(n1.x + n1.w + GAP_H)
  // n2 fans out: its shade column stands between it and the gap.
  expect(n2.shadow).toBe(true)
  expect(n5.x).toBe(n2.x + n2.w + 1 + GAP_H)
  expect(H.width).toBeGreaterThanOrEqual(n5.x + n5.w)
  expect(H.height).toBe(n2.h)
})

test('vertical: the same design runs top to bottom', () => {
  expect(V.orientation).toBe('vertical')
  const [n1, n2, n5] = [card(V, 'n1'), card(V, 'n2'), card(V, 'n5')]
  expect([n1.x, n2.x, n5.x]).toEqual([0, 0, 0])
  expect(n2.y).toBe(n1.y + n1.h + GAP_V)
  expect(n5.y).toBe(n2.y + n2.h + GAP_V)
  expect(V.height).toBeGreaterThan(H.height)
  expect(V.width).toBeLessThan(H.width)
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
  expect(card(V, 'n4').y).toBe(card(V, 'n3').y + card(V, 'n3').h + GAP_V)
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
  const v = layoutBoard(stacked, { orientation: 'vertical' })
  expect(new Set([card(v, 'n2').y, card(v, 'n3').y, card(v, 'n4').y]).size).toBe(1)
  expect(card(v, 'n3').x).toBe(card(v, 'n2').x + card(v, 'n2').w + 1)
  for (const layout of [h, v]) {
    expect(layout.edges.map(edge => `${edge.from}>${edge.to}`)).toEqual(['n1>n5'])
    expect(card(layout, 'n1').h).toBeGreaterThan(LEAF_H)
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

test('fan-out: a count in the header and a shade column, from fanout or votes', () => {
  expect(fanOf({ knobs: { fanout: '×4 dimensions' } })).toBe('×4')
  expect(fanOf({ knobs: { fanout: '4 search angles' } })).toBe('×4')
  expect(fanOf({ knobs: { fanout: 'changed files' } })).toBe('×n')
  expect(fanOf({ knobs: { votes: 3 } })).toBe('×3')
  expect(fanOf({})).toBe('')
  expect(card(H, 'n2')).toMatchObject({ fan: '×4', shadow: true, header: 'n2 pipeline ×4 · review' })
  expect(card(H, 'n4')).toMatchObject({ fan: '×3', shadow: true, header: 'n4 verify ×3' })
  expect(card(H, 'n1')).toMatchObject({ fan: '', shadow: false, header: 'n1 agent' })
})

test('edges: a pipeline streams between its stages; elsewhere many results are a barrier, one is a plain hand-off', () => {
  const kinds = (layout: BoardLayout) => Object.fromEntries(layout.edges.map(edge => [`${edge.from}>${edge.to}`, edge.kind]))
  for (const layout of [H, V]) expect(kinds(layout)).toEqual({ 'n1>n2': 'stream', 'n3>n4': 'stream', 'n2>n5': 'barrier' })
  expect(kinds(layoutBoard(judgePanel(), { orientation: 'horizontal' }))).toEqual({ 'n1>n3': 'barrier', 'n3>n4': 'barrier' })
  expect(edgeKind('pipeline', { type: 'agent', knobs: { fanout: '×9' } })).toBe('stream')
  expect(edgeKind('loop', { type: 'agent', knobs: { fanout: '×9' } })).toBe('barrier')
  expect(edgeKind(undefined, { type: 'sweep' })).toBe('barrier')
  expect(edgeKind(undefined, { type: 'code' })).toBe('stream')
  // An edge sits in the gap: on the row under the top border, or under the card's left part.
  expect(H.edges.find(edge => edge.from === 'n1')).toMatchObject({ axis: 'h', x: card(H, 'n1').w + 1, y: 1 })
  expect(V.edges.find(edge => edge.from === 'n1')).toMatchObject({ axis: 'v', x: 2, y: card(V, 'n1').h })
})

test('slots: a + between chained siblings and at the end of every list; drop-only slots before the first', () => {
  const places = (layout: BoardLayout) => layout.slots.filter(slot => slot.mark !== null).map(slot => `${slot.place.parentId ?? 'top'}:${slot.place.index}`)
  for (const layout of [H, V]) expect(places(layout).sort()).toEqual(['n2:1', 'n2:2', 'top:1', 'top:2', 'top:3'])
  expect(H.slots.filter(slot => slot.mark === null).map(slot => `${slot.place.parentId ?? 'top'}:${slot.place.index}`).sort()).toEqual(['n2:0', 'top:0'])
  const between = H.slots.find(slot => slot.place.parentId === undefined && slot.place.index === 1)
  expect(between?.mark).toEqual({ x: card(H, 'n1').w + 1, y: 2 })
  expect(slotAt(H, card(H, 'n1').w + 1, 2)?.place).toEqual({ index: 1 })
  expect(slotAt(H, card(H, 'n1').w + 2, 2)?.place).toEqual({ index: 1 })
  expect(slotAt(H, card(H, 'n1').w + 1, 0)).toBe(undefined)
  // An empty design is one slot; an empty container holds one.
  const blank = layoutBoard(of(), { orientation: 'horizontal' })
  expect(blank.slots).toHaveLength(1)
  expect(blank.slots[0]).toMatchObject({ place: { index: 0 }, mark: { x: 1, y: 0 } })
  const hollow = layoutBoard(of(node('n1', 'pipeline', { children: [] })), { orientation: 'horizontal' })
  expect(hollow.slots.find(slot => slot.place.parentId === 'n1')).toMatchObject({ place: { parentId: 'n1', index: 0 }, mark: { x: 3, y: 1 } })
  expect(card(hollow, 'n1').h).toBe(3)
})

test('card widths: bounded, titles never grow a card without limit, a run asks a little more', () => {
  const long = of(node('n1', 'agent', { title: 'a very long title that would otherwise make this card enormous' }), node('n2', 'agent', { title: 'x' }))
  const layout = layoutBoard(long, { orientation: 'horizontal' })
  expect(card(layout, 'n1').w).toBe(LEAF_MAX_W)
  expect(card(layout, 'n2').w).toBe(LEAF_MIN_W)
  expect(card(layoutBoard(long, { orientation: 'horizontal', run: true }), 'n2').w).toBe(LEAF_MIN_RUN_W)
  // A prompt shows on the card but never widens it.
  expect(card(H, 'n5')).toMatchObject({ w: LEAF_MIN_W, knobs: 'Write one review from the confirmed findings of every dimension' })
  expect(card(H, 'n1').knobs).toBe('low')
})

test('agents no block claims get a card of their own after the design', () => {
  const h = layoutBoard(design, { orientation: 'horizontal', run: true, unmapped: 2 })
  const stray = card(h, UNMAPPED_ID)
  expect(stray).toMatchObject({ type: 'unmapped', header: 'unmapped ×2', y: 0, shadow: true })
  expect(stray.x).toBeGreaterThan(card(h, 'n5').x + card(h, 'n5').w)
  expect(h.width).toBe(stray.x + stray.w + 1)
  const v = layoutBoard(design, { orientation: 'vertical', run: true, unmapped: 2 })
  expect(card(v, UNMAPPED_ID).y).toBeGreaterThan(card(v, 'n5').y + LEAF_H)
  expect(layoutBoard(design, { orientation: 'horizontal', run: true }).cards.some(one => one.id === UNMAPPED_ID)).toBe(false)
})

test('orientation: a dock is vertical; inline is horizontal unless only vertical fits', () => {
  expect(chooseOrientation(design, 'vertical', 200, 50)).toBe('vertical')
  expect(chooseOrientation(design, 'horizontal', 120, 12)).toBe('horizontal')
  expect(chooseOrientation(design, 'horizontal', 40, 12)).toBe('horizontal')
  // Three stacked branches are too tall for four rows sideways, and narrow enough to stand upright.
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
