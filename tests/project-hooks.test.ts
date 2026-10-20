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

test("an edit is refused, not saved, once another session saved the project since this one loaded it", async ($, on) => {
  const files = new Map<string, string>()
  const path = '/work/.claude/workflow-conductor/demo.json'
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', async () => ({ value: [] }))
  on('fs.exists', async (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', async (_$, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`no file ${e.path}`)

    return { value: text }
  })
  on('fs.write', async (_$, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.list', async () => ({ value: [] }))
  on('session.root', async () => ({ value: '/work' }))
  on('tool.register', async (_$, e) => ({ value: { tool: e.name } }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const apply = (name: string) => $.tool.call({ tool: 'mcp__workflow-conductor__project', action: 'apply', name: 'demo', ops: [{ op: 'add', type: 'agent', name }] })

  expect(await apply('first')).toHaveProperty('result')
  // The project is open on the board now; another session sharing the root saves a block of its own.
  const other = JSON.parse(files.get(path) ?? '{}')
  other.nodes.push({ id: 'n90', type: 'agent', name: 'from another session' })
  files.set(path, JSON.stringify(other))

  expect(await apply('second')).toHaveProperty('deny')
  expect(files.get(path)).toBe(JSON.stringify(other))
  // Read again, the next edit is made on what the other session saved, and keeps it.
  await $.tool.call({ tool: 'mcp__workflow-conductor__project', action: 'read', name: 'demo' })
  expect(await apply('third')).toHaveProperty('result')
  const names = JSON.parse(files.get(path) ?? '{}').nodes.map((node: { name: string }) => node.name)
  expect(names).toContain('from another session')
  expect(names).toContain('third')
  expect(names).not.toContain('second')
})

test('a write Claude made from an older read is refused once another session saved the project, with the board closed', async ($, on) => {
  const files = new Map<string, string>()
  const path = '/work/.claude/workflow-conductor/shared.json'
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', async () => ({ value: [] }))
  on('fs.exists', async (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', async (_$, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`no file ${e.path}`)

    return { value: text }
  })
  on('fs.write', async (_$, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.list', async () => ({ value: [] }))
  on('session.root', async () => ({ value: '/work' }))
  on('tool.register', async (_$, e) => ({ value: { tool: e.name } }))

  files.set(path, JSON.stringify({ version: 1, name: 'shared', nodes: [{ id: 'n1', type: 'agent', name: 'first' }] }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const call = (input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__workflow-conductor__project', name: 'shared', ...input })
  const write = (name: string) => call({ action: 'write', nodes: [{ type: 'agent', name }] })

  expect(await call({ action: 'read' })).toHaveProperty('result')
  const other = JSON.stringify({ version: 1, name: 'shared', nodes: [{ id: 'n1', type: 'agent', name: 'first' }, { id: 'n2', type: 'agent', name: 'from another session' }] })
  files.set(path, other)

  expect(await write('mine')).toHaveProperty('deny')
  expect(files.get(path)).toBe(other)
  await call({ action: 'read' })
  expect(await write('mine')).toHaveProperty('result')
})
