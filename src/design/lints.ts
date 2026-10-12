// Advisory lints over a Design. Every rule is structural: it reads what blocks
// there are, where they stand and which fields are empty, never the words or
// the numbers typed into a field. Lints never block anything.

import { KINDS, blockCount, typeName, canHoldChildren, flatten, kindOf, walk } from './model'
import type { Design, DesignNode } from './model'
import { KIND_TEACH, SELF_BRIEFED, VOTING_KINDS, placeholderOf } from './teach'

export type LintRule =
  | 'loop-unbounded'
  | 'code-input-no-output'
  // structural: what a block is missing to mean anything
  | 'agent-no-brief'
  | 'verify-nothing-before'
  | 'single-branch'
  | 'loop-no-decider'
  | 'arm-no-condition'

export type Lint = { nodeId: string; rule: LintRule; message: string }

function blank(text: string | undefined): boolean {
  return text === undefined || text.trim() === ''
}

/** Whether a block is an agent that has to be told its task: every agent but the kinds whose name is the task. */
export function needsBrief(node: Pick<DesignNode, 'type' | 'kind'>): boolean {
  return node.type === 'agent' && !(node.kind !== undefined && SELF_BRIEFED.includes(node.kind))
}

/** Whether a loop has to say when it stops: every loop but the kind `dry`, whose pattern is its bound. */
export function needsStop(node: Pick<DesignNode, 'type' | 'kind'>): boolean {
  return node.type === 'loop' && node.kind !== 'dry'
}

/** A stop condition to name as the example, by the loop's kind: what the kind fills in. */
const LOOP_STOPS: Readonly<Record<string, string | undefined>> = Object.fromEntries(KINDS.loop.map(kind => [kind, KIND_TEACH[kind].fill?.stopCondition]))

// The node whose output a sibling placed right after `node` receives: the
// node itself, or the last stage of a pipeline, parallel, sweep or loop.
function producer(node: DesignNode): DesignNode {
  const last = node.children?.at(-1)
  return last && node.type !== 'branch' ? producer(last) : node
}

/** Containers whose blocks run one after the other: a block in one receives what the block before it made. */
const CHAINS: readonly string[] = ['pipeline', 'loop', 'phase']

/**
 * Whether anything reaches `node` to work on. It does when a block stands before
 * it in a chain (its own, or any chain around it), when a container around it
 * fans out over items, or when it sits in a loop beside other blocks (the round
 * before feeds it). The top level is a chain.
 */
function hasInput(design: Design, id: string): boolean {
  const rows = flatten(design)
  let row = rows.find(one => one.node.id === id)
  while (row) {
    const parent = row.parentId === undefined ? undefined : rows.find(one => one.node.id === row?.parentId)
    const chained = parent === undefined || CHAINS.includes(parent.node.type)
    if (chained && row.index > 0) return true
    if (parent === undefined) return false
    if (!blank(parent.node.knobs?.oncePer)) return true
    if (parent.node.type === 'loop' && (parent.node.children?.length ?? 0) > 1) return true
    row = parent
  }
  return false
}

