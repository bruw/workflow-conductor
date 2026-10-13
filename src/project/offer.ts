// The offer: before Claude authors a workflow it calls a tool, and the tool asks the
// person whether to design it in Conductor first. The tool's name and description, the
// question, and what each answer tells Claude. The brief for a "Conductor" answer is
// chat.ts's (`offerBrief`), beside the draft's it shares its words with.
// Pure TypeScript: no `$`, no engine imports, no imports at all (handoff.ts names the tool).

/** The tool Claude drafts a project with: chat.ts `TOOL_FULL_NAME`, spelled again because chat.ts imports this file (by way of handoff.ts). */
const PROJECT_TOOL = 'mcp__conductor__project'

/** The tool's short name; the model calls it as `mcp__conductor__before_workflow`. */
export const OFFER_TOOL_NAME = 'before_workflow'
export const OFFER_TOOL_FULL_NAME = 'mcp__conductor__before_workflow'
/** Sent with every turn (the tool is not deferred, or Claude never finds it: API-NOTES S13, S14), so it stays this short. */
export const OFFER_TOOL_DESCRIPTION = 'Call this before authoring or running any Workflow script (multi-agent workflow); it asks the user how they want to proceed.'

export const OFFER_QUESTION = 'Design this workflow in Conductor first?'
/** The chip beside the question (12 characters at most). */
export const OFFER_HEADER = 'Workflow'
/** The four answers, in the order shown. The engine adds two rows of its own under them: free text, and a way out. */
export const OFFER_OPTIONS = ['Conductor', 'Standard', 'Always Standard', 'Always Conductor'] as const

export type OfferChoice = 'conductor' | 'standard'

/** What an answer picks, and whether it is kept for next time; null for anything else (text typed under the options). */
export function offerChoice(answer: string): { choice: OfferChoice; always: boolean } | null {
  if (answer === 'Conductor') return { choice: 'conductor', always: false }
  if (answer === 'Standard') return { choice: 'standard', always: false }
  if (answer === 'Always Conductor') return { choice: 'conductor', always: true }
  if (answer === 'Always Standard') return { choice: 'standard', always: true }
  return null
}

/**
 * A stored answer to a question the mod asks is kept in `$.store` under `ask.<question>`:
 * The start screen's `Ask again` row deletes every key that starts so, whichever question it belongs to.
 */
export const ASK_PREFIX = 'ask.'
/** The stored "Always" answer to the offer: an OfferChoice, or unset. */
export const OFFER_KEY = `${ASK_PREFIX}workflow`

export function storedChoice(value: unknown): OfferChoice | null {
  return value === 'conductor' || value === 'standard' ? value : null
}

/** Why the tool answers "standard": the person said so now or earlier, or the question is not theirs to be asked. */
export type StandardReason = 'chosen' | 'always' | 'handoff' | 'subagent' | 'headless'

const STANDARD_LEAD: Record<StandardReason, string> = {
  chosen: 'The user chose Standard.',
  always: 'The user chose Always Standard earlier, so they were not asked.',
  handoff: 'The user already designed this workflow in Conductor and approved it, so they were not asked.',
  subagent: 'The user is not asked from a subagent.',
  headless: 'Nobody is there to be asked in this session.',
}

export function standardResult(why: StandardReason): string {
  return `${STANDARD_LEAD[why]} Proceed the standard way: author the Workflow script and run it as you usually would.`
}

/** What the person says in chat after a question that got no choice is their answer: Claude acts on it, and the tool is not called for it again. */
const IN_CHAT = `Once they have answered in chat, act on that answer without calling this tool again: for a project to review first, draft one with ${PROJECT_TOOL} (action "write") and stop there; for the standard way, author the Workflow script and run it.`

/** Esc and the engine's "Chat about this" row arrive alike (API-NOTES S9), and so does an answer typed empty: no choice was made. */
export const DISMISSED_RESULT = `The user dismissed the question without choosing. Do not author or run a Workflow script yet: ask them in chat how they want to proceed. ${IN_CHAT}`

