// The $.state contract. Every $.state key the mod uses is declared here.
// Self-contained by rule (no imports), so shapes are spelled out again: the run
// shapes mirror src/run/events.ts, the design shapes mirror src/design/model.ts and
// src/design/session.ts. `tsc` fails where a mirror drifts from its source.

export type ConductorDesignNode = {
  id: string
  type: 'agent' | 'pipeline' | 'parallel' | 'loop' | 'branch' | 'subworkflow' | 'code' | 'start' | 'phase'
  kind?:
    | 'task' | 'scout' | 'check' | 'verify' | 'judge' | 'critic' | 'synthesize' | 'classify'
    | 'custom' | 'count' | 'pass' | 'dry' | 'converged' | 'target' | 'budget'
    | 'arms' | 'each' | 'sweep' | 'attempts'
    | 'if-else' | 'guard' | 'route'
  name: string
  logic?: string
  knobs?: {
    goal?: string
    args?: string
    prompt?: string
    output?: string
    model?: string
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    isolation?: 'worktree'
    agentType?: string
    oncePer?: string
    stopCondition?: string
    condition?: string
  }
  match?: string[]
  children?: ConductorDesignNode[]
}

export type ConductorDesign = { version: 1; name: string; nextId?: number; nodes: ConductorDesignNode[] }

export type ConductorDesignUi = {
  name: string
  status: 'closed' | 'pick' | 'ready' | 'error'
  error: string | null
  selectedId: string | null
  help: number
  notice: string | null
  picker: { at: { parentId?: string; index: number }; query: string; retypeId?: string; anchorId?: string; where?: 'after' | 'inside' | 'before'; pick?: number; block?: ConductorDesignNode['type']; nav?: string; lead?: string } | null
  confirmId: string | null
  viewRootId: string | null
  carousels: Record<string, number>
  detailHidden: boolean
  unsaved: boolean
  editing: boolean
  flash: { ids: string[]; seq: number } | null
  follow: boolean
  drafting: boolean
  freshId: string | null
  picks: Record<string, string>
  runCleared: boolean
  saved: { name: string; blocks: number; goal: string }[]
  handed: boolean
  startMark: number
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
      /** The tracked run's script file, and the design drawn of that run after it started (`attach`); null with no run of a script. */
      runScript: { runId: string; path: string; drawn: string | null } | null
      /** When the tracked run began and ended, in `$.clock.now()`'s ms (RunTimes in src/design/session.ts). */
      runTimes: { runId: string | null; startedAt: number | null; endedAt: number | null; seenAt: number | null }
      design: ConductorDesign | null
      designUi: ConductorDesignUi
      /** Whether this session has seen the splash. */
      splashed: boolean
      /** The gesture the header's persona holds (Pose in src/ui/persona.ts); `idle` at rest. */
      persona: 'idle' | 'ready' | 'conducting' | 'complete'
    }
  }
}
