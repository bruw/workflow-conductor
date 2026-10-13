# Conductor: notes for agents

## Tests

The tests under `tests/` are live: one file per module, named after it (`tests/project-ops.test.ts` is `src/project/ops.ts`). They test logic through a module's exports (parse, ops, lints, reducers, layout invariants), and the run hooks against the engine. Do not test what is painted: no exact rows, glyphs or wording.

Verify a change with:

- `bun run check`: `claude plugin validate .`, `bunx tsc -p .` and `claude plugin test .`, all of which must pass with no error.
- Real paint: `scripts/dev-session.sh` starts Claude Code with this mod in tmux, `scripts/send.sh` sends keys, `scripts/capture.sh` prints the screen and the mod's debug lines.

## Compatibility

Conductor is unreleased, so every change to the project file (a key, a block type, a kind), to a command or to the tool for Claude is a **clean break**: rename it everywhere in one change, convert the saved projects under `.claude/workflow-conductor/` and the templates to the new form by hand in that same change, and let the parser accept the new form only.