/** Text typed under the options is the person's answer in their own words. */
export function typedResult(text: string): string {
  return `The user picked none of the options and typed this instead: "${text.trim()}". Take it as what they said to you, and do not author or run a Workflow script unless it asks for one. ${IN_CHAT}`
}

/**
 * What the tool answers, with no question, while the project its last "Conductor" answer led to waits on the board
 * unapproved: Claude neither drafts again nor writes a script the board knows nothing of. `handoff` is what
 * `r` on the board tells Claude (handoff.ts): an approval given in chat is carried out by it.
 */
export function waitingResult(name: string, handoff: string): string {
  return [
    `The user was not asked: project "${name}", drafted when they chose Conductor here, is on the Conductor board and they have not approved it yet. They approve it on the board with r (Implement and Run). Which of these three is true decides what you do:`,
    `1. The user has not told you to run it: do not draft another project and do not author or run a Workflow script. Tell them the project waits on the board for their approval.`,
    `2. The user told you in chat to run it ("run it", "go ahead"): that is their approval of project "${name}" as it is on the board now. Do not draft again. Carry out the handoff below, which is what r on the board would have given you.`,
    '3. This call is for a different workflow than that project: call this tool once more, and the user is asked.',
    '',
    handoff,
  ].join('\n')
}

/**
 * What the tool answers, with no question, for a project the person handed off on the board (`r`, Implement and
 * Run): the hand-off itself. It comes this way because a prompt the mod sends carries no hidden context.
 */
export function handedResult(handoff: string): string {
  return ['The user was not asked: they approved this project on the Conductor board (Implement and Run). Carry out the handoff below.', '', handoff].join('\n')
}

/** What the person sees when an "Always" answer is kept. */
export function keptToast(choice: OfferChoice): string {
  return `conductor: always ${choice === 'conductor' ? 'Conductor' : 'Standard'} from now on · Ask again on the start screen undoes it`
}

export function resetText(cleared: number): string {
  return cleared === 0
    ? 'no "Always" or "Never" answer is stored: Conductor already asks'
    : `${cleared} stored ${cleared === 1 ? 'answer' : 'answers'} forgotten: Conductor asks again`
}

// The second question: a workflow that started with no project is asked about once it runs (run.tsx),
// whether to draw one of it. The brief for a "Visualize" answer is chat.ts's (`visualizeBrief`).

export const VISUALIZE_QUESTION = 'Visualize this run in Conductor?'
export const VISUALIZE_HEADER = 'Conductor'
export const VISUALIZE_OPTIONS = ['Visualize', 'Skip', 'Always visualize', 'Never visualize'] as const
/** The stored "Always" or "Never" answer to it: a VisualizeChoice, or unset. */
export const VISUALIZE_KEY = `${ASK_PREFIX}visualize`

export type VisualizeChoice = 'visualize' | 'skip'

/** What an answer picks, and whether it is kept; null for anything else (text typed under the options). */
export function visualizeChoice(answer: string): { choice: VisualizeChoice; always: boolean } | null {
  if (answer === 'Visualize') return { choice: 'visualize', always: false }
  if (answer === 'Skip') return { choice: 'skip', always: false }
  if (answer === 'Always visualize') return { choice: 'visualize', always: true }
  if (answer === 'Never visualize') return { choice: 'skip', always: true }
  return null
}

export function storedVisualize(value: unknown): VisualizeChoice | null {
  return value === 'visualize' || value === 'skip' ? value : null
}

export function visualizeToast(choice: VisualizeChoice): string {
  return `conductor: ${choice === 'visualize' ? 'always' : 'never'} visualize from now on · Ask again on the start screen undoes it`
}

/** Text typed under the options: the run goes on undrawn, and Claude is told what the person said. */
export function visualizeTyped(text: string): string {
  return `Conductor asked the user whether to visualize this run; they picked none of the options and typed this instead: "${text.trim()}". Take it as what they said to you. The workflow is running: leave it be unless they ask otherwise.`
}

/** What the person sees when a run is put on a saved project without a question. `placed` is false when the board could not open by itself. */
export function reusedToast(name: string, placed: boolean): string {
  return `conductor: this run is shown on project ${name}${placed ? '' : ' · above the prompt; /conductor opens the designer'}`
}
