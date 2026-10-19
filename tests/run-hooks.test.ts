import { expect, mock, test } from 'claude-code/testing'

import { serializeProject } from '../src/project/model'
import { review } from '../src/project/templates'
import type { RunState } from '../src/run/events'
import { STOPPED_MS } from '../src/run/tracker'

const DIR = '/projects/demo/session/subagents/workflows/wf_1'
const RUN = { plugin: 'workflow-conductor', key: 'run' } as const

const usage = (input: number, output: number) => ({
  input_tokens: input,
  output_tokens: output,
  // Prompt tokens mostly arrive as cache counts: they are part of the figure, as in the built-in view.
  cache_read_input_tokens: 5,
  cache_creation_input_tokens: 3,
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

test("a workflow run is followed from launch to the engine's notice of its end", async ($, on) => {
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
  // A request's prompt grows with each one before it: its count is the messages it was sent over.
  on('turn.step', async function* (_$, e) {
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: usage(100 * e.messageCount, 20) }

    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage: usage(100 * e.messageCount, 20) }
  })
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.render', { component: 'UserMessage' }, async (_$, e) => ({ type: 'Text' as const, props: {}, children: [e.props.text] }))

  // The kit keeps `$.state`; the test reads what the mod last wrote on its way down.
  let written: RunState | undefined
  on('state.set', RUN, (_$, e, next) => {
    written = e.value

    return next(e)
  })
  const stored = async (): Promise<RunState> => written as RunState
  const step = async (agentId: string | undefined, messageCount = 1) => {
    for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount, agentId })) void chunk
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

  // The transcript drawing the row of a background task's notification.
  const noticeProps = (id: string, status: string, durationMs?: number) => ({ text: `Dynamic workflow ${status}`, origin: { kind: 'task-notification' as const }, isExpanded: false, task: { id, status, durationMs } })
  const notice = (id: string, status: string, durationMs?: number) =>
    $.ui.mount({ plugin: 'workflow-conductor', surface: 'terminal', component: 'UserMessage', requestId: `m-${id}`, props: noticeProps(id, status, durationMs) })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Workflow', script: 'export const meta = {}' })

  // Parallel spawns arrive out of order; an ordinary subagent is none of the run's.
  const two = await $.agent.spawn({ ...SPAWN, description: 'n1: two', workflow: { runId: 'wf_1', agentIndex: 2 } })
  const one = await $.agent.spawn({ ...SPAWN, description: 'n1: one', workflow: { runId: 'wf_1', agentIndex: 1 } })
  const three = await $.agent.spawn({ ...SPAWN, description: 'n2: three', workflow: { runId: 'wf_1', agentIndex: 3 } })
  const stray = await $.agent.spawn({ ...SPAWN, description: 'an ordinary subagent' })
  const [a, b, c] = [two.agentId, one.agentId, three.agentId] as [string, string, string]

  // Nothing is stored until the tick; a burst of spawns does not cost a journal read each.
  expect(journalReads).toBeLessThan(3)
  await clock.advance(600)

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
  expect(typeof statuses.at(-1)).toBe('string')

  await step(a)
  await step(a, 3)
  await step(undefined)
  await step(stray.agentId)
  await clock.advance(600)
  state = await stored()
  // The latest request's count, as the built-in workflow row shows it: each request re-reads the prompt, so a sum would count it twice.
  expect(state.agents[a]?.tokens).toBe(328)
  expect(state.byPhase.Alpha?.tokens).toBe(328)
  expect(Object.keys(state.agents).length).toBe(3)

  await complete(a)
  await complete(b, true)
  await complete(undefined)
  await complete(stray.agentId)
  await clock.advance(200)
  state = await stored()
  // The turn's own usage is its requests summed: the end keeps the latest request's count.
  expect(state.agents[a]).toMatchObject({ status: 'done', tokens: 328, durationMs: 1136 })
  expect(state.agents[b]).toMatchObject({ status: 'failed' })
  expect(state.status).toBe('running')
  expect(typeof statuses.at(-1)).toBe('string')

  await clock.advance(STOPPED_MS + 1000)
  expect((await stored()).status).toBe('running')

  // No agent runs, and nothing said the run ended: it waits for the engine's notice.
  await complete(c)
  await clock.advance(STOPPED_MS + 1000)
  expect((await stored()).status).toBe('running')
  expect(toasts).toEqual([])

  await notice('t2', 'completed')
  await clock.advance(200)
  expect((await stored()).status).toBe('running')

  const row = await notice('t1', 'completed', 9000)
  await clock.advance(200)
  state = await stored()
  expect(state).toMatchObject({ status: 'done', durationMs: 9000 })
  expect(statuses.at(-1)).toBe(undefined)
  expect(toasts).toHaveLength(1)

  // Drawn again with the transcript, the notice ends nothing twice.
  await row.redraw(noticeProps('t1', 'completed', 9000))
  await clock.advance(200)
  expect(toasts).toHaveLength(1)
})

