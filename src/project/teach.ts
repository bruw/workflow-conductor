// Teaching content for every block type and every kind of one, what a kind fills in, and the palette the add
// list searches. Facts follow the Workflow script reference.

import { EFFORTS, KINDS, kindOf, kindsOf, plainKind } from './model'
import type { Kind, Knobs, NodeType } from './model'

export type Teach = {
  /** For the plain list drawn where a surface has no `Client`. */
  glyph: string
  name: string
  /** One line, at most HINT_MAX characters. */
  hint: string
  /** One line, at most WHEN_MAX characters. Shown as `use when: …`. */
  when: string
  /** Three to six short lines: what it is, when to use it, cost or gotcha. */
  card: string[]
}

export type PaletteGroup = 'work' | 'holds'

export type PaletteEntry = { type: NodeType; group: PaletteGroup }

export const PALETTE_GROUPS: readonly { group: PaletteGroup; heading: string }[] = [
  { group: 'work', heading: 'Blocks that do work' },
  { group: 'holds', heading: 'Blocks that hold blocks' },
]

export const HINT_MAX = 25
const WHEN_MAX = 70

export const TEACH: Record<NodeType, Teach> = {
  agent: {
    glyph: '●',
    name: 'agent',
    hint: 'Performs a task',
    when: 'a step needs reading or judgment: search, review, write, decide',
    card: [
      'One subagent with its own context. Its final text is the return value.',
      'Its kind says its job: scout, check, verify, judge, critic, merge, classify.',
      'Set its output to a shape to force structured output: you get a validated object back, no parsing.',
      'Leave model and effort unset to inherit the session; low effort suits mechanical stages.',
      'Worktree isolation is expensive: only for agents that edit files in parallel.',
      'Returns null if the agent is skipped or dies, so filter results before use.',
    ],
  },
  pipeline: {
    glyph: '◆',
    name: 'pipeline',
    hint: 'Per-item chain of steps',
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
    hint: 'Concurrent; awaits all',
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
    hint: 'Repeat until stop rule',
    when: 'you cannot tell up front how many rounds it takes; say when it stops',
    card: [
      'A plain while loop around one or more steps.',
      'Use to accumulate toward a target (10 findings) or to scale depth to a token budget.',
      'Always say its stop condition; its kind names the usual ones (count, pass, dry, converged, target, budget).',
      'An unbounded loop runs to the cap of 1000 agents per run.',
    ],
  },
  branch: {
    glyph: 'ψ',
    name: 'branch',
    hint: 'If/else on a result',
    when: 'a result decides what runs next, e.g. nothing found: skip the checks',
    card: [
      'Control flow in the script: which arm runs depends on an earlier result. Plain code decides, not a model.',
      'Each block directly inside it is one arm, and exactly one arm runs. An arm of several steps is a pipeline.',
      'Every arm says its condition ("no findings"); the last arm may leave it empty: that one is the else.',
      'Typical use: zero findings, so skip verification entirely.',
      'The deciding result should come from an agent with an output shape, so the test is exact.',
      'Costs no tokens.',
    ],
  },
  subworkflow: {
    glyph: '▸',
    name: 'subworkflow',
    hint: 'Run a saved workflow',
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
    hint: 'Plain JS, no tokens',
    when: 'the step is exact and mechanical: never spend an agent on it',
    card: [
      'Deterministic JavaScript in the script: dedup, filter, flatten, count, vote tally.',
      'Grouping results (by file, by kind) and reducing many to one (merge, sum, pick the top) are code too.',
      'Use it for anything exact. Do not spend an agent on what a few lines can do.',
      'Agents feeding it need an output shape, so the code receives objects and not prose.',
      'A per-item transform belongs inside a pipeline stage: it has no need to wait for the other items.',
      'No file access, no clock and no randomness inside a script.',
    ],
  },
  start: {
    glyph: '⇢',
    name: 'start',
    hint: 'Entry: goal and args',
    when: 'always: every project has one, first',
    card: [
      'Says the goal of the workflow, in a sentence: Claude reads it when it writes the script, and reviews the project against it.',
      'Says the args, the input the script reads from `args`: what it is, or its shape. Left empty, the workflow takes no input.',
      'Every project has one, always its first block: it is not added, moved or deleted.',
      'Later blocks draw on the args: a fan-out over "the files in args", an agent told the question.',
      'The values come from the request the workflow is run with.',
      'Spawns no agent and costs no tokens.',
    ],
  },
}

