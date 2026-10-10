// The $.state contract. Every $.state key the mod uses is declared here.
// Self-contained by rule (no imports): the run shapes mirror src/run/events.ts, and
// `tsc` fails where the two drift apart.

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
    }
  }
}
