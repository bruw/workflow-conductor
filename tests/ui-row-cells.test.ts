import { expect, test } from 'claude-code/testing'

import { BAR_MIN_COLUMNS, rowCells } from '../src/ui/canvas-model'
import type { DesignRow, RowCells, RowRun } from '../src/ui/canvas-model'

// How one row fits a width: the bar goes first, then a long badge is cut, then the type
// name gives way, then the title; counts and tokens always end at the last cell.

const RUN: RowRun = { glyph: '✓', color: 'success', counts: '2/2', tokens: '98.1k', bar: '██████', note: '', open: false }
const row = (over: Partial<DesignRow>): DesignRow => ({
  kind: 'node',
  id: 'n2',
  rail: '',
  glyph: '◆',
  title: 'echo the two words back',
  badge: 'until both words were echoed',
  typeName: 'pipeline',
  lint: undefined,
  selected: false,
  grabbed: false,
  depth: 0,
  parentId: undefined,
  index: 0,
  container: true,
  collapsed: false,
  hidden: 0,
  run: RUN,
  ...over,
})
const line = (one: DesignRow, cells: RowCells): string =>
  `${one.rail}${one.glyph} ${cells.name}${cells.badge}${cells.fold}${cells.lint}${cells.type}${cells.note}${cells.bar}${cells.counts}${cells.tokens}`
const at = (one: DesignRow, columns: number): string => line(one, rowCells(one, columns))

test('at 100 columns a row has its bar and type, and the run columns line up whatever the row holds', () => {
  const long = row({})
  const short = row({ id: 'n1', title: 'scout', badge: '', typeName: 'agent', container: false })
  const nested = row({ id: 'n3', rail: '│  ╰ ', title: 'adversarial verify', badge: '×3 votes', typeName: 'adversarial verify' })

  // Only a badge this long is cut even here: the row is at most 85 cells wide.
  expect(at(long, 100)).toBe('◆ n2  echo the two words back  until both words were…  pipeline ██████     2/2  98.1k')
  expect(at(row({ badge: 'until both echoed' }), 100)).toBe('◆ n2  echo the two words back  until both echoed  pipeline      ██████     2/2  98.1k')
  expect(at(short, 100)).toMatch(/^◆ n1 {2}scout +agent +██████ +2\/2 {2}98\.1k$/)
  expect(new Set([long, short, nested].map(one => at(one, 100).length)).size).toBe(1)
  expect(at(long, 100).length).toBeLessThanOrEqual(100)
  // An agent line's tokens end at the same cell.
  const agent = row({ kind: 'agent', id: 'agent:a1', rail: '│  ╰ ', glyph: '✓', title: 'echo alpha', badge: '', typeName: '' })
  expect(at(agent, 100).length).toBe(at(long, 100).length)
  expect(at(agent, 100)).toMatch(/^│ {2}╰ ✓ echo alpha +98\.1k$/)
})

test('at 70 columns the bar is gone, a long badge is cut, and the type gives way before the title', () => {
  expect(BAR_MIN_COLUMNS).toBeGreaterThan(70)
  const long = at(row({}), 70)
  expect(long).not.toMatch(/█/)
  // The badge is cut to keep the type name; the title is whole.
  expect(long).toBe('◆ n2  echo the two words back  until both w…  pipeline     2/2  98.1k')
  expect(long.length).toBeLessThanOrEqual(70)
  // A short badge (a count) is never cut: the type gives way to it.
  const count = at(row({ rail: '│  ╰ ', title: 'adversarial verify pass', badge: '×3 votes', typeName: 'adversarial verify' }), 70)
  expect(count).toMatch(/^│ {2}╰ ◆ n2 {2}adversarial verify pass {2}×3 votes {2}adv\w+… +2\/2 {2}98\.1k$/)
  // A row with room keeps badge and type whole.
  expect(at(row({ title: 'review', badge: '×4' }), 70)).toMatch(/^◆ n2 {2}review {2}×4 +pipeline +2\/2 {2}98\.1k$/)
  expect(new Set([long, count, at(row({ title: 'review', badge: '×4' }), 70)].map(one => one.length)).size).toBe(1)
})

test('at 50 columns the type name is dropped and the title is cut last; counts and tokens stay', () => {
  const long = at(row({}), 50)
  // No room for title, long badge and type: the badge and the type go, the title is whole.
  expect(long).toBe('◆ n2  echo the two words back           2/2  98.1k')
  // A count stays beside a title that has to be cut.
  expect(at(row({ title: 'echo the two words back to the caller', badge: '×4' }), 50)).toBe('◆ n2  echo the two words back…  ×4      2/2  98.1k')
  expect(long.length).toBe(50)
  expect(long).not.toMatch(/pipeline/)

  // The capture that showed the problem: title with its own count, type pushed off.
  const seen = at(row({ title: 'echo ×2', badge: '' }), 50)
  expect(seen).toMatch(/^◆ n2 {2}echo ×2 +pipeline +2\/2 {2}98\.1k$/)
  expect(seen.length).toBe(50)
  // A long badge goes before the title is cut; the title takes what there is.
  const deep = at(row({ rail: '│  │  │  ╰ ', title: 'a very long title that cannot fit here', badge: 'until it fits' }), 50)
  expect(deep).toBe('│  │  │  ╰ ◆ n2  a very long titl…      2/2  98.1k')
  // A node the run never reached keeps its note in view.
  const idle = at(row({ run: { ...RUN, counts: '', tokens: '', bar: '', note: '· not run' } }), 50)
  expect(idle).toMatch(/· not run$/)
  expect(idle.length).toBeLessThanOrEqual(50)
})

test('without a run a row degrades the same way: badge, then type, then title', () => {
  const plain = row({ run: undefined })
  expect(at(plain, 100)).toBe('◆ n2  echo the two words back  until both words were echoed  pipeline')
  expect(at(plain, 50)).toBe('◆ n2  echo the two words back  until both …')
  expect(at(plain, 30)).toBe('◆ n2  echo the two words back')
  expect(at(plain, 24)).toBe('◆ n2  echo the two word…')
  expect(at(row({ run: undefined, collapsed: true, hidden: 3, lint: 'why', title: 'review', badge: '×4' }), 100)).toMatch(/^◆ n2 {2}review {2}×4 \[\+3\] . +pipeline$/)
})
