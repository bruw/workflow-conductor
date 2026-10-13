import { expect, test } from 'claude-code/testing'

import { emptyRunState } from '../src/run/events'
import type { NodeRun, RunEvent, RunState } from '../src/run/events'
import { parseNodeId, reduce, reduceAll } from '../src/run/reducer'

const RUN = 'wf_test'

const start = (agentId: string, label: string, phase?: string): RunEvent => ({ kind: 'agent-start', runId: RUN, agentId, label, phase })

/** Recomputes the buckets from the agents and checks the incrementally kept ones match. */
function expectConsistent(state: RunState) {
  const byNode: Record<string, NodeRun> = {}
  const byPhase: Record<string, NodeRun> = {}
  const add = (buckets: Record<string, NodeRun>, key: string | undefined, status: 'running' | 'done' | 'failed', tokens: number) => {
    if (key === undefined) return
    const one = (buckets[key] ??= { total: 0, running: 0, done: 0, failed: 0, tokens: 0 })
    one.total++
    one[status]++
    one.tokens += tokens
  }
  for (const agent of Object.values(state.agents)) {
    add(byNode, agent.nodeId, agent.status, agent.tokens)
    add(byPhase, agent.phase, agent.status, agent.tokens)
  }

  expect(state.byNode).toEqual(byNode)
  expect(state.byPhase).toEqual(byPhase)
  expect([...state.unmapped].sort()).toEqual(
    Object.values(state.agents)
      .filter(agent => agent.nodeId === undefined)
      .map(agent => agent.agentId)
      .sort(),
  )
}

test('parseNodeId reads a leading node id', async () => {
  expect(parseNodeId('n3: verify auth')).toBe('n3')
  expect(parseNodeId('n12')).toBe('n12')
  expect(parseNodeId('n7 review')).toBe('n7')
  expect(parseNodeId('n1:fix')).toBe('n1')
})

test('parseNodeId rejects labels without a leading node id', async () => {
  expect(parseNodeId('review:jobs')).toBeUndefined()
  expect(parseNodeId('integrate')).toBeUndefined()
  expect(parseNodeId('node3: x')).toBeUndefined()
  expect(parseNodeId('n3x: x')).toBeUndefined()
  expect(parseNodeId(' n3: x')).toBeUndefined()
  expect(parseNodeId('N3: x')).toBeUndefined()
  expect(parseNodeId('n: x')).toBeUndefined()
  expect(parseNodeId('')).toBeUndefined()
})

test('empty state is idle with nothing counted', async () => {
  expect(emptyRunState()).toEqual({ status: 'idle', agents: {}, byNode: {}, byPhase: {}, unmapped: [] })
})

test('run-start resets to a fresh running state', async () => {
  const dirty = reduceAll([{ kind: 'run-start', runId: 'old' }, start('a1', 'n1: a', 'n1 Plan'), { kind: 'run-end', runId: 'old', ok: false }])
  expect(dirty.status).toBe('failed')

  const fresh = reduce(dirty, { kind: 'run-start', runId: RUN, name: 'review' })
  expect(fresh).toEqual({ runId: RUN, name: 'review', status: 'running', agents: {}, byNode: {}, byPhase: {}, unmapped: [] })
})

test('a repeated run-start for the running run keeps its agents', async () => {
  const state = reduceAll([{ kind: 'run-start', runId: RUN }, start('a1', 'n1: a', 'n1 Plan')])
  const again = reduce(state, { kind: 'run-start', runId: RUN, name: 'late name' })

  expect(Object.keys(again.agents)).toEqual(['a1'])
  expect(again.name).toBe('late name')
  expectConsistent(again)
})

test('agent-start before any run-start begins the run', async () => {
  const state = reduce(emptyRunState(), start('a1', 'n1: a'))

  expect(state.status).toBe('running')
  expect(state.runId).toBe(RUN)
})

