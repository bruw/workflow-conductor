// The handoff: what `/conductor run <name>` tells Claude. The design is a spec;
// the conventions that tie a run back to it (label, phase, meta.name) are
// stated here and nowhere else, never in the design JSON. Pure TypeScript.

import { typeName, canHoldChildren, flatten, plainKind } from './model'
import type { Design, Kind } from './model'
import { KIND_TEACH } from './teach'

export type Handoff = { text: string; context: string[] }

/** Outline rows shown before the rest is left to the file. */
export const OUTLINE_MAX = 34
/** The most lines the instructions may take, outline included. */
export const HANDOFF_MAX_LINES = 80

/** The knobs an outline row names in brackets. `condition` is not among them: an arm's condition is said before its row. */
const KNOB_KEYS = ['model', 'effort', 'isolation', 'agentType', 'output', 'oncePer', 'votes', 'stopCondition'] as const
/** The most of a condition an outline row says; the file has the rest. */
const WHEN_MAX = 72

const clip = (value: string, max: number = 24): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value).replace(/\s+/g, ' ')

/** How an arm of a branch is picked, as its outline row opens: `IF no findings: `, `ELSE: `, `IF (no condition set): `; '' for any other block. */
function armWords(design: Design, row: { node: { knobs?: { condition?: string } }; parentId: string | undefined; index: number }): string {
  const parent = row.parentId === undefined ? undefined : flatten(design).find(one => one.node.id === row.parentId)?.node
  if (parent?.type !== 'branch') return ''
  const when = (row.node.knobs?.condition ?? '').replace(/\s+/g, ' ').trim()
  if (when !== '') return `IF ${clip(when, WHEN_MAX)}: `
  const arms = parent.children?.length ?? 0
  return arms > 1 && row.index === arms - 1 ? 'ELSE: ' : 'IF (no condition set): '
}

/** One row per block, indented by nesting: `n3 agent verify "name" [votes=3] (has logic)`; an arm of a branch opens with its condition, `IF no findings: n8 agent "…"`. */
export function outline(design: Design): string[] {
  const rows = flatten(design)
  const lines = rows.slice(0, OUTLINE_MAX).map(row => {
    const knobs = KNOB_KEYS.filter(key => row.node.knobs?.[key] !== undefined).map(key => `${key}=${clip(String(row.node.knobs?.[key]))}`)
    const tail = [knobs.length > 0 ? `[${knobs.join(' ')}]` : '', row.node.logic ? '(has logic)' : ''].filter(Boolean).join(' ')
    return `${'  '.repeat(row.depth + 1)}${armWords(design, row)}${row.node.id} ${typeName(row.node)} "${row.node.name}"${tail ? ` ${tail}` : ''}`
  })
  if (rows.length > OUTLINE_MAX) lines.push(`  … ${rows.length - OUTLINE_MAX} more blocks: see the file`)
  return lines.length > 0 ? lines : ['  (no blocks)']
}

/** The kinds a design uses, each once in the order it first names them, with what each is in the script: `   - agent verify: …`. */
function kindLines(design: Design): string[] {
  const seen = new Set<Kind>()
  const lines: string[] = []
  for (const { node } of flatten(design)) {
    if (node.kind === undefined || node.kind === plainKind(node.type) || seen.has(node.kind)) continue
    seen.add(node.kind)
    lines.push(`   - ${typeName(node)}: ${KIND_TEACH[node.kind].script}.`)
  }
  return lines
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
  return `Review the "${name}" workflow design as it is on the board now (read it first, it may have changed by hand): is the structure right for its goal, what is missing, what is wasteful? `
}

/** The visible line and the hidden instructions for one design saved at `designPath`. */
export function buildHandoff(design: Design, designPath: string): Handoff {
  const count = flatten(design).length
  // The args block is the input, not a stage: it gets no phase and no agent is labelled with it.
  const stages = design.nodes.filter(node => node.type !== 'args')
  const phases = stages.map(node => `"${node.id} ${node.name}"`)
  // The label's example names a block that spawns agents itself, where the design has one.
  const first = flatten(design).find(row => !canHoldChildren(row.node.type) && row.node.type !== 'args' && row.node.type !== 'code')?.node ?? stages[0]
  const goal = design.description.replace(/\s+/g, ' ').trim()
  const example = first ? `${first.id}: ${first.name}` : 'n1: scout diff'

  const lines = [
    `Conductor handoff: implement and run the workflow design "${design.name}".`,
    goal === '' ? 'The design states no goal (its `description` is empty): take the goal from the user\'s request.' : `Goal of the workflow (the design's \`description\`): ${goal}`,
    '',
    `1. Read the design file: ${designPath}`,
    '   It is a SPEC, not a program. Implement it as a real Workflow script and run it with the Workflow tool.',
    '   Each node has a type (the primitive to use), where it says one a `kind` (the pattern it is used for),',
    '   a name, optional `logic` (what it does, in words) and `knobs`.',
    '   `logic` and `knobs` express intent; where the design leaves a gap, resolve it sensibly toward the goal.',
    "   A block's `prompt` knob is the intent for that agent's prompt, not its wording: write the real prompt from it.",
    '',
    '2. Mapping rules. The run view reads them back, so follow them exactly:',
    '   - Label: every agent() call sets label: "<nodeId>: <short text>", where nodeId is the id of the design',
    `     node the agent belongs to, e.g. "${example}". For an agent inside a container (pipeline, parallel,`,
    "     loop, branch, phase), use the INNERMOST design node's id, not the container's.",
    '   - Phase: each TOP-LEVEL design node (the `args` block left out) gets one phase titled "<nodeId> <name>". List',
    '     them in meta.phases in design order, and pass that title as `phase` on every agent() under that node.',
    phases.length > 0 ? `     Here: meta.phases = [${phases.join(', ')}]` : '     Here: the design has no nodes yet; say so instead of inventing a workflow.',
    `   - Name: meta.name = "${design.name}".`,
    '',
    '3. Knobs: honour model, effort, isolation, agentType and output (the agent\'s `schema`) where a node sets them;',
    '   where it does not, omit the option (do not invent a value). oncePer (what a pipeline or a parallel fans out',
    '   over), votes and stopCondition (when a loop stops) describe shape: follow them.',
    '   A block directly in a branch is one arm of it: its `condition` is what picks it (write the test from it,',
    '   against the result before the branch); the last arm with no `condition` is the else. Exactly one arm runs.',
    '   The `args` block (always the first) is the input: read the script\'s `args` as its logic and `output` say, check it',
    '   first thing, and take the values from the user\'s request. With neither set, the workflow takes no input.',
    '   A `phase` block only frames its blocks: they run in order where it stands, as if it were not there.',
    ...(kindLines(design).length > 0 ? ["   A block's `kind` is the pattern to write, and its knobs and logic say the particulars. The kinds in this design:", ...kindLines(design)] : []),
    '',
    '4. After launching, say in one or two lines how the nodes mapped to stages, and name anything in the',
    '   design that could not be honoured.',
    '',
    `Outline (id type [kind] "name", indented by nesting, an arm of a branch after its IF … / ELSE; ${count} ${count === 1 ? 'node' : 'nodes'}):`,
    ...outline(design),
  ]

  return {
    text: `handing off design "${design.name}" (${count} ${count === 1 ? 'block' : 'blocks'})`,
    context: [lines.join('\n')],
  }
}
