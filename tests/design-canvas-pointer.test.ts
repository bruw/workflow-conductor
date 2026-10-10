import { expect, test } from 'claude-code/testing'

import type { Design } from '../src/design/model'
import { flatten } from '../src/design/model'
import { moveNode } from '../src/design/ops'
import { review } from '../src/design/templates'
import {
  ADD_ROW_ID,
  animateLayout,
  buildDesignRows,
  canvasMoving,
  canvasReduce,
  dropTarget,
  hintLine,
  initialCanvas,
  lineYs,
  moveCanvas,
  syncCanvas,
  tickCanvas,
  viewCanvas,
} from '../src/ui/canvas-model'
import type { CanvasInput, CanvasMessage, CanvasPointer, CanvasState } from '../src/ui/canvas-model'
import { FRAME_MS, TWEEN_MS } from '../src/ui/tween'

// Review template, one row per line: 0 n1 · 1 n2 pipeline · 2 n3 · 3 n4 (both inside n2) · 4 n5 · 5 + add.
const design = review()
const start: CanvasState = { ...initialCanvas(), rev: 1, selectedId: 'n1' }
const TITLE = 10

const point = (event: CanvasPointer['event'], x: number, y: number): CanvasPointer => ({ type: 'pointer', event, x, y })
const run = (state: CanvasState, inputs: CanvasInput[], on: Design = design, capacity = 0): { state: CanvasState; posts: CanvasMessage[] } => {
  const posts: CanvasMessage[] = []
  let current = state
  for (const one of inputs) {
    const result = canvasReduce(current, one, { design: on, capacity })
    current = result.state
    if (result.post) posts.push(result.post)
  }
  return { state: current, posts }
}
// Press on a row's title, move a line at a time to `toY` (shifted `dx` columns), and let go.
const drag = (fromY: number, toY: number, dx = 0): CanvasInput[] => {
  const inputs: CanvasInput[] = [point('down', TITLE, fromY)]
  const step = toY > fromY ? 1 : -1
  for (let y = fromY; y !== toY; y += step) inputs.push(point('move', TITLE, y + step))
  if (dx !== 0) inputs.push(point('move', TITLE + dx, toY))
  return [...inputs, point('up', TITLE + dx, toY)]
}
const shown = (state: CanvasState, on: Design = design, capacity = 0): string[] =>
  viewCanvas(state, { design: on, lints: [] }, capacity).layout.lines.map(line => (line.kind === 'row' ? line.row.id : line.kind === 'lifted' ? `[${line.row.id}]` : line.kind))

test('a click selects the row under it and posts the selection once', () => {
  const { state, posts } = run(start, [point('down', TITLE, 4), point('up', TITLE, 4)])
  expect(state.selectedId).toBe('n5')
  expect(state.drag).toBe(null)
  expect(posts).toEqual([{ kind: 'select', id: 'n5' }])

  // The selected row again: nothing to post. A click below the rows: nothing at all.
  expect(run(start, [point('down', TITLE, 0), point('up', TITLE, 0)]).posts).toEqual([])
  expect(run(start, [point('down', TITLE, 9), point('up', TITLE, 9)])).toEqual({ state: start, posts: [] })
})

test('a click on + add opens the picker at the end; a press elsewhere closes it', () => {
  const { state, posts } = run(start, [point('down', 4, 5), point('up', 4, 5)])
  expect(state.selectedId).toBe(ADD_ROW_ID)
  expect(state.picker).toMatchObject({ query: '', at: { index: 3 } })
  expect(posts).toEqual([{ kind: 'select', id: null }])

  const closed = run(state, [point('down', TITLE, 0)])
  expect(closed.state.picker).toBe(null)
  expect(closed.state.selectedId).toBe(ADD_ROW_ID)
  expect(closed.posts).toEqual([])
})

test("a click on a container's glyph folds and unfolds it; a leaf's glyph only selects", () => {
  const folded = run(start, [point('down', 0, 1), point('up', 0, 1)])
  expect(folded.state.collapsed).toEqual(['n2'])
  expect(folded.state.selectedId).toBe('n2')
  expect(folded.state.drag).toBe(null)
  expect(folded.posts).toEqual([{ kind: 'select', id: 'n2' }])
  expect(run(folded.state, [point('down', 1, 1), point('up', 1, 1)]).state.collapsed).toEqual([])

  const leaf = run(start, [point('down', 0, 4), point('up', 0, 4)])
  expect(leaf.state.collapsed).toEqual([])
  expect(leaf.state.selectedId).toBe('n5')
})

