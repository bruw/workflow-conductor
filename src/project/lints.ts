// Advisory lints over a Project. Every rule is structural: it reads what blocks there are, where they stand and
// which fields are empty, never the words or the numbers typed into a field. Lints never block anything.

import { KINDS, typeName, flatten, kindOf, walk } from './model'
import type { Project, ProjectNode } from './model'
import { KIND_TEACH, SELF_BRIEFED, placeholderOf } from './teach'

export type LintRule =
  | 'loop-unbounded'
  | 'code-input-no-output'
  | 'agent-no-brief'
  | 'verify-nothing-before'
  | 'single-branch'
  | 'loop-no-decider'
  | 'arm-no-condition'
  | 'start-no-goal'

export type Lint = { nodeId: string; rule: LintRule; message: string }

function blank(text: string | undefined): boolean {
  return text === undefined || text.trim() === ''
}

export function needsBrief(node: Pick<ProjectNode, 'type' | 'kind'>): boolean {
  return node.type === 'agent' && !(node.kind !== undefined && SELF_BRIEFED.includes(node.kind))
}

/** The kind `dry` is exempt: its pattern is its bound. */
export function needsStop(node: Pick<ProjectNode, 'type' | 'kind'>): boolean {
  return node.type === 'loop' && node.kind !== 'dry'
}

const LOOP_STOPS: Readonly<Record<string, string | undefined>> = Object.fromEntries(KINDS.loop.map(kind => [kind, KIND_TEACH[kind].fill?.stopCondition]))

// The node whose output a sibling placed right after `node` receives: itself, or the last stage of a container that is no branch.
function producer(node: ProjectNode): ProjectNode {
  const last = node.children?.at(-1)
  return last && node.type !== 'branch' ? producer(last) : node
}

// As `producer`, but each arm of a parallel hands its own output on.
function producers(node: ProjectNode): ProjectNode[] {
  if (node.type === 'parallel' && (node.children?.length ?? 0) > 0) return (node.children ?? []).flatMap(producers)
  const last = node.children?.at(-1)
  return last && node.type !== 'branch' ? producers(last) : [node]
}

/** Containers whose blocks run one after the other: a block in one receives what the block before it made. */
const CHAINS: readonly string[] = ['pipeline', 'loop']

// Whether anything reaches `node` to work on: a block before it in a chain around it, a fan-out over items, or the
// round before in a loop. The `start` block is no block before it: it makes no result to check.
function hasInput(project: Project, id: string): boolean {
  const rows = flatten(project)
  let row = rows.find(one => one.node.id === id)
  while (row) {
    const parent = row.parentId === undefined ? undefined : rows.find(one => one.node.id === row?.parentId)
    const chained = parent === undefined || CHAINS.includes(parent.node.type)
    const before = (parent === undefined ? project.nodes : (parent.node.children ?? [])).slice(0, row.index)
    if (chained && before.some(one => one.type !== 'start')) return true
    if (parent === undefined) return false
    if (!blank(parent.node.knobs?.oncePer)) return true
    if (parent.node.type === 'loop' && (parent.node.children?.length ?? 0) > 1) return true
    row = parent
  }
  return false
}

