// Advisory lints over a Design. A design is a loose spec, so every rule is a
// structural or keyword heuristic, stated above the rule. Each one prefers
// missing a case to raising a false alarm. Lints never block anything.

import { blockCount, canHoldChildren, flatten, walk } from './model'
import type { Design, DesignNode } from './model'

export type LintRule =
  | 'barrier-not-needed'
  | 'worktree-read-only'
  | 'loop-unbounded'
  | 'code-input-no-schema'
  | 'fanout-over-cap'
  // structural: what a block is missing to mean anything
  | 'agent-no-brief'
  | 'no-votes'
  | 'verify-nothing-before'
  | 'single-branch'
  | 'loop-no-decider'
  | 'arm-no-when'

export type Lint = { nodeId: string; rule: LintRule; message: string }

/** Agents that run at once in one workflow; further calls queue. */
export const CONCURRENCY_CAP = 16

// Words that say a stage works on the whole result set at once.
const CROSS_ITEM = /\b(dedup\w*|de-dup\w*|merg\w+|compar\w+|all|every|across|together|overall|rank\w*|scor\w+|winner|best|pick\w*|select\w*|synthes\w+|summar\w+|aggregat\w+|combin\w+|collect\w*|total|count\w*|zero|none|early[- ]exit)\b/i
const WRITES = /\b(edit\w*|writ\w+|fix\w*|transform\w*|migrat\w+|modif\w+|chang\w+|refactor\w*|renam\w+|appl\w+|patch\w*|updat\w+|replac\w+|rewrit\w+|creat\w+|delet\w+|remov\w+|generat\w+|implement\w*|codemod\w*|format\w*|mutat\w+|add\w*|insert\w*|install\w*|upgrad\w+|convert\w*|port\w*|build\w*|commit\w*)\b/i
const READS = /\b(read\w*|review\w*|scan\w*|search\w*|find\w*|discover\w*|analy[sz]\w+|inspect\w*|audit\w*|list\w*|explor\w+|summar\w+|verif\w+|check\w*|judg\w+|critiqu\w+|scout\w*|grep\w*|look\w*|map\w*|survey\w*)\b/i
const BOUNDED = /\b(until|budget|max\w*|at most|rounds?|times|cap\w*|limit\w*|stop\w*|dry|while|iterations?|attempts?|retries|converg\w+)\b/i

function words(node: DesignNode): string {
  return [node.title, node.notes ?? '', node.knobs?.prompt ?? ''].join(' ')
}

function blank(text: string | undefined): boolean {
  return text === undefined || text.trim() === ''
}

// The node whose output a sibling placed right after `node` receives: the
// node itself, or the last stage of a pipeline, parallel, sweep or loop.
function producer(node: DesignNode): DesignNode {
  const last = node.children?.at(-1)
  return last && node.type !== 'branch' ? producer(last) : node
}

// The block that receives what stands before `node`: the node itself, or the
// first block of a phase (a phase only frames what it holds).
function receiver(node: DesignNode): DesignNode {
  const first = node.type === 'phase' ? node.children?.[0] : undefined
  return first ? receiver(first) : node
}

/** Containers whose blocks run one after the other: a block in one receives what the block before it made. */
const CHAINS: readonly string[] = ['pipeline', 'loop', 'loop-until-dry', 'phase']
/** Leaves whose result is a model's answer: free text unless a schema is set. */
const ANSWERS: readonly string[] = ['agent', 'verify', 'judge-panel', 'critic']

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
    if (!blank(parent.node.knobs?.fanout)) return true
    if ((parent.node.type === 'loop' || parent.node.type === 'loop-until-dry') && (parent.node.children?.length ?? 0) > 1) return true
    row = parent
  }
  return false
}

