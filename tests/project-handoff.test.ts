import { expect, test } from 'claude-code/testing'

import { OUTLINE_MAX, buildHandoff, handoffPrompt, handoffTarget, lastScripts, noteScript, outline } from '../src/project/handoff'
import { flatten } from '../src/project/model'
import type { Project, ProjectNode } from '../src/project/model'
import { TEMPLATES, review } from '../src/project/templates'

const PATH = '/project/.claude/workflow-conductor/demo.json'
const SCRIPT = '/project/.claude/workflow-conductor/demo.workflow.js'
const RAN = '/sessions/s1/workflows/wf_1/script.js'
const FRESH = { path: SCRIPT, from: null }

test('handoff: one visible line, one context entry that names the file, the name and the phases', () => {
  const project = { ...review(), name: 'demo' }
  const handoff = buildHandoff(project, PATH, FRESH)

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

test('handoff: the script is always to be at the file beside the project, started from the newest one there is', () => {
  const project = { ...review(), name: 'demo' }
  const fresh = buildHandoff(project, PATH, FRESH).context[0] ?? ''
  const there = buildHandoff(project, PATH, { path: SCRIPT, from: SCRIPT }).context[0] ?? ''
  const elsewhere = buildHandoff(project, PATH, { path: SCRIPT, from: RAN }).context[0] ?? ''

  expect(fresh).toContain(SCRIPT)
  expect(fresh).toMatch(/implement and run/)
  expect(there).toMatch(/update and run/)
  expect(there).toContain(SCRIPT)
  expect(elsewhere).toMatch(/update and run/)
  expect(elsewhere).toContain(RAN)
  expect(elsewhere).toContain(SCRIPT)
})

test('the script a project last ran is remembered only where it is not the file beside it', () => {
  const noted = noteScript(undefined, 'demo', RAN, SCRIPT)

  expect(noted).toEqual({ demo: RAN })
  expect(noteScript(noted, 'demo', SCRIPT, SCRIPT)).toEqual({})
  expect(noteScript({ other: RAN }, 'demo', SCRIPT, SCRIPT)).toEqual({ other: RAN })
  expect(lastScripts(['x'])).toEqual({})
  expect(lastScripts({ demo: RAN, bad: 3 })).toEqual({ demo: RAN })
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