export type BlockRef = { type: NodeType; kind?: Kind }

export type TextField = 'logic' | 'goal' | 'args' | 'condition' | 'oncePer' | 'stopCondition' | 'output'

export type Starter = { type: NodeType; kind?: Kind; name: string; logic?: string; knobs?: Knobs }

export type KindTeach = {
  hint: string
  when: string
  card: string[]
  /** One line, the Workflow reference's pattern name where it has one and what it leaves out: what the hand-off tells Claude the kind means (a plain kind's is not sent). */
  script: string
  /** The knobs a new block of this kind is given. */
  fill?: Knobs
  /** The logic a new block of this kind is given: a voting kind says its votes in it. */
  logic?: string
  /** What its empty fields are for, shown in the field. `condition` is said on a branch and shown on its arms. */
  hints?: Partial<Record<TextField, string>>
  /** The blocks a new, empty container of this kind starts with. */
  starter?: readonly Starter[]
}

/** The plain kind of a type says what the type says. */
function plain(type: NodeType, script: string, hints?: KindTeach['hints']): KindTeach {
  return { hint: TEACH[type].hint, when: TEACH[type].when, card: TEACH[type].card, script, ...(hints ? { hints } : {}) }
}

/** A kind adds no field and takes none away: a block's fields are its type's (`KNOBS_BY_TYPE`). */
export const KIND_TEACH: Record<Kind, KindTeach> = {
  // agent: what is its job?
  task: plain('agent', 'one agent() call'),
  scout: {
    hint: 'Search and collect',
    when: 'the work-list is not known up front: files, sites, dimensions',
    card: [
      'One cheap agent that finds what there is to do and returns it as a list.',
      'A pipeline or a parallel after it fans out over that list: name it in their "once per".',
      'Its output is a shape, so the list arrives as objects and not as prose.',
      'Low effort suits it: the work is mechanical.',
    ],
    script: 'one agent() whose schema is the work-list; the fan-out after it maps over that list',
    fill: { output: '{ items: [{ id, what }] }', effort: 'low' },
    hints: { logic: 'what to list, e.g. every site that needs the change' },
  },
  check: {
    hint: 'Model checks pass/fail',
    when: 'the result can be checked exactly, and a loop or a branch reads it',
    card: [
      'One agent that runs an objective check and reports ok or the failures: tests, typecheck, lint, a diff.',
      'It does not judge quality: for a claim that needs doubting use verify, for a choice use judge.',
      'A loop of kind pass ends each round with it; a branch can skip work on its verdict.',
      'Its output is a shape, so the code that reads `ok` gets a boolean.',
    ],
    script: 'one agent() returning { ok, failures }; the code after it tests `ok`',
    fill: { output: '{ ok: boolean, failures: [] }' },
    hints: { logic: 'what must hold, e.g. typecheck and tests pass' },
  },
  verify: {
    hint: 'Voters try to refute it',
    when: 'a wrong result costs more than checking it: after any finder',
    card: [
      'Each voter is prompted to refute the claim and to say refuted when unsure.',
      'A finding survives only if a majority fail to refute it.',
      'Use after any finder: it stops plausible but wrong findings from surviving.',
      'Give voters distinct lenses (correctness, security, repro) when a claim can fail several ways.',
      'Cost: votes × findings agents. 1 vote for a quick check, 3 to 5 for a thorough one: say in its logic how many (`3 votes`) and what to refute it against.',
    ],
    script: 'Adversarial verify, as many voters as its logic says (Perspective-diverse verify where it gives them lenses)',
    fill: { output: '{ refuted: boolean, reason }' },
    logic: '3 votes: each voter tries to refute the result; it is kept when a majority fail to refute it',
    hints: { logic: 'its votes, and what to try to refute, e.g. 3 votes against the code' },
  },
  judge: {
    hint: 'Judges score, best wins',
    when: 'several attempts exist and one has to be picked',
    card: [
      'Parallel judges score every candidate against the same criteria; the highest total wins.',
      'Put the attempts before it (a parallel of kind attempts) and a merge after it.',
      'Waiting for all results is right here: the judges need every candidate at once.',
      'Cost: one agent per vote: say in its logic how many (`3 votes`) and the criteria to score on (correctness, simplicity, risk).',
    ],
    script: 'the scoring of a Judge panel: as many judges as its logic says, each scoring every candidate; sum the scores in code',
    fill: { output: '{ scores: [{ candidate, score, why }] }' },
    logic: '3 votes: each judge scores every candidate; the highest total wins',
    hints: { logic: 'its votes, and the criteria to score on, e.g. correctness, simplicity, risk' },
  },
  critic: {
    hint: 'Finds what is missing',
    when: 'before the final write-up of research, review or audit work',
    card: [
      'One agent at the end that asks what is missing.',
      'It looks for a search angle not run, a claim unverified, a source unread.',
      'Use before the merge on research, review and audit work.',
      'What it finds becomes the next round of work: its output is a shape, so the gaps can be acted on.',
    ],
    script: 'Completeness critic, its gaps in its output shape',
    fill: { output: '{ gaps: [{ what, how_to_fill }] }' },
    hints: { logic: 'what complete means here, e.g. every angle searched' },
  },
  merge: {
    hint: 'Many results into one',
    when: 'many results must become one: the write-up at the end',
    card: [
      'One agent that reads all the results at once and writes one thing from them: the reduce step.',
      'It needs every result together, so waiting for all of them before it is right.',
      'Say what to merge and what to drop: duplicates, the order, what was left out.',
      'Runs once, whatever the fan-out before it.',
    ],
    script: 'one agent() after a barrier, given every result (nulls filtered out), writing one answer',
    hints: { logic: 'what to write from all the results', output: 'free text: the answer itself; a shape only if a block reads it' },
  },
  classify: {
    hint: 'Labels input for routing',
    when: 'different inputs need different handling: triage, routing',
    card: [
      'One cheap agent that sorts its input into one of the labels you name.',
      'A branch of kind route after it picks the arm that carries the label.',
      'Its output is a shape, so the branch compares a value and not prose.',
      'Low effort suits it.',
    ],
    script: 'one agent() whose schema is one label out of a fixed list; a branch after it switches on the label',
    fill: { output: '{ label }', effort: 'low' },
    hints: { logic: 'the labels to choose from, e.g. bug, feature, question' },
  },

  // loop: when does it stop?
  custom: plain('loop', 'a while loop with the stop condition as written', { stopCondition: 'e.g. 3 rounds · the check passes · 2 dry rounds · budget < 50k' }),
  count: {
    hint: 'Fixed number of rounds',
    when: 'you know how many passes it takes: three rounds of refinement',
    card: ['A for loop: the same blocks, a set number of times.', 'Each round is given what the round before made.', 'Bounded by nature: the cost is the rounds times what a round costs.'],
    script: 'for (let round = 0; round < N; round++), each round given the result of the last',
    fill: { stopCondition: '3 rounds' },
  },
  pass: {
    hint: 'Repeat until check passes',
    when: 'the work can be checked exactly: fix, test, fix again',
    card: [
      'A round does the work and ends with a check; the loop stops when the check says ok.',
      'What the check found is handed to the next round, so each try starts from the failures.',
      'Say the most rounds it may take: a check that never passes runs to the cap of 1000 agents.',
      'The last block of a round needs an output shape the stop test can read ({ ok }).',
      'A reviewer in a round is told what earlier rounds raised and judges against fixed criteria, or the loop never converges.',
    ],
    script: 'rounds until the round\'s last block says `ok`, up to the rounds its stop condition says; the next round is given the check\'s failures, and a reviewer in it what earlier rounds raised',
    fill: { stopCondition: 'the check passes, at most 3 rounds' },
    starter: [
      { type: 'agent', name: 'attempt', logic: 'Does the work. From the second round on it is given what the check found.' },
      { type: 'agent', kind: 'check', name: 'check', logic: 'Says whether the attempt holds; its failures start the next round.' },
    ],
  },
  dry: {
    hint: 'Until nothing new found',
    when: 'you do not know how many there are to find: bugs, edge cases',
    card: [
      'Repeats a round of finders until K consecutive rounds return nothing new.',
      'Use for discovery of unknown size: bugs, issues, edge cases. Fixed counts miss the tail.',
      'Dedup against everything seen, not only what was confirmed, or it never converges.',
      'Cost is open-ended: say how many dry rounds end it, and consider a budget as well.',
    ],
    script: 'Loop-until-dry, K the dry rounds its stop condition says',
    fill: { stopCondition: '2 rounds in a row find nothing new' },
    starter: [
      { type: 'agent', name: 'find', logic: 'One round of finding. Told what was already found, so it looks elsewhere.', knobs: { output: '{ found: [{ id, what }] }' } },
      { type: 'code', name: 'dedup', logic: 'Drop what any earlier round found: only the new ones count. None new makes the round dry.' },
    ],
  },
  converged: {
    hint: 'Until results stabilize',
    when: 'each round refines the last: draft, critique, revise',
    card: [
      'Each round improves on the last result; the loop stops when a round leaves it as it was.',
      'Plain code compares the two results: give the last block an output shape it can compare.',
      'Say the most rounds it may take: a result that keeps changing never converges.',
    ],
    script: 'keep the last round\'s result and stop when the new one equals it (compared in code), up to the stated rounds',
    fill: { stopCondition: 'the result is the same as last round, at most 5 rounds' },
  },
  target: {
    hint: 'Until target reached',
    when: 'you need a set number of results: 10 findings, 5 candidates',
    card: ['Each round adds what it found to one list; the loop stops when the list is long enough.', 'Dedup each round against the list, or the same result is counted twice.', 'A target that cannot be met runs to the cap of 1000 agents: consider a budget as well.'],
    script: 'Loop-until-count, N from its stop condition; dedup each round against what is collected',
    fill: { stopCondition: '10 items collected' },
  },
  budget: {
    hint: 'While token budget lasts',
    when: 'depth should follow the budget the user gave ("+500k")',
    card: [
      'Runs rounds for as long as the turn\'s token budget has room for another.',
      'With no budget given there is nothing to run against: the loop then does a single round.',
      'The budget is shared with everything else in the turn.',
    ],
    script: 'Loop-until-budget, the floor from its stop condition; with no budget set, one round',
    fill: { stopCondition: 'budget below 50k tokens' },
  },

  // parallel: what differs between its arms?
  arms: plain('parallel', 'parallel() of the blocks inside, one thunk each', { oncePer: 'leave empty: the blocks inside run side by side' }),
  each: {
    hint: 'Once per item, await all',
    when: 'one job, many items, and the next step needs every result',
    card: [
      'What it holds runs once for each item, all at the same time; the next step starts when all are done.',
      'Say the items in "once per": the list a scout made, the changed files.',
      'When no step needs all results together, a pipeline does the same without the wait.',
    ],
    script: 'parallel(items.map(item => () => …)) over the items its once-per names, a barrier; a chain of stages per item is a pipeline()',
    hints: { oncePer: 'the items, e.g. changed files, ×4 dimensions' },
  },
  sweep: {
    hint: 'Parallel varied searches',
    when: 'one way of searching would miss things',
    card: [
      'Parallel agents that each search differently: by container, content, entity or time.',
      'Use when one search angle will not find everything.',
      'Each searcher is blind to the others, so results overlap: dedup in code afterwards.',
      'Cost: one agent per angle.',
    ],
    script: 'Multi-modal sweep, one searcher per angle its once-per names; dedup their results in code',
    fill: { oncePer: '4 search angles: by container, by content, by entity, by time' },
  },
  attempts: {
    hint: 'N independent tries',
    when: 'a first answer is rarely the best one: a judge picks after',
    card: [
      'The same task done several times at once, each try from a different angle and blind to the others.',
      'Put a judge after it to score the tries, and a merge after that to build on the winner.',
      'Beats iterating on a single try when many answers are possible.',
      'Cost: one agent per try.',
    ],
    script: 'the attempts of a Judge panel: one agent per angle its once-per names, each blind to the others',
    fill: { oncePer: '×3 angles: MVP-first, risk-first, user-first' },
  },

  // branch: how is its arm picked?
  'if-else': plain('branch', 'if / else if / else on an earlier result', { condition: 'e.g. no findings; leave the last arm empty for the else' }),
  guard: {
    hint: 'Run only if condition',
    when: 'a step is wasted on an empty result: nothing found, skip the checks',
    card: [
      'An if with no else: its one arm runs when its condition holds, and nothing runs when it does not.',
      'Typical use: zero findings, so skip verification entirely.',
      'The deciding result should come from a block with an output shape, so the test is exact.',
      'Costs no tokens.',
    ],
    script: 'if (condition) { … } with no else',
    hints: { condition: 'when it runs, e.g. any findings; otherwise nothing runs' },
  },
  route: {
    hint: 'Pick arm by label',
    when: 'a classifier sorted the input and each sort has its own steps',
    card: [
      'A switch: each arm carries one label, and the arm whose label was chosen runs.',
      'Put an agent of kind classify before it; the arms\' conditions are its labels.',
      'The last arm may leave its condition empty: it takes every other label.',
      'Costs no tokens.',
    ],
    script: 'switch on the label of the classify block before it; a last arm with no condition is the default',
    hints: { condition: 'the label that picks this arm, e.g. bug' },
  },
}

