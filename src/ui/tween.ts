// Motion: a tiny tween utility and the per-item offset animator the flow
// board uses, once for its cards' columns and once for their rows. Pure TypeScript: time is a number handed in, never read from a clock.
//
// Rows are whole cells, so a row's motion is an integer offset from where it
// now belongs, starting at (old y - new y) and decaying to 0.

/** One frame of the surface's clock, and the interval the shared ticker asks for. */
export const FRAME_MS = 16
/** Eight frames: inside the 120–180 ms the spec asks of a reorder. */
export const TWEEN_MS = 128

/** Ease-out (cubic): fast at first, settling at the end. `t` is clamped to 0..1. */
export function ease(t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t
  return 1 - (1 - clamped) ** 3
}

/** The eased value between `from` and `to` at `nowMs`; `from` before the start, `to` from the end on. */
export function tweenValue(from: number, to: number, startMs: number, durationMs: number, nowMs: number): number {
  if (durationMs <= 0) return nowMs >= startMs ? to : from
  return from + (to - from) * ease((nowMs - startMs) / durationMs)
}

/** A row on its way: `from` rows away from its place at `startMs`. */
export type RowTween = { from: number; startMs: number }

export type Motion = {
  /** Where each row belongs (its line), as last seen. */
  ys: Record<string, number>
  /** The rows still travelling. */
  tweens: Record<string, RowTween>
}

export function stillMotion(): Motion {
  return { ys: {}, tweens: {} }
}

/** Whole rows between a row and its place, right now; 0 once it has arrived. */
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

/**
 * Takes the rows' new places. A row whose place changed sets off from where it
 * is drawn now (mid-flight included); a row not seen before, and the `pinned`
 * one (held by the pointer), appear in place. Returns `motion` itself when no
 * place changed.
 */
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

/** Drops the rows that have arrived. Returns `motion` itself when none has. */
export function settleMotion(motion: Motion, nowMs: number, durationMs: number = TWEEN_MS): Motion {
  const entries = Object.entries(motion.tweens)
  const live = entries.filter(([, tween]) => rowOffset(tween, nowMs, durationMs) !== 0)
  return live.length === entries.length ? motion : { ys: motion.ys, tweens: Object.fromEntries(live) }
}

/** Whether any row is still away from its place: the ticker runs only while this holds. */
export function motionActive(motion: Motion, nowMs: number, durationMs: number = TWEEN_MS): boolean {
  return Object.values(motion.tweens).some(tween => rowOffset(tween, nowMs, durationMs) !== 0)
}

/** Every travelling row's offset right now. */
export function rowOffsets(motion: Motion, nowMs: number, durationMs: number = TWEEN_MS): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, tween] of Object.entries(motion.tweens)) {
    const offset = rowOffset(tween, nowMs, durationMs)
    if (offset !== 0) out[id] = offset
  }
  return out
}