test('dragging a row down two lines posts one move to the place under the pointer', () => {
  // n1 from line 0 to line 2: between n3 and n4, so inside the pipeline.
  const { state, posts } = run(start, drag(0, 2))
  expect(posts).toEqual([{ kind: 'move', id: 'n1', to: { parentId: 'n2', index: 1 } }])
  expect(state.selectedId).toBe('n1')

  // The posted place is what moveNode takes: the list as it stands once the row is lifted out.
  const moved = moveNode(design, 'n1', { parentId: 'n2', index: 1 }).design
  expect(flatten(moved).map(row => row.node.id)).toEqual(['n2', 'n3', 'n1', 'n4', 'n5'])

  // The row stays lifted where it was dropped until the design that holds the move arrives.
  expect(state.drag?.settling).toMatchObject({ place: { parentId: 'n2', index: 1 }, slot: 2 })
  expect(shown(state)).toEqual(['n2', 'n3', '[n1]', 'n4', 'n5', ADD_ROW_ID])
  const landed = syncCanvas(state, { design: moved, selectedId: 'n1', rev: 1 })
  expect(landed.drag).toBe(null)
  expect(shown(landed, moved)).toEqual(['n2', 'n3', 'n1', 'n4', 'n5', ADD_ROW_ID])
})

test('a row drags up as well, and a container takes its subtree along', () => {
  expect(run({ ...start, selectedId: 'n5' }, drag(4, 0)).posts).toEqual([{ kind: 'move', id: 'n5', to: { index: 0 } }])

  // n2 (with n3 and n4 inside) to the end: the lines under it close up while it is held.
  const inputs = drag(1, 2)
  const held = run(start, inputs.slice(0, -1)).state
  expect(shown(held)).toEqual(['n1', 'n5', '[n2]', ADD_ROW_ID])
  const lifted = viewCanvas(held, { design, lints: [] }).layout.lines[2]
  expect(lifted?.kind === 'lifted' && lifted.row.hidden).toBe(2)
  expect(run(start, inputs).posts.at(-1)).toEqual({ kind: 'move', id: 'n2', to: { index: 2 } })
})

test('at the end of a container the column picks: straight down lands after it, a level right lands inside', () => {
  // n1 to line 3: under n4 (the pipeline's last stage) and above n5.
  expect(run(start, drag(0, 3)).posts).toEqual([{ kind: 'move', id: 'n1', to: { index: 1 } }])
  expect(run(start, drag(0, 3, 3)).posts).toEqual([{ kind: 'move', id: 'n1', to: { parentId: 'n2', index: 2 } }])
  // Further right is clamped to the deepest the slot allows; left of the rail to the shallowest.
  expect(run(start, drag(0, 3, 12)).posts).toEqual([{ kind: 'move', id: 'n1', to: { parentId: 'n2', index: 2 } }])
  expect(run(start, drag(0, 3, -9)).posts).toEqual([{ kind: 'move', id: 'n1', to: { index: 1 } }])
  // Where the slot is not ambiguous the column changes nothing: between two stages is inside.
  expect(run(start, drag(0, 2, -9)).posts).toEqual([{ kind: 'move', id: 'n1', to: { parentId: 'n2', index: 1 } }])
})