export function teachOf(block: BlockRef): Pick<KindTeach, 'hint' | 'when' | 'card'> {
  const kind = kindOf(block)
  return kind === undefined ? TEACH[block.type] : KIND_TEACH[kind]
}

/** The line under a block's hint, in the detail pane and the add list. */
export function useWhen(block: BlockRef): string {
  return `use when: ${teachOf(block).when}`
}

export function fillOf(block: BlockRef): Knobs {
  const kind = kindOf(block)
  return kind === undefined ? {} : (KIND_TEACH[kind].fill ?? {})
}

export function logicOf(block: BlockRef): string | undefined {
  const kind = kindOf(block)
  return kind === undefined ? undefined : KIND_TEACH[kind].logic
}

export function starterOf(block: BlockRef): readonly Starter[] {
  const kind = kindOf(block)
  return kind === undefined ? [] : (KIND_TEACH[kind].starter ?? [])
}

export function defaultName(block: BlockRef): string {
  return block.kind === undefined || block.kind === plainKind(block.type) ? block.type : block.kind
}

/** The one place the knobs are explained in words: Claude reads it (chat.ts). */
export const KNOB_HELP: Record<keyof Knobs, string> = {
  goal: 'on the start block only: the goal of the workflow, in a sentence',
  args: 'on the start block only: the input the script reads from `args`, in words or as a shape, "{ target? }: a branch, a pull request or a path"; unset, it takes none',
  output: 'the output, in words or as JSON Schema text',
  model: 'haiku, sonnet or opus; unset inherits the session',
  effort: `${EFFORTS.join(', ')}; unset inherits`,
  isolation: '"worktree", only for agents that edit files in parallel',
  agentType: 'a subagent type to run as',
  oncePer: 'on a pipeline or parallel: the items it runs once per, with a count when known: "changed files", "×4 dimensions" (no leading "each")',
  stopCondition: 'a loop\'s stop condition, in words: "2 dry rounds", "the check passes, at most 3 rounds"',
  condition: 'on a block directly in a branch: the condition that picks this arm, "no findings"; the last arm with none is the else',
}

