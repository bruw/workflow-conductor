import { expect, test } from 'claude-code/testing'

import type { RunState } from '../src/run/events'
import { replayDue, replayEvents } from '../src/run/replay'
import { createTracker, HANDOFF_MS, REPLAY_MS, STOPPED_MS, TICK_MS } from '../src/run/tracker'
import type { TrackerHost } from '../src/run/tracker'
import * as review41 from '../fixtures/review-41'

// A host in memory: timers fire when the test moves the time, everything else is recorded.
function fakeHost(journal: () => string = () => '') {
  type Pending = { at: number; every?: number; fn: () => void; off: boolean }
  const timers: Pending[] = []
  const log = { writes: [] as RunState[], frames: [] as number[], reads: [] as number[], statuses: [] as (string | undefined)[], toasts: [] as string[] }
  let now = 0
  let shown = false

  const add = (ms: number, fn: () => void, every?: number) => {
    const timer: Pending = { at: now + ms, every, fn, off: false }
    timers.push(timer)

    return { cancel: () => void (timer.off = true) }
  }
  const host: TrackerHost = {
    write: state => void log.writes.push(state),
    frame: at => void log.frames.push(at),
    readText: async () => {
      log.reads.push(now)

      return journal()
    },
    every: (ms, fn) => add(ms, fn, ms),
    after: (ms, fn) => add(ms, fn),
    paneShown: async () => shown,
    status: text => void log.statuses.push(text),
    toast: text => void log.toasts.push(text),
  }
  const advance = async (ms: number) => {
    const until = now + ms
    for (;;) {
      const due = timers.filter(timer => !timer.off && timer.at <= until).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      now = due.at
      if (due.every === undefined) due.off = true
      else due.at += due.every
      due.fn()
      await Promise.resolve()
      await Promise.resolve()
    }
    now = until
    await Promise.resolve()
  }

  return { host, log, advance, live: () => timers.filter(timer => !timer.off).length, show: (isShown: boolean) => void (shown = isShown) }
}

const started = (agentId: string, phase?: string) => `${JSON.stringify({ type: 'started', agentId, label: agentId, phase })}\n`

test('a burst of spawns reads the journal at most about twice a second', async () => {
  let journal = ''
  const { host, log, advance } = fakeHost(() => journal)
  const tracker = createTracker()
  tracker.attach(host)
  tracker.runStarted({ runId: 'wf_1', name: 'burst', transcriptDir: '/t/wf_1' })

  for (let i = 0; i < 16; i++) {
    journal += started(`a${i}`, 'One')
    tracker.agentSpawned({ runId: 'wf_1', agentId: `a${i}`, label: `a${i}` })
  }
  for (let i = 16; i < 56; i++) {
    await advance(50)
    journal += started(`a${i}`, 'Two')
    tracker.agentSpawned({ runId: 'wf_1', agentId: `a${i}`, label: `a${i}` })
  }
  await advance(1000)

  expect(log.reads.length).toBeLessThanOrEqual(7)
  for (let i = 1; i < log.reads.length; i++) expect((log.reads[i] ?? 0) - (log.reads[i - 1] ?? 0)).toBeGreaterThanOrEqual(5 * TICK_MS)
  expect(tracker.state().byPhase).toMatchObject({ One: { total: 16 }, Two: { total: 40 } })
  expect(Object.values(tracker.state().agents).every(agent => agent.phase !== undefined)).toBe(true)

  const reads = log.reads.length
  await advance(3000)
  expect(log.reads.length).toBe(reads)
})

test('an agent the journal never names is given up on, and stays without a phase', async () => {
  const { host, log, advance } = fakeHost(() => started('other', 'Elsewhere'))
  const tracker = createTracker()
  tracker.attach(host)
  tracker.runStarted({ runId: 'wf_1', transcriptDir: '/t/wf_1' })
  tracker.agentSpawned({ runId: 'wf_1', agentId: 'a1', label: 'lost' })

  await advance(20_000)
  const reads = log.reads.length
  expect(reads).toBeGreaterThan(0)
  await advance(20_000)
  expect(log.reads.length).toBe(reads)
  expect(tracker.state().agents.a1?.phase).toBe(undefined)
  expect(tracker.state().byPhase).toEqual({})
})

