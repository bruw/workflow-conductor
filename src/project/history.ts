// Undo and redo: the projects each change left behind, newest last, with what the change was in words.
// One history per project, held for the session by the hooks module.

import type { Project } from './model'

/** A project as it stood, and the change that led away from it (`deleted n7 "verify"`). */
export type HistoryEntry = { project: Project; what: string }

export type History = { undo: HistoryEntry[]; redo: HistoryEntry[] }

export const HISTORY_MAX = 50

/** What every message announcing a change ends with. */
export const UNDO_HINT = '[u] Undo'
export const REDO_HINT = '[y] Redo'

export function remember(history: History | undefined, before: Project, what: string): History {
  const undo = [...(history?.undo ?? []), { project: before, what }]
  return { undo: undo.slice(Math.max(0, undo.length - HISTORY_MAX)), redo: [] }
}

export function travel(history: History | undefined, current: Project, way: 'undo' | 'redo'): { history: History; entry: HistoryEntry } | null {
  const from = way === 'undo' ? (history?.undo ?? []) : (history?.redo ?? [])
  const entry = from.at(-1)
  if (!history || !entry) return null
  const left = from.slice(0, -1)
  const kept: HistoryEntry = { project: current, what: entry.what }
  return way === 'undo'
    ? { history: { undo: left, redo: [...history.redo, kept].slice(-HISTORY_MAX) }, entry }
    : { history: { undo: [...history.undo, kept].slice(-HISTORY_MAX), redo: left }, entry }
}
