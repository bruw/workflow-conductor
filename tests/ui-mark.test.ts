import { expect, test } from 'claude-code/testing'

import { DARK, FADE_MS, HOLD_MS, MARK_ROWS, MARK_STATES, MARK_W, STEP_MS, blend, markAt, markFrame, markPalette, nudged } from '../src/ui/mark'

const colorsOf = (state: number, t: number): string[] =>
  markFrame(state, t, DARK).flatMap(row => row.flatMap(span => [...span.text].map(() => span.color ?? '')))

test('the mark is its rows of blocks and box drawing, narrower than its room', () => {
  for (let state = 0; state < MARK_STATES; state++) {
    const rows = markFrame(state, 0, DARK)
    expect(rows.length).toBe(MARK_ROWS)
    for (const row of rows) {
      const text = row.map(span => span.text).join('')
      expect(text.length).toBeLessThan(MARK_W)
      for (const char of text) expect(char === ' ' || (char >= '─' && char <= '▟')).toBe(true)
    }
  }
})

test('the cycle holds each state, fades to the next, and comes round again', () => {
  expect(markAt(0, 0)).toEqual({ state: 0, t: 0 })
  expect(markAt(0, HOLD_MS).t).toBe(0)
  expect(markAt(0, HOLD_MS + FADE_MS / 2)).toEqual({ state: 0, t: 0.5 })
  expect(markAt(0, STEP_MS)).toEqual({ state: 1, t: 0 })
  expect(markAt(0, STEP_MS * MARK_STATES).state).toBe(0)
})

test('a fade starts at one state’s colours and ends at the next’s', () => {
  for (let state = 0; state < MARK_STATES; state++) {
    expect(colorsOf(state, 1)).toEqual(colorsOf(state + 1, 0))
  }
  expect(colorsOf(0, 0)).not.toEqual(colorsOf(1, 0))
  expect(blend('#000000', '#ffffff', 0.5)).toBe('#808080')
})

test('the lead walks the blocks in order, then every block is done', () => {
  const lead = (state: number): number => colorsOf(state, 0).filter(color => color === DARK.lead).length
  for (let state = 0; state < MARK_STATES - 1; state++) expect(lead(state)).toBeGreaterThan(0)
  expect(lead(MARK_STATES - 1)).toBe(0)
  expect(colorsOf(MARK_STATES - 1, 0).filter(color => color !== '').every(color => color === DARK.done)).toBe(true)
})

test('a nudge starts the fade to the next state now, and one under way counts as reached', () => {
  expect(nudged(0, 100)).toEqual({ state: 0, ms: HOLD_MS })
  expect(markAt(nudged(0, 100).state, nudged(0, 100).ms + FADE_MS).state).toBe(1)
  expect(nudged(0, HOLD_MS + FADE_MS / 2).state).toBe(1)
})

test('a light theme takes the light palette', () => {
  expect(markPalette('light-daltonized')).not.toEqual(DARK)
  expect(markPalette('dark')).toEqual(DARK)
  expect(markPalette(undefined)).toEqual(DARK)
})
