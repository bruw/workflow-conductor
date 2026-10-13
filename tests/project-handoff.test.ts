import { expect, test } from 'claude-code/testing'

import { OUTLINE_MAX, buildHandoff, handoffPrompt, handoffTarget, outline } from '../src/project/handoff'
import { flatten } from '../src/project/model'
import type { Project, ProjectNode } from '../src/project/model'
import { TEMPLATES, review } from '../src/project/templates'

const PATH = '/project/.claude/workflow-conductor/demo.json'
const SCRIPT = '/project/.claude/workflow-conductor/demo.workflow.js'

test('handoff: one visible line, one context entry that names the file, the name and the phases', () => {
  const project = { ...review(), name: 'demo' }
  const handoff = buildHandoff(project, PATH, null)

  expect(handoff.text).not.toMatch(/\n/)
  expect(handoff.text).toContain('"demo"')
  expect(handoff.context).toHaveLength(1)
  const context = handoff.context[0] ?? ''

  expect(context).toContain(PATH)
  expect(context).toContain('meta.name = "demo"')
  const stages = project.nodes.filter(node => node.type !== 'start')
  expect(context).toContain(`meta.phases = [${stages.map(node => `"${node.id} ${node.name}"`).join(', ')}]`)
  expect(context).not.toContain(`"${project.nodes[0]?.id} start"`)
  expect(context).toContain(project.nodes[0]?.knobs?.goal ?? '?')
})

test('handoff: a project that has its script is told to update that file', () => {
  const project = { ...review(), name: 'demo' }

  expect(buildHandoff(project, PATH, null).context[0]).not.toContain(SCRIPT)
  expect(buildHandoff(project, PATH, SCRIPT).context[0]).toContain(SCRIPT)
})

test('the prompt that hands a project off names it, and only that prompt does', () => {
  expect(handoffTarget(handoffPrompt('review-changes'))).toBe('review-changes')
  expect(handoffTarget(`  ${handoffPrompt('demo')}`)).toBe('demo')
  expect(handoffTarget('Implement the workflow')).toBe(null)
  expect(handoffTarget('')).toBe(null)
})

test('the outline names every block, indented by depth, and stops at its cap', () => {
  for (const template of TEMPLATES) {
    const project = template.make()
    const lines = outline(project)
    for (const row of flatten(project)) {
      const line = lines.find(one => one.startsWith(`${'  '.repeat(row.depth + 1)}${row.node.id} ${row.node.type}`))
      expect(line).toBeDefined()
      expect(line).toContain(`"${row.node.name}"`)
    }
  }

  const branched: Project = {
    version: 1,
    name: 'deep',
    nodes: [
      {
        id: 'n1',
        type: 'branch',
        name: 'which',
        children: [
          { id: 'n2', type: 'agent', name: 'fix', knobs: { condition: 'any findings' } },
          { id: 'n3', type: 'agent', name: 'report' },
        ],
      },
    ],
  }
  const arms = outline(branched)
  expect(arms[1]).toMatch(/any findings.*n2/)
  expect(arms[2]).toMatch(/ELSE.*n3/)

  const many: ProjectNode[] = Array.from({ length: 90 }, (_, at) => ({ id: `n${at + 1}`, type: 'agent', name: `step ${at + 1}` }))
  const huge = outline({ version: 1, name: 'huge', nodes: [{ id: 'n100', type: 'pipeline', name: 'all', children: many }] })
  expect(huge).toHaveLength(OUTLINE_MAX + 1)
  expect(huge.at(-1)).toContain(`${91 - OUTLINE_MAX} more`)
})
