# /repo-digest

A [Claude Code](https://claude.com/claude-code) skill that turns a month of your own git commits
into a single self-contained HTML report — **what moved, what cooled, what shipped** — read three
ways. Local git only: no network, no GitHub API, no telemetry.

It's the mirror of a usage report — not *how you used your tools*, but *what you made*.

## Install

```bash
claude plugins marketplace add kleer001/claude-slash-repo-digest && claude plugins install repo-digest
```

Needs `node` and `git` on your PATH.

## Use

Run it from your code root, or point it at one:

```
/repo-digest                 # last 30 days of the current directory's repos
/repo-digest --dir ~/code    # a specific code root
/repo-digest last-month      # the previous calendar month
/repo-digest 2026-05         # a specific month
/repo-digest --days 14       # any rolling window
```

Saves a `repo-digest_<from>_to_<to>.html` next to you. Open it in a browser; it prints to three pages.

## Three views, one dataset

- **Executive** — the narrative: what carried the month, what's new, what cooled, what shipped.
- **Grounded** — the honest read: churn and rework up front, net lines-of-code deliberately demoted
  (generated and data files make it lie).
- **Encouraging** — what you pulled off: shipped features, streaks, busiest day, new projects — and
  dormant repos reframed as "ready to revisit."

The report leads with **shipped features**, not commit count. Raw commits are motion, not delivery
(the same way lines-of-code is a ghost stat), so they're deliberately muted into small accents and a
reference table. Features are inferred from local git only — git tags and releases, `feat:`
conventional commits, feature-branch merges, and (softly) keyword-led subjects — each labeled by
confidence, and always read as an approximation (`~N`). A repo with no commit conventions honestly
reads zero features rather than a fabricated number.

Per repo it tracks **momentum** (accelerating · revived · new · steady · cooling · cooled) against
the prior window, plus shipped features, churn, net lines, languages, and cadence — counting only
*your* commits (matched on `git config user.email`, or `--author`).

## License

MIT © kleer001
