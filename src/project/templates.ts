// Starting projects for the empty state. Each call returns a fresh Project.

import { readType } from './model'
import type { Project, ProjectNode, Kind, Knobs, NodeType } from './model'

export type Template = { id: string; title: string; blurb: string; make: () => Project }

function start(id: string, goal: string, args: string): ProjectNode {
  return { id, type: 'start', name: 'start', knobs: { goal, args } }
}

type Block = NodeType | `${NodeType} ${Kind}`

function node(id: string, block: Block, name: string, logic: string, knobs: Knobs, children?: ProjectNode[]): ProjectNode {
  const [type, kind] = block.split(' ')
  const read = readType(type, kind)
  if ('error' in read) throw new Error(`template block ${id}: ${read.error}`)
  const made: ProjectNode = { id, ...read, name, logic }
  if (Object.keys(knobs).length > 0) made.knobs = knobs
  if (children) made.children = children
  return made
}

export function review(): Project {
  return {
    version: 1,
    name: 'review-changes',
    nodes: [
      start('n6', 'Review the current diff along several dimensions and keep only findings that survive a refutation pass', '{ target? }: what to review: a branch, a pull request or a path. With none, the current diff'),
      node('n1', 'agent scout', 'scout diff', 'Cheap and mechanical. Its list of dimensions is the work-list for the pipeline.', {
        prompt: 'Read the diff and split the review into dimensions (bugs, security, performance, tests), each with the files it concerns',
        output: '{ dimensions: [{ name, focus, files[] }] }',
        effort: 'low',
      }),
      node(
        'n2',
        'pipeline',
        'review',
        'Each dimension flows through both stages on its own; a fast dimension starts verifying while slow ones still review.',
        { oncePer: '×4 dimensions' },
        [
          node('n3', 'agent', 'review', 'One reviewer per dimension.', {
            prompt: 'Review the diff for this dimension only and report concrete findings with evidence',
            output: '{ findings: [{ file, line, severity, claim, evidence }] }',
          }),
          node('n4', 'agent verify', 'verify findings', '3 votes: each skeptic tries to refute a finding and defaults to refuted when unsure. Keep a finding only if at least 2 of 3 fail to refute it.', {
            prompt: 'Try to refute this finding against the actual code',
            output: '{ refuted: boolean, reason }',
          }),
        ],
      ),
      node('n5', 'agent merge', 'merge', 'Runs once over all surviving findings: merge duplicates, order by severity, say what was dropped.', {
        prompt: 'Write one review from the confirmed findings of every dimension',
      }),
    ],
  }
}

export function research(): Project {
  return {
    version: 1,
    name: 'research',
    nodes: [
      start('n9', 'Answer a question from many sources: search several ways, read deeply, check for gaps, then write up', '{ question }: the question to answer'),
      node(
        'n1',
        'parallel sweep',
        'multi-modal sweep',
        'Each searcher is blind to the others, so expect overlap between their results.',
        { oncePer: '4 search angles: by container, by content, by entity, by time' },
        [
          node('n2', 'agent', 'search', 'One agent per search angle.', {
            prompt: 'Search for sources on the question using only this angle',
            output: '{ sources: [{ ref, why }] }',
            effort: 'low',
          }),
        ],
      ),
      node('n3', 'code', 'dedupe sources', 'Plain code over all sweep results: drop duplicate refs before the expensive reading starts.', {}),
      node(
        'n4',
        'pipeline',
        'deep read',
        'Each source is read and checked independently.',
        { oncePer: 'deduped sources' },
        [
          node('n5', 'agent', 'read source', 'One reader per source.', {
            prompt: 'Read the source in full and extract the claims that bear on the question, with quotes',
            output: '{ claims: [{ claim, quote, confidence }] }',
          }),
          node('n6', 'agent verify', 'check claims', '2 votes: drop claims the source does not actually support.', {
            prompt: 'Try to refute each claim against the quoted source',
            output: '{ refuted: boolean, reason }',
          }),
        ],
      ),
      node('n7', 'agent critic', 'completeness critic', 'Asks what is missing: an angle not searched, a claim unverified, a source unread. Gaps become one more round of reading.', {
        prompt: 'Given the question and all claims so far, list what is still missing',
        output: '{ gaps: [{ what, how_to_fill }] }',
      }),
      node('n8', 'agent merge', 'merge', 'Runs once over all verified claims; cite the source of each and state open gaps.', {
        prompt: 'Write the answer from the verified claims',
      }),
    ],
  }
}

export function migrate(): Project {
  return {
    version: 1,
    name: 'migrate',
    nodes: [
      start('n5', 'Apply one mechanical change at every site in the codebase, each in isolation, and verify each result', '{ change, scope? }: the change to make at every site, and where to look for sites'),
      node('n1', 'agent scout', 'discover sites', 'The sites are the work-list for the pipeline. Log anything left out of scope.', {
        prompt: 'Find every site that needs the migration and group them into units that can change independently',
        output: '{ sites: [{ id, files[], note }] }',
      }),
      node(
        'n2',
        'pipeline',
        'migrate',
        'Each site is transformed and verified on its own; a failing site drops out without stopping the rest.',
        { oncePer: 'migration sites' },
        [
          node('n3', 'agent', 'transform', 'Agents edit files in parallel, so each one gets its own worktree. This is the only stage that needs it.', {
            prompt: 'Apply the migration to this site only',
            output: '{ changed: boolean, files[], summary }',
            isolation: 'worktree',
          }),
          node('n4', 'agent check', 'check', 'Runs the typecheck and the tests for the site against the transformed code and reports pass or fail.', {
            prompt: 'Check the migrated site: typecheck, run its tests, confirm behaviour is unchanged',
            output: '{ ok: boolean, failures[] }',
          }),
        ],
      ),
    ],
  }
}

export function judgePanel(): Project {
  return {
    version: 1,
    name: 'judge-panel',
    nodes: [
      start('n5', 'Produce several independent approaches, have judges score them, and build the answer from the winner', '{ task }: the task the attempts are for'),
      node(
        'n1',
        'parallel attempts',
        'attempts',
        'A barrier is right here: the judges compare all attempts side by side.',
        { oncePer: '×3 angles: MVP-first, risk-first, user-first' },
        [
          node('n2', 'agent', 'draft approach', 'One attempt per angle, each unaware of the others.', {
            prompt: 'Design a complete approach to the task from this angle',
            output: '{ approach, tradeoffs[], risks[] }',
          }),
        ],
      ),
      node('n3', 'agent judge', 'judge', '3 votes: judges score all attempts against the same criteria and compare them; highest total wins.', {
        prompt: 'Score every attempt on correctness, simplicity and risk',
        output: '{ scores: [{ attempt, score, strengths[], weaknesses[] }] }',
      }),
      node('n4', 'agent merge', 'merge from winner', 'Start from the winning attempt and graft in the best ideas from the runners-up.', {
        prompt: 'Write the final approach from the winner, adopting the strongest ideas of the others',
      }),
    ],
  }
}

export const TEMPLATES: Template[] = [
  { id: 'review', title: 'Review', blurb: 'Scout the diff, review by dimension, refute weak findings', make: review },
  { id: 'research', title: 'Research', blurb: 'Search several ways, deep-read, check for gaps, write up', make: research },
  { id: 'migrate', title: 'Migrate', blurb: 'Find every site, transform each in a worktree, verify', make: migrate },
  { id: 'judge-panel', title: 'Judge panel', blurb: 'Independent attempts, scored by judges, built from the winner', make: judgePanel },
]
