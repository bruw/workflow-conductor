import type { Register } from 'claude-code'

import { createTracker } from '../src/run/tracker'

import { registerDesign } from './design'
import { registerOffer } from './offer'
import { registerRun } from './run'

// Composes only. Run hooks live in run.tsx, design hooks in design.tsx, the question before a
// workflow in offer.tsx; they share the one tracker, so a handoff can tell it which design the
// next run is, and the question is not asked for a design already approved.
export const register: Register = on => {
  const tracker = createTracker()
  registerRun(on, tracker)
  registerDesign(on, tracker)
  registerOffer(on, tracker)
}
