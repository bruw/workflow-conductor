import { expect, test } from 'claude-code/testing'

import { FRAME_MS, TWEEN_MS, ease, motionActive, placeRows, rowOffset, rowOffsets, settleMotion, stepMotion, stillMotion, tweenValue } from '../src/ui/tween'

test('ease is clamped to 0..1, rises all the way, and is fastest at first', () => {
  expect(ease(-1)).toBe(0)
  expect(ease(0)).toBe(0)
  expect(ease(1)).toBe(1)
  expect(ease(2)).toBe(1)
  let last = 0
  for (let step = 1; step <= 10; step++) {
    expect(ease(step / 10)).toBeGreaterThan(last)
    last = ease(step / 10)
  }
  // Ease-out: past halfway by the middle.
  expect(ease(0.5)).toBeGreaterThan(0.5)
})

test('tweenValue is `from` at the start, between at the middle, `to` at the end and after', () => {
  expect(tweenValue(10, 20, 100, 128, 100)).toBe(10)
  expect(tweenValue(10, 20, 100, 128, 50)).toBe(10)
  const mid = tweenValue(10, 20, 100, 128, 164)
  expect(mid).toBeGreaterThan(15)
  expect(mid).toBeLessThan(20)
  expect(tweenValue(10, 20, 100, 128, 228)).toBe(20)
  expect(tweenValue(10, 20, 100, 128, 999)).toBe(20)
  expect(tweenValue(10, 20, 100, 0, 100)).toBe(20)
})

test('a tween lasts eight frames', () => {
  expect(TWEEN_MS).toBe(8 * FRAME_MS)
})

test('row offsets are whole rows that decay to zero and stay there', () => {
  const tween = { from: 5, startMs: 0 }
  expect(rowOffset(tween, 0)).toBe(5)
  let last = 5
  for (let now = FRAME_MS; now <= TWEEN_MS; now += FRAME_MS) {
    const offset = rowOffset(tween, now)
    expect(Number.isInteger(offset)).toBe(true)
    expect(offset).toBeLessThanOrEqual(last)
    expect(offset).toBeGreaterThanOrEqual(0)
    last = offset
  }
  expect(rowOffset(tween, TWEEN_MS)).toBe(0)
  expect(rowOffset(tween, TWEEN_MS * 4)).toBe(0)
  expect(rowOffset({ from: -3, startMs: 0 }, 0)).toBe(-3)
  expect(Object.is(rowOffset({ from: -3, startMs: 0 }, TWEEN_MS), 0)).toBe(true)
  expect(rowOffset(undefined, 0)).toBe(0)
})

test('stepMotion starts a tween for each row whose line changed, and only those', () => {
  const first = stepMotion(stillMotion(), { a: 0, b: 1, c: 2 }, 0)
  // Rows seen for the first time appear in place.
  expect(first.tweens).toEqual({})
  expect(motionActive(first, 0)).toBe(false)
  expect(stepMotion(first, { a: 0, b: 1, c: 2 }, 16)).toBe(first)

  // c moves to the top: it comes from two rows below, a and b from one row above.
  const moved = stepMotion(first, { c: 0, a: 1, b: 2 }, 100)
  expect(moved.tweens).toEqual({ c: { from: 2, startMs: 100 }, a: { from: -1, startMs: 100 }, b: { from: -1, startMs: 100 } })
  expect(rowOffsets(moved, 100)).toEqual({ c: 2, a: -1, b: -1 })
  expect(motionActive(moved, 100)).toBe(true)

  // A new row and the pinned row do not tween.
  const pinned = stepMotion(first, { c: 0, a: 1, b: 2, d: 3 }, 100, 'c')
  expect(Object.keys(pinned.tweens).sort()).toEqual(['a', 'b'])
})

test('a row redirected mid-flight sets off from where it is drawn', () => {
  const first = stepMotion(stillMotion(), { a: 0, b: 4 }, 0)
  const down = stepMotion(first, { a: 4, b: 0 }, 0)
  expect(rowOffset(down.tweens.a, 0)).toBe(-4)
  const now = 2 * FRAME_MS
  const drawnAt = 4 + rowOffset(down.tweens.a, now)
  expect(drawnAt).toBeGreaterThan(0)
  const back = stepMotion(down, { a: 0, b: 4 }, now)
  expect(back.tweens.a).toEqual({ from: drawnAt, startMs: now })
})

test('motion is inactive once every offset has decayed, and settleMotion drops the finished', () => {
  const moved = stepMotion(stepMotion(stillMotion(), { a: 0, b: 1 }, 0), { b: 0, a: 1 }, 0)
  expect(motionActive(moved, 0)).toBe(true)
  expect(settleMotion(moved, 0)).toBe(moved)
  expect(motionActive(moved, TWEEN_MS)).toBe(false)
  const done = settleMotion(moved, TWEEN_MS)
  expect(done.tweens).toEqual({})
  expect(done.ys).toEqual({ b: 0, a: 1 })
  expect(rowOffsets(moved, TWEEN_MS)).toEqual({})
})

test('placeRows draws travelling rows at their offset, under the rows in place', () => {
  expect(placeRows(['a', 'b', 'c'], () => 0)).toEqual(['a', 'b', 'c'])
  // b and c were one line down: the line they are heading for is blank until they arrive.
  expect(placeRows(['a', 'b', 'c'], item => (item === 'a' ? 0 : 1))).toEqual(['a', null, 'b', 'c'])
  // A row in place wins the line a travelling row is passing.
  expect(placeRows(['a', 'b', 'c'], item => (item === 'c' ? -1 : 0))).toEqual(['a', 'b', null])
  expect(placeRows(['a', 'b', 'c'], item => (item === 'a' ? 2 : 0))).toEqual([null, 'b', 'c'])
})
