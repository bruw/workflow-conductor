import { expect, test } from 'claude-code/testing'

import { flatten } from '../src/design/model'
import type { Design } from '../src/design/model'
import { AGENT_ROWS_MAX, LOCK_NOTICE, agentTitle, agentsOf, applyMessage, applyOp, boardProps, boardView, initialUi, inspectorCollapsed, inspectorNoteRows, inspectorNotes, inspectorSummary, inspectorTyping, overlaysDesign, patchNode, pickBlock, runOverlay, wrapRows } from '../src/design/session'
import type { DesignUi } from '../src/design/session'
import { review } from '../src/design/templates'
import type { RunEvent, RunState } from '../src/run/events'
import { reduceAll } from '../src/run/reducer'
import { UNMAPPED_ID, expandRows, layoutBoard } from '../src/ui/board-layout'

// Review template: n1 agent, n2 pipeline [n3 agent, n4 verify], n5 agent.
const design = review()
const KNOWN = new Set(['n1', 'n2', 'n3', 'n4', 'n5'])
const RUN_ID = 'wf_1'

const start = (agentId: string, label: string): RunEvent => ({ kind: 'agent-start', runId: RUN_ID, agentId, label })
const end = (agentId: string, tokens: number, ok = true): RunEvent => ({ kind: 'agent-end', agentId, ok, tokens })

// n1: two done. n3: one done, one failed, one running. n4: one running. n5: nothing yet.
// Two agents no node claims: a plain label, and an id the design does not hold.
const PARTIAL: RunEvent[] = [
  { kind: 'run-start', runId: RUN_ID, name: 'review' },
  start('a1', 'n1: scout a'),
  start('a2', 'n1: scout b'),
  end('a1', 1000),
  end('a2', 2000),
  start('b1', 'n3: review bugs'),
  start('b2', 'n3: review perf'),
  start('b3', 'n3: review tests'),
  end('b1', 4100),
  end('b2', 300, false),
  { kind: 'agent-usage', agentId: 'b3', tokens: 500 },
  start('c1', 'n4: refute #1'),
  start('x1', 'fix lint'),
  start('x2', 'n99: stray check'),
  end('x1', 700),
]

const ui = (more: Partial<DesignUi> = {}): DesignUi => ({ ...initialUi(), name: design.name, status: 'ready', selectedId: 'n1', ...more })
const ids = (one: Design | null): string[] => flatten(one ?? design).map(row => `${'  '.repeat(row.depth)}${row.node.id}`)

test('the arrows move the selection as the board is drawn; with a block grabbed they move the block', () => {
  const go = (held: DesignUi, op: 'left' | 'right' | 'up' | 'down', orientation: 'horizontal' | 'vertical' = 'horizontal') => applyOp(design, held, op, { orientation })
  expect(go(ui(), 'right').ui.selectedId).toBe('n2')
  expect(go(ui({ selectedId: 'n2' }), 'down').ui.selectedId).toBe('n3')
  expect(go(ui({ selectedId: 'n3' }), 'up').ui.selectedId).toBe('n2')
  expect(go(ui(), 'down', 'vertical').ui.selectedId).toBe('n2')
  expect(go(ui({ selectedId: null }), 'right').ui.selectedId).toBe('n1')
  // No orientation given: horizontal.
  expect(applyOp(design, ui(), 'right').ui.selectedId).toBe('n2')
  // A move of the selection forgets a pending delete question and any notice.
  expect(go(ui({ selectedId: 'n2', confirmId: 'n2', notice: 'x' }), 'right').ui).toMatchObject({ selectedId: 'n5', confirmId: null, notice: null })

  const grabbed = applyOp(design, ui(), 'grab')
  expect(grabbed.ui.grabbedId).toBe('n1')
  const stepped = go(grabbed.ui, 'right')
  expect(ids(stepped.design)).toEqual(['n2', '  n1', '  n3', '  n4', 'n5'])
  expect(stepped).toMatchObject({ changed: true, ui: { selectedId: 'n1', grabbedId: 'n1' } })
  const back = applyOp(stepped.design, stepped.ui, 'up', { orientation: 'horizontal' })
  expect(ids(back.design)).toEqual(['n1', 'n2', '  n3', '  n4', 'n5'])
  expect(applyOp(back.design, back.ui, 'grab').ui.grabbedId).toBe(null)
  expect(applyOp(design, ui({ selectedId: null }), 'grab').ui.notice).toBe('grab: select a block first')
})

