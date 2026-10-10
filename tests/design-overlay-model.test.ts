import { expect, test } from 'claude-code/testing'

import { LOCK_NOTICE, applyMessage, applyOp, canvasProps, initialUi, overlaysDesign, patchNode, runOverlay } from '../src/design/session'
import type { DesignUi } from '../src/design/session'
import { review } from '../src/design/templates'
import type { RunEvent, RunState } from '../src/run/events'
import { reduceAll } from '../src/run/reducer'
import { SPINNER, fmtTokens } from '../src/ui/rail'
import { AGENT_ROWS_MAX, NOT_RUN, UNMAPPED_ROW_ID, buildDesignRows, canvasReduce, initialCanvas, runNodeOpen, syncCanvas, viewCanvas } from '../src/ui/canvas-model'
import type { DesignRow, RunOverlay } from '../src/ui/canvas-model'

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

const ui = (more: Partial<DesignUi> = {}): DesignUi => ({ ...initialUi(), name: design.name, status: 'ready', ...more })
const overlayOf = (state: RunState, held: DesignUi = ui(), now = 0): RunOverlay => runOverlay(state, held, now)
const by = (rows: DesignRow[], id: string): DesignRow => {
  const row = rows.find(one => one.id === id)
  if (!row) throw new Error(`no row ${id}`)
  return row
}

