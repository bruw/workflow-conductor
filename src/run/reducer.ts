import { emptyNodeRun, emptyRunState } from './events'
import type { AgentRun, NodeRun, RunEvent, RunState } from './events'

const NODE_ID = /^(n\d+)\b/

/** Design node id carried at the start of an agent label, e.g. `n3: verify auth` → `n3`. */
export function parseNodeId(label: string): string | undefined {
  if (typeof label !== 'string') return undefined
  return NODE_ID.exec(label)?.[1]
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
 * `knownNodeIds`, when given, is the set of node ids of the loaded design: a label whose
 * id is not in the set counts as unmapped.
 */
export function reduce(state: RunState, event: RunEvent, knownNodeIds?: ReadonlySet<string>): RunState {
  switch (event.kind) {
    case 'run-start': {
      // A repeated start for the run already in progress must not drop its agents.
      if (state.status === 'running' && state.runId === event.runId) {
        return event.name === undefined ? state : { ...state, name: event.name }
      }
      return { ...emptyRunState(), runId: event.runId, name: event.name, status: 'running' }
    }

    case 'agent-start': {
      if (typeof event.agentId !== 'string' || state.agents[event.agentId]) return state

      const label = typeof event.label === 'string' ? event.label : ''
      const parsed = parseNodeId(label)
      const nodeId = parsed !== undefined && (!knownNodeIds || knownNodeIds.has(parsed)) ? parsed : undefined
      const agent: AgentRun = { agentId: event.agentId, label, nodeId, phase: event.phase, status: 'running', tokens: 0 }

      return {
        ...state,
        // Agents can be seen before the run itself is announced.
        runId: state.runId ?? event.runId,
        status: state.status === 'idle' ? 'running' : state.status,
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

/** Replays a list of events from an empty state. */
export function reduceAll(events: readonly RunEvent[], knownNodeIds?: ReadonlySet<string>, from: RunState = emptyRunState()): RunState {
  return events.reduce((state, event) => reduce(state, event, knownNodeIds), from)
}
