// The $.state contract: every $.state key the mod uses is declared here.
// Self-contained by rule (no imports), so the shapes mirror src/run/events.ts, src/project/model.ts and src/project/session.ts; `tsc` fails where one drifts.

export type ConductorProjectNode = {
  id: string
  type: 'agent' | 'pipeline' | 'parallel' | 'loop' | 'branch' | 'subworkflow' | 'code' | 'start'
  kind?:
    | 'task' | 'scout' | 'check' | 'verify' | 'judge' | 'critic' | 'merge' | 'classify'
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
  children?: ConductorProjectNode[]
}

export type ConductorProject = { version: 1; name: string; nextId?: number; nodes: ConductorProjectNode[] }

export type ConductorProjectUi = {
  name: string
  status: 'closed' | 'pick' | 'ready' | 'error'
  error: string | null
  selectedId: string | null
  help: number
  notice: string | null
  picker: { at: { parentId?: string; index: number }; query: string; retypeId?: string; anchorId?: string; where?: 'after' | 'inside' | 'before'; pick?: number; block?: ConductorProjectNode['type']; nav?: string; lead?: string } | null
  confirmId: string | null
  viewRootId: string | null
  carousels: Record<string, number>
  detailHidden: boolean
  unsaved: boolean
  editing: boolean
  flash: { ids: string[]; seq: number } | null
  follow: boolean
  drafting: 'wait' | 'show' | null
  reveal: number | null
  freshId: string | null
  picks: Record<string, string>
  runCleared: boolean
  saved: { name: string; blocks: number; goal: string }[]
  handed: boolean
  startMark: number
  back: string | null
  renaming: string | null
  deleteAsk: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'workflow-conductor': {
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
      runUi: { expanded: string[]; collapsed: string[] }
      /** The run's tick clock in ms; advances only while an agent runs. */
      runClock: number
      /** Null: the tracked run came from no project. */
      runProject: string | null
      /** The tracked run's script file, and the project drawn of that run after it started (`attach`); null with no run of a script. */
      runScript: { runId: string; path: string; drawn: string | null } | null
      /** When the tracked run began and ended, in `$.clock.now()`'s ms (RunTimes in src/project/session.ts). */
      runTimes: { runId: string | null; startedAt: number | null; endedAt: number | null; seenAt: number | null }
      project: ConductorProject | null
      projectUi: ConductorProjectUi
      splashed: boolean
      /** Beats counted since a draft was asked for: the splash that waits for it and the header's persona move on them. */
      draftBeat: number
      /** The gesture the header's persona holds (Pose in src/ui/persona.ts); `idle` at rest. */
      persona: 'idle' | 'ready' | 'conducting' | 'complete'
      /** Where the designer is: in its pane (`no`), or minimized into the band above the prompt (Shell in src/ui/compact.ts). */
      shell: { minimized: 'no' | 'person' | 'auto'; why: 'narrow' | 'screen' | 'dock' | 'short' | null }
    }
  }
}
