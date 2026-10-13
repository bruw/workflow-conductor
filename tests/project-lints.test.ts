import { expect, test } from 'claude-code/testing'

import { lint } from '../src/project/lints'
import type { LintRule } from '../src/project/lints'
import { emptyProject } from '../src/project/model'
import type { Project, ProjectNode } from '../src/project/model'
import { TEMPLATES } from '../src/project/templates'

// Every project here says its goal, so only the rule under test can fire.
const START: ProjectNode = { id: 'n90', type: 'start', name: 'start', knobs: { goal: 'a goal' } }

function project(...nodes: ProjectNode[]): Project {
  return { version: 1, name: 'demo', nodes: [START, ...nodes] }
}

// Node ids that trip `rule`.
function hits(rule: LintRule, ...nodes: ProjectNode[]): string[] {
  return lint(project(...nodes))
    .filter(one => one.rule === rule)
    .map(one => one.nodeId)
}

const finder: ProjectNode = { id: 'n2', type: 'agent', name: 'find', logic: 'Find them.', knobs: { output: '{ findings[] }' } }
const loose: ProjectNode = { id: 'n3', type: 'agent', name: 'find', logic: 'Find them.' }
const code: ProjectNode = { id: 'n9', type: 'code', name: 'tally' }

test('no template trips a lint', async () => {
  for (const template of TEMPLATES) expect(lint(template.make())).toEqual([])
})

test('a project with no goal is told so, on its start block; one with nothing else has no other lint', async () => {
  const empty = emptyProject('demo')

  expect(lint(empty).map(one => [one.nodeId, one.rule])).toEqual([[empty.nodes[0]?.id, 'start-no-goal']])
  expect(lint(project())).toEqual([])
  expect(lint({ version: 1, name: 'demo', nodes: [{ ...START, knobs: { goal: '   ' } }] }).map(one => one.rule)).toEqual(['start-no-goal'])
})

test('loop-unbounded fires for a loop that never says when it stops', async () => {
  const body: ProjectNode = { id: 'n2', type: 'agent', name: 'find bugs', logic: 'Find bugs.', knobs: { output: '{ bugs[] }' } }
  const found = lint(project({ id: 'n1', type: 'loop', name: 'hunt', children: [body] }))

  expect(found.map(one => [one.nodeId, one.rule])).toEqual([['n1', 'loop-unbounded']])
  expect(hits('loop-unbounded', { id: 'n1', type: 'loop', name: 'hunt', knobs: { stopCondition: '   ' } })).toEqual(['n1'])
  expect(hits('loop-unbounded', { id: 'n1', type: 'loop', kind: 'count', name: 'hunt' })).toEqual(['n1'])
})

test('loop-unbounded stays quiet with a stop condition, and for the kind whose pattern is its bound', async () => {
  const rule = 'loop-unbounded'

  expect(hits(rule, { id: 'n1', type: 'loop', name: 'hunt', knobs: { stopCondition: '10 bugs found' } })).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'loop', kind: 'dry', name: 'hunt' })).toEqual([])
})

test('code-input-no-output fires on an agent without an output that feeds code', async () => {
  const found = lint(project(loose, code))
  expect(found.map(one => [one.nodeId, one.rule])).toEqual([['n3', 'code-input-no-output']])

  // The agent is the last stage of the container in front of the code node.
  expect(hits('code-input-no-output', { id: 'n1', type: 'parallel', name: 'sweep', knobs: { oncePer: 'files' }, children: [loose] }, code)).toEqual(['n3'])
  expect(hits('code-input-no-output', { id: 'n1', type: 'pipeline', name: 'p', children: [finder, loose] }, code)).toEqual(['n3'])
})

test('code-input-no-output stays quiet with an output, or when no agent feeds the code', async () => {
  const rule = 'code-input-no-output'

  expect(hits(rule, finder, code)).toEqual([])
  expect(hits(rule, code, loose)).toEqual([])
  expect(hits(rule, loose, finder, code)).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'pipeline', name: 'p', children: [loose, finder] }, code)).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'branch', name: 'if any', children: [loose] }, code)).toEqual([])
  expect(hits(rule, code)).toEqual([])
})

