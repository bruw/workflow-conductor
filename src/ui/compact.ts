// The compact view: what Conductor draws in the band above the prompt while the designer is minimized, by
// the person (`Shift+M`) or because its pane has no room for the graph and the detail pane side by side. It is
// no small designer: the conductor, the project and the run in a few rows, the saved projects to pick from, and
// the way back to the full screen. Pure TypeScript: no `$`, no engine imports.

import { DOCK_MIN_TERMINAL, FULL_MIN_COLUMNS, FULL_MIN_ROWS } from '../project/session'

import { MINIMIZE_KEYS } from './keys'
import { SMALL_ROWS, SMALL_W } from './persona'
import { clip } from './text'

/** Why the designer is in the band: the person put it there, or its pane could not hold it. */
export type Minimized = 'no' | 'person' | 'auto'

/** What the pane was short of when it was minimized by itself. */
export type CompactWhy = 'narrow' | 'screen' | 'dock' | 'short'

/** Where the designer is: in its pane, or in the band. Kept for the session. */
export type Shell = { minimized: Minimized; why: CompactWhy | null }

export function initialShell(): Shell {
  return { minimized: 'no', why: null }
}

/** The room a pane was drawn with, and the terminal around it. */
export type PaneRoom = { dock: boolean; bodyColumns: number; bodyRows: number; fullscreen: boolean }

/** What a pane too small for the designer is short of. */
export function whyCompact(room: PaneRoom): CompactWhy {
  // Inline in the fullscreen layout is a terminal under DOCK_MIN_TERMINAL columns: wider, the pane is docked.
  if (!room.dock) return room.fullscreen ? 'narrow' : 'screen'
  return room.bodyColumns < FULL_MIN_COLUMNS ? 'dock' : 'short'
}

/** What the designer needs, said to someone who has the compact view in its place. */
export const WHY_TEXT: Record<CompactWhy, string> = {
  narrow: `The full designer needs a terminal ${DOCK_MIN_TERMINAL}+ columns wide`,
  screen: `The full designer needs the fullscreen layout, or ${FULL_MIN_ROWS}+ rows above the prompt`,
  dock: `The full designer needs a dock ${FULL_MIN_COLUMNS}+ columns wide: drag its edge`,
  short: 'The full designer needs a taller terminal',
}

/** The rows a terminal must have for a docked pane to hold the designer: its own, and the prompt's under it. */
export const DOCK_MIN_ROWS = FULL_MIN_ROWS + 6

/** Whether a pane opened in this terminal would be docked with room for the designer. */
export function wouldDock(viewport: { columns: number; rows: number; isFullscreen?: boolean } | undefined): boolean {
  return viewport !== undefined && viewport.isFullscreen === true && viewport.columns >= DOCK_MIN_TERMINAL && viewport.rows >= DOCK_MIN_ROWS
}

/** The bar of a run's progress is this wide. */
export const COMPACT_BAR_W = 12
/** Cells between two names of the designs' row, and the row's label. */
export const LIST_GAP = 2
export const LIST_LABEL = 'Projects'

/** What the compact view shows. */
export type CompactInput = {
  /** The cells and the rows the band gives (`bodyColumns`, `maxRows`). */
  columns: number
  rows: number
  shell: Shell
  /** The project that is open, or null with none. */
  name: string | null
  /** `agents ≥ 8`, where the project has blocks to count. */
  facts: string | null
  goal: string
  /** The run: its progress as a bar and in words, or null with none tracked. */
  run: { bar: string; text: string; color: 'claude' | 'success' | 'error' } | null
  /** The saved projects, by name. */
  saved: readonly string[]
}

/** One row of the projects: the names shown, the one that is open, how many are left out. */
export type CompactList = { names: string[]; current: string | null; more: number }

/** The compact view as its parts: which are drawn follows the rows the band gives. */
export type CompactView = {
  /** One row only: the name and the run on the same line, no conductor. */
  oneLine: boolean
  name: string
  facts: string | null
  state: string
  /** The second row: the run, else the goal, else what to do with no project open. */
  second: { bar: string | null; text: string; color: 'claude' | 'success' | 'error' | null }
  list: CompactList | null
  /** What the full designer needs, where the pane could not hold it; null where the person minimized it. */
  hint: string | null
  /** The key that expands, as its Button says it. */
  expand: string
  /** The rows the view takes. */
  taken: number
}

/**
 * The names that fit one row of `room` cells after its label, in their own order (a pick moves none of them): from
 * the first, and where the open one is past the last that fits, from as far on as shows it.
 */
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
  const expand = `${MINIMIZE_KEYS} Expand`
  const state = run !== null ? '' : shell.minimized === 'person' ? 'MINIMIZED' : 'COMPACT VIEW'
  const name = input.name ?? 'no project open'
  const text = run !== null ? run.text : input.name === null ? 'pick one below · /conductor <what you want> has Claude draft one' : input.goal === '' ? 'Goal: not said yet' : `Goal: ${input.goal}`
  const second = { bar: run?.bar ?? null, text, color: run?.color ?? null }
  const hint = shell.minimized === 'auto' && shell.why !== null ? WHY_TEXT[shell.why] : null
  const oneLine = rows < SMALL_ROWS
  // The projects have a row from four: under the conductor's two, over the one that says the way back.
  const list = rows >= SMALL_ROWS + 2 ? compactList(input.saved, input.name, columns - SMALL_W) : null
  const taken = oneLine ? 1 : SMALL_ROWS + (rows > SMALL_ROWS ? 1 : 0) + (list === null ? 0 : 1)
  return { oneLine, name, facts: input.facts, state, second, list, hint, expand, taken }
}
