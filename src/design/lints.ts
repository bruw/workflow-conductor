// Advisory lints over a Design. A design is a loose spec, so every rule is a
// structural or keyword heuristic, stated above the rule. Each one prefers
// missing a case to raising a false alarm. Lints never block anything.

import { canHoldChildren, flatten, walk } from './model'
import type { Design, DesignNode } from './model'

export type LintRule = 'barrier-not-needed' | 'worktree-read-only' | 'loop-unbounded' | 'code-input-no-schema' | 'fanout-over-cap'

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
    if (node.type === 'parallel' && next && next.type !== 'code' && next.type !== 'judge-panel' && !CROSS_ITEM.test(words(next))) {
      lints.push({
        nodeId: node.id,
        rule: 'barrier-not-needed',
        message: `parallel waits for every item, but "${next.title}" does not seem to need them together: a pipeline lets each item move on as it finishes`,
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
        message: 'worktree isolation costs setup time and disk per agent and only helps agents that edit files in parallel; this one looks read-only',
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
          message: `fan-out of ${largest} is above the ~${CONCURRENCY_CAP} agents that run at once: the rest queue, and the barrier holds everything until the last one ends`,
        })
      }
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
  if (node.type === 'code' || node.type === 'subworkflow') return 0
  if (node.type === 'verify' || node.type === 'judge-panel') return times * (node.knobs?.votes ?? 1)
  return times
}

export type Preflight = { blocks: number; agents: number; lints: number }

/** What a hand-off is about to start: how many blocks, the fewest agents they imply, and how many lints stand. */
export function preflight(design: Design): Preflight {
  return { blocks: flatten(design).length, agents: design.nodes.reduce((sum, node) => sum + leastAgents(node), 0), lints: lint(design).length }
}

/**
 * `6 blocks · at least 14 agents · 1 lint`. It informs; nothing is blocked.
 * `blocks: false` leaves the first part out, where the count is already said.
 */
export function preflightLine(design: Design, options: { blocks?: boolean } = {}): string {
  const { blocks, agents, lints } = preflight(design)
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
  const parts = [`at least ${plural(agents, 'agent')}`, lints === 0 ? 'no lints' : plural(lints, 'lint')]
  return (options.blocks === false ? parts : [plural(blocks, 'block'), ...parts]).join(' · ')
}
