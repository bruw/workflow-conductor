import type { Register } from 'claude-code'

import { createTracker } from '../src/run/tracker'

import { registerDesign } from './design'
import { registerRun } from './run'

// Composes only. Run hooks live in run.tsx, design hooks in design.tsx; they
// share the one tracker, so a handoff can tell it which design the next run is.
export const register: Register = on => {
  const tracker = createTracker()
  registerRun(on, tracker)
  registerDesign(on, tracker)
}
