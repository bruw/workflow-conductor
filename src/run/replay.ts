import { flatten, idNumber } from '../design/model'
import type { Design } from '../design/model'

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

/** Labels of the agents a design replay adds that no node of the design claims. */
export const REPLAY_STRAYS = ['fix lint', 'stray check'] as const

/** How many agents a design replay gives a leaf: 2 to 4, by its id. */
function replayAgents(id: string): number {
  return 2 + (idNumber(id) % 3)
}

/**
 * A made-up run of a design, for the overlay: several agents per leaf node, labelled
 * `<nodeId>: <title> <k>` as a handed-off script would, node after node; one agent
 * fails; two more carry labels no node claims (one plain, one with an id the design
 * does not hold). Token counts are made up. `code`, `start` and empty `phase` nodes spawn nothing.
 */
export function replayDesignEvents(design: Design, name: string = design.name): RunEvent[] {
  const runId = `replay:design:${name}`
  const events: RunEvent[] = [{ kind: 'run-start', runId, name }]
  const rows = flatten(design)
  const leaves = rows.filter(row => (row.node.children?.length ?? 0) === 0 && row.node.type !== 'code' && row.node.type !== 'start' && row.node.type !== 'phase')
  const phaseOf = new Map<string, string>()
  let phase = ''
  for (const row of rows) {
    if (row.depth === 0) phase = `${row.node.id} ${row.node.name}`
    phaseOf.set(row.node.id, phase)
  }
  const strayId = `n${rows.reduce((max, row) => Math.max(max, idNumber(row.node.id)), 0) + 90}`
  const strays = [REPLAY_STRAYS[0], `${strayId}: ${REPLAY_STRAYS[1]}`]
  // The failure lands in the second leaf when there is one, on its second agent.
  const failing = leaves[Math.min(1, leaves.length - 1)]?.node.id

  const run = (agentId: string, label: string, phase: string | undefined, ok: boolean): RunEvent[][] => {
    const tokens = replayTokens(agentId)

    return [
      [{ kind: 'agent-start', runId, agentId, label, phase }],
      [{ kind: 'agent-usage', agentId, tokens: Math.round(tokens / 2) }],
      [{ kind: 'agent-end', agentId, ok, tokens, durationMs: 1000 + (tokens % 4000) }],
    ]
  }

  for (const [at, { node }] of leaves.entries()) {
    const count = replayAgents(node.id)
    const agents = Array.from({ length: count }, (_, k) => run(`replay-${node.id}-${k + 1}`, `${node.id}: ${node.name} ${k + 1}`, phaseOf.get(node.id), !(node.id === failing && k === 1)))
    // One stray beside the first leaf, one beside the last.
    const stray = at === 0 ? strays[0] : at === leaves.length - 1 ? strays[1] : undefined
    if (stray !== undefined) agents.push(run(`replay-stray-${at === 0 ? 1 : 2}`, stray, undefined, true))
    // Starts together, then usage, then ends: a node's agents overlap as a fan-out does.
    for (const stage of [0, 1, 2]) for (const agent of agents) events.push(...(agent[stage] ?? []))
  }
  if (leaves.length === 1) events.push(...run('replay-stray-2', strays[1] ?? '', undefined, true).flat())
  events.push({ kind: 'run-end', runId, ok: true })

  return events
}
