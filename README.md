# /repo-digest

A [Claude Code](https://claude.com/claude-code) skill that turns a month of your own git
commits into a single self-contained HTML report — **what moved, what cooled, what shipped** —
read three ways on three pages. Local git only; no network, no GitHub API, no telemetry.

It's the mirror of a usage report: instead of *how you used your tools*, it shows *what you made*.

## Install

```bash
claude plugins marketplace add kleer001/claude-slash-repo-digest && claude plugins install repo-digest
```

Requires `node` and `git` on your PATH.

## Usage

Run it from your code root, or point it at one:

| Command | What it does |
|---|---|
| `/repo-digest` | Last 30 days of the current directory's repos |
| `/repo-digest --dir ~/code` | Scan a specific code root |
| `/repo-digest last-month` | The previous calendar month |
| `/repo-digest 2026-05` | A specific calendar month |
| `/repo-digest --days 14` | A different rolling window |

The report saves to the current directory as `repo-digest-<window>.html`. Open it in a browser;
it prints to exactly three pages.

## The three views

Same data, three voices — because a raw stat wall is noise:

- **Page 1 — Executive.** The narrative. A few sentences on what carried the month, plus a
  momentum spine (what's accelerating, revived, new, cooling, cooled) and cards for the top movers.
- **Page 2 — Grounded.** The honest read. Leads with **churn / rework** — the files you rewrote
  over and over, where the real effort (and the thrash) lives. Net lines-of-code is shown but
  deliberately demoted; generated and data files make it lie.
- **Page 3 — Encouraging.** What you pulled off. Shipped tags, longest streak, busiest day, new
  projects started — and dormant repos reframed as "ready to revisit," not a guilt list.

## What it measures

For each repo with commits **by you** (matched on `git config user.email`, or `--author`) in the
window, compared against the preceding equal-length window:

- **Momentum** — `accelerating` · `revived` · `new` · `steady` · `cooling` · `cooled`
  (`new` = your first-ever commit landed in the window; `cooled` = active before, quiet now).
- **Churn** — files touched repeatedly, and a rework estimate (per hot file, `min(added, deleted)`).
- **Net lines**, **languages touched**, and **shipped** signal (tags/releases dated in the window).
- **Cadence** — active days, longest daily streak, busiest day.

## How it works

`analyze-repos.mjs` (zero dependencies) walks the directory for git repos, counts only your own
commits, and emits a JSON blob. The skill then writes the three short narratives — fanning out one
subagent per active repo to summarize that repo's commits — and embeds everything into a
self-contained `template.html`. All figures render from the data; the prose is the only authored
part.

It runs on demand. There's no scheduler: the report reads local repositories, so it has to run
where those repositories are.

## License

MIT © kleer001
