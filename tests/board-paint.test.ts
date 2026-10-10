import { expect, test } from 'claude-code/testing'

import type { Design } from '../src/design/model'
import { NODE_TYPES } from '../src/design/model'
import { research, review } from '../src/design/templates'
import { EMPTY_HINT, UNMAPPED_ID, dropTarget, layoutBoard } from '../src/ui/board-layout'
import type { BoardLayout } from '../src/ui/board-layout'
import { CONFIRM_LABEL, NOT_RUN, WAITING, affordances, cardRuns, edgeMarks, paintBoard, paintText, paintWeight, stickyCards } from '../src/ui/board-paint'
import type { PaintOptions, RunOverlay, Span } from '../src/ui/board-paint'
import { SPINNER } from '../src/ui/rail'
import { ACCENT } from '../src/ui/theme'

const design = review()
const H = layoutBoard(design, { orientation: 'horizontal' })
const V = layoutBoard(design, { orientation: 'vertical', width: 46 })

const paint = (layout: BoardLayout, more: Partial<PaintOptions> = {}): Span[][] => paintBoard(layout, { columns: layout.width, rows: layout.height, panX: 0, panY: 0, selectedId: null, ...more })
const text = (layout: BoardLayout, more: Partial<PaintOptions> = {}): string[] => paintText(paint(layout, more))
const spans = (lines: Span[][], needle: string): Span[] => lines.flat().filter(span => span.text.includes(needle))
const card = (layout: BoardLayout, id: string) => {
  const found = layout.cards.find(one => one.id === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}

test('the review template, left to right: cards, a box around the pipeline, edges that say how results pass', () => {
  // With nothing selected the only + is the end of the top level. A fan-out is borders stacked under the box, not a shade column.
  expect(text(H)).toEqual([
    '╭ n1 agent ────╮    ╭ n2 pipeline ×4 · review · each: dimensions ───╮    ╭ n5 agent ────╮',
    '│ scout diff   │ ─▶ │ ╭ n3 agent ────╮    ╭ n4 verify ×3 ──────╮    │ ═▶ │ synthesize   │ +',
    '│ Cheap and…   │    │ │ review       │ ─▶ │ adversarial verify │    │    │ Runs once…   │',
    '╰ low ─────────╯    │ │ One reviewe… │    │ Each skeptic trie… │    │    ╰──────────────╯',
    '                    │ ╰──────────────╯    ╰ 3 votes ───────────╯    │',
    '                    │                      ╰──────────────────╯     │',
    '                    │                       ╰────────────────╯      │',
    '                    ╰───────────────────────────────────────────────╯',
    '                     ╰─────────────────────────────────────────────╯',
    '                      ╰───────────────────────────────────────────╯',
  ])
  expect(text(H).join('\n')).not.toMatch(/▒/)
})

test('the same design, top to bottom: cards as wide as the board, one row for each connector', () => {
  expect(text(V)).toEqual([
    '╭── n1 agent ────────────────────────────────╮',
    '│ scout diff                                 │',
    '│ Cheap and mechanical. Its list of          │',
    '│ dimensions is the work-list for the…       │',
    '╰ low ───────────────────────────────────────╯',
    '  │',
    '╭─▼ n2 pipeline ×4 · review · each: dimensi… ╮',
    '│ ╭── n3 agent ────────────────────────────╮ │',
    '│ │ review                                 │ │',
    '│ │ One reviewer per dimension.            │ │',
    '│ ╰────────────────────────────────────────╯ │',
    '│   │                                        │',
    '│ ╭─▼ n4 verify ×3 ────────────────────────╮ │',
    '│ │ adversarial verify                     │ │',
    '│ │ Each skeptic tries to refute a finding │ │',
    '│ │ and defaults to refuted when unsure.…  │ │',
    '│ ╰ 3 votes ───────────────────────────────╯ │',
    '│  ╰──────────────────────────────────────╯  │',
    '│   ╰────────────────────────────────────╯   │',
    '╰────────────────────────────────────────────╯',
    ' ╰──────────────────────────────────────────╯',
    '  ╰────────────────────────────────────────╯',
    '  ║',
    '╭─▼ n5 agent ────────────────────────────────╮',
    '│ synthesize                                 │',
    '│ Runs once over all surviving findings:     │',
    '│ merge duplicates, order by severity, say…  │',
    '╰────────────────────────────────────────────╯',
    ' + add block',
  ])
})

test('connectors top to bottom: one row, │ for a hand-off and ║ for a barrier, the head on the next card’s top border', () => {
  const lines = paint(V)
  const drawn = paintText(lines)
  for (const edge of V.edges) {
    const to = card(V, edge.to)
    const from = card(V, edge.from)
    // The row between the two cards (under the stacked borders of a fan-out), and nothing else between them.
    expect(edge.y).toBe(to.y - 1)
    expect(edge.y).toBe(from.y + from.h + from.stack)
    expect([...(drawn[edge.y] ?? '')][edge.x]).toBe(edge.kind === 'barrier' ? '║' : '│')
    expect([...(drawn[to.y] ?? '')][edge.x]).toBe('▼')
    expect(edge.x).toBe(to.x + 2)
  }
  expect(V.edges.map(edge => edge.kind)).toEqual(['stream', 'stream', 'barrier'])
  // A barrier is bold, a hand-off quiet.
  expect(spans(lines, '║')[0]).toEqual({ text: '║', bold: true })
  expect(spans(lines, '▼').map(span => span.color)).toEqual(['subtle', 'subtle', undefined])
  // No row of the chain is blank.
  expect(drawn.every(line => line.trim() !== '')).toBe(true)
  // Left to right the two-cell arrows stay.
  expect(text(H)[1]).toMatch(/│ ─▶ │.*│ ═▶ │/)
})

test('the selected card: a heavy border in its type’s colour, a bold title, all its notes, its knobs; + around it', () => {
  const layout = layoutBoard(design, { orientation: 'vertical', width: 46, selectedId: 'n4', noteRows: 4 })
  const lines = paint(layout, { selectedId: 'n4' })
  expect(paintText(lines).slice(11, 23)).toEqual([
    '│   │  +                                     │',
    '│ ┏━▼ n4 verify ×3 ━━━━━━━━━━━━━━━━━━━━━━━━┓ │',
    '│ ┃ adversarial verify                     ┃ │',
    '│ ┃ Each skeptic tries to refute a finding ┃ │',
    '│ ┃ and defaults to refuted when unsure.   ┃ │',
    '│ ┃ Keep a finding only if at least 2 of 3 ┃ │',
    '│ ┃ fail to refute it.                     ┃ │',
    '│ ┃ 3 votes · out: { refuted: boolean, re… ┃ │',
    '│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━ edit ━ del ━┛ │',
    '│  ╰──────────────────────────────────────╯  │',
    '│   ╰────────────────────────────────────╯   │',
    '╰─ + ────────────────────────────────────────╯',
  ])
  // Shape, not hue: the border and the header keep verify's colour, bold; the title is bold; the notes are plain text, the knobs quiet.
  expect(spans(lines, 'n4 verify')[0]).toMatchObject({ color: ACCENT.verify, bold: true })
  expect(spans(lines, 'n4 verify')[0]?.inverse).toBe(undefined)
  expect(spans(lines, '┏')[0]).toMatchObject({ color: ACCENT.verify, bold: true })
  expect(spans(lines, 'adversarial verify')[0]).toEqual({ text: 'adversarial verify', bold: true })
  expect(spans(lines, 'Keep a finding')[0]).toEqual({ text: ' Keep a finding only if at least 2 of 3 ' })
  expect(spans(lines, '3 votes · out')[0]?.color).toBe('subtle')
  // A card that is not selected: a plain title, quiet notes.
  expect(spans(lines, 'One reviewer')[0]?.color).toBe('subtle')
  expect(Object.keys(spans(lines, 'scout diff')[0] ?? {})).toEqual(['text'])
  // The only claude on the board is what can be pressed on the selected card.
  expect(lines.flat().filter(span => span.color === 'claude').map(span => span.text)).toEqual([' edit ', ' del '])
  expect(spans(lines, ' edit ')[0]).toMatchObject({ hover: 'conductor-edit' })
  expect(spans(lines, ' del ')[0]).toMatchObject({ hover: 'conductor-remove' })
  // The words are where a press is read: both sit on the bottom border.
  const n4 = card(layout, 'n4')
  expect(affordances(n4)).toEqual([
    { kind: 'edit', x: n4.x + n4.w - 14, y: n4.y + n4.h - 1, w: 6, label: ' edit ' },
    { kind: 'remove', x: n4.x + n4.w - 7, y: n4.y + n4.h - 1, w: 5, label: ' del ' },
  ])
  // Locked: no words, no +.
  expect(paintText(paint(layout, { selectedId: 'n4', locked: true })).join('\n')).not.toMatch(/edit|del |\+/)

  // Notes past the cap end in a count of the lines left.
  const long = layoutBoard({ ...design, nodes: [{ id: 'n1', type: 'critic', title: 'gaps', notes: 'word '.repeat(60) }] }, { orientation: 'vertical', width: 30, selectedId: 'n1', noteRows: 3 })
  expect(text(long, { selectedId: 'n1' }).slice(0, 6)).toEqual([
    '┏━━ n1 critic ━━━━━━━━━━━━━━━┓',
    '┃ gaps                       ┃',
    '┃ word word word word word   ┃',
    '┃ word word word word word   ┃',
    '┃ … 10 more lines            ┃',
    '┗━━━━━━━━━━━━━━━ edit ━ del ━┛',
  ])
})

test('no type is dim and none shares the hue of what can be pressed; selection does not change a hue', () => {
  const all: Design = { version: 1, name: 'd', description: '', nodes: NODE_TYPES.map((type, i) => ({ id: `n${i + 1}`, type, title: type })) }
  for (const orientation of ['horizontal', 'vertical'] as const) {
    const layout = layoutBoard(all, { orientation })
    const lines = paint(layout)
    for (const [i, type] of NODE_TYPES.entries()) {
      const header = spans(lines, ` n${i + 1} ${type} `)[0]
      expect(header?.color).toBe(ACCENT[type])
      expect(['inactive', 'subtle', 'claude', 'success', 'error', 'warning']).not.toContain(header?.color)
    }
    const picked = paint(layoutBoard(all, { orientation, selectedId: 'n7' }), { selectedId: 'n7' })
    expect(spans(picked, ' n7 code ')[0]).toMatchObject({ color: ACCENT.code, bold: true })
  }
  expect(ACCENT.code).toBe('ide')
})

test('+ slots: drawn around the selection and at the ends that matter; the rest under the pointer, or for the picker', () => {
  const plus = (lines: Span[][]) => lines.flat().filter(span => span.text.trim().startsWith('+'))
  for (const layout of [H, V]) {
    expect(plus(paint(layout))).toHaveLength(1)
    expect(plus(paint(layout, { selectedId: 'n3' }))).toHaveLength(3)
    expect(plus(paint(layout, { selectedId: 'n1' }))).toHaveLength(2)
    const shown = plus(paint(layout, { selectedId: 'n2' }))
    expect(shown).toHaveLength(4)
    expect(new Set(shown.map(span => span.hover)).size).toBe(4)
    expect(shown.every(span => span.color === 'subtle' && span.hover?.startsWith('conductor-slot-'))).toBe(true)
    // The pointer over a hidden slot shows it, lit; the open picker's slot is inverse.
    const hovered = plus(paint(layout, { hoverAt: { parentId: 'n2', index: 1 } }))
    expect(hovered).toHaveLength(2)
    expect(hovered.find(span => span.hover === 'conductor-slot-n2-1')).toMatchObject({ text: ' + ', color: 'claude', bold: true })
    const open = plus(paint(layout, { pickerAt: { parentId: 'n2', index: 1 } })).filter(span => span.inverse)
    expect(open).toEqual([{ text: ' + ', color: 'claude', bold: true, inverse: true }])
    // Locked: no slots at all, the edges stay.
    const locked = paintText(paint(layout, { locked: true, selectedId: 'n3' })).join('\n')
    expect(locked).not.toMatch(/\+/)
    expect(locked).toMatch(layout === H ? /─▶/ : /║/)
  }
  // Top to bottom a + stands at one place for its level: three cells right of the connector between cards, on the bottom border of the box it adds to.
  const drawn = text(V, { selectedId: 'n3' })
  expect(drawn[11]).toBe('│   │  +                                     │')
  expect(drawn[19]).toBe('╰─ + ────────────────────────────────────────╯')
  expect(drawn[5]).toBe('  │')
  expect(drawn.at(-1)).toBe(' + add block')
})

test('an empty container is a whole box with one wide slot in it; an empty design is one slot that says so', () => {
  const hollow: Design = {
    version: 1,
    name: 'd',
    description: '',
    nodes: [
      { id: 'n1', type: 'sweep', title: 'angles', knobs: { fanout: '4 search angles' }, children: [] },
      { id: 'n2', type: 'pipeline', title: 'pipeline', children: [] },
    ],
  }
  const v = layoutBoard(hollow, { orientation: 'vertical', width: 40 })
  expect(text(v)).toEqual([
    '╭── n1 sweep ×4 · angles · each: sear… ╮',
    '│  + add first block                   │',
    '╰──────────────────────────────────────╯',
    ' ╰────────────────────────────────────╯',
    '  ╰──────────────────────────────────╯',
    '  ║',
    '╭─▼ n2 pipeline ───────────────────────╮',
    '│  + add first block                   │',
    '╰──────────────────────────────────────╯',
    ' + add block',
  ])
  expect(spans(paint(v), '+ add first block').map(span => span.hover)).toEqual(['conductor-slot-n1-0', 'conductor-slot-n2-0'])
  expect(text(layoutBoard(hollow, { orientation: 'horizontal' }))).toEqual([
    '╭ n1 sweep ×4 · angles ╮    ╭ n2 pipeline ───────╮',
    '│  + add first block   │ ═▶ │  + add first block │ +',
    '╰──────────────────────╯    ╰────────────────────╯',
    ' ╰────────────────────╯',
    '  ╰──────────────────╯',
  ])
  const blank: Design = { version: 1, name: 'd', description: '', nodes: [] }
  expect(text(layoutBoard(blank, { orientation: 'horizontal' }), { columns: 40, rows: 1 })).toEqual([` ${EMPTY_HINT}`])
  expect(text(layoutBoard(blank, { orientation: 'vertical', width: 40 }), { columns: 40, rows: 1 })).toEqual([` ${EMPTY_HINT}`])
})

test('stacked borders: one more for two, two for more; a container’s sit under its box', () => {
  const fans: Design = {
    version: 1,
    name: 'd',
    description: '',
    nodes: [
      { id: 'n1', type: 'verify', title: 'two', knobs: { votes: 2 } },
      { id: 'n2', type: 'verify', title: 'nine', knobs: { votes: 9 } },
    ],
  }
  expect(text(layoutBoard(fans, { orientation: 'vertical', width: 24 }))).toEqual([
    '╭── n1 verify ×2 ──────╮',
    '│ two                  │',
    '╰ 2 votes ─────────────╯',
    ' ╰────────────────────╯',
    '  ║',
    '╭─▼ n2 verify ×9 ──────╮',
    '│ nine                 │',
    '╰ 9 votes ─────────────╯',
    ' ╰────────────────────╯',
    '  ╰──────────────────╯',
    ' + add block',
  ])
  const lines = paint(layoutBoard(fans, { orientation: 'vertical', width: 24 }))
  expect(spans(lines, ' ╰')[0] ?? spans(lines, '╰────────────────────╯')[0]).toMatchObject({ color: ACCENT.verify })
})

test('compact: one row a card, the selected one in full, containers boxed', () => {
  const layout = layoutBoard(design, { orientation: 'vertical', width: 46, compact: true, selectedId: 'n1' })
  const lines = paint(layout, { selectedId: 'n1' })
  expect(paintText(lines)).toEqual([
    '┏━━ n1 agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
    '┃ scout diff                                 ┃',
    '┃ Cheap and mechanical. Its list of          ┃',
    '┃ dimensions is the work-list for the        ┃',
    '┃ pipeline.                                  ┃',
    '┃ low · out: { dimensions: [{ name, focus, … ┃',
    '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ edit ━ del ━┛',
    '  │  +',
    '╭─▼ n2 pipeline ×4 · review · each: dimensi… ╮',
    '│ ╶── n3 agent · review ───────────────────╴ │',
    '│   │                                        │',
    '│ ╶─▼ n4 verify ×3 · adversarial verify ───╴ │',
    '╰────────────────────────────────────────────╯',
    ' ╰──────────────────────────────────────────╯',
    '  ╰────────────────────────────────────────╯',
    '  ║',
    '╶─▼ n5 agent · synthesize ───────────────────╴',
    ' + add block',
  ])
  // The id and type keep the type's colour; the title is plain text.
  expect(spans(lines, ' n4 verify ×3')[0]?.color).toBe(ACCENT.verify)
  expect(spans(lines, '· adversarial verify')[0]?.color).toBe(undefined)
  // A whole template on one screen.
  const big = layoutBoard(research(), { orientation: 'vertical', width: 80, compact: true })
  expect(big.height).toBeLessThan(layoutBoard(research(), { orientation: 'vertical', width: 80 }).height / 2)
})

test('every row is exactly as wide as asked at most, and there are exactly as many rows', () => {
  for (const layout of [H, V]) {
    for (const [columns, rows] of [[40, 4], [94, 6], [200, 12], [1, 1]] as const) {
      const lines = paint(layout, { columns, rows, panY: 2 })
      expect(lines).toHaveLength(rows)
      for (const line of lines) expect([...line.map(span => span.text).join('')].length).toBeLessThanOrEqual(columns)
    }
  }
})

test('past the window: dim words on the edge say how many blocks are there', () => {
  // Scrolled into the top level: the first row says what is above, the last what is below.
  expect(text(V, { panY: 3, rows: 6 })).toEqual([
    ' ▲ more above',
    '╰ low ───────────────────────────────────────╯',
    '  │',
    '╭─▼ n2 pipeline ×4 · review · each: dimensi… ╮',
    '│ ╭── n3 agent ────────────────────────────╮ │',
    ' ▼ 2 more below',
  ])
  expect(edgeMarks(V, { columns: 46, rows: 6, panX: 0, panY: 3 })).toEqual({ above: '▲ more above', below: '▼ 2 more below', left: false, right: false })
  expect(edgeMarks(V, { columns: 46, rows: 6, panX: 0, panY: 6 })).toMatchObject({ above: '▲ 1 more above' })
  expect(edgeMarks(V, { columns: 46, rows: V.height, panX: 0, panY: 0 })).toEqual({ above: '', below: '', left: false, right: false })
  const marks = paint(V, { panY: 3, rows: 6 })
  expect(spans(marks, 'more above')[0]?.color).toBe('subtle')
  expect(spans(marks, 'more below')[0]?.color).toBe('subtle')
  // At the top nothing is said above; the whole board in view says nothing at all.
  expect(text(V, { rows: 6 })[0]).toBe('╭── n1 agent ────────────────────────────────╮')
  expect(text(V).join('\n')).not.toMatch(/more (above|below)/)
  // Sideways: a word at mid-height on the edge the board goes on past.
  const n5 = card(H, 'n5')
  const side = text(H, { columns: 20, rows: 4, panX: n5.x - 2, panY: 0 })
  expect(side[0]).toBe('  ╭ n5 agent ────╮')
  expect(side[2]).toMatch(/^◀/)
  // The mark takes the empty cell of the edge column nearest mid-height, and is left out where every cell is drawn on.
  const gap = text(H, { columns: 18, rows: 4 })
  expect(gap.map(line => [...line][17] ?? ' ')).toEqual([' ', '─', '▶', ' '])
  const full = text(H, { columns: 21, rows: 4 })
  expect(full.slice(0, 3).map(line => [...line][20])).toEqual(['╭', '│', '│'])
  expect(full.join('\n')).not.toMatch(/▶\n|▶$/)
})

test('a container whose header is scrolled off keeps it pinned on the window’s first row', () => {
  // The window starts inside n2: its header is drawn on the first row, in its own place and colour, with what is above.
  const lines = paint(V, { panY: 8, rows: 10 })
  expect(paintText(lines)).toEqual([
    '╭── n2 pipeline ×4 · review  ▲ 1 more above ─╮',
    '│ │ One reviewer per dimension.            │ │',
    '│ ╰────────────────────────────────────────╯ │',
    '│   │                                        │',
    '│ ╭─▼ n4 verify ×3 ────────────────────────╮ │',
    '│ │ adversarial verify                     │ │',
    '│ │ Each skeptic tries to refute a finding │ │',
    '│ │ and defaults to refuted when unsure.…  │ │',
    '│ ╰ 3 votes ───────────────────────────────╯ │',
    ' ▼ 1 more below',
  ])
  expect(spans(lines, 'n2 pipeline')[0]?.color).toBe(ACCENT.pipeline)
  expect(stickyCards(V, 8).map(one => one.id)).toEqual(['n2'])
  // Not while its header is in view, nor once only its bottom border is left.
  const n2 = card(V, 'n2')
  expect(stickyCards(V, n2.y)).toEqual([])
  expect(stickyCards(V, n2.y + 1).map(one => one.id)).toEqual(['n2'])
  expect(stickyCards(V, n2.y + n2.h - 1)).toEqual([])
  // Nested: the innermost container the first row is inside is the one pinned; the outer one's sides still show.
  const nested: Design = {
    version: 1,
    name: 'd',
    description: '',
    nodes: [{ id: 'n1', type: 'pipeline', title: 'outer', children: [{ id: 'n2', type: 'loop', title: 'inner', children: [{ id: 'n3', type: 'agent', title: 'a', notes: 'x' }, { id: 'n4', type: 'agent', title: 'b', notes: 'y' }] }] }],
  }
  const deep = layoutBoard(nested, { orientation: 'vertical', width: 50 })
  expect(stickyCards(deep, 4).map(one => one.id)).toEqual(['n2'])
  expect(text(deep, { panY: 4, rows: 5 })[0]).toBe('│ ╭── n2 loop · inner ────────── ▲ more above ─╮ │')
  expect(stickyCards(deep, 1).map(one => one.id)).toEqual(['n1'])
})

test('a container asked to confirm says so on its border, in error', () => {
  const layout = layoutBoard(design, { orientation: 'horizontal', selectedId: 'n2' })
  const asked = paint(layout, { selectedId: 'n2', confirmId: 'n2' })
  expect(paintText(asked)[8]).toMatch(/^ +┗━+ edit ━ delete all\? ━┛$/)
  expect(spans(asked, CONFIRM_LABEL.trim())[0]).toMatchObject({ color: 'error', bold: true })
  expect(affordances(card(layout, 'n2'), true).find(one => one.kind === 'remove')?.label).toBe(CONFIRM_LABEL)
  // The selected container says its notes above what it holds, and its title is bold.
  expect(paintText(asked)[1]).toMatch(/┃ Each dimension flows through both stages on… +┃/)
  expect(spans(asked, '· review')[0]).toEqual({ text: ' · review', bold: true })
})

test('lint marks and the grabbed card', () => {
  const marked = paint(H, { lints: new Set(['n1', 'n2']) })
  expect(paintText(marked)[0]).toBe('╭ n1 agent ──▲─╮    ╭ n2 pipeline ×4 · review · each: dimensions ─▲─╮    ╭ n5 agent ────╮')
  expect(spans(marked, '▲').map(span => span.color)).toEqual(['warning', 'warning'])

  const layout = layoutBoard(design, { orientation: 'horizontal', selectedId: 'n5' })
  const grabbed = paint(layout, { selectedId: 'n5', grabbedId: 'n5' })
  expect(spans(grabbed, 'n5 agent')[0]).toMatchObject({ color: ACCENT.agent, bold: true, inverse: true })
  expect(paintText(grabbed)[0]).toMatch(/┏ n5 agent ━+┓$/)
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

test('a run on the cards: glyph, settled/total, failures and tokens on the bottom border; containers sum what they hold', () => {
  const layout = layoutBoard(design, { orientation: 'horizontal', run: true, unmapped: 2 })
  const runs = cardRuns(layout, RUN)
  expect(runs.get('n1')).toEqual({ glyph: '✓', color: 'success', text: '3/3 27.7k', reached: true })
  expect(runs.get('n3')).toEqual({ glyph: SPINNER[0], color: 'claude', text: '2/3 1✗ 4.9k', reached: true })
  expect(runs.get('n2')).toMatchObject({ glyph: SPINNER[0], color: 'claude', text: '2/4 1✗ 4.9k' })
  expect(runs.get('n5')).toEqual({ glyph: '·', color: 'inactive', text: WAITING, reached: true })
  expect(runs.get(UNMAPPED_ID)).toMatchObject({ text: '1/2 700' })

  const lines = paint(layout, { run: RUN, locked: true })
  expect(paintText(lines)).toEqual([
    '╭ n1 agent ────────╮    ╭ n2 pipeline ×4 · review · each: dimensions ───────╮    ╭ n5 agent ────────╮    ╭ unmapped ×2 ──────────╮',
    '│ scout diff       │ ─▶ │ ╭ n3 agent ────────╮    ╭ n4 verify ×3 ──────╮    │ ═▶ │ synthesize       │    │ no block claims these │',
    '│ Cheap and…       │    │ │ review           │ ─▶ │ adversarial verify │    │    │ Runs once over…  │    ╰ ⠋ 1/2 700 ────────────╯',
    '╰ ✓ 3/3 27.7k ─────╯    │ │ One reviewer pe… │    │ Each skeptic trie… │    │    ╰ · waiting ───────╯     ╰─────────────────────╯',
    '                        │ ╰ ⠋ 2/3 1✗ 4.9k ───╯    ╰ ⠋ 0/1 0 ───────────╯    │',
    '                        │                          ╰──────────────────╯     │',
    '                        │                           ╰────────────────╯      │',
    '                        ╰ ⠋ 2/4 1✗ 4.9k ────────────────────────────────────╯',
    '                         ╰─────────────────────────────────────────────────╯',
    '                          ╰───────────────────────────────────────────────╯',
  ])
  expect(spans(lines, '✓ 3/3')[0]?.color).toBe('success')
  expect(spans(lines, '2/3 1✗')[0]?.color).toBe('claude')
  // Waiting is not dim: only a block the finished run never reached is.
  expect(spans(lines, 'n5 agent')[0]?.color).toBe(ACCENT.agent)

  // Compact, top to bottom: the count at the right end of each row.
  const rows = layoutBoard(design, { orientation: 'vertical', run: true, unmapped: 2, width: 46, compact: true })
  expect(text(rows, { run: RUN, locked: true })).toEqual([
    '╶── n1 agent · scout diff ───── ✓ 3/3 27.7k ─╴',
    '  │',
    '╭─▼ n2 pipeline ×4 · review · each: dimensi… ╮',
    '│ ╶── n3 agent · review ─── ⠋ 2/3 1✗ 4.9k ─╴ │',
    '│   │                                        │',
    '│ ╶─▼ n4 verify ×3 · adversari… ─ ⠋ 0/1 0 ─╴ │',
    '╰──── ⠋ 2/4 1✗ 4.9k ─────────────────────────╯',
    ' ╰──────────────────────────────────────────╯',
    '  ╰────────────────────────────────────────╯',
    '  ║',
    '╶─▼ n5 agent · synthesize ─────── · waiting ─╴',
    '',
    '╭── unmapped ×2 ─────────────────────────────╮',
    '│ no block claims these                      │',
    '╰ ⠋ 1/2 700 ─────────────────────────────────╯',
    ' ╰──────────────────────────────────────────╯',
  ])

  // Over: a failure is red, a block that got no agent is dim and says so, a code block says nothing.
  const done: RunOverlay = { ...RUN, status: 'done', byNode: { ...RUN.byNode, n3: { total: 3, running: 0, done: 2, failed: 1, tokens: 5_000 }, n4: { total: 1, running: 0, done: 1, failed: 0, tokens: 10 } } }
  const after = cardRuns(layout, done)
  expect(after.get('n3')).toEqual({ glyph: '✗', color: 'error', text: '3/3 1✗ 5.0k', reached: true })
  expect(after.get('n2')).toMatchObject({ glyph: '✗', color: 'error' })
  expect(after.get('n5')).toEqual({ glyph: '·', color: 'inactive', text: NOT_RUN, reached: false })
  expect(spans(paint(layout, { run: done }), 'n5 agent')[0]?.color).toBe('inactive')
  expect(spans(paint(layout, { run: done }), 'synthesize')[0]?.color).toBe('inactive')
  const coded: Design = { ...design, nodes: [{ id: 'n9', type: 'code', title: 'dedupe' }] }
  expect(cardRuns(layoutBoard(coded, { orientation: 'horizontal', run: true }), done).has('n9')).toBe(false)
})

test('a card in the hand: dashed where it came from, a bar at the slot it would take, its name and what a release does at the pointer', () => {
  const n1 = card(H, 'n1')
  const n4 = card(H, 'n4')
  const target = dropTarget(H, 'n1', n4.x - 2, n4.y + 1)
  expect(target?.to).toEqual({ parentId: 'n2', index: 1 })
  const lines = paint(H, { selectedId: 'n1', drag: { id: 'n1', target, x: n4.x - 2, y: n4.y + 1, hint: 'drop into n2' } })
  const drawn = paintText(lines)
  expect(drawn[0]).toMatch(/^╭ n1 agent ╌╌╌╌╮/)
  expect(drawn[1]).toMatch(/^┆ scout diff   ┆/)
  expect(spans(lines, 'n1 agent')[0]).toMatchObject({ color: 'inactive', inverse: true })
  // The bar runs the height of the stages it would stand between.
  const column = target?.slot.mark?.x ?? 0
  expect([1, 3, 4, 5].map(row => [...(drawn[row] ?? '')][column])).toEqual(['┃', '┃', '┃', '┃'])
  expect(spans(lines, '┃').every(span => span.color === 'claude')).toBe(true)
  expect(spans(lines, ' n1 scout diff · drop into n2 ')[0]).toMatchObject({ inverse: true, color: 'claude' })
  // No slot is offered while a card is held, and none is drawn as a +.
  expect(drawn.join('\n')).not.toMatch(/\+/)
  // Back where it was, or nowhere: no bar.
  const home = paint(H, { drag: { id: 'n1', target: dropTarget(H, 'n1', n1.w + 1, 1), x: n1.w + 1, y: 1 } })
  expect(spans(home, '┃')).toEqual([])
  // Top to bottom a drop is marked along a row: the connector's, or the bottom border of the box it would end.
  const gap = card(V, 'n2').y - 1
  expect(text(V, { drag: { id: 'n5', target: dropTarget(V, 'n5', 30, gap), x: 30, y: gap } })[gap]).toMatch(/^━{30}/)
  const border = card(V, 'n2').y + card(V, 'n2').h - 1
  const into = dropTarget(V, 'n1', 30, border)
  expect(into?.to).toEqual({ parentId: 'n2', index: 2 })
  expect(text(V, { drag: { id: 'n1', target: into, x: 2, y: border - 1 } })[border]).toBe('━'.repeat(46))
  // The words stay inside the window.
  const edge = text(V, { drag: { id: 'n1', target: into, x: 44, y: 1, hint: 'drop into n2' } })[1] ?? ''
  expect(edge.endsWith(' n1 scout diff · drop into n2')).toBe(true)
  expect([...edge].length).toBeLessThanOrEqual(46)
})

test('sliding cards are drawn where they are passing, a growing one at the height it has reached, without edges or slots until they arrive', () => {
  const lines = text(H, { offsets: { n1: { dx: 3, dy: 1 } }, selectedId: 'n1' })
  expect(lines[0]).toMatch(/^ {20}╭ n2 pipeline/)
  expect(lines[1]).toMatch(/^ {3}┏ n1 agent ━━━━┓/)
  expect(lines.join('\n')).not.toMatch(/[▶+]|edit/)
  // n4, selected, is two rows short of its full height: its last lines are not drawn yet, its border closes where it has got to.
  const layout = layoutBoard(design, { orientation: 'vertical', width: 46, selectedId: 'n4', noteRows: 4 })
  const n4 = card(layout, 'n4')
  const growing = text(layout, { selectedId: 'n4', offsets: { n4: { dx: 0, dy: 0, dh: -2 } } })
  expect(growing[n4.y + n4.h - 3]).toBe('│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │')
  expect(growing[n4.y + n4.h - 4]).toBe('│ ┃ Keep a finding only if at least 2 of 3 ┃ │')
  expect(growing.join('\n')).not.toMatch(/fail to refute it|3 votes · out/)
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
