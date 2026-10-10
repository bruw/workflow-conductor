import { expect, mock, test } from 'claude-code/testing'

import type { RunState } from '../src/run/events'
import { QUIET_MS } from '../src/run/tracker'

const DIR = '/projects/demo/session/subagents/workflows/wf_1'
const RUN = { plugin: 'conductor', key: 'run' } as const

const usage = (input: number, output: number) => ({
  input_tokens: input,
  output_tokens: output,
  // Cache counts dwarf the rest in real runs and must not reach the figure shown.
  cache_read_input_tokens: 50_000,
  cache_creation_input_tokens: 30_000,
  model: 'claude-haiku-5-5',
})

const SPAWN = {
  tool_use_id: 'toolu_1',
  prompt: 'Reply with the single word ok',
  subagentType: 'workflow-subagent',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
} as const

test('a workflow run is followed from launch to the quiet end', async ($, on) => {
  const clock = mock.clock(on)
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const phases: Record<string, string> = { 'n1: one': 'Alpha', 'n1: two': 'Alpha', 'n2: three': 'Beta', 'n2: four': 'Beta' }
  let journal = '{"type":"launched"}\n'
  let journalReads = 0
  let spawned = 0

  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.status', async (_$, e) => {
    statuses.push(e.text)

    return { value: undefined }
  })
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('fs.read', async (_$, e) => {
    if (e.path !== `${DIR}/journal.jsonl`) throw new Error(`unexpected read of ${e.path}`)
    journalReads++

    return { value: journal }
  })
  on('tool.call', { tool: 'Workflow' }, async () => ({
    result: { status: 'async_launched' as const, taskId: 't1', runId: 'wf_1', workflowName: 'demo', transcriptDir: DIR },
  }))
  // As the engine: the journal has the agent's `started` line once the spawn resolved.
  on('agent.spawn', async (_$, e) => {
    const agentId = `agent${++spawned}`
    if (e.workflow) journal += `${JSON.stringify({ type: 'started', key: `k${spawned}`, agentId, label: e.description, phase: phases[e.description] })}\n`

    return { model: 'claude-haiku-5-5', agentId }
  })
  on('turn.step', async function* (_$, e) {
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: usage(100, 20) }

    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage: usage(100, 20) }
  })
  on('turn.complete', async (_$, e) => ({ text: e.answer }))

  // The kit keeps `$.state`; the test reads what the mod last wrote on its way down.
  let written: RunState | undefined
  on('state.set', RUN, (_$, e, next) => {
    written = e.value

    return next(e)
  })
  const stored = async (): Promise<RunState> => written as RunState
  const step = async (agentId: string | undefined) => {
    for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId })) void chunk
  }
  const complete = (agentId: string | undefined, isAborted = false) =>
    $.turn.complete({
      answer: 'ok',
      durationMs: 1136,
      isAborted,
      turnId: 't',
      agentId,
      reason: isAborted ? 'aborted' : 'answer',
      usage: usage(200, 40),
    })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Workflow', script: 'export const meta = {}' })

  // Parallel spawns arrive out of order; an ordinary subagent is none of the run's.
  const two = await $.agent.spawn({ ...SPAWN, description: 'n1: two', workflow: { runId: 'wf_1', agentIndex: 2 } })
  const one = await $.agent.spawn({ ...SPAWN, description: 'n1: one', workflow: { runId: 'wf_1', agentIndex: 1 } })
  const three = await $.agent.spawn({ ...SPAWN, description: 'n2: three', workflow: { runId: 'wf_1', agentIndex: 3 } })
  const stray = await $.agent.spawn({ ...SPAWN, description: 'an ordinary subagent' })
  const [a, b, c] = [two.agentId, one.agentId, three.agentId] as [string, string, string]

  // Nothing is stored until the tick; three spawns cost one journal read.
  expect(journalReads).toBe(1)
  await clock.advance(600)
  expect(journalReads).toBe(2)

  let state = await stored()
  expect(state.status).toBe('running')
  expect(state.runId).toBe('wf_1')
  expect(state.name).toBe('demo')
  expect(Object.keys(state.agents)).toEqual([a, b, c])
  expect(state.agents[a]).toMatchObject({ label: 'n1: two', phase: 'Alpha', nodeId: 'n1', status: 'running' })
  expect(state.agents[c]).toMatchObject({ label: 'n2: three', phase: 'Beta', nodeId: 'n2' })
  expect(state.byPhase).toEqual({
    Alpha: { total: 2, running: 2, done: 0, failed: 0, tokens: 0 },
    Beta: { total: 1, running: 1, done: 0, failed: 0, tokens: 0 },
  })
  expect(statuses.at(-1)).toBe('wf 0/3 ▸ Beta')

  // Usage is a running total per agent; the main loop and the stray agent are ignored.
  await step(a)
  await step(a)
  await step(undefined)
  await step(stray.agentId)
  await clock.advance(600)
  state = await stored()
  expect(state.agents[a]?.tokens).toBe(240)
  expect(state.byPhase.Alpha?.tokens).toBe(240)
  expect(Object.keys(state.agents).length).toBe(3)

  await complete(a)
  await complete(b, true)
  await complete(undefined)
  await complete(stray.agentId)
  await clock.advance(200)
  state = await stored()
  expect(state.agents[a]).toMatchObject({ status: 'done', tokens: 240, durationMs: 1136 })
  expect(state.agents[b]).toMatchObject({ status: 'failed' })
  expect(state.status).toBe('running')
  expect(statuses.at(-1)).toBe('wf 2/3 ▸ Beta')

  // One agent still runs: no amount of quiet ends the run.
  await clock.advance(QUIET_MS + 1000)
  expect((await stored()).status).toBe('running')

  await complete(c)
  await clock.advance(QUIET_MS - 500)
  expect((await stored()).status).toBe('running')
  expect(toasts).toEqual([])

  await clock.advance(600)
  state = await stored()
  expect(state.status).toBe('done')
  expect(statuses.at(-1)).toBe(undefined)
  expect(toasts).toEqual(['wf demo done: 2/3 agents · 1 failed · 720 tokens'])

  // A late spawn for the same run reopens it, and the next quiet period closes it again.
  const late = await $.agent.spawn({ ...SPAWN, description: 'n2: four', workflow: { runId: 'wf_1', agentIndex: 4 } })
  await clock.advance(200)
  expect((await stored()).status).toBe('running')
  await complete(late.agentId)
  await clock.advance(QUIET_MS + 100)
  state = await stored()
  expect(state.status).toBe('done')
  expect(state.byPhase.Beta).toMatchObject({ total: 2, done: 2 })
  expect(toasts.length).toBe(2)
})
