import { expect, test } from 'claude-code/testing'

import { lint } from '../src/design/lints'
import type { LintRule } from '../src/design/lints'
import type { Design, DesignNode } from '../src/design/model'
import { TEMPLATES } from '../src/design/templates'

function design(...nodes: DesignNode[]): Design {
  return { version: 1, name: 'demo', description: '', nodes }
}

// Node ids that trip `rule`.
function hits(rule: LintRule, ...nodes: DesignNode[]): string[] {
  return lint(design(...nodes))
    .filter(one => one.rule === rule)
    .map(one => one.nodeId)
}

const finder: DesignNode = { id: 'n2', type: 'agent', title: 'find', knobs: { schema: '{ findings[] }' } }

function fanned(fanout?: string): DesignNode {
  return { id: 'n1', type: 'parallel', title: 'finders', ...(fanout ? { knobs: { fanout } } : {}), children: [finder] }
}

test('no template trips a lint', async () => {
  for (const template of TEMPLATES) expect(lint(template.make())).toEqual([])
})

test('an empty design has no lints', async () => {
  expect(lint(design())).toEqual([])
})

test('barrier-not-needed fires when the stage after a parallel works per item', async () => {
  const found = lint(design(fanned(), { id: 'n3', type: 'agent', title: 'fix', notes: 'Fix the finding.' }))

  expect(found.map(one => [one.nodeId, one.rule])).toEqual([['n1', 'barrier-not-needed']])
  expect(found[0]?.message).toMatch(/pipeline/)
})

test('barrier-not-needed stays quiet when the next stage needs the full set, or there is none', async () => {
  const rule = 'barrier-not-needed'

  expect(hits(rule, fanned(), { id: 'n3', type: 'code', title: 'tally' })).toEqual([])
  expect(hits(rule, fanned(), { id: 'n3', type: 'judge-panel', title: 'judge' })).toEqual([])
  expect(hits(rule, fanned(), { id: 'n3', type: 'agent', title: 'triage', notes: 'Dedup findings before verifying.' })).toEqual([])
  expect(hits(rule, fanned(), { id: 'n3', type: 'agent', title: 'report', knobs: { prompt: 'Compare the findings' } })).toEqual([])
  expect(hits(rule, fanned(), { id: 'n3', type: 'agent', title: 'write up', notes: 'Uses all results.' })).toEqual([])
  expect(hits(rule, fanned())).toEqual([])
  expect(hits(rule, { ...fanned(), type: 'pipeline' }, { id: 'n3', type: 'agent', title: 'fix' })).toEqual([])
})

test('worktree-read-only fires for an isolated agent that only reads', async () => {
  const found = lint(design({ id: 'n1', type: 'agent', title: 'review file', knobs: { isolation: 'worktree', prompt: 'Read the file and list problems' } }))

  expect(found.map(one => [one.nodeId, one.rule])).toEqual([['n1', 'worktree-read-only']])
})

test('worktree-read-only stays quiet for writers, unclear text and agents without isolation', async () => {
  const rule = 'worktree-read-only'

  expect(hits(rule, { id: 'n1', type: 'agent', title: 'transform', knobs: { isolation: 'worktree' } })).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'agent', title: 'review', notes: 'Review, then fix what you find.', knobs: { isolation: 'worktree' } })).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'agent', title: 'stage two', knobs: { isolation: 'worktree' } })).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'agent', title: 'review file' })).toEqual([])
})

test('loop-unbounded fires for a loop that never says when it stops', async () => {
  const body: DesignNode = { id: 'n2', type: 'agent', title: 'find bugs', knobs: { schema: '{ bugs[] }' } }
  const found = lint(design({ id: 'n1', type: 'loop', title: 'hunt', children: [body] }))

  expect(found.map(one => [one.nodeId, one.rule])).toEqual([['n1', 'loop-unbounded']])
  expect(hits('loop-unbounded', { id: 'n1', type: 'loop', title: 'hunt', knobs: { until: '   ' } })).toEqual(['n1'])
})

test('loop-unbounded stays quiet when until or the notes give a bound', async () => {
  const rule = 'loop-unbounded'

  expect(hits(rule, { id: 'n1', type: 'loop', title: 'hunt', knobs: { until: '10 bugs found' } })).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'loop', title: 'hunt', notes: 'Stop when the budget drops under 50k.' })).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'loop', title: 'hunt', notes: 'Three rounds.' })).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'loop-until-dry', title: 'hunt' })).toEqual([])
})

test('code-input-no-schema fires on an agent without a schema that feeds code', async () => {
  const code: DesignNode = { id: 'n9', type: 'code', title: 'tally' }
  const loose: DesignNode = { id: 'n2', type: 'agent', title: 'find' }

  const found = lint(design(loose, code))
  expect(found.map(one => [one.nodeId, one.rule])).toEqual([['n2', 'code-input-no-schema']])
  expect(found[0]?.message).toMatch(/schema/)

  // The agent is the last stage of the container in front of the code node.
  expect(hits('code-input-no-schema', { id: 'n1', type: 'sweep', title: 'sweep', children: [loose] }, code)).toEqual(['n2'])
  expect(hits('code-input-no-schema', { id: 'n1', type: 'pipeline', title: 'p', children: [finder, { ...loose, id: 'n3' }] }, code)).toEqual(['n3'])
})

test('code-input-no-schema stays quiet with a schema, or when no agent feeds the code', async () => {
  const rule = 'code-input-no-schema'
  const code: DesignNode = { id: 'n9', type: 'code', title: 'tally' }
  const loose: DesignNode = { id: 'n3', type: 'agent', title: 'find' }

  expect(hits(rule, finder, code)).toEqual([])
  expect(hits(rule, fanned(), code)).toEqual([])
  expect(hits(rule, code, loose)).toEqual([])
  expect(hits(rule, loose, finder, code)).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'pipeline', title: 'p', children: [loose, finder] }, code)).toEqual([])
  expect(hits(rule, { id: 'n1', type: 'branch', title: 'if any', children: [loose] }, code)).toEqual([])
  expect(hits(rule, code)).toEqual([])
})

test('fanout-over-cap fires for a parallel whose stated fan-out is above 16', async () => {
  const found = lint(design(fanned('×40 files')))

  expect(found.map(one => [one.nodeId, one.rule])).toEqual([['n1', 'fanout-over-cap']])
  expect(found[0]?.message).toMatch(/40/)
  expect(hits('fanout-over-cap', fanned('~1,200 call sites'))).toEqual(['n1'])
  expect(hits('fanout-over-cap', fanned('3 shards of 17 files'))).toEqual(['n1'])
})

test('fanout-over-cap stays quiet at or under the cap, without a number, and without a barrier', async () => {
  const rule = 'fanout-over-cap'

  expect(hits(rule, fanned('×16 files'))).toEqual([])
  expect(hits(rule, fanned('×4 dimensions'))).toEqual([])
  expect(hits(rule, fanned('changed files'))).toEqual([])
  expect(hits(rule, fanned())).toEqual([])
  expect(hits(rule, { ...fanned('×40 files'), type: 'pipeline' })).toEqual([])
})
