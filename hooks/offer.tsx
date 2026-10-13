import type { On } from 'claude-code'

import { offerBrief } from '../src/project/chat'
import { buildHandoff } from '../src/project/handoff'
import { isBlank, parseProject } from '../src/project/model'
import {
  DISMISSED_RESULT,
  OFFER_HEADER,
  OFFER_KEY,
  OFFER_OPTIONS,
  OFFER_QUESTION,
  OFFER_TOOL_DESCRIPTION,
  OFFER_TOOL_FULL_NAME,
  OFFER_TOOL_NAME,
  handedResult,
  keptToast,
  offerChoice,
  standardResult,
  storedChoice,
  typedResult,
  waitingResult,
} from '../src/project/offer'
import { projectFile, scriptFile } from '../src/project/session'
import type { Tracker } from '../src/run/tracker'

/** "Conductor" was answered and the draft it asks Claude for has not landed yet. A module variable: it lasts a turn. */
let offered = false

/** Whether the project being written is the one the person just asked for in the question; asking spends it. */
export const takeOffered = (): boolean => {
  const was = offered
  offered = false

  return was
}

/**
 * The project the last "Conductor" answer led to, until it is handed off or run. While it waits the question is not
 * asked again: Claude would draft a second project, or write a script the board knows nothing of.
 */
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

  // Claude always gets a result to act on, never a throw and never a deny: it does not take instructions from a refusal.
  on('tool.call', { tool: OFFER_TOOL_FULL_NAME }, async ($, e) => {
    const conductor = async (asked: boolean): Promise<{ result: string }> => {
      offered = true
      // project.tsx shows the splash until the project lands.
      await offerBoard?.drafting().catch(() => undefined)

      return { result: offerBrief(asked) }
    }
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
        const script = scriptFile(root, name)

        return { result: handedResult(buildHandoff({ ...parsed.project, name }, path, (await $.fs.exists(script).catch(() => false)) ? script : null).context.join('\n')) }
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
        const script = scriptFile(root, waiting)

        return { result: waitingResult(waiting, buildHandoff({ ...parsed.project, name: waiting }, path, (await $.fs.exists(script).catch(() => false)) ? script : null).context.join('\n')) }
      }
    }
    waiting = null
    const kept = storedChoice(await $.store.get(OFFER_KEY).catch(() => undefined))
    if (kept !== null) return kept === 'conductor' ? conductor(false) : { result: standardResult('always') }

    let answer: string
    try {
      answer = await $.ui.ask(OFFER_QUESTION, { options: OFFER_OPTIONS, header: OFFER_HEADER })
    } catch {
      return { result: DISMISSED_RESULT }
    }
    const picked = offerChoice(answer)
    if (picked === null) return { result: answer.trim() === '' ? DISMISSED_RESULT : typedResult(answer) }
    if (picked.always) {
      await $.store.set(OFFER_KEY, picked.choice).catch(() => undefined)
      $.ui.toast(keptToast(picked.choice))
    }

    return picked.choice === 'conductor' ? conductor(true) : { result: standardResult('chosen') }
  })
}
