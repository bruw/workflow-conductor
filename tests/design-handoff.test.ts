import { expect, test } from 'claude-code/testing'

import { HANDOFF_MAX_LINES, OUTLINE_MAX, buildHandoff } from '../src/design/handoff'
import { flatten } from '../src/design/model'
import type { Design, DesignNode } from '../src/design/model'
import { TEMPLATES, review } from '../src/design/templates'

const PATH = '/project/.claude/workflow-designs/demo.json'

test('handoff: one visible line, one self-sufficient context entry', () => {
  const design = { ...review(), name: 'demo' }
  const handoff = buildHandoff(design, PATH)

  expect(handoff.text).toBe(`handing off design "demo" (${flatten(design).length} nodes)`)
  expect(handoff.text).not.toMatch(/\n/)
  expect(handoff.context).toHaveLength(1)
  const context = handoff.context[0] ?? ''

  expect(context).toContain(PATH)
  expect(context).toMatch(/SPEC, not a program/)
  expect(context).toMatch(/Workflow script/)
  expect(context).toMatch(/Workflow tool/)
  // The label rule and the phase rule, as the run view parses them.
  expect(context).toContain('label: "<nodeId>: <short text>"')
  expect(context).toMatch(/INNERMOST design node's id/)
  expect(context).toContain('one phase titled "<nodeId> <title>"')
  expect(context).toMatch(/meta\.phases/)
  expect(context).toContain('meta.name = "demo"')
  expect(context).toMatch(/model, effort, isolation, agentType and schema/)
  expect(context).toMatch(/omit/)
  expect(context).toMatch(/could not be honoured/)
  // The phases are the top-level nodes, in order.
  expect(context).toContain(`meta.phases = [${design.nodes.map(node => `"${node.id} ${node.title}"`).join(', ')}]`)
})

test('handoff: the outline names every node, indented by depth', () => {
  for (const template of TEMPLATES) {
    const design = template.make()
    const lines = (buildHandoff(design, PATH).context[0] ?? '').split('\n')
    for (const row of flatten(design)) {
      const line = lines.find(one => one.startsWith(`${'  '.repeat(row.depth + 1)}${row.node.id} ${row.node.type} "`))
      expect(line).toBeDefined()
      expect(line).toContain(`"${row.node.title}"`)
    }
  }

  const nested: Design = {
    version: 1,
    name: 'deep',
    description: '',
    nodes: [
      {
        id: 'n1',
        type: 'pipeline',
        title: 'outer',
        children: [{ id: 'n2', type: 'loop', title: 'again', knobs: { until: 'dry' }, children: [{ id: 'n3', type: 'agent', title: 'dig', notes: 'careful', knobs: { model: 'haiku' } }] }],
      },
    ],
  }
  const context = buildHandoff(nested, PATH).context[0] ?? ''
  expect(context).toContain('\n  n1 pipeline "outer"\n    n2 loop "again" [until=dry]\n      n3 agent "dig" [model=haiku] (has notes)')
  expect(buildHandoff(nested, PATH).text).toMatch(/\(3 nodes\)/)
})

test('handoff: stays under the line budget, for the largest template and for a huge design', () => {
  const largest = TEMPLATES.map(template => template.make()).sort((a, b) => flatten(b).length - flatten(a).length)[0] ?? review()
  expect((buildHandoff(largest, PATH).context[0] ?? '').split('\n').length).toBeLessThan(HANDOFF_MAX_LINES)

  const many: DesignNode[] = Array.from({ length: 90 }, (_, at) => ({ id: `n${at + 1}`, type: 'agent', title: `step ${at + 1}` }))
  const context = buildHandoff({ version: 1, name: 'huge', description: '', nodes: [{ id: 'n100', type: 'pipeline', title: 'all', children: many }] }, PATH).context[0] ?? ''
  expect(context.split('\n').length).toBeLessThanOrEqual(HANDOFF_MAX_LINES)
  expect(context).toContain(`… ${91 - OUTLINE_MAX} more nodes: see the file`)
})
