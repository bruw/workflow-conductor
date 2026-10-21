// The handoff: what `r` on the board tells Claude. Short on purpose: the project file says what the workflow
// does; said here is only the script to start from, what its kinds mean in the Workflow reference's terms, and how a
// run is tied back to it (label, phase, meta.name).

import { typeName, canHoldChildren, flatten, goalOf, plainKind, startOf } from './model'
import type { Kind, Project } from './model'
import { OFFER_TOOL_FULL_NAME } from './offer'
import { isSaved } from './session'
import { KIND_TEACH } from './teach'

export type Handoff = { text: string; context: string[] }

/** Outline rows the tool for Claude shows before the rest is left to the file. */
export const OUTLINE_MAX = 34
/** `condition` is not among them: an arm's condition is said before its row. */
const OUTLINE_KNOBS = ['model', 'effort', 'isolation', 'agentType', 'output', 'oncePer', 'stopCondition'] as const
/** The most of a condition an outline row says; the file has the rest. */
const CONDITION_MAX = 72

// By code point, so a cut never splits a surrogate pair.
const clipLine = (value: string, max: number = 24): string => {
  const chars = [...value]
  return (chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : value).replace(/\s+/g, ' ')
}

/** On one line and in JSON quotes, so that no name ends its string or starts a line of its own. */
const quoted = (value: string): string => JSON.stringify(value.replace(/\s+/g, ' ').trim())

function armWords(project: Project, row: { node: { knobs?: { condition?: string } }; parentId: string | undefined; index: number }): string {
  const parent = row.parentId === undefined ? undefined : flatten(project).find(one => one.node.id === row.parentId)?.node
  if (parent?.type !== 'branch') return ''
  const when = (row.node.knobs?.condition ?? '').replace(/\s+/g, ' ').trim()
  if (when !== '') return `IF ${clipLine(when, CONDITION_MAX)}: `
  const arms = parent.children?.length ?? 0
  return arms > 1 && row.index === arms - 1 ? 'ELSE: ' : 'IF (no condition set): '
}

