#!/usr/bin/env bun
// Prints the graph of a project as the pane would paint it, so its look can be reviewed with no live session.
//   bun scripts/render-graph.ts <template | project.json | stress case> [options]   (no argument: prints the names and the options)

import { readFileSync } from 'node:fs'
import { lint } from '../src/project/lints'
import { flatten, parseProject, readType, withGoal, withStart } from '../src/project/model'
import type { Project, ProjectNode, Kind, Knobs, NodeType } from '../src/project/model'
import type { Place } from '../src/project/ops'
import { TEMPLATES } from '../src/project/templates'
import type { NodeRun } from '../src/run/events'
import { layoutGraph, panTo } from '../src/ui/graph-layout'
import { paintGraph } from '../src/ui/graph-paint'
import type { RunOverlay, Span } from '../src/ui/graph-paint'

// `block` is a type, or a type and a kind: `agent`, `agent verify`.
function node(id: string, block: NodeType | `${NodeType} ${Kind}`, name: string, logic: string, knobs: Knobs = {}, children?: ProjectNode[]): ProjectNode {
  const [type, kind] = block.split(' ')
  const read = readType(type, kind)
  if ('error' in read) throw new Error(`${id}: ${read.error}`)
  const made: ProjectNode = { id, ...read, name }
  if (logic !== '') made.logic = logic
  if (Object.keys(knobs).length > 0) made.knobs = knobs
  if (children) made.children = children
  return made
}

function project(name: string, goal: string, nodes: ProjectNode[]): Project {
  return withGoal(withStart({ version: 1, name, nodes }), goal)
}

const LONG = 'Reads every source in full, however long, and writes down each claim that bears on the question together with the exact quote that supports it, the page or line it was found at, how confident the reader is in it and why, and which other claims it agrees or disagrees with, so that the checker after it has all it needs and never has to open the source again.'