test('state writes are coalesced: full changes per tick, token counts twice a second', async () => {
  const { host, log, advance } = fakeHost(() => started('a1', 'One'))
  const tracker = createTracker()
  tracker.attach(host)
  tracker.runStarted({ runId: 'wf_1' })
  tracker.agentSpawned({ runId: 'wf_1', agentId: 'a1', label: 'a1' })
  tracker.agentSpawned({ runId: 'wf_1', agentId: 'a2', label: 'a2' })
  expect(log.writes.length).toBe(0)

  await advance(TICK_MS)
  expect(log.writes.length).toBe(1)
  expect(Object.keys(log.writes[0]?.agents ?? {})).toEqual(['a1', 'a2'])

  const before = log.writes.length
  for (let i = 0; i < 40; i++) {
    tracker.agentUsage('a1', 10)
    await advance(50)
  }
  const usageWrites = log.writes.length - before
  expect(usageWrites).toBeGreaterThanOrEqual(3)
  expect(usageWrites).toBeLessThanOrEqual(5)
  expect(tracker.state().agents.a1?.tokens).toBe(400)

  await advance(1000)
  expect(log.writes.at(-1)?.agents.a1?.tokens).toBe(400)
})

test('the tick runs only while something is running, and the spinner only while the pane shows', async () => {
  const { host, log, advance, live, show } = fakeHost(() => started('a1', 'One'))
  const tracker = createTracker()
  tracker.attach(host)
  expect(live()).toBe(0)

  tracker.runStarted({ runId: 'wf_1', transcriptDir: '/t/wf_1', taskId: 't1' })
  tracker.agentSpawned({ runId: 'wf_1', agentId: 'a1', label: 'a1' })
  await advance(2000)
  expect(log.frames).toEqual([])
  expect(typeof log.statuses.at(-1)).toBe('string')

  show(true)
  await advance(2000)
  expect(log.frames.length).toBeGreaterThan(5)
  expect(log.statuses.at(-1)).toBe(undefined)

  tracker.agentEnded('a1', { ok: true, tokens: 50 })
  await advance(500)
  const frames = log.frames.length
  // Nothing is pending while the run waits for the engine's notice of its end.
  expect(live()).toBe(0)
  expect(tracker.state().status).toBe('running')

  tracker.taskEnded('t1', 'completed')
  await advance(500)
  expect(log.frames.length).toBe(frames)
  expect(tracker.state().status).toBe('done')
  expect(log.toasts).toHaveLength(1)
  expect(live()).toBe(0)
})

test("the run ends as the engine's notice of its task says; agents still open take their journal result", async () => {
  const journal = [{ type: 'result', agentId: 'a2', result: 'ok' }, { type: 'result', agentId: 'a3', result: null }].map(line => JSON.stringify(line)).join('\n')
  const { host, log, advance } = fakeHost(() => journal)
  const tracker = createTracker()
  tracker.attach(host)
  tracker.runStarted({ runId: 'wf_1', transcriptDir: '/t/wf_1', taskId: 't1' })
  for (const agentId of ['a1', 'a2', 'a3', 'a4']) tracker.agentSpawned({ runId: 'wf_1', agentId, label: agentId })
  tracker.agentEnded('a1', { ok: true })
  await advance(STOPPED_MS * 2)
  expect(tracker.state().status).toBe('running')

  tracker.taskEnded('t9', 'completed')
  await advance(200)
  expect(tracker.state().status).toBe('running')

  tracker.taskEnded('t1', 'failed', 5000)
  await advance(200)
  expect(tracker.state()).toMatchObject({ status: 'failed', durationMs: 5000 })
  expect(Object.values(tracker.state().agents).map(agent => agent.status)).toEqual(['done', 'done', 'failed', 'failed'])
  expect(log.toasts).toHaveLength(1)

  // The notice is drawn again with every redraw of the transcript.
  tracker.taskEnded('t1', 'failed', 5000)
  await advance(200)
  expect(log.toasts).toHaveLength(1)
})