/** One row per block: `n3 agent verify "name" [output=…] (has logic)`; an arm of a branch opens with its condition. */
export function outline(project: Project): string[] {
  const rows = flatten(project)
  const lines = rows.slice(0, OUTLINE_MAX).map(row => {
    const knobs = OUTLINE_KNOBS.filter(key => row.node.knobs?.[key] !== undefined).map(key => `${key}=${clipLine(String(row.node.knobs?.[key]))}`)
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
  return `Review the "${name}" workflow project as it is on the board now (it may have changed by hand: read it, unless a Conductor note with this prompt says what changed): is the structure right for its goal, what is missing, what is wasteful, and what are its worst-case agent count and rough wall-clock? `
}

/** `$.store` key: per project, the script its last run ran, the file the Workflow tool kept in the session folder. */
export const LAST_SCRIPTS_STORE = 'lastScripts'

export function lastScripts(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** `replace`: the run came out of a handoff, or the script remembered is gone. A run that only has the project's name may be of an older script. */
export function noteScript(value: unknown, name: string, ran: string, replace: boolean): Record<string, string> {
  const kept = lastScripts(value)
  return replace || kept[name] === undefined ? { ...kept, [name]: ran } : kept
}

/** A run of the project in this session: what a resume of it needs. */
export type LastRun = { runId: string; transcriptDir?: string }

/** `path`: the script to start from (the last run's or the saved copy), null where there is neither; `run`: the last run, where it was in this session. */
export type HandoffScript = { path: string | null; run?: LastRun }

/** Claude Code's own folder of saved workflows: it runs each `*.js` there by its `meta.name`, with `Workflow({ name })`. */
const SAVED_WORKFLOWS_DIR = '.claude/workflows'

export function savedWorkflowFile(root: string, name: string): string {
  return `${root.replace(/\/+$/, '')}/${SAVED_WORKFLOWS_DIR}/${name}.js`
}

export type ScriptFile = { path: string; mtimeMs: number }

/** A copy is made from a run's script but can be newer than any run (changed by hand, pulled), so the later file wins; a tie is the run's. */
export function newestScript(ran: ScriptFile | null, copy: ScriptFile | null): string | null {
  if (ran === null || copy === null) return (ran ?? copy)?.path ?? null
  return copy.mtimeMs > ran.mtimeMs ? copy.path : ran.path
}

/** Null `script`: unreadable; null `copy`: none saved; `answerable`: the main conversation started the run and a surface draws. */
export type SaveCase = { ending: 'done' | 'failed' | 'stopped'; project: string | undefined; script: string | null; copy: string | null; answerable: boolean }

/** `save` a first copy, `update` one that differs, null to ask nothing. */
export function saveAsk(end: SaveCase): 'save' | 'update' | null {
  if (end.ending !== 'done' || end.project === undefined || !isSaved(end.project) || !end.answerable || end.script === null) return null
  if (end.copy === null) return 'save'
  return end.copy === end.script ? null : 'update'
}

/** One line per kind the project uses, in project order; a plain kind says only what its type says. */
function kindLines(project: Project): string[] {
  const seen = new Map<Kind, string>()
  for (const row of flatten(project)) {
    const kind = row.node.kind
    if (kind !== undefined && kind !== plainKind(row.node.type) && !seen.has(kind)) seen.set(kind, `- ${typeName(row.node)}: ${KIND_TEACH[kind].script}.`)
  }
  return [...seen.values()]
}

export function buildHandoff(project: Project, projectPath: string, script: HandoffScript): Handoff {
  const scriptPath = script.path
  const run = scriptPath === null ? undefined : script.run
  const count = flatten(project).length
  // The start block is the goal and the input, not a stage: it gets no phase and no agent is labelled with it.
  const stages = project.nodes.filter(node => node.type !== 'start')
  const phases = stages.map(node => quoted(`${node.id} ${node.name}`))
  // The label's example names a block that spawns agents itself, where the project has one; with a script, one the label rule is for.
  const first = flatten(project).find(row => !canHoldChildren(row.node.type) && row.node.type !== 'start' && row.node.type !== 'code' && (scriptPath === null || !row.node.match))?.node ?? stages[0]
  const goal = goalOf(project)
  const args = (startOf(project)?.knobs?.args ?? '').replace(/\s+/g, ' ').trim()
  const example = quoted(first ? `${first.id}: ${first.name}` : 'n1: scout diff')
  const kinds = kindLines(project)

  const lines = [
    `Conductor handoff: ${scriptPath === null ? 'implement' : 'update'} and run the workflow project "${project.name}".`,
    goal === '' ? 'The project states no goal (its start block\'s `goal` is empty): take the goal from the user\'s request.' : `Goal of the workflow (the start block's \`goal\`): ${goal}`,
    '',
    `Read the project file: ${projectPath}`,
    'It defines the workflow: what each block says (its type, kind, name, logic and knobs) is what to build.',
    ...(scriptPath === null
      ? ["Write its Workflow script from the project and pass it inline as the Workflow tool's `script`."]
      : [
          `Its latest script is ${scriptPath}: read it and leave that file as it is; change only what the project changed and pass the`,
          "result inline as the Workflow tool's `script`. If it already matches, run it unchanged.",
        ]),
    ...(run === undefined ? [] : [`That run was in this session: runId ${run.runId}${run.transcriptDir === undefined ? '' : `, journal ${run.transcriptDir}/journal.jsonl`}.`]),
    ...(kinds.length > 0 ? ['', 'Its kinds, in the Workflow reference\'s terms:', ...kinds] : []),
    '',
    'Where a block\'s result sends work back (a rejection, failures, gaps), the agents that do that work are given those items in full.',
    '',
    `The user approved it on the board with r: do not call ${OFFER_TOOL_FULL_NAME} for it again.`,
    `Ask, and wait for the answer, only about what is unresolved: ${args === '' ? '' : `what to run it on, unless they have said it (the start block's \`args\`: ${clipLine(args, CONDITION_MAX)}); `}a flow that looks ambiguous or unintended.`,
    'Otherwise say in one or two lines what the workflow will do, with its worst-case agent count and rough wall-clock from',
    'its loop caps and fan-outs, and run it.',
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
