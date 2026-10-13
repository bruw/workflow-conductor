import { emptyNodeRun, emptyRunState } from './events'
import type { AgentRun, NodeRun, RunEvent, RunState } from './events'

const NODE_ID = /^(n\d+)\b/

export function parseNodeId(label: string): string | undefined {
  if (typeof label !== 'string') return undefined
  return NODE_ID.exec(label)?.[1]
}

/** `match` holds a block's agent labels and phase titles from the script, in project order; one ending in `*` is a prefix. */
export type Mapping = { ids: ReadonlySet<string>; match?: Readonly<Record<string, readonly string[]>> }

/** An exact string wins over any prefix, then the longest prefix, then the first block in project order. */
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

/** The id the label opens with (with a project, only one it has), else a match on the label, else on the phase title. */
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

function patchAgentBuckets(state: RunState, agent: AgentRun, patch: (one: NodeRun) => NodeRun): Pick<RunState, 'byNode' | 'byPhase'> {
  return {
    byNode: patchBucket(state.byNode, agent.nodeId, patch),
    byPhase: patchBucket(state.byPhase, agent.phase, patch),
  }
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Returns the same state when the event changes nothing; the input is never mutated. */
export function reduce(state: RunState, event: RunEvent, mapping?: Mapping): RunState {
  switch (event.kind) {
    case 'run-start': {
      // A repeated start for the run already in progress must not drop its agents.
      const dir = event.transcriptDir === undefined ? {} : { transcriptDir: event.transcriptDir }
      if (state.status === 'running' && state.runId === event.runId) {
        return event.name === undefined && (event.transcriptDir === undefined || event.transcriptDir === state.transcriptDir) ? state : { ...state, ...(event.name === undefined ? {} : { name: event.name }), ...dir }
      }
      return { ...emptyRunState(), runId: event.runId, name: event.name, ...dir, status: 'running' }
    }

    case 'agent-start': {
      if (typeof event.agentId !== 'string') return state

      const known = state.agents[event.agentId]
      if (known) {
        // A start seen again never counts twice, but it may carry the phase the first lacked.
        const phase = typeof event.phase === 'string' && event.phase.length > 0 ? event.phase : undefined
        if (known.phase !== undefined || phase === undefined) return state

        // An agent no label placed may be placed by its phase title.
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

/** Places every agent again under `mapping`, for a project given to a run after it started; the phases stay. */
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

export function reduceAll(events: readonly RunEvent[], mapping?: Mapping, from: RunState = emptyRunState()): RunState {
  return events.reduce((state, event) => reduce(state, event, mapping), from)
}