/**
 * The same for every kind of the type. `isolation` and `agentType` have no control: Claude sets them, and the detail pane only says where one is set.
 * A container hands on what its last block makes, so it has no `output`; a branch's rule is on its arms (`condition`).
 */
export const KNOBS_BY_TYPE: Record<NodeType, readonly (keyof Knobs)[]> = {
  agent: ['output', 'model', 'effort', 'isolation', 'agentType'],
  code: ['output'],
  subworkflow: ['output'],
  start: ['goal', 'args'],
  pipeline: ['oncePer'],
  parallel: ['oncePer'],
  loop: ['stopCondition'],
  branch: [],
}

/** The kinds of agent whose name already says the task: they are not asked for a brief. */
export const SELF_BRIEFED: readonly Kind[] = ['verify', 'judge', 'critic']

/** By its type, whatever the block carries. */
export function offers(block: BlockRef, knob: keyof Knobs): boolean {
  return KNOBS_BY_TYPE[block.type].includes(knob)
}

/** The start block is its goal and args: only logic it already carries is shown. */
export function hasLogic(node: { type: NodeType; logic?: string }): boolean {
  return node.type !== 'start' || (node.logic ?? '').trim() !== ''
}

/** The start block is named for what it is. */
export function hasName(node: { type: NodeType }): boolean {
  return node.type !== 'start'
}