test("Claude's stop of the run's task ends it stopped", async ($, on) => {
  const clock = mock.clock(on)
  let spawned = 0
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('fs.read', async () => ({ value: '{"type":"launched"}\n' }))
  on('tool.call', { tool: 'Workflow' }, async () => ({ result: { status: 'async_launched' as const, taskId: 't1', runId: 'wf_1', workflowName: 'demo', transcriptDir: DIR } }))
  on('tool.call', { tool: 'TaskStop' }, async (_$, e) => ({ result: { message: 'stopped', task_id: e.task_id ?? '', task_type: 'local_workflow' } }))
  on('agent.spawn', async () => ({ model: 'claude-haiku-5-5', agentId: `agent${++spawned}` }))
  let written: RunState | undefined
  on('state.set', RUN, (_$, e, next) => {
    written = e.value

    return next(e)
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Workflow', script: 'export const meta = {}' })
  await $.agent.spawn({ ...SPAWN, description: 'n1: one', workflow: { runId: 'wf_1', agentIndex: 1 } })
  await $.tool.call({ tool: 'TaskStop', task_id: 't9' })
  await clock.advance(300)
  expect(written?.status).toBe('running')

  await $.tool.call({ tool: 'TaskStop', task_id: 't1' })
  await clock.advance(300)
  expect(written?.status).toBe('stopped')
  expect(Object.values(written?.agents ?? {}).map(agent => agent.status)).toEqual(['failed'])
})

test("a project's run that ended done is asked about after Claude's turn; a yes copies its script into the repo, and the same script asks nothing", async ($, on) => {
  const clock = mock.clock(on)
  const ROOT = '/work'
  const SCRIPT = '/projects/demo/session/workflows/scripts/demo-wf_1.js'
  const COPY = `${ROOT}/.claude/workflows/demo.js`
  const BODY = 'export const meta = { name: "demo", description: "d", phases: [] }\n'
  const files: Record<string, string> = { [`${ROOT}/.claude/workflow-conductor/demo.json`]: serializeProject({ ...review(), name: 'demo' }), [SCRIPT]: BODY }
  const asked: string[] = []
  const toasts: string[] = []
  let answer = 'Save to repo'
  let runs = 0

  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.root', async () => ({ value: ROOT }))
  on('tool.register', async (_$, e) => ({ value: { tool: e.name } }))
  on('session.surfaces', async () => ({ value: ['terminal' as const] }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('fs.exists', async (_$, e) => ({ value: files[e.path] !== undefined }))
  on('fs.read', async (_$, e) => {
    const body = files[e.path]
    if (body === undefined) throw new Error(`no file ${e.path}`)

    return { value: body }
  })
  on('fs.write', async (_$, e) => {
    files[e.path] = e.text

    return { value: undefined }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)

    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  on('tool.call', { tool: 'Workflow' }, async () => {
    runs++

    return { result: { status: 'async_launched' as const, taskId: `t${runs}`, runId: `wf_${runs}`, workflowName: 'demo', transcriptDir: DIR, scriptPath: SCRIPT } }
  })
  on('ui.render', { component: 'UserMessage' }, async (_$, e) => ({ type: 'Text' as const, props: {}, children: [e.props.text] }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))

  const notice = (id: string, status: string) =>
    $.ui.mount({ plugin: 'workflow-conductor', surface: 'terminal', component: 'UserMessage', requestId: `m-${id}`, props: { text: `Dynamic workflow ${status}`, origin: { kind: 'task-notification' as const }, isExpanded: false, task: { id, status } } })
  const mainTurnEnds = () => $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'main', reason: 'answer', usage: usage(1, 1) })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Workflow', script: BODY })
  await notice('t1', 'completed')
  await clock.advance(200)
  // Not while Claude answers the notice: once its turn ends.
  expect(asked).toEqual([])
  await mainTurnEnds()
  await clock.advance(200)
  expect(asked).toHaveLength(1)
  expect(files[COPY]).toBe(BODY)
  expect(toasts.some(line => line.includes('.claude/workflows/demo.js'))).toBe(true)

  // The same script again: it is the saved one, nothing to ask.
  await $.tool.call({ tool: 'Workflow', script: BODY })
  await notice('t2', 'completed')
  await clock.advance(200)
  await mainTurnEnds()
  await clock.advance(200)
  expect(asked).toHaveLength(1)

  // A changed script is asked about as an update, and a failed run is not asked about.
  files[SCRIPT] = `${BODY}// changed\n`
  await $.tool.call({ tool: 'Workflow', script: BODY })
  await notice('t3', 'failed')
  await clock.advance(200)
  await mainTurnEnds()
  await clock.advance(200)
  expect(asked).toHaveLength(1)
  answer = 'Not now'
  await $.tool.call({ tool: 'Workflow', script: BODY })
  await notice('t4', 'completed')
  await clock.advance(200)
  await mainTurnEnds()
  await clock.advance(200)
  expect(asked).toHaveLength(2)
  expect(asked[1]).not.toBe(asked[0])
  expect(files[COPY]).toBe(BODY)
})
