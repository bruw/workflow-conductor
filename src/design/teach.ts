// Teaching content for every node type, and the palette the add list
// searches. Facts follow the Workflow script reference. Pure TypeScript.

import { EFFORTS } from './model'
import type { Knobs, NodeType } from './model'

export type Teach = {
  /** One character, for the plain list drawn where a surface has no `Client`. */
  glyph: string
  /** The type's one name, everywhere: its id. */
  name: string
  /** One line, at most HINT_MAX characters, in plain words: what the block does. */
  hint: string
  /** One line, at most HINT_MAX characters: the situation that calls for it. Shown as `use when: …`. */
  when: string
  /** Three to six short lines: what it is, when to use it, cost or gotcha. */
  card: string[]
}

/** The add list's two groups: the blocks that do work themselves, and the ones that hold blocks. */
export type PaletteGroup = 'work' | 'holds'

export type PaletteEntry = { type: NodeType; group: PaletteGroup; keywords: string[] }

/** Each group's heading in the add list, in the order the groups are listed. */
export const PALETTE_GROUPS: readonly { group: PaletteGroup; heading: string }[] = [
  { group: 'work', heading: 'Blocks that do work' },
  { group: 'holds', heading: 'Blocks that hold blocks' },
]

export const HINT_MAX = 70

export const TEACH: Record<NodeType, Teach> = {
  agent: {
    glyph: '●',
    name: 'agent',
    hint: 'One Claude subagent does one task and returns its answer',
    when: 'a step needs reading or judgment: search, review, write, decide',
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
    hint: 'Steps in a row; each item moves on alone, not waiting for the others',
    when: 'each item takes several steps and no step needs all items at once',
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
    hint: 'Runs its blocks at the same time and waits for all results',
    when: 'the next step needs every result together: merge, compare, pick',
    card: [
      'Runs tasks concurrently and waits for all of them before the next step starts.',
      'Use only when the next step needs all results together: dedup or merge, compare, exit early on zero.',
      'Cost: fast tasks sit idle until the slowest one ends.',
      'A failed task becomes null in the results; the call itself never fails.',
      'About 16 agents run at once, so with a large fan-out the rest queue and the wait is long.',
    ],
  },
  loop: {
    glyph: '↻',
    name: 'loop',
    hint: 'Repeats its blocks until a count, a condition or the budget is reached',
    when: 'you cannot tell up front how many rounds it takes; always set until',
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
    hint: 'If/else on an earlier result: one arm runs; code decides',
    when: 'a result decides what runs next, e.g. nothing found: skip the checks',
    card: [
      'Control flow in the script: which arm runs depends on an earlier result. Plain code decides, not a model.',
      'Each block directly inside it is one arm, and exactly one arm runs. An arm of several steps is a pipeline.',
      'Every arm says its condition in `when` ("no findings"); the last arm may leave it empty: that one is the else.',
      'Typical use: zero findings, so skip verification entirely.',
      'The deciding result should come from an agent with a schema, so the test is exact.',
      'Costs no tokens.',
    ],
  },
  subworkflow: {
    glyph: '▸',
    name: 'subworkflow',
    hint: 'Runs a saved workflow as one step; one level deep only',
    when: 'a saved workflow already does this part',
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
    hint: 'Plain JS between agents: dedup, filter, group, reduce. No tokens',
    when: 'the step is exact and mechanical: never spend an agent on it',
    card: [
      'Deterministic JavaScript in the script: dedup, filter, flatten, count, vote tally.',
      'Grouping results (by file, by kind) and reducing many to one (merge, sum, pick the top) are code too.',
      'Use it for anything exact. Do not spend an agent on what a few lines can do.',
      'Agents feeding it need a schema, so the code receives objects and not prose.',
      'A per-item transform belongs inside a pipeline stage: it has no need to wait for the other items.',
      'No file access, no clock and no randomness inside a script.',
    ],
  },
  verify: {
    glyph: '◇',
    name: 'verify',
    hint: 'Independent checkers try to disprove each result; survivors stay',
    when: 'a wrong result costs more than checking it: after any finder',
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
    name: 'judge-panel',
    hint: 'Several attempts at one task; judges score them, the best one wins',
    when: 'many answers are possible and a first try is rarely the best',
    card: [
      'Generate several attempts from different angles: MVP-first, risk-first, user-first.',
      'Parallel judges score them; synthesize from the winner and graft in the best of the rest.',
      'Use when the solution space is wide. Beats iterating on a single attempt.',
      'Waiting for all results is right here: the judges need every attempt at once.',
      'Cost: attempts + judges + one synthesis.',
    ],
  },
  'loop-until-dry': {
    glyph: '∞',
    name: 'loop-until-dry',
    hint: 'Keeps searching until some rounds in a row find nothing new',
    when: 'you do not know how many there are to find: bugs, edge cases',
    card: [
      'Repeats a round of finders until K consecutive rounds return nothing new.',
      'Use for discovery of unknown size: bugs, issues, edge cases. Fixed counts miss the tail.',
      'Dedup against everything seen, not only what was confirmed, or it never converges.',
      'Cost is open-ended: set until (say 2 dry rounds) and consider a budget guard.',
    ],
  },
  sweep: {
    glyph: '◎',
    name: 'sweep',
    hint: 'Several searchers at once, each looking a different way',
    when: 'one way of searching would miss things',
    card: [
      'Parallel agents that each search differently: by container, content, entity or time.',
      'Use when one search angle will not find everything.',
      'Each searcher is blind to the others, so results overlap: dedup in code afterwards.',
      'Cost: one agent per angle.',
    ],
  },
  critic: {
    glyph: '◐',
    name: 'critic',
    hint: 'One agent at the end asks what is missing; gaps become more work',
    when: 'before the final write-up of research, review or audit work',
    card: [
      'One agent at the end that asks what is missing.',
      'It looks for a search angle not run, a claim unverified, a source unread.',
      'Use before synthesis on research, review and audit work.',
      'What it finds becomes the next round of work. Give it a schema so the gaps can be acted on.',
    ],
  },
  args: {
    glyph: '⇢',
    name: 'args',
    hint: 'What the workflow is run on: its input, named once, up front',
    when: 'the workflow takes input; left empty, it takes none',
    card: [
      'Declares the input the script reads from `args`: say in notes what it is, and its shape in schema.',
      'Every design has one, always its first block: it is not added, moved or deleted.',
      'Left empty, the workflow takes no input.',
      'Later blocks draw on it: a fan-out over "the files in args", a prompt that quotes the question.',
      'The values come from the request the workflow is run with.',
      'Spawns no agent and costs no tokens.',
    ],
  },
  phase: {
    glyph: '▭',
    name: 'phase',
    hint: 'A named group around blocks: it only frames them, nothing more',
    when: 'a long design reads better in named parts: gather, check, write up',
    card: [
      'A frame with a title and nothing else: no knobs, no fan-out, no condition.',
      'Its blocks run one after the other where the phase stands, exactly as if it were not there.',
      'Holds any block. At the top level its title is also the name of that part of the run.',
      'For steps that each item takes on its own, use a pipeline: a phase adds no behaviour.',
      'Spawns no agent and costs no tokens.',
    ],
  },
}

