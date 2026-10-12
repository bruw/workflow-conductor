import { endText, statusText } from '../ui/rail'

import { emptyRunState } from './events'
import type { RunEvent, RunState } from './events'
import { journalPhases } from './journal'
import { reduce, remap } from './reducer'
import type { Mapping } from './reducer'
import { replayDue } from './replay'

// Decides WHEN things happen for a live run: which agents count, when the state is
// written, when the journal is read, when the run is held finished. Everything outside
// reaches it through a TrackerHost, so it holds no `$` and runs under a fake host in tests.

export const TICK_MS = 96
/** No agent running and no spawn for this long: the run is held finished. */
export const QUIET_MS = 8000
/** A handoff waits this long for a run under another name than its design's; a prompt from the person starts the wait again. */
export const HANDOFF_MS = 180_000
/** A slow replay spreads its events over this long. */
export const REPLAY_MS = 10_000

// In ticks. A full state write may go out every tick (~10/s); the rest are slower.
const USAGE_EVERY = 5
const JOURNAL_EVERY = 5
const PANE_EVERY = 10
/** Journal reads an agent may miss before its phase is given up on. */
const JOURNAL_TRIES = 8

export type Timer = { cancel: () => void }

export type TrackerHost = {
  /** Stores the run state where the pane reads it. */
  write: (state: RunState) => unknown
  /** Stores the tick clock (ms), which the pane's spinner follows. */
  frame: (now: number) => unknown
  readText: (path: string) => Promise<string>
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  /** Whether the run pane is on screen now. */
  paneShown: () => Promise<boolean>
  status: (text: string | undefined) => unknown
  toast: (text: string) => unknown
  /** Stores which design the tracked run belongs to; null when it was not started from one. */
  design?: (name: string | null) => unknown
}

/**
 * A design's claim on a run: handed off, the next run that starts is its run; adopted, the run already tracked is.
 * `match` is each block's own, by id in design order, for a run whose labels carry no block id.
 */
export type Handoff = { name: string; nodeIds: readonly string[]; titles?: Readonly<Record<string, string>>; match?: Readonly<Record<string, readonly string[]>> }

type Claim = Mapping & { name: string; titles?: Readonly<Record<string, string>> }

const claimOf = (from: Handoff): Claim => ({ name: from.name, ids: new Set(from.nodeIds), titles: from.titles, match: from.match })

/** `design` is the saved design named as the run's workflow, when there is one: the run is that design's, handed off or not. */
export type RunStarted = { runId: string; name?: string; transcriptDir?: string; design?: Handoff }
export type AgentSpawned = { runId: string; agentId: string; label: string; index?: number }
export type AgentEnded = { ok: boolean; durationMs?: number; tokens?: number }

export type Tracker = ReturnType<typeof createTracker>

const hasRunning = (state: RunState): boolean => Object.values(state.agents).some(agent => agent.status === 'running')

