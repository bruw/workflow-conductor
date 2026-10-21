import type { EngineInterface, On } from 'claude-code'

import { offerBrief } from '../src/project/chat'
import { LAST_SCRIPTS_STORE, buildHandoff, lastScripts, newestScript, savedWorkflowFile } from '../src/project/handoff'
import type { HandoffScript, LastRun, ScriptFile } from '../src/project/handoff'
import { isBlank, parseProject } from '../src/project/model'
import {
  DISMISSED_RESULT,
  OFFER_HEADER,
  OFFER_OPTIONS,
  OFFER_QUESTION,
  OFFER_TOOL_DESCRIPTION,
  OFFER_TOOL_FULL_NAME,
  OFFER_TOOL_NAME,
  handedResult,
  offerChoice,
  standardResult,
  typedResult,
  waitingResult,
} from '../src/project/offer'
import { projectFile } from '../src/project/session'
import type { Tracker } from '../src/run/tracker'

/** Per project, its last run in this session, whose script is the one remembered: a resume works only in the session that ran it. */
const lastRuns: Record<string, LastRun> = {}

export const offerRan = (name: string, run: LastRun): void => {
  lastRuns[name] = run
}

const fileOf = async ($: EngineInterface, path: string | undefined): Promise<ScriptFile | null> => {
  if (path === undefined) return null
  const stat = await $.fs.stat(path).catch(() => undefined)

  return stat?.kind === 'file' ? { path, mtimeMs: stat.mtimeMs } : null
}

/** The last run's script in the session folder, or the copy saved in the repository: the newer, as the session's is cleared after a while. */
const scriptOf = async ($: EngineInterface, name: string): Promise<HandoffScript> => {
  const last = lastScripts(await $.store.get(LAST_SCRIPTS_STORE).catch(() => undefined))[name]
  const path = newestScript(await fileOf($, last), await fileOf($, savedWorkflowFile(await $.session.root(), name)))
  // The run is named only with the script it ran: the saved copy may be another.
  if (path === null) return { path: null }

  return path === last ? { path, run: lastRuns[name] } : { path }
}

/** "Conductor" was answered and the draft it asks Claude for has not landed yet. A module variable: it lasts a turn. */
let offered = false

/** Whether the project being written is the one the person just asked for in the question; asking spends it. */
export const takeOffered = (): boolean => {
  const was = offered
  offered = false

  return was
}

/** While it waits the question is not asked again: Claude would draft a second project, or a script the board knows nothing of. */
let waiting: string | null = null
/** The tool already answered in this turn that a project waits: a second call is for another workflow, and asks. */
let answered = false

/** `$` does not cross files, so project.tsx's session.start hook gives this file its board, as it gives run.tsx its `RunBoard`. */
export type OfferBoard = { drafting: () => Promise<void> }
let offerBoard: OfferBoard | undefined
export const setOfferBoard = (board: OfferBoard): void => {
  offerBoard = board
}

export const offerDrafted = (name: string): void => {
  waiting = name
}

/** The project handed off on the board (`r`) whose hand-off Claude has not been given yet: the tool's next answer is it. */
let handing: string | null = null

export const offerHanded = (name: string): void => {
  handing = name
  if (waiting === name) waiting = null
}

/** Handed off or run: project `name` waits for no approval. */
export const offerSettled = (name: string): void => {
  if (waiting === name) waiting = null
}

/** A prompt was sent: a "Conductor" answer whose draft never came is over with its turn, and so is what the tool said in it. */
export const offerPrompted = (): void => {
  offered = false
  answered = false
  handing = null
}

export const registerOffer = (on: On, tracker: Tracker): void => {
  // Not deferred: Claude calls a tool before a workflow only when its description is in front of it.
  // The matcher is always true: run.tsx holds the unmatched session.start, project.tsx the one on `cwd`.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    await $.tool.register({ name: OFFER_TOOL_NAME, description: OFFER_TOOL_DESCRIPTION, isDeferred: false })

    return next(e)
  })
  // A cleared or resumed conversation is another session: no run of it can be resumed from there.
  on('session.end', { reason: ['clear', 'resume'] }, async (_$, e, next) => {
    for (const name of Object.keys(lastRuns)) delete lastRuns[name]

    return next(e)
  })

  // Claude always gets a result to act on, never a throw and never a deny: it does not take instructions from a refusal.
  on('tool.call', { tool: OFFER_TOOL_FULL_NAME }, async ($, e) => {
    // A workflow's own agents, and any subagent: the person is asked by the conversation, once.
    if (e.agentId !== undefined) return { result: standardResult('subagent') }
    // The project the person just handed off on the board: its hand-off, once.
    if (handing !== null) {
      const name = handing
      handing = null
      const root = await $.session.root()
      const path = projectFile(root, name)
      const parsed = parseProject(await $.fs.read(path).catch(() => ''))
      if (parsed.ok && !isBlank(parsed.project)) {
        return { result: handedResult(buildHandoff({ ...parsed.project, name }, path, await scriptOf($, name)).context.join('\n')) }
      }
    }
    // The script being written is the project the person approved on the board: that was their answer.
    if (tracker.awaitsRun()) return { result: standardResult('handoff') }
    // A `-p` run draws nowhere: nobody reads a question, and nobody would review a project.
    const surfaces = await $.session.surfaces().catch(() => undefined)
    if (surfaces !== undefined && surfaces.length === 0) return { result: standardResult('headless') }
    // The project drafted after the last "Conductor" answer still waits for the person: said once a turn, with what an
    // approval given in chat is carried out by. Gone, emptied or said already: the question is asked as for any workflow.
    if (waiting !== null && !answered) {
      const root = await $.session.root()
      const path = projectFile(root, waiting)
      const parsed = parseProject(await $.fs.read(path).catch(() => ''))
      if (parsed.ok && !isBlank(parsed.project)) {
        answered = true
        return { result: waitingResult(waiting, buildHandoff({ ...parsed.project, name: waiting }, path, await scriptOf($, waiting)).context.join('\n')) }
      }
    }
    waiting = null

    let answer: string
    try {
      answer = await $.ui.ask(OFFER_QUESTION, { options: OFFER_OPTIONS, header: OFFER_HEADER })
    } catch {
      return { result: DISMISSED_RESULT }
    }
    const picked = offerChoice(answer)
    if (picked === null) return { result: answer.trim() === '' ? DISMISSED_RESULT : typedResult(answer) }
    if (picked === 'standard') return { result: standardResult('chosen') }
    offered = true
    // project.tsx shows the splash until the project lands.
    await offerBoard?.drafting().catch(() => undefined)

    return { result: offerBrief() }
  })
}
