// The compact view: what the band above the prompt shows while the designer is minimized, by the person or for want of room.
// No `$`, no engine imports.

import { DOCK_MIN_TERMINAL, FULL_MIN_COLUMNS, FULL_MIN_ROWS } from '../project/session'

import { MINIMIZE_KEYS } from './keys'
import { SMALL_ROWS, SMALL_W } from './persona'
import { clip } from './text'

export type Minimized = 'no' | 'person' | 'auto'

export type CompactWhy = 'narrow' | 'screen' | 'dock' | 'short'

/** Kept for the session. */
export type Shell = { minimized: Minimized; why: CompactWhy | null }

export function initialShell(): Shell {
  return { minimized: 'no', why: null }
}

export type PaneRoom = { dock: boolean; bodyColumns: number; bodyRows: number; fullscreen: boolean }

export function whyCompact(room: PaneRoom): CompactWhy {
  // Inline in the fullscreen layout is a terminal under DOCK_MIN_TERMINAL columns: wider, the pane is docked.
  if (!room.dock) return room.fullscreen ? 'narrow' : 'screen'
  return room.bodyColumns < FULL_MIN_COLUMNS ? 'dock' : 'short'
}

export const WHY_TEXT: Record<CompactWhy, string> = {
  narrow: `The full designer needs a terminal ${DOCK_MIN_TERMINAL}+ columns wide`,
  screen: `The full designer needs the fullscreen layout, or ${FULL_MIN_ROWS}+ rows above the prompt`,
  dock: `The full designer needs a dock ${FULL_MIN_COLUMNS}+ columns wide: drag its edge`,
  short: 'The full designer needs a taller terminal',
}

/** The designer's rows, and the prompt's under them. */
export const DOCK_MIN_ROWS = FULL_MIN_ROWS + 6

export function wouldDock(viewport: { columns: number; rows: number; isFullscreen?: boolean } | undefined): boolean {
  return viewport !== undefined && viewport.isFullscreen === true && viewport.columns >= DOCK_MIN_TERMINAL && viewport.rows >= DOCK_MIN_ROWS
}

export const COMPACT_BAR_W = 12
export const LIST_GAP = 2
export const LIST_LABEL = 'Projects'
/** The rows the band must give for a border, and the cells the border and its padding take of a row. */
export const BORDER_ROWS = SMALL_ROWS + 2
export const BORDER_CELLS = 4
export const EXPAND_WORD = 'Expand'
export const EXPAND_W = `[${MINIMIZE_KEYS}] ${EXPAND_WORD}`.length

export type CompactInput = {
  /** The cells and the rows the band gives (`bodyColumns`, `maxRows`). */
  columns: number
  rows: number
  shell: Shell
  name: string | null
  /** `agents ≥ 8`, where the project has blocks to count. */
  facts: string | null
  goal: string
  run: { bar: string; text: string; color: 'claude' | 'success' | 'error' } | null
  saved: readonly string[]
}

export type CompactList = { names: string[]; current: string | null; more: number }

export type CompactView = {
  oneLine: boolean
  name: string
  facts: string | null
  state: string
  /** The last row: the run, else the goal, else what to do with no project open. */
  status: { bar: string | null; text: string; color: 'claude' | 'success' | 'error' | null }
  list: CompactList | null
  bordered: boolean
  taken: number
}

/** Names keep their own order: from the first, or from as far on as shows the open one. */
export function compactList(saved: readonly string[], current: string | null, room: number): CompactList | null {
  if (saved.length === 0) return null
  const fitFrom = (from: number): string[] => {
    const names: string[] = []
    let used = LIST_LABEL.length
    for (const one of saved.slice(from)) {
      const left = saved.length - names.length - 1
      // The row keeps room for `+12 more` while names are left out.
      const tail = left > 0 ? LIST_GAP + `+${left} more`.length : 0
      if (used + LIST_GAP + one.length + tail > room && names.length > 0) break
      names.push(clip(one, Math.max(4, room - used - LIST_GAP - tail)))
      used += LIST_GAP + one.length
    }
    return names
  }
  const at = current === null ? -1 : saved.indexOf(current)
  let from = 0
  let names = fitFrom(0)
  while (at >= from + names.length && from < at) names = fitFrom(++from)
  return { names, current, more: saved.length - names.length }
}

export function compactView(input: CompactInput): CompactView {
  const { shell, run } = input
  const columns = Math.max(20, input.columns)
  const rows = Math.max(1, input.rows)
  const state = run !== null ? '' : shell.minimized === 'person' ? 'MINIMIZED' : 'COMPACT VIEW'
  const name = input.name ?? 'no project open'
  const why = shell.minimized === 'auto' && shell.why !== null ? WHY_TEXT[shell.why] : null
  const text = run !== null ? run.text : why !== null ? why : input.name === null ? 'pick one above · /conductor <what you want> has Claude draft one' : input.goal === '' ? 'Goal: not said yet' : `Goal: ${input.goal}`
  const status = { bar: run?.bar ?? null, text, color: run?.color ?? null }
  const oneLine = rows < SMALL_ROWS
  const bordered = rows >= BORDER_ROWS
  // The projects have a row once the border has its two: under the name's, over the run's.
  const list = rows >= BORDER_ROWS + 1 ? compactList(input.saved, input.name, columns - SMALL_W - BORDER_CELLS) : null
  const taken = oneLine ? 1 : SMALL_ROWS + (list === null ? 0 : 1) + (bordered ? 2 : 0)
  return { oneLine, name, facts: input.facts, state, status, list, bordered, taken }
}