test('counts follow agents through start, usage and end', async () => {
  let state = reduceAll([
    { kind: 'run-start', runId: RUN },
    start('a1', 'n1: plan', 'n1 Plan'),
    start('a2', 'n2: build api', 'n2 Build'),
    start('a3', 'n2: build ui', 'n2 Build'),
  ])

  expect(state.byNode).toEqual({
    n1: { total: 1, running: 1, done: 0, failed: 0, tokens: 0 },
    n2: { total: 2, running: 2, done: 0, failed: 0, tokens: 0 },
  })
  expect(state.byPhase['n2 Build']).toEqual({ total: 2, running: 2, done: 0, failed: 0, tokens: 0 })
  expect(state.unmapped).toEqual([])
  expect(state.agents.a2).toEqual({ agentId: 'a2', label: 'n2: build api', nodeId: 'n2', phase: 'n2 Build', status: 'running', tokens: 0 })

  state = reduceAll(
    [
      { kind: 'agent-usage', agentId: 'a2', tokens: 100 },
      { kind: 'agent-usage', agentId: 'a3', tokens: 40 },
      { kind: 'agent-usage', agentId: 'a2', tokens: 250 },
    ],
    undefined,
    state,
  )
  expect(state.agents.a2?.tokens).toBe(250)
  expect(state.byNode.n2?.tokens).toBe(290)
  expect(state.byPhase['n2 Build']?.tokens).toBe(290)
  expectConsistent(state)

  state = reduceAll(
    [
      { kind: 'agent-end', agentId: 'a1', ok: true, durationMs: 1200 },
      { kind: 'agent-end', agentId: 'a2', ok: true, durationMs: 3400, tokens: 300 },
      { kind: 'agent-end', agentId: 'a3', ok: false },
    ],
    undefined,
    state,
  )
  expect(state.byNode).toEqual({
    n1: { total: 1, running: 0, done: 1, failed: 0, tokens: 0 },
    n2: { total: 2, running: 0, done: 1, failed: 1, tokens: 340 },
  })
  expect(state.agents.a2).toEqual({
    agentId: 'a2',
    label: 'n2: build api',
    nodeId: 'n2',
    phase: 'n2 Build',
    status: 'done',
    tokens: 300,
    durationMs: 3400,
  })
  expect(state.agents.a3?.status).toBe('failed')
  expect(state.agents.a3?.tokens).toBe(40)
  expect(state.agents.a3?.durationMs).toBeUndefined()
  expectConsistent(state)

  expect(state.status).toBe('running')
  expect(reduce(state, { kind: 'run-end', runId: RUN, ok: true }).status).toBe('done')
  expect(reduce(state, { kind: 'run-end', runId: RUN, ok: false }).status).toBe('failed')
  expect(reduce(state, { kind: 'run-end', runId: 'another', ok: false }).status).toBe('running')
})

test('labels without a node id go to unmapped and still count by phase', async () => {
  const state = reduceAll([start('a1', 'review:jobs', 'Review'), start('a2', 'integrate')])

  expect(state.unmapped).toEqual(['a1', 'a2'])
  expect(state.byNode).toEqual({})
  expect(state.byPhase).toEqual({ Review: { total: 1, running: 1, done: 0, failed: 0, tokens: 0 } })
  expect(state.agents.a1?.nodeId).toBeUndefined()
  expectConsistent(state)
})

test('a node id the project does not have is unmapped', async () => {
  const known = { ids: new Set(['n1', 'n2']) }
  const state = reduceAll([start('a1', 'n1: plan', 'P'), start('a2', 'n9: stray', 'P')], known)

  expect(Object.keys(state.byNode)).toEqual(['n1'])
  expect(state.unmapped).toEqual(['a2'])
  expect(state.agents.a2?.nodeId).toBeUndefined()
  expect(state.byPhase.P?.total).toBe(2)
  expectConsistent(state)

  const open = reduceAll([start('a2', 'n9: stray', 'P')])
  expect(open.agents.a2?.nodeId).toBe('n9')
  expect(open.unmapped).toEqual([])
})

test('duplicate agent-start does not double count', async () => {
  const once = reduceAll([start('a1', 'n1: plan', 'Plan'), { kind: 'agent-usage', agentId: 'a1', tokens: 50 }])
  const twice = reduce(once, start('a1', 'n2: other label', 'Other'))

  expect(twice).toBe(once)

  const unmappedTwice = reduceAll([start('a1', 'plain', 'Plan'), start('a1', 'plain', 'Plan')])
  expect(unmappedTwice.unmapped).toEqual(['a1'])
  expect(unmappedTwice.byPhase.Plan?.total).toBe(1)

  const ended = reduce(once, { kind: 'agent-end', agentId: 'a1', ok: true })
  const restarted = reduce(ended, start('a1', 'n1: plan', 'Plan'))
  expect(restarted.byNode.n1).toEqual({ total: 1, running: 0, done: 1, failed: 0, tokens: 50 })
})

test('events for unknown agents change nothing', async () => {
  const state = reduceAll([{ kind: 'run-start', runId: RUN }, start('a1', 'n1: plan', 'Plan')])

  expect(reduce(state, { kind: 'agent-usage', agentId: 'ghost', tokens: 999 })).toBe(state)
  expect(reduce(state, { kind: 'agent-end', agentId: 'ghost', ok: false, tokens: 999 })).toBe(state)
  expect(reduce(emptyRunState(), { kind: 'agent-end', agentId: 'ghost', ok: true })).toEqual(emptyRunState())
})

