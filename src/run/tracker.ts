import { endText, statusText } from '../ui/rail'

import { emptyRunState } from './events'
import type { RunEvent, RunState } from './events'
import { journalPhases, journalResults } from './journal'
import { reduce, remap } from './reducer'
import type { Mapping } from './reducer'
import { replayDue } from './replay'

// Decides when things happen for a live run: which agents count, when the state is written, the journal read, the run ended.
// Reaches everything outside through a TrackerHost, so it runs under a fake host in tests.

export const TICK_MS = 96
/**
 * Every agent that ended since the last spawn was aborted, none runs, and no spawn came for this long: the run was stopped
 * where the engine sends no notice of it (the workflow view). A skipped agent is aborted too, and its run spawns on at once.
 */
export const STOPPED_MS = 8000
/** A handoff waits this long for a run under another name than its project's; a prompt from the person starts the wait again. */
export const HANDOFF_MS = 180_000
/** A slow replay spreads its events over this long. */
export const REPLAY_MS = 10_000
/** An agent neither heard from (a spawn, a usage count) nor ended for this long is held failed, so its run can end. */
export const STALE_MS = 30 * 60_000

// In ticks. A full state write may go out every tick (~10/s); the rest are slower.
const USAGE_EVERY = 5
const JOURNAL_EVERY = 5
const PANE_EVERY = 10
/** Journal reads an agent may miss before its phase is given up on. */
const JOURNAL_TRIES = 8
const STALE_TICKS = Math.ceil(STALE_MS / TICK_MS)

export type Timer = { cancel: () => void }

export type TrackerHost = {
  write: (state: RunState) => unknown
  /** Stores the tick clock (ms), which the pane's spinner follows. */
  frame: (now: number) => unknown
  readText: (path: string) => Promise<string>
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  paneShown: () => Promise<boolean>
  status: (text: string | undefined) => unknown
  toast: (text: string) => unknown
  /** Null: the run was not started from a project. */
  project?: (name: string | null) => unknown
  /** A real run (not a replay) ended; `project` is the one it was tracked as. */
  ended?: (end: RunEnded) => unknown
}

/** A project's claim on a run: handed off, the next run to start is its run; adopted, the run already tracked is. */
export type Handoff = { name: string; nodeIds: readonly string[]; titles?: Readonly<Record<string, string>>; match?: Readonly<Record<string, readonly string[]>> }

type Claim = Mapping & { name: string; titles?: Readonly<Record<string, string>> }

const claimOf = (from: Handoff): Claim => ({ name: from.name, ids: new Set(from.nodeIds), titles: from.titles, match: from.match })

/** `project`: the saved project the run's workflow is named as; the run is that project's, handed off or not. */
export type RunStarted = { runId: string; name?: string; transcriptDir?: string; taskId?: string; project?: Handoff }
export type AgentSpawned = { runId: string; agentId: string; label: string; index?: number }
export type AgentEnded = { ok: boolean; aborted?: boolean; durationMs?: number }

export type Tracker = ReturnType<typeof createTracker>

const hasRunning = (state: RunState): boolean => Object.values(state.agents).some(agent => agent.status === 'running')

export type Ending = 'done' | 'failed' | 'stopped'

export type RunEnded = { runId: string; ending: Ending; project?: string }

/** The words a task notification ends with: `completed`, `failed`, `killed`, or another its producer wrote. */
const endingOf = (status: string): Ending => (status === 'completed' ? 'done' : status === 'killed' ? 'stopped' : 'failed')

