import type { On } from 'claude-code'

import { offerBrief } from '../src/design/chat'
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
} from '../src/design/offer'
import type { Tracker } from '../src/run/tracker'

/** "Conductor" was answered and the draft it asks Claude for has not landed yet. A module variable: it lasts a turn. */
let offered = false

/** Whether the design being written is the one the person just asked for in the question; asking spends it. */
export const takeOffered = (): boolean => {
  const was = offered
  offered = false

  return was
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
    const kept = storedChoice(await $.store.get(OFFER_KEY).catch(() => undefined))
    if (kept !== null) return kept === 'conductor' ? conductor(false) : { result: standardResult('always') }

    let answer: string
    try {
      answer = await $.ui.ask(OFFER_QUESTION, { options: OFFER_OPTIONS, header: OFFER_HEADER })
    } catch {
      return { result: DISMISSED_RESULT }
    }
    const picked = offerChoice(answer)
    if (picked === null) return { result: typedResult(answer) }
    if (picked.always) {
      await $.store.set(OFFER_KEY, picked.choice).catch(() => undefined)
      $.ui.toast(keptToast(picked.choice))
    }

    return picked.choice === 'conductor' ? conductor(true) : { result: standardResult('chosen') }
  })
}