test('a second agent-end and bad token values are ignored', async () => {
  const state = reduceAll([
    start('a1', 'n1: plan', 'Plan'),
    { kind: 'agent-usage', agentId: 'a1', tokens: 10 },
    { kind: 'agent-usage', agentId: 'a1', tokens: Number.NaN },
    { kind: 'agent-usage', agentId: 'a1', tokens: -5 },
    { kind: 'agent-end', agentId: 'a1', ok: true },
    { kind: 'agent-end', agentId: 'a1', ok: false, tokens: 500 },
  ])

  expect(state.byNode.n1).toEqual({ total: 1, running: 0, done: 1, failed: 0, tokens: 10 })
  expect(state.agents.a1?.status).toBe('done')
  expectConsistent(state)
})

test('usage reported after an agent ended still keeps sums consistent', async () => {
  const state = reduceAll([
    start('a1', 'n1: a', 'Plan'),
    start('a2', 'n1: b', 'Plan'),
    { kind: 'agent-end', agentId: 'a1', ok: true, tokens: 70 },
    { kind: 'agent-usage', agentId: 'a1', tokens: 90 },
    { kind: 'agent-usage', agentId: 'a2', tokens: 30 },
    { kind: 'agent-usage', agentId: 'a2', tokens: 20 },
  ])

  expect(state.byNode.n1?.tokens).toBe(110)
  expect(state.byPhase.Plan?.tokens).toBe(110)
  expectConsistent(state)
})

test('reduce never mutates the state it is given', async () => {
  const before = reduceAll([{ kind: 'run-start', runId: RUN }, start('a1', 'n1: plan', 'Plan'), start('a2', 'free', 'Plan')])
  const snapshot = JSON.stringify(before)
  const events: RunEvent[] = [
    start('a3', 'n2: build', 'Build'),
    start('a4', 'free two'),
    { kind: 'agent-usage', agentId: 'a1', tokens: 5 },
    { kind: 'agent-end', agentId: 'a1', ok: true, tokens: 9 },
    { kind: 'agent-end', agentId: 'a2', ok: false },
    { kind: 'run-end', runId: RUN, ok: true },
    { kind: 'run-start', runId: 'next' },
  ]

  for (const event of events) {
    const after = reduce(before, event)
    expect(after).not.toBe(before)
    expect(JSON.stringify(before)).toBe(snapshot)
  }
})

test('an event of an unknown kind is ignored', async () => {
  const state = reduceAll([start('a1', 'n1: plan')])
  expect(reduce(state, { kind: 'something-new' } as unknown as RunEvent)).toBe(state)
})

test('a repeated agent-start fills in a missing phase without counting twice', async () => {
  const before = reduceAll([
    { kind: 'run-start', runId: 'wf_1' },
    { kind: 'agent-start', runId: 'wf_1', agentId: 'a1', label: 'n1: plan' },
    { kind: 'agent-usage', agentId: 'a1', tokens: 700 },
    { kind: 'agent-end', agentId: 'a1', ok: false, tokens: 900 },
  ])
  expect(before.byPhase).toEqual({})

  const after = reduce(before, { kind: 'agent-start', runId: 'wf_1', agentId: 'a1', label: 'ignored', phase: 'Plan' })
  expect(after.agents.a1).toMatchObject({ label: 'n1: plan', phase: 'Plan', status: 'failed', tokens: 900 })
  expect(after.byPhase).toEqual({ Plan: { total: 1, running: 0, done: 0, failed: 1, tokens: 900 } })
  expect(after.byNode).toEqual(before.byNode)
  expect(after.unmapped).toEqual(before.unmapped)

  expect(reduce(after, { kind: 'agent-start', runId: 'wf_1', agentId: 'a1', label: 'n1: plan', phase: 'Other' })).toBe(after)
  expect(reduce(before, { kind: 'agent-start', runId: 'wf_1', agentId: 'a1', label: 'n1: plan', phase: '' })).toBe(before)
})

test('a spawn for the finished run reopens it; one for another run does not', async () => {
  const done = reduceAll([
    { kind: 'run-start', runId: 'wf_1' },
    { kind: 'agent-start', runId: 'wf_1', agentId: 'a1', label: 'n1: plan' },
    { kind: 'agent-end', agentId: 'a1', ok: true },
    { kind: 'run-end', runId: 'wf_1', ok: true },
  ])
  expect(done.status).toBe('done')

  // Filling in a phase is not a spawn.
  expect(reduce(done, { kind: 'agent-start', runId: 'wf_1', agentId: 'a1', label: 'n1: plan', phase: 'Plan' }).status).toBe('done')
  expect(reduce(done, { kind: 'agent-start', runId: 'wf_other', agentId: 'b1', label: 'n1: plan' }).status).toBe('done')

  const reopened = reduce(done, { kind: 'agent-start', runId: 'wf_1', agentId: 'a2', label: 'n1: more' })
  expect(reopened.status).toBe('running')
  expect(Object.keys(reopened.agents)).toEqual(['a1', 'a2'])
})
