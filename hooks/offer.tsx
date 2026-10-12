import type { On } from 'claude-code'

import { offerBrief } from '../src/design/chat'
import { buildHandoff } from '../src/design/handoff'
import { isBlank, parseDesign } from '../src/design/model'
import {
  ASK_PREFIX,
  ASK_USAGE,
  ASK_VERB,
  DISMISSED_RESULT,
  OFFER_HEADER,
  OFFER_KEY,
  OFFER_OPTIONS,
  OFFER_QUESTION,
  OFFER_TOOL_DESCRIPTION,
  OFFER_TOOL_FULL_NAME,
  OFFER_TOOL_NAME,
  keptToast,
  offerChoice,
  resetText,
  standardResult,
  storedChoice,
  typedResult,
  waitingResult,
} from '../src/design/offer'
import { designFile, scriptFile } from '../src/design/session'
import type { Tracker } from '../src/run/tracker'

/** "Conductor" was answered and the draft it asks Claude for has not landed yet. A module variable: it lasts a turn. */
let offered = false

/** Whether the design being written is the one the person just asked for in the question; asking spends it. */
export const takeOffered = (): boolean => {
  const was = offered
  offered = false

  return was
}

/**
 * The design the last "Conductor" answer led to, until it is handed off or run: while it waits on the board the question
 * is not asked again (Claude would draft a second design, or write a script the board knows nothing of).
 */
let waiting: string | null = null
/** The tool already answered in this turn that a design waits: a second call is for another workflow, and asks. */
let answered = false

/** The draft a "Conductor" answer asked for has landed, as design `name`. */
export const offerDrafted = (name: string): void => {
  waiting = name
}

/** Design `name` was handed off, or a run of it started: it waits for no approval. */
export const offerSettled = (name: string): void => {
  if (waiting === name) waiting = null
}

/** A prompt was sent: a "Conductor" answer whose draft never came is over with its turn, and so is what the tool said in it. */
export const offerPrompted = (): void => {
  offered = false
  answered = false
}

export const registerOffer = (on: On, tracker: Tracker): void => {
  // Not deferred: Claude calls a tool before a workflow only when its description is in front of it (API-NOTES S13, S14).
  // The matcher is always true: run.tsx holds the unmatched session.start, design.tsx the one on `cwd`.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    await $.tool.register({ name: OFFER_TOOL_NAME, description: OFFER_TOOL_DESCRIPTION, isDeferred: false })

    return next(e)
  })

  on('command.run', { command: 'conductor', args: ASK_VERB }, async ($, e) => {
    if (e.args.trim().split(/\s+/)[1] !== 'reset') return { text: ASK_USAGE }
    // Every stored answer goes, whichever question it was given to.
    const keys = (await $.store.keys().catch(() => [])).filter(key => key.startsWith(ASK_PREFIX))
    for (const key of keys) await $.store.delete(key).catch(() => undefined)

    return { text: resetText(keys.length) }
  })

  // The question. Whatever happens here Claude gets a result to act on, never a throw and never a deny (it does
  // not take instructions from a refusal).
  on('tool.call', { tool: OFFER_TOOL_FULL_NAME }, async ($, e) => {
    const conductor = (asked: boolean): { result: string } => {
      offered = true

      return { result: offerBrief(asked) }
    }
    // A workflow's own agents, and any subagent: the person is asked by the conversation, once.
    if (e.agentId !== undefined) return { result: standardResult('subagent') }
    // The script being written is the design the person approved on the board: that was their answer.
    if (tracker.awaitsRun()) return { result: standardResult('handoff') }
    // A `-p` run draws nowhere: nobody reads a question, and nobody would review a design.
    const surfaces = await $.session.surfaces().catch(() => undefined)
    if (surfaces !== undefined && surfaces.length === 0) return { result: standardResult('headless') }
    // The design drafted after the last "Conductor" answer still waits for the person: said once a turn, with what an
    // approval given in chat is carried out by. Gone, emptied or said already: the question is asked as for any workflow.
    if (waiting !== null && !answered) {
      const root = await $.session.root()
      const path = designFile(root, waiting)
      const parsed = parseDesign(await $.fs.read(path).catch(() => ''))
      if (parsed.ok && !isBlank(parsed.design)) {
        answered = true
        const script = scriptFile(root, waiting)

        return { result: waitingResult(waiting, buildHandoff(parsed.design, path, (await $.fs.exists(script).catch(() => false)) ? script : null).context.join('\n')) }
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
