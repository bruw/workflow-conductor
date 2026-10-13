import { emptyNodeRun, emptyRunState } from './events'
import type { AgentRun, NodeRun, RunEvent, RunState } from './events'

const NODE_ID = /^(n\d+)\b/

/** Project node id carried at the start of an agent label, e.g. `n3: verify auth` → `n3`. */
export function parseNodeId(label: string): string | undefined {
  if (typeof label !== 'string') return undefined
  return NODE_ID.exec(label)?.[1]
}

/**
 * What ties a run to a project: the ids of its blocks, and for the blocks that have one their `match`
 * (the script's own agent labels and phase titles, a prefix where one ends in `*`), in project order.
 */
export type Mapping = { ids: ReadonlySet<string>; match?: Readonly<Record<string, readonly string[]>> }

/** The block whose `match` names `text`: an exact string before any prefix, the longest prefix among those, the first block in project order on a tie. */
export function matchNode(text: string, match: Mapping['match']): string | undefined {
  let found: string | undefined
  let length = -1
  for (const [id, patterns] of Object.entries(match ?? {})) {
    for (const pattern of patterns) {
      if (pattern === text) return id
      if (pattern.endsWith('*') && pattern.length - 1 > length && text.startsWith(pattern.slice(0, -1))) {
        found = id
        length = pattern.length - 1
      }
    }
  }
  return found
}

/**
 * The block an agent belongs to: the id its label opens with (any id with no project, else one the project has),
 * else the block that matches its label, else the one that matches its phase title. Undefined: unmapped.
 */
export function nodeOf(label: string, phase: string | undefined, mapping?: Mapping): string | undefined {
  const parsed = parseNodeId(label)
  if (parsed !== undefined && (!mapping || mapping.ids.has(parsed))) return parsed
  if (!mapping?.match) return undefined
  return (label === '' ? undefined : matchNode(label, mapping.match)) ?? (phase === undefined || phase === '' ? undefined : matchNode(phase, mapping.match))
}

type Buckets = Record<string, NodeRun>

function patchBucket(buckets: Buckets, key: string | undefined, patch: (one: NodeRun) => NodeRun): Buckets {
  if (key === undefined) return buckets
  return { ...buckets, [key]: patch(buckets[key] ?? emptyNodeRun()) }
}