/** `use when: a step needs reading or judgment…`: the line under a type's hint, in the detail pane and the add list. */
export function useWhen(type: NodeType): string {
  return `use when: ${TEACH[type].when}`
}

/** What each knob says, in a phrase: the one place the knobs are explained in words (Claude reads it; see chat.ts). */
export const KNOB_HELP: Record<keyof Knobs, string> = {
  prompt: 'intent of the agent prompt, not its final wording',
  schema: 'the output, in words or as JSON Schema text',
  model: 'haiku, sonnet or opus; unset inherits the session',
  effort: `${EFFORTS.join(', ')}; unset inherits`,
  isolation: '"worktree", only for agents that edit files in parallel',
  agentType: 'a subagent type to run as',
  fanout: 'the items it runs once per, with a count when known: "changed files", "×4 dimensions" (no leading "each")',
  votes: 'a whole number, for verify and judge-panel',
  until: 'when a loop stops: "2 dry rounds", "budget < 50k"',
  when: 'on a block directly in a branch: the condition that picks this arm, "no findings"; the last arm with none is the else',
}

/**
 * Which knobs make sense on which type: the one place that says so. The
 * detail pane offers a field for each one typed as text, the card a chip for
 * model, effort and votes; a text knob a block carries anyway (set from chat
 * or by hand in the file) is offered after them. `isolation` has no control:
 * Claude sets it, and the detail pane only says where it is set.
 *
 * Reasoning: a knob the script passes to `agent()` (prompt, model, effort,
 * agentType, isolation) belongs to the types that spawn agents; `votes` to the
 * two voting patterns; `until` to the loops; `fanout` to whatever can run once
 * per item; `schema` to anything that hands a result on.
 */
export const KNOBS_BY_TYPE: Record<NodeType, readonly (keyof Knobs)[]> = {
  agent: ['prompt', 'fanout', 'schema', 'agentType', 'model', 'effort', 'isolation'],
  verify: ['prompt', 'fanout', 'schema', 'agentType', 'model', 'effort', 'votes'],
  'judge-panel': ['prompt', 'fanout', 'schema', 'model', 'effort', 'votes'],
  critic: ['prompt', 'schema', 'agentType', 'model', 'effort'],
  pipeline: ['fanout', 'schema'],
  parallel: ['fanout', 'schema'],
  sweep: ['fanout', 'schema', 'model', 'effort'],
  loop: ['until', 'schema'],
  'loop-until-dry': ['until', 'fanout', 'schema', 'model', 'effort'],
  branch: ['schema'],
  code: ['schema'],
  subworkflow: ['prompt', 'schema'],
  args: ['schema'],
  phase: [],
}

