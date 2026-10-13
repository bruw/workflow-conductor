import type { Register } from 'claude-code'

import { createTracker } from '../src/run/tracker'

import { registerProject } from './project'
import { registerOffer } from './offer'
import { registerRun } from './run'

// Composes only: run hooks live in run.tsx, project hooks in project.tsx, the question before a workflow in offer.tsx.
// They share the one tracker, so a handoff can tell it which project the next run is.
export const register: Register = on => {
  const tracker = createTracker()
  registerRun(on, tracker)
  registerProject(on, tracker)
  registerOffer(on, tracker)
}