test('no overlay: the rows are exactly what they were', async () => {
  const plain = buildDesignRows(design, { selectedId: 'n3', collapsed: [] })
  expect(buildDesignRows(design, { selectedId: 'n3', collapsed: [], run: undefined })).toEqual(plain)
  expect(plain.map(row => row.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', '+'])
  expect(plain.every(row => !('run' in row))).toBe(true)
})

test('a partial run marks each node: counts, tokens, bar, glyph and colour', async () => {
  const state = reduceAll(PARTIAL, KNOWN)
  expect(state.unmapped).toEqual(['x1', 'x2'])
  const rows = buildDesignRows(design, { run: overlayOf(state, ui(), 96 * 3) })

  // All of its agents are done.
  expect(by(rows, 'n1').run).toMatchObject({ glyph: '✓', color: 'success', counts: '2/2', tokens: fmtTokens(3000), note: '' })
  expect(by(rows, 'n1').run?.bar).toBe('██████')
  // The node's own glyph and everything else about the row stay.
  expect(by(rows, 'n1')).toMatchObject({ glyph: '●', title: 'scout diff', typeName: 'agent' })
  // One agent still runs: the spinner frame of the clock, whatever failed beside it.
  expect(by(rows, 'n3').run).toMatchObject({ glyph: SPINNER[3], color: 'claude', counts: '2/3', tokens: fmtTokens(4900) })
  expect(by(rows, 'n4').run).toMatchObject({ glyph: SPINNER[3], color: 'claude', counts: '0/1', tokens: '0', bar: '      ' })
  // The container sums what it holds.
  expect(by(rows, 'n2').run).toMatchObject({ color: 'claude', counts: '2/4', tokens: fmtTokens(4900), open: false })
  // No agent yet: its own glyph, inactive, nothing to count; the run is not over, so no verdict.
  expect(by(rows, 'n5').run).toEqual({ glyph: '●', color: 'inactive', counts: '', tokens: '', bar: '', note: '', open: false })
  expect(by(rows, '+').run).toBe(undefined)
})

test('a failure opens its node; an opened node lists its agents without the id prefix', async () => {
  const state = reduceAll(PARTIAL, KNOWN)
  const closed = buildDesignRows(design, { run: overlayOf(state) })
  // n3 opened by its failure, failures first; n1 stays shut.
  expect(closed.map(row => row.id)).toEqual(['n1', 'n2', 'n3', 'agent:b2', 'agent:b3', 'agent:b1', 'n4', 'n5', UNMAPPED_ROW_ID, '+'])
  expect(by(closed, 'n3').run?.open).toBe(true)
  expect(by(closed, 'agent:b2')).toMatchObject({ kind: 'agent', title: 'review perf', rail: '│  │  ├ ', glyph: '✗', run: { color: 'error', tokens: '300' } })
  expect(by(closed, 'agent:b3')).toMatchObject({ title: 'review tests', run: { color: 'claude', tokens: '500' } })
  expect(by(closed, 'agent:b1')).toMatchObject({ title: 'review bugs', rail: '│  │  ╰ ', glyph: '✓', run: { color: 'success', tokens: '4.1k' } })

  // Opened by hand: n1, a top-level row, hangs its agents off the rail.
  const open = buildDesignRows(design, { run: overlayOf(state, ui({ runUi: { expanded: ['n1'], collapsed: ['n3'] } })) })
  expect(open.map(row => row.id)).toEqual(['n1', 'agent:a1', 'agent:a2', 'n2', 'n3', 'n4', 'n5', UNMAPPED_ROW_ID, '+'])
  expect(by(open, 'agent:a1').rail).toBe('│  ├ ')
  expect(by(open, 'agent:a2').rail).toBe('│  ╰ ')
  // Closed by hand although it failed.
  expect(by(open, 'n3').run?.open).toBe(false)
  // With the lists shut (the canvas picker counts rows), no agent line is made.
  expect(buildDesignRows(design, { run: overlayOf(state), agentRows: false }).map(row => row.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', UNMAPPED_ROW_ID, '+'])
})

test('agents no node claims are one group after the design, which opens to them', async () => {
  const state = reduceAll(PARTIAL, KNOWN)
  const rows = buildDesignRows(design, { run: overlayOf(state, ui({ runUi: { expanded: [UNMAPPED_ROW_ID], collapsed: [] } })) })
  expect(rows.map(row => row.id).slice(-4)).toEqual([UNMAPPED_ROW_ID, 'agent:x2', 'agent:x1', '+'])
  expect(by(rows, UNMAPPED_ROW_ID)).toMatchObject({ kind: 'group', title: 'unmapped', badge: '×2', run: { counts: '1/2', color: 'claude', open: true } })
  // An unmapped label is shown whole: its id is not one of the design's.
  expect(by(rows, 'agent:x2')).toMatchObject({ title: 'n99: stray check', rail: '│  ├ ' })
  expect(by(rows, 'agent:x1')).toMatchObject({ title: 'fix lint', rail: '│  ╰ ' })

  // No unmapped agent, no group.
  const clean = reduceAll(PARTIAL.filter(event => !('agentId' in event) || !event.agentId.startsWith('x')), KNOWN)
  expect(buildDesignRows(design, { run: overlayOf(clean) }).some(row => row.kind === 'group')).toBe(false)
})

test('once the run is over, a node that never got an agent says so', async () => {
  const over = reduceAll([...PARTIAL, end('b3', 900), end('c1', 100), end('x2', 50), { kind: 'run-end', runId: RUN_ID, ok: true }], KNOWN)
  expect(over.status).toBe('done')
  const rows = buildDesignRows(design, { run: overlayOf(over) })
  expect(by(rows, 'n5').run).toMatchObject({ glyph: '●', color: 'inactive', counts: '', note: NOT_RUN })
  // A failure outlasts the run: the mark is the error mark, on the node and on what holds it.
  expect(by(rows, 'n3').run).toMatchObject({ glyph: '✗', color: 'error', counts: '3/3', note: '' })
  expect(by(rows, 'n2').run).toMatchObject({ glyph: '✗', color: 'error', counts: '4/4' })
  expect(by(rows, 'n4').run).toMatchObject({ glyph: '✓', color: 'success', counts: '1/1' })
  expect(by(rows, UNMAPPED_ROW_ID).run).toMatchObject({ glyph: '✓', counts: '2/2' })
})

test('a long fan-out is cut to a few lines and a count of the rest', async () => {
  const many: RunEvent[] = [{ kind: 'run-start', runId: RUN_ID }]
  for (let k = 0; k < AGENT_ROWS_MAX + 5; k++) many.push(start(`m${k}`, `n1: item ${k}`))
  const rows = buildDesignRows(design, { run: overlayOf(reduceAll(many, KNOWN), ui({ runUi: { expanded: ['n1'], collapsed: [] } })) })
  const listed = rows.filter(row => row.kind === 'agent')
  expect(listed).toHaveLength(AGENT_ROWS_MAX + 1)
  expect(listed.at(-1)).toMatchObject({ id: 'more:n1', title: '5 more', rail: '│  ╰ ' })
})

test('the overlay hands the canvas every count but only the agents an open row lists', async () => {
  const state = reduceAll(PARTIAL, KNOWN)
  const lean = overlayOf(state)
  expect(Object.keys(lean.agents).sort()).toEqual(['b1', 'b2', 'b3', 'x1', 'x2'])
  expect(lean.byNode).toEqual(state.byNode)
  expect(runNodeOpen(lean, 'n3')).toBe(true)
  expect(runNodeOpen(lean, 'n1')).toBe(false)

  // The run overlays a design only when it was started from it and has begun.
  expect(overlaysDesign(state, design.name, ui())).toBe(true)
  expect(overlaysDesign(state, 'other', ui())).toBe(false)
  expect(overlaysDesign(state, null, ui())).toBe(false)
  expect(overlaysDesign(reduceAll([], KNOWN), design.name, ui())).toBe(false)

  // While it runs the canvas is in run mode and holds nothing grabbed.
  expect(canvasProps(design, ui({ grabbedId: 'n1' }), 0, lean)).toMatchObject({ mode: 'run', grabbedId: null, run: { status: 'running' } })
  expect(canvasProps(design, ui({ grabbedId: 'n1' }))).toMatchObject({ mode: 'design', grabbedId: 'n1' })
  expect('run' in canvasProps(design, ui())).toBe(false)
})

test('while a run is in progress every edit is refused with one notice; selection and agent lists still work', async () => {
  const run = reduceAll(PARTIAL, KNOWN)
  const locked = { run, locked: true }
  const held = ui({ selectedId: 'n2' })

  for (const op of ['grab', 'addAfter', 'addInside', 'remove'] as const) {
    const step = applyOp(design, held, op, locked)
    expect(step.design).toBe(design)
    expect(step.changed).toBe(false)
    expect(step.ui).toMatchObject({ notice: LOCK_NOTICE, grabbedId: null, picker: null, confirmId: null })
  }
  expect(applyMessage(design, held, { kind: 'remove', id: 'n1' }, locked)).toMatchObject({ design, changed: false, ui: { notice: LOCK_NOTICE } })
  expect(applyMessage(design, held, { kind: 'move', id: 'n1', to: { index: 2 } }, locked)).toMatchObject({ design, changed: false, ui: { notice: LOCK_NOTICE, rev: held.rev + 1 } })
  expect(applyMessage(design, held, { kind: 'add', type: 'agent', at: { index: 0 } }, locked)).toMatchObject({ design, changed: false })
  expect(applyMessage(design, held, { kind: 'locked' }, locked).ui.notice).toBe(LOCK_NOTICE)
  expect(patchNode(design, held, 'n1', { title: 'renamed' }, locked)).toMatchObject({ design, changed: false, ui: { notice: LOCK_NOTICE } })

  // Moving the selection is not an edit.
  expect(applyOp(design, held, 'down', locked).ui).toMatchObject({ selectedId: 'n3', notice: null })
  // The agents key flips the selected node's list: n3 is open (it failed), so it closes.
  const shut = applyOp(design, ui({ selectedId: 'n3' }), 'agents', locked).ui
  expect(shut.runUi).toEqual({ expanded: [], collapsed: ['n3'] })
  expect(applyOp(design, shut, 'agents', locked).ui.runUi).toEqual({ expanded: ['n3'], collapsed: [] })
  expect(applyMessage(design, held, { kind: 'toggleRun', id: 'n1' }, locked).ui).toMatchObject({ selectedId: 'n1', runUi: { expanded: ['n1'], collapsed: [] } })
  expect(applyMessage(design, held, { kind: 'toggleRun', id: UNMAPPED_ROW_ID }, locked).ui).toMatchObject({ selectedId: 'n2', runUi: { expanded: [UNMAPPED_ROW_ID], collapsed: [] } })
  expect(applyOp(design, ui({ selectedId: 'n5' }), 'agents', locked).ui.notice).toMatch(/n5 has no agents/)

  // Once the run is over the same edits go through.
  const free = { run: reduceAll([...PARTIAL, { kind: 'run-end', runId: RUN_ID, ok: true }], KNOWN), locked: false }
  expect(applyMessage(design, held, { kind: 'remove', id: 'n1' }, free).changed).toBe(true)
  expect(applyOp(design, held, 'grab', free).ui.grabbedId).toBe('n2')
})

test('the canvas in run mode: a click opens a row, edit keys only report the lock', async () => {
  const run = overlayOf(reduceAll(PARTIAL, KNOWN))
  const context = { design, run, locked: true }
  const state = syncCanvas(initialCanvas(), { design, selectedId: 'n1', rev: 1, mode: 'run', run })

  // Lines: n1 n2 n3 b2 b3 b1 n4 n5 unmapped +. A press on n4's line means n4, not the fourth node.
  const click = canvasReduce(state, { type: 'pointer', event: 'down', x: 10, y: 6 }, context)
  expect(click.post).toEqual({ kind: 'toggleRun', id: 'n4' })
  expect(click.state.drag).toBe(null)
  expect(canvasReduce(state, { type: 'pointer', event: 'down', x: 10, y: 8 }, context).post).toEqual({ kind: 'toggleRun', id: UNMAPPED_ROW_ID })
  // An agent's line and the add row do nothing but say why.
  expect(canvasReduce(state, { type: 'pointer', event: 'down', x: 10, y: 4 }, context).post).toBe(undefined)
  expect(canvasReduce(state, { type: 'pointer', event: 'down', x: 10, y: 9 }, context).post).toEqual({ kind: 'locked' })

  for (const key of ['x', 'a', 'i', 'space', 'return']) {
    const result = canvasReduce(state, { type: 'key', key }, context)
    expect(result.post).toEqual({ kind: 'locked' })
    expect(result.state).toMatchObject({ grabbedId: null, picker: null, selectedId: 'n1' })
  }
  expect(canvasReduce(state, { type: 'key', key: 'j' }, context).post).toEqual({ kind: 'select', id: 'n2' })
  expect(canvasReduce(state, { type: 'key', key: 'o' }, context).post).toEqual({ kind: 'toggleRun', id: 'n1' })

  // A run that starts while something is held lets go of it.
  const holding = { ...initialCanvas(), rev: 1, selectedId: 'n1', grabbedId: 'n1' }
  expect(syncCanvas(holding, { design, selectedId: 'n1', rev: 1, mode: 'run', run }).grabbedId).toBe(null)
})

test('the toolbar grab is drawn lifted, and a refused drop lets go of its row', async () => {
  const view = viewCanvas({ ...initialCanvas(), rev: 1, selectedId: 'n1' }, { design, lints: [], grabbedId: 'n1' })
  expect(view.rows.find(row => row.id === 'n1')?.grabbed).toBe(true)
  expect(view.rows.filter(row => row.grabbed)).toHaveLength(1)

  // A drop the design refuses (a block into itself) comes back with a new rev, which clears the drag.
  const held = ui({ selectedId: 'n2', rev: 4 })
  const refused = applyMessage(design, held, { kind: 'move', id: 'n2', to: { parentId: 'n2', index: 0 } })
  expect(refused.changed).toBe(false)
  expect(refused.ui.notice).not.toBe(null)
  expect(refused.ui.rev).toBe(5)
  const lifted = { ...initialCanvas(), rev: 4, selectedId: 'n2', drag: { id: 'n2', downX: 5, downY: 1, x: 5, y: 2, top: 0, active: true, settling: { place: { parentId: 'n2', index: 0 }, slot: 2, depth: 1 } } }
  expect(syncCanvas(lifted, { design, selectedId: refused.ui.selectedId, rev: refused.ui.rev }).drag).toBe(null)
})

test('a container that holds blocks is deleted from the canvas only on the second ask', async () => {
  const held = ui({ selectedId: 'n2' })
  const asked = applyMessage(design, held, { kind: 'remove', id: 'n2' })
  expect(asked).toMatchObject({ design, changed: false, ui: { confirmId: 'n2', selectedId: 'n2' } })
  expect(asked.ui.notice).toMatch(/n2 holds 2 blocks: x again/)
  const gone = applyMessage(design, asked.ui, { kind: 'remove', id: 'n2' })
  expect(gone.changed).toBe(true)
  expect(gone.design?.nodes.map(node => node.id)).toEqual(['n1', 'n5'])
  expect(gone.ui).toMatchObject({ selectedId: 'n5', confirmId: null, rev: held.rev + 1 })
  // Selecting something else in between withdraws the question.
  const moved = applyMessage(design, asked.ui, { kind: 'select', id: 'n1' })
  expect(applyMessage(design, moved.ui, { kind: 'remove', id: 'n2' }).changed).toBe(false)
})