test('dropTarget: slots, depths and the places they mean', () => {
  const rest = buildDesignRows({ ...design, nodes: design.nodes.slice(1) }) // n2 [n3 n4] n5 +
  expect(dropTarget(rest, 0, 0)).toEqual({ place: { index: 0 }, slot: 0, depth: 0 })
  expect(dropTarget(rest, 1, 0)).toEqual({ place: { parentId: 'n2', index: 0 }, slot: 1, depth: 1 })
  expect(dropTarget(rest, 3, 0)).toEqual({ place: { index: 1 }, slot: 3, depth: 0 })
  expect(dropTarget(rest, 3, 1)).toEqual({ place: { parentId: 'n2', index: 2 }, slot: 3, depth: 1 })
  // On the + add line: the end of the top level. Never under a leaf, however far right.
  expect(dropTarget(rest, 5, 4)).toEqual({ place: { index: 2 }, slot: 4, depth: 0 })
  expect(dropTarget(rest, 4, 4)?.place).toEqual({ index: 2 })
  // Outside the list.
  expect(dropTarget(rest, -1, 0)).toBe(null)
  expect(dropTarget(rest, 6, 0)).toBe(null)

  // A folded container takes nothing inside; an open empty one does.
  const folded = buildDesignRows({ ...design, nodes: design.nodes.slice(1) }, { collapsed: ['n2'] }) // n2 n5 +
  expect(dropTarget(folded, 1, 3)?.place).toEqual({ index: 1 })
  const empty: Design = { version: 1, name: 'e', description: '', nodes: [{ id: 'n1', type: 'pipeline', title: 'p', notes: '' }] }
  expect(dropTarget(buildDesignRows(empty), 1, 1)?.place).toEqual({ parentId: 'n1', index: 0 })
  expect(dropTarget(buildDesignRows(empty), 1, 0)?.place).toEqual({ index: 1 })
})

test('an invalid drop is a no-op: outside the rows, or back where the row was', () => {
  // Released below the list (the hint line and beyond) and above the region.
  for (const y of [7, 40, -2]) {
    const { state, posts } = run(start, [point('down', TITLE, 4), point('move', TITLE, 3), point('move', TITLE, y), point('up', TITLE, y)])
    expect(posts).toEqual([{ kind: 'select', id: 'n5' }])
    expect(state.drag).toBe(null)
  }
  // With a height limit, the hint line is the first line past the rows shown.
  const cut = run(start, [point('down', TITLE, 0), point('move', TITLE, 2), point('move', TITLE, 4), point('up', TITLE, 4)], design, 4)
  expect(cut.posts).toEqual([])
  expect(cut.state.drag).toBe(null)

  // Carried away and brought back to its own line.
  const back = run(start, [point('down', TITLE, 0), point('move', TITLE, 2), point('move', TITLE, 0), point('up', TITLE, 0)])
  expect(back.posts).toEqual([])
  expect(back.state.drag).toBe(null)

  // A row can never land inside itself: its subtree is not among the rows a drop is measured against.
  const into = run(start, [point('down', TITLE, 1), point('move', TITLE + 6, 2), point('up', TITLE + 6, 2)])
  expect(into.posts.at(-1)).toEqual({ kind: 'move', id: 'n2', to: { index: 2 } })
})

