---
name: repo-digest
description: Generate a self-contained HTML digest of your own git work across local repos — what moved, what cooled, what shipped (features, not just commits) — read three ways (Executive, Grounded, Encouraging). Local git only, no network. Default window is the last 30 days; pass a calendar month or day count to change it.
---

# Repo Digest

Produce a self-contained, three-page HTML report of the user's **own commit activity**
across a directory of local git repos, and save it to the current working directory.
Sibling to `session-report` (which digests Claude usage); this digests the work itself.

The same data renders three views — **Executive** (the story), **Grounded** (the honest
read), **Encouraging** (what you pulled off) — each on its own print page. Local git only;
never call GitHub or any network service.

## Steps

1. **Get data.** Run the bundled analyzer. It lives beside this SKILL.md — use its absolute path.
   Default window is the last 30 days (rolling):
   ```sh
   node <skill-dir>/analyze-repos.mjs --json > /tmp/repo-digest.json
   ```
   The analyzer scans `--dir` (default: the current working directory) for git repos. If the
   user has a known code root, pass it; otherwise run from that root. Honor what the user asked:
   - code root → `--dir <path>` (default: current directory)
   - calendar month → `--month 2026-05` or `--month last-month`
   - different rolling window → `--days 14`
   - different identity → `--author <email>` (default = each repo's `git config user.email`)

2. **Read** `/tmp/repo-digest.json`. Skim `window`, `overall`, `top_repos`, and `by_repo`.
   Note `overall.active_repos` — it decides step 3.

3. **Per-repo prose (fan-out).** Each active repo (those with `commits > 0`) needs a 2–3
   sentence plain-language summary.
   - **If `active_repos > 8`:** dispatch **one subagent per active repo, in parallel**, via the
     **Agent tool** — never the Anthropic API (Claude Code is already the model). Give each
     subagent only its own slice, `by_repo["<name>"]` (it already contains `commits_log` with
     subjects, bodies, and per-commit line counts). The subagent must **not** run git.
     Prompt each with:
     > Here is one window of your own commits for repo **<name>** as JSON. Return 2–3 plain
     > sentences: what changed, what shipped (name concrete features from `features.items`, framed
     > as "~N"; tags are releases), and one honest note — call out churn if `churn.rework_lines`
     > is high relative to `lines.net`, or lots of commits but few features. No markup, no
     > preamble, no repo name prefix. Just the sentences.
   - **If `active_repos ≤ 8`:** skip the fan-out and write the per-repo sentences yourself
     inline from `by_repo`.
   - Collect the result for each repo, keyed by repo name.

4. **Copy the template** to the output path in the current working directory, date-stamping the
   filename with the window's start and end (`window.from`, `window.to` from the JSON):
   ```sh
   cp <skill-dir>/template.html ./repo-digest_<FROM>_to_<TO>.html
   ```
   e.g. `repo-digest_2026-05-02_to_2026-06-01.html`. The page header renders the same coverage
   dates (and the generated date) automatically from the data — you don't write them.

5. **Edit the output file** (use Edit, not Write — preserve the template's JS/CSS). Fill five slots:

   - **`<script id="report-data">`** — replace its `{}` with the full JSON from step 1. Every
     number, table, badge, bar, and the momentum spine renders from this blob automatically.
     You write **prose only** — never hand-type figures into the prose; cite what the data says.

   - **`<!-- AGENT: repo-notes -->`** — one line per active repo, exactly:
     ```html
     <div class="repo-note" data-repo="voice_loom">Built out the TTS pipeline end to end; steady, low rework.</div>
     ```
     Use the step-3 sentences. `data-repo` must match the `by_repo` key. The page slots each
     note under its repo's card. Cover at least the `top_repos` top 5; more is fine.

   - **`<!-- AGENT: executive -->`** — Dana, a grounded CTO. 3–4 sentences, highest altitude.
     The *narrative* of the window: what carried the momentum, what's new, what cooled, what
     shipped. Lean on **`features.count` and tags as the delivery signal** rather than raw
     commit count (commits are motion, not delivery) — but hedge it ("roughly N features").
     No per-repo dumping (the spine and cards below already list repos). Wrap key
     subjects in `<b>`, secondary emphasis in `<em>`. Markup: `<div class="prose">…</div>`.

   - **`<!-- AGENT: grounded -->`** — Sam, a senior dev who's seen some serious shit. Honest,
     no vanity metrics. Lead with **rework/churn** — name the repos and files where the thrash
     lives (from `churn.hot_files`). Treat net LOC **and `features.count`** skeptically: features
     are inferred from commit messages, so if `features.by_signal` is mostly `keyword` say the
     feature read is soft, and call out any repo with a high commit count but near-zero features
     (motion, not delivery). Treat net LOC the same (data/generated files inflate it; say so if a
     repo's net is huge but rework is tiny). Mention cooled repos neutrally as "no commits this
     window," not as failure. No streaks, no cheerleading. `<div class="prose">…</div>`.

   - **`<!-- AGENT: encouraging -->`** — Jordan, an early-career dev who celebrates progress.
     Warm and specific: features shipped (frame as "around N"), longest streak, busiest day, new
     projects started. The stat grid is intentionally sparse now, so the warmth lives in your
     words — name real `feat:`/tag wins from `features.items`. Frame cooled repos as "ready to
     revisit," never as guilt. `<div class="prose">…</div>`.

   Do not restructure sections or edit anything outside the five slots.

6. **Report** the saved file path. Do not open or render it. Mention it prints to three pages
   (one per persona).

## Notes

- **Manual only.** There is no scheduler. Cloud scheduling (`/schedule`) runs remote agents that
  can't see local repos, so it can't drive this. Run it whenever you want a look.
- The template owns all interactivity (sortable table, momentum badges, day strip, print page
  breaks). Your job is data + three short narratives + the per-repo notes.
- `momentum` per repo: `accelerating` / `revived` / `new` / `steady` / `cooling` / `cooled`
  (the stale list). `new` = first-ever commit by this author landed in the window.
- `churn.rework_lines` is a **heuristic estimate** (per hot file, `min(added, deleted)`), not
  exact add-then-delete tracking — phrase it as "rework" / "≈", never as a precise count.
- `features.count` is a **heuristic estimate** of shipped capabilities, layered from git tags
  (high confidence), `feat:` conventional commits (high), feature-branch merges (medium), and
  keyword-led subjects like "add/implement/introduce" (low). It is noisy and convention-dependent —
  always phrase it as "~N features" / "roughly", never an exact count. A repo with no commit
  conventions reads **0 features** even while active; that is honest absence, not failure. Use
  `features.by_signal` to gauge confidence (mostly `keyword` = a soft read).
- The page is **prose-first by design**: raw figures (commits, net LOC) are deliberately muted
  into small accents and a reference table, so commit count no longer headlines. State the numbers
  that *matter* in your prose — don't assume the reader sees a big figure — while never dumping
  lists of numbers.
- Keep each persona's prose tight enough that its page stays on one printed page. Terse and
  specific beats long.
