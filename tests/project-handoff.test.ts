import { expect, test } from 'claude-code/testing'

import { OUTLINE_MAX, buildHandoff, handoffPrompt, handoffTarget, newestScript, noteRun, outline, saveAsk, savedWorkflowFile } from '../src/project/handoff'
import { flatten } from '../src/project/model'
import type { Project, ProjectNode } from '../src/project/model'
import { KIND_TEACH } from '../src/project/teach'
import { TEMPLATES, review } from '../src/project/templates'

const PATH = '/project/.claude/workflow-conductor/demo.json'
const RAN = '/sessions/s1/workflows/wf_1/script.js'
const FRESH = { path: null }

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

test('handoff: with a remembered script it is updated from that one, without one it is written fresh, never into a file of its own', () => {
  const project = { ...review(), name: 'demo' }
  const fresh = buildHandoff(project, PATH, FRESH).context[0] ?? ''
  const update = buildHandoff(project, PATH, { path: RAN }).context[0] ?? ''

  expect(fresh).toMatch(/implement and run/)
  expect(fresh).not.toContain(RAN)
  expect(update).toMatch(/update and run/)
  expect(update).toContain(RAN)
  for (const context of [fresh, update]) expect(context).not.toContain('.workflow.js')
})

test("handoff: the last run's id and journal are named only where it was in this session and its script is there", () => {
  const project = { ...review(), name: 'demo' }
  const run = { runId: 'wf_7', transcriptDir: '/sessions/s1/workflows/wf_7', script: RAN }
  const resumable = buildHandoff(project, PATH, { path: RAN, run }).context[0] ?? ''
  const elsewhere = buildHandoff(project, PATH, { path: RAN }).context[0] ?? ''
  const gone = buildHandoff(project, PATH, { path: null, run }).context[0] ?? ''

  expect(resumable).toContain('wf_7')
  expect(resumable).toContain(`${run.transcriptDir}/journal.jsonl`)
  for (const context of [elsewhere, gone]) expect(context).not.toContain('wf_7')
})

test('handoff: each kind the project uses is explained once, and no other kind is', () => {
  const project: Project = {
    version: 1,
    name: 'demo',
    nodes: [
      { id: 'n1', type: 'start', name: 'start' },
      { id: 'n2', type: 'agent', kind: 'verify', name: 'verify one' },
      { id: 'n3', type: 'loop', kind: 'pass', name: 'fix', children: [{ id: 'n4', type: 'agent', kind: 'verify', name: 'verify two' }] },
      { id: 'n5', type: 'agent', name: 'plain task' },
    ],
  }
  const context = buildHandoff(project, PATH, FRESH).context[0] ?? ''

  expect(context.split(KIND_TEACH.verify.script)).toHaveLength(2)
  expect(context).toContain(KIND_TEACH.pass.script)
  for (const kind of ['task', 'judge', 'dry', 'each'] as const) expect(context).not.toContain(KIND_TEACH[kind].script)
})

test('the run a project last had is remembered, and a run only named as the project does not replace one that is', () => {
  const first = { runId: 'wf_1', script: RAN }
  const newer = { runId: 'wf_2', script: '/sessions/s1/workflows/wf_2/script.js' }
  const noted = noteRun({}, 'demo', first, false)

  expect(noted).toEqual({ demo: first })
  expect(noteRun(noted, 'demo', newer, false)).toEqual({ demo: first })
  expect(noteRun(noted, 'demo', newer, true)).toEqual({ demo: newer })
  expect(noteRun({ other: first }, 'demo', newer, false)).toEqual({ other: first, demo: newer })
})

test("a saved workflow is the project's name as a .js file in Claude Code's own folder under the root", () => {
  expect(savedWorkflowFile('/repo', 'demo')).toBe('/repo/.claude/workflows/demo.js')
  expect(savedWorkflowFile('/repo/', 'demo')).toBe('/repo/.claude/workflows/demo.js')
})

test("the handoff starts from the newer of the last run's script and the saved copy, and from whichever is there", () => {
  const COPY = '/repo/.claude/workflows/demo.js'
  const ran = { path: RAN, mtimeMs: 100 }

  expect(newestScript(null, null)).toBeNull()
  expect(newestScript(ran, null)).toBe(RAN)
  expect(newestScript(null, { path: COPY, mtimeMs: 1 })).toBe(COPY)
  expect(newestScript(ran, { path: COPY, mtimeMs: 200 })).toBe(COPY)
  expect(newestScript(ran, { path: COPY, mtimeMs: 50 })).toBe(RAN)
  expect(newestScript(ran, { path: COPY, mtimeMs: 100 })).toBe(RAN)
})

test("a run's end asks to save its script only when a saved project's run ended done, someone can answer, and the repo lacks that script", () => {
  const done = { ending: 'done' as const, project: 'demo', script: 'export const meta = { name: "demo" }', copy: null, answerable: true }

  expect(saveAsk(done)).toBe('save')
  expect(saveAsk({ ...done, copy: 'export const meta = { name: "demo" } // older' })).toBe('update')
  expect(saveAsk({ ...done, copy: done.script })).toBeNull()
  expect(saveAsk({ ...done, ending: 'failed' })).toBeNull()
  expect(saveAsk({ ...done, ending: 'stopped' })).toBeNull()
  expect(saveAsk({ ...done, project: undefined })).toBeNull()
  expect(saveAsk({ ...done, project: 'replay-review' })).toBeNull()
  expect(saveAsk({ ...done, answerable: false })).toBeNull()
  expect(saveAsk({ ...done, script: null })).toBeNull()
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
