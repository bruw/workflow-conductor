import { expect, test } from 'claude-code/testing'

import { NODE_TYPES, canHoldChildren, emptyDesign, findNode, flatten, parseDesign, serializeDesign, walk } from '../src/design/model'
import type { Design } from '../src/design/model'
import { TEMPLATES, review } from '../src/design/templates'

function parsed(json: string): Design {
  const result = parseDesign(json)
  if (!result.ok) throw new Error(result.error)
  return result.design
}

function rejected(value: unknown): string {
  const result = parseDesign(typeof value === 'string' ? value : JSON.stringify(value))
  if (result.ok) throw new Error('expected the design to be rejected')
  return result.error
}

const base = { version: 1, name: 'demo', description: '' }

test('emptyDesign gives a valid, kebab-named design with no nodes', async () => {
  const design = emptyDesign('My First Flow!')

  expect(design).toEqual({ version: 1, name: 'my-first-flow', description: '', nodes: [] })
  expect(parsed(serializeDesign(design))).toEqual(design)
  expect(emptyDesign('  ').name).toBe('untitled')
})

for (const template of TEMPLATES) {
  test(`template ${template.id} survives a serialize and parse round-trip`, async () => {
    const design = template.make()
    const text = serializeDesign(design)

    expect(parsed(text)).toEqual(design)
    expect(serializeDesign(parsed(text))).toBe(text)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "name": ')
  })
}

test('templates are fresh on each call, have unique ids and only nest under containers', async () => {
  expect(TEMPLATES.map(one => one.id)).toEqual(['review', 'research', 'migrate', 'judge-panel'])

  for (const template of TEMPLATES) {
    const design = template.make()
    expect(template.make()).not.toBe(design)

    const ids = flatten(design).map(row => row.node.id)
    expect(new Set(ids).size).toBe(ids.length)
    walk(design, (node, info) => {
      expect(node.title.length).toBeGreaterThan(0)
      expect((node.notes ?? '').length).toBeGreaterThan(0)
      if (info.parent) expect(canHoldChildren(info.parent.type)).toBe(true)
    })
  }
})

test('serializeDesign writes keys in one order whatever order they were built in', async () => {
  const scrambled = {
    nodes: [{ children: [], knobs: { votes: 2, prompt: 'p' }, notes: 'why', title: 'stage', type: 'pipeline', id: 'n1' }],
    description: 'd',
    name: 'demo',
    version: 1,
  } as unknown as Design

  expect(serializeDesign(scrambled)).toBe(
    [
      '{',
      '  "version": 1,',
      '  "name": "demo",',
      '  "description": "d",',
      '  "nodes": [',
      '    {',
      '      "id": "n1",',
      '      "type": "pipeline",',
      '      "title": "stage",',
      '      "notes": "why",',
      '      "knobs": {',
      '        "prompt": "p",',
      '        "votes": 2',
      '      },',
      '      "children": []',
      '    }',
      '  ]',
      '}',
      '',
    ].join('\n'),
  )
})

test('parseDesign rejects bad input with a reason and never throws', async () => {
  const agent = { id: 'n1', type: 'agent', title: 'a' }

  expect(rejected('{ not json')).toMatch(/JSON/)
  expect(rejected('null')).toMatch(/object/)
  expect(rejected('[]')).toMatch(/object/)
  expect(rejected({ ...base, version: 2, nodes: [] })).toMatch(/version/)
  expect(rejected({ name: 'demo', description: '', nodes: [] })).toMatch(/version/)
  expect(rejected({ ...base, name: 7, nodes: [] })).toMatch(/name/)
  expect(rejected({ ...base })).toMatch(/nodes/)
  expect(rejected({ ...base, nodes: [agent, { ...agent }] })).toMatch(/duplicate id n1/)
  expect(rejected({ ...base, nodes: [{ id: 'n1', type: 'pipeline', title: 'p', children: [agent] }] })).toMatch(/duplicate id n1/)
  expect(rejected({ ...base, nodes: [{ ...agent, type: 'teleport' }] })).toMatch(/unknown type/)
  expect(rejected({ ...base, nodes: [{ ...agent, id: 'first' }] })).toMatch(/id/)
  expect(rejected({ ...base, nodes: [{ type: 'agent' }] })).toMatch(/id/)
  expect(rejected({ ...base, nodes: [{ ...agent, title: 3 }] })).toMatch(/title/)
  expect(rejected({ ...base, nodes: [{ ...agent, knobs: { effort: 'extreme' } }] })).toMatch(/effort/)
  expect(rejected({ ...base, nodes: [{ ...agent, knobs: { votes: 'three' } }] })).toMatch(/votes/)
  expect(rejected({ ...base, nodes: [{ ...agent, children: [{ id: 'n2', type: 'agent', title: 'b' }] }] })).toMatch(/cannot hold children/)
  expect(rejected({ ...base, nextId: 0, nodes: [] })).toMatch(/nextId/)
  expect(rejected('[' .repeat(100000))).toMatch(/JSON|read/)
})

test('parseDesign accepts every node type and drops knobs it does not know', async () => {
  const nodes = NODE_TYPES.map((type, index) => ({ id: `n${index + 1}`, type, title: type }))
  expect(parsed(JSON.stringify({ ...base, nodes })).nodes.map(node => node.type)).toEqual([...NODE_TYPES])

  const design = parsed(JSON.stringify({ ...base, nextId: 9, nodes: [{ id: 'n1', type: 'agent', title: 'a', knobs: { model: 'm', colour: 'red' } }] }))
  expect(design.nextId).toBe(9)
  expect(design.nodes[0]?.knobs).toEqual({ model: 'm' })
})

test('flatten lists rows in display order with depth, parent and index', async () => {
  const rows = flatten(review()).map(row => [row.node.id, row.depth, row.parentId, row.index])

  expect(rows).toEqual([
    ['n1', 0, undefined, 0],
    ['n2', 0, undefined, 1],
    ['n3', 1, 'n2', 0],
    ['n4', 1, 'n2', 1],
    ['n5', 0, undefined, 2],
  ])
})

test('flatten follows nesting several levels deep', async () => {
  const design = parsed(
    JSON.stringify({
      ...base,
      nodes: [
        {
          id: 'n1',
          type: 'loop',
          title: 'outer',
          children: [
            { id: 'n2', type: 'parallel', title: 'inner', children: [{ id: 'n3', type: 'agent', title: 'leaf' }] },
            { id: 'n4', type: 'code', title: 'tally' },
          ],
        },
        { id: 'n5', type: 'agent', title: 'last' },
      ],
    }),
  )

  expect(flatten(design).map(row => `${row.node.id}@${row.depth}<${row.parentId ?? 'top'}`)).toEqual(['n1@0<top', 'n2@1<n1', 'n3@2<n2', 'n4@1<n1', 'n5@0<top'])
})

test('walk visits depth-first with the parent, and findNode reaches nested nodes', async () => {
  const design = review()
  const seen: string[] = []
  walk(design, (node, info) => {
    seen.push(`${node.id}:${info.parent?.id ?? '-'}:${info.depth}:${info.index}`)
  })

  expect(seen).toEqual(['n1:-:0:0', 'n2:-:0:1', 'n3:n2:1:0', 'n4:n2:1:1', 'n5:-:0:2'])
  expect(findNode(design, 'n4')?.type).toBe('verify')
  expect(findNode(design, 'n99')).toBeUndefined()
})
