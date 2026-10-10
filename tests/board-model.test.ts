import { expect, test } from 'claude-code/testing'

import type { Design } from '../src/design/model'
import { review } from '../src/design/templates'
import { layoutBoard } from '../src/ui/board-layout'
import type { BoardCard, BoardLayout } from '../src/ui/board-layout'
import { DRAG_SCROLL_MS, boardMoving, boardOffsets, BOARD_OPS, KEY_OPS, LEGEND, boardLayout, boardReduce, boardTicking, dragHint, dragScroll, dragTarget, dragging, initialBoard, moveBoard, parseBoardMessage, reveal, revealPadded, syncBoard, tickBoard } from '../src/ui/board-model'
import type { BoardContext, BoardInput, BoardMessage, BoardState } from '../src/ui/board-model'
import { affordances } from '../src/ui/board-paint'
import { FRAME_MS, TWEEN_MS } from '../src/ui/tween'

// Review template: n1 agent, n2 pipeline [n3 agent, n4 verify], n5 agent.
const design = review()
const H = layoutBoard(design, { orientation: 'horizontal' })
const card = (id: string, layout: BoardLayout = H): BoardCard => {
  const found = layout.cards.find(one => one.id === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}
const context = (more: Partial<BoardContext> = {}): BoardContext => ({ layout: H, columns: H.width, rows: H.height, selectedId: 'n1', ...more })
const ready = (ctx: BoardContext = context()): BoardState => syncBoard(initialBoard(), ctx)

// Runs inputs in order; returns the final state and every message posted.
const run = (inputs: BoardInput[], ctx: BoardContext = context(), from: BoardState = ready(ctx)): { state: BoardState; posts: BoardMessage[] } => {
  let state = from
  const posts: BoardMessage[] = []
  for (const input of inputs) {
    const result = boardReduce(state, input, ctx)
    state = result.state
    if (result.post) posts.push(result.post)
  }
  return { state, posts }
}
const down = (x: number, y: number): BoardInput => ({ type: 'pointer', event: 'down', x, y })
const move = (x: number, y: number): BoardInput => ({ type: 'pointer', event: 'move', x, y })
const up = (x: number, y: number): BoardInput => ({ type: 'pointer', event: 'up', x, y })
const key = (name: string, more: { ctrl?: true } = {}): BoardInput => ({ type: 'key', key: name, ...more })

test('a click on a card selects it, once; the innermost card under the pointer wins', () => {
  const n3 = card('n3')
  expect(run([down(n3.x + 3, n3.y + 1), up(n3.x + 3, n3.y + 1)]).posts).toEqual([{ kind: 'select', id: 'n3' }])
  // The pipeline's own border and header select the pipeline.
  expect(run([down(card('n2').x + 4, 0), up(card('n2').x + 4, 0)]).posts).toEqual([{ kind: 'select', id: 'n2' }])
  // The card already selected posts nothing, and a click is not a drag.
  const again = run([down(2, 1), up(2, 1)])
  expect(again.posts).toEqual([])
  expect(again.state.drag).toBe(null)
  // Outside the window nothing is pressed.
  expect(run([down(2, H.height), up(2, H.height)]).posts).toEqual([])
})

test('a click on a + asks for the picker at that place, in a container too', () => {
  const n1 = card('n1')
  const n3 = card('n3')
  expect(run([down(n1.w + 1, 2)]).posts).toEqual([{ kind: 'addAt', at: { index: 1 } }])
  expect(run([down(n1.w, 2)]).posts).toEqual([{ kind: 'addAt', at: { index: 1 } }])
  expect(run([down(n3.x + n3.w + 1, n3.y + 2)]).posts).toEqual([{ kind: 'addAt', at: { parentId: 'n2', index: 1 } }])
  const end = H.slots.find(slot => slot.place.parentId === undefined && slot.place.index === 3)
  expect(run([down(end?.mark?.x ?? -1, end?.mark?.y ?? -1)]).posts).toEqual([{ kind: 'addAt', at: { index: 3 } }])
  // Locked: a + is not there to press.
  expect(run([down(n1.w + 1, 2)], context({ locked: true })).posts).toEqual([])
})

test('the selected card’s edit and del are pressed where they are drawn', () => {
  const [edit, del] = affordances(card('n1'))
  expect(run([down((edit?.x ?? 0) + 1, edit?.y ?? 0)]).posts).toEqual([{ kind: 'edit', id: 'n1' }])
  expect(run([down((del?.x ?? 0) + 1, del?.y ?? 0)]).posts).toEqual([{ kind: 'remove', id: 'n1' }])
  // On a card that is not selected the same cells only select it.
  const other = affordances(card('n5'))[1]
  expect(run([down((other?.x ?? 0) + 1, other?.y ?? 0)]).posts).toEqual([{ kind: 'select', id: 'n5' }])
  expect(run([down((del?.x ?? 0) + 1, del?.y ?? 0)], context({ locked: true })).posts).toEqual([])
})

test('dragging a card to a slot posts one move; nothing moves before the release', () => {
  const n5 = card('n5')
  const n1 = card('n1')
  // n5 into the gap after n1.
  const held = run([down(n5.x + 3, 1), move(n5.x - 6, 1), move(n1.w + 1, 1)])
  expect(held.posts).toEqual([{ kind: 'select', id: 'n5' }])
  expect(dragging(held.state)).toBe('n5')
  expect(dragTarget(held.state, context())?.to).toEqual({ index: 1 })
  expect(dragHint(held.state, context())).toBe('drop here')
  const dropped = run([up(n1.w + 1, 1)], context(), held.state)
  expect(dropped.posts).toEqual([{ kind: 'move', id: 'n5', to: { index: 1 } }])
  expect(dropped.state.drag).toBe(null)
})

test('a card is dragged into a container and out of one', () => {
  const n4 = card('n4')
  const n5 = card('n5')
  const into = run([down(2, 1), move(n4.x - 2, n4.y + 1)])
  expect(dragHint(into.state, context())).toBe('drop into n2')
  expect(run([up(n4.x - 2, n4.y + 1)], context(), into.state).posts).toEqual([{ kind: 'move', id: 'n1', to: { parentId: 'n2', index: 1 } }])
  const out = run([down(n4.x + 3, n4.y + 1), move(n5.x + n5.w + 1, 1), up(n5.x + n5.w + 1, 1)])
  expect(out.posts).toEqual([
    { kind: 'select', id: 'n4' },
    { kind: 'move', id: 'n4', to: { index: 3 } },
  ])
})

test('a drop outside any slot cancels: far from one, off the board, or back where the card was', () => {
  const far = run([down(2, 1), move(4, 5)], context({ rows: H.height + 20, layout: { ...H, height: H.height + 20 } }))
  const lost = run([move(4, H.height + 12)], context({ rows: H.height + 20 }), far.state)
  expect(dragHint(lost.state, context({ rows: H.height + 20 }))).toBe('no slot here: release cancels')
  expect(run([up(4, H.height + 12)], context({ rows: H.height + 20 }), lost.state).posts).toEqual([])
  // Past the window's edge: the instance still gets the moves, the drop cancels.
  expect(run([down(2, 1), move(30, -3), up(30, -3)]).posts).toEqual([])
  // Next to itself.
  const home = run([down(2, 1), move(card('n1').w + 1, 1)])
  expect(dragHint(home.state, context())).toBe('already here')
  expect(dragHint(ready(), context())).toBe('')
  expect(run([up(card('n1').w + 1, 1)], context(), home.state).posts).toEqual([])
  // A key lets go of the card; enter and leave change nothing.
  const held = run([down(2, 1), move(40, 1), { type: 'pointer', event: 'leave', x: 40, y: 1 }])
  expect(dragging(held.state)).toBe('n1')
  expect(run([key('q')], context(), held.state).state.drag).toBe(null)
})

test('locked: a press selects and pans, and never lifts a card', () => {
  const ctx = context({ locked: true, columns: 40 })
  const n3 = card('n3')
  const pressed = run([down(n3.x + 3, n3.y + 1), move(n3.x - 5, n3.y + 1)], ctx)
  expect(pressed.posts).toEqual([{ kind: 'select', id: 'n3' }])
  expect(dragging(pressed.state)).toBe(null)
  expect(pressed.state.panX).toBe(8)
  // A run that starts takes a held card out of the hand.
  const held = run([down(2, 1), move(30, 1)])
  expect(syncBoard(held.state, context({ locked: true })).drag).toBe(null)
})

test('the background pans a board larger than its window, and stops at the board’s edges', () => {
  const ctx = context({ columns: 40, rows: 4 })
  const from = ready(ctx)
  expect([from.panX, from.panY]).toEqual([0, 0])
  // The empty cell under n1 is background.
  const panned = run([down(5, 4), move(5, 4)], context({ columns: 40, rows: 6 }))
  expect(panned.posts).toEqual([])
  const dragged = run([down(18, 0), move(8, 0)], ctx, from)
  expect(dragged.state.panX).toBe(10)
  expect(run([move(-500, -500)], ctx, dragged.state).state).toMatchObject({ panX: H.width - 40, panY: H.height - 4 })
  expect(run([move(500, 500), up(500, 500)], ctx, dragged.state).state).toMatchObject({ panX: 0, panY: 0, drag: null })
  // What the marks mean is said in the help card, not on the board.
  expect(LEGEND.join('\n')).toMatch(/│ ─▶ {2}hands each result on[\s\S]*║ ═▶ {2}waits for all[\s\S]*\+ adds a block[\s\S]*drag a card/)
})

test('the pan follows the selection, as little as it must, and leaves a hand-made pan alone', () => {
  expect(reveal(0, 10, 5, 20)).toBe(0)
  expect(reveal(0, 30, 5, 20)).toBe(15)
  expect(reveal(40, 30, 5, 20)).toBe(30)
  expect(reveal(0, 30, 50, 20)).toBe(30)
  const n5 = card('n5')
  const ctx = context({ columns: 40, rows: 4, selectedId: 'n5' })
  const shown = syncBoard(initialBoard(), ctx)
  // A cell to spare past the card, where the board goes on.
  expect(shown.panX).toBe(n5.x + n5.w + 1 - 40)
  // Nothing new to follow: the very same state comes back.
  expect(syncBoard(shown, ctx)).toBe(shown)
  // The person pans away: the selection has not changed, so the pan stays.
  // Column 22 of the window is the gap between n2 and n5: background.
  const away = run([down(22, 0), move(42, 0), up(42, 0)], ctx, shown)
  expect(away.state.panX).toBe(shown.panX - 20)
  expect(syncBoard(away.state, ctx)).toBe(away.state)
  // The selected card moves (a drop): it is followed again.
  const moved: Design = { ...design, nodes: [design.nodes[2], design.nodes[0], design.nodes[1]].filter(one => one !== undefined) }
  expect(syncBoard(away.state, { ...ctx, layout: layoutBoard(moved, { orientation: 'horizontal' }) }).panX).toBe(0)
  // A window grown past the board pulls the pan back in.
  expect(syncBoard(shown, context({ selectedId: 'n5' })).panX).toBe(0)
})

test('keys become ops, with the orientation the arrows are meant in', () => {
  const ops = (name: string) => run([key(name)]).posts.map(post => (post.kind === 'key' ? post.op : post.kind))
  expect(['left', 'h', 'right', 'l', 'up', 'k', 'down', 'j'].flatMap(ops)).toEqual(['left', 'left', 'right', 'right', 'up', 'up', 'down', 'down'])
  // The toolbar's letters, letter for letter; Enter is edit, where the toolbar's ring rests.
  expect(['a', 'i', 'x', 'g', 'e', 'z', 'c', 'r', 'return'].flatMap(ops)).toEqual(['addAfter', 'addInside', 'remove', 'grab', 'edit', 'compact', 'card', 'run', 'edit'])
  expect(ops('escape')).toEqual(['cancel'])
  // Keys the toolbar has no Button for do nothing on the board either.
  expect(['q', 'tab', 'Z', ' ', 'space', 'delete', '?'].flatMap(ops)).toEqual([])
  expect(run([key('x', { ctrl: true })]).posts).toEqual([])
  expect(Object.values(KEY_OPS).every(op => BOARD_OPS.includes(op))).toBe(true)
  expect(run([key('down')])).toMatchObject({ posts: [{ kind: 'key', op: 'down', orientation: 'horizontal' }] })
  const V = layoutBoard(design, { orientation: 'vertical' })
  expect(run([key('down')], context({ layout: V })).posts).toEqual([{ kind: 'key', op: 'down', orientation: 'vertical' }])
})

test('the pointer over a hidden + shows it: the hover is kept until the pointer leaves it', () => {
  const V = layoutBoard(design, { orientation: 'vertical', width: 60 })
  const ctx = context({ layout: V, columns: 60, rows: V.height, selectedId: 'n5' })
  const gap = V.slots.find(slot => slot.place.parentId === 'n2' && slot.place.index === 1)
  const at = gap?.mark ?? { x: -1, y: -1, label: '' }
  const over = run([move(at.x, at.y)], ctx)
  expect(over.state.hover).toEqual({ parentId: 'n2', index: 1 })
  expect(over.posts).toEqual([])
  // Another move on the same slot changes nothing: the very same state, so nothing is redrawn.
  const start = over.state
  expect(boardReduce(start, move(at.x + 1, at.y), ctx).state).toBe(start)
  // Off it, or out of the region: gone.
  expect(run([move(at.x + 9, at.y)], ctx, start).state.hover).toBe(null)
  expect(run([{ type: 'pointer', event: 'leave', x: at.x, y: at.y }], ctx, start).state.hover).toBe(null)
  // A click there opens the picker for that place, shown or not.
  expect(run([down(at.x, at.y)], ctx, start)).toMatchObject({ posts: [{ kind: 'addAt', at: { parentId: 'n2', index: 1 } }], state: { hover: null } })
  expect(run([down(at.x, at.y)], ctx).posts).toEqual([{ kind: 'addAt', at: { parentId: 'n2', index: 1 } }])
  // Locked, nothing hovers; a slot that is gone lets go of its hover.
  expect(run([move(at.x, at.y)], { ...ctx, locked: true }).state.hover).toBe(null)
  expect(syncBoard(start, { ...ctx, locked: true }).hover).toBe(null)
  expect(syncBoard({ ...start, hover: { parentId: 'gone', index: 0 } }, ctx).hover).toBe(null)
  expect(syncBoard(start, ctx).hover).toEqual({ parentId: 'n2', index: 1 })
})

test('the selected card grows over a few frames, what is under it slides, and the window keeps all of it in view', () => {
  const props = { design, orientation: 'vertical' as const, columns: 60, room: 14, compact: false }
  const before = boardLayout({ ...props, selectedId: 'n1' })
  const after = boardLayout({ ...props, selectedId: 'n4' })
  const [was, now] = [card('n4', before), card('n4', after)]
  expect(now.h).toBeGreaterThan(was.h)
  // The window follows the selection with a row to spare above and below, for the words on its edges.
  const ctx = (layout: BoardLayout, selectedId: string): BoardContext => ({ layout, columns: 60, rows: 14, selectedId })
  let state = moveBoard(syncBoard(initialBoard(), ctx(before, 'n1')), before)
  expect(state.panY).toBe(0)
  state = syncBoard(state, ctx(after, 'n4'))
  expect(state.panY).toBe(now.y + now.h + now.stack + 1 - 14)
  expect(state.panY).toBeLessThanOrEqual(now.y - 1)
  // The card starts at its old height and its old place, and both ease to the new ones.
  state = { ...moveBoard(state, after), ticking: true }
  expect(boardMoving(state)).toBe(true)
  expect(boardOffsets(state).n4).toEqual({ dx: 0, dy: was.y - now.y, dh: was.h - now.h })
  expect(boardOffsets(state).n5).toEqual({ dx: 0, dy: card('n5', before).y - card('n5', after).y, dh: 0 })
  expect(boardOffsets(state).n1?.dh).toBe(card('n1', before).h - card('n1', after).h)
  let frames = 0
  while (state.ticking && frames < 100) {
    state = tickBoard(state, ctx(after, 'n4'))
    frames++
  }
  expect(frames * FRAME_MS).toBeLessThanOrEqual(TWEEN_MS + FRAME_MS)
  expect(boardOffsets(state)).toEqual({})
  expect(moveBoard(state, after)).toBe(state)
  // A card taller than the window with its margins shows its top; one taller than the window, its first row.
  expect(revealPadded(0, 20, 5, 10, 1)).toBe(16)
  expect(revealPadded(30, 20, 5, 10, 1)).toBe(19)
  expect(revealPadded(0, 0, 5, 10, 1)).toBe(0)
  expect(revealPadded(0, 20, 9, 10, 1)).toBe(19)
  expect(revealPadded(0, 20, 12, 10, 1)).toBe(20)
})

test('cards slide to a new place over a few frames, and the ticker flag drops when they have arrived', () => {
  const first = moveBoard(ready(), H)
  // The first drawing records places: nothing slides, nothing ticks.
  expect(boardMoving(first)).toBe(false)
  expect(boardTicking(first, context())).toBe(false)
  expect(moveBoard(first, H)).toBe(first)

  // n5 moved to the front: every top-level card has a new column.
  const swapped: Design = { ...design, nodes: [design.nodes[2], design.nodes[0], design.nodes[1]].filter(one => one !== undefined) }
  const after = layoutBoard(swapped, { orientation: 'horizontal' })
  const ctx = context({ layout: after })
  let state = { ...moveBoard(first, after), ticking: true }
  expect(boardMoving(state)).toBe(true)
  expect(boardTicking(state, ctx)).toBe(true)
  const start = boardOffsets(state)
  expect(start.n5?.dx).toBe(card('n5').x - card('n5', after).x)
  expect(start.n1?.dx).toBe(card('n1').x - card('n1', after).x)
  expect(start.n5?.dy).toBe(0)
  let frames = 0
  let last = Math.abs(start.n5?.dx ?? 0)
  while (state.ticking && frames < 100) {
    state = tickBoard(state, ctx)
    frames++
    const now = Math.abs(boardOffsets(state).n5?.dx ?? 0)
    expect(now).toBeLessThanOrEqual(last)
    last = now
  }
  expect(frames * FRAME_MS).toBeLessThanOrEqual(TWEEN_MS + FRAME_MS)
  expect(state).toMatchObject({ ticking: false, clock: 0 })
  expect(boardOffsets(state)).toEqual({})
  expect(boardTicking(state, ctx)).toBe(false)
  expect(moveBoard(state, after)).toBe(state)
})

test('a card held at the window’s edge pans the board a step per tick interval, as far as there is board', () => {
  const ctx = context({ columns: 40, rows: 4 })
  const held = run([down(2, 1), move(39, 1)], ctx)
  expect(dragScroll(held.state, ctx)).toEqual({ dx: 1, dy: 0 })
  expect(boardTicking(held.state, ctx)).toBe(true)
  let state: BoardState = { ...held.state, ticking: true }
  for (let ms = 0; ms < DRAG_SCROLL_MS; ms += FRAME_MS) state = tickBoard(state, ctx)
  expect(state.panX).toBe(2)
  for (let turn = 0; turn < 2000 && state.ticking; turn++) state = tickBoard(state, ctx)
  // At the board's end there is nothing left to pan: the ticker stops by itself.
  expect(state).toMatchObject({ panX: H.width - 40, ticking: false })
  expect(dragScroll(state, ctx)).toEqual({ dx: 0, dy: 0 })
  // In the middle of the window nothing pans.
  expect(dragScroll(run([down(2, 1), move(20, 1)], ctx).state, ctx)).toEqual({ dx: 0, dy: 0 })
  expect(dragScroll(run([down(2, 1), move(20, 3)], ctx).state, ctx)).toEqual({ dx: 0, dy: 1 })
})

test('posted data is read back as a message, or refused', () => {
  expect(parseBoardMessage({ kind: 'select', id: 'n1' })).toEqual({ kind: 'select', id: 'n1' })
  expect(parseBoardMessage({ kind: 'select', id: null })).toEqual({ kind: 'select', id: null })
  expect(parseBoardMessage({ kind: 'move', id: 'n1', to: { parentId: 'n2', index: 0 } })).toEqual({ kind: 'move', id: 'n1', to: { parentId: 'n2', index: 0 } })
  expect(parseBoardMessage({ kind: 'addAt', at: { index: 2 } })).toEqual({ kind: 'addAt', at: { index: 2 } })
  expect(parseBoardMessage({ kind: 'remove', id: 'n1' })).toEqual({ kind: 'remove', id: 'n1' })
  expect(parseBoardMessage({ kind: 'edit', id: 'n1' })).toEqual({ kind: 'edit', id: 'n1' })
  expect(parseBoardMessage({ kind: 'key', op: 'grab', orientation: 'vertical' })).toEqual({ kind: 'key', op: 'grab', orientation: 'vertical' })
  expect(parseBoardMessage({ kind: 'key', op: 'left' })).toEqual({ kind: 'key', op: 'left', orientation: 'horizontal' })
  expect(parseBoardMessage({ kind: 'key', op: 'compact' })).toEqual({ kind: 'key', op: 'compact', orientation: 'horizontal' })
  expect(parseBoardMessage({ kind: 'key', op: 'run', orientation: 'vertical' })).toEqual({ kind: 'key', op: 'run', orientation: 'vertical' })
  for (const junk of [null, 3, 'select', [], {}, { kind: 'select' }, { kind: 'move', id: 'n1' }, { kind: 'move', id: 'n1', to: { index: -1 } }, { kind: 'addAt', at: { index: 1.5 } }, { kind: 'key', op: 'explode' }, { kind: 'key', op: 'space' }, { kind: 'remove' }, { kind: 'nope', id: 'n1' }]) {
    expect(parseBoardMessage(junk)).toBe(undefined)
  }
})
