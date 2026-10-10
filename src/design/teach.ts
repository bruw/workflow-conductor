// Teaching content for every node type, and the palette the add-picker
// searches. Facts follow the Workflow script reference. Pure TypeScript.

import { EFFORTS } from './model'
import type { Knobs, NodeType } from './model'

export type Teach = {
  /** One character for the rail. */
  glyph: string
  name: string
  /** One line, at most HINT_MAX characters. */
  hint: string
  /** Three to six short lines: what it is, when to use it, cost or gotcha. */
  card: string[]
}

export type Tier = 'primitive' | 'pattern'

export type PaletteEntry = { type: NodeType; tier: Tier; keywords: string[] }

export const HINT_MAX = 70

export const TEACH: Record<NodeType, Teach> = {
  agent: {
    glyph: '●',
    name: 'agent',
    hint: 'One subagent call; returns text, or an object when schema is set',
    card: [
      'One subagent with its own context. Its final text is the return value.',
      'Set a schema to force structured output: you get a validated object back, no parsing.',
      'Leave model and effort unset to inherit the session; low effort suits mechanical stages.',
      'Worktree isolation is expensive: only for agents that edit files in parallel.',
      'Returns null if the agent is skipped or dies, so filter results before use.',
    ],
  },
  pipeline: {
    glyph: '◆',
    name: 'pipeline',
    hint: 'Default for multi-stage work: no barrier between stages',
    card: [
      'Each item runs through all stages on its own. Item A can be in stage 3 while B is in stage 1.',
      'The default for multi-stage work. When in doubt, use a pipeline.',
      'Wall-clock is the slowest single item chain, not the sum of the slowest stage each time.',
      'A stage that fails drops that item to null and skips its remaining stages.',
      'About 16 agents run at once; the rest queue and still complete.',
    ],
  },
  parallel: {
    glyph: '≡',
    name: 'parallel',
    hint: 'Barrier: runs tasks together and waits for every result',
    card: [
      'Runs tasks concurrently and waits for all of them before the next step starts.',
      'Use only when the next step needs all results together: dedup or merge, compare, exit early on zero.',
      'Cost: fast tasks sit idle until the slowest one ends.',
      'A failed task becomes null in the results; the call itself never fails.',
      'About 16 agents run at once, so a large fan-out queues behind the barrier.',
    ],
  },
  loop: {
    glyph: '↻',
    name: 'loop',
    hint: 'Repeat a step until a count, a condition or the budget is reached',
    card: [
      'A plain while loop around one or more steps.',
      'Use to accumulate toward a target (10 findings) or to scale depth to a token budget.',
      'Always state until. A budget guard must also check that a budget was set at all.',
      'An unbounded loop runs to the cap of 1000 agents per run.',
    ],
  },
  branch: {
    glyph: 'ψ',
    name: 'branch',
    hint: 'Plain if/else on an earlier result; decided in code, not by a model',
    card: [
      'Control flow in the script: which path runs depends on an earlier result.',
      'Typical use: zero findings, so skip verification entirely.',
      'The deciding result should come from an agent with a schema, so the test is exact.',
      'Costs no tokens. Say in notes which condition picks which path.',
    ],
  },
  subworkflow: {
    glyph: '▸',
    name: 'subworkflow',
    hint: 'Run a saved workflow inline as one step; nests one level only',
    card: [
      'Runs another workflow as a sub-step and returns whatever it returns.',
      'Use to reuse a saved workflow, passing it args.',
      'The child shares this run\'s concurrency cap, agent count and token budget.',
      'One level only: a child workflow cannot start another one.',
    ],
  },
  code: {
    glyph: 'λ',
    name: 'code',
    hint: 'Plain JS between agents: dedup, filter, map. Costs no tokens',
    card: [
      'Deterministic JavaScript in the script: dedup, filter, flatten, count, vote tally.',
      'Use it for anything exact. Do not spend an agent on what a few lines can do.',
      'Agents feeding it need a schema, so the code receives objects and not prose.',
      'A per-item transform belongs inside a pipeline stage; it does not need a barrier.',
      'No file access, no clock and no randomness inside a script.',
    ],
  },
  verify: {
    glyph: '◇',
    name: 'adversarial verify',
    hint: 'N independent skeptics try to refute each finding',
    card: [
      'Each voter is prompted to refute the claim and to say refuted when unsure.',
      'A finding survives only if a majority fail to refute it.',
      'Use after any finder: it stops plausible but wrong findings from surviving.',
      'Give voters distinct lenses (correctness, security, repro) when a claim can fail several ways.',
      'Cost: votes × findings agents. 1 vote for a quick check, 3 to 5 for a thorough one.',
    ],
  },
  'judge-panel': {
    glyph: '▽',
    name: 'judge panel',
    hint: 'N independent attempts, scored by judges, built from the winner',
    card: [
      'Generate several attempts from different angles: MVP-first, risk-first, user-first.',
      'Parallel judges score them; synthesize from the winner and graft in the best of the rest.',
      'Use when the solution space is wide. Beats iterating on a single attempt.',
      'A barrier is right here: the judges need every attempt at once.',
      'Cost: attempts + judges + one synthesis.',
    ],
  },
  'loop-until-dry': {
    glyph: '∞',
    name: 'loop until dry',
    hint: 'Keep finding until K rounds in a row turn up nothing new',
    card: [
      'Repeats a round of finders until K consecutive rounds return nothing new.',
      'Use for discovery of unknown size: bugs, issues, edge cases. Fixed counts miss the tail.',
      'Dedup against everything seen, not only what was confirmed, or it never converges.',
      'Cost is open-ended: set until (say 2 dry rounds) and consider a budget guard.',
    ],
  },
  sweep: {
    glyph: '◎',
    name: 'multi-modal sweep',
    hint: 'Parallel searchers, each looking a different way',
    card: [
      'Parallel agents that each search differently: by container, content, entity or time.',
      'Use when one search angle will not find everything.',
      'Each searcher is blind to the others, so results overlap: dedup in code afterwards.',
      'Cost: one agent per angle.',
    ],
  },
  critic: {
    glyph: '◐',
    name: 'completeness critic',
    hint: 'A final agent asks what is missing; gaps feed the next round',
    card: [
      'One agent at the end that asks what is missing.',
      'It looks for a search angle not run, a claim unverified, a source unread.',
      'Use before synthesis on research, review and audit work.',
      'What it finds becomes the next round of work. Give it a schema so the gaps can be acted on.',
    ],
  },
}

