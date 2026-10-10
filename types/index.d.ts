// The $.state contract. Every $.state key the mod uses is declared here.
// Self-contained by rule (no imports), so shapes are spelled out again: the run
// shapes mirror src/run/events.ts, the design shapes mirror src/design/model.ts and
// src/design/session.ts. `tsc` fails where a mirror drifts from its source.

export type ConductorDesignNode = {
  id: string
  type: 'agent' | 'pipeline' | 'parallel' | 'loop' | 'branch' | 'subworkflow' | 'code' | 'verify' | 'judge-panel' | 'loop-until-dry' | 'sweep' | 'critic'
  title: string
  notes?: string
  knobs?: {
    prompt?: string
    schema?: string
    model?: string
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    isolation?: 'worktree'
    agentType?: string
    fanout?: string
    votes?: number
    until?: string
  }
  children?: ConductorDesignNode[]
}

export type ConductorDesign = { version: 1; name: string; description: string; nextId?: number; nodes: ConductorDesignNode[] }

export type ConductorDesignUi = {
  name: string
  status: 'closed' | 'pick' | 'ready' | 'error'
  error: string | null
  selectedId: string | null
  showCard: boolean
  notice: string | null
  grabbedId: string | null
  picker: { at: { parentId?: string; index: number }; query: string } | null
  confirmId: string | null
  compact: boolean
  editing: boolean
  flash: { ids: string[]; seq: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    conductor: {
      /** The live run, as src/run/reducer.ts folds it (RunState). */
      run: {
        runId?: string
        name?: string
        status: 'idle' | 'running' | 'done' | 'failed'
        agents: Record<
          string,
          {
            agentId: string
            label: string
            nodeId?: string
            phase?: string
            status: 'running' | 'done' | 'failed'
            tokens: number
            durationMs?: number
          }
        >
        byNode: Record<string, { total: number; running: number; done: number; failed: number; tokens: number }>
        byPhase: Record<string, { total: number; running: number; done: number; failed: number; tokens: number }>
        unmapped: string[]
      }
      /** Phases the person opened or closed in the run view. */
      runUi: { expanded: string[]; collapsed: string[] }
      /** The run's tick clock in ms; advances only while an agent runs. */
      runClock: number
      /** The design the tracked run was started from; null when it came from none. */
      runDesign: string | null
      design: ConductorDesign | null
      designUi: ConductorDesignUi
    }
  }
}