export function createTracker() {
  let host: TrackerHost | undefined
  let state = emptyRunState()
  /** 0 clean, 1 token counts only, 2 anything else. */
  let dirty: 0 | 1 | 2 = 0
  let ticker: Timer | undefined
  let stopWait: Timer | undefined
  let replaying: Timer | undefined
  let ticks = 0
  let lastRead = -JOURNAL_EVERY
  let reading = false
  let shown = false
  let lastStatus: string | undefined
  /** The handoff waiting for its run, and the one the tracked run came from. */
  let pending: Claim | undefined
  let active: Claim | undefined
  let expiry: Timer | undefined
  /** The project whose handoff is being worked on: from the handoff until the person's next prompt after its claim is spent. A run of it meanwhile (the first, a retry) comes out of the handoff. */
  let handed: string | undefined
  let replayed = false
  /** Agents ended since the last spawn, and whether every one of them was aborted. */
  let ends = 0
  let abortedOnly = true

  /** Agents of the tracked run still running, with their latest request's token count: its context, which the built-in workflow row shows. */
  const latest = new Map<string, number>()
  /** Agents waiting for a phase, with the journal reads that missed them. */
  const noPhase = new Map<string, number>()
  /** The tick each agent was last heard from: its spawn, or a usage count. */
  const heard = new Map<string, number>()
  /** Runs a newer one replaced: their late agents are not this run's. */
  const superseded = new Set<string>()

  // A host call must never break tracking: its failure is the host's to report.
  const call = (fn: (host: TrackerHost) => unknown): void => {
    if (!host) return
    try {
      Promise.resolve(fn(host)).catch(() => {})
    } catch {
      // ignored
    }
  }

  const isDirty = (): boolean => dirty !== 0

  const syncStatus = (): void => {
    const want = state.status === 'running' && !shown ? statusText(state, active?.titles) : undefined
    if (want === lastStatus) return
    lastStatus = want
    call(h => h.status(want))
  }

  const flush = (): void => {
    dirty = 0
    const snapshot = state
    call(h => h.write(snapshot))
    syncStatus()
  }

  const pollPane = (): void => {
    if (!host) return
    host.paneShown().then(
      isShown => {
        if (isShown === shown) return
        shown = isShown
        syncStatus()
      },
      () => {},
    )
  }

  const cancelStopWait = (): void => {
    stopWait?.cancel()
    stopWait = undefined
  }

  const looksStopped = (): boolean => ends > 0 && abortedOnly && !hasRunning(state)

  const armStopWait = (): void => {
    if (!host || stopWait) return
    stopWait = host.after(STOPPED_MS, () => {
      stopWait = undefined
      if (state.status === 'running' && looksStopped()) conclude('stopped')
    })
  }

  /** Ends the run as the engine says it ended. Agents still open (an end missed, as across a reload) take their journal result, else fail. */
  function conclude(ending: Ending, durationMs?: number): void {
    const runId = state.runId
    if (runId === undefined) return
    cancelStopWait()

    const close = (results: Map<string, boolean>): void => {
      if (state.runId !== runId) return
      const open = Object.values(state.agents).filter(agent => agent.status === 'running')
      for (const agent of open) latest.delete(agent.agentId)
      noPhase.clear()
      apply([
        ...open.map((agent): RunEvent => ({ kind: 'agent-end', agentId: agent.agentId, ok: results.get(agent.agentId) ?? false })),
        { kind: 'run-end', runId, ok: ending === 'done', stopped: ending === 'stopped', durationMs },
      ])
    }

    const dir = state.transcriptDir
    if (!host || dir === undefined || !hasRunning(state)) {
      close(new Map())

      return
    }
    host.readText(`${dir}/journal.jsonl`).then(
      text => close(journalResults(text)),
      () => close(new Map()),
    )
  }

  const readJournal = (): void => {
    lastRead = ticks
    const runId = state.runId
    const dir = state.transcriptDir
    if (!host || reading) return

    const settle = (phases: Map<string, string | null>): void => {
      reading = false
      if (state.runId !== runId) return

      const events: RunEvent[] = []
      for (const [agentId, misses] of [...noPhase]) {
        const phase = phases.get(agentId)
        const agent = state.agents[agentId]
        if (phase === undefined && agent && misses + 1 < JOURNAL_TRIES) {
          noPhase.set(agentId, misses + 1)
          continue
        }
        noPhase.delete(agentId)
        if (agent && typeof phase === 'string') {
          events.push({ kind: 'agent-start', runId: runId ?? '', agentId, label: agent.label, phase })
        }
      }
      apply(events)
    }

    if (dir === undefined) {
      settle(new Map())

      return
    }
    reading = true
    host.readText(`${dir}/journal.jsonl`).then(
      text => settle(journalPhases(text)),
      () => settle(new Map()),
    )
  }

  const stopTicker = (): void => {
    ticker?.cancel()
    ticker = undefined
  }

  /** An agent not heard from for STALE_MS is held failed: its end was missed, or never comes. */
  const closeStale = (): void => {
    const stale = Object.values(state.agents).filter(agent => agent.status === 'running' && ticks - (heard.get(agent.agentId) ?? 0) >= STALE_TICKS)
    if (stale.length === 0) return
    ends += stale.length
    abortedOnly = false
    for (const agent of stale) latest.delete(agent.agentId)
    apply(stale.map(agent => ({ kind: 'agent-end', agentId: agent.agentId, ok: false })))
  }

  const tick = (): void => {
    ticks++
    if (ticks % PANE_EVERY === 0) {
      pollPane()
      closeStale()
    }
    const running = hasRunning(state)

    let wrote = false
    if (dirty === 2 || (dirty === 1 && ticks % USAGE_EVERY === 0)) {
      flush()
      wrote = true
    }
    if (noPhase.size > 0 && ticks - lastRead >= JOURNAL_EVERY) readJournal()
    // One write a tick at most: the spinner holds its frame on a tick that wrote the state.
    if (running && shown && !wrote) call(h => h.frame(ticks * TICK_MS))
    if (!running && dirty === 0 && noPhase.size === 0 && !reading) stopTicker()
  }

  const startTicker = (): void => {
    if (!host || ticker) return
    pollPane()
    ticker = host.every(TICK_MS, tick)
  }

  const finish = (): void => {
    cancelStopWait()
    flush()
    const text = endText(state)
    call(h => h.toast(text))
    const { runId, status } = state
    const project = active?.name
    if (!replayed && runId !== undefined && status !== 'idle' && status !== 'running') call(h => h.ended?.({ runId, ending: status, project }))
  }

  function apply(events: readonly RunEvent[]): void {
    const before = state
    let wasRunning = state.status === 'running'
    for (const event of events) {
      const next = reduce(state, event, active)
      if (next === state) continue
      state = next
      wasRunning ||= state.status === 'running'
      if (event.kind === 'agent-start' || event.kind === 'agent-usage') heard.set(event.agentId, ticks)
      if (event.kind !== 'agent-usage') dirty = 2
      else if (dirty === 0) dirty = 1
    }
    if (state === before) return

    if (state.status === 'running') {
      if (looksStopped()) armStopWait()
      else cancelStopWait()
    }
    if (wasRunning && state.status !== 'running') finish()
    else startTicker()
  }

  const dropPending = (): void => {
    expiry?.cancel()
    expiry = undefined
    pending = undefined
  }

  const armExpiry = (): void => {
    expiry?.cancel()
    expiry = host?.after(HANDOFF_MS, dropPending)
  }

  /** Forgets the run held so far so that `runId` starts clean. `own` is the saved project the run is named as. */
  const begin = (runId: string, own?: Handoff): void => {
    replaying?.cancel()
    replaying = undefined
    cancelStopWait()
    replayed = false
    ends = 0
    abortedOnly = true
    latest.clear()
    noPhase.clear()
    heard.clear()
    if (own !== undefined) {
      // Named as a saved project: that project's run, whatever waits. A handoff of another project goes on waiting for its own.
      active = claimOf(own)
      if (pending?.name === own.name) dropPending()
      call(h => h.project?.(own.name))
    } else if (pending !== undefined || state.runId !== runId) {
      // Another run, or the one a handoff waited for: it belongs to that project, or to none.
      active = pending
      dropPending()
      // Said for every run, the same project's next one too: the host's copy is the session's and starts over on a /clear, this one does not.
      const name = active?.name ?? null
      call(h => h.project?.(name))
    }
    if (state.runId !== undefined && state.runId !== runId) superseded.add(state.runId)
    superseded.delete(runId)
  }

  /** The run tracked now is `claim`'s project's: every agent seen so far is placed again by it. */
  const take = (claim: Handoff): void => {
    const before = active
    active = claimOf(claim)
    if (pending?.name === claim.name) dropPending()
    if (active.name !== before?.name) call(h => h.project?.(claim.name))
    state = remap(state, active)
    flush()
  }

  /** Whether a real run holds the tracker: one running now, or the one a handoff waits for. A replay would take its place. */
  const busy = (): boolean => pending !== undefined || (state.status === 'running' && !replayed)

  return {
    /** The state as of every event so far (the stored copy may lag by a tick). */
    state: (): RunState => state,

    /** `stored` is the state a previous load of the module left: its run is picked up, with `claim` as its project (node ids are not stored). */
    attach(next: TrackerHost, stored?: RunState, claim?: Handoff): void {
      host = next
      if (stored && state.status === 'idle' && Object.keys(state.agents).length === 0) {
        state = stored
        if (claim && state.status !== 'idle') active = claimOf(claim)
        for (const agent of Object.values(state.agents)) {
          if (agent.status !== 'running') continue
          latest.set(agent.agentId, agent.tokens)
          heard.set(agent.agentId, ticks)
        }
      }
      if (state.status === 'running') startTicker()
    },

    /** The first run to start within HANDOFF_MS is the project's; then the claim drops, so a later unrelated run is not taken. */
    handoff(next: Handoff): void {
      dropPending()
      pending = claimOf(next)
      handed = next.name
      armExpiry()
    },

    /**
     * While a handoff waits, a prompt is the person answering Claude about the project: the wait starts again.
     * With none waiting the handoff's work is over: a later run of the project is one asked for anew.
     */
    prompted(): void {
      if (pending === undefined) handed = undefined
      else armExpiry()
    },

    /** Returns the labels of the agents no block claims, one per agent; null with no run to give the project to. */
    adopt(claim: Handoff): string[] | null {
      if (state.status === 'idle') return null
      take(claim)
      return state.unmapped.map(id => state.agents[id]?.label ?? '')
    },

    /** A project is handed off and its run has not started: Claude is writing the script for it. */
    awaitsRun: (): boolean => pending !== undefined,

    busy,

    project: (): string | undefined => active?.name,

    /** Whether the tracked run comes out of a handoff of its project (the run it waited for, or a retry of it), not only out of its name. */
    handedOff: (): boolean => active !== undefined && active.name === handed,

    /** Whether the run held is a replay, not one the engine ran. */
    replayed: (): boolean => replayed,

    paneOpened(): void {
      shown = true
      syncStatus()
    },

    runStarted(run: RunStarted): void {
      const isNew = state.runId !== run.runId || state.status !== 'running'
      if (isNew) begin(run.runId, run.project)
      apply([{ kind: 'run-start', runId: run.runId, name: run.name, transcriptDir: run.transcriptDir || undefined, taskId: run.taskId || undefined }])
      // Its agents were seen before the run was announced, so it began with no name: they are placed again by its project.
      if (!isNew && run.project !== undefined && active?.name !== run.project.name) take(run.project)
    },

    agentSpawned(agent: AgentSpawned): void {
      if (superseded.has(agent.runId)) return
      if (state.runId !== agent.runId) {
        begin(agent.runId)
        apply([{ kind: 'run-start', runId: agent.runId }])
      }
      cancelStopWait()
      ends = 0
      abortedOnly = true
      latest.set(agent.agentId, 0)
      noPhase.set(agent.agentId, 0)
      apply([{ kind: 'agent-start', runId: agent.runId, agentId: agent.agentId, label: agent.label, index: agent.index }])
      if (ticks - lastRead >= JOURNAL_EVERY) readJournal()
    },

    /** `tokens`: one request's four usage counts. Each request re-reads the whole prompt, so a sum would count it once per request. */
    agentUsage(agentId: string, tokens: number): void {
      if (!latest.has(agentId) || !Number.isFinite(tokens) || tokens <= 0) return
      latest.set(agentId, tokens)
      apply([{ kind: 'agent-usage', agentId, tokens }])
    },

    agentEnded(agentId: string, end: AgentEnded): void {
      const tokens = latest.get(agentId)
      if (tokens === undefined) return
      latest.delete(agentId)
      ends++
      abortedOnly &&= end.aborted === true
      apply([{ kind: 'agent-end', agentId, ok: end.ok, durationMs: end.durationMs, tokens }])
    },

    /**
     * The engine's notice that task `taskId` ended, with its status word. Said again for every drawing of the notice: only the
     * first counts. A run held stopped for want of a notice takes the status a later one gives.
     */
    taskEnded(taskId: string, status: string, durationMs?: number): void {
      if (state.taskId === undefined || state.taskId !== taskId) return
      const ending = endingOf(status)
      if (state.status === ending || (state.status !== 'running' && state.status !== 'stopped')) return
      conclude(ending, durationMs)
    },

    /** Refused (false) while `busy`: the real run's agents would be dropped as a superseded run's. */
    replay(events: readonly RunEvent[], mode: 'fast' | 'slow', own?: Handoff): boolean {
      if (busy()) return false
      const first = events.find(event => event.kind === 'run-start')
      begin(first?.kind === 'run-start' ? first.runId : '', own)
      replayed = true
      state = emptyRunState()
      dirty = 2

      if (mode === 'fast' || !host) {
        apply(events)
        if (isDirty()) flush()

        return true
      }

      const steps = Math.ceil(REPLAY_MS / TICK_MS)
      let step = 0
      let applied = 0
      const timer = host.every(TICK_MS, () => {
        step++
        const due = replayDue(events.length, step, steps)
        const slice = events.slice(applied, due)
        applied = due
        if (step >= steps) {
          timer.cancel()
          if (replaying === timer) replaying = undefined
        }
        apply(slice)
      })
      replaying = timer
      startTicker()

      return true
    },
  }
}
