import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { flatten } from '../src/design/model'
import type { Design } from '../src/design/model'
import { DESIGN_PANE_ID, DESIGN_PANE_TITLE, LOCK_NOTICE, RUN_KEYS_HINT, designFile } from '../src/design/session'
import type { DesignUi } from '../src/design/session'
import type { RunState } from '../src/run/events'
import { REPLAY_MS } from '../src/run/tracker'
import type { CanvasProps } from '../src/ui/canvas-model'
import { PANE_ID } from '../src/ui/theme'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/project'
const NAME = 'replay-review'
const PANE = { title: DESIGN_PANE_TITLE, isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const RUN = { command: 'conductor', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

type Seen = { design: Design | null; ui: DesignUi | undefined; run: RunState | undefined; runDesign: string | null | undefined }
type World = Seen & { files: Map<string, string>; toasts: string[]; opened: string[]; clock: { advance: (ms: number) => Promise<unknown> } }

const world = (on: On): World => {
  const seen: World = { design: null, ui: undefined, run: undefined, runDesign: undefined, files: new Map(), toasts: [], opened: [], clock: mock.clock(on) }
  on('state.set', (_$, e, next) => {
    if (e.plugin === 'conductor' && e.key === 'design') seen.design = e.value
    if (e.plugin === 'conductor' && e.key === 'designUi') seen.ui = e.value
    if (e.plugin === 'conductor' && e.key === 'run') seen.run = e.value
    if (e.plugin === 'conductor' && e.key === 'runDesign') seen.runDesign = e.value

    return next(e)
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', (_$, e) => ({ value: seen.files.has(e.path) }))
  on('fs.read', (_$, e) => ({ value: seen.files.get(e.path) ?? '' }))
  on('fs.write', (_$, e) => {
    seen.files.set(e.path, e.text)

    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.focus', () => ({}))

  return seen
}

const settle = async (clock: World['clock'], ms: number): Promise<void> => {
  await clock.advance(ms)
  for (let turn = 0; turn < 50; turn++) await Promise.resolve()
}

for (const surface of SURFACES) {
  test(`a replayed run is laid over its design: counts, agents, unmapped, on ${surface}`, async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })

    const answer = await $.command.run({ ...RUN, args: 'replay design review fast' })
    expect(answer.text).toMatch(/Replaying a made-up run over design replay-review \(fast\)/)
    await settle(seen.clock, 0)
    // The design was made from the template and saved; the run is recorded as its run.
    expect(seen.files.has(designFile(ROOT, NAME))).toBe(true)
    expect(seen.ui).toMatchObject({ status: 'ready', name: NAME, selectedId: 'n1' })
    expect(seen.opened).toEqual([DESIGN_PANE_ID])
    expect(seen.runDesign).toBe(NAME)
    expect(seen.run?.status).toBe('done')
    expect(seen.run?.unmapped).toHaveLength(2)
    expect(seen.toasts).toHaveLength(1)
    expect(seen.toasts[0]).toMatch(/^wf replay-review done: 13\/14 agents · 1 failed/)

    const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: DESIGN_PANE_ID, props: PANE })
    const props = (await ui.find({ type: 'Client' }))?.props.props as unknown as CanvasProps
    // Done: the overlay stays, the canvas is back in design mode.
    expect(props.mode).toBe('design')
    expect(props.run).toMatchObject({ status: 'done', byNode: { n1: { total: 3, done: 3 }, n3: { total: 2, failed: 1 }, n4: { total: 3 }, n5: { total: 4 } } })
    expect(props.run?.unmapped).toHaveLength(2)
    // Only the agents an open row lists: n3's (it failed) and the unmapped ones.
    expect(Object.values(props.run?.agents ?? {}).map(agent => agent.nodeId ?? '-').sort()).toEqual(['-', '-', 'n3', 'n3'])

    // Drawn: a counted node, the failed node opened to its agents, the unmapped group.
    const texts = async () => (await ui.findAll({ type: 'Text', in: 'canvas' })).filter(one => one.props.wrap === 'truncate-end').map(one => one.text ?? '')
    const lines = await texts()
    expect(lines[0]).toMatch(/^✓ n1 {2}scout diff +agent +█+ +3\/3 +\d+\.\dk$/)
    expect(lines[1]).toMatch(/^✗ n2 {2}review {2}×4 +pipeline +█+ +5\/5 +\d+\.\dk$/)
    expect(lines[2]).toMatch(/^│ {2}├ ✗ n3 {2}review +agent +█+ +2\/2 +\d+\.\dk$/)
    expect(lines[3]).toMatch(/^│ {2}│ {2}├ ✗ review 2 +\d+\.\dk$/)
    expect(lines[4]).toMatch(/^│ {2}│ {2}╰ ✓ review 1 +\d+\.\dk$/)
    expect(lines[5]).toMatch(/^│ {2}╰ ✓ n4 {2}adversarial verify {2}×3 votes +adversarial ver… █+ +3\/3 +\d+\.\dk$/)
    expect(lines[7]).toMatch(/^✓ unmapped {2}×2 +█+ +2\/2 +\d+\.\dk$/)
    expect(lines.at(-1)).toBe('╰─ + add')
    // Every count column ends at the same cell, a long title's too: its type gives way.
    const ends = [lines[0], lines[1], lines[2], lines[3], lines[5], lines[7]].map(line => [...(line ?? '')].length)
    expect(new Set(ends).size).toBe(1)
    expect(ends[0]).toBeLessThanOrEqual(PANE.bodyColumns)
    const mark = (await ui.findAll({ type: 'Text', in: 'canvas' })).find(one => one.text === '✗ ' && one.props.color === 'error')
    expect(mark).toBeDefined()

    // The agents key opens the selected node's list; again closes it.
    expect((await ui.findAll({ type: 'Button' })).map(one => one.key)).toContain('key:agents')
    await ui.press({ key: 'key:agents' })
    expect(seen.ui?.runUi).toEqual({ expanded: ['n1'], collapsed: [] })
    expect((await texts()).filter(line => /^│ {2}[├╰] ✓ scout diff \d/.test(line))).toHaveLength(3)
    await ui.press({ key: 'key:agents' })
    expect((await texts()).filter(line => /scout diff \d/.test(line))).toHaveLength(0)

    // No argument: the run is shown where its design is, not in the phase view.
    seen.opened.length = 0
    const one = await $.command.run({ ...RUN, args: '' })
    expect(one.text).toMatch(/Design replay-review opened with its run/)
    expect(seen.opened).toEqual([DESIGN_PANE_ID])
    // A run that came from no design goes back to the phase view, and the overlay is gone.
    await $.command.run({ ...RUN, args: 'replay review-41 fast' })
    await settle(seen.clock, 0)
    expect(seen.runDesign).toBe(null)
    seen.opened.length = 0
    expect((await $.command.run({ ...RUN, args: '' })).text).toBe('Conductor pane opened.')
    expect(seen.opened).toEqual([PANE_ID])
    const bare = (await ui.find({ type: 'Client' }))?.props.props as unknown as CanvasProps
    expect(bare.run).toBe(undefined)
    expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).not.toContain('key:agents')

    const usage = await $.command.run({ ...RUN, args: 'replay design nope' })
    expect(usage.text).toBe('Usage: /conductor replay design <review|research|migrate|judge-panel> [fast|slow]')
    await ui.unmount()
  })

  test(`editing is locked while the run is in progress and free again when it is done, on ${surface}`, async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await $.command.run({ ...RUN, args: 'replay design review slow' })
    const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: DESIGN_PANE_ID, props: PANE })
    await settle(seen.clock, REPLAY_MS / 2)

    expect(seen.run?.status).toBe('running')
    expect(seen.runDesign).toBe(NAME)
    const ids = () => flatten(seen.design ?? { version: 1, name: '', description: '', nodes: [] }).map(row => row.node.id)
    const saved = seen.files.get(designFile(ROOT, NAME))
    const props = async () => (await ui.find({ type: 'Client' }))?.props.props as unknown as CanvasProps
    expect(await props()).toMatchObject({ mode: 'run', grabbedId: null, run: { status: 'running' } })
    // The mode marker lights the side that is live.
    const lit = async () => (await ui.findAll({ type: 'Text' })).filter(one => (one.text === 'design' || one.text === 'run') && one.props.color === 'claude').map(one => one.text)
    expect(await lit()).toEqual(['run'])
    expect(await ui.find({ type: 'Text', text: LOCK_NOTICE })).toBe(undefined)
    // While the run is active a dim line says how the keyboard comes back to the pane.
    expect((await ui.find({ type: 'Text', text: RUN_KEYS_HINT }))?.props.color).toBe('subtle')

    // The toolbar's delete and add change nothing and say why, in one dim line.
    await ui.press({ key: 'key:remove' })
    expect(ids()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])
    expect(seen.ui).toMatchObject({ notice: LOCK_NOTICE, confirmId: null })
    expect((await ui.find({ type: 'Text', text: LOCK_NOTICE }))?.props.color).toBe('subtle')
    await ui.press({ key: 'key:addAfter' })
    expect(seen.ui).toMatchObject({ notice: LOCK_NOTICE, picker: null })
    expect(await ui.find({ type: 'Input', key: 'design-add' })).toBe(undefined)
    await ui.press({ key: 'key:grab' })
    expect(seen.ui?.grabbedId).toBe(null)
    // So do the canvas's own keys, and a rename from the inspector.
    await ui.key({ key: 'x' })
    await ui.key({ key: 'a' })
    expect(ids()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])
    expect(await ui.find({ type: 'Text', text: 'type a block name', in: 'canvas' })).toBe(undefined)
    await ui.input({ key: 'design-title', text: 'renamed' })
    expect(seen.design?.nodes[0]?.title).toBe('scout diff')
    expect(seen.files.get(designFile(ROOT, NAME))).toBe(saved)
    // Selection still moves; a click on a row opens its agents instead of selecting for edit.
    await ui.press({ key: 'key:down' })
    expect(seen.ui).toMatchObject({ selectedId: 'n2', notice: null })
    // The inspector has the fanout knob in full; the row shows only its count.
    expect(await ui.find({ type: 'Text', text: 'fanout: ×4 dimensions' })).toBeDefined()
    await ui.pointer({ type: 'down', x: 10, y: 0, button: 'left' })
    await ui.pointer({ type: 'up', x: 10, y: 0, button: 'left' })
    expect(seen.ui).toMatchObject({ selectedId: 'n1', runUi: { expanded: ['n1'], collapsed: [] } })
    expect(Object.values((await props()).run?.agents ?? {}).filter(agent => agent.nodeId === 'n1')).toHaveLength(3)

    // The run ends: one toast, design mode, and the same key now deletes.
    await settle(seen.clock, REPLAY_MS)
    expect(seen.run?.status).toBe('done')
    expect(seen.toasts).toHaveLength(1)
    expect(await props()).toMatchObject({ mode: 'design', run: { status: 'done' } })
    expect(await lit()).toEqual(['design'])
    expect(await ui.find({ type: 'Text', text: LOCK_NOTICE })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: RUN_KEYS_HINT })).toBe(undefined)
    await ui.press({ key: 'key:remove' })
    expect(ids()).toEqual(['n2', 'n3', 'n4', 'n5'])
    expect(seen.files.get(designFile(ROOT, NAME))).not.toBe(saved)
    await ui.unmount()
  })
}