test('messages from the board: select, drop, + and the two words on a card', () => {
  expect(applyMessage(design, ui(), { kind: 'select', id: 'n4' }).ui.selectedId).toBe('n4')
  expect(applyMessage(design, ui(), { kind: 'select', id: 'n99' }).ui.selectedId).toBe(null)
  expect(applyMessage(design, ui(), { kind: 'select', id: UNMAPPED_ID }).ui.selectedId).toBe(null)

  const dropped = applyMessage(design, ui({ selectedId: 'n5' }), { kind: 'move', id: 'n5', to: { parentId: 'n2', index: 1 } })
  expect(ids(dropped.design)).toEqual(['n1', 'n2', '  n3', '  n5', '  n4'])
  expect(dropped).toMatchObject({ changed: true, ui: { selectedId: 'n5', notice: null } })
  const refused = applyMessage(design, ui(), { kind: 'move', id: 'n2', to: { parentId: 'n3', index: 0 } })
  expect(refused).toMatchObject({ changed: false, design })
  expect(refused.ui.notice).toMatch(/descendant|cannot hold/)

  // A + opens the picker for its place; the block picked lands there and is selected.
  const asked = applyMessage(design, ui({ grabbedId: 'n1' }), { kind: 'addAt', at: { parentId: 'n2', index: 1 } })
  expect(asked).toMatchObject({ changed: false, ui: { picker: { at: { parentId: 'n2', index: 1 }, query: '' }, grabbedId: null } })
  const added = pickBlock(design, asked.ui, { type: 'critic' })
  expect(ids(added.design)).toEqual(['n1', 'n2', '  n3', '  n6', '  n4', 'n5'])
  expect(added.ui).toMatchObject({ selectedId: 'n6', picker: null })
  expect(pickBlock(design, asked.ui, { query: 'zzzz' }).ui.notice).toBe('no block matches that')
  expect(applyMessage(design, ui(), { kind: 'addAt', at: { parentId: 'n1', index: 0 } }).ui).toMatchObject({ picker: null, notice: 'n1 holds no blocks' })

  expect(applyMessage(design, ui(), { kind: 'edit', id: 'n3' }).ui.selectedId).toBe('n3')
  // del on a leaf removes it and selects what takes its place.
  const gone = applyMessage(design, ui(), { kind: 'remove', id: 'n1' })
  expect(ids(gone.design)).toEqual(['n2', '  n3', '  n4', 'n5'])
  expect(gone.ui.selectedId).toBe('n2')
  expect(applyMessage(design, ui(), { kind: 'remove', id: 'n99' }).ui.notice).toBe('no node n99')
  // A key message is the toolbar's op, with the board's orientation.
  expect(applyMessage(design, ui(), { kind: 'key', op: 'down', orientation: 'vertical' }).ui.selectedId).toBe('n2')
  expect(applyMessage(design, ui(), { kind: 'key', op: 'card', orientation: 'horizontal' }).ui.showCard).toBe(true)
  // Nothing loaded: nothing happens.
  expect(applyMessage(null, ui(), { kind: 'select', id: 'n1' })).toMatchObject({ design: null, changed: false })
})

test('a container that holds blocks is deleted only on the second ask, from the card or the toolbar', () => {
  const first = applyMessage(design, ui(), { kind: 'remove', id: 'n2' })
  expect(first).toMatchObject({ changed: false, design, ui: { selectedId: 'n2', confirmId: 'n2' } })
  expect(first.ui.notice).toBe('n2 holds 2 blocks: delete again removes them all (no undo)')
  const second = applyMessage(design, first.ui, { kind: 'remove', id: 'n2' })
  expect(ids(second.design)).toEqual(['n1', 'n5'])
  expect(second.ui).toMatchObject({ selectedId: 'n5', confirmId: null, notice: null })
  // The toolbar's key and the card's word are the same two asks.
  expect(ids(applyOp(design, first.ui, 'remove').design)).toEqual(['n1', 'n5'])
  // Selecting anything, or asking about another card, forgets the question.
  expect(applyMessage(design, first.ui, { kind: 'select', id: 'n2' }).ui.confirmId).toBe(null)
  expect(applyMessage(design, first.ui, { kind: 'remove', id: 'n1' }).ui.confirmId).toBe(null)
  // An empty container goes at once.
  const hollow: Design = { ...design, nodes: [{ id: 'n1', type: 'pipeline', title: 'p', children: [] }] }
  expect(applyMessage(hollow, ui(), { kind: 'remove', id: 'n1' }).design?.nodes).toEqual([])
})

