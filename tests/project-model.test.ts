import { expect, test } from 'claude-code/testing'

import { KINDS, NODE_TYPES, canHoldChildren, emptyProject, findNode, flatten, kindsOf, parseProject, readType, serializeProject, startOf, walk } from '../src/project/model'
import type { Project } from '../src/project/model'
import { TEMPLATES, review } from '../src/project/templates'

function parsed(json: string): Project {
  const result = parseProject(json)
  if (!result.ok) throw new Error(result.error)
  return result.project
}

function rejected(value: unknown): string {
  const result = parseProject(typeof value === 'string' ? value : JSON.stringify(value))
  if (result.ok) throw new Error('expected the project to be rejected')
  return result.error
}

const base = { version: 1, name: 'demo' }

test('emptyProject gives a valid, kebab-named project that holds its start block alone', async () => {
  const project = emptyProject('My First Flow!')

  expect(project.name).toBe('my-first-flow')
  expect(project.nodes.map(node => node.type)).toEqual(['start'])
  expect(parsed(serializeProject(project))).toEqual(project)
  expect(emptyProject('  ').name).toBe('untitled')
})

for (const template of TEMPLATES) {
  test(`template ${template.id} survives a serialize and parse round-trip`, async () => {
    const project = template.make()
    const text = serializeProject(project)

    expect(parsed(text)).toEqual(project)
    expect(serializeProject(parsed(text))).toBe(text)
    expect(text.endsWith('}\n')).toBe(true)
  })
}

test('templates are fresh on each call, have unique ids, open with start and only nest under containers', async () => {
  for (const template of TEMPLATES) {
    const project = template.make()
    expect(template.make()).not.toBe(project)
    expect(startOf(project)).toBeDefined()

    const ids = flatten(project).map(row => row.node.id)
    expect(new Set(ids).size).toBe(ids.length)
    walk(project, (node, info) => {
      expect(node.name.length).toBeGreaterThan(0)
      if (info.parent) expect(canHoldChildren(info.parent.type)).toBe(true)
    })
  }
})

test('serializeProject writes keys in one order whatever order they were built in, and leaves the plain kind out', async () => {
  const scrambled = {
    nodes: [
      { knobs: { args: 'a', goal: 'g' }, name: 'start', type: 'start', id: 'n2' },
      { children: [{ kind: 'task', name: 'work', id: 'n3', type: 'agent' }], knobs: { stopCondition: 's' }, logic: 'why', name: 'again', kind: 'dry', type: 'loop', id: 'n1' },
    ],
    nextId: 4,
    name: 'demo',
    version: 1,
  } as unknown as Project

  const written = JSON.parse(serializeProject(scrambled))
  expect(Object.keys(written)).toEqual(['version', 'name', 'nextId', 'nodes'])
  expect(Object.keys(written.nodes[0])).toEqual(['id', 'type', 'name', 'knobs'])
  expect(Object.keys(written.nodes[0].knobs)).toEqual(['goal', 'args'])
  expect(Object.keys(written.nodes[1])).toEqual(['id', 'type', 'kind', 'name', 'logic', 'knobs', 'children'])
  expect(Object.keys(written.nodes[1].children[0])).toEqual(['id', 'type', 'name'])
})

test('parseProject rejects bad input with a reason and never throws', async () => {
  const agent = { id: 'n1', type: 'agent', name: 'a' }

  expect(rejected('{ not json')).toMatch(/JSON/)
  expect(rejected('null')).toMatch(/object/)
  expect(rejected('[]')).toMatch(/object/)
  expect(rejected({ ...base, version: 2, nodes: [] })).toMatch(/version/)
  expect(rejected({ name: 'demo', nodes: [] })).toMatch(/version/)
  expect(rejected({ ...base, name: 7, nodes: [] })).toMatch(/name/)
  expect(rejected({ ...base })).toMatch(/nodes/)
  expect(rejected({ ...base, nodes: [agent, { ...agent }] })).toMatch(/duplicate id n1/)
  expect(rejected({ ...base, nodes: [{ id: 'n1', type: 'pipeline', name: 'p', children: [agent] }] })).toMatch(/duplicate id n1/)
  expect(rejected({ ...base, nodes: [{ ...agent, type: 'teleport' }] })).toMatch(/unknown type/)
  expect(rejected({ ...base, nodes: [{ ...agent, kind: 'dry' }] })).toMatch(/kind/)
  expect(rejected({ ...base, nodes: [{ id: 'n1', type: 'code', name: 'c', kind: 'task' }] })).toMatch(/kind/)
  expect(rejected({ ...base, nodes: [{ ...agent, id: 'first' }] })).toMatch(/id/)
  expect(rejected({ ...base, nodes: [{ type: 'agent' }] })).toMatch(/id/)
  expect(rejected({ ...base, nodes: [{ ...agent, name: 3 }] })).toMatch(/name/)
  expect(rejected({ ...base, nodes: [{ ...agent, knobs: { effort: 'extreme' } }] })).toMatch(/effort/)
  expect(rejected({ ...base, nodes: [{ ...agent, knobs: { prompt: 3 } }] })).toMatch(/prompt/)
  expect(rejected({ ...base, nodes: [{ ...agent, match: ['ok', ''] }] })).toMatch(/match/)
  expect(rejected({ ...base, nodes: [{ ...agent, children: [{ id: 'n2', type: 'agent', name: 'b' }] }] })).toMatch(/cannot hold children/)
  expect(rejected({ ...base, nextId: 0, nodes: [] })).toMatch(/nextId/)
  expect(rejected('['.repeat(100000))).toMatch(/JSON|read/)
})

