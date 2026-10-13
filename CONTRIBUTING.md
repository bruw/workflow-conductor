# Contributing

Open an issue before a large change. For a pull request:

- `bun install`, then `bun run check` must pass. CI cannot run `tsc`, so run it locally before you push.
- A change a user can see bumps `version` in `.claude-plugin/plugin.json` in the same pull request.
- `AGENTS.md` holds the conventions for tests, docs and comments.

Report security issues as described in `SECURITY.md`, not in a public issue.