test('agent-no-brief fires for an agent with neither logic nor a prompt, but not for a kind whose name is the task', async () => {
  const rule = 'agent-no-brief'

  expect(hits(rule, { id: 'n1', type: 'agent', name: 'do it' })).toEqual(['n1'])
  expect(hits(rule, { id: 'n1', type: 'agent', kind: 'scout', name: 'look' })).toEqual(['n1'])
  expect(hits(rule, { id: 'n1', type: 'agent', name: 'do it', logic: 'Does it.' })).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'agent', name: 'do it', knobs: { prompt: 'Do it' } })).toEqual([])
  expect(hits(rule, finder, { id: 'n1', type: 'agent', kind: 'verify', name: 'verify' })).toEqual([])
  expect(hits(rule, code)).toEqual([])
})

test('verify-nothing-before fires for a verify nothing reaches; the start block makes no result to check', async () => {
  const rule = 'verify-nothing-before'
  const verify: ProjectNode = { id: 'n1', type: 'agent', kind: 'verify', name: 'verify' }

  expect(hits(rule, verify)).toEqual(['n1'])
  expect(hits(rule, { id: 'n5', type: 'parallel', name: 'p', children: [verify, loose] })).toEqual(['n1'])
  expect(hits(rule, finder, verify)).toEqual([])
  expect(hits(rule, { id: 'n5', type: 'pipeline', name: 'p', children: [finder, verify] })).toEqual([])
  expect(hits(rule, { id: 'n5', type: 'parallel', name: 'p', knobs: { oncePer: 'findings' }, children: [verify] })).toEqual([])
})

test('single-branch fires for a parallel that holds one block and states no fan-out', async () => {
  const rule = 'single-branch'
  const one = (more: Partial<ProjectNode> = {}): ProjectNode => ({ id: 'n1', type: 'parallel', name: 'finders', children: [finder], ...more })

  expect(hits(rule, one())).toEqual(['n1'])
  expect(hits(rule, one({ kind: 'sweep' }))).toEqual(['n1'])
  expect(hits(rule, one({ knobs: { oncePer: '×4 files' } }))).toEqual([])
  expect(hits(rule, one({ children: [finder, { ...finder, id: 'n4' }] }))).toEqual([])
  expect(hits(rule, one({ children: [] }))).toEqual([])
  expect(hits(rule, one({ type: 'pipeline' }))).toEqual([])
})

test('loop-no-decider fires when a round ends in free text, or in a critic with no stop condition', async () => {
  const rule = 'loop-no-decider'
  const loop = (last: ProjectNode, stopCondition?: string): ProjectNode => ({ id: 'n1', type: 'loop', name: 'again', ...(stopCondition ? { knobs: { stopCondition } } : {}), children: [finder, last] })
  const critic: ProjectNode = { id: 'n4', type: 'agent', kind: 'critic', name: 'critic', knobs: { output: '{ gaps[] }' } }

  expect(hits(rule, loop(loose, '3 rounds'))).toEqual(['n1'])
  expect(hits(rule, loop(critic))).toEqual(['n1'])
  expect(hits(rule, loop(critic, 'no gaps'))).toEqual([])
  expect(hits(rule, loop({ ...finder, id: 'n4' }, '3 rounds'))).toEqual([])
  expect(hits(rule, loop(code, '3 rounds'))).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'loop', name: 'again', knobs: { stopCondition: '3 rounds' }, children: [] })).toEqual([])
})

test('arm-no-condition fires for an arm nothing picks; the last of several is the else', async () => {
  const rule = 'arm-no-condition'
  const arm = (id: string, condition?: string): ProjectNode => ({ ...finder, id, ...(condition ? { knobs: { ...finder.knobs, condition } } : {}) })
  const branch = (...children: ProjectNode[]): ProjectNode => ({ id: 'n1', type: 'branch', name: 'which', children })

  expect(hits(rule, branch(arm('n2'), arm('n3'), arm('n4')))).toEqual(['n2', 'n3'])
  expect(hits(rule, branch(arm('n2', 'bug'), arm('n3', 'feature'), arm('n4')))).toEqual([])
  expect(hits(rule, branch(arm('n2')))).toEqual(['n2'])
  expect(hits(rule, branch(arm('n2', 'any findings')))).toEqual([])
  expect(hits(rule, { ...branch(arm('n2')), kind: 'guard' })).toEqual(['n2'])
  // Only a block directly in a branch is an arm.
  expect(hits(rule, { id: 'n1', type: 'pipeline', name: 'p', children: [arm('n2'), arm('n3')] })).toEqual([])
})