test('the start block stands first and alone says a goal and args', async () => {
  const start = { id: 'n1', type: 'start', name: 'start', knobs: { goal: 'g', args: 'a' } }
  const agent = { id: 'n2', type: 'agent', name: 'a' }

  expect(parsed(JSON.stringify({ ...base, nodes: [start, agent] })).nodes.map(node => node.id)).toEqual(['n1', 'n2'])
  expect(rejected({ ...base, nodes: [agent, start] })).toMatch(/start/)
  expect(rejected({ ...base, nodes: [{ id: 'n3', type: 'pipeline', name: 'p', children: [start] }] })).toMatch(/start/)
  expect(rejected({ ...base, nodes: [{ ...agent, knobs: { goal: 'mine' } }] })).toMatch(/goal/)

  const given = parsed(JSON.stringify({ ...base, nodes: [agent] }))
  expect(given.nodes.map(node => node.type)).toEqual(['start', 'agent'])
  expect(new Set(given.nodes.map(node => node.id)).size).toBe(2)
  expect(parsed(serializeProject(given))).toEqual(given)
})

test('parseProject accepts every node type and kind', async () => {
  const types = ['start', ...NODE_TYPES.filter(type => type !== 'start')]
  const nodes = types.map((type, index) => ({ id: `n${index + 1}`, type, name: type }))
  expect(parsed(JSON.stringify({ ...base, nodes })).nodes.map(node => node.type)).toEqual(types)

  for (const [type, kinds] of Object.entries(KINDS)) {
    for (const kind of kinds) {
      const project = parsed(JSON.stringify({ ...base, nodes: [{ id: 'n1', type, kind, name: 'x' }] }))
      // The plain kind, the first of its type's, is the block with no kind said.
      expect(findNode(project, 'n1')?.kind).toBe(kind === kinds[0] ? undefined : kind)
    }
  }
  expect(kindsOf('code')).toEqual([])
  expect(readType('agent', 'verify')).toEqual({ type: 'agent', kind: 'verify' })
  expect(readType('agent', 'task')).toEqual({ type: 'agent' })

  const project = parsed(JSON.stringify({ ...base, nextId: 9, nodes: [{ id: 'n1', type: 'agent', name: 'a', knobs: { model: 'm' } }] }))
  expect(project.nextId).toBeGreaterThanOrEqual(9)
  expect(findNode(project, 'n1')?.knobs).toEqual({ model: 'm' })
})

test('parseProject refuses a key it does not know: one read and dropped would be erased by the next save', async () => {
  const agent = { id: 'n1', type: 'agent', name: 'a' }

  expect(rejected({ ...base, description: 'd', nodes: [] })).toMatch(/unknown key description/)
  expect(rejected({ ...base, nodes: [{ ...agent, title: 'a' }] })).toMatch(/unknown key title/)
  expect(rejected({ ...base, nodes: [{ ...agent, knobs: { colour: 'red' } }] })).toMatch(/unknown knob colour/)
})

test('flatten lists rows in display order with depth, parent and index', async () => {
  const rows = flatten(review()).map(row => [row.node.id, row.depth, row.parentId, row.index])

  expect(rows).toEqual([
    ['n6', 0, undefined, 0],
    ['n1', 0, undefined, 1],
    ['n2', 0, undefined, 2],
    ['n3', 1, 'n2', 0],
    ['n4', 1, 'n2', 1],
    ['n5', 0, undefined, 3],
  ])
})

test('flatten follows nesting several levels deep', async () => {
  const project = parsed(
    JSON.stringify({
      ...base,
      nodes: [
        { id: 'n9', type: 'start', name: 'start' },
        {
          id: 'n1',
          type: 'loop',
          name: 'outer',
          children: [
            { id: 'n2', type: 'parallel', name: 'inner', children: [{ id: 'n3', type: 'agent', name: 'leaf' }] },
            { id: 'n4', type: 'code', name: 'tally' },
          ],
        },
        { id: 'n5', type: 'agent', name: 'last' },
      ],
    }),
  )

  expect(flatten(project).map(row => `${row.node.id}@${row.depth}<${row.parentId ?? 'top'}`)).toEqual(['n9@0<top', 'n1@0<top', 'n2@1<n1', 'n3@2<n2', 'n4@1<n1', 'n5@0<top'])
})

test('walk visits depth-first with the parent, and findNode reaches nested nodes', async () => {
  const project = review()
  const seen: string[] = []
  walk(project, (node, info) => {
    seen.push(`${node.id}:${info.parent?.id ?? '-'}:${info.depth}:${info.index}`)
  })

  expect(seen).toEqual(['n6:-:0:0', 'n1:-:0:1', 'n2:-:0:2', 'n3:n2:1:0', 'n4:n2:1:1', 'n5:-:0:3'])
  expect(findNode(project, 'n4')).toMatchObject({ type: 'agent', kind: 'verify' })
  expect(findNode(project, 'n99')).toBeUndefined()
})
