export type RunEvent =
  | { kind: 'run-start'; runId: string; name?: string; transcriptDir?: string; at?: number }
  | { kind: 'agent-start'; runId: string; agentId: string; label: string; phase?: string; index?: number; at?: number }
  | { kind: 'agent-usage'; agentId: string; tokens: number }
  | { kind: 'agent-end'; agentId: string; ok: boolean; durationMs?: number; tokens?: number }
  | { kind: 'run-end'; runId: string; ok: boolean }

export type RunStatus = 'idle' | 'running' | 'done' | 'failed'

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  agentId: string
  label: string
  nodeId?: string
  phase?: string
  status: AgentStatus
  tokens: number
  durationMs?: number
}

export type NodeRun = { total: number; running: number; done: number; failed: number; tokens: number }

export type RunState = {
  runId?: string
  name?: string
  /** Kept in the state so that a load of the module midway through a run still reads its phases. */
  transcriptDir?: string
  status: RunStatus
  /** By agentId. */
  agents: Record<string, AgentRun>
  /** By project node id. */
  byNode: Record<string, NodeRun>
  /** By phase title, for a run with no project. */
  byPhase: Record<string, NodeRun>
  /** AgentIds whose label carries no known node id. */
  unmapped: string[]
}

export function emptyNodeRun(): NodeRun {
  return { total: 0, running: 0, done: 0, failed: 0, tokens: 0 }
}

export function emptyRunState(): RunState {
  return { status: 'idle', agents: {}, byNode: {}, byPhase: {}, unmapped: [] }
}
