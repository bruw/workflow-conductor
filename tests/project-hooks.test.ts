import { expect, mock, type TestBody, test } from 'claude-code/testing'

const SHELL = { plugin: 'workflow-conductor', key: 'shell' } as const
const BAND = {
  plugin: 'workflow-conductor',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

/** Answers the lock a save takes, `mkdir` and `rmdir` of `<name>.lock`, over the directories it hands back. */
const lockDirs = (on: Parameters<TestBody>[1], made = new Map<string, number>()): Map<string, number> => {
  on('process.run', async (_$, e) => {
    const [verb, ...rest] = e.argv
    const dir = rest.at(-1) ?? ''
    const ok = { stdout: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (verb === 'mkdir' && rest[0] === '-p') return { value: { exitCode: 0, stderr: '', ...ok } }
    if (verb === 'mkdir' && made.has(dir)) return { value: { exitCode: 1, stderr: `mkdir: ${dir}: File exists`, ...ok } }
    if (verb === 'mkdir') made.set(dir, 0)
    if (verb === 'rmdir') made.delete(dir)

    return { value: { exitCode: 0, stderr: '', ...ok } }
  })
  on('fs.stat', async (_$, e) => {
    const at = made.get(e.path)
    if (at === undefined) throw new Error(`ENOENT ${e.path}`)

    return { value: { kind: 'dir' as const, size: 0, mtimeMs: at, isLink: false } }
  })

  return made
}

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
  lockDirs(on)
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
  lockDirs(on)
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

test('a board edit over a file that is no valid project is kept unsaved, and written over it only on f', async ($, on) => {
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
  lockDirs(on)
  on('session.root', async () => ({ value: '/work' }))
  on('tool.register', async (_$, e) => ({ value: { tool: e.name } }))
  const clock = mock.clock(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const apply = (name: string) => $.tool.call({ tool: 'mcp__workflow-conductor__project', action: 'apply', name: 'demo', ops: [{ op: 'add', type: 'agent', name }] })
  expect(await apply('first')).toHaveProperty('result')
  expect(await apply('second')).toHaveProperty('result')
  const second = JSON.parse(files.get(path) ?? '{}').nodes.find((node: { name: string }) => node.name === 'second').id
  const broken = '{ "version": 1, "nodes": ['
  files.set(path, broken)

  // Claude's edit is refused; the file stays as it is.
  expect(await apply('third')).toHaveProperty('deny')
  expect(files.get(path)).toBe(broken)

  const pane = await $.ui.mount({
    plugin: 'workflow-conductor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'conductor-project',
    props: { title: 'Conductor', isFocused: true, bodyColumns: 140, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    viewport: { columns: 200, rows: 50, isFullscreen: true },
  })
  // The splash gives way to the board.
  await clock.advance(10_000)
  await pane.post({ kind: 'select', id: second }, { in: 'canvas' })
  await pane.post({ kind: 'key', key: 'x' }, { in: 'canvas' })
  expect(files.get(path)).toBe(broken)

  await pane.post({ kind: 'key', key: 'f' }, { in: 'canvas' })
  const names = JSON.parse(files.get(path) ?? '{}').nodes.map((node: { name: string }) => node.name)
  expect(names).toContain('first')
  expect(names).not.toContain('second')
  await pane.unmount()
})

test("another session's save cannot land between a save's read and its write", async ($, on) => {
  const files = new Map<string, string>()
  const path = '/work/.claude/workflow-conductor/demo.json'
  const lock = '/work/.claude/workflow-conductor/demo.lock'
  let isRacing = false
  let isShutOut = false
  const locks = lockDirs(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', async () => ({ value: [] }))
  on('fs.exists', async (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', async (_$, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`no file ${e.path}`)
    // Another session saves a newer project now, taking the lock as every save does.
    if (isRacing && e.path === path) {
      isRacing = false
      if (locks.has(lock)) isShutOut = true
      else {
        const other = JSON.parse(text)
        other.nodes.push({ id: 'n90', type: 'agent', name: 'from another session' })
        files.set(path, JSON.stringify(other))
      }
    }

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

  isRacing = true
  expect(await apply('second')).toHaveProperty('result')
  // The other session met the lock and saved nothing, rather than saving what this write then replaced.
  expect(isShutOut).toBe(true)
  expect(JSON.parse(files.get(path) ?? '{}').nodes.map((node: { name: string }) => node.name)).toContain('second')
  expect(locks.has(lock)).toBe(false)
})

test('a save that cannot take the lock another session holds fails without writing', async ($, on) => {
  const files = new Map<string, string>()
  const path = '/work/.claude/workflow-conductor/demo.json'
  const lock = '/work/.claude/workflow-conductor/demo.lock'
  const clock = mock.clock(on, { now: 1_000_000 })
  const locks = lockDirs(on)
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
  const saved = files.get(path)

  locks.set(lock, clock.now())
  const refused = apply('second')
  await clock.advance(5_000)
  expect(await refused).toHaveProperty('deny')
  expect(files.get(path)).toBe(saved)
  expect(locks.has(lock)).toBe(true)

  // A lock left by a session that died mid-save is taken over.
  await clock.advance(60_000)
  expect(await apply('third')).toHaveProperty('result')
  expect(files.get(path)).not.toBe(saved)
})