export function lint(project: Project): Lint[] {
  const lints: Lint[] = []

  walk(project, (node, info) => {
    const siblings = info.parent?.children ?? project.nodes
    const previous = siblings[info.index - 1]

    if (node.type === 'start' && blank(node.knobs?.goal)) {
      lints.push({ nodeId: node.id, rule: 'start-no-goal', message: 'the workflow has no goal: say in goal what it is for, in a sentence; Claude writes the script, and reviews the project, against it' })
    }

    if (needsStop(node) && blank(node.knobs?.stopCondition)) {
      const stops = kindOf(node)
      lints.push({
        nodeId: node.id,
        rule: 'loop-unbounded',
        message: `loop has no stop condition: say when it stops (${stops === 'custom' ? 'a count, dry rounds, a check that passes or a budget' : `e.g. "${LOOP_STOPS[stops ?? 'custom'] ?? '3 rounds'}"`}), or it runs to the 1000-agent cap`,
      })
    }

    // The lint lands on the agent, not on the code block.
    if (node.type === 'code' && previous) {
      for (const source of producers(previous)) {
        if (source.type !== 'agent' || !blank(source.knobs?.output)) continue
        lints.push({
          nodeId: source.id,
          rule: 'code-input-no-output',
          message: `"${node.name}" is code reading this agent's output, which is free text with no output set: set its output to get a validated object`,
        })
      }
    }

    if (needsBrief(node) && blank(node.logic)) {
      lints.push({
        nodeId: node.id,
        rule: 'agent-no-brief',
        message: 'agent has no logic, so only its name says what it does: write its task in logic',
      })
    }

    if (node.kind === 'verify' && !hasInput(project, node.id)) {
      lints.push({
        nodeId: node.id,
        rule: 'verify-nothing-before',
        message: 'verify has nothing before it to check: put it after the block whose results it should check (Shift+W / Shift+S move it)',
      })
    }

    // One block run once per item is a real use of a parallel: only one that states no fan-out is told.
    const only = node.children?.length === 1 ? node.children[0] : undefined
    if (node.type === 'parallel' && only && blank(node.knobs?.oncePer) && blank(only.knobs?.oncePer)) {
      lints.push({
        nodeId: node.id,
        rule: 'single-branch',
        message:
          kindOf(node) === 'arms'
            ? `parallel holds one block, so nothing runs side by side: add the other blocks (n adds a block, n again: inside), set once per to run it once per item, or take "${only.name}" out and delete the parallel`
            : `${typeName(node)} does not say what "${only.name}" runs once per, so it runs once: set once per (${placeholderOf(node, 'oncePer').replace(/^the items, /, '')})`,
      })
    }

    // The last block of a round is what the stop test reads. A round that ends in code, a branch or a subworkflow is
    // left alone, and so is a loop of kind `count` or `budget`: its stop test reads no block's result.
    if (node.type === 'loop' && node.kind !== 'count' && node.kind !== 'budget' && (node.children?.length ?? 0) > 0) {
      const last = producer(node)
      const free = last.type === 'agent' && blank(last.knobs?.output)
      const endless = last.kind === 'critic' && blank(node.knobs?.stopCondition)
      if (free || endless) {
        lints.push({
          nodeId: node.id,
          rule: 'loop-no-decider',
          message: free
            ? `nothing decides the next round: the round ends with "${last.name}" (${last.id}), whose result is free text. Give ${last.id} an output the stop test can read (e.g. { found: [...] }), or end the round with a code block that counts`
            : `nothing decides the next round: "${last.name}" (${last.id}) ends each round with new gaps and the loop has no stop condition. Say when it stops (e.g. no gaps, or 3 rounds)`,
        })
      }
    }

    // The last of several arms is the else and needs no condition. A guard has one arm by design.
    const arms = info.parent?.type === 'branch' ? siblings.length : 0
    if (arms > 0 && blank(node.knobs?.condition) && (info.index < arms - 1 || arms === 1)) {
      lints.push({
        nodeId: node.id,
        rule: 'arm-no-condition',
        message:
          arms > 1
            ? `this arm of branch ${info.parent?.id ?? ''} has no condition, so nothing says when it runs: set condition (e.g. "no findings"); only the last arm may go without one, as the else`
            : info.parent?.kind === 'guard'
              ? `the arm of guard ${info.parent.id} has no condition, so nothing says when it runs: set condition (e.g. "any findings"); when it does not hold, nothing runs`
              : `the only arm of branch ${info.parent?.id ?? ''} has no condition, so nothing says when it runs: set condition (e.g. "no findings"), and add the arm for when it does not hold`,
      })
    }
  })

  return lints
}

/** The detail pane marks the ones that are not set. */
export function problemFields(rule: LintRule): string[] {
  if (rule === 'agent-no-brief') return ['logic']
  if (rule === 'loop-unbounded' || rule === 'loop-no-decider') return ['stopCondition']
  if (rule === 'code-input-no-output') return ['output']
  if (rule === 'arm-no-condition') return ['condition']
  if (rule === 'start-no-goal') return ['goal']
  return []
}

function lintIds(lints: readonly Lint[]): string[] {
  return [...new Set(lints.map(one => one.nodeId))]
}

/** How many block ids a preflight line names before it says `…`. */
const LINT_IDS_MAX = 6

/** `problems in n3, n5`, or null where there are none: said when a project is handed off. */
export function preflightLine(project: Project): string | null {
  const ids = lintIds(lint(project))
  if (ids.length === 0) return null
  return `problems in ${ids.slice(0, LINT_IDS_MAX).join(', ')}${ids.length > LINT_IDS_MAX ? ', …' : ''}`
}