test('a run whose agents were all aborted is held stopped until a notice says otherwise; a skipped agent is no stop', async () => {
  const { host, log, advance } = fakeHost()
  const tracker = createTracker()
  tracker.attach(host)
  tracker.runStarted({ runId: 'wf_1', taskId: 't1' })
  tracker.agentSpawned({ runId: 'wf_1', agentId: 'a1', label: 'a1' })
  tracker.agentSpawned({ runId: 'wf_1', agentId: 'a2', label: 'a2' })
  tracker.agentEnded('a1', { ok: false, aborted: true })
  tracker.agentEnded('a2', { ok: true })
  await advance(STOPPED_MS + 200)
  expect(tracker.state().status).toBe('running')

  // Skipped: the agent is aborted and the script goes on at once.
  tracker.agentSpawned({ runId: 'wf_1', agentId: 'a3', label: 'a3' })
  tracker.agentEnded('a3', { ok: false, aborted: true })
  await advance(STOPPED_MS - 200)
  tracker.agentSpawned({ runId: 'wf_1', agentId: 'a4', label: 'a4' })
  await advance(STOPPED_MS + 200)
  expect(tracker.state().status).toBe('running')

  tracker.agentEnded('a4', { ok: false, aborted: true })
  await advance(STOPPED_MS + 200)
  expect(tracker.state().status).toBe('stopped')
  expect(log.toasts).toHaveLength(1)

  tracker.taskEnded('t1', 'completed')
  await advance(200)
  expect(tracker.state().status).toBe('done')
  expect(log.toasts).toHaveLength(1)

  // A stop of the task, as Claude's TaskStop says it: the agents still running fail with it.
  const other = createTracker()
  other.attach(fakeHost().host)
  other.runStarted({ runId: 'wf_2', taskId: 't2' })
  other.agentSpawned({ runId: 'wf_2', agentId: 'b1', label: 'b1' })
  other.taskEnded('t2', 'killed')
  expect(other.state().status).toBe('stopped')
  expect(other.state().agents.b1?.status).toBe('failed')
})

test('a newer run takes over; late agents of the old one are ignored', async () => {
  const { host, advance } = fakeHost()
  const tracker = createTracker()
  tracker.attach(host)
  tracker.runStarted({ runId: 'wf_1', name: 'old' })
  tracker.agentSpawned({ runId: 'wf_1', agentId: 'a1', label: 'old agent' })
  tracker.runStarted({ runId: 'wf_2', name: 'new' })
  tracker.agentSpawned({ runId: 'wf_2', agentId: 'b1', label: 'new agent' })
  tracker.agentSpawned({ runId: 'wf_1', agentId: 'a2', label: 'late old agent' })
  tracker.agentUsage('a1', 500)
  tracker.agentEnded('a1', { ok: false })
  await advance(200)

  expect(tracker.state()).toMatchObject({ runId: 'wf_2', name: 'new', status: 'running' })
  expect(Object.keys(tracker.state().agents)).toEqual(['b1'])
  expect(tracker.state().agents.b1?.tokens).toBe(0)
})

test('a stored run is picked up after a reload', async () => {
  const first = createTracker()
  const one = fakeHost()
  first.attach(one.host)
  first.runStarted({ runId: 'wf_1', taskId: 't1' })
  first.agentSpawned({ runId: 'wf_1', agentId: 'a1', label: 'a1' })
  first.agentUsage('a1', 300)
  await one.advance(1000)

  const two = fakeHost()
  const second = createTracker()
  second.attach(two.host, one.log.writes.at(-1))
  second.agentUsage('a1', 100)
  second.agentEnded('a1', { ok: true })
  // The task the run is, kept in the stored state, is what the notice names.
  second.taskEnded('t1', 'completed')
  await two.advance(200)

  expect(second.state().agents.a1).toMatchObject({ status: 'done', tokens: 400 })
  expect(second.state().status).toBe('done')
})

