// The offer: before Claude authors a workflow it calls a tool, and the tool asks the person whether to design it
// in Conductor first. No imports: chat.ts imports this file by way of handoff.ts.

/** chat.ts `TOOL_FULL_NAME`, spelled again because chat.ts imports this file. */
const PROJECT_TOOL = 'mcp__workflow-conductor__project'

export const OFFER_TOOL_NAME = 'before_workflow'
export const OFFER_TOOL_FULL_NAME = 'mcp__workflow-conductor__before_workflow'
/** Sent with every turn (the tool is not deferred, or Claude never finds it), so it stays this short. */
export const OFFER_TOOL_DESCRIPTION = 'Call this before authoring or running any Workflow script (multi-agent workflow); it asks the user how they want to proceed.'

export const OFFER_QUESTION = 'Design this workflow in Conductor first?'
/** The chip beside the question: 12 characters at most. */
export const OFFER_HEADER = 'Workflow'
/** The engine adds two rows of its own under them: free text, and a way out. */
export const OFFER_OPTIONS = ['Conductor', 'Standard'] as const

export type OfferChoice = 'conductor' | 'standard'

/** null for text typed under the options. */
export function offerChoice(answer: string): OfferChoice | null {
  if (answer === 'Conductor') return 'conductor'
  if (answer === 'Standard') return 'standard'
  return null
}

export type StandardReason = 'chosen' | 'handoff' | 'subagent' | 'headless'

const STANDARD_LEAD: Record<StandardReason, string> = {
  chosen: 'The user chose Standard.',
  handoff: 'The user already designed this workflow in Conductor and approved it, so they were not asked.',
  subagent: 'The user is not asked from a subagent.',
  headless: 'Nobody is there to be asked in this session.',
}

export function standardResult(why: StandardReason): string {
  return `${STANDARD_LEAD[why]} Proceed the standard way: author the Workflow script and run it as you usually would.`
}

const IN_CHAT = `Once they have answered in chat, act on that answer without calling this tool again: for a project to review first, draft one with ${PROJECT_TOOL} (action "write") and stop there; for the standard way, author the Workflow script and run it.`

/** Esc and the engine's "Chat about this" row arrive alike, and so does an answer typed empty: no choice was made. */
export const DISMISSED_RESULT = `The user dismissed the question without choosing. Do not author or run a Workflow script yet: ask them in chat how they want to proceed. ${IN_CHAT}`

export function typedResult(text: string): string {
  return `The user picked none of the options and typed this instead: "${text.trim()}". Take it as what they said to you, and do not author or run a Workflow script unless it asks for one. ${IN_CHAT}`
}

/** Answered with no question while the drafted project waits on the board unapproved; `handoff` carries out an approval given in chat. */
export function waitingResult(name: string, handoff: string): string {
  return [
    `The user was not asked: project "${name}", drafted when they chose Conductor here, is on the Conductor board and they have not approved it yet. They approve it on the board with r (Implement and Run). Which of these three is true decides what you do:`,
    `1. The user has not told you to proceed: do not draft another project and do not author or run a Workflow script. Tell them the project waits on the board for their approval.`,
    `2. The user told you in chat to proceed, in any words ("run it", "go ahead", "resume", "continue"): that is their approval of project "${name}" as it is on the board now. Do not draft again. Carry out the handoff below, which is what r on the board would have given you.`,
    '3. This call is for a different workflow than that project: call this tool once more, and the user is asked.',
    '',
    handoff,
  ].join('\n')
}

/** The hand-off comes as the tool's answer because a prompt the mod sends carries no hidden context. */
export function handedResult(handoff: string): string {
  return ['The user was not asked: they approved this project on the Conductor board (Implement and Run). Carry out the handoff below.', '', handoff].join('\n')
}

// The second question: a workflow that started with no project is asked, once it runs, whether to draw one of it.

export const VISUALIZE_QUESTION = 'Visualize this run in Conductor?'
export const VISUALIZE_HEADER = 'Conductor'
export const VISUALIZE_OPTIONS = ['Visualize', 'Skip'] as const

export type VisualizeChoice = 'visualize' | 'skip'

/** null for text typed under the options. */
export function visualizeChoice(answer: string): VisualizeChoice | null {
  if (answer === 'Visualize') return 'visualize'
  if (answer === 'Skip') return 'skip'
  return null
}

export function visualizeTyped(text: string): string {
  return `Conductor asked the user whether to visualize this run; they picked none of the options and typed this instead: "${text.trim()}". Take it as what they said to you. The workflow is running: leave it be unless they ask otherwise.`
}

/** `placed` is false when the board could not open by itself. */
export function reusedToast(name: string, placed: boolean): string {
  return `conductor: this run is shown on project ${name}${placed ? '' : ' · above the prompt; /conductor opens the designer'}`
}

// The third question: a project's run that ended done is asked whether its script goes into the repository, where anyone runs it by name.

/** `update`: a saved copy is there and differs from the script that ran. */
export function saveQuestion(name: string, update: boolean): string {
  return update ? `Update the saved workflow "${name}" in the repo with this run's script?` : `Save the workflow "${name}" to the repo, to run by name?`
}

export const SAVE_HEADER = 'Workflow'
export const SAVE_OPTIONS = ['Save to repo', 'Not now'] as const

export type SaveChoice = 'save' | 'skip'

/** null for text typed under the options. */
export function saveChoice(answer: string): SaveChoice | null {
  if (answer === 'Save to repo') return 'save'
  if (answer === 'Not now') return 'skip'
  return null
}

/** `file` relative to the session root. */
export function savedToast(name: string, file: string): string {
  return `conductor: saved ${file} · Workflow({ name: "${name}" }) runs it after /reload-plugins or in a new session`
}

export function saveFailedToast(reason: string): string {
  return `conductor: the workflow was not saved: ${reason}`
}
