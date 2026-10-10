import { expect, test } from 'claude-code/testing'

import type { Design } from '../src/design/model'
import { review } from '../src/design/templates'
import { UNMAPPED_ID, dropTarget, layoutBoard } from '../src/ui/board-layout'
import type { BoardLayout } from '../src/ui/board-layout'
import { CONFIRM_LABEL, EMPTY_HINT, NOT_RUN, WAITING, affordances, cardRuns, paintBoard, paintText, paintWeight } from '../src/ui/board-paint'
import type { PaintOptions, RunOverlay, Span } from '../src/ui/board-paint'
import { SPINNER } from '../src/ui/rail'

const design = review()
const H = layoutBoard(design, { orientation: 'horizontal' })
const V = layoutBoard(design, { orientation: 'vertical' })

const paint = (layout: BoardLayout, more: Partial<PaintOptions> = {}): Span[][] => paintBoard(layout, { columns: layout.width, rows: layout.height, panX: 0, panY: 0, selectedId: null, ...more })
const text = (layout: BoardLayout, more: Partial<PaintOptions> = {}): string[] => paintText(paint(layout, more))
const spans = (lines: Span[][], needle: string): Span[] => lines.flat().filter(span => span.text.includes(needle))
const card = (layout: BoardLayout, id: string) => {
  const found = layout.cards.find(one => one.id === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}

test('the review template, left to right: cards, a box around the pipeline, edges that say how results pass', () => {
  expect(text(H)).toEqual([
    '╭ n1 agent ────╮    ╭ n2 pipeline ×4 · review ───────────────────────╮     ╭ n5 agent ────╮',
    '│ scout diff   │ ─▶ │ ╭ n3 agent ────╮    ╭ n4 verify ×3 ──────╮     │▒ ═▶ │ synthesize   │ +',
    '│ low          │ +  │ │ review       │ ─▶ │ adversarial verify │▒ +  │▒ +  │ Write one r… │',
    '╰──────────────╯    │ │ Review the … │ +  │ 3 votes            │▒    │▒    ╰──────────────╯',
    '                    │ ╰──────────────╯    ╰────────────────────╯▒    │▒',
    '                    ╰ ×4 dimensions ─────────────────────────────────╯▒',
  ])
})

test('the same design, top to bottom', () => {
  expect(text(V)).toEqual([
    '╭ n1 agent ────╮',
    '│ scout diff   │',
    '│ low          │',
    '╰──────────────╯',
    '  │   +',
    '  ▼',
    '╭ n2 pipeline ×4 · review ╮',
    '│ ╭ n3 agent ────╮        │▒',
    '│ │ review       │        │▒',
    '│ │ Review the … │        │▒',
    '│ ╰──────────────╯        │▒',
    '│   │   +                 │▒',
    '│   ▼                     │▒',
    '│ ╭ n4 verify ×3 ──────╮  │▒',
    '│ │ adversarial verify │▒ │▒',
    '│ │ 3 votes            │▒ │▒',
    '│ ╰────────────────────╯▒ │▒',
    '│  +                      │▒',
    '╰ ×4 dimensions ──────────╯▒',
    '  ║   +',
    '  ▼',
    '╭ n5 agent ────╮',
    '│ synthesize   │',
    '│ Write one r… │',
    '╰──────────────╯',
    ' +',
  ])
})

test('every row is exactly as wide as asked at most, and there are exactly as many rows', () => {
  for (const [columns, rows] of [[40, 4], [94, 6], [200, 12], [1, 1]] as const) {
    const lines = paint(H, { columns, rows })
    expect(lines).toHaveLength(rows)
    for (const line of lines) expect([...line.map(span => span.text).join('')].length).toBeLessThanOrEqual(columns)
  }
})

test('the window pans over a board larger than it: cards are cut at its edges, never wrapped', () => {
  const n5 = card(H, 'n5')
  const lines = text(H, { columns: 20, rows: 4, panX: n5.x - 2, panY: 0 })
  expect(lines[0]).toBe('  ╭ n5 agent ────╮')
  expect(lines[1]).toBe('▶ │ synthesize   │ +')
  expect(text(H, { columns: 10, rows: 2, panX: 0, panY: 4 })).toEqual(['', ''])
  expect(text(H, { columns: 30, rows: 2, panX: 20, panY: 4 })).toEqual(['│ ╰──────────────╯    ╰───────', '╰ ×4 dimensions ──────────────'])
})

test('each type has its own border colour; the selected card has a heavy border in claude and edit/del on it', () => {
  const plain = paint(H)
  expect(spans(plain, '╭ n1 agent')[0]?.color ?? spans(plain, '╭')[0]?.color).toBe('text')
  expect(spans(plain, 'n2 pipeline')[0]?.color).toBe('suggestion')
  expect(spans(plain, 'n4 verify')[0]?.color).toBe('permission')
  expect(new Set(plain.flat().map(span => span.color)).has('claude')).toBe(false)

  const picked = paint(H, { selectedId: 'n3' })
  expect(paintText(picked).slice(1, 5)).toEqual([
    '│ scout diff   │ ─▶ │ ┏ n3 agent ━━━━┓    ╭ n4 verify ×3 ──────╮     │▒ ═▶ │ synthesize   │ +',
    '│ low          │ +  │ ┃ review       ┃ ─▶ │ adversarial verify │▒ +  │▒ +  │ Write one r… │',
    '│ low          │ +  │ ┃ Review the … ┃ +  │ 3 votes            │▒    │▒    ╰──────────────╯'.replace('│ low          │ +', '╰──────────────╯  '),
    '                    │ ┗━ edit ━ del ━┛    ╰────────────────────╯▒    │▒',
  ])
  expect(spans(picked, 'n3 agent')[0]).toMatchObject({ color: 'claude', bold: true })
  expect(spans(picked, ' edit ')[0]).toMatchObject({ color: 'claude', hover: 'conductor-edit' })
  expect(spans(picked, ' del ')[0]).toMatchObject({ color: 'claude', hover: 'conductor-remove' })
  // The words are where a press is read: both sit on the bottom border.
  const n3 = card(H, 'n3')
  expect(affordances(n3)).toEqual([
    { kind: 'edit', x: n3.x + 2, y: n3.y + 3, w: 6, label: ' edit ' },
    { kind: 'remove', x: n3.x + 9, y: n3.y + 3, w: 5, label: ' del ' },
  ])
  // Locked, or nothing selected: no words.
  expect(paintText(paint(H, { selectedId: 'n3', locked: true })).join('\n')).not.toMatch(/edit|del/)
})

test('a container asked to confirm says so on its border, in error', () => {
  const asked = paint(H, { selectedId: 'n2', confirmId: 'n2' })
  expect(paintText(asked)[5]).toMatch(/^ +┗ ×4 dimensions ━+ edit ━ delete all\? ━┛▒$/)
  expect(spans(asked, CONFIRM_LABEL.trim())[0]).toMatchObject({ color: 'error', bold: true })
  expect(affordances(card(H, 'n2'), true).find(one => one.kind === 'remove')?.label).toBe(CONFIRM_LABEL)
})

test('lint marks, the open picker slot and the grabbed card', () => {
  const marked = paint(H, { lints: new Set(['n1', 'n2']) })
  expect(paintText(marked)[0]).toBe('╭ n1 agent ──▲─╮    ╭ n2 pipeline ×4 · review ─────────────────────▲─╮     ╭ n5 agent ────╮')
  expect(spans(marked, '▲').map(span => span.color)).toEqual(['warning', 'warning'])

  const slots = paint(H).flat().filter(span => span.text === ' + ')
  expect(slots).toHaveLength(5)
  expect(new Set(slots.map(span => span.hover)).size).toBe(5)
  expect(slots.every(span => span.color === 'subtle' && span.hover?.startsWith('conductor-slot-'))).toBe(true)
  const open = paint(H, { pickerAt: { parentId: 'n2', index: 1 } }).flat().filter(span => span.text === ' + ' && span.inverse)
  expect(open).toEqual([{ text: ' + ', color: 'claude', bold: true, inverse: true }])
  // Locked: no slots at all, the edges stay.
  const locked = paintText(paint(H, { locked: true })).join('\n')
  expect(locked).not.toMatch(/\+/)
  expect(locked).toMatch(/─▶/)

  const grabbed = paint(H, { selectedId: 'n5', grabbedId: 'n5' })
  expect(spans(grabbed, 'n5 agent')[0]).toMatchObject({ color: 'claude', bold: true, inverse: true })
  expect(paintText(grabbed)[0]).toMatch(/┏ n5 agent ━━━━┓$/)
})

test('an empty design is one + and a word of what it is for', () => {
  const blank: Design = { version: 1, name: 'd', description: '', nodes: [] }
  const layout = layoutBoard(blank, { orientation: 'horizontal' })
  expect(text(layout, { columns: 40, rows: 1 })).toEqual([` +  ${EMPTY_HINT}`])
})

const RUN: RunOverlay = {
  status: 'running',
  byNode: {
    n1: { total: 3, running: 0, done: 3, failed: 0, tokens: 27_700 },
    n3: { total: 3, running: 1, done: 1, failed: 1, tokens: 4_900 },
    n4: { total: 1, running: 1, done: 0, failed: 0, tokens: 0 },
  },
  unmapped: { total: 2, running: 1, done: 1, failed: 0, tokens: 700 },
  now: 0,
}

test('a run on the cards: glyph, settled/total, failures and tokens; containers sum what they hold', () => {
  const layout = layoutBoard(design, { orientation: 'horizontal', run: true, unmapped: 2 })
  const runs = cardRuns(layout, RUN)
  expect(runs.get('n1')).toEqual({ glyph: '✓', color: 'success', text: '3/3 27.7k', reached: true })
  expect(runs.get('n3')).toEqual({ glyph: SPINNER[0], color: 'claude', text: '2/3 1✗ 4.9k', reached: true })
  expect(runs.get('n2')).toMatchObject({ glyph: SPINNER[0], color: 'claude', text: '2/4 1✗ 4.9k' })
  expect(runs.get('n5')).toEqual({ glyph: '·', color: 'inactive', text: WAITING, reached: true })
  expect(runs.get(UNMAPPED_ID)).toMatchObject({ text: '1/2 700' })

  const lines = paint(layout, { run: RUN, locked: true })
  const drawn = paintText(lines)
  expect(drawn[2]).toMatch(/^│ ✓ 3\/3 27\.7k +│ +│ │ review +│ ─▶ │ adversarial verify │▒ +│▒ +│ · waiting +│ +│ ⠋ 1\/2 700/)
  expect(drawn[3]).toMatch(/│ ⠋ 2\/3 1✗ 4\.9k +│ +│ ⠋ 0\/1 0 +│▒/)
  expect(drawn[5]).toMatch(/╰ ⠋ 2\/4 1✗ 4\.9k ─+╯▒$/)
  expect(drawn[0]).toMatch(/╭ unmapped ×2 ─+╮$/)
  expect(spans(lines, '✓ 3/3')[0]?.color).toBe('success')
  expect(spans(lines, '2/3 1✗')[0]?.color).toBe('claude')

  // Over: a failure is red, a block that got no agent is dim and says so, a code block says nothing.
  const done: RunOverlay = { ...RUN, status: 'done', byNode: { ...RUN.byNode, n3: { total: 3, running: 0, done: 2, failed: 1, tokens: 5_000 }, n4: { total: 1, running: 0, done: 1, failed: 0, tokens: 10 } } }
  const after = cardRuns(layout, done)
  expect(after.get('n3')).toEqual({ glyph: '✗', color: 'error', text: '3/3 1✗ 5.0k', reached: true })
  expect(after.get('n2')).toMatchObject({ glyph: '✗', color: 'error' })
  expect(after.get('n5')).toEqual({ glyph: '·', color: 'inactive', text: NOT_RUN, reached: false })
  expect(spans(paint(layout, { run: done }), 'n5 agent')[0]?.color).toBe('inactive')
  const coded: Design = { ...design, nodes: [{ id: 'n9', type: 'code', title: 'dedupe' }] }
  expect(cardRuns(layoutBoard(coded, { orientation: 'horizontal', run: true }), done).has('n9')).toBe(false)
})

test('a card in the hand: dashed where it came from, a bar at the slot it would take, its name at the pointer', () => {
  const n1 = card(H, 'n1')
  const n4 = card(H, 'n4')
  const target = dropTarget(H, 'n1', n4.x - 2, n4.y + 1)
  expect(target?.to).toEqual({ parentId: 'n2', index: 1 })
  const lines = paint(H, { selectedId: 'n1', drag: { id: 'n1', target, x: n4.x - 2, y: n4.y + 1 } })
  const drawn = paintText(lines)
  expect(drawn[0]).toMatch(/^╭ n1 agent ╌╌╌╌╮/)
  expect(drawn[1]).toMatch(/^┆ scout diff   ┆/)
  expect(spans(lines, 'n1 agent')[0]).toMatchObject({ color: 'inactive', inverse: true })
  // The bar runs the height of the stages it would stand between.
  const column = (target?.slot.mark?.x ?? 0)
  expect([1, 2, 3, 4].map(row => [...(drawn[row] ?? '')][column])).toEqual(['┃', '┃', '┃', '┃'])
  expect(spans(lines, '┃').every(span => span.color === 'claude')).toBe(true)
  expect(spans(lines, ' n1 scout diff ')[0]).toMatchObject({ inverse: true, color: 'claude' })
  // No slot is offered while a card is held, and none is drawn as a +.
  expect(drawn.join('\n')).not.toMatch(/\+/)
  // Back where it was, or nowhere: no bar.
  const home = paint(H, { drag: { id: 'n1', target: dropTarget(H, 'n1', n1.w + 1, 1), x: n1.w + 1, y: 1 } })
  expect(spans(home, '┃')).toEqual([])
  // Stacked cards take a drop on a row: the bar lies flat.
  expect(paintText(paint(V, { drag: { id: 'n5', target: dropTarget(V, 'n5', 3, 4), x: 3, y: 4 } }))[4]).toMatch(/^━+/)
})

test('sliding cards are drawn where they are passing, without edges or slots until they arrive', () => {
  const lines = text(H, { offsets: { n1: { dx: 3, dy: 1 } } })
  expect(lines[0]).toMatch(/^ {20}╭ n2 pipeline/)
  expect(lines[1]).toMatch(/^ {3}╭ n1 agent ────╮/)
  expect(lines.join('\n')).not.toMatch(/[▶+]/)
})

test('plain paint keeps the shapes and drops the colours: far fewer spans for a board too large to colour', () => {
  const full = paint(H, { selectedId: 'n3' })
  const plain = paint(H, { selectedId: 'n3', plain: true })
  expect(paintText(plain)).toEqual(paintText(full))
  expect(plain.flat().every(span => span.color === undefined && span.hover === undefined)).toBe(true)
  expect(plain.flat().length).toBeLessThan(full.flat().length / 2)
  expect(paintWeight(plain)).toBeLessThan(paintWeight(full))
  expect(paintWeight(full)).toBeLessThan(20_000)
})
