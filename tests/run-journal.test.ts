import { expect, test } from 'claude-code/testing'

import type { NodeRun, RunState } from '../src/run/events'
import { journalPhases, journalToEvents, sumUsage } from '../src/run/journal'
import type { AgentMeta } from '../src/run/journal'
import { reduce, reduceAll } from '../src/run/reducer'
// The runner loads code files only, so each fixture has a generated .ts mirror.
import * as partial29 from '../fixtures/partial-29'
import * as review41 from '../fixtures/review-41'

const FIXTURES = [review41, partial29]

const jsonl = (...entries: unknown[]) => entries.map(entry => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n') + '\n'

const sum = (buckets: Record<string, NodeRun>, field: keyof NodeRun) => Object.values(buckets).reduce((total, one) => total + one[field], 0)

const statuses = (state: RunState) => Object.values(state.agents).map(agent => agent.status)

test('journal lines map to run events', async () => {
  const events = journalToEvents(
    jsonl(
      { type: 'launched' },
      { type: 'started', key: 'v2:aa', agentId: 'a1', label: 'n1: plan', phase: 'n1 Plan' },
      { type: 'started', key: 'v2:bb', agentId: 'a2', label: 'n2: build', phase: 'n2 Build' },
      { type: 'result', key: 'v2:aa', agentId: 'a1', result: { anything: 1 } },
      { type: 'result', key: 'v2:bb', agentId: 'a2', result: null },
    ),
    {},
    { runId: 'wf_1' },
  )

  expect(events).toEqual([
    { kind: 'run-start', runId: 'wf_1' },
    { kind: 'agent-start', runId: 'wf_1', agentId: 'a1', label: 'n1: plan', phase: 'n1 Plan', index: 0 },
    { kind: 'agent-start', runId: 'wf_1', agentId: 'a2', label: 'n2: build', phase: 'n2 Build', index: 1 },
    { kind: 'agent-end', agentId: 'a1', ok: true },
    { kind: 'agent-end', agentId: 'a2', ok: false },
  ])
})

test('falsy but non-null results still count as ok', async () => {
  const events = journalToEvents(
    jsonl(
      { type: 'result', agentId: 'a1', result: false },
      { type: 'result', agentId: 'a2', result: 0 },
      { type: 'result', agentId: 'a3', result: '' },
      { type: 'result', agentId: 'a4' },
    ),
  )

  expect(events.map(event => event.kind === 'agent-end' && event.ok)).toEqual([true, true, true, false])
})

test('malformed and unknown lines are skipped', async () => {
  const text = [
    '',
    'not json at all',
    '{"type":"started","agentId":"a1","label":"n1: ok","phase":"P"',
    '[1,2,3]',
    'null',
    '42',
    '"started"',
    JSON.stringify({ type: 'mystery', agentId: 'a1' }),
    JSON.stringify({ type: 'started', label: 'no agent id', phase: 'P' }),
    JSON.stringify({ type: 'started', agentId: 17, label: 'numeric id' }),
    JSON.stringify({ type: 'result', result: {} }),
    JSON.stringify({ agentId: 'a1' }),
    '   ',
    JSON.stringify({ type: 'started', agentId: 'a1', label: 'n1: ok', phase: 'P' }) + '\r',
    JSON.stringify({ type: 'result', agentId: 'a1', result: true }),
  ].join('\n')

  expect(journalToEvents(text)).toEqual([
    { kind: 'agent-start', runId: '', agentId: 'a1', label: 'n1: ok', phase: 'P', index: 0 },
    { kind: 'agent-end', agentId: 'a1', ok: true },
  ])
  expect(journalToEvents('')).toEqual([])
  expect(journalToEvents(undefined as unknown as string)).toEqual([])
})

test('label and phase fall back to the agent meta', async () => {
  const metas: Record<string, AgentMeta> = {
    a1: { description: 'n1: from meta', workflowPhase: 'Meta phase' },
    a2: { description: 'ignored', workflowPhase: 'ignored' },
    a3: {},
  }
  const events = journalToEvents(
    jsonl(
      { type: 'started', agentId: 'a1' },
      { type: 'started', agentId: 'a2', label: 'n2: from line', phase: 'Line phase' },
      { type: 'started', agentId: 'a3', label: '', phase: 7 },
      { type: 'started', agentId: 'a4' },
      { type: 'started', agentId: 'a5', label: 'n5: line label' },
    ),
    { ...metas, a5: { workflowPhase: 'Meta only phase' } },
  )

  expect(events).toEqual([
    { kind: 'agent-start', runId: '', agentId: 'a1', label: 'n1: from meta', phase: 'Meta phase', index: 0 },
    { kind: 'agent-start', runId: '', agentId: 'a2', label: 'n2: from line', phase: 'Line phase', index: 1 },
    { kind: 'agent-start', runId: '', agentId: 'a3', label: '', index: 2 },
    { kind: 'agent-start', runId: '', agentId: 'a4', label: '', index: 3 },
    { kind: 'agent-start', runId: '', agentId: 'a5', label: 'n5: line label', phase: 'Meta only phase', index: 4 },
  ])
})

test('a hand-written journal with node ids fills byNode', async () => {
  const events = journalToEvents(
    jsonl(
      { type: 'launched' },
      { type: 'started', agentId: 'a1', label: 'n1: plan', phase: 'n1 Plan' },
      { type: 'result', agentId: 'a1', result: true },
      { type: 'started', agentId: 'a2', label: 'n2: build api', phase: 'n2 Build' },
      { type: 'started', agentId: 'a3', label: 'n2: build ui', phase: 'n2 Build' },
      { type: 'started', agentId: 'a4', label: 'n7: not in project', phase: 'n2 Build' },
      { type: 'started', agentId: 'a5', label: 'helper', phase: 'n2 Build' },
      { type: 'result', agentId: 'a2', result: true },
      { type: 'result', agentId: 'a3', result: null },
      { type: 'result', agentId: 'ghost', result: true },
    ),
    {},
    { runId: 'wf_nodes' },
  )
  const state = reduceAll(events, { ids: new Set(['n1', 'n2']) })

  expect(state.runId).toBe('wf_nodes')
  expect(state.status).toBe('running')
  expect(state.byNode).toEqual({
    n1: { total: 1, running: 0, done: 1, failed: 0, tokens: 0 },
    n2: { total: 2, running: 0, done: 1, failed: 1, tokens: 0 },
  })
  expect(state.byPhase).toEqual({
    'n1 Plan': { total: 1, running: 0, done: 1, failed: 0, tokens: 0 },
    'n2 Build': { total: 4, running: 2, done: 1, failed: 1, tokens: 0 },
  })
  expect(state.unmapped).toEqual(['a4', 'a5'])
  expect(Object.keys(state.agents).length).toBe(5)

  expect(Object.keys(reduceAll(events).byNode).sort()).toEqual(['n1', 'n2', 'n7'])
})

test('the 41-agent fixture replays end to end', async () => {
  const events = journalToEvents(review41.journal, review41.metas, { runId: 'wf_review' })

  expect(events[0]).toEqual({ kind: 'run-start', runId: 'wf_review' })
  expect(events.filter(event => event.kind === 'agent-start').length).toBe(41)
  expect(events.filter(event => event.kind === 'agent-end').length).toBe(41)

  const running = reduceAll(events)
  expect(running.status).toBe('running')
  expect(Object.keys(running.agents).length).toBe(41)
  expect(statuses(running).every(status => status === 'done')).toBe(true)

  expect(running.byPhase).toEqual({
    Review: { total: 12, running: 0, done: 12, failed: 0, tokens: 0 },
    Foundation: { total: 4, running: 0, done: 4, failed: 0, tokens: 0 },
    Triage: { total: 12, running: 0, done: 12, failed: 0, tokens: 0 },
    Fix: { total: 12, running: 0, done: 12, failed: 0, tokens: 0 },
    Integrate: { total: 1, running: 0, done: 1, failed: 0, tokens: 0 },
  })
  expect(sum(running.byPhase, 'total')).toBe(41)
  expect(sum(running.byPhase, 'done')).toBe(41)
  expect(sum(running.byPhase, 'running')).toBe(0)

  // Real labels look like `review:jobs`: no node ids, so every agent is unmapped.
  expect(running.byNode).toEqual({})
  expect(running.unmapped.length).toBe(41)
  expect(new Set(running.unmapped).size).toBe(41)

  const done = reduce(running, { kind: 'run-end', runId: 'wf_review', ok: true })
  expect(done.status).toBe('done')
  expect(Object.keys(done.agents).length).toBe(41)
})

test('fixture metas agree with the journal, so either source gives the same run', async () => {
  for (const { journal, metas } of FIXTURES) {
    const stripped = journal
      .split('\n')
      .filter(Boolean)
      .map((line: string) => {
        const { label: _label, phase: _phase, ...rest } = JSON.parse(line)
        return JSON.stringify(rest)
      })
      .join('\n')

    expect(journalToEvents(stripped, metas)).toEqual(journalToEvents(journal))
    expect(reduceAll(journalToEvents(stripped)).byPhase).toEqual({})
  }
})

test('the partial fixture leaves unfinished agents running', async () => {
  const state = reduceAll(journalToEvents(partial29.journal, partial29.metas))

  expect(Object.keys(state.agents).length).toBe(29)
  expect(statuses(state).filter(status => status === 'done').length).toBe(26)
  expect(statuses(state).filter(status => status === 'running').length).toBe(3)
  expect(sum(state.byPhase, 'total')).toBe(29)
  expect(sum(state.byPhase, 'done')).toBe(26)
  expect(sum(state.byPhase, 'running')).toBe(3)
  expect(sum(state.byPhase, 'failed')).toBe(0)
  expect(Object.keys(state.byPhase)).toEqual(['Review', 'Triage', 'Implement', 'Integrate'])
})

test('fixtures carry no result payloads', async () => {
  for (const { journal, metas } of FIXTURES) {
    for (const line of journal.split('\n').filter(Boolean)) {
      const entry = JSON.parse(line)
      if (entry.type === 'result') expect(entry.result === true || entry.result === null).toBe(true)
      expect(line.length).toBeLessThan(160)
    }
    for (const meta of Object.values(metas)) {
      expect(Object.keys(meta).sort()).toEqual(['description', 'workflowPhase'])
    }
  }
})

test('sumUsage totals all four usage counts once per message', async () => {
  const usage = (input_tokens: number, output_tokens: number) => ({ input_tokens, output_tokens, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 })
  const text = jsonl(
    { type: 'user', message: { role: 'user', content: 'hi' } },
    { type: 'attachment' },
    // One API message written as three lines repeating the same usage.
    { type: 'assistant', message: { id: 'msg_1', usage: usage(10, 5) } },
    { type: 'assistant', message: { id: 'msg_1', usage: usage(10, 5) } },
    { type: 'assistant', message: { id: 'msg_1', usage: usage(10, 40) } },
    { type: 'assistant', message: { id: 'msg_2', usage: usage(3, 7) } },
    { type: 'assistant', message: { usage: usage(1, 1) } },
    { type: 'assistant', message: { usage: usage(1, 1) } },
  )

  // Each counted message also carries 9500 cache tokens.
  expect(sumUsage(text)).toBe(50 + 10 + 2 + 2 + 4 * 9500)
})

test('sumUsage survives malformed transcripts', async () => {
  const text = [
    'garbage',
    '{"type":"assistant","message":{"id":"m","usage":{"input_tokens":4',
    'null',
    '[]',
    JSON.stringify({ type: 'assistant' }),
    JSON.stringify({ type: 'assistant', message: null }),
    JSON.stringify({ type: 'assistant', message: 'text' }),
    JSON.stringify({ type: 'assistant', message: { id: 'a', usage: null } }),
    JSON.stringify({ type: 'assistant', message: { id: 'b', usage: { input_tokens: '12', output_tokens: -3 } } }),
    JSON.stringify({ type: 'assistant', message: { id: 'c', usage: { output_tokens: 6 } } }),
    JSON.stringify({ type: 'assistant', message: { id: 'd', usage: { input_tokens: 2, output_tokens: 3 } } }),
  ].join('\n')

  expect(sumUsage(text)).toBe(11)
  expect(sumUsage('')).toBe(0)
  expect(sumUsage(undefined as unknown as string)).toBe(0)
})

test('journalPhases maps each started agent to its phase, or null when it has none', async () => {
  const phases = journalPhases(
    jsonl(
      { type: 'launched' },
      { type: 'started', agentId: 'a1', label: 'n1: plan', phase: 'Plan' },
      { type: 'started', agentId: 'a2', label: 'n2: build' },
      { type: 'started', agentId: 'a3', phase: '' },
      { type: 'started', phase: 'No agent' },
      '{"type":"started","agentId":"a4","pha',
      { type: 'result', agentId: 'a9', phase: 'Not a start' },
    ),
  )

  expect([...phases]).toEqual([
    ['a1', 'Plan'],
    ['a2', null],
    ['a3', null],
  ])
  expect(journalPhases(review41.journal).size).toBe(41)
  expect(journalPhases(undefined as unknown as string).size).toBe(0)
})
