import { expect, mock, test } from 'claude-code/testing'

import { PANE_ID, PANE_TITLE } from '../src/ui/theme'

const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  title: PANE_TITLE,
  isFocused: false,
  bodyColumns: 72,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

const COMMAND = {
  command: 'conductor',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

for (const surface of SURFACES) {
  test(`pane draws a replayed run and opens a phase on ${surface}`, async ($, on) => {
    const toasts: string[] = []
    mock.clock(on)
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    on('command.register', async (_$, e) => ({ value: { command: e.name } }))
    on('ui.panes', async () => ({ value: [] }))
    on('ui.status', async () => ({ value: undefined }))
    on('ui.toast', async (_$, e) => {
      toasts.push(e.text)

      return { value: undefined }
    })

    await $.session.start({ cwd: '/work', surface, isInteractive: true })
    const answer = await $.command.run({ ...COMMAND, args: 'replay review-41 fast' })
    expect(answer.text).toMatch(/Replaying review-41 \(fast\)/)
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toMatch(/^wf review-41 done: 41\/41 agents · /)

    const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: PANE_ID, props: PANE })

    const header = await ui.find({ type: 'Text', text: 'wf: review-41' })
    expect(header?.text).toMatch(/^● wf: review-41 +done +41\/41 +\d+(\.\d)?k$/)
    expect([...(header?.text ?? '')].length).toBe(PANE.bodyColumns)

    const phases = await ui.findAll({ type: 'Button' })
    expect(phases.map(one => one.key)).toEqual(['phase:Review', 'phase:Foundation', 'phase:Triage', 'phase:Fix', 'phase:Integrate'])
    expect(phases[0]?.text).toMatch(/^◆ {2}Review {2}×12 +▕████████▏ +12\/12 +\d+\.\dk$/)
    expect(await ui.find({ type: 'Text', text: /╰─ 41 done/ })).toBeDefined()

    // Closed until pressed: a finished phase with no failure keeps its agents folded.
    expect(await ui.find({ type: 'Text', text: 'review:jobs' })).toBeUndefined()
    await ui.press({ key: 'phase:Review' })
    const agent = await ui.find({ type: 'Text', text: /✓ review:jobs/ })
    expect(agent?.text).toMatch(/^│ {2}├ ✓ review:jobs +\d+\.\dk$/)
    expect((await ui.findAll({ type: 'Text', text: /^│ {2}[├╰] ✓ review:/ })).length).toBe(12)
    expect(await ui.find({ type: 'Text', text: 'triage:' })).toBeUndefined()

    await ui.press({ key: 'phase:Review' })
    expect(await ui.find({ type: 'Text', text: 'review:jobs' })).toBeUndefined()
  })

  test(`pane shows one dim line with no run on ${surface}`, async ($, on) => {
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    on('command.register', async (_$, e) => ({ value: { command: e.name } }))
    await $.session.start({ cwd: '/work', surface, isInteractive: true })

    const ui = await $.ui.mount({ plugin: 'conductor', surface, component: 'Pane', requestId: PANE_ID, props: PANE })
    const dim = (await ui.findAll({ type: 'Text' })).filter(one => one.props.dimColor === true)

    expect(dim.map(one => one.text)).toEqual(['╰ no workflow running yet'])
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
  })
}

test('an unknown fixture answers the usage and replays nothing', async ($, on) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const answer = await $.command.run({ ...COMMAND, args: 'replay nope' })
  expect(answer.text).toBe('Usage: /conductor replay <review-41|partial-29|clear> [fast|slow]')
})
