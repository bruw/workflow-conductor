import { expect, test } from 'claude-code/testing'

import type { Project } from '../src/project/model'
import { moveNode } from '../src/project/ops'
import { review } from '../src/project/templates'
import { cardOf, layoutGraph, panTo } from '../src/ui/graph-layout'
import type { GraphCard, GraphLayout, GraphSlot } from '../src/ui/graph-layout'
import { dragHint, dragScroll, dragTarget, dragging, graphLayout, graphMoving, graphOffsets, graphReduce, graphTicking, initialGraph, moveGraph, parseGraphMessage, syncGraph, tickGraph } from '../src/ui/graph-model'
import type { GraphContext, GraphInput, GraphMessage, GraphState } from '../src/ui/graph-model'
import { FRAME_MS, TWEEN_MS } from '../src/ui/tween'

// Review template: n6 start, n1 agent, n2 pipeline [n3 agent, n4 verify], n5 agent.
const project = review()
const BOX = { columns: 100, rows: 40 }
const laid = (selectedId: string | null, from: Project = project): GraphLayout => layoutGraph(from, { ...BOX, selectedId })
const L = laid('n1')

const card = (id: string, layout: GraphLayout = L): GraphCard => {
  const found = cardOf(layout, id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}
const slot = (index: number, parentId?: string, layout: GraphLayout = L): GraphSlot => {
  const found = layout.slots.find(one => one.place.index === index && one.place.parentId === parentId)
  if (!found) throw new Error(`no slot ${parentId ?? 'top'}:${index}`)
  return found
}
/** Where a slot's `[+]` is written. */
const mark = (one: GraphSlot): { x: number; y: number } => {
  if (!one.mark) throw new Error('the slot has no mark')
  return one.mark
}
const context = (more: Partial<GraphContext> = {}): GraphContext => {
  const selectedId = more.selectedId === undefined ? 'n1' : more.selectedId
  return { layout: laid(selectedId), ...BOX, selectedId, ...more }
}
const ready = (ctx: GraphContext = context()): GraphState => syncGraph(initialGraph(), ctx)

// Runs inputs in order; returns the final state and every message posted.
const run = (inputs: GraphInput[], ctx: GraphContext = context(), from: GraphState = ready(ctx)): { state: GraphState; posts: GraphMessage[] } => {
  let state = from
  const posts: GraphMessage[] = []
  for (const input of inputs) {
    const result = graphReduce(state, input, ctx)
    state = result.state
    if (result.post) posts.push(result.post)
  }
  return { state, posts }
}
const down = (x: number, y: number): GraphInput => ({ type: 'pointer', event: 'down', x, y })
const move = (x: number, y: number): GraphInput => ({ type: 'pointer', event: 'move', x, y })
const up = (x: number, y: number): GraphInput => ({ type: 'pointer', event: 'up', x, y })
const click = (x: number, y: number): GraphInput[] => [down(x, y), up(x, y)]
const key = (name: string, more: { ctrl?: true; shift?: true } = {}): GraphInput => ({ type: 'key', key: name, ...more })

test('a click on a card selects it, when the button is let go; the innermost card under the pointer wins', () => {
  const n3 = card('n3')
  expect(run([down(n3.x + 1, n3.y + 1)]).posts).toEqual([])
  expect(run(click(n3.x + 1, n3.y + 1)).posts).toEqual([{ kind: 'select', id: 'n3' }])
  // The pipeline's own border selects the pipeline.
  expect(run(click(card('n2').x, card('n2').y)).posts).toEqual([{ kind: 'select', id: 'n2' }])
  // The card already selected is not selected again, and a click is not a drag.
  const again = run(click(card('n1').x + 1, card('n1').y + 1))
  expect(again.posts).toEqual([{ kind: 'touch' }])
  expect(again.state.drag).toBe(null)
  // Outside the window nothing is pressed.
  expect(run(click(2, BOX.rows + 3)).posts).toEqual([{ kind: 'touch' }])
  // A second click on the selected container opens it as the view.
  const ctx = context({ selectedId: 'n2' })
  expect(run(click(card('n2', ctx.layout).x, card('n2', ctx.layout).y), ctx).posts).toEqual([{ kind: 'view', id: 'n2' }])
})

test('a click on a [+] asks for the add list at that place, in a container too; a chip steps its knob', () => {
  const top = mark(slot(1))
  const nested = mark(slot(1, 'n2'))
  expect(run(click(top.x, top.y)).posts).toEqual([{ kind: 'addAt', at: { index: 1 } }])
  expect(run(click(nested.x, nested.y)).posts).toEqual([{ kind: 'addAt', at: { parentId: 'n2', index: 1 } }])
  // Let go anywhere else, it asks for nothing.
  expect(run([down(top.x, top.y), up(top.x, top.y + 2)]).posts).toEqual([{ kind: 'touch' }])

  const chip = L.chips[0]
  expect(chip).toBeDefined()
  expect(run(click(chip?.x ?? -1, chip?.y ?? -1)).posts).toEqual([{ kind: 'knob', id: 'n1', slot: Number(chip?.key) }])

  // Locked: a [+] and a chip are not there to press.
  const locked = context({ locked: true })
  expect(run(click(top.x, top.y), locked).posts).toEqual([{ kind: 'touch' }])
  expect(run(click(chip?.x ?? -1, chip?.y ?? -1), locked).posts.some(post => post.kind === 'knob')).toBe(false)
})

test('dragging the selected card to a slot posts one move; nothing moves before the release', () => {
  const ctx = context({ selectedId: 'n5' })
  const n5 = card('n5', ctx.layout)
  const to = slot(2, undefined, ctx.layout)
  const held = run([down(n5.x + 1, n5.y + 1), move(50, to.y + 1), move(50, to.y)], ctx)
  expect(held.posts).toEqual([])
  expect(dragging(held.state)).toBe('n5')
  expect(dragTarget(held.state, ctx)?.to).toEqual({ index: 2 })
  expect(dragHint(held.state, ctx)).not.toBe('')
  const dropped = run([up(50, to.y)], ctx, held.state)
  expect(dropped.posts).toEqual([{ kind: 'move', id: 'n5', to: { index: 2 } }])
  expect(dropped.state.drag).toBe(null)

  // Into a container.
  const into = slot(1, 'n2', ctx.layout)
  expect(run([down(n5.x + 1, n5.y + 1), move(50, into.y), up(50, into.y)], ctx).posts).toEqual([{ kind: 'move', id: 'n5', to: { parentId: 'n2', index: 1 } }])
  // A card that is not selected is not picked up: the press selects it.
  expect(dragging(run([down(n5.x + 1, n5.y + 1), move(50, to.y)]).state)).toBe(null)
})

test('a drop outside any slot cancels: off the graph, or back where the card was', () => {
  const n1 = card('n1')
  const from = down(n1.x + 1, n1.y + 1)
  // Beside itself.
  const home = run([from, move(50, slot(2).y)])
  expect(dragging(home.state)).toBe('n1')
  expect(dragTarget(home.state, context())?.to).toBe(null)
  expect(run([up(50, slot(2).y)], context(), home.state).posts).toEqual([{ kind: 'touch' }])
  // Past the window's edge: the instance still gets the moves, the drop cancels.
  const lost = run([from, move(30, -3)])
  expect(dragTarget(lost.state, context())).toBe(null)
  expect(run([up(30, -3)], context(), lost.state).posts).toEqual([{ kind: 'touch' }])
  expect(dragHint(ready(), context())).toBe('')
  // A key lets go of the card; enter and leave change nothing.
  const held = run([from, move(40, 1), { type: 'pointer', event: 'leave', x: 40, y: 1 }])
  expect(dragging(held.state)).toBe('n1')
  expect(run([key('z')], context(), held.state)).toMatchObject({ state: { drag: null }, posts: [] })
})

test('locked: a press selects and pans, and never lifts a card', () => {
  const n1 = card('n1')
  const ctx = context({ locked: true })
  const pressed = run([down(n1.x + 1, n1.y + 1), move(50, slot(4).y)], ctx)
  expect(dragging(pressed.state)).toBe(null)
  expect(run([up(50, slot(4).y)], ctx, pressed.state).posts.some(post => post.kind === 'move')).toBe(false)
  expect(run(click(card('n3').x + 1, card('n3').y + 1), ctx).posts).toEqual([{ kind: 'select', id: 'n3' }])
  // A run that starts takes a held card out of the hand.
  const held = run([down(n1.x + 1, n1.y + 1), move(50, slot(4).y)])
  expect(dragging(held.state)).toBe('n1')
  expect(syncGraph(held.state, ctx).drag).toBe(null)
})

test('a drag on anything but the selected card pans a graph taller than its window, and stops at its ends', () => {
  const ctx = context({ selectedId: null, rows: 10 })
  const most = ctx.layout.height - 10
  const from = ready(ctx)
  expect(from.panY).toBe(0)
  // The row between two cards, away from its [+], is background.
  const gap = slot(1, undefined, ctx.layout).y
  const dragged = run([down(10, gap), move(10, gap - 3)], ctx, from)
  expect(dragged.posts).toEqual([])
  expect(dragged.state.panY).toBe(3)
  expect(run([move(10, -500)], ctx, dragged.state).state.panY).toBe(most)
  expect(run([move(10, 500), up(10, 500)], ctx, dragged.state)).toMatchObject({ state: { panY: 0, drag: null }, posts: [{ kind: 'touch' }] })
  // A card pressed and dragged pans too, and is not selected by that.
  const onCard = run([down(1, 1), move(1, 0), up(1, 0)], ctx, from)
  expect(onCard).toMatchObject({ state: { panY: 1 }, posts: [{ kind: 'touch' }] })
  // A graph that fits its window does not pan.
  expect(run([down(10, gap), move(10, gap - 3)], context({ selectedId: null })).state.panY).toBe(0)
})

test('the pan follows the selection, leaves a hand-made pan alone, and takes the wheel’s rows', () => {
  const ctx = context({ selectedId: 'n5', rows: 10 })
  const shown = syncGraph(initialGraph(), ctx)
  expect(shown.panY).toBe(panTo(ctx.layout, 10, 0, 'n5'))
  expect(shown.panY).toBeGreaterThan(0)
  // Nothing new to follow: the very same state comes back.
  expect(syncGraph(shown, ctx)).toBe(shown)
  // The person pans away: the selection has not changed, so the pan stays.
  const gap = slot(4, undefined, ctx.layout).y - shown.panY
  const away = run([down(10, gap), move(10, gap + 4), up(10, gap + 4)], ctx, shown)
  expect(away.state.panY).toBe(shown.panY - 4)
  expect(syncGraph(away.state, ctx)).toBe(away.state)
  // Another selection is followed again.
  const other = context({ selectedId: 'n6', rows: 10 })
  expect(syncGraph(away.state, other).panY).toBe(0)
  // A window grown past the graph pulls the pan back in.
  expect(syncGraph(shown, context({ selectedId: 'n5' })).panY).toBe(0)

  // The wheel: the first sum seen is where the count starts; from there the pan moves by what was added.
  const still = context({ selectedId: null, rows: 10, wheel: { from: 'a', rows: 5 } })
  const counted = syncGraph(initialGraph(), still)
  expect(counted.panY).toBe(0)
  expect(syncGraph(counted, { ...still, wheel: { from: 'a', rows: 8 } }).panY).toBe(3)
  expect(syncGraph(counted, { ...still, wheel: { from: 'a', rows: 500 } }).panY).toBe(still.layout.height - 10)
  // A count begun anew moves nothing.
  expect(syncGraph(counted, { ...still, wheel: { from: 'b', rows: 40 } }).panY).toBe(0)
})

test('keys are posted as the key table names them; none with a modifier, or while a request waits in the prompt', () => {
  const posted = (input: GraphInput, ctx: GraphContext = context()) => run([input], ctx).posts
  expect(posted(key('s'))).toEqual([{ kind: 'key', key: 's' }])
  expect(posted(key('down'))).toEqual([{ kind: 'key', key: 's' }])
  expect(['up', 'left', 'right'].flatMap(name => posted(key(name)))).toEqual(['w', 'a', 'd'].map(name => ({ kind: 'key', key: name })))
  expect(posted(key('s', { shift: true }))).toEqual([{ kind: 'key', key: 'S' }])
  expect(posted(key('return'))).toEqual(posted(key('enter')))
  expect(posted(key('return'))).toHaveLength(1)
  // A key the table does not hold does nothing on the graph.
  expect(['z', 'tab', ' ', 'delete'].flatMap(name => posted(key(name)))).toEqual([])
  expect(posted(key('x', { ctrl: true }))).toEqual([])
  expect(posted(key('s'), context({ hold: true }))).toEqual([])
})

test('the pointer over a [+] lights it: the hover is kept until the pointer leaves it', () => {
  const ctx = context()
  const at = mark(slot(1, 'n2'))
  const over = run([move(at.x, at.y)], ctx)
  expect(over.state.hover).toEqual({ parentId: 'n2', index: 1 })
  expect(over.posts).toEqual([])
  // Another move on the same slot changes nothing: the very same state, so nothing is redrawn.
  const start = over.state
  expect(graphReduce(start, move(at.x + 1, at.y), ctx).state).toBe(start)
  // Off it, or out of the region: gone.
  expect(run([move(at.x + 20, at.y)], ctx, start).state.hover).toBe(null)
  expect(run([{ type: 'pointer', event: 'leave', x: at.x, y: at.y }], ctx, start).state.hover).toBe(null)
  // Locked, nothing hovers; a slot that is gone lets go of its hover.
  expect(run([move(at.x, at.y)], { ...ctx, locked: true }).state.hover).toBe(null)
  expect(syncGraph(start, { ...ctx, locked: true }).hover).toBe(null)
  expect(syncGraph({ ...start, hover: { parentId: 'gone', index: 0 } }, ctx).hover).toBe(null)
  expect(syncGraph(start, ctx).hover).toEqual({ parentId: 'n2', index: 1 })
})

test('cards slide to a new place over a few frames, and the ticker flag drops when they have arrived', () => {
  const first = moveGraph(ready(), L)
  // The first drawing records places: nothing slides, nothing ticks.
  expect(graphMoving(first)).toBe(false)
  expect(graphTicking(first, context())).toBe(false)
  expect(moveGraph(first, L)).toBe(first)
  // Another selection is drawn in place: the keys never wait on a tween.
  expect(graphMoving(moveGraph(first, laid('n4')))).toBe(false)

  // n5 moved up to after the start block: every top-level card below it has a new row.
  const swapped = moveNode(project, 'n5', { index: 1 }).project
  const after = laid('n1', swapped)
  const ctx = context({ layout: after })
  let state: GraphState = { ...moveGraph(first, after), ticking: true }
  expect(graphMoving(state)).toBe(true)
  expect(graphTicking(state, ctx)).toBe(true)
  const start = graphOffsets(state)
  expect(start.n5?.dy).toBe(card('n5').y - card('n5', after).y)
  expect(start.n1?.dy).toBe(card('n1').y - card('n1', after).y)
  expect(start.n6).toBeUndefined()
  let frames = 0
  let last = Math.abs(start.n5?.dy ?? 0)
  while (state.ticking && frames < 100) {
    state = tickGraph(state, ctx)
    frames++
    const now = Math.abs(graphOffsets(state).n5?.dy ?? 0)
    expect(now).toBeLessThanOrEqual(last)
    last = now
  }
  expect(frames * FRAME_MS).toBeLessThanOrEqual(TWEEN_MS + FRAME_MS)
  expect(state).toMatchObject({ ticking: false, clock: 0 })
  expect(graphOffsets(state)).toEqual({})
  expect(graphTicking(state, ctx)).toBe(false)
  expect(moveGraph(state, after)).toBe(state)
})

test('a card held at the window’s edge pans the graph row by row, as far as there is graph', () => {
  const ctx = context({ rows: 10 })
  const most = ctx.layout.height - 10
  const n1 = card('n1')
  const from = ready(ctx)
  const held = run([down(n1.x + 1, n1.y + 1 - from.panY), move(n1.x + 1, 9)], ctx, from)
  expect(dragging(held.state)).toBe('n1')
  expect(dragScroll(held.state, ctx)).toBe(1)
  expect(graphTicking(held.state, ctx)).toBe(true)
  let state: GraphState = { ...held.state, ticking: true }
  const pans = [state.panY]
  for (let turn = 0; turn < 5000 && state.ticking; turn++) {
    state = tickGraph(state, ctx)
    if (state.panY !== pans.at(-1)) pans.push(state.panY)
  }
  // One row at a time, to the graph's end: there the ticker stops by itself.
  for (let at = 1; at < pans.length; at++) expect((pans[at] ?? 0) - (pans[at - 1] ?? 0)).toBe(1)
  expect(state).toMatchObject({ panY: most, ticking: false })
  expect(dragScroll(state, ctx)).toBe(0)
  // In the middle of the window nothing pans.
  expect(dragScroll(run([move(n1.x + 1, 5)], ctx, held.state).state, ctx)).toBe(0)
  expect(dragScroll(from, ctx)).toBe(0)
})

test('graphLayout lays out what the props describe; a run locks the chips', () => {
  const props = { project, mode: 'project' as const, selectedId: 'n1', viewRootId: null, problems: {}, openAt: null, scroll: {}, ...BOX, unmapped: 0 }
  expect(graphLayout(props)).toEqual(L)
  expect(L.chips.length).toBeGreaterThan(0)
  expect(graphLayout({ ...props, mode: 'run' }).chips).toEqual([])
})

test('posted data is read back as a message, or refused', () => {
  for (const message of [
    { kind: 'select', id: 'n1' },
    { kind: 'select', id: null },
    { kind: 'view', id: 'n2' },
    { kind: 'view', id: null },
    { kind: 'move', id: 'n1', to: { parentId: 'n2', index: 0 } },
    { kind: 'addAt', at: { index: 2 } },
    { kind: 'knob', id: 'n1', slot: 2 },
    { kind: 'slide', id: 'n1', first: 3 },
    { kind: 'touch' },
    { kind: 'key', key: 's' },
    { kind: 'key', key: 'enter' },
  ]) {
    expect(parseGraphMessage(message)).toEqual(message)
  }
  // Nothing more than the message is taken.
  expect(parseGraphMessage({ kind: 'select', id: 'n1', extra: true })).toEqual({ kind: 'select', id: 'n1' })
  for (const junk of [null, 3, 'select', [], {}, { kind: 'select' }, { kind: 'move', id: 'n1' }, { kind: 'move', id: 'n1', to: { index: -1 } }, { kind: 'addAt', at: { index: 1.5 } }, { kind: 'key', key: 'explode' }, { kind: 'key' }, { kind: 'knob', id: 'n1', slot: 3 }, { kind: 'slide', id: 'n1', first: -1 }, { kind: 'nope', id: 'n1' }]) {
    expect(parseGraphMessage(junk)).toBe(undefined)
  }
})