export const STRESS: Record<string, () => Project> = {
  /** A stack with more arms than any width holds: the carousel. */
  'parallel-9': () =>
    project('nine-arms', 'One question, nine lenses at once, then one answer', [
      node('n1', 'agent', 'scope', 'Split the question into what each lens should look at.', { effort: 'low', output: '{ lenses: [{ name, focus }] }' }),
      node(
        'n2',
        'parallel',
        'lenses',
        'Every lens runs at once; the writer needs all nine.',
        {},
        ['correctness', 'security', 'performance', 'tests', 'docs', 'api shape', 'migrations', 'observability', 'cost'].map((lens, i) =>
          node(`n${i + 3}`, i === 4 ? 'agent verify' : 'agent', lens, `${i === 4 ? '3 votes: review' : 'Review'} the change for ${lens} only.`, { ...(i % 3 === 0 ? { model: 'sonnet' } : {}), output: '{ findings: [{ file, claim }] }' }),
        ),
      ),
      node('n12', 'agent', 'write up', 'One review from all nine lenses.', { model: 'opus', effort: 'high' }),
    ]),
  /** Containers nested six deep: the innermost ones are drawn collapsed until opened as the view. */
  'deep-6': () =>
    project('six-deep', 'A nest of containers, each inside the one before', [
      node('n1', 'pipeline', 'outer', '', { oncePer: '×4 areas' }, [
        node('n2', 'agent', 'plan area', 'Say what to look at in this area.', {}),
        node('n3', 'loop', 'rounds', '', { stopCondition: '2 dry rounds' }, [
          node('n4', 'parallel', 'finders', '', {}, [
            node('n5', 'pipeline', 'find and check', '', { oncePer: 'candidate files' }, [
              node('n6', 'agent', 'find', 'Look for the defect in this file.', { effort: 'low' }),
              node('n7', 'loop dry', 'dig', '', { stopCondition: '1 dry round' }, [
                node('n8', 'parallel sweep', 'angles', '', { oncePer: '3 angles' }, [node('n9', 'agent', 'probe', 'Try one way to trigger it.', {}), node('n10', 'agent verify', 'confirm', '2 votes: refute the trigger.', {})]),
                node('n11', 'code', 'dedupe', 'Drop repeats.', {}),
              ]),
            ]),
            node('n12', 'agent', 'grep sweep', 'A cheap textual pass over everything.', { model: 'haiku' }),
          ]),
          node('n13', 'agent critic', 'what is missing', 'Name the places nobody looked.', { output: '{ gaps[] }' }),
        ]),
      ]),
      node('n14', 'agent', 'report', 'Write up what was found, per area.', {}),
    ]),
  'branch-when': () =>
    project('research-answer', 'Answer a question from many sources: search, read, check gaps, write up.', [
      node('n1', 'pipeline', 'Deep read', '', { oncePer: 'deduped sources' }, [
        node('n2', 'agent', 'Search', 'Find relevant sources.', { model: 'haiku', effort: 'low', output: 'sources' }),
        node('n3', 'agent verify', 'Check claims', '2 votes: try to refute the claims.', { model: 'sonnet', effort: 'high', output: 'verdict + reason' }),
        node('n4', 'agent', 'Read source', 'Extract claims with evidence.', { model: 'sonnet', effort: 'high', output: 'claims + quotes + confidence' }),
        node('n5', 'parallel sweep', 'Multi-modal sweep', '', { oncePer: '4 search directions' }, []),
      ]),
      node('n6', 'branch', 'Choose response', '', {}, [
        node('n7', 'agent', 'Write answer', '', { model: 'opus', effort: 'high', condition: 'the claims cover the question' }),
        node('n8', 'agent', 'Ask the user', 'Say what is unclear and ask one question.', {}),
        node('n9', 'loop', 'Close gaps', '', {}, [node('n10', 'agent', 'Investigate gaps', '', { model: 'sonnet', effort: 'high' })]),
      ]),
    ]),
  empty: () => project('nothing-yet', '', []),
  'empty-container': () =>
    project('one-empty-box', 'A container with nothing in it yet', [
      node('n1', 'agent', 'before', 'Something to do first.', {}),
      node('n2', 'pipeline', 'Per file', '', { oncePer: 'changed files' }, []),
      node('n3', 'branch', 'Pick', '', {}, []),
    ]),
  /** Titles, notes, knobs and conditions far longer than any card. */
  long: () =>
    project('a-project-whose-name-is-much-longer-than-a-project-name-has-any-business-being', LONG, [
      node('n1', 'agent', 'Read every single source from the first page to the last and extract all of the claims', LONG, { model: 'claude-opus-with-a-very-long-custom-model-name', effort: 'xhigh', output: '{ claims: [{ claim, quote, page, line, confidence, why, agrees_with[], disagrees_with[] }] }', oncePer: 'each of the deduped sources that survived the first two filters' }),
      node('n2', 'pipeline', 'A pipeline with a title that goes on and on well past the width of its own border', LONG, { oncePer: '×12 of the sources that the reader before it marked as worth a second and slower look', output: '{ verdicts[] }' }, [
        node('n3', 'agent verify', 'Refute each and every claim against the quoted source text, defaulting to refuted', `5 votes. ${LONG}\n\nSecond paragraph: ${LONG}`, { model: 'sonnet', output: '{ refuted: boolean, reason: string, quote: string }' }),
        node('n4', 'branch', 'Decide what happens to the claim next, by its verdict', '', {}, [
          node('n5', 'agent', 'Keep', 'Supercalifragilisticexpialidocious-and-then-some-unbroken-word-that-cannot-wrap-anywhere-at-all', { condition: 'at least two of the three checkers failed to refute it and the quote is verbatim in the source' }),
          node('n6', 'code', 'Drop it and log why it was dropped', '', {}),
        ]),
      ]),
    ]),
}

/** Theme keys as terminal colours, near enough to the dark theme to judge the look. */
const ANSI: Record<string, string> = {
  text: '39',
  subtle: '38;5;239',
  inactive: '38;5;246',
  claude: '38;5;209',
  error: '38;5;203',
  success: '38;5;78',
  warning: '38;5;220',
  suggestion: '38;5;111',
  autoAccept: '38;5;141',
  planMode: '38;5;37',
  bashBorder: '38;5;205',
  merged: '38;5;135',
  ide: '38;5;74',
  permission: '38;5;105',
}

/** A phase's ground, as it looks in the dock of the dark theme: a step darker than what is around it. */
const GROUND = '48;5;233'

function ansi(spans: readonly Span[]): string {
  return spans
    .map(span => {
      const codes = [span.color ? (ANSI[span.color] ?? '39') : '', span.ground ? GROUND : '', span.bold ? '1' : '', span.inverse ? '7' : ''].filter(code => code !== '')
      return codes.length > 0 ? `\u001b[${codes.join(';')}m${span.text}\u001b[0m` : span.text
    })
    .join('')
}

