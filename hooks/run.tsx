import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { visualizeBrief } from '../src/project/chat'
import { LAST_SCRIPTS_STORE, lastScripts, noteScript, saveAsk, savedWorkflowFile } from '../src/project/handoff'
import { parseProject } from '../src/project/model'
import {
  SAVE_HEADER,
  SAVE_OPTIONS,
  VISUALIZE_HEADER,
  VISUALIZE_OPTIONS,
  VISUALIZE_QUESTION,
  reusedToast,
  saveChoice,
  saveFailedToast,
  saveQuestion,
  savedToast,
  visualizeChoice,
  visualizeTyped,
} from '../src/project/offer'
import { PROJECT_PANE_ID, bareTarget, projectFile, projectName, endRun, followRun, handoffOf, initialTimes, initialUi, isSaved, stampTimes } from '../src/project/session'
import { emptyRunState } from '../src/run/events'
import type { RunState } from '../src/run/events'
import { usageTotal } from '../src/run/journal'
import type { Handoff, RunEnded, Tracker } from '../src/run/tracker'
import { buildRunRows, togglePhase } from '../src/ui/rail'
import type { Part, Row } from '../src/ui/rail'
import { initialShell } from '../src/ui/compact'
import { FADED, GLYPH, PANE_ID, PANE_TITLE, TEXT } from '../src/ui/theme'

import { paneArgs, runBoardOf } from './project'
import { offerRan, offerSettled } from './offer'

const PLACEHOLDER = 'no workflow running yet'
const MAX_WIDTH = 96
const MAX_ROWS = 400
// Both hooks modules declare the run's atoms (an atom must be spelled in the file that reads it):
// run.tsx writes them through the tracker, project.tsx reads them.
const runAtom = atom({ plugin: 'workflow-conductor', key: 'run' } as const, emptyRunState())
const clockAtom = atom({ plugin: 'workflow-conductor', key: 'runClock' } as const, 0)
/** The project the tracked run belongs to (handed off, or named as it); null for any other run. */
const runProjectAtom = atom({ plugin: 'workflow-conductor', key: 'runProject' } as const, null)
const uiAtom = atom({ plugin: 'workflow-conductor', key: 'runUi' } as const, { expanded: [], collapsed: [] })
/** When the run began and ended: stamped as its state is written. */
const timesAtom = atom({ plugin: 'workflow-conductor', key: 'runTimes' } as const, initialTimes())
/** The tracked run's script file, and the project drawn of that run after it started (project.tsx `attach` sets it). */
const runScriptAtom = atom({ plugin: 'workflow-conductor', key: 'runScript' } as const, null)
// The designer's state (project.tsx owns it): read and written here only so the selection can follow the run.
const projectAtom = atom({ plugin: 'workflow-conductor', key: 'project' } as const, null)
const projectUiAtom = atom({ plugin: 'workflow-conductor', key: 'projectUi' } as const, initialUi())
/** Where the designer is (project.tsx owns it): written here only so a run whose pane could not open is shown in the band. */
const shellAtom = atom({ plugin: 'workflow-conductor', key: 'shell' } as const, initialShell())

// The reducer leaves optional fields present but undefined; the stored copy is plain data.
const plain = (state: RunState): RunState => JSON.parse(JSON.stringify(state)) as RunState

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)

/** Runs the main conversation started: a subagent's run is not the person's to be asked about. */
const ownRuns = new Set<string>()
/** A run that ended, held until the main loop's turn ends, so the question does not cut into Claude's reply to the notice. */
let saveDue: RunEnded | undefined

const textOf = ($: EngineInterface, path: string): Promise<string | null> =>
  $.fs.read(path).then(
    body => (typeof body === 'string' ? body : null),
    () => null,
  )