test('the overlay hands the board every count and the sum of what no block claims', () => {
  const state = reduceAll(PARTIAL, KNOWN)
  const overlay = runOverlay(state, 192)
  expect(overlay).toMatchObject({ status: 'running', now: 192, byNode: { n1: { total: 2, done: 2 }, n3: { total: 3, running: 1, failed: 1 }, n4: { total: 1 } } })
  expect(overlay.unmapped).toEqual({ total: 2, running: 1, done: 1, failed: 0, tokens: 700 })
  expect(runOverlay(reduceAll(PARTIAL.slice(0, 5), KNOWN)).unmapped).toBe(null)
  // The agents themselves stay out of the board's props.
  expect(JSON.stringify(overlay)).not.toMatch(/scout a/)

  expect(overlaysDesign(state, design.name, ui())).toBe(true)
  expect(overlaysDesign(state, 'other', ui())).toBe(false)
  expect(overlaysDesign(state, null, ui())).toBe(false)

  const props = boardProps(design, ui({ grabbedId: 'n1', confirmId: 'n2', picker: { at: { index: 1 }, query: '' } }), { orientation: 'horizontal', columns: 100, rows: 9, room: 11 }, overlay)
  // Running: locked, and nothing held is drawn.
  expect(props).toMatchObject({ mode: 'run', grabbedId: null, confirmId: null, pickerAt: null, orientation: 'horizontal', columns: 100, rows: 9, room: 11, compact: false, selectedId: 'n1' })
  const free = boardProps(design, ui({ grabbedId: 'n1', picker: { at: { index: 1 }, query: '' } }), { orientation: 'vertical', columns: 60, rows: 30, room: 30 })
  expect(free).toMatchObject({ mode: 'design', grabbedId: 'n1', pickerAt: { index: 1 }, orientation: 'vertical' })
  expect('run' in free).toBe(false)
  expect(free.lints.every(one => KNOWN.has(one.nodeId))).toBe(true)
})

test('the inspector lists a block’s agents, failures first, without the id prefix; the rest are a count', () => {
  const state = reduceAll(PARTIAL, KNOWN)
  expect(agentsOf(state, 'n3').shown.map(agent => `${agent.status} ${agent.title}`)).toEqual(['failed review perf', 'running review tests', 'done review bugs'])
  expect(agentsOf(state, 'n3').rest).toBe(0)
  expect(agentsOf(state, 'n5')).toEqual({ shown: [], rest: 0 })
  expect(agentsOf(state, UNMAPPED_ID).shown.map(agent => agent.title)).toEqual(['n99: stray check', 'fix lint'])
  expect(agentTitle({ label: 'n3: verify auth', agentId: 'a', nodeId: 'n3' })).toBe('verify auth')
  expect(agentTitle({ label: 'n3:', agentId: 'a9', nodeId: 'n3' })).toBe('a9')

  const many: RunEvent[] = [{ kind: 'run-start', runId: RUN_ID }, ...Array.from({ length: 30 }, (_, at) => start(`m${at}`, `n1: item ${at}`))]
  const long = agentsOf(reduceAll(many, KNOWN), 'n1')
  expect(long.shown).toHaveLength(AGENT_ROWS_MAX)
  expect(long.rest).toBe(30 - AGENT_ROWS_MAX)
  // The agents no block claims can be selected while there are some.
  expect(applyMessage(design, ui(), { kind: 'select', id: UNMAPPED_ID }, { run: state }).ui.selectedId).toBe(UNMAPPED_ID)
})

