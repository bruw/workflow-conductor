# Conductor: notes for agents

## Tests

Do not write tests and do not run the test suite (`claude plugin test .`, `bun run check`) for this project. The files under `tests/` are stale; leave them alone.

Verify a change with:

- `claude plugin validate .` and `bunx tsc -p .` (errors under `tests/` are known and can be ignored).
- Real paint: `scripts/dev-session.sh` starts Claude Code with this mod in tmux, `scripts/send.sh` sends keys, `scripts/capture.sh` prints the screen and the mod's debug lines.

## Compatibility

Conductor is unreleased, so every change to the project file (a key, a block type, a kind), to a command or to the tool for Claude is a **clean break**: rename it everywhere in one change, convert the saved projects under `.claude/workflow-conductor/` and the templates to the new form by hand in that same change, and let the parser accept the new form only.
