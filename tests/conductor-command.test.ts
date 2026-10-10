import { expect, mock, test } from 'claude-code/testing'

import { serializeDesign } from '../src/design/model'
import { DESIGN_DIR, designFile } from '../src/design/session'
import { review } from '../src/design/templates'

const ROOT = '/project'
const RUN = { command: 'conductor', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const settle = async (clock: { advance: (ms: number) => Promise<unknown> }): Promise<void> => {
  await clock.advance(200)
  for (let turn = 0; turn < 50; turn++) await Promise.resolve()
}

type World = { submits: string[]; fills: string[]; toasts: string[]; opened: { id: string; focus?: true }[] }

test('/conductor dispatches design, run, list, replay and answers the rest with help', async ($, on) => {
  const files = new Map<string, string>([
    [designFile(ROOT, 'kept'), serializeDesign({ ...review(), name: 'kept' })],
    [designFile(ROOT, 'broken'), '{ "version": 1, "name": '],
    [designFile(ROOT, 'bare'), serializeDesign({ version: 1, name: 'bare', description: '', nodes: [] })],
  ])
  const world: World = { submits: [], fills: [], toasts: [], opened: [] }
  const registered: { name: string; argumentHint?: string; description: string }[] = []
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => {
    registered.push(e)

    return { value: { command: e.name } }
  })
  on('ui.panes', async () => ({ value: [] }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    world.opened.push({ id: e.id, focus: e.focus })

    return { value: { isPlaced: true } }
  })
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.list', (_$, e) => {
    if (e.path !== `${ROOT}/${DESIGN_DIR}`) throw new Error(`ENOENT ${e.path}`)

    return {
      value: [
        ...[...files.keys()].map(path => ({ name: path.slice(path.lastIndexOf('/') + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
        { name: 'notes.txt', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false },
        { name: 'old', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false },
      ],
    }
  })
  let submitWorks = true
  on('prompt.submit', (_$, e) => {
    if (!submitWorks) return { drop: 'refused here' }
    world.submits.push(e.text)

    return { text: e.text }
  })
  on('prompt.fill', (_$, e) => {
    world.fills.push(e.text)

    return { isFilled: true }
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  // One command, its subcommands in the hint; the old one is gone.
  expect(registered.map(one => one.name)).toEqual(['conductor'])
  expect(registered[0]?.argumentHint).toMatch(/design.*run.*list/)
  expect(registered[0]?.description).toMatch(/design/)

  // No argument: the run view.
  expect((await $.command.run({ ...RUN, args: '' })).text).toBe('Conductor pane opened.')
  expect(world.opened.at(-1)?.id).toBe('conductor')

  // design: the designer, with the keyboard.
  expect((await $.command.run({ ...RUN, args: 'design kept' })).text).toBe('Design kept opened.')
  expect(world.opened.at(-1)).toEqual({ id: 'conductor-design', focus: true })
  expect((await $.command.run({ ...RUN, args: 'design' })).text).toMatch(/No design named untitled yet/)
  expect((await $.command.run({ ...RUN, args: 'design broken' })).text).toMatch(/could not be opened/)

  // list: the saved designs, by name.
  expect((await $.command.run({ ...RUN, args: 'list' })).text).toBe(`Saved designs (${DESIGN_DIR}): bare, broken, kept`)

  // run: a missing, an invalid and an empty design hand nothing off.
  for (const [args, said] of [
    ['run', /Usage: \/conductor run <name>/],
    ['run nope', /No design named nope/],
    ['run broken', /not valid, nothing was handed off/],
    ['run bare', /is empty/],
  ] as const) {
    const refused = await $.command.run({ ...RUN, args })
    expect(refused.text).toMatch(said)
    expect(refused.context).toBe(undefined)
  }
  await settle(clock)
  expect(world.submits).toEqual([])
  expect(world.fills).toEqual([])

  // run: a valid design answers the conventions as context and submits a short prompt.
  const handed = await $.command.run({ ...RUN, args: 'run kept' })
  expect(handed.text).toBe('handing off design "kept" (5 nodes)')
  expect(handed.context).toHaveLength(1)
  expect(handed.context?.[0]).toContain(designFile(ROOT, 'kept'))
  expect(handed.context?.[0]).toContain('label: "<nodeId>: <short text>"')
  await settle(clock)
  expect(world.submits).toEqual(['Implement and run the "kept" workflow design.'])
  expect(world.fills).toEqual([])

  // run … fill: the prompt is left in the box instead.
  const filled = await $.command.run({ ...RUN, args: 'run kept fill' })
  expect(filled.text).toMatch(/press Enter/)
  expect(filled.context).toEqual(handed.context)
  expect(world.fills).toEqual(['Implement and run the "kept" workflow design.'])
  expect(world.submits).toHaveLength(1)

  // A refused submit falls back to the filled prompt.
  submitWorks = false
  expect((await $.command.run({ ...RUN, args: 'run kept' })).context).toEqual(handed.context)
  await settle(clock)
  expect(world.fills).toHaveLength(2)
  expect(world.toasts.at(-1)).toMatch(/press Enter/)

  // replay still answers; anything else is the help text.
  expect((await $.command.run({ ...RUN, args: 'replay nope' })).text).toMatch(/Usage: \/conductor replay/)
  const help = await $.command.run({ ...RUN, args: 'frobnicate' })
  for (const verb of ['design [name]', 'run <name>', 'list', 'replay']) expect(help.text).toContain(`/conductor ${verb}`)
  expect(help.context).toBe(undefined)
})
