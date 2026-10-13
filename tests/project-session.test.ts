import { expect, test } from 'claude-code/testing'

import { findNode, flatten } from '../src/project/model'
import type { Project } from '../src/project/model'
import { AGENT_ROWS_MAX, agentTitle, agentsOf, applyMessage, applyOp, initialUi, overlaysProject, patchNode, pickBlock, retypeBlock, runOverlay } from '../src/project/session'
import type { ProjectUi } from '../src/project/session'
import { review } from '../src/project/templates'
import type { RunEvent, RunState } from '../src/run/events'
import { reduceAll } from '../src/run/reducer'
import { UNMAPPED_ID } from '../src/ui/graph-layout'

// Review template: n6 start, n1 agent, n2 pipeline [n3 agent, n4 verify], n5 agent.
const project = review()
const KNOWN = { ids: new Set(flatten(project).map(row => row.node.id)) }
const RUN_ID = 'wf_1'

const start = (agentId: string, label: string): RunEvent => ({ kind: 'agent-start', runId: RUN_ID, agentId, label })
const end = (agentId: string, tokens: number, ok = true): RunEvent => ({ kind: 'agent-end', agentId, ok, tokens })

// n1: two done. n3: one done, one failed, one running. n4: one running. n5: nothing yet.
// Two agents no node claims: a plain label, and an id the project does not hold.
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

const ui = (more: Partial<ProjectUi> = {}): ProjectUi => ({ ...initialUi(), name: project.name, status: 'ready', selectedId: 'n1', ...more })
const ids = (one: Project | null): string[] => flatten(one ?? project).map(row => `${'  '.repeat(row.depth)}${row.node.id}`)
const REVIEW = ['n6', 'n1', 'n2', '  n3', '  n4', 'n5']

test('the keys move the selection as the graph is read; with Shift they move the block', () => {
  expect(applyOp(project, ui(), 'down').ui.selectedId).toBe('n2')
  expect(applyOp(project, ui({ selectedId: 'n2' }), 'down').ui.selectedId).toBe('n3')
  expect(applyOp(project, ui({ selectedId: 'n3' }), 'up').ui.selectedId).toBe('n2')
  expect(applyOp(project, ui({ selectedId: null }), 'down').ui.selectedId).toBe('n6')
  expect(applyOp(project, ui({ selectedId: 'n2', confirmId: 'n2', notice: 'x' }), 'up')).toMatchObject({ project, changed: false, ui: { selectedId: 'n1', confirmId: null, notice: null } })

  const stepped = applyOp(project, ui(), 'moveDown')
  expect(ids(stepped.project)).toEqual(['n6', 'n2', '  n1', '  n3', '  n4', 'n5'])
  expect(stepped).toMatchObject({ changed: true, ui: { selectedId: 'n1' } })
  const back = applyOp(stepped.project, stepped.ui, 'moveUp')
  expect(ids(back.project)).toEqual(REVIEW)
  const stuck = applyOp(project, ui(), 'moveUp')
  expect(stuck).toMatchObject({ project, changed: false })
  expect(stuck.ui.notice).not.toBe(null)
  expect(applyOp(project, ui({ selectedId: null }), 'moveDown')).toMatchObject({ project, changed: false })
})