export function lint(design: Design): Lint[] {
  const lints: Lint[] = []

  walk(design, (node, info) => {
    const siblings = info.parent?.children ?? design.nodes
    const next = siblings[info.index + 1]
    const previous = siblings[info.index - 1]

    // 1. Barrier not needed. Heuristic: a `parallel` node directly followed by
    // a sibling that is neither a `code` node nor a `judge-panel` (both work on
    // the full set by nature) and whose title, notes and prompt carry no word
    // about working across items (dedup, merge, compare, all, rank, …).
    // A parallel with nothing after it returns its results and is left alone.
    // A phase after it is looked into (its first block is the sibling), and an empty one is left alone.
    const taker = next ? receiver(next) : undefined
    if (node.type === 'parallel' && taker && taker.type !== 'phase' && taker.type !== 'code' && taker.type !== 'judge-panel' && !CROSS_ITEM.test(words(taker))) {
      lints.push({
        nodeId: node.id,
        rule: 'barrier-not-needed',
        message: `parallel waits for all results, but "${taker.title}" does not seem to need them together: make it a pipeline so each item moves on as it finishes`,
      })
    }

    // 2. Worktree on a reader. Heuristic: `isolation: worktree` on a node whose
    // title, notes and prompt contain a reading word (read, review, search,
    // verify, …) and no writing word (edit, fix, transform, migrate, …).
    // Text with neither kind of word is not flagged.
    if (node.knobs?.isolation === 'worktree' && READS.test(words(node)) && !WRITES.test(words(node))) {
      lints.push({
        nodeId: node.id,
        rule: 'worktree-read-only',
        message: 'worktree isolation costs setup time and disk per agent and only helps agents that edit files at the same time; this one looks read-only: ask Claude in the prompt to drop the worktree from this block',
      })
    }

    // 3. Unbounded loop. Heuristic: a `loop` node with an empty `until` knob
    // whose title, notes and prompt mention no bound (until, budget, max,
    // rounds, limit, …). `loop-until-dry` is exempt: the pattern is its bound.
    if (node.type === 'loop' && blank(node.knobs?.until) && !BOUNDED.test(words(node))) {
      lints.push({
        nodeId: node.id,
        rule: 'loop-unbounded',
        message: 'loop has no until: say when it stops (a count, dry rounds or a budget guard), or it runs to the 1000-agent cap',
      })
    }

    // 4. Code fed by free text. Heuristic: a `code` node whose previous sibling
    // is an `agent` with no `schema` knob, or a container (not a branch) whose
    // last stage is such an agent. The lint lands on the agent.
    if (node.type === 'code' && previous) {
      const source = producer(previous)
      if (source.type === 'agent' && blank(source.knobs?.schema)) {
        lints.push({
          nodeId: source.id,
          rule: 'code-input-no-schema',
          message: `"${node.title}" is code reading this agent's output, which is free text without a schema: set a schema to get a validated object`,
        })
      }
    }

    // 5. Fan-out over the cap behind a barrier. Heuristic: a `parallel` node
    // whose `fanout` knob contains a whole number above 16 ("×40 files",
    // "~200 call sites"). Fan-out given only in words is not flagged.
    if (node.type === 'parallel') {
      const numbers = (node.knobs?.fanout ?? '').match(/\d[\d,]*/g) ?? []
      const largest = Math.max(0, ...numbers.map(one => Number(one.replace(/,/g, ''))))
      if (largest > CONCURRENCY_CAP) {
        lints.push({
          nodeId: node.id,
          rule: 'fanout-over-cap',
          message: `fan-out of ${largest} is above the ~${CONCURRENCY_CAP} agents that run at once: the rest queue, and everything after waits for the last one. Use a pipeline, or fan out over fewer, larger items`,
        })
      }
    }

    // 6. An agent nobody briefed. Structural: an `agent` block with neither
    // notes nor a prompt knob. Its title is all Claude has to write a prompt from.
    if (node.type === 'agent' && blank(node.notes) && blank(node.knobs?.prompt)) {
      lints.push({
        nodeId: node.id,
        rule: 'agent-no-brief',
        message: 'agent has no notes and no prompt, so only its title says what it does: write its task in notes, or what to tell it in prompt',
      })
    }

    // 7. A vote with no count. Structural: a `verify` or `judge-panel` whose
    // `votes` knob is unset.
    if ((node.type === 'verify' || node.type === 'judge-panel') && node.knobs?.votes === undefined) {
      lints.push({
        nodeId: node.id,
        rule: 'no-votes',
        message: `${node.type} has no votes, so how many ${node.type === 'verify' ? 'checkers look at each result' : 'judges score the attempts'} is left to chance: set votes (1 is a quick check, 3 a majority)`,
      })
    }

    // 8. A verify with nothing to verify. Structural: see `hasInput`.
    if (node.type === 'verify' && !hasInput(design, node.id)) {
      lints.push({
        nodeId: node.id,
        rule: 'verify-nothing-before',
        message: 'verify has nothing before it to check: put it after the block whose results it should check (Shift+W / Shift+S move it)',
      })
    }

    // 9. One branch side by side with nothing. Structural: a `parallel` or
    // `sweep` holding exactly one block, where neither it nor that block states
    // a fan-out (one block run once per item is a real use of both).
    const only = node.children?.length === 1 ? node.children[0] : undefined
    if ((node.type === 'parallel' || node.type === 'sweep') && only && blank(node.knobs?.fanout) && blank(only.knobs?.fanout)) {
      lints.push({
        nodeId: node.id,
        rule: 'single-branch',
        message: `${node.type} holds one block, so nothing runs side by side: add the other ${node.type === 'sweep' ? 'searchers' : 'blocks'} (n adds a block, n again: inside), set fanout to run it once per item, or take "${only.title}" out and delete the ${node.type}`,
      })
    }

    // 10. A loop nothing decides. Structural: the last block of a round (the
    // last stage, followed into containers) is what the stop test reads. The
    // lint fires when that block is a model's answer with no `schema` (free
    // text: `until` has nothing exact to test), or when it is a `critic` and
    // the loop states no `until` (its gaps start another round, every round).
    // A round that ends in `code`, a `branch` or a subworkflow is left alone.
    if ((node.type === 'loop' || node.type === 'loop-until-dry') && (node.children?.length ?? 0) > 0) {
      const last = producer(node)
      const free = ANSWERS.includes(last.type) && blank(last.knobs?.schema)
      const endless = last.type === 'critic' && blank(node.knobs?.until)
      if (free || endless) {
        lints.push({
          nodeId: node.id,
          rule: 'loop-no-decider',
          message: free
            ? `nothing decides the next round: the round ends with "${last.title}" (${last.id}), whose result is free text. Give ${last.id} a schema the stop test can read (e.g. { found: [...] }), or end the round with a code block that counts`
            : `nothing decides the next round: "${last.title}" (${last.id}) ends each round with new gaps and the loop has no until. Say when it stops (e.g. until: no gaps, or 3 rounds)`,
        })
      }
    }

    // 11. An arm nothing picks. Structural: a block directly in a `branch` with
    // no `when`, unless it is the last of several arms (the else). The graph
    // writes `IF [not set]` on the same arms.
    const arms = info.parent?.type === 'branch' ? siblings.length : 0
    if (arms > 0 && blank(node.knobs?.when) && (info.index < arms - 1 || arms === 1)) {
      lints.push({
        nodeId: node.id,
        rule: 'arm-no-when',
        message:
          arms === 1
            ? `the only arm of branch ${info.parent?.id ?? ''} has no condition, so nothing says when it runs: set when (e.g. "no findings"), and add the arm for when it does not hold`
            : `this arm of branch ${info.parent?.id ?? ''} has no condition, so nothing says when it runs: set when (e.g. "no findings"); only the last arm may go without one, as the else`,
      })
    }
  })

  return lints
}

