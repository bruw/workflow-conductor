// Advisory lints over a Project. Every rule is structural: it reads what blocks there are, where they stand and
// which fields are empty, never the words or the numbers typed into a field. Lints never block anything.

import { KINDS, blockCount, typeName, canHoldChildren, flatten, kindOf, walk } from './model'
import type { Project, ProjectNode } from './model'
import { KIND_TEACH, SELF_BRIEFED, VOTING_KINDS, placeholderOf } from './teach'

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

    if (needsBrief(node) && blank(node.logic) && blank(node.knobs?.prompt)) {
      lints.push({
        nodeId: node.id,
        rule: 'agent-no-brief',
        message: 'agent has no logic and no prompt, so only its name says what it does: write its task in logic, or what to tell it in prompt',
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

// Preflight: what a project implies before it is handed off

/** A floor: nothing typed into a field is read for a count, so a block that may run more than once counts once (`unknownsOf`). */
function leastAgents(node: ProjectNode): number {
  if (canHoldChildren(node.type)) {
    const kids = (node.children ?? []).map(leastAgents)
    if (node.type === 'branch') return kids.length > 1 ? Math.min(...kids) : 0
    return kids.reduce((sum, one) => sum + one, 0)
  }
  return node.type === 'agent' ? 1 : 0
}

/** Why the count of agents is only a floor: the blocks that may run their agents more than once, by type. */
export type Unknowns = { fanouts: number; loops: number; votes: number; subworkflows: number; branches: number }

/** A branch counts when its arms do not all start as many agents (its one arm, against none). */
function unknownsOf(project: Project): Unknowns {
  const out: Unknowns = { fanouts: 0, loops: 0, votes: 0, subworkflows: 0, branches: 0 }
  for (const { node } of flatten(project)) {
    if (node.type === 'pipeline' || node.type === 'parallel') out.fanouts++
    if (node.type === 'loop') out.loops++
    if (node.type === 'agent' && node.kind !== undefined && VOTING_KINDS.includes(node.kind)) out.votes++
    if (node.type === 'subworkflow') out.subworkflows++
    const arms = node.type === 'branch' ? (node.children ?? []).map(leastAgents) : []
    if (arms.length === 1 ? (arms[0] ?? 0) > 0 : new Set(arms).size > 1) out.branches++
  }
  return out
}

export type Preflight = { blocks: number; agents: number; lintIds: string[]; unknowns: Unknowns }

export function preflight(project: Project): Preflight {
  return { blocks: blockCount(project), agents: project.nodes.reduce((sum, node) => sum + leastAgents(node), 0), lintIds: lintIds(lint(project)), unknowns: unknownsOf(project) }
}

/** `agents = 3` where every block runs once, `agents ≥ 12` where the number is only the fewest. */
export function agentsCount(agents: number, unknowns: Unknowns): string {
  return `agents ${unknowns.fanouts + unknowns.loops + unknowns.votes + unknowns.subworkflows + unknowns.branches > 0 ? '≥' : '='} ${agents}`
}

/** `agents ≥ 12 (more: 2 blocks may fan out, 1 loop repeats)`. */
export function agentsText(agents: number, unknowns: Unknowns): string {
  const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`
  const why = [
    unknowns.fanouts > 0 ? `${plural(unknowns.fanouts, 'block', 'blocks')} may fan out` : '',
    unknowns.loops > 0 ? `${plural(unknowns.loops, 'loop repeats', 'loops repeat')}` : '',
    unknowns.votes > 0 ? `${plural(unknowns.votes, 'block votes', 'blocks vote')}` : '',
    unknowns.subworkflows > 0 ? `${plural(unknowns.subworkflows, 'subworkflow starts', 'subworkflows start')} its own` : '',
    unknowns.branches > 0 ? `${plural(unknowns.branches, 'branch picks', 'branches pick')} an arm` : '',
  ].filter(part => part !== '')
  return `${agentsCount(agents, unknowns)}${why.length === 0 ? '' : ` (more: ${why.join(', ')})`}`
}

/** The detail pane marks the ones that are not set. */
export function problemFields(rule: LintRule): string[] {
  if (rule === 'agent-no-brief') return ['logic', 'prompt']
  if (rule === 'loop-unbounded' || rule === 'loop-no-decider') return ['stopCondition']
  if (rule === 'code-input-no-output') return ['output']
  if (rule === 'arm-no-condition') return ['condition']
  if (rule === 'start-no-goal') return ['goal']
  return []
}

export function lintIds(lints: readonly Lint[]): string[] {
  return [...new Set(lints.map(one => one.nodeId))]
}

/** How many block ids a preflight line names before it says `…`. */
export const LINT_IDS_MAX = 6

/** `agents = 3 · problems in n3, n5`; nothing is said of problems where there are none. */
export function preflightLine(project: Project): string {
  const { agents, lintIds: ids, unknowns } = preflight(project)
  const named = `${ids.slice(0, LINT_IDS_MAX).join(', ')}${ids.length > LINT_IDS_MAX ? ', …' : ''}`
  return [agentsText(agents, unknowns), ...(ids.length === 0 ? [] : [`problems in ${named}`])].join(' · ')
}