/** Whether the detail pane offers a block's notes: a phase is its title and no more, so only notes it already carries are shown. */
export function hasNotes(node: { type: NodeType; notes?: string }): boolean {
  return node.type !== 'phase' || (node.notes ?? '').trim() !== ''
}

/**
 * The knobs of a block: its type's, then any other it has set.
 * `when` belongs to no type: it is offered (after the prompt) to a block that stands
 * directly in a `branch`, which `parentType` says.
 */
export function knobsOf(node: { type: NodeType; knobs?: Knobs }, parentType?: NodeType): (keyof Knobs)[] {
  const own = KNOBS_BY_TYPE[node.type]
  const listed: readonly (keyof Knobs)[] = parentType !== 'branch' ? own : own[0] === 'prompt' ? ['prompt', 'when', ...own.slice(1)] : ['when', ...own]
  const extra = (Object.keys(node.knobs ?? {}) as (keyof Knobs)[]).filter(key => !listed.includes(key) && node.knobs?.[key] !== undefined)
  return [...listed, ...extra]
}

/**
 * How a free-text field is named beside the field, so each reads with no
 * context. `notes` and `prompt` are both prose: notes say what the block does,
 * for whoever reads the design; the prompt is what the agent is to be told.
 */
export const FIELD_LABEL = {
  title: 'title',
  notes: 'notes (what it does)',
  prompt: 'prompt (tell the agent)',
  fanout: 'fanout (once per)',
  until: 'until (stop when)',
  when: 'when (this arm runs if)',
  schema: 'schema (out)',
  agentType: 'agentType',
} as const

export const FIELD_PLACEHOLDER = {
  notes: 'for whoever reads the design: what this block does and why',
  prompt: 'the intent of its prompt; Claude writes the wording',
  fanout: 'e.g. changed files, ×4 dimensions',
  until: 'e.g. 2 dry rounds, 10 findings, budget < 50k',
  when: 'e.g. no findings; leave the last arm empty for the else',
  schema: 'e.g. { findings: [{ file, claim }] }, or in words',
  agentType: 'the default subagent; name another to change it, e.g. Explore',
} as const

/** The add list's order: the blocks that do work, then the ones that hold blocks. `args` is not in it: every design has that block, and no second. */
export const PALETTE: PaletteEntry[] = [
  { type: 'agent', group: 'work', keywords: ['subagent', 'prompt', 'task', 'step', 'schema', 'call'] },
  { type: 'code', group: 'work', keywords: ['js', 'javascript', 'transform', 'dedup', 'filter', 'flatten', 'script', 'group', 'reduce', 'merge', 'aggregate'] },
  { type: 'verify', group: 'work', keywords: ['adversarial', 'disprove', 'checkers', 'refute', 'skeptic', 'votes', 'check', 'confirm'] },
  { type: 'critic', group: 'work', keywords: ['completeness', 'missing', 'gaps', 'review', 'what else'] },
  { type: 'judge-panel', group: 'work', keywords: ['judge panel', 'judges', 'score', 'attempts', 'winner', 'tournament', 'rank'] },
  { type: 'subworkflow', group: 'work', keywords: ['workflow', 'nested', 'child', 'reuse', 'saved'] },
  { type: 'pipeline', group: 'holds', keywords: ['stages', 'stream', 'chain', 'map', 'per item', 'no barrier', 'default'] },
  { type: 'parallel', group: 'holds', keywords: ['barrier', 'concurrent', 'same time', 'together', 'fan-out', 'fanout', 'wait', 'join'] },
  { type: 'sweep', group: 'holds', keywords: ['multi-modal', 'search', 'angles', 'modes', 'broad', 'coverage'] },
  { type: 'branch', group: 'holds', keywords: ['if', 'else', 'condition', 'switch', 'early exit', 'skip'] },
  { type: 'loop', group: 'holds', keywords: ['while', 'repeat', 'until', 'budget', 'iterate', 'count'] },
  { type: 'loop-until-dry', group: 'holds', keywords: ['loop until dry', 'until dry', 'dry', 'exhaustive', 'discovery', 'converge', 'rounds', 'tail'] },
  { type: 'phase', group: 'holds', keywords: ['group', 'wrapper', 'frame', 'section', 'stage', 'part', 'label'] },
]

/** The group a type is listed in. */
export function groupOf(type: NodeType): PaletteGroup {
  return PALETTE.find(entry => entry.type === type)?.group ?? 'work'
}

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
