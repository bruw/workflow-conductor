// The $.state contract. Every $.state key the mod uses is declared here.
// The contract must be self-contained (no imports), so the design shapes are
// spelled out again: they mirror src/design/model.ts and src/design/session.ts,
// and `tsc` holds the two to each other where hooks/design.tsx reads and writes.

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
  rev: number
  showCard: boolean
  notice: string | null
}

declare module 'claude-code' {
  interface PluginState {
    conductor: {
      design: ConductorDesign | null
      designUi: ConductorDesignUi
    }
  }
}
