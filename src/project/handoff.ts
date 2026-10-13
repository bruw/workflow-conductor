// The handoff: what `r` on the board tells Claude. Short on purpose: the project file says what the workflow
// does, and only how a run is tied back to it (label, phase, meta.name) is said here.

import { typeName, canHoldChildren, flatten, goalOf } from './model'
import type { Project } from './model'
import { OFFER_TOOL_FULL_NAME } from './offer'

export type Handoff = { text: string; context: string[] }

/** Outline rows the tool for Claude shows before the rest is left to the file. */
export const OUTLINE_MAX = 34
/** `condition` is not among them: an arm's condition is said before its row. */
const KNOB_KEYS = ['model', 'effort', 'isolation', 'agentType', 'output', 'oncePer', 'stopCondition'] as const
/** The most of a condition an outline row says; the file has the rest. */
const WHEN_MAX = 72

const clip = (value: string, max: number = 24): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value).replace(/\s+/g, ' ')
/** On one line and in JSON quotes, so that no name ends its string or starts a line of its own. */
const quoted = (value: string): string => JSON.stringify(value.replace(/\s+/g, ' ').trim())

function armWords(project: Project, row: { node: { knobs?: { condition?: string } }; parentId: string | undefined; index: number }): string {
  const parent = row.parentId === undefined ? undefined : flatten(project).find(one => one.node.id === row.parentId)?.node
  if (parent?.type !== 'branch') return ''
  const when = (row.node.knobs?.condition ?? '').replace(/\s+/g, ' ').trim()
  if (when !== '') return `IF ${clip(when, WHEN_MAX)}: `
  const arms = parent.children?.length ?? 0
  return arms > 1 && row.index === arms - 1 ? 'ELSE: ' : 'IF (no condition set): '
}

/** One row per block: `n3 agent verify "name" [output=…] (has logic)`; an arm of a branch opens with its condition. */
export function outline(project: Project): string[] {
  const rows = flatten(project)
  const lines = rows.slice(0, OUTLINE_MAX).map(row => {
    const knobs = KNOB_KEYS.filter(key => row.node.knobs?.[key] !== undefined).map(key => `${key}=${clip(String(row.node.knobs?.[key]))}`)
    const tail = [knobs.length > 0 ? `[${knobs.join(' ')}]` : '', row.node.logic ? '(has logic)' : ''].filter(Boolean).join(' ')
    return `${'  '.repeat(row.depth + 1)}${armWords(project, row)}${row.node.id} ${typeName(row.node)} ${quoted(row.node.name)}${tail ? ` ${tail}` : ''}`
  })
  if (rows.length > OUTLINE_MAX) lines.push(`  … ${rows.length - OUTLINE_MAX} more blocks: see the file`)
  return lines.length > 0 ? lines : ['  (no blocks)']
}

/** The sentence tells the mod which project a prompt hands off, and names the tool whose answer is the hand-off: a prompt the mod sends carries no hidden context. */
export function handoffPrompt(name: string): string {
  return `Implement and run the "${name}" workflow project (Conductor hands it off: call ${OFFER_TOOL_FULL_NAME} first).`
}

export function handoffTarget(text: string): string | null {
  return /^\s*Implement and run the "([a-z0-9-]+)" workflow project\b/.exec(text)?.[1] ?? null
}

/** The chat tool hands Claude the project, the selection and the lints. */
export function reviewPrompt(name: string): string {
  return `Review the "${name}" workflow project as it is on the board now (it may have changed by hand: read it, unless a Conductor note with this prompt says what changed): is the structure right for its goal, what is missing, what is wasteful? `
}

/** `scriptPath` is the project's script when that file exists: Claude updates and runs it in place of writing a new one. */
export function buildHandoff(project: Project, projectPath: string, scriptPath: string | null): Handoff {
  const count = flatten(project).length
  // The start block is the goal and the input, not a stage: it gets no phase and no agent is labelled with it.
  const stages = project.nodes.filter(node => node.type !== 'start')
  const phases = stages.map(node => quoted(`${node.id} ${node.name}`))
  // The label's example names a block that spawns agents itself, where the project has one; with a script, one the label rule is for.
  const first = flatten(project).find(row => !canHoldChildren(row.node.type) && row.node.type !== 'start' && row.node.type !== 'code' && (scriptPath === null || !row.node.match))?.node ?? stages[0]
  const goal = goalOf(project)
  const args = (project.nodes.find(node => node.type === 'start')?.knobs?.args ?? '').replace(/\s+/g, ' ').trim()
  const example = quoted(first ? `${first.id}: ${first.name}` : 'n1: scout diff')

  const lines = [
    `Conductor handoff: ${scriptPath === null ? 'implement' : 'update'} and run the workflow project "${project.name}".`,
    goal === '' ? 'The project states no goal (its start block\'s `goal` is empty): take the goal from the user\'s request.' : `Goal of the workflow (the start block's \`goal\`): ${goal}`,
    '',
    `Read the project file: ${projectPath}`,
    'It defines the workflow: what each block says (its type, kind, name, logic and knobs) is what to build.',
    ...(scriptPath === null
      ? ['Write it as a Workflow script and run it with the Workflow tool.']
      : [
          `Its script exists: ${scriptPath}`,
          "Update THAT file to match the project as it is now, changing only what the project changed, and run it with the",
          "Workflow tool's `scriptPath`. If it already matches, run it unchanged. Do not write another script.",
        ]),
    `The user approved it on the board: do not call ${OFFER_TOOL_FULL_NAME} for it again.`,
    '',
    'Before you write anything, in one message: confirm the design with the user (two or three lines on what the workflow',
    'will do, and a question about every flow in the project that is ambiguous or looks unintended) and, unless they',
    `have already said it, ask what to run it on${args === '' ? " (the start block has no `args`: where the workflow needs no input, say so and do not ask)" : ` (the start block's \`args\`: ${clip(args, WHEN_MAX)})`}.`,
    'Wait for their answer, then go on.',
    '',
    'So the run shows on the board:',
    ...(scriptPath === null
      ? [
          `- every agent() sets label: "<nodeId>: <short text>", the id being the INNERMOST project node the agent belongs to, e.g. ${example}.`,
          '- each top-level node (the `start` block left out) is one phase titled "<nodeId> <name>": list them in meta.phases in project',
          `  order and pass the title as \`phase\` on every agent() under that node.${phases.length > 0 ? ` Here: meta.phases = [${phases.join(', ')}]` : ''}`,
        ]
      : [
          '- a node with `match` is already wired by the labels or phase titles listed there (one ending in * is a prefix): keep them as they are.',
          `- every agent() of a node without \`match\` sets label: "<nodeId>: <short text>", the id being the INNERMOST project node it belongs to, e.g. ${example}.`,
          "- keep the script's meta.phases and every `phase`; a top-level node with no phase gets one titled \"<nodeId> <name>\", in project order.",
        ]),
    `- meta.name = "${project.name}".`,
  ]

  return {
    text: `handing off project "${project.name}" (${count} ${count === 1 ? 'block' : 'blocks'})`,
    context: [lines.join('\n')],
  }
}