function load(name: string): Project {
  const template = TEMPLATES.find(one => one.id === name)
  if (template) return template.make()
  const stress = STRESS[name]
  // As the pane has them: every project opens with its start block.
  if (stress) return withStart(stress())
  const parsed = parseProject(readFileSync(name, 'utf8'))
  if (!parsed.ok) throw new Error(`${name}: ${parsed.error}`)
  return parsed.project
}

function fakeRun(made: Project): RunOverlay {
  const byNode: Record<string, NodeRun> = {}
  const leaves = flatten(made).filter(row => row.node.children === undefined)
  for (const [i, row] of leaves.slice(0, -1).entries()) byNode[row.node.id] = { total: 4, running: 0, done: i === 1 ? 3 : 4, failed: i === 1 ? 1 : 0, tokens: 10200 * (i + 1) }
  return { status: 'done', byNode, unmapped: null }
}

function main(): void {
  const args = process.argv.slice(2)
  const names: string[] = []
  const flags = new Set<string>()
  const values: Record<string, string[]> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (!arg.startsWith('--')) names.push(arg)
    else if (['--ansi', '--full', '--run', '--no-lints', '--list', '--quiet'].includes(arg)) flags.add(arg)
    else (values[arg] ??= []).push(args[++i] ?? '')
  }
  const all = [...TEMPLATES.map(one => one.id), ...Object.keys(STRESS)]
  const name = names[0]
  if (flags.has('--list') || name === undefined) {
    console.log(`usage: bun scripts/render-graph.ts <${all.join(' | ')} | project.json> [--cols N] [--rows N] [--select id] [--view id] [--scroll id=n] [--open p:i] [--hover p:i] [--quiet] [--pan N] [--full] [--run] [--no-lints] [--ansi]`)
    process.exit(name === undefined && !flags.has('--list') ? 1 : 0)
  }
  const made = load(name)
  const one = (flag: string): string | undefined => values[flag]?.at(-1)
  const columns = Number(one('--cols') ?? 120)
  const rows = Number(one('--rows') ?? 45)
  const scroll: Record<string, number> = {}
  for (const pair of values['--scroll'] ?? []) {
    const [id, first] = pair.split('=')
    if (id) scroll[id] = Number(first ?? 0)
  }
  const place = (flag: string): Place | null => {
    const [parent, index] = one(flag)?.split(':') ?? []
    if (parent === undefined) return null
    return parent === 'top' || parent === '' ? { index: Number(index ?? 0) } : { parentId: parent, index: Number(index ?? 0) }
  }
  const openAt = place('--open')
  const problems: Record<string, number> = {}
  if (!flags.has('--no-lints')) for (const found of lint(made)) problems[found.nodeId] = (problems[found.nodeId] ?? 0) + 1

  const selectedId = one('--select') ?? null
  const layout = layoutGraph(made, { columns, rows, selectedId, viewRootId: one('--view') ?? null, scroll, problems, openAt })
  const window = flags.has('--full') ? layout.height + layout.top : rows
  const panY = flags.has('--full') ? 0 : one('--pan') !== undefined ? Number(one('--pan')) : panTo(layout, window, 0, selectedId)
  const painted = paintGraph(layout, { columns, rows: window, panY, hoverAt: place('--hover'), quiet: flags.has('--quiet'), ...(flags.has('--run') ? { run: fakeRun(made), locked: true } : {}) })
  const wide = painted.findIndex(line => line.reduce((sum, span) => sum + span.text.length, 0) > columns)
  for (const line of painted) console.log(flags.has('--ansi') ? ansi(line) : line.map(span => span.text).join('').replace(/\s+$/, ''))
  const kept = Object.entries(layout.scroll).map(([id, first]) => `${id}=${first}`).join(' ')
  console.error(`${made.name} · ${columns}×${rows} · graph ${layout.width}×${layout.height} · pan ${panY}${layout.viewRootId ? ` · view ${layout.viewRootId}` : ''}${kept ? ` · scroll ${kept}` : ''}${wide >= 0 ? ` · ROW ${wide} IS WIDER THAN ${columns}` : ''}`)
}

if (import.meta.main) main()