test('a run picked up after a reload keeps its project and the known node ids', async () => {
  const first = createTracker()
  const one = fakeHost()
  first.attach(one.host)
  first.handoff({ name: 'demo', nodeIds: ['n1', 'n2'] })
  first.runStarted({ runId: 'wf_1' })
  first.agentSpawned({ runId: 'wf_1', agentId: 'a1', label: 'n1: one' })
  await one.advance(1000)

  // Without the claim the reloaded tracker would take any `nN` label as a node.
  const two = fakeHost()
  const second = createTracker()
  second.attach(two.host, one.log.writes.at(-1), { name: 'demo', nodeIds: ['n1', 'n2'] })
  second.agentSpawned({ runId: 'wf_1', agentId: 'a2', label: 'n2: two' })
  second.agentSpawned({ runId: 'wf_1', agentId: 'a3', label: 'n7: stray' })
  expect(second.project()).toBe('demo')
  expect(second.state().agents.a2?.nodeId).toBe('n2')
  expect(second.state().agents.a3?.nodeId).toBe(undefined)

  const third = createTracker()
  third.attach(fakeHost().host, undefined, { name: 'demo', nodeIds: ['n1'] })
  expect(third.project()).toBe(undefined)
})

test('a handoff holds until the first run starts or three minutes pass', async () => {
  const projects: (string | null)[] = []
  const taken = fakeHost()
  const tracker = createTracker()
  tracker.attach({ ...taken.host, project: name => void projects.push(name) })
  tracker.handoff({ name: 'demo', nodeIds: ['n1'] })
  await taken.advance(HANDOFF_MS - 1)
  tracker.runStarted({ runId: 'wf_1' })
  expect(tracker.project()).toBe('demo')
  expect(projects).toEqual(['demo'])
  tracker.runStarted({ runId: 'wf_2' })
  expect(tracker.project()).toBe(undefined)
  expect(projects).toEqual(['demo', null])

  const late = fakeHost()
  const other = createTracker()
  other.attach(late.host)
  other.handoff({ name: 'demo', nodeIds: ['n1'] })
  await late.advance(HANDOFF_MS)
  other.runStarted({ runId: 'wf_9' })
  other.agentSpawned({ runId: 'wf_9', agentId: 'a1', label: 'n5: other' })
  expect(other.project()).toBe(undefined)
  expect(other.state().agents.a1?.nodeId).toBe('n5')

  const again = fakeHost()
  const third = createTracker()
  third.attach(again.host)
  third.handoff({ name: 'one', nodeIds: [] })
  await again.advance(HANDOFF_MS - 1000)
  third.handoff({ name: 'two', nodeIds: [] })
  await again.advance(HANDOFF_MS - 1000)
  third.runStarted({ runId: 'wf_3' })
  expect(third.project()).toBe('two')
})

test('a slow replay spreads the fixture over ten seconds; a fast one lands at once', async () => {
  const events = replayEvents('review-41', review41)
  const slow = fakeHost()
  const tracker = createTracker()
  tracker.attach(slow.host)
  tracker.replay(events, 'slow')

  await slow.advance(REPLAY_MS / 2)
  const mid = tracker.state()
  expect(mid.status).toBe('running')
  expect(Object.keys(mid.agents).length).toBeGreaterThan(5)
  expect(Object.keys(mid.agents).length).toBeLessThan(41)
  expect(slow.log.toasts).toEqual([])

  await slow.advance(REPLAY_MS / 2 + 200)
  expect(tracker.state().status).toBe('done')
  expect(Object.keys(tracker.state().agents).length).toBe(41)
  expect(slow.log.writes.at(-1)).toEqual(tracker.state())
  expect(slow.log.toasts.length).toBe(1)
  await slow.advance(500)
  expect(slow.live()).toBe(0)

  const fast = fakeHost()
  const other = createTracker()
  other.attach(fast.host)
  other.replay(events, 'fast')
  expect(fast.log.writes.length).toBe(1)
  expect(fast.log.writes[0]).toEqual(tracker.state())
  expect(fast.log.toasts.length).toBe(1)
})

test('replayDue hands out every event exactly once', async () => {
  expect(replayDue(83, 0, 105)).toBe(0)
  expect(replayDue(83, 105, 105)).toBe(83)
  expect(replayDue(83, 200, 105)).toBe(83)
  expect(replayDue(10, 1, 0)).toBe(10)
  for (let step = 1; step <= 105; step++) expect(replayDue(83, step, 105)).toBeGreaterThanOrEqual(replayDue(83, step - 1, 105))
})
