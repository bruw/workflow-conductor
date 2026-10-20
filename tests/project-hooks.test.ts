import { expect, test } from 'claude-code/testing'

const SHELL = { plugin: 'workflow-conductor', key: 'shell' } as const
const BAND = {
  plugin: 'workflow-conductor',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

test('the minimized strip keeps what is drawn beneath it in the band', async ($, on) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', async () => ({ value: [] }))
  // The designer minimized, as `/conductor min` leaves it.
  on('state.get', SHELL, async () => ({ value: { value: { minimized: 'person' as const, why: null }, version: 1 } }))
  // What the engine, or another plugin, draws in the band.
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Text' as const, props: {}, children: ['beneath the strip'] }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'conductor-expand' })).toBeDefined()
    expect(await ui.find({ text: 'beneath the strip' })).toBeDefined()
    await ui.unmount()
  }
})
