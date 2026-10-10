import type { Register } from 'claude-code'

import { registerDesign } from './design'
import { registerRun } from './run'

// Composes only. Run hooks live in run.tsx, design hooks in design.ts.
export const register: Register = on => {
  registerRun(on)
  registerDesign(on)
}
