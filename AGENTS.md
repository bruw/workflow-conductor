# Conductor: notes for agents

## Tests

One test file per module under `tests/`, named after it (`tests/project-ops.test.ts` is `src/project/ops.ts`). Only test key logic and functionality, through a module's exports (parse, ops, lints, reducers, layout invariants) and run hooks against the engine. Do not test internal implementation or what is painted: no exact rows, glyphs or wording.

Verify a change with:

- `bun run check`: `claude plugin validate .`, `tsc -p .` and `claude plugin test .`, all of which must pass with no error. `tsc` needs `.claude-plugin/types/`, which Claude Code writes the first time it loads the mod (`claude --plugin-dir .`); run `bun install` first.
- Real paint (needs tmux and a logged-in `claude`): `scripts/dev-session.sh` starts Claude Code with this mod in tmux, `scripts/send.sh` sends keys, `scripts/capture.sh` prints the screen and the mod's debug lines.

CI (`.github/workflows/ci.yml`) runs the validation and the tests on every pull request. It cannot run `tsc`, so run the full check before you push.

## Releases

`main` is what an install gets. A change a user can see bumps `version` in `.claude-plugin/plugin.json` in the same pull request.

## Docs and comments

Write only what a reader cannot get from the code: the reason for a choice, an invariant, an engine fact, where a thing lives. This holds for comments and for `docs/` alike.

- **Present tense.** A doc describes the code as it stands. What was replaced, tried, asked for or seen in a session is history, and git keeps it.
- **Edit in place.** A change rewrites or deletes the lines it made stale, in the same change. A doc grows only when the code gained something a reader cannot see in it.
- **One home per fact.** State the fact itself where it is needed; do not cite doc files (`docs/…`, section numbers) from code or from other docs.
- **Comments:** one line saying why, only where the code cannot.