test('while a run is in progress every edit is refused with one notice; selection still works', () => {
  const state: RunState = reduceAll(PARTIAL, KNOWN)
  const context = { run: state, locked: true, orientation: 'horizontal' as const }
  for (const message of [
    { kind: 'move', id: 'n1', to: { index: 2 } },
    { kind: 'addAt', at: { index: 0 } },
    { kind: 'remove', id: 'n1' },
    { kind: 'edit', id: 'n1' },
  ] as const) {
    const step = applyMessage(design, ui({ grabbedId: 'n1' }), message, context)
    expect(step).toMatchObject({ design, changed: false, ui: { notice: LOCK_NOTICE, grabbedId: null, picker: null } })
  }
  for (const op of ['grab', 'addAfter', 'addInside', 'remove', 'edit'] as const) {
    expect(applyOp(design, ui(), op, context)).toMatchObject({ design, changed: false, ui: { notice: LOCK_NOTICE, grabbedId: null, picker: null, confirmId: null } })
    expect(applyMessage(design, ui(), { kind: 'key', op, orientation: 'horizontal' }, context).ui.notice).toBe(LOCK_NOTICE)
  }
  expect(patchNode(design, ui(), 'n1', { title: 'x' }, context)).toMatchObject({ design, changed: false, ui: { notice: LOCK_NOTICE } })
  expect(pickBlock(design, ui({ picker: { at: { index: 0 }, query: '' } }), { type: 'agent' }, context).ui).toMatchObject({ picker: null, notice: LOCK_NOTICE })
  // Selection, by pointer and by key, and the card.
  expect(applyMessage(design, ui(), { kind: 'select', id: 'n3' }, context).ui).toMatchObject({ selectedId: 'n3', notice: null })
  expect(applyOp(design, ui({ grabbedId: 'n1' }), 'right', context)).toMatchObject({ changed: false, ui: { selectedId: 'n2', grabbedId: null } })
  expect(applyOp(design, ui(), 'card', context).ui.showCard).toBe(true)
  // Over: the same edit goes through.
  expect(applyMessage(design, ui(), { kind: 'remove', id: 'n1' }, { run: { ...state, status: 'done' }, locked: false }).changed).toBe(true)
})

test('the board is sized for the pane: sideways inline, upright in a dock, never taller than the room', () => {
  const inline = boardView(design, 'inline', 120, 20)
  expect(inline).toEqual({ orientation: 'horizontal', columns: 120, rows: layoutBoard(design, { orientation: 'horizontal' }).height, room: 20 })
  const dock = boardView(design, 'dock', 70, 40)
  expect(dock).toEqual({ orientation: 'vertical', columns: 70, rows: layoutBoard(design, { orientation: 'vertical', width: 70 }).height, room: 40 })
  // Less room than board: the region stops at the room and the board pans inside it.
  expect(boardView(design, 'dock', 70, 12).rows).toBe(12)
  // Never fewer rows than a card and the row to add under it.
  expect(boardView(design, 'inline', 120, 2).rows).toBe(5)
  // A run adds the unmapped card: the same call sizes it.
  const overlay = runOverlay(reduceAll(PARTIAL, KNOWN))
  expect(boardView(design, 'dock', 70, 80, { run: overlay }).rows).toBe(layoutBoard(design, { orientation: 'vertical', run: true, unmapped: 2, width: 70 }).height)
  // The selected card is taller, compact mode shorter: the region follows both.
  const picked = boardView(design, 'dock', 70, 80, { selectedId: 'n4' })
  expect(picked.rows).toBe(layoutBoard(design, { orientation: 'vertical', width: 70, selectedId: 'n4', noteRows: expandRows('vertical', 80) }).height)
  expect(picked.rows).toBeGreaterThan(dock.rows)
  expect(boardView(design, 'dock', 70, 80, { compact: true }).rows).toBeLessThan(dock.rows / 2)
  // Selecting a block never turns the board.
  expect(boardView(design, 'inline', 120, 11, { selectedId: 'n4' }).orientation).toBe('horizontal')
  expect(boardView(design, 'inline', 120, 11).rows).toBeLessThanOrEqual(11)
})