export function createTracker() {
  let host: TrackerHost | undefined
  let state = emptyRunState()
  /** 0 clean, 1 token counts only, 2 anything else. */
  let dirty: 0 | 1 | 2 = 0
  let ticker: Timer | undefined
  let quiet: Timer | undefined
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
  /** The design whose handoff is being worked on: from the handoff until the person's next prompt after its claim is spent. A run of it meanwhile (the first, a retry) comes out of the handoff. */
  let handed: string | undefined

  const dirs = new Map<string, string>()
  /** Agents of the tracked run still running, with their token total so far. */
  const totals = new Map<string, number>()
  /** Agents waiting for a phase, with the journal reads that missed them. */
  const noPhase = new Map<string, number>()
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

  const cancelQuiet = (): void => {
    quiet?.cancel()
    quiet = undefined
  }

  const armQuiet = (): void => {
    if (!host || quiet) return
    quiet = host.after(QUIET_MS, () => {
      quiet = undefined
      if (state.status !== 'running' || state.runId === undefined || hasRunning(state)) return
      apply([{ kind: 'run-end', runId: state.runId, ok: true }])
    })
  }

  const readJournal = (): void => {
    lastRead = ticks
    const runId = state.runId
    const dir = runId === undefined ? undefined : dirs.get(runId)
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

  const tick = (): void => {
    ticks++
    const running = hasRunning(state)
    if (ticks % PANE_EVERY === 0) pollPane()

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
    cancelQuiet()
    flush()
    const text = endText(state)
    call(h => h.toast(text))
  }

  function apply(events: readonly RunEvent[]): void {
    const before = state
    let wasRunning = state.status === 'running'
    for (const event of events) {
      const next = reduce(state, event, active)
      if (next === state) continue
      state = next
      wasRunning ||= state.status === 'running'
      if (event.kind !== 'agent-usage') dirty = 2
      else if (dirty === 0) dirty = 1
    }
    if (state === before) return

    if (state.status === 'running') {
      if (hasRunning(state)) cancelQuiet()
      else armQuiet()
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

  /** Forgets the run held so far so that `runId` can start clean. `own` is the saved design the run is named as. */
  const begin = (runId: string, own?: Handoff): void => {
    replaying?.cancel()
    replaying = undefined
    cancelQuiet()
    totals.clear()
    noPhase.clear()
    if (own !== undefined) {
      // Named as a saved design: that design's run, whatever waits. A handoff of another design goes on waiting for its own.
      active = claimOf(own)
      if (pending?.name === own.name) dropPending()
      call(h => h.design?.(own.name))
    } else if (pending !== undefined || state.runId !== runId) {
      // Another run, or the one a handoff waited for: it belongs to that design, or to none.
      active = pending
      dropPending()
      // Said for every run, the same design's next one too: the host's copy is the session's and starts over on a /clear, this one does not.
      const name = active?.name ?? null
      call(h => h.design?.(name))
    }
    if (state.runId !== undefined && state.runId !== runId) superseded.add(state.runId)
    superseded.delete(runId)
  }

  /** The run tracked now is `claim`'s design's: every agent seen so far is placed again by it. */
  const take = (claim: Handoff): void => {
    const before = active
    active = claimOf(claim)
    if (pending?.name === claim.name) dropPending()
    if (active.name !== before?.name) call(h => h.design?.(claim.name))
    state = remap(state, active)
    flush()
  }

  return {
    /** The state as of every event so far (the stored copy may lag by a tick). */
    state: (): RunState => state,

    /**
     * Gives the tracker its host. `stored` is the state a previous load of the module
     * left behind: a run in it is picked up where it was, with `claim` as the design it
     * came from (the node ids are not stored; the caller reads them from the design file).
     */
    attach(next: TrackerHost, stored?: RunState, claim?: Handoff): void {
      host = next
      if (stored && state.status === 'idle' && Object.keys(state.agents).length === 0) {
        state = stored
        if (claim && state.status !== 'idle') active = claimOf(claim)
        for (const agent of Object.values(state.agents)) {
          if (agent.status === 'running') totals.set(agent.agentId, agent.tokens)
        }
      }
      if (state.status !== 'running') return
      if (!hasRunning(state)) armQuiet()
      startTicker()
    },

    /**
     * A design was handed off: the first run to start within HANDOFF_MS is counted against
     * its node ids. After that the claim is dropped, so a later unrelated run is not taken.
     */
    handoff(next: Handoff): void {
      dropPending()
      pending = claimOf(next)
      handed = next.name
      armExpiry()
    },

    /**
     * The person sent a prompt in the main conversation. While a handoff waits for its run they are answering what
     * Claude asked about the design: the wait starts again. With none waiting, the handoff's work is over: a later
     * run of the design is one the person asked for anew.
     */
    prompted(): void {
      if (pending === undefined) handed = undefined
      else armExpiry()
    },

    /**
     * Gives the run tracked now, running or over and still shown, a design after the fact: a design drawn of the
     * script it runs. Every agent seen so far is placed again by the claim, and the ones still to come are placed
     * by it. Returns the labels of the agents no block claims, one per agent; null when there is no run to give it to.
     */
    adopt(claim: Handoff): string[] | null {
      if (state.status === 'idle') return null
      take(claim)
      return state.unmapped.map(id => state.agents[id]?.label ?? '')
    },

    /** Whether a design was handed off and its run has not started yet: Claude is writing the script for it. */
    awaitsRun: (): boolean => pending !== undefined,

    /** The design the tracked run was started from, if any. */
    design: (): string | undefined => active?.name,

    /** Whether the tracked run comes out of a handoff of its design (the run it waited for, or a retry of it), not only out of its name. */
    handedOff: (): boolean => active !== undefined && active.name === handed,

    paneOpened(): void {
      shown = true
      syncStatus()
    },

    runStarted(run: RunStarted): void {
      if (run.transcriptDir) dirs.set(run.runId, run.transcriptDir)
      const isNew = state.runId !== run.runId || state.status !== 'running'
      if (isNew) begin(run.runId, run.design)
      apply([{ kind: 'run-start', runId: run.runId, name: run.name }])
      // Its agents were seen before the run was announced, so it began with no name: they are placed again by its design.
      if (!isNew && run.design !== undefined && active?.name !== run.design.name) take(run.design)
    },

    agentSpawned(agent: AgentSpawned): void {
      if (superseded.has(agent.runId)) return
      if (state.runId !== agent.runId) {
        begin(agent.runId)
        apply([{ kind: 'run-start', runId: agent.runId }])
      }
      cancelQuiet()
      totals.set(agent.agentId, 0)
      noPhase.set(agent.agentId, 0)
      apply([{ kind: 'agent-start', runId: agent.runId, agentId: agent.agentId, label: agent.label, index: agent.index }])
      if (ticks - lastRead >= JOURNAL_EVERY) readJournal()
    },

    /** Adds one model request's tokens to an agent's total; an agent not tracked is ignored. */
    agentUsage(agentId: string, tokens: number): void {
      const total = totals.get(agentId)
      if (total === undefined || !Number.isFinite(tokens) || tokens <= 0) return
      totals.set(agentId, total + tokens)
      apply([{ kind: 'agent-usage', agentId, tokens: total + tokens }])
    },

    agentEnded(agentId: string, end: AgentEnded): void {
      const total = totals.get(agentId)
      if (total === undefined) return
      totals.delete(agentId)
      apply([{ kind: 'agent-end', agentId, ok: end.ok, durationMs: end.durationMs, tokens: end.tokens ?? total }])
    },

    /** Feeds a recorded run through: at once, or spread over REPLAY_MS. */
    replay(events: readonly RunEvent[], mode: 'fast' | 'slow'): void {
      const first = events.find(event => event.kind === 'run-start')
      begin(first?.kind === 'run-start' ? first.runId : '')
      state = emptyRunState()
      dirty = 2

      if (mode === 'fast' || !host) {
        apply(events)
        if (isDirty()) flush()

        return
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
    },

    /** Back to no run at all. */
    clear(): void {
      handed = undefined
      begin('')
      state = emptyRunState()
      flush()
    },
  }
}
