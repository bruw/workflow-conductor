// The handoff: what `/conductor run <name>` tells Claude. The design is a spec;
// the conventions that tie a run back to it (label, phase, meta.name) are
// stated here and nowhere else, never in the design JSON. Pure TypeScript.

import { flatten } from './model'
import type { Design } from './model'

export type Handoff = { text: string; context: string[] }

/** Outline rows shown before the rest is left to the file. */
export const OUTLINE_MAX = 34
/** The most lines the instructions may take, outline included. */
export const HANDOFF_MAX_LINES = 60

const KNOB_KEYS = ['model', 'effort', 'isolation', 'agentType', 'schema', 'fanout', 'votes', 'until'] as const

const clip = (value: string): string => (value.length > 24 ? `${value.slice(0, 23)}…` : value).replace(/\s+/g, ' ')

/** One row per block, indented by nesting: `n3 verify "title" [votes=3] (has notes)`. */
export function outline(design: Design): string[] {
  const rows = flatten(design)
  const lines = rows.slice(0, OUTLINE_MAX).map(row => {
    const knobs = KNOB_KEYS.filter(key => row.node.knobs?.[key] !== undefined).map(key => `${key}=${clip(String(row.node.knobs?.[key]))}`)
    const tail = [knobs.length > 0 ? `[${knobs.join(' ')}]` : '', row.node.notes ? '(has notes)' : ''].filter(Boolean).join(' ')
    return `${'  '.repeat(row.depth + 1)}${row.node.id} ${row.node.type} "${row.node.title}"${tail ? ` ${tail}` : ''}`
  })
  if (rows.length > OUTLINE_MAX) lines.push(`  … ${rows.length - OUTLINE_MAX} more blocks: see the file`)
  return lines.length > 0 ? lines : ['  (no blocks)']
}

/** What `r` puts in the prompt box, and what a hand-off submits: the person adds what to run it on. The sentence also tells the mod which design a prompt hands off. */
export function handoffPrompt(name: string): string {
  return `Implement and run the "${name}" workflow design on: `
}

/** The design a prompt hands off, when it opens with the hand-off sentence; null for any other prompt. */
export function handoffTarget(text: string): string | null {
  return /^\s*Implement and run the "([a-z0-9-]+)" workflow design\b/.exec(text)?.[1] ?? null
}

/** What the review key puts in the prompt box: the chat tool hands Claude the design, the selection and the lints. */
export function reviewPrompt(name: string): string {
  return `Review the "${name}" workflow design: is the structure right for its goal, what is missing, what is wasteful? `
}

/** The visible line and the hidden instructions for one design saved at `designPath`. */
export function buildHandoff(design: Design, designPath: string): Handoff {
  const count = flatten(design).length
  const phases = design.nodes.map(node => `"${node.id} ${node.title}"`)
  const first = design.nodes[0]
  const goal = design.description.replace(/\s+/g, ' ').trim()
  const example = first ? `${first.id}: ${first.title}` : 'n1: scout diff'

  const lines = [
    `Conductor handoff: implement and run the workflow design "${design.name}".`,
    goal === '' ? 'The design states no goal (its `description` is empty): take the goal from the user\'s request.' : `Goal of the workflow (the design's \`description\`): ${goal}`,
    '',
    `1. Read the design file: ${designPath}`,
    '   It is a SPEC, not a program. Implement it as a real Workflow script and run it with the Workflow tool.',
    '   Each node has a type (the primitive or pattern to use), a title, optional `notes` and `knobs`.',
    '   `notes` and `knobs` express intent; where the design leaves a gap, resolve it sensibly toward the goal.',
    "   A block's `prompt` knob is the intent for that agent's prompt, not its wording: write the real prompt from it.",
    '',
    '2. Mapping rules. The run view reads them back, so follow them exactly:',
    '   - Label: every agent() call sets label: "<nodeId>: <short text>", where nodeId is the id of the design',
    `     node the agent belongs to, e.g. "${example}". For an agent inside a container (pipeline, parallel,`,
    "     loop, branch, sweep), use the INNERMOST design node's id, not the container's.",
    '   - Phase: each TOP-LEVEL design node gets one phase titled "<nodeId> <title>". List them in meta.phases',
    '     in design order, and pass that title as `phase` on every agent() under that top-level node.',
    phases.length > 0 ? `     Here: meta.phases = [${phases.join(', ')}]` : '     Here: the design has no nodes yet; say so instead of inventing a workflow.',
    `   - Name: meta.name = "${design.name}".`,
    '',
    '3. Knobs: honour model, effort, isolation, agentType and schema where a node sets them; where it does not,',
    '   omit the option (do not invent a value). fanout, votes and until describe shape: follow them.',
    '',
    '4. After launching, say in one or two lines how the nodes mapped to stages, and name anything in the',
    '   design that could not be honoured.',
    '',
    `Outline (id type "title", indented by nesting; ${count} ${count === 1 ? 'node' : 'nodes'}):`,
    ...outline(design),
  ]

  return {
    text: `handing off design "${design.name}" (${count} ${count === 1 ? 'block' : 'blocks'})`,
    context: [lines.join('\n')],
  }
}