test('compact, editing and run are ops like the rest; editing ends with the field, the selection or any other key', () => {
  expect(applyOp(design, ui(), 'compact').ui.compact).toBe(true)
  expect(applyOp(design, ui({ compact: true }), 'compact')).toMatchObject({ changed: false, ui: { compact: false, selectedId: 'n1' } })
  expect(boardProps(design, ui({ compact: true }), { orientation: 'vertical', columns: 60, rows: 30, room: 30 }).compact).toBe(true)
  // Compact is a way of looking: a run in progress does not lock it.
  expect(applyOp(design, ui(), 'compact', { locked: true }).ui).toMatchObject({ compact: true, notice: null })
  // run changes nothing here: the hooks module fills the prompt.
  expect(applyOp(design, ui(), 'run')).toEqual({ design, ui: ui(), changed: false })

  const editing = applyOp(design, ui(), 'edit').ui
  expect(editing.editing).toBe(true)
  expect(applyOp(design, ui({ selectedId: null }), 'edit').ui).toMatchObject({ editing: false, notice: 'edit: select a block first' })
  expect(applyOp(design, ui(), 'edit', { locked: true }).ui).toMatchObject({ editing: false, notice: LOCK_NOTICE })
  expect(applyMessage(design, ui(), { kind: 'edit', id: 'n4' }).ui).toMatchObject({ editing: true, selectedId: 'n4' })
  expect(applyMessage(design, ui(), { kind: 'key', op: 'edit', orientation: 'vertical' }).ui.editing).toBe(true)
  // Over: the field was sent, another block was picked, or any other key came.
  expect(patchNode(design, editing, 'n1', { notes: 'x' }).ui.editing).toBe(false)
  expect(applyMessage(design, editing, { kind: 'select', id: 'n4' }).ui.editing).toBe(false)
  expect(applyMessage(design, editing, { kind: 'select', id: 'n1' }).ui.editing).toBe(true)
  expect(applyOp(design, editing, 'down').ui.editing).toBe(false)
  expect(applyOp(design, editing, 'cancel').ui.editing).toBe(false)
})

test('the inspector: notes wrapped under their field, bounded; one line when the pane is inline', () => {
  const notes = 'Asks what is missing: an angle not searched, a claim unverified, a source unread. Gaps become one more round of reading.'
  // Short enough for the field's own line: nothing more to show.
  expect(inspectorNotes('One reader per source.', 80, 45)).toEqual({ lines: [], more: 0 })
  expect(inspectorNotes('', 80, 45)).toEqual({ lines: [], more: 0 })
  const wrapped = inspectorNotes(notes, 60, 45)
  expect(wrapped).toEqual({ lines: ['Asks what is missing: an angle not searched, a claim', 'unverified, a source unread. Gaps become one more round of', 'reading.'], more: 0 })
  for (const line of wrapped.lines) expect(line.length).toBeLessThanOrEqual(58)
  // Bounded by the pane's rows, so the board keeps most of them.
  expect([inspectorNoteRows(45), inspectorNoteRows(24), inspectorNoteRows(8), inspectorNoteRows(200)]).toEqual([7, 4, 2, 8])
  const long = inspectorNotes('word '.repeat(200), 40, 24)
  expect(long.lines).toHaveLength(3)
  expect(long.more).toBe(Math.ceil(200 / 7) - 3)
  // Inline: collapsed to a line until a field is being typed in; a dock never collapses.
  expect(inspectorCollapsed('inline', ui())).toBe(true)
  expect(inspectorCollapsed('inline', ui({ editing: true }))).toBe(false)
  expect(inspectorCollapsed('dock', ui())).toBe(false)
  expect(inspectorSummary({ id: 'n7', type: 'critic', title: 'completeness critic', notes }, 70)).toBe('n7 · critic · completeness critic — Asks what is missing: an angle no…')
  expect(inspectorSummary({ id: 'n7', type: 'critic', title: 'gaps' }, 70)).toBe('n7 · critic · gaps')
  // A field with the ring wraps its own text: the board gives up the rows the notes fill and two more to type into, within the same bound.
  expect(inspectorTyping('', 80, 45)).toBe(2)
  expect(inspectorTyping(notes, 80, 45)).toBe(3)
  expect(inspectorTyping('word '.repeat(200), 80, 45)).toBe(7)
  // The key row and the picker's row of types wrap in a narrow pane: their rows are counted, not guessed.
  expect(wrapRows([4, 4, 4], 1, 14)).toBe(1)
  expect(wrapRows([4, 4, 4], 1, 13)).toBe(2)
  expect(wrapRows([4, 4, 4], 1, 4)).toBe(3)
  expect(wrapRows([], 1, 10)).toBe(1)
})
