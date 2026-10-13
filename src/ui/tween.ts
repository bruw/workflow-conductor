// Motion: an item's whole-cell offset from where it belongs, decaying to 0. `row` and `y` name any axis the graph animates.
// Time is a number handed in, never read from a clock.

/** One frame of the surface's clock, and the interval the shared ticker asks for. */
export const FRAME_MS = 16
/** Eight frames: inside the 120–180 ms a reorder should take. */
export const TWEEN_MS = 128

export function ease(t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t
  return 1 - (1 - clamped) ** 3
}

export function tweenValue(from: number, to: number, startMs: number, durationMs: number, nowMs: number): number {
  if (durationMs <= 0) return nowMs >= startMs ? to : from
  return from + (to - from) * ease((nowMs - startMs) / durationMs)
}

/** `from` is rows away from its place, at `startMs`. */
export type RowTween = { from: number; startMs: number }

export type Motion = {
  /** Where each row belongs, as last seen. */
  ys: Record<string, number>
  tweens: Record<string, RowTween>
}

export function stillMotion(): Motion {
  return { ys: {}, tweens: {} }
}

export function rowOffset(tween: RowTween | undefined, nowMs: number, durationMs: number = TWEEN_MS): number {
  if (!tween) return 0
  const value = Math.round(tweenValue(tween.from, 0, tween.startMs, durationMs, nowMs))
  return value === 0 ? 0 : value
}

function sameYs(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(key => a[key] === b[key])
}

/** A moved row sets off from where it is drawn now; a new row and the `pinned` one appear in place. Returns `motion` itself when no place changed. */
export function stepMotion(motion: Motion, ys: Record<string, number>, nowMs: number, pinned: string | null = null, durationMs: number = TWEEN_MS): Motion {
  if (sameYs(motion.ys, ys)) return motion
  const tweens: Record<string, RowTween> = {}
  for (const [id, y] of Object.entries(ys)) {
    const old = motion.ys[id]
    if (old === undefined || id === pinned) continue
    const from = old + rowOffset(motion.tweens[id], nowMs, durationMs) - y
    if (from !== 0) tweens[id] = { from, startMs: nowMs }
  }
  return { ys, tweens }
}

/** Returns `motion` itself when no row has arrived. */
export function settleMotion(motion: Motion, nowMs: number, durationMs: number = TWEEN_MS): Motion {
  const entries = Object.entries(motion.tweens)
  const live = entries.filter(([, tween]) => rowOffset(tween, nowMs, durationMs) !== 0)
  return live.length === entries.length ? motion : { ys: motion.ys, tweens: Object.fromEntries(live) }
}

/** The ticker runs only while this holds. */
export function motionActive(motion: Motion, nowMs: number, durationMs: number = TWEEN_MS): boolean {
  return Object.values(motion.tweens).some(tween => rowOffset(tween, nowMs, durationMs) !== 0)
}

export function rowOffsets(motion: Motion, nowMs: number, durationMs: number = TWEEN_MS): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, tween] of Object.entries(motion.tweens)) {
    const offset = rowOffset(tween, nowMs, durationMs)
    if (offset !== 0) out[id] = offset
  }
  return out
}