/** `condition` belongs to no type: it is offered, first, to a block that stands directly in a `branch`. */
export function knobsOf(node: BlockRef & { knobs?: Knobs }, parentType?: NodeType): (keyof Knobs)[] {
  const own = KNOBS_BY_TYPE[node.type]
  const listed: readonly (keyof Knobs)[] = parentType !== 'branch' ? own : ['condition', ...own]
  const extra = (Object.keys(node.knobs ?? {}) as (keyof Knobs)[]).filter(key => !listed.includes(key) && node.knobs?.[key] !== undefined)
  return [...listed, ...extra]
}

/** How a field is named in the pane and in every message. */
export const FIELD_LABEL = {
  name: 'name',
  logic: 'logic',
  goal: 'goal',
  args: 'args',
  oncePer: 'once per',
  stopCondition: 'stop condition',
  condition: 'condition',
  output: 'output',
} as const

export function fieldWord(field: string): string {
  return (FIELD_LABEL as Readonly<Record<string, string>>)[field] ?? field
}

const FIELD_PLACEHOLDER = {
  logic: 'what this block does and why, for whoever reads the project',
  goal: 'what this workflow is for, in a sentence',
  args: 'what it is run on, e.g. { target? }: a branch or a path; empty: no input',
  oncePer: 'e.g. changed files, ×4 dimensions',
  stopCondition: 'e.g. 2 dry rounds, 10 findings, budget < 50k',
  condition: 'e.g. no findings; leave the last arm empty for the else',
  output: 'e.g. { findings: [{ file, claim }] }, or in words',
} as const