test('messages from the graph: select, drop, and a [+] that opens the add list for its place', () => {
  expect(applyMessage(project, ui(), { kind: 'select', id: 'n4' }).ui.selectedId).toBe('n4')
  expect(applyMessage(project, ui(), { kind: 'select', id: 'n99' }).ui.selectedId).toBe(null)
  // With no run there are no agents without a block to select.
  expect(applyMessage(project, ui(), { kind: 'select', id: UNMAPPED_ID }).ui.selectedId).toBe(null)

  const dropped = applyMessage(project, ui({ selectedId: 'n5' }), { kind: 'move', id: 'n5', to: { parentId: 'n2', index: 1 } })
  expect(ids(dropped.project)).toEqual(['n6', 'n1', 'n2', '  n3', '  n5', '  n4'])
  expect(dropped).toMatchObject({ changed: true, ui: { selectedId: 'n5' } })
  const refused = applyMessage(project, ui(), { kind: 'move', id: 'n2', to: { parentId: 'n3', index: 0 } })
  expect(refused).toMatchObject({ changed: false, project })
  expect(refused.ui.notice).not.toBe(null)

  const asked = applyMessage(project, ui(), { kind: 'addAt', at: { parentId: 'n2', index: 1 } })
  expect(asked).toMatchObject({ changed: false, project, ui: { picker: { at: { parentId: 'n2', index: 1 }, query: '' } } })
  const added = pickBlock(project, asked.ui, { type: 'agent', kind: 'critic' })
  const newId = added.ui.selectedId ?? ''
  expect(ids(added.project)).toEqual(['n6', 'n1', 'n2', '  n3', `  ${newId}`, '  n4', 'n5'])
  expect(REVIEW.map(id => id.trim())).not.toContain(newId)
  expect(findNode(added.project ?? project, newId)).toMatchObject({ type: 'agent', kind: 'critic' })
  expect(added).toMatchObject({ changed: true, ui: { picker: null } })
  expect(pickBlock(project, asked.ui, { type: 'loop', opens: true })).toMatchObject({ changed: false, project, ui: { picker: { block: 'loop' } } })
  expect(pickBlock(project, { ...asked.ui, picker: { at: { index: 1 }, query: 'zzzz' } })).toMatchObject({ changed: false, project })
  // A leaf holds no blocks.
  expect(applyMessage(project, ui(), { kind: 'addAt', at: { parentId: 'n1', index: 0 } })).toMatchObject({ changed: false, ui: { picker: null } })

  expect(applyMessage(project, ui(), { kind: 'key', key: 's' }).ui.selectedId).toBe('n2')
  expect(ids(applyMessage(project, ui(), { kind: 'key', key: 'S' }).project)).toEqual(['n6', 'n2', '  n1', '  n3', '  n4', 'n5'])
  expect(applyMessage(project, asked.ui, { kind: 'touch' }).ui.picker).toBe(null)
  expect(applyMessage(null, ui(), { kind: 'select', id: 'n1' })).toMatchObject({ project: null, changed: false })
  expect(applyMessage(project, initialUi(), { kind: 'select', id: 'n1' })).toMatchObject({ changed: false, ui: { selectedId: null } })
})

test('a block is deleted at once; a container that holds blocks only on the second ask; the start block never', () => {
  const gone = applyOp(project, ui(), 'remove')
  expect(ids(gone.project)).toEqual(['n6', 'n2', '  n3', '  n4', 'n5'])
  expect(gone.ui.selectedId).toBe('n2')

  const first = applyOp(project, ui({ selectedId: 'n2' }), 'remove')
  expect(first).toMatchObject({ changed: false, project, ui: { selectedId: 'n2', confirmId: 'n2' } })
  expect(first.ui.notice).not.toBe(null)
  const second = applyOp(project, first.ui, 'remove')
  expect(ids(second.project)).toEqual(['n6', 'n1', 'n5'])
  expect(second.ui).toMatchObject({ selectedId: 'n5', confirmId: null })
  expect(applyMessage(project, first.ui, { kind: 'select', id: 'n2' }).ui.confirmId).toBe(null)
  expect(applyOp(project, first.ui, 'down').ui.confirmId).toBe(null)

  expect(applyOp(project, ui({ selectedId: 'n6' }), 'remove')).toMatchObject({ changed: false, project })
  expect(applyOp(project, ui({ selectedId: null }), 'remove')).toMatchObject({ changed: false, project })
})

