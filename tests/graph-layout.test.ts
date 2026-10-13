import { expect, test } from 'claude-code/testing'

import { flatten } from '../src/project/model'
import type { Project, ProjectNode } from '../src/project/model'
import { moveNode } from '../src/project/ops'
import { TEMPLATES, review } from '../src/project/templates'
import { UNMAPPED_ID, canOpen, cardAt, cardOf, dropTarget, graphAt, layoutGraph, moveTarget, navigate, panTo, parentView, slideBy, viewFor, viewShows } from '../src/ui/graph-layout'
import type { Direction, GraphCard, GraphLayout, Rect } from '../src/ui/graph-layout'

// Review template: n6 start, n1 agent, n2 pipeline [n3 agent, n4 verify], n5 agent.
const project = review()
const BOX = { columns: 100, rows: 40 }
const L = layoutGraph(project, { ...BOX, selectedId: 'n1' })

const card = (layout: GraphLayout, id: string): GraphCard => {
  const found = cardOf(layout, id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}
const inside = (outer: Rect, inner: Rect): boolean => inner.x > outer.x && inner.y > outer.y && inner.x + inner.w < outer.x + outer.w && inner.y + inner.h < outer.y + outer.h
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const shape = (one: Project): string => {
  const draw = (nodes: ProjectNode[]): string => nodes.map(node => (node.children ? `${node.id}[${draw(node.children)}]` : node.id)).join(' ')
  return draw(one.nodes)
}
// A parallel of `count` agents between the start block and one more agent.
const arms = (count: number): Project => ({
  version: 1,
  name: 'arms',
  nodes: [
    { id: 'n90', type: 'start', name: 'start' },
    { id: 'n1', type: 'parallel', name: 'side by side', children: Array.from({ length: count }, (_, at) => ({ id: `n${at + 2}`, type: 'agent' as const, name: `arm ${at}` })) },
    { id: 'n80', type: 'agent', name: 'after' },
  ],
})

test('every block has a card, parents before what they hold, a chain top to bottom in order', () => {
  expect(L.cards.map(one => one.id)).toEqual(flatten(project).map(row => row.node.id))
  expect(L.blocks.map(one => one.id)).toEqual(flatten(project).map(row => row.node.id))

  const top = project.nodes.map(node => card(L, node.id))
  for (let at = 1; at < top.length; at++) expect(top[at]?.y ?? 0).toBeGreaterThanOrEqual((top[at - 1]?.y ?? 0) + (top[at - 1]?.h ?? 0))
  expect(card(L, 'n4').y).toBeGreaterThanOrEqual(card(L, 'n3').y + card(L, 'n3').h)
  expect(card(L, 'n1')).toMatchObject({ kind: 'leaf', selected: true, parentId: undefined, index: 1 })
  expect(card(L, 'n2')).toMatchObject({ kind: 'open', flow: 'chain', inside: 2, selected: false })
  expect(card(L, 'n4')).toMatchObject({ kind: 'leaf', parentId: 'n2', index: 1 })
})

test('nothing reaches past the width or the height, a container boxes what it holds, and no two siblings overlap', () => {
  for (const template of TEMPLATES) {
    for (const columns of [40, 72, 100, 132]) {
      const one = template.make()
      const layout = layoutGraph(one, { columns, rows: 30, selectedId: one.nodes[1]?.id ?? null })
      expect(layout.width).toBeLessThanOrEqual(columns)
      for (const each of layout.cards) {
        expect(each.x).toBeGreaterThanOrEqual(0)
        expect(each.y).toBeGreaterThanOrEqual(0)
        expect(each.x + each.w).toBeLessThanOrEqual(layout.width)
        expect(each.y + each.h).toBeLessThanOrEqual(layout.height)
        if (each.parentId !== undefined) expect(inside(card(layout, each.parentId), each)).toBe(true)
        for (const other of layout.cards) {
          if (other !== each && other.parentId === each.parentId) expect(overlap(each, other)).toBe(false)
        }
      }
    }
  }
})

test('the arms of a parallel stand side by side; more than fit are a carousel that holds the selected arm', () => {
  const two = layoutGraph(arms(2), BOX)
  expect(card(two, 'n1').flow).toBe('stack')
  expect(card(two, 'n3').y).toBe(card(two, 'n2').y)
  expect(card(two, 'n3').x).toBeGreaterThanOrEqual(card(two, 'n2').x + card(two, 'n2').w)
  expect(two.carousels).toEqual({})

  const many = layoutGraph(arms(6), { columns: 60, rows: 40 })
  const window = many.carousels.n1
  expect(window).toMatchObject({ first: 0, count: 6 })
  expect(many.cards.filter(one => one.parentId === 'n1').map(one => one.id)).toEqual(['n2', 'n3', 'n4', 'n5', 'n6', 'n7'].slice(0, window?.shown))
  // Only the side that has arms out of sight has a gutter, and it says how many.
  expect(many.gutters.map(one => [one.side, one.count])).toEqual([['right', 6 - (window?.shown ?? 0)]])
  expect(slideBy(many, { id: 'n1', side: 'right' })).toEqual({ n1: 1 })
  expect(slideBy(many, { id: 'n1', side: 'left' })).toEqual({ n1: 0 })

  // The selection is always in the window, whatever offset was asked for.
  const last = layoutGraph(arms(6), { columns: 60, rows: 40, selectedId: 'n7', scroll: { n1: 0 } })
  expect(cardOf(last, 'n7')).toBeDefined()
  expect(last.scroll.n1).toBe(6 - (last.carousels.n1?.shown ?? 0))
  // The blocks out of the window are still the project's: a run is summed over all of them.
  expect(last.blocks).toHaveLength(9)
})

test('edges: a pipeline hands each result on as it arrives; after a container that fans out, all are waited for', () => {
  const kinds = Object.fromEntries(L.edges.map(edge => [`${edge.from}>${edge.to}`, edge.kind]))
  expect(kinds).toEqual({ 'n6>n1': 'stream', 'n1>n2': 'stream', 'n3>n4': 'stream', 'n2>n5': 'barrier' })
  // No edge between arms: they do not feed each other.
  expect(layoutGraph(arms(2), BOX).edges.map(edge => `${edge.from}>${edge.to}`)).toEqual(['n90>n1', 'n1>n80'])
})

test('slots: one per place a block can go, none before the start block', () => {
  const places = L.slots.map(slot => `${slot.place.parentId ?? 'top'}:${slot.place.index}`).sort()
  expect(places).toEqual(['n2:0', 'n2:1', 'n2:2', 'top:1', 'top:2', 'top:3', 'top:4'])
  expect(L.slots.filter(slot => slot.end).map(slot => slot.place)).toEqual([{ parentId: 'n2', index: 2 }, { index: 4 }])
  // The one the keyboard adds at: after the selected block.
  expect(L.slots.filter(slot => slot.target).map(slot => slot.place)).toEqual([{ index: 2 }])
  expect(layoutGraph(project, { ...BOX, openAt: { parentId: 'n2', index: 1 } }).slots.filter(slot => slot.open).map(slot => slot.place)).toEqual([{ parentId: 'n2', index: 1 }])

  // An empty container has a place inside it.
  const hollow: Project = { version: 1, name: 'h', nodes: [{ id: 'n1', type: 'pipeline', name: 'p', children: [] }] }
  expect(layoutGraph(hollow, BOX).slots.map(slot => slot.place)).toContainEqual({ parentId: 'n1', index: 0 })
})

test('what is under a cell: the innermost card, and a slot where its mark is written', () => {
  const n3 = card(L, 'n3')
  expect(cardAt(L, n3.x + 1, n3.y + 1)?.id).toBe('n3')
  // The pipeline's own border is the pipeline's.
  expect(cardAt(L, card(L, 'n2').x, card(L, 'n2').y)?.id).toBe('n2')
  expect(cardAt(L, L.width + 5, 0)).toBeUndefined()

  for (const slot of L.slots) {
    if (slot.mark === null) continue
    const hit = graphAt(L, slot.mark.x, slot.mark.y, 0)
    expect(hit).toMatchObject({ kind: 'slot', slot: { place: slot.place } })
  }
  // The window panned by three rows: the same cell is three rows further down the graph.
  expect(graphAt(L, n3.x + 1, n3.y + 1 - 3, 3)).toMatchObject({ kind: 'card', card: { id: 'n3' } })
  // The selected card's chips are hit before the card.
  for (const chip of L.chips) expect(graphAt(L, chip.x, chip.y, 0)).toMatchObject({ kind: 'chip', chip: { id: 'n1' } })
})

test('agents no block claims get a card of their own after the project, at the root only', () => {
  expect(cardOf(L, UNMAPPED_ID)).toBeUndefined()
  const run = layoutGraph(project, { ...BOX, unmapped: 2 })
  expect(run.cards.at(-1)).toMatchObject({ id: UNMAPPED_ID, type: 'unmapped' })
  expect(card(run, UNMAPPED_ID).y).toBeGreaterThanOrEqual(card(run, 'n5').y + card(run, 'n5').h)
  expect(run.height).toBeGreaterThan(L.height)
  expect(cardOf(layoutGraph(project, { ...BOX, unmapped: 2, viewRootId: 'n2' }), UNMAPPED_ID)).toBeUndefined()
})

test('a container opened as the view is the frame: only what it holds is drawn, under a breadcrumb back', () => {
  const view = layoutGraph(project, { ...BOX, viewRootId: 'n2', selectedId: 'n3' })
  expect(view.viewRootId).toBe('n2')
  expect(view.cards.map(one => one.id)).toEqual(['n2', 'n3', 'n4'])
  expect(view.top).toBeGreaterThan(0)
  expect(view.crumbs.map(crumb => [crumb.id, crumb.last])).toEqual([
    [null, false],
    ['n2', true],
  ])
  expect(L.top).toBe(0)
  expect(L.crumbs).toEqual([])
  // A leaf is no view: the whole project is shown.
  expect(layoutGraph(project, { ...BOX, viewRootId: 'n1' }).viewRootId).toBe(null)

  expect(canOpen(project, null, 'n2')).toBe(true)
  expect(canOpen(project, null, 'n1')).toBe(false)
  expect(canOpen(project, 'n2', 'n2')).toBe(false)
  expect(parentView(project, 'n2')).toBe(null)
  expect(viewShows(project, 'n2', 'n3', 100)).toBe(true)
  expect(viewShows(project, 'n2', 'n5', 100)).toBe(false)
  // The view that shows a block: the one there is when it does, else the nearest that does.
  expect(viewFor(project, 'n2', 'n3', 100)).toBe('n2')
  expect(viewFor(project, 'n2', 'n5', 100)).toBe(null)
})

test('dropTarget: the nearest slot, its place as moveNode takes it, and none far from any', () => {
  const at = (index: number, parentId?: string) => {
    const slot = L.slots.find(one => one.place.index === index && one.place.parentId === parentId)
    if (!slot) throw new Error(`no slot ${parentId ?? 'top'}:${index}`)
    return slot
  }
  // n5 to the slot after n1: once n5 is lifted out, that is index 2.
  const up = dropTarget(L, 'n5', 50, at(2).y)
  expect(up?.to).toEqual({ index: 2 })
  expect(shape(moveNode(project, 'n5', up?.to ?? { index: 0 }).project)).toBe('n6 n1 n5 n2[n3 n4]')
  // n1 past the end: the slot is index 4, and with n1 lifted out the place is 3.
  const down = dropTarget(L, 'n1', 50, at(4).y)
  expect(down?.slot.place).toEqual({ index: 4 })
  expect(shape(moveNode(project, 'n1', down?.to ?? { index: 0 }).project)).toBe('n6 n2[n3 n4] n5 n1')
  // Into a container.
  const into = dropTarget(L, 'n5', 50, at(1, 'n2').y)
  expect(shape(moveNode(project, 'n5', into?.to ?? { index: 0 }).project)).toBe('n6 n1 n2[n3 n5 n4]')

  // Beside itself: a slot, and nowhere to go.
  expect(dropTarget(L, 'n5', 50, at(3).y)).toMatchObject({ slot: { place: { index: 3 } }, to: null })
  // A container is not dropped into itself.
  expect(dropTarget(L, 'n2', 50, at(1, 'n2').y)).toBe(null)
  expect(dropTarget(L, 'n5', 50, L.height + 30)).toBe(null)
  expect(dropTarget(L, 'n99', 50, at(2).y)).toBe(null)
})

test('navigate: down and up follow the reading order, into a container and out of it, and stop at the ends', () => {
  const walk = (from: string, direction: Direction, steps: number): string[] => {
    const seen = [from]
    for (let step = 0; step < steps; step++) seen.push(navigate(project, L, seen.at(-1) ?? null, direction) ?? '?')
    return seen
  }
  expect(walk('n6', 'down', 6)).toEqual(['n6', 'n1', 'n2', 'n3', 'n4', 'n5', 'n5'])
  expect(walk('n5', 'up', 6)).toEqual(['n5', 'n4', 'n3', 'n2', 'n1', 'n6', 'n6'])
  // Sideways outside a stack: right goes into a container, left out to the one around.
  expect(navigate(project, L, 'n2', 'right')).toBe('n3')
  expect(navigate(project, L, 'n4', 'left')).toBe('n2')
  expect(navigate(project, L, 'n1', 'right')).toBe('n1')
  // Nothing selected: the first card.
  expect(navigate(project, L, null, 'down')).toBe('n6')

  // Inside a stack the sideways keys go from arm to arm; down leaves it for what follows.
  const two = arms(2)
  const stack = layoutGraph(two, BOX)
  expect(navigate(two, stack, 'n2', 'right')).toBe('n3')
  expect(navigate(two, stack, 'n3', 'left')).toBe('n2')
  expect(navigate(two, stack, 'n3', 'right')).toBe('n3')
  expect(navigate(two, stack, 'n1', 'down')).toBe('n2')
  expect(navigate(two, stack, 'n2', 'down')).toBe('n80')

  // The selection never leaves the view.
  const view = layoutGraph(project, { ...BOX, viewRootId: 'n2', selectedId: 'n4' })
  expect(navigate(project, view, 'n4', 'down')).toBe('n4')
  expect(navigate(project, view, 'n2', 'up')).toBe('n2')
})

test('moveTarget walks a block down through a container and out the other side, and up retraces it', () => {
  const step = (from: Project, direction: Direction): Project => {
    const target = moveTarget(from, layoutGraph(from, { ...BOX, selectedId: 'n1' }), 'n1', direction)
    return target.to === null ? from : moveNode(from, 'n1', target.to).project
  }
  const down = [project]
  for (let at = 0; at < 5; at++) down.push(step(down.at(-1) ?? project, 'down'))
  expect(down.map(shape)).toEqual([
    'n6 n1 n2[n3 n4] n5',
    'n6 n2[n1 n3 n4] n5',
    'n6 n2[n3 n1 n4] n5',
    'n6 n2[n3 n4 n1] n5',
    'n6 n2[n3 n4] n1 n5',
    'n6 n2[n3 n4] n5 n1',
  ])
  const up = [down.at(-1) ?? project]
  for (let at = 0; at < 5; at++) up.push(step(up.at(-1) ?? project, 'up'))
  expect(up.map(shape)).toEqual([...down.map(shape)].reverse())

  // Refused with a reason: the start block, the ends, sideways outside a stack, nothing selected.
  for (const [id, direction] of [['n6', 'down'], ['n1', 'up'], ['n5', 'down'], ['n1', 'right'], [null, 'down'], ['n99', 'down']] as const) {
    const refused = moveTarget(project, L, id, direction)
    expect(refused.to).toBe(null)
    expect((refused.reason ?? '').length).toBeGreaterThan(0)
  }

  // Arms swap sideways.
  const two = arms(2)
  const stack = layoutGraph(two, BOX)
  expect(moveTarget(two, stack, 'n2', 'right').to).toEqual({ parentId: 'n1', index: 1 })
  expect(moveTarget(two, stack, 'n2', 'left').to).toBe(null)
  // A block does not leave the view it is shown in.
  const view = layoutGraph(project, { ...BOX, viewRootId: 'n2', selectedId: 'n4' })
  expect(moveTarget(project, view, 'n4', 'down').to).toBe(null)
  expect(moveTarget(project, view, 'n2', 'down').to).toBe(null)
})

test('panTo shows the selected card in the window, moving as little as it must, and stays inside the graph', () => {
  const rows = 10
  const most = L.height - rows
  for (const { id, y, h } of L.cards) {
    for (const from of [0, 5, most]) {
      const pan = panTo(L, rows, from, id)
      expect(pan).toBeGreaterThanOrEqual(0)
      expect(pan).toBeLessThanOrEqual(most)
      // Its top row is in the window; all of it when it fits.
      expect(y).toBeGreaterThanOrEqual(pan)
      expect(y).toBeLessThan(pan + rows)
      if (h <= rows) expect(y + h).toBeLessThanOrEqual(pan + rows)
    }
  }
  // Already in view: the pan stays.
  expect(panTo(L, rows, 0, 'n6')).toBe(0)
  // A window as tall as the graph has nowhere to pan to.
  expect(panTo(L, L.height + 10, 7, 'n5')).toBe(0)
  expect(panTo(L, rows, 500, null)).toBe(most)
})