/** Applies the same change to the node bucket and the phase bucket an agent belongs to. */
function patchAgentBuckets(state: RunState, agent: AgentRun, patch: (one: NodeRun) => NodeRun): Pick<RunState, 'byNode' | 'byPhase'> {
  return {
    byNode: patchBucket(state.byNode, agent.nodeId, patch),
    byPhase: patchBucket(state.byPhase, agent.phase, patch),
  }
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Folds one run event into the state and returns a new state; the input is never mutated.
 * `mapping`, when given, is the loaded project: an agent no block of it claims (`nodeOf`)
 * counts as unmapped.
 */
export function reduce(state: RunState, event: RunEvent, mapping?: Mapping): RunState {
  switch (event.kind) {
    case 'run-start': {
      // A repeated start for the run already in progress must not drop its agents.
      if (state.status === 'running' && state.runId === event.runId) {
        return event.name === undefined ? state : { ...state, name: event.name }
      }
      return { ...emptyRunState(), runId: event.runId, name: event.name, status: 'running' }
    }

    case 'agent-start': {
      if (typeof event.agentId !== 'string') return state

      const known = state.agents[event.agentId]
      if (known) {
        // A start seen again never counts twice, but it may carry the phase the first lacked.
        const phase = typeof event.phase === 'string' && event.phase.length > 0 ? event.phase : undefined
        if (known.phase !== undefined || phase === undefined) return state

        // An agent no label placed may be placed by its phase title, now that it has one.
        const nodeId = known.nodeId ?? nodeOf(known.label, phase, mapping)
        const counted = (one: NodeRun): NodeRun => ({ ...one, total: one.total + 1, [known.status]: one[known.status] + 1, tokens: one.tokens + known.tokens })

        return {
          ...state,
          agents: { ...state.agents, [known.agentId]: { ...known, nodeId, phase } },
          byNode: nodeId === known.nodeId ? state.byNode : patchBucket(state.byNode, nodeId, counted),
          byPhase: patchBucket(state.byPhase, phase, counted),
          unmapped: nodeId === known.nodeId ? state.unmapped : state.unmapped.filter(id => id !== known.agentId),
        }
      }

      const label = typeof event.label === 'string' ? event.label : ''
      const nodeId = nodeOf(label, event.phase, mapping)
      const agent: AgentRun = { agentId: event.agentId, label, nodeId, phase: event.phase, status: 'running', tokens: 0 }
      // A spawn for the run that was held finished (the quiet period is a guess) reopens it.
      const sameRun = state.runId === undefined || state.runId === event.runId

      return {
        ...state,
        // Agents can be seen before the run itself is announced.
        runId: state.runId ?? event.runId,
        status: state.status === 'idle' || sameRun ? 'running' : state.status,
        agents: { ...state.agents, [agent.agentId]: agent },
        ...patchAgentBuckets(state, agent, one => ({ ...one, total: one.total + 1, running: one.running + 1 })),
        unmapped: nodeId === undefined ? [...state.unmapped, agent.agentId] : state.unmapped,
      }
    }

    case 'agent-usage': {
      const agent = state.agents[event.agentId]
      const tokens = tokenCount(event.tokens)
      if (!agent || tokens === undefined || tokens === agent.tokens) return state

      const delta = tokens - agent.tokens
      return {
        ...state,
        agents: { ...state.agents, [agent.agentId]: { ...agent, tokens } },
        ...patchAgentBuckets(state, agent, one => ({ ...one, tokens: one.tokens + delta })),
      }
    }

    case 'agent-end': {
      const agent = state.agents[event.agentId]
      if (!agent || agent.status !== 'running') return state

      const status = event.ok ? 'done' : 'failed'
      const tokens = tokenCount(event.tokens) ?? agent.tokens
      const delta = tokens - agent.tokens
      const ended: AgentRun = { ...agent, status, tokens }
      if (typeof event.durationMs === 'number') ended.durationMs = event.durationMs

      return {
        ...state,
        agents: { ...state.agents, [agent.agentId]: ended },
        ...patchAgentBuckets(state, agent, one => ({
          ...one,
          running: one.running - 1,
          [status]: one[status] + 1,
          tokens: one.tokens + delta,
        })),
      }
    }

    case 'run-end': {
      if (state.runId !== undefined && event.runId !== state.runId) return state
      return { ...state, status: event.ok ? 'done' : 'failed' }
    }

    default:
      return state
  }
}

/**
 * The state with every agent placed again under `mapping`: the project a run was given after it started.
 * Each agent's block, the per-block counts and the unmapped list are made anew; the phases stay.
 */
export function remap(state: RunState, mapping?: Mapping): RunState {
  const agents: RunState['agents'] = {}
  let byNode: Buckets = {}
  const unmapped: string[] = []
  for (const agent of Object.values(state.agents)) {
    const nodeId = nodeOf(agent.label, agent.phase, mapping)
    agents[agent.agentId] = { ...agent, nodeId }
    byNode = patchBucket(byNode, nodeId, one => ({ ...one, total: one.total + 1, [agent.status]: one[agent.status] + 1, tokens: one.tokens + agent.tokens }))
    if (nodeId === undefined) unmapped.push(agent.agentId)
  }
  return { ...state, agents, byNode, unmapped }
}

/** Replays a list of events from an empty state. */
export function reduceAll(events: readonly RunEvent[], mapping?: Mapping, from: RunState = emptyRunState()): RunState {
  return events.reduce((state, event) => reduce(state, event, mapping), from)
}
