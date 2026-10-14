import { flatten, idNumber } from '../project/model'
import type { Project } from '../project/model'

import type { RunEvent } from './events'
import { journalToEvents } from './journal'
import type { AgentMeta } from './journal'

// Dev aid: turns a recorded journal into a whole run's events, so the pane can be driven without a real workflow.

export type ReplayFixture = { journal: string; metas: Record<string, AgentMeta> }

/** A journal records no token counts, so a replay makes one up per agent, stable across runs. */
export function replayTokens(agentId: string): number {
  let hash = 0
  for (const char of agentId) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9973

  return 1200 + hash
}

/** A recording that stops with agents open is an interrupted run: those agents end failed, and so does the run. */
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

  for (const agentId of open) events.push({ kind: 'agent-end', agentId, ok: false })
  events.push({ kind: 'run-end', runId, ok: open.size === 0 })

  return events
}

export function replayDue(total: number, step: number, steps: number): number {
  if (steps <= 0 || step >= steps) return total

  return Math.min(total, Math.max(0, Math.ceil((total * step) / steps)))
}

/** Labels of the agents a project replay adds that no node of the project claims. */
export const REPLAY_STRAYS = ['fix lint', 'stray check'] as const

function replayAgents(id: string): number {
  return 2 + (idNumber(id) % 3)
}

/** Labels are `<nodeId>: <title> <k>`, as a handed-off script writes them; one agent fails and two carry labels no node claims. */
export function replayProjectEvents(project: Project, name: string = project.name): RunEvent[] {
  const runId = `replay:project:${name}`
  const events: RunEvent[] = [{ kind: 'run-start', runId, name }]
  const rows = flatten(project)
  const leaves = rows.filter(row => (row.node.children?.length ?? 0) === 0 && row.node.type !== 'code' && row.node.type !== 'start')
  const phaseOf = new Map<string, string>()
  let phase = ''
  for (const row of rows) {
    if (row.depth === 0) phase = `${row.node.id} ${row.node.name}`
    phaseOf.set(row.node.id, phase)
  }
  const strayId = `n${rows.reduce((max, row) => Math.max(max, idNumber(row.node.id)), 0) + 90}`
  const strays = [REPLAY_STRAYS[0], `${strayId}: ${REPLAY_STRAYS[1]}`]
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
    const stray = at === 0 ? strays[0] : at === leaves.length - 1 ? strays[1] : undefined
    if (stray !== undefined) agents.push(run(`replay-stray-${at === 0 ? 1 : 2}`, stray, undefined, true))
    // Starts together, then usage, then ends: a node's agents overlap as a fan-out does.
    for (const stage of [0, 1, 2]) for (const agent of agents) events.push(...(agent[stage] ?? []))
  }
  if (leaves.length === 1) events.push(...run('replay-stray-2', strays[1] ?? '', undefined, true).flat())
  events.push({ kind: 'run-end', runId, ok: true })

  return events
}
