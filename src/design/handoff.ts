// The handoff: what `/conductor run <name>` tells Claude. It is short on purpose: the design
// file says what the workflow does, and Claude is told to ask about what is unclear in it.
// The one thing said here and not in the design is how a run is tied back to it (label,
// phase, meta.name). Pure TypeScript.

import { typeName, canHoldChildren, flatten, goalOf } from './model'
import type { Design } from './model'
import { OFFER_TOOL_FULL_NAME } from './offer'

export type Handoff = { text: string; context: string[] }

/** Outline rows the tool for Claude shows before the rest is left to the file. */
export const OUTLINE_MAX = 34
/** The knobs an outline row names in brackets. `condition` is not among them: an arm's condition is said before its row. */
const KNOB_KEYS = ['model', 'effort', 'isolation', 'agentType', 'output', 'oncePer', 'stopCondition'] as const
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

/** One row per block, indented by nesting: `n3 agent verify "name" [output=…] (has logic)`; an arm of a branch opens with its condition, `IF no findings: n8 agent "…"`. */
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
  return `Review the "${name}" workflow design as it is on the board now (it may have changed by hand: read it, unless a Conductor note with this prompt says what changed): is the structure right for its goal, what is missing, what is wasteful? `
}

/**
 * The visible line and the hidden instructions for one design saved at `designPath`. `scriptPath` is the design's
 * script when that file exists (`scriptFile`), null when it has none yet: with one, Claude updates it and runs it
 * in place of writing a new one, and the blocks with `match` keep the script's own labels and phase titles.
 */
export function buildHandoff(design: Design, designPath: string, scriptPath: string | null): Handoff {
  const count = flatten(design).length
  // The start block is the goal and the input, not a stage: it gets no phase and no agent is labelled with it.
  const stages = design.nodes.filter(node => node.type !== 'start')
  const phases = stages.map(node => `"${node.id} ${node.name}"`)
  // The label's example names a block that spawns agents itself, where the design has one; with a script, one the label rule is for.
  const first = flatten(design).find(row => !canHoldChildren(row.node.type) && row.node.type !== 'start' && row.node.type !== 'code' && (scriptPath === null || !row.node.match))?.node ?? stages[0]
  const goal = goalOf(design)
  const example = first ? `${first.id}: ${first.name}` : 'n1: scout diff'

  const lines = [
    `Conductor handoff: ${scriptPath === null ? 'implement' : 'update'} and run the workflow design "${design.name}".`,
    goal === '' ? 'The design states no goal (its start block\'s `goal` is empty): take the goal from the user\'s request.' : `Goal of the workflow (the start block's \`goal\`): ${goal}`,
    '',
    `Read the design file: ${designPath}`,
    'It defines the workflow: what each block says (its type, kind, name, logic and knobs) is what to build.',
    ...(scriptPath === null
      ? ['Write it as a Workflow script and run it with the Workflow tool.']
      : [
          `Its script exists: ${scriptPath}`,
          "Update THAT file to match the design as it is now, changing only what the design changed, and run it with the",
          "Workflow tool's `scriptPath`. If it already matches, run it unchanged. Do not write another script.",
        ]),
    `The user approved it on the board: do not call ${OFFER_TOOL_FULL_NAME} for it.`,
    '',
    'Before you write anything, ask the user about every flow in the design that is ambiguous or looks unintended,',
    'and wait for the answers. Where nothing is, go on without asking.',
    '',
    'So the run shows on the board:',
    ...(scriptPath === null
      ? [
          `- every agent() sets label: "<nodeId>: <short text>", the id being the INNERMOST design node the agent belongs to, e.g. "${example}".`,
          '- each top-level node (the `start` block left out) is one phase titled "<nodeId> <name>": list them in meta.phases in design',
          `  order and pass the title as \`phase\` on every agent() under that node.${phases.length > 0 ? ` Here: meta.phases = [${phases.join(', ')}]` : ''}`,
        ]
      : [
          '- a node with `match` is already wired by the labels or phase titles listed there (one ending in * is a prefix): keep them as they are.',
          `- every agent() of a node without \`match\` sets label: "<nodeId>: <short text>", the id being the INNERMOST design node it belongs to, e.g. "${example}".`,
          "- keep the script's meta.phases and every `phase`; a top-level node with no phase gets one titled \"<nodeId> <name>\", in design order.",
        ]),
    `- meta.name = "${design.name}".`,
  ]

  return {
    text: `handing off design "${design.name}" (${count} ${count === 1 ? 'block' : 'blocks'})`,
    context: [lines.join('\n')],
  }
}