/** What a type's empty fields are for where the type has no kinds to say it. */
const TYPE_HINTS: Partial<Record<NodeType, Partial<Record<TextField, string>>>> = {
  code: { logic: 'what it computes, e.g. dedup by ref · keep unrefuted · top 5 by score · merge lists' },
}

/** Its kind's hint, else its type's, else the field's own. An arm's `condition` is hinted by the branch it stands in (`parent`). */
export function placeholderOf(block: BlockRef, field: TextField, parent?: BlockRef): string {
  const from = field === 'condition' ? parent : block
  const kind = from === undefined ? undefined : kindOf(from)
  return (kind === undefined ? undefined : KIND_TEACH[kind].hints?.[field]) ?? TYPE_HINTS[block.type]?.[field] ?? FIELD_PLACEHOLDER[field]
}

/** `start` is not in it: every project has that block, and no second. */
export const PALETTE: PaletteEntry[] = [
  { type: 'agent', group: 'work' },
  { type: 'code', group: 'work' },
  { type: 'subworkflow', group: 'work' },
  { type: 'pipeline', group: 'holds' },
  { type: 'parallel', group: 'holds' },
  { type: 'loop', group: 'holds' },
  { type: 'branch', group: 'holds' },
]

export function groupOf(type: NodeType): PaletteGroup {
  return PALETTE.find(entry => entry.type === type)?.group ?? 'work'
}

/** `agent verify`, `loop custom`; the bare type for a type that has no kinds. */
export function pickName(block: BlockRef): string {
  const kind = kindOf(block)
  return kind === undefined ? block.type : `${block.type} ${kind}`
}

export function allBlocks(): BlockRef[] {
  return PALETTE.flatMap((entry): BlockRef[] => {
    const kinds = kindsOf(entry.type)
    return kinds.length === 0 ? [{ type: entry.type }] : kinds.map(kind => ({ type: entry.type, kind }))
  })
}

/** An empty query matches nothing, so the list shows the blocks, not their kinds. */
export function searchBlocks(query: string): BlockRef[] {
  const wanted = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (wanted === '') return []
  const rank = (block: BlockRef): number => {
    const kind = kindOf(block)
    if ((kind ?? block.type).startsWith(wanted)) return 0
    if (pickName(block).startsWith(wanted)) return 1
    return pickName(block).includes(wanted) ? 2 : -1
  }
  return allBlocks()
    .map((block, order) => ({ block, order, rank: rank(block) }))
    .filter(one => one.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(one => one.block)
}

/** Whether what was typed is how a block's or a kind's name starts: `sw` (sweep), `sc` (scout). */
export function startsName(text: string): boolean {
  const wanted = text.toLowerCase()
  return wanted !== '' && [...PALETTE.map(entry => entry.type as string), ...Object.values(KINDS).flat()].some(name => name.startsWith(wanted))
}