test('a container is opened as the view and left again; the selection stays in what is shown', () => {
  const opened = applyOp(project, ui({ selectedId: 'n2' }), 'open')
  expect(opened.ui).toMatchObject({ viewRootId: 'n2', selectedId: 'n2' })
  const inside = applyOp(project, { ...opened.ui, selectedId: 'n4' }, 'down')
  expect(inside.ui).toMatchObject({ viewRootId: 'n2', selectedId: 'n4' })
  expect(applyOp(project, opened.ui, 'back').ui).toMatchObject({ viewRootId: null, selectedId: 'n2' })
  expect(applyMessage(project, opened.ui, { kind: 'view', id: null }).ui.viewRootId).toBe(null)
  expect(applyOp(project, ui(), 'open').ui.viewRootId).toBe(null)
  expect(applyMessage(project, ui(), { kind: 'view', id: 'n1' }).ui.viewRootId).toBe(null)
})

test('the overlay hands the graph every count and the sum of what no block claims', () => {
  const state = reduceAll(PARTIAL, KNOWN)
  const overlay = runOverlay(state, 192)
  expect(overlay).toMatchObject({ status: 'running', now: 192, byNode: { n1: { total: 2, done: 2 }, n3: { total: 3, running: 1, failed: 1 }, n4: { total: 1 } } })
  expect(overlay.unmapped).toEqual({ total: 2, running: 1, done: 1, failed: 0, tokens: 700 })
  expect(runOverlay(reduceAll(PARTIAL.slice(0, 5), KNOWN)).unmapped).toBe(null)
  // The agents themselves stay out of the graph's props.
  expect(JSON.stringify(overlay)).not.toMatch(/scout a/)

  expect(overlaysProject(state, project.name, ui())).toBe(true)
  expect(overlaysProject(state, 'other', ui())).toBe(false)
  expect(overlaysProject(state, null, ui())).toBe(false)
  expect(overlaysProject(state, project.name, ui({ runCleared: true }))).toBe(false)
  expect(overlaysProject(reduceAll([]), project.name, ui())).toBe(false)
})

test('a block’s agents are listed failures first, without the id prefix; the rest are a count', () => {
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
  expect(applyMessage(project, ui(), { kind: 'select', id: UNMAPPED_ID }, { run: state }).ui.selectedId).toBe(UNMAPPED_ID)
})

test('while a run is in progress every edit is refused with a notice; selection still works', () => {
  const state: RunState = reduceAll(PARTIAL, KNOWN)
  const context = { run: state, locked: true }
  for (const message of [
    { kind: 'move', id: 'n1', to: { index: 2 } },
    { kind: 'addAt', at: { index: 1 } },
    { kind: 'knob', id: 'n1', slot: 1 },
  ] as const) {
    const step = applyMessage(project, ui(), message, context)
    expect(step).toMatchObject({ project, changed: false, ui: { picker: null } })
    expect(step.ui.notice).not.toBe(null)
  }
  for (const op of ['moveDown', 'add', 'remove', 'edit', 'retype', 'knob1'] as const) {
    const step = applyOp(project, ui(), op, context)
    expect(step).toMatchObject({ project, changed: false, ui: { picker: null, confirmId: null, editing: false } })
    expect(step.ui.notice).not.toBe(null)
  }
  expect(patchNode(project, ui(), 'n1', { name: 'x' }, context)).toMatchObject({ project, changed: false })
  expect(retypeBlock(project, ui(), 'n1', { type: 'code' }, context)).toMatchObject({ project, changed: false })
  expect(pickBlock(project, ui({ picker: { at: { index: 1 }, query: '' } }), { type: 'agent' }, context)).toMatchObject({ project, changed: false, ui: { picker: null } })
  expect(applyMessage(project, ui(), { kind: 'select', id: 'n3' }, context).ui).toMatchObject({ selectedId: 'n3', notice: null })
  expect(applyOp(project, ui(), 'down', context)).toMatchObject({ changed: false, ui: { selectedId: 'n2', notice: null } })
  expect(applyOp(project, ui({ selectedId: 'n2' }), 'open', context).ui.viewRootId).toBe('n2')
  expect(applyMessage(project, ui(), { kind: 'move', id: 'n1', to: { index: 3 } }, { run: { ...state, status: 'done' } }).changed).toBe(true)
  expect(patchNode(project, ui(), 'n1', { name: 'x' }).changed).toBe(true)
})
