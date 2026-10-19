import { expect, test } from 'claude-code/testing'

import { applyOps, callLine, editReport, readReport, resultLine } from '../src/project/chat'
import type { Edit } from '../src/project/chat'
import { lint } from '../src/project/lints'
import { flatten } from '../src/project/model'
import { review } from '../src/project/templates'

function edited(edit: Edit): Extract<Edit, { ok: true }> {
  if (!edit.ok) throw new Error(edit.error)
  return edit
}

const READ_STATE = { open: true, selectedId: null, locked: false, revision: 3 }

test('a call line says the action and the project, and an apply its op count', () => {
  const write = callLine({ action: 'write', name: 'prep-revamp', nodes: [{ type: 'agent', name: 'a' }, { type: 'pipeline', name: 'p', children: [{ type: 'agent', name: 'b' }] }] })
  const apply = callLine({ action: 'apply', name: 'prep-revamp', ops: [{ op: 'remove', id: 'n2' }, { op: 'remove', id: 'n3' }, { op: 'remove', id: 'n4' }] })
  const read = callLine({ action: 'read', name: 'prep-revamp' })
  expect(new Set([write, apply, read]).size).toBe(3)
  for (const line of [write, apply, read]) expect(line).toContain('prep-revamp')
  expect(apply).toContain('3')
  expect(write).toContain('3')
})

test('a call line is one line whatever the input', () => {
  for (const input of [undefined, null, 'write', [], { action: 42 }, { action: 'apply', name: 'a\nb', ops: 'x' }]) {
    const line = callLine(input)
    expect(line.length).toBeGreaterThan(0)
    expect(line).not.toContain('\n')
  }
})

test("an edit's result line names what changed and counts the problems", () => {
  const before = review()
  const first = flatten(before)[1]?.node.id ?? ''
  const edit = edited(applyOps(before, [{ op: 'add', type: 'agent', name: 'new' }, { op: 'update', id: first, name: 'renamed' }]))
  const line = resultLine(editReport(edit.project, edit, 4), false)
  for (const id of [...edit.added, ...edit.changed]) expect(line).toContain(id)
  expect(line).not.toContain('\n')
  const problems = lint(edit.project).length
  expect(problems).toBeGreaterThan(0)
  expect(line).toContain(String(problems))
})

test('a result line tells a project with problems from one with none', () => {
  const clean = review()
  const messy = edited(applyOps(clean, [{ op: 'add', type: 'agent', name: 'empty' }])).project
  expect(lint(clean).length).toBe(0)
  expect(lint(messy).length).toBeGreaterThan(0)
  const same = { added: [], changed: [], removed: [] }
  expect(resultLine(editReport(clean, same), false)).not.toBe(resultLine(editReport(messy, same), false))
})

test("a read's result line counts the blocks and differs from an edit's", () => {
  const project = review()
  const read = resultLine(readReport(project, READ_STATE), false)
  expect(read).toContain(String(flatten(project).length))
  expect(read).not.toContain('\n')
  expect(read).not.toBe(resultLine(editReport(project, { added: [], changed: [], removed: [] }), false))
})

test("a failed call's line carries its reason on one line", () => {
  const refused = applyOps(review(), [{ op: 'remove', id: 'n99' }])
  if (refused.ok) throw new Error('expected a refusal')
  const line = resultLine(`Error: ${refused.error}`, true)
  expect(line).toContain('n99')
  expect(line).not.toContain('\n')
  expect(resultLine('first reason\nmore detail', true)).not.toContain('\n')
})

test('a text no report wrote gives a line of its own', () => {
  const line = resultLine('something else\nentirely', false)
  expect(line.length).toBeGreaterThan(0)
  expect(line).not.toContain('\n')
})