// ---------------------------------------------------------------------------
// Preflight: what a design implies before it is handed off

/** The count a fan-out states at its start (`×4 dimensions`, `12 files`); 1 when it names none. */
function statedCount(fanout: string | undefined): number {
  const count = /^\s*[×x]?\s*(\d+)\b/.exec(fanout ?? '')
  return count ? Math.max(1, Number(count[1])) : 1
}

/**
 * The fewest agents a block implies. A fan-out or votes count multiplies only
 * where it is a number; a fan-out in words, a loop's rounds and a subworkflow's
 * own agents count once or not at all, so the sum is a floor, never an estimate.
 */
function leastAgents(node: DesignNode): number {
  const times = statedCount(node.knobs?.fanout)
  if (canHoldChildren(node.type)) {
    const kids = (node.children ?? []).map(leastAgents)
    // One path of a branch runs: the cheapest. An empty sweep or dry loop still spawns its own searchers.
    if (node.type === 'branch') return kids.length > 0 ? Math.min(...kids) : 0
    const inside = kids.reduce((sum, one) => sum + one, 0)
    if (kids.length === 0) return node.type === 'sweep' || node.type === 'loop-until-dry' ? times : 0
    // Branches side by side: the count may name the branches drawn (`×2 angles`, two searchers) or items each
    // of them runs for. The floor holds for both readings. Stages in a row run once per item.
    if (node.type === 'parallel' || node.type === 'sweep') return Math.max(inside, times)
    return inside * times
  }
  if (node.type === 'code' || node.type === 'subworkflow' || node.type === 'args') return 0
  if (node.type === 'verify' || node.type === 'judge-panel') return times * (node.knobs?.votes ?? 1)
  return times
}

