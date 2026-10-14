import type { RunEvent } from './events'

export type AgentMeta = { description?: string; workflowPhase?: string }

export type JournalOptions = {
  /** The journal carries no run id of its own. */
  runId?: string
}

function parseLine(line: string): Record<string, unknown> | undefined {
  if (!line.trim()) return undefined
  try {
    const value: unknown = JSON.parse(line)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** `metas` (by agentId, from `agent-<id>.meta.json`) gives the label or phase a `started` line lacks. */
export function journalToEvents(journalText: string, metas: Record<string, AgentMeta> = {}, options: JournalOptions = {}): RunEvent[] {
  const runId = options.runId ?? ''
  const events: RunEvent[] = []
  let index = 0

  if (typeof journalText !== 'string') return events

  for (const line of journalText.split('\n')) {
    const entry = parseLine(line)
    if (!entry) continue

    if (entry.type === 'launched') {
      events.push({ kind: 'run-start', runId })
      continue
    }

    const agentId = text(entry.agentId)
    if (agentId === undefined) continue

    if (entry.type === 'started') {
      const meta = metas?.[agentId]
      const start: RunEvent = {
        kind: 'agent-start',
        runId,
        agentId,
        label: text(entry.label) ?? text(meta?.description) ?? '',
        index: index++,
      }
      const phase = text(entry.phase) ?? text(meta?.workflowPhase)
      if (phase !== undefined) start.phase = phase
      events.push(start)
    } else if (entry.type === 'result') {
      events.push({ kind: 'agent-end', agentId, ok: entry.result !== null && entry.result !== undefined })
    }
  }

  return events
}

/** Null: the `started` line names no phase. Absent: the agent is not journalled yet. */
export function journalPhases(journalText: string): Map<string, string | null> {
  const phases = new Map<string, string | null>()
  if (typeof journalText !== 'string') return phases

  for (const line of journalText.split('\n')) {
    // Read with every burst of spawns, so a line without the word (a result, with all it carries) is not parsed.
    if (!line.includes('"started"')) continue
    const entry = parseLine(line)
    if (entry?.type !== 'started') continue

    const agentId = text(entry.agentId)
    if (agentId !== undefined) phases.set(agentId, text(entry.phase) ?? null)
  }

  return phases
}

/** By agentId, whether the agent's `result` line holds a value: the engine writes one per agent that completed, null where it gave nothing back. */
export function journalResults(journalText: string): Map<string, boolean> {
  const results = new Map<string, boolean>()
  if (typeof journalText !== 'string') return results

  for (const line of journalText.split('\n')) {
    if (!line.includes('"result"')) continue
    const entry = parseLine(line)
    if (entry?.type !== 'result') continue

    const agentId = text(entry.agentId)
    if (agentId !== undefined) results.set(agentId, entry.result !== null && entry.result !== undefined)
  }

  return results
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** The usage counts that make up the token figure shown: prompt tokens mostly arrive as cache writes and reads. */
export const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const

/** One API message is several lines repeating its `message.id` and usage: counted once per id, the largest seen. */
export function sumUsage(transcriptText: string): number {
  if (typeof transcriptText !== 'string') return 0

  const byMessage = new Map<string, number>()
  let total = 0

  for (const line of transcriptText.split('\n')) {
    const message = parseLine(line)?.message
    if (message === null || typeof message !== 'object') continue

    const { id, usage } = message as { id?: unknown; usage?: unknown }
    if (usage === null || typeof usage !== 'object') continue

    const counts = usage as Record<string, unknown>
    const tokens = USAGE_KEYS.reduce((sum, key) => sum + count(counts[key]), 0)

    if (typeof id === 'string') byMessage.set(id, Math.max(byMessage.get(id) ?? 0, tokens))
    else total += tokens
  }

  for (const tokens of byMessage.values()) total += tokens
  return total
}