/** What each knob says, in a phrase: the one place the knobs are explained in words (Claude reads it; see chat.ts). */
export const KNOB_HELP: Record<keyof Knobs, string> = {
  prompt: 'intent of the agent prompt, not its final wording',
  schema: 'the output, in words or as JSON Schema text',
  model: 'haiku, sonnet or opus; unset inherits the session',
  effort: `${EFFORTS.join(', ')}; unset inherits`,
  isolation: '"worktree", only for agents that edit files in parallel',
  agentType: 'a subagent type to run as',
  fanout: 'what it runs once per, with a count when known: "changed files", "×4 dimensions"',
  votes: 'a whole number, for verify and judge-panel',
  until: 'when a loop stops: "2 dry rounds", "budget < 50k"',
}

/** Picker order: primitives first, then patterns. */
export const PALETTE: PaletteEntry[] = [
  { type: 'agent', tier: 'primitive', keywords: ['subagent', 'prompt', 'task', 'step', 'schema', 'call'] },
  { type: 'pipeline', tier: 'primitive', keywords: ['stages', 'stream', 'chain', 'map', 'per item', 'no barrier', 'default'] },
  { type: 'parallel', tier: 'primitive', keywords: ['barrier', 'concurrent', 'fan-out', 'fanout', 'wait', 'join'] },
  { type: 'loop', tier: 'primitive', keywords: ['while', 'repeat', 'until', 'budget', 'iterate', 'count'] },
  { type: 'branch', tier: 'primitive', keywords: ['if', 'else', 'condition', 'switch', 'early exit', 'skip'] },
  { type: 'subworkflow', tier: 'primitive', keywords: ['workflow', 'nested', 'child', 'reuse', 'saved'] },
  { type: 'code', tier: 'primitive', keywords: ['js', 'javascript', 'transform', 'dedup', 'filter', 'flatten', 'script'] },
  { type: 'verify', tier: 'pattern', keywords: ['adversarial', 'refute', 'skeptic', 'votes', 'check', 'confirm'] },
  { type: 'judge-panel', tier: 'pattern', keywords: ['judges', 'score', 'attempts', 'winner', 'tournament', 'rank'] },
  { type: 'loop-until-dry', tier: 'pattern', keywords: ['dry', 'exhaustive', 'discovery', 'converge', 'rounds', 'tail'] },
  { type: 'sweep', tier: 'pattern', keywords: ['multi-modal', 'search', 'angles', 'modes', 'broad', 'coverage'] },
  { type: 'critic', tier: 'pattern', keywords: ['completeness', 'missing', 'gaps', 'review', 'what else'] },
]

// How well `query` matches `text`, 0 for no match. An exact match beats a
// prefix, a prefix beats a word start, that beats a substring, and a plain
// in-order subsequence scores lowest, less the further its letters spread.
function score(query: string, text: string): number {
  if (text === query) return 100
  if (text.startsWith(query)) return 80
  const at = text.indexOf(query)
  if (at > 0) return /[\s-]/.test(text.charAt(at - 1)) ? 70 : 60

  let from = 0
  let first = -1
  let last = -1
  for (const char of query) {
    const found = text.indexOf(char, from)
    if (found < 0) return 0
    if (first < 0) first = found
    last = found
    from = found + 1
  }
  return Math.max(1, 30 - (last - first + 1 - query.length))
}

/**
 * Types matching `query`, best first. A match is a subsequence of the type id,
 * its name or a keyword. An empty query lists the whole palette in order.
 */
export function fuzzy(query: string): NodeType[] {
  const wanted = query.trim().toLowerCase()
  if (wanted === '') return PALETTE.map(entry => entry.type)

  const ranked = PALETTE.map((entry, order) => {
    const names = [entry.type, TEACH[entry.type].name.toLowerCase()]
    const byName = Math.max(...names.map(text => score(wanted, text)))
    const byKeyword = Math.max(0, ...entry.keywords.map(text => score(wanted, text.toLowerCase())))
    // A name match outranks an equally good keyword match.
    return { type: entry.type, order, score: Math.max(byName > 0 ? byName + 5 : 0, byKeyword) }
  })
  return ranked
    .filter(one => one.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(one => one.type)
}
