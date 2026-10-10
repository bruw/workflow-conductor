import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { serializeDesign } from '../src/design/model'
import { designFile } from '../src/design/session'
import { review } from '../src/design/templates'
import type { RunState } from '../src/run/events'
import { HANDOFF_MS } from '../src/run/tracker'

// Which design a run belongs to: claimed by a handoff, dropped when no run follows,
// and found again after the plugin reloads mid-run.

const ROOT = '/project'
const RUN = { command: 'conductor', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const SPAWN = {
  tool_use_id: 'toolu_1',
  prompt: 'Reply with the single word ok',
  subagentType: 'workflow-subagent',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
} as const

type World = { run: RunState | undefined; runDesign: string | null | undefined; reads: string[]; clock: { advance: (ms: number) => Promise<unknown> } }

const world = (on: On): World => {
  const files = new Map([[designFile(ROOT, 'kept'), serializeDesign({ ...review(), name: 'kept' })]])
  const seen: World = { run: undefined, runDesign: undefined, reads: [], clock: mock.clock(on) }
  let spawned = 0
  on('state.set', (_$, e, next) => {
    if (e.plugin === 'conductor' && e.key === 'run') seen.run = e.value
    if (e.plugin === 'conductor' && e.key === 'runDesign') seen.runDesign = e.value

    return next(e)
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_$, e) => {
    seen.reads.push(e.path)

    return { value: files.get(e.path) ?? '' }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Workflow' }, async () => ({
    result: { status: 'async_launched' as const, taskId: 't1', runId: 'wf_1', workflowName: 'demo', transcriptDir: '/t/wf_1' },
  }))
  on('agent.spawn', async () => ({ model: 'claude-haiku-5-5', agentId: `agent${++spawned}` }))

  return seen
}

const settle = async (clock: World['clock'], ms: number): Promise<void> => {
  await clock.advance(ms)
  for (let turn = 0; turn < 50; turn++) await Promise.resolve()
}

const nodeIds = (run: RunState | undefined): (string | undefined)[] => Object.values(run?.agents ?? {}).map(agent => agent.nodeId)

test('a handoff claims the first workflow run that starts in time; a second start of the session keeps the claim', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ ...RUN, args: 'run kept' })).text).toMatch(/handing off design "kept"/)
  await settle(seen.clock, HANDOFF_MS - 1000)

  await $.tool.call({ tool: 'Workflow', script: 'export const meta = {}' })
  await $.agent.spawn({ ...SPAWN, description: 'n1: scout', workflow: { runId: 'wf_1', agentIndex: 1 } })
  // n99 is no node of the design: with the design's ids known it is unmapped.
  await $.agent.spawn({ ...SPAWN, description: 'n99: stray', workflow: { runId: 'wf_1', agentIndex: 2 } })
  await settle(seen.clock, 600)
  expect(seen.runDesign).toBe('kept')
  expect(nodeIds(seen.run)).toEqual(['n1', undefined])

  // The session starts again with the state kept (a reload): the design file is read
  // again for its ids, and the run is still the design's.
  const before = seen.reads.filter(path => path === designFile(ROOT, 'kept')).length
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(seen.reads.filter(path => path === designFile(ROOT, 'kept')).length).toBe(before + 1)
  await $.agent.spawn({ ...SPAWN, description: 'n98: stray', workflow: { runId: 'wf_1', agentIndex: 3 } })
  await settle(seen.clock, 600)
  expect(seen.runDesign).toBe('kept')
  expect(nodeIds(seen.run)).toEqual(['n1', undefined, undefined])
})

test('a handoff no run followed expires: a workflow run started later is not the design\'s', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, args: 'run kept' })
  await settle(seen.clock, HANDOFF_MS + 1000)

  await $.tool.call({ tool: 'Workflow', script: 'export const meta = {}' })
  await $.agent.spawn({ ...SPAWN, description: 'n99: other', workflow: { runId: 'wf_1', agentIndex: 1 } })
  await settle(seen.clock, 600)
  expect(seen.run?.status).toBe('running')
  // Unattached: no design is recorded, so /conductor opens the phase view, and labels are taken as they come.
  expect(seen.runDesign ?? null).toBe(null)
  expect(nodeIds(seen.run)).toEqual(['n99'])
})
