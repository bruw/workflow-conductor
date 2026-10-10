import { expect, test } from 'claude-code/testing'

import { flatten } from '../src/design/model'
import { TEMPLATES, review } from '../src/design/templates'
import { parseNodeId, reduceAll } from '../src/run/reducer'
import { REPLAY_STRAYS, replayDesignEvents } from '../src/run/replay'

test('a design replay labels its agents with the review template\'s leaf ids', async () => {
  const design = review()
  const known = new Set(flatten(design).map(row => row.node.id))
  const events = replayDesignEvents(design, 'demo')

  expect(events[0]).toEqual({ kind: 'run-start', runId: 'replay:design:demo', name: 'demo' })
  expect(events.at(-1)).toEqual({ kind: 'run-end', runId: 'replay:design:demo', ok: true })

  const state = reduceAll(events, known)
  expect(state.status).toBe('done')
  // Leaves only: n2 is a pipeline, its stages n3 and n4 carry the agents.
  expect(Object.keys(state.byNode).sort()).toEqual(['n1', 'n3', 'n4', 'n5'])
  for (const one of Object.values(state.byNode)) {
    expect(one.total).toBeGreaterThanOrEqual(2)
    expect(one.running).toBe(0)
    expect(one.done + one.failed).toBe(one.total)
  }
  // n4 states three votes.
  expect(state.byNode.n4?.total).toBe(3)
  // One failure, in the second leaf.
  expect(Object.entries(state.byNode).filter(([, one]) => one.failed > 0).map(([id]) => id)).toEqual(['n3'])
  expect(state.byNode.n3?.failed).toBe(1)

  // Two agents no node claims: one with no id, one with an id the design does not hold.
  expect(state.unmapped).toHaveLength(2)
  const strays = state.unmapped.map(id => state.agents[id]?.label ?? '')
  expect(strays[0]).toBe(REPLAY_STRAYS[0])
  expect(strays[1]).toMatch(/^n\d+: stray check$/)
  expect(known.has(parseNodeId(strays[1] ?? '') ?? '')).toBe(false)
  expect(state.unmapped.every(id => state.agents[id]?.nodeId === undefined)).toBe(true)

  // The totals add up: every agent is in one node bucket or unmapped, and so are its tokens.
  const agents = Object.values(state.agents)
  const mapped = Object.values(state.byNode).reduce((sum, one) => sum + one.total, 0)
  expect(mapped + state.unmapped.length).toBe(agents.length)
  const tokens = agents.reduce((sum, agent) => sum + agent.tokens, 0)
  const strayTokens = state.unmapped.reduce((sum, id) => sum + (state.agents[id]?.tokens ?? 0), 0)
  expect(Object.values(state.byNode).reduce((sum, one) => sum + one.tokens, 0) + strayTokens).toBe(tokens)
  expect(agents.every(agent => agent.tokens > 0 && agent.status !== 'running')).toBe(true)
  // Mapped labels follow the handoff convention and carry the node's phase.
  for (const agent of agents.filter(one => one.nodeId !== undefined)) {
    expect(agent.label.startsWith(`${agent.nodeId}: `)).toBe(true)
    expect(agent.phase).toMatch(/^n\d+ /)
  }
})

test('halfway through a design replay some nodes are done, one runs and the rest wait', async () => {
  const design = review()
  const known = new Set(flatten(design).map(row => row.node.id))
  const events = replayDesignEvents(design)
  const half = reduceAll(events.slice(0, Math.floor(events.length / 2)), known)
  expect(half.status).toBe('running')
  expect(half.byNode.n1).toMatchObject({ running: 0 })
  expect(half.byNode.n5).toBe(undefined)
  expect(Object.values(half.agents).some(agent => agent.status === 'running')).toBe(true)
})

test('every template replays onto its own ids, with two strays', async () => {
  for (const template of TEMPLATES) {
    const design = template.make()
    const known = new Set(flatten(design).map(row => row.node.id))
    const state = reduceAll(replayDesignEvents(design), known)
    expect(state.status).toBe('done')
    expect(state.unmapped).toHaveLength(2)
    expect(Object.keys(state.byNode).every(id => known.has(id))).toBe(true)
    expect(Object.keys(state.byNode).length).toBeGreaterThan(0)
  }
})
