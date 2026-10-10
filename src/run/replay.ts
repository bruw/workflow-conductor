import type { RunEvent } from './events'
import { journalToEvents } from './journal'
import type { AgentMeta } from './journal'

// Dev aid: turns a recorded journal into the event list of a whole run, so the pane can
// be driven without a real workflow.

export type ReplayFixture = { journal: string; metas: Record<string, AgentMeta> }

/** A journal records no token counts, so a replay makes one up per agent, stable across runs. */
export function replayTokens(agentId: string): number {
  let hash = 0
  for (const char of agentId) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9973

  return 1200 + hash
}

/**
 * The events of a replayed run: a named `run-start`, the journal's events with made-up
 * token counts on each `agent-end`, and a `run-end` when every started agent ended.
 */
export function replayEvents(name: string, fixture: ReplayFixture): RunEvent[] {
  const runId = `replay:${name}`
  const events: RunEvent[] = [{ kind: 'run-start', runId, name }]
  const open = new Set<string>()

  for (const event of journalToEvents(fixture.journal, fixture.metas, { runId })) {
    if (event.kind === 'run-start') continue
    if (event.kind === 'agent-start') open.add(event.agentId)
    if (event.kind === 'agent-end') {
      open.delete(event.agentId)
      events.push({ ...event, tokens: replayTokens(event.agentId) })
      continue
    }
    events.push(event)
  }

  if (open.size === 0) events.push({ kind: 'run-end', runId, ok: true })

  return events
}

/** How many of `total` events are due once `step` of `steps` equal steps have passed. */
export function replayDue(total: number, step: number, steps: number): number {
  if (steps <= 0 || step >= steps) return total

  return Math.min(total, Math.max(0, Math.ceil((total * step) / steps)))
}