/** Why the count of agents cannot be known from the drawing: what each kind of open end is, and how many blocks have it. */
export type Unknowns = { fanouts: number; loops: number; subworkflows: number }

function unknownsOf(design: Design): Unknowns {
  const out: Unknowns = { fanouts: 0, loops: 0, subworkflows: 0 }
  for (const { node } of flatten(design)) {
    // A fan-out said in words (`changed files`) names no number.
    if (node.knobs?.fanout && !/^\s*[×x]?\s*\d+\b/.test(node.knobs.fanout)) out.fanouts++
    if ((node.type === 'loop' || node.type === 'loop-until-dry') && (node.children?.length ?? 0) > 0) out.loops++
    if (node.type === 'subworkflow') out.subworkflows++
  }
  return out
}

export type Preflight = { blocks: number; agents: number; lintIds: string[]; unknowns: Unknowns }

/** What a hand-off is about to start: how many blocks, the fewest agents they imply (and what makes the real count larger), and which blocks a lint stands on. */
export function preflight(design: Design): Preflight {
  return { blocks: blockCount(design), agents: design.nodes.reduce((sum, node) => sum + leastAgents(node), 0), lintIds: lintIds(lint(design)), unknowns: unknownsOf(design) }
}

/** The agents a design starts, as a count: `agents = 18` with every count known, `agents ≥ 12` where the number is only the fewest. */
export function agentsCount(agents: number, unknowns: Unknowns): string {
  return `agents ${unknowns.fanouts + unknowns.loops + unknowns.subworkflows > 0 ? '≥' : '='} ${agents}`
}

/**
 * The agents a design starts, as far as the drawing says. Every count known: `agents = 12`. Otherwise the
 * floor is marked as one and the reason follows: `agents ≥ 12 (more: 2 blocks fan out over an unknown number)`.
 */
export function agentsText(agents: number, unknowns: Unknowns): string {
  const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`
  const why = [
    unknowns.fanouts > 0 ? `${plural(unknowns.fanouts, 'block fans', 'blocks fan')} out over an unknown number` : '',
    unknowns.loops > 0 ? `${plural(unknowns.loops, 'loop repeats', 'loops repeat')}` : '',
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
  if (rule === 'agent-no-brief') return ['notes', 'prompt']
  if (rule === 'loop-unbounded' || rule === 'loop-no-decider') return ['until']
  if (rule === 'code-input-no-schema') return ['schema']
  if (rule === 'no-votes') return ['votes']
  if (rule === 'arm-no-when') return ['when']
  return []
}

/** The blocks that carry a lint, each once, in the order the lints were raised. */
export function lintIds(lints: readonly Lint[]): string[] {
  return [...new Set(lints.map(one => one.nodeId))]
}

/** How many block ids a preflight line names before it says `…`. */
export const LINT_IDS_MAX = 6

/**
 * `agents = 14 · problems in n3, n5`, or `agents ≥ 12 (more: …)` where a count is not stated; the
 * blocks that have a problem are named, and nothing is said of problems where there are none. It informs; nothing is blocked.
 */
export function preflightLine(design: Design): string {
  const { agents, lintIds: ids, unknowns } = preflight(design)
  const named = `${ids.slice(0, LINT_IDS_MAX).join(', ')}${ids.length > LINT_IDS_MAX ? ', …' : ''}`
  return [agentsText(agents, unknowns), ...(ids.length === 0 ? [] : [`problems in ${named}`])].join(' · ')
}
