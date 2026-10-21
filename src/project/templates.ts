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
      node('n1', 'agent scout', 'scout diff', 'Read the diff and split the review into dimensions (bugs, security, performance, tests), each with the files it concerns. Cheap and mechanical. Its list of dimensions is the work-list for the pipeline.', {
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
          node('n3', 'agent', 'review', 'Review the diff for this dimension only and report concrete findings with evidence. One reviewer per dimension.', {
            output: '{ findings: [{ file, line, severity, claim, evidence }] }',
          }),
          node('n4', 'agent verify', 'verify findings', '3 votes: each skeptic tries to refute the finding against the actual code and defaults to refuted when unsure. Keep a finding only if at least 2 of 3 fail to refute it.', {
            output: '{ refuted: boolean, reason }',
          }),
        ],
      ),
      node('n5', 'agent merge', 'merge', 'Write one review from the confirmed findings of every dimension. Runs once over all surviving findings: merge duplicates, order by severity, say what was dropped.', {}),
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
          node('n2', 'agent', 'search', 'Search for sources on the question using only this angle. One agent per search angle.', {
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
          node('n5', 'agent', 'read source', 'Read the source in full and extract the claims that bear on the question, with quotes. One reader per source.', {
            output: '{ claims: [{ claim, quote, confidence }] }',
          }),
          node('n6', 'agent verify', 'check claims', '2 votes: each tries to refute every claim against the quoted source; drop claims the source does not actually support.', {
            output: '{ refuted: boolean, reason }',
          }),
        ],
      ),
      node('n7', 'agent critic', 'completeness critic', 'Given the question and all claims so far, list what is still missing. Asks what is missing: an angle not searched, a claim unverified, a source unread. Gaps become one more round of reading.', {
        output: '{ gaps: [{ what, how_to_fill }] }',
      }),
      node('n8', 'agent merge', 'merge', 'Write the answer from the verified claims. Runs once over all verified claims; cite the source of each and state open gaps.', {}),
    ],
  }
}

function migrate(): Project {
  return {
    version: 1,
    name: 'migrate',
    nodes: [
      start('n5', 'Apply one mechanical change at every site in the codebase, each in isolation, and verify each result', '{ change, scope? }: the change to make at every site, and where to look for sites'),
      node('n1', 'agent scout', 'discover sites', 'Find every site that needs the migration and group them into units that can change independently. The sites are the work-list for the pipeline. Log anything left out of scope.', {
        output: '{ sites: [{ id, files[], note }] }',
      }),
      node(
        'n2',
        'pipeline',
        'migrate',
        'Each site is transformed and verified on its own; a failing site drops out without stopping the rest.',
        { oncePer: 'migration sites' },
        [
          node('n3', 'agent', 'transform', 'Apply the migration to this site only. Agents edit files in parallel, so each one gets its own worktree. This is the only stage that needs it.', {
            output: '{ changed: boolean, files[], summary }',
            isolation: 'worktree',
          }),
          node('n4', 'agent check', 'check', 'Check the migrated site: typecheck, run its tests, confirm behaviour is unchanged. Runs the typecheck and the tests for the site against the transformed code and reports pass or fail.', {
            output: '{ ok: boolean, failures[] }',
          }),
        ],
      ),
    ],
  }
}

function judgePanel(): Project {
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
          node('n2', 'agent', 'draft approach', 'Design a complete approach to the task from this angle. One attempt per angle, each unaware of the others.', {
            output: '{ approach, tradeoffs[], risks[] }',
          }),
        ],
      ),
      node('n3', 'agent judge', 'judge', '3 votes: judges score all attempts on correctness, simplicity and risk and compare them; highest total wins.', {
        output: '{ scores: [{ attempt, score, strengths[], weaknesses[] }] }',
      }),
      node('n4', 'agent merge', 'merge from winner', 'Write the final approach from the winner, adopting the strongest ideas of the others. Start from the winning attempt and graft in the best ideas from the runners-up.', {}),
    ],
  }
}

export const TEMPLATES: Template[] = [
  { id: 'review', title: 'Review', blurb: 'Scout the diff, review by dimension, refute weak findings', make: review },
  { id: 'research', title: 'Research', blurb: 'Search several ways, deep-read, check for gaps, write up', make: research },
  { id: 'migrate', title: 'Migrate', blurb: 'Find every site, transform each in a worktree, verify', make: migrate },
  { id: 'judge-panel', title: 'Judge panel', blurb: 'Independent attempts, scored by judges, built from the winner', make: judgePanel },
]