test('while a row is held the others open a gap at the drop place, and none over an invalid one', () => {
  const press = run(start, [point('down', TITLE, 0)]).state
  // Not a drag until the pointer leaves the row.
  expect(press.drag).toMatchObject({ id: 'n1', active: false })
  expect(shown(press)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', ADD_ROW_ID])
  expect(run(press, [point('move', TITLE + 4, 0)]).state.drag?.active).toBe(false)

  const at = (y: number, dx = 0) => run(press, [point('move', TITLE + dx, y)]).state
  expect(shown(at(1))).toEqual(['n2', '[n1]', 'n3', 'n4', 'n5', ADD_ROW_ID])
  expect(shown(at(3))).toEqual(['n2', 'n3', 'n4', '[n1]', 'n5', ADD_ROW_ID])
  expect(shown(at(5))).toEqual(['n2', 'n3', 'n4', 'n5', '[n1]', ADD_ROW_ID])

  // The lifted row is indented for the depth it would land at.
  const rail = (state: CanvasState) => {
    const line = viewCanvas(state, { design, lints: [] }).layout.lines.find(one => one.kind === 'lifted')
    return line?.kind === 'lifted' ? line.rail : undefined
  }
  expect(rail(at(3))).toBe('')
  expect(rail(at(3, 3))).toBe('│  ├ ')

  // Over the hint line: no gap, the rows as they were, the held row lit in its place.
  const off = viewCanvas(at(8), { design, lints: [] })
  expect(off.dragging).toBe('invalid')
  expect(off.layout.lines.map(line => (line.kind === 'row' ? line.row.id : line.kind))).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', ADD_ROW_ID])
  expect(off.rows.find(row => row.id === 'n1')?.grabbed).toBe(true)
  expect(hintLine(at(8), undefined, off.dragging)).toMatch(/release to cancel/)
  expect(hintLine(at(3), undefined, 'valid')).toMatch(/release to drop/)
})

test('the instance keeps the drag when the pointer leaves; a key or a new selection lets go', () => {
  const held = run(start, [point('down', TITLE, 0), point('move', TITLE, 2)]).state
  expect(run(held, [point('leave', TITLE, 2), point('enter', TITLE, 2)]).state).toBe(held)
  expect(run(held, [point('leave', TITLE, 2), point('move', 200, 3), point('up', 200, 3)]).posts).toEqual([{ kind: 'move', id: 'n1', to: { parentId: 'n2', index: 2 } }])
  expect(run(held, [{ type: 'key', key: 'k' }]).state.drag).toBe(null)
  expect(syncCanvas(held, { design, selectedId: 'n5', rev: 2 }).drag).toBe(null)
  expect(syncCanvas(held, { design: { ...design, nodes: design.nodes.slice(1) }, selectedId: 'n2', rev: 1 }).drag).toBe(null)
  // Moves with no drag, and a press that ends keyboard grab mode.
  expect(run(start, [point('move', 3, 3), point('up', 3, 3)])).toEqual({ state: start, posts: [] })
  expect(run({ ...start, grabbedId: 'n1' }, [point('down', TITLE, 9)]).state.grabbedId).toBe(null)
})

test('rows slide to their new lines and the ticker flag drops when they have arrived', () => {
  const props = { design, lints: [] }
  // First drawing: the lines are recorded, nothing moves.
  let state = moveCanvas(start, viewCanvas(start, props))
  expect(state.motion.ys).toEqual({ n1: 0, n2: 1, n3: 2, n4: 3, n5: 4, [ADD_ROW_ID]: 5 })
  expect(canvasMoving(state)).toBe(false)
  expect(moveCanvas(state, viewCanvas(state, props))).toBe(state)

  // Fold the pipeline: n5 and + add come up two lines.
  state = run(state, [point('down', 0, 1), point('up', 0, 1)]).state
  const view = viewCanvas(state, props)
  state = { ...moveCanvas(state, view), ticking: true }
  expect(canvasMoving(state)).toBe(true)
  expect(lineYs(view.layout.lines)).toEqual({ n1: 0, n2: 1, n5: 2, [ADD_ROW_ID]: 3 })
  const drawn = () => animateLayout(view.layout, state).lines.map(line => (line.kind === 'row' ? line.row.id : line.kind))
  expect(drawn()).toEqual(['n1', 'n2', 'blank', 'blank', 'n5', ADD_ROW_ID])

  let ticks = 0
  while (state.ticking) {
    state = tickCanvas(state)
    ticks += 1
    if (ticks > 20) throw new Error('the tween never ended')
  }
  expect(ticks).toBeLessThanOrEqual(TWEEN_MS / FRAME_MS)
  expect(ticks).toBeGreaterThan(1)
  expect(canvasMoving(state)).toBe(false)
  expect(state.clock).toBe(0)
  expect(state.motion.tweens).toEqual({})
  expect(drawn()).toEqual(['n1', 'n2', 'n5', ADD_ROW_ID])
  // Idle again: another drawing changes nothing, so nothing calls setState.
  expect(moveCanvas(state, viewCanvas(state, props))).toBe(state)
})

test('a keyboard reorder slides the rows it passes; the held row of a pointer drag does not tween', () => {
  const props = { design, lints: [] }
  let state = moveCanvas({ ...start, selectedId: 'n5', grabbedId: 'n5' }, viewCanvas(start, props))
  const moved = moveNode(design, 'n5', { index: 0 }).design
  state = moveCanvas(state, viewCanvas(state, { design: moved, lints: [] }))
  expect(state.motion.tweens.n5?.from).toBe(4)
  expect(state.motion.tweens.n1?.from).toBe(-1)
  expect(canvasMoving(state)).toBe(true)

  let held = moveCanvas(start, viewCanvas(start, props))
  held = run(held, [point('down', TITLE, 0), point('move', TITLE, 3)]).state
  held = moveCanvas(held, viewCanvas(held, props))
  expect(held.motion.tweens.n1).toBe(undefined)
  expect(held.motion.tweens.n2?.from).toBe(1)
  expect(held.motion.tweens.n5).toBe(undefined)
})