/** Asks whether a project's run's script goes into the repository; on yes the mod copies it itself, so no tool of Claude's writes there. Never throws. */
const offerSave = async ($: EngineInterface, end: RunEnded): Promise<void> => {
  const name = end.project
  const ran = await read($, runScriptAtom)
  if (name === undefined || ran === null || ran.runId !== end.runId) return
  const root = await $.session.root()
  const file = savedWorkflowFile(root, name)
  const surfaces = await $.session.surfaces().catch(() => undefined)
  const answerable = ownRuns.has(end.runId) && (surfaces === undefined || surfaces.length > 0)
  const script = await textOf($, ran.path)
  const ask = saveAsk({ ending: end.ending, project: name, script, copy: await textOf($, file), answerable })
  if (ask === null || script === null) return
  let said: string
  try {
    said = await $.ui.ask(saveQuestion(name, ask === 'update'), { options: SAVE_OPTIONS, header: SAVE_HEADER })
  } catch {
    return
  }
  if (saveChoice(said) !== 'save') return
  try {
    await $.fs.write(file, script)
    $.ui.toast(savedToast(name, file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file))
  } catch (error) {
    $.ui.toast(saveFailedToast(error instanceof Error ? error.message : String(error)))
  }
}

export const registerRun = (on: On, tracker: Tracker): void => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'conductor',
      description: 'Workflow designer and run view: no argument opens the board (a run in progress, the project last opened, or the start screen to pick one); with a description, Claude drafts a new project for it; min and max move the designer between its pane and the band above the prompt',
      argumentHint: '[what the workflow should do | min | max]',
    })

    // A run a previous load of the module was following: its project's node ids are not stored, so the project file is read again.
    const stored = await read($, runAtom)
    const attached = stored.status === 'idle' ? null : await read($, runProjectAtom)
    let claim: Handoff | undefined
    if (attached !== null) {
      const body = await $.fs.read(projectFile(await $.session.root(), attached)).catch(() => '')
      const parsed = parseProject(typeof body === 'string' ? body : '')
      if (parsed.ok) claim = handoffOf(attached, parsed.project)
    }

    // The tracker's only way out: every `$` call it causes is spelled here. Its timers
    // outlive this hook, as a `$.clock` callback does.
    tracker.attach(
      {
        write: async state => {
          await update($, runAtom, () => plain(state))
          const now = await $.clock.now()
          const times = await read($, timesAtom)
          if (stampTimes(times, state, now) !== times) await update($, timesAtom, held => stampTimes(held, state, now))
          // The designer's selection follows the block that is running, until the person moves it.
          const name = await read($, runProjectAtom)
          if (name === null || state.status === 'idle') return
          const project = await read($, projectAtom)
          const shown = await read($, projectUiAtom)
          // Over: the selection goes to the first block with a failure, once.
          const settle = state.status === 'running' ? followRun : endRun
          if (settle(shown, project, state, name) !== shown) await update($, projectUiAtom, held => settle(held, project, state, name))
        },
        frame: async tick => {
          await update($, clockAtom, () => tick)
          // The elapsed time in the designer's header: stamped here, about once a second, so no drawing reads a clock.
          const now = await $.clock.now()
          const times = await read($, timesAtom)
          if (stampTimes(times, tracker.state(), now) !== times) await update($, timesAtom, held => stampTimes(held, tracker.state(), now))
        },
        readText: async path => {
          const body = await $.fs.read(path)

          return typeof body === 'string' ? body : ''
        },
        every: (ms, fn) => $.clock.every(ms, fn),
        after: (ms, fn) => $.clock.after(ms, fn),
        // Either pane shows the run (the run view, or the designer with the run laid over it), and so does the band above the prompt while the designer is minimized.
        paneShown: async () => (await read($, shellAtom)).minimized !== 'no' || (await $.ui.panes()).some(pane => (pane.id === PANE_ID || pane.id === PROJECT_PANE_ID) && pane.isShown && pane.isPlaced),
        project: name => update($, runProjectAtom, () => name),
        ended: end => {
          saveDue = end
        },
        status: line => $.ui.status(line),
        toast: line => $.ui.toast(line),
      },
      stored,
      claim,
    )

    return next(e)
  })

  on('command.run', { command: 'conductor' }, async ($, e, next) => {
    // With words it is a draft, and project.tsx's, whichever of the hooks the engine asks first.
    if (e.args.trim() !== '') return next(e)
    // A run that came from a project is shown on that project, and with no run there is nothing to show here: both are project.tsx's.
    if (bareTarget((await read($, runAtom)).status, await read($, runProjectAtom), await read($, projectUiAtom)).view === 'project') return next(e)
    const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    if (opened.isPlaced) tracker.paneOpened()

    return { text: 'Conductor pane opened.' }
  })

  // A run named as a saved project is that project's, handed off or not; one a handoff waited for is that project's under any name.
  // A run no project claimed is asked about, the turn held meanwhile. Whatever follows the start, the tool's result goes back: never a throw.
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const answer = await next(e)
    const result = (answer as { result?: unknown }).result
    if (result === null || typeof result !== 'object') return answer
    const { runId, taskId, workflowName, transcriptDir, scriptPath } = result as Record<string, unknown>
    const id = text(runId)
    if (id === undefined) return answer
    const workflow = text(workflowName)
    if (e.agentId === undefined) ownRuns.add(id)
    // The board is on the run's project before the tracker places an agent on it. Never a throw: a run is tracked all the same.
    const board = runBoardOf()
    const own = (await board?.projectOfRun(workflow).catch(() => null)) ?? null
    tracker.runStarted({ runId: id, name: workflow, transcriptDir: text(transcriptDir), taskId: text(taskId), project: own === null ? undefined : handoffOf(own.name, own.project) })

    try {
      // The script is the file the result names, in every form of the call. A run started again keeps its drawing.
      const script = text(scriptPath)
      await update($, runScriptAtom, held => (script === undefined ? null : { runId: id, path: script, drawn: held !== null && held.runId === id ? held.drawn : null }))
      const claimed = tracker.project()
      if (claimed !== undefined) {
        offerSettled(claimed)
        // Out of a handoff the script is the project's as of now, for the next handoff to start from.
        if (script !== undefined && isSaved(claimed)) {
          const stored = await $.store.get(LAST_SCRIPTS_STORE).catch(() => undefined)
          const kept = lastScripts(stored)[claimed]
          const replace = tracker.handedOff() || (kept !== undefined && !(await $.fs.exists(kept).catch(() => true)))
          const noted = noteScript(stored, claimed, script, replace)
          if (noted[claimed] === script) offerRan(claimed, { runId: id, transcriptDir: text(transcriptDir) })
          await $.store.set(LAST_SCRIPTS_STORE, noted).catch(() => undefined)
        }
        // Where nobody handed the project off, a toast says where the run went.
        if (own !== null) {
          const pane = await $.ui.open(paneArgs(false)).catch(() => undefined)
          // Not placed (nobody asked, a narrow terminal): the run is shown in the band above the prompt.
          if (pane?.isPlaced === false) await update($, shellAtom, held => (held.minimized === 'no' ? { minimized: 'auto' as const, why: 'narrow' as const } : held))
          if (!tracker.handedOff()) $.ui.toast(reusedToast(own.name, pane?.isPlaced !== false))
        }

        return answer
      }
      // A subagent's workflow is not the person's to be asked about; nor is one where nobody reads a question.
      if (e.agentId !== undefined || answer.deny !== undefined || answer.isError === true) return answer
      const surfaces = await $.session.surfaces().catch(() => undefined)
      if (surfaces !== undefined && surfaces.length === 0) return answer
      // With no script file there is nothing to draw a project of.
      if (script === undefined) return answer
      let said: string
      try {
        said = await $.ui.ask(VISUALIZE_QUESTION, { options: VISUALIZE_OPTIONS, header: VISUALIZE_HEADER })
      } catch {
        return answer
      }
      const choice = visualizeChoice(said)
      if (choice === null) return said.trim() === '' ? answer : { ...answer, context: [...(answer.context ?? []), visualizeTyped(said)] }

      return choice === 'skip' ? answer : { ...answer, context: [...(answer.context ?? []), visualizeBrief(script, workflow === undefined ? undefined : (projectName(workflow) ?? undefined))] }
    } catch {
      return answer
    }
  })

  // Only a workflow's agents carry `e.workflow`; the id is on what `next` resolves to.
  on('agent.spawn', async (_$, e, next) => {
    const answer = await next(e)
    const agentId = e.workflow ? text((answer as { agentId?: unknown }).agentId) : undefined
    if (e.workflow && agentId !== undefined) {
      tracker.agentSpawned({ runId: e.workflow.runId, agentId, label: e.description, index: e.workflow.agentIndex })
    }

    return answer
  })

  // Runs on every loop: each chunk goes through untouched, the last one is read.
  on('turn.step', async function* (_$, e, next) {
    for await (const chunk of next(e)) {
      if (chunk.kind === 'stop' && e.agentId !== undefined) tracker.agentUsage(e.agentId, usageTotal(chunk.usage))
      yield chunk
    }
  })

  on('turn.complete', async ($, e, next) => {
    // The main loop's turn after a run's end: the question, from a timer so the turn's end is not held while it is up.
    if (e.agentId === undefined && saveDue !== undefined) {
      const end = saveDue
      saveDue = undefined
      $.clock.after(0, () => void offerSave($, end))
    }
    if (e.agentId !== undefined) {
      tracker.agentEnded(e.agentId, {
        ok: !e.isAborted && e.reason !== 'error' && e.reason !== 'refusal',
        aborted: e.isAborted,
        durationMs: e.durationMs,
      })
    }

    return next(e)
  })

  // A stopped run gets no notice; Claude's stop of its task is the one sign of it there is, besides its agents' aborted ends.
  on('tool.call', { tool: 'TaskStop' }, async (_$, e, next) => {
    const answer = await next(e)
    const stopped = text((answer as { result?: { task_id?: unknown } }).result?.task_id)
    if (stopped !== undefined && answer.deny === undefined && answer.isError !== true) tracker.taskEnded(stopped, 'killed')

    return answer
  })

  // The run's end: the engine's notice of its task, as the transcript draws it, passed on untouched and drawn again on every redraw.
  // Told from a timer: no state is written while a render hook draws.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const task = e.props.task
    if (e.props.origin.kind === 'task-notification' && task?.id !== undefined && task.status !== undefined) {
      const { id, status, durationMs } = task
      $.clock.after(0, () => tracker.taskEnded(id, status, durationMs))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, runAtom)
    const ui = await read($, uiAtom)
    const now = await read($, clockAtom)
    const rows = buildRunRows(state, {
      expanded: new Set(ui.expanded),
      collapsed: new Set(ui.collapsed),
      now,
      width: Math.min(MAX_WIDTH, e.props.bodyColumns),
    })

    const span = (part: Part) => (
      <Text color={part.color ?? TEXT} bold={part.bold}>
        {part.text}
      </Text>
    )
    const draw = (row: Row) => {
      const phase = row.phase
      if (row.kind !== 'phase' || phase === undefined) return <Text wrap="truncate-end">{row.parts.map(span)}</Text>
      const isOpen = row.open === true

      // Keyed by the phase, not its text: the counts in the label change, the address must not.
      return (
        <Button key={row.key} plain onPress={() => update($, uiAtom, held => togglePhase(held, phase, isOpen))}>
          {row.parts.map(span)}
        </Button>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold color={TEXT}>{`${GLYPH.diamond} ${PANE_TITLE}`}</Text>
        {rows.length === 0 && <Text color={FADED}>{`${GLYPH.railEnd} ${PLACEHOLDER}`}</Text>}
        {rows.slice(0, MAX_ROWS).map(draw)}
        {rows.length > MAX_ROWS && <Text color={FADED}>{`… ${rows.length - MAX_ROWS} more rows`}</Text>}
      </Box>
    )
  })
}