export function lint(design: Design): Lint[] {
  const lints: Lint[] = []

  walk(design, (node, info) => {
    const siblings = info.parent?.children ?? design.nodes
    const previous = siblings[info.index - 1]

    // 1, 2. (Barrier not needed, worktree on a reader: gone, they guessed from the words of a block.)

    // 3. Unbounded loop. Structural: a `loop` with an empty `stopCondition`.
    // The kind `dry` is exempt: the pattern is its bound.
    if (needsStop(node) && blank(node.knobs?.stopCondition)) {
      const stops = kindOf(node)
      lints.push({
        nodeId: node.id,
        rule: 'loop-unbounded',
        message: `loop has no stop condition: say when it stops (${stops === 'custom' ? 'a count, dry rounds, a check that passes or a budget' : `e.g. "${LOOP_STOPS[stops ?? 'custom'] ?? '3 rounds'}"`}), or it runs to the 1000-agent cap`,
      })
    }

    // 4. Code fed by free text. Structural: a `code` node whose previous sibling
    // is an `agent` with no `output` knob, or a container (not a branch) whose
    // last stage is such an agent. The lint lands on the agent.
    if (node.type === 'code' && previous) {
      const source = producer(previous)
      if (source.type === 'agent' && blank(source.knobs?.output)) {
        lints.push({
          nodeId: source.id,
          rule: 'code-input-no-output',
          message: `"${node.name}" is code reading this agent's output, which is free text with no output set: set its output to get a validated object`,
        })
      }
    }

    // 5. (Fan-out over the cap: gone, it read a number out of `oncePer`.)

    // 6. An agent nobody briefed. Structural: an `agent` block with neither
    // notes nor a prompt knob. Its title is all Claude has to write a prompt from.
    // The kinds whose name is the brief (verify, judge, critic) are left alone.
    if (needsBrief(node) && blank(node.logic) && blank(node.knobs?.prompt)) {
      lints.push({
        nodeId: node.id,
        rule: 'agent-no-brief',
        message: 'agent has no logic and no prompt, so only its name says what it does: write its task in logic, or what to tell it in prompt',
      })
    }

    // 7. (A vote with no count: gone with the `votes` knob. The numbers after it stay.)

    // 8. A verify with nothing to verify. Structural: see `hasInput`.
    if (node.kind === 'verify' && !hasInput(design, node.id)) {
      lints.push({
        nodeId: node.id,
        rule: 'verify-nothing-before',
        message: 'verify has nothing before it to check: put it after the block whose results it should check (Shift+W / Shift+S move it)',
      })
    }

    // 9. One block side by side with nothing. Structural: a `parallel` holding
    // exactly one block, where neither it nor that block states a fan-out (one
    // block run once per item is a real use of it). A plain parallel is told to
    // add the other blocks; one of a kind that runs its block several times
    // (each, sweep, attempts) only lacks what it runs once per.
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

    // 10. A loop nothing decides. Structural: the last block of a round (the
    // last stage, followed into containers) is what the stop test reads. The
    // lint fires when that block is an agent with no `output` (free text: the
    // stop condition has nothing exact to test), or when it is a critic and
    // the loop states no stop condition (its gaps start another round, every round).
    // A round that ends in `code`, a `branch` or a subworkflow is left alone.
    if (node.type === 'loop' && (node.children?.length ?? 0) > 0) {
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

    // 11. An arm nothing picks. Structural: a block directly in a `branch` with
    // no `condition`, unless it is the last of several arms (the else). The graph
    // writes `IF [not set]` on the same arms.
    // A guard has one arm by design: it is not told to add another.
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

// ---------------------------------------------------------------------------
// Preflight: what a design implies before it is handed off

/**
 * The fewest agents a block implies: one per agent block, the cheapest arm of a branch. Nothing typed
 * into a field is read for a count: what a block runs once per, its votes and a loop's rounds are words
 * for Claude, so a block that may run more than once counts once and makes the sum a floor (`unknownsOf`).
 */
function leastAgents(node: DesignNode): number {
  if (canHoldChildren(node.type)) {
    const kids = (node.children ?? []).map(leastAgents)
    if (node.type === 'branch') return kids.length > 0 ? Math.min(...kids) : 0
    return kids.reduce((sum, one) => sum + one, 0)
  }
  return node.type === 'agent' ? 1 : 0
}

/** Why the count of agents is only a floor: how many blocks of each type that may run its agents more than once. */
export type Unknowns = { fanouts: number; loops: number; votes: number; subworkflows: number }

/** By type and kind alone: a pipeline or a parallel may fan out, a loop repeats, a verify or a judge votes, a subworkflow starts its own. */
function unknownsOf(design: Design): Unknowns {
  const out: Unknowns = { fanouts: 0, loops: 0, votes: 0, subworkflows: 0 }
  for (const { node } of flatten(design)) {
    if (node.type === 'pipeline' || node.type === 'parallel') out.fanouts++
    if (node.type === 'loop') out.loops++
    if (node.type === 'agent' && node.kind !== undefined && VOTING_KINDS.includes(node.kind)) out.votes++
    if (node.type === 'subworkflow') out.subworkflows++
  }
  return out
}

export type Preflight = { blocks: number; agents: number; lintIds: string[]; unknowns: Unknowns }

/** What a hand-off is about to start: how many blocks, the fewest agents they imply (and what makes the real count larger), and which blocks a lint stands on. */
export function preflight(design: Design): Preflight {
  return { blocks: blockCount(design), agents: design.nodes.reduce((sum, node) => sum + leastAgents(node), 0), lintIds: lintIds(lint(design)), unknowns: unknownsOf(design) }
}

/** The agents a design starts, as a count: `agents = 3` where every block runs once, `agents ≥ 12` where the number is only the fewest. */
export function agentsCount(agents: number, unknowns: Unknowns): string {
  return `agents ${unknowns.fanouts + unknowns.loops + unknowns.votes + unknowns.subworkflows > 0 ? '≥' : '='} ${agents}`
}

/**
 * The agents a design starts, as far as the drawing says. Every block runs once: `agents = 3`. Otherwise the
 * floor is marked as one and the reason follows: `agents ≥ 12 (more: 2 blocks may fan out, 1 loop repeats)`.
 */
export function agentsText(agents: number, unknowns: Unknowns): string {
  const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`
  const why = [
    unknowns.fanouts > 0 ? `${plural(unknowns.fanouts, 'block', 'blocks')} may fan out` : '',
    unknowns.loops > 0 ? `${plural(unknowns.loops, 'loop repeats', 'loops repeat')}` : '',
    unknowns.votes > 0 ? `${plural(unknowns.votes, 'block votes', 'blocks vote')}` : '',
    unknowns.subworkflows > 0 ? `${plural(unknowns.subworkflows, 'subworkflow starts', 'subworkflows start')} its own` : '',
  ].filter(part => part !== '')
  return `${agentsCount(agents, unknowns)}${why.length === 0 ? '' : ` (more: ${why.join(', ')})`}`
}

/**
 * A lint's message as the detail pane says a problem: what is wrong (up to the first colon),
 * and how to fix it (the rest, its first letter capital). A message with no colon is all `error`.
 */
export function problemParts(message: string): { error: string; fix: string } {
  const at = message.indexOf(': ')
  if (at < 0) return { error: message, fix: '' }
  const fix = message.slice(at + 2).trim()
  return { error: message.slice(0, at).trim(), fix: fix.charAt(0).toUpperCase() + fix.slice(1) }
}

/** The fields of its block a problem is about: the detail pane marks the ones that are not set. */
export function problemFields(rule: LintRule): string[] {
  if (rule === 'agent-no-brief') return ['logic', 'prompt']
  if (rule === 'loop-unbounded' || rule === 'loop-no-decider') return ['stopCondition']
  if (rule === 'code-input-no-output') return ['output']
  if (rule === 'arm-no-condition') return ['condition']
  return []
}

/** The blocks that carry a lint, each once, in the order the lints were raised. */
export function lintIds(lints: readonly Lint[]): string[] {
  return [...new Set(lints.map(one => one.nodeId))]
}

/** How many block ids a preflight line names before it says `…`. */
export const LINT_IDS_MAX = 6

/**
 * `agents = 3 · problems in n3, n5`, or `agents ≥ 12 (more: …)` where a block may run more than once; the
 * blocks that have a problem are named, and nothing is said of problems where there are none. It informs; nothing is blocked.
 */
export function preflightLine(design: Design): string {
  const { agents, lintIds: ids, unknowns } = preflight(design)
  const named = `${ids.slice(0, LINT_IDS_MAX).join(', ')}${ids.length > LINT_IDS_MAX ? ', …' : ''}`
  return [agentsText(agents, unknowns), ...(ids.length === 0 ? [] : [`problems in ${named}`])].join(' · ')
}
